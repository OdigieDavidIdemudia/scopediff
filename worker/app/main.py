from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.adapters.base import AdapterError, AdapterNotConfigured, ProgramRef
from app.adapters.bugcrowd import BugcrowdAdapter
from app.adapters.fixture import FixtureAdapter
from app.adapters.hackerone import HackerOneAdapter
from app.adapters.intigriti import IntigritiAdapter
from app.adapters.links import UnsupportedProgramLink, parse_program_url
from app.config import get_settings
from app.models import (
    AlertResult,
    Change,
    ChangeItem,
    PlatformStatus,
    Program,
    SourceRun,
    SyncResult,
    UserPreferences,
    UserProfile,
    Watch,
    WatchCreate,
    WatchUpdate,
    utcnow,
)
from app.pipeline.alerts import SlackNotifier
from app.pipeline.simulate import ensure_sandbox, simulate_next
from app.pipeline.store import Store, StoreError, get_store
from app.pipeline.sync import sync_many, sync_program
from app.users import (
    AuthUser,
    UserRepository,
    current_user,
    get_user_store,
    reschedule_watch,
    schedule_watch,
    watch_should_alert,
)

settings = get_settings()

app = FastAPI(
    title="ScopeDiff API",
    version="0.1.0",
    description="Scope-change watcher for bug bounty programs. No scanning. No exploitation.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def store_dependency() -> Store:
    return get_store()


def get_store_dep() -> Store:
    return store_dependency()


@lru_cache(maxsize=1)
def user_store_dependency() -> UserRepository:
    return get_user_store()


def get_user_store_dep() -> UserRepository:
    return user_store_dependency()


def internal_guard(x_scopediff_token: str | None = Header(default=None)) -> None:
    if settings.internal_token:
        if x_scopediff_token != settings.internal_token:
            raise HTTPException(status_code=403, detail="Invalid internal token")
        return
    if not settings.demo:
        raise HTTPException(
            status_code=503,
            detail=(
                "Internal endpoints are disabled until SCOPEDIFF_INTERNAL_TOKEN "
                "is configured."
            ),
        )


def _notifier(webhook: str | None = None) -> SlackNotifier:
    return SlackNotifier(
        webhook or settings.slack_webhook_url,
        public_url=settings.public_url,
        allow_any=settings.allow_any_webhook,
    )


class SyncRequest(BaseModel):
    platform: Literal["bugcrowd", "hackerone", "intigriti", "sandbox"]
    handle: str | None = None
    all: bool = False
    limit: int = Field(default=10, ge=1, le=100)
    force: bool = False


class SimulateRequest(BaseModel):
    scenario: str = "acme-v8"


class AlertTestRequest(BaseModel):
    webhook_url: str | None = None


class SyncResponse(BaseModel):
    results: list[SyncResult]


class DiffResponse(BaseModel):
    change: Change
    items: list[ChangeItem]


class AdminOverview(BaseModel):
    platforms: list[PlatformStatus]
    runs: list[SourceRun]
    programs: int
    changes: int


@app.get("/healthz")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "demo": settings.demo,
        "store": settings.store_kind,
        "slack_configured": bool(settings.slack_webhook_url),
        "hackerone_configured": bool(settings.h1_api_user and settings.h1_api_token),
    }


def _bootstrap_viewer() -> dict[str, Any]:
    """Demo mode ships a viewer profile; live mode starts empty."""
    if settings.demo and settings.demo_data_path.exists():
        try:
            raw = json.loads(settings.demo_data_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
        viewer = raw.get("viewer") or {}
        if viewer:
            return {
                "name": str(viewer.get("name") or "Demo Hunter"),
                "handle": str(viewer.get("handle") or "demo"),
                "testing": [str(value) for value in viewer.get("testing") or []],
                "watchlist": [str(value) for value in viewer.get("watchlist") or []],
            }
    return {"name": "Live hunter", "handle": "live", "testing": [], "watchlist": []}


@app.get("/api/bootstrap")
def bootstrap(store: Store = Depends(get_store_dep)) -> dict[str, Any]:
    """Everything the web app needs for a first paint, in one round trip."""
    programs = store.list_programs()
    versions: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    for program in programs:
        rows = store.list_versions(program.id)
        versions.extend(row.model_dump(mode="json") for row in rows)
        for version in rows:
            snapshot = store.get_snapshot(program.id, version.version)
            if snapshot:
                snapshots.append(snapshot.model_dump(mode="json"))

    changes = store.list_changes(limit=100)
    items: list[dict[str, Any]] = []
    for change in changes:
        items.extend(item.model_dump(mode="json") for item in store.get_items(change.id))

    return {
        "meta": {
            "title": "ScopeDiff",
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "demo": settings.demo,
            "sandbox": settings.demo,
            "note": (
                "All targets use RFC 2606 reserved domains and RFC 5737 test "
                "ranges. Nothing is scanned."
                if settings.demo
                else None
            ),
        },
        "viewer": _bootstrap_viewer(),
        "platforms": [row.model_dump(mode="json") for row in store.platform_status()],
        "programs": [row.model_dump(mode="json") for row in programs],
        "versions": versions,
        "snapshots": snapshots,
        "changes": [row.model_dump(mode="json") for row in changes],
        "items": items,
        "runs": [row.model_dump(mode="json") for row in store.list_runs(20)],
    }


def _me_bootstrap(
    store: Store, users: UserRepository, user: AuthUser
) -> dict[str, Any]:
    profile = users.ensure_profile(user)
    watches = users.list_watches(user.uid)
    watched_ids = {watch.program_id for watch in watches}
    programs = [program for program in store.list_programs() if program.id in watched_ids]

    versions: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    for program in programs:
        rows = store.list_versions(program.id)
        versions.extend(row.model_dump(mode="json") for row in rows)
        for version in rows:
            snapshot = store.get_snapshot(program.id, version.version)
            if snapshot:
                snapshots.append(snapshot.model_dump(mode="json"))

    changes = [
        change
        for change in store.list_changes(limit=100)
        if change.program_id in watched_ids
    ]
    items: list[dict[str, Any]] = []
    for change in changes:
        items.extend(item.model_dump(mode="json") for item in store.get_items(change.id))

    return {
        "meta": {
            "title": "ScopeDiff",
            "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "demo": False,
            "sandbox": False,
            "note": "Live data from published program revisions. Nothing is scanned.",
        },
        "viewer": {
            "name": profile.name,
            "handle": profile.email or profile.uid,
            "testing": profile.preferences.testing_targets,
            "watchlist": sorted(watched_ids),
        },
        "profile": profile.model_dump(mode="json"),
        "watches": [watch.model_dump(mode="json") for watch in watches],
        "platforms": [row.model_dump(mode="json") for row in store.platform_status()],
        "programs": [row.model_dump(mode="json") for row in programs],
        "versions": versions,
        "snapshots": snapshots,
        "changes": [row.model_dump(mode="json") for row in changes],
        "items": items,
        "runs": [row.model_dump(mode="json") for row in store.list_runs(20)],
    }


@app.get("/api/me/profile", response_model=UserProfile)
def me_profile(
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> UserProfile:
    return users.ensure_profile(user)


@app.put("/api/me/preferences", response_model=UserProfile)
def save_my_preferences(
    preferences: UserPreferences,
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> UserProfile:
    users.ensure_profile(user)
    return users.save_preferences(user.uid, preferences)


class MeAlertTestRequest(BaseModel):
    webhook_url: str | None = None


@app.post("/api/me/alerts/test", response_model=AlertResult)
def test_my_alert(
    payload: MeAlertTestRequest,
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> AlertResult:
    profile = users.ensure_profile(user)
    webhook = payload.webhook_url or profile.preferences.slack_webhook
    notifier = SlackNotifier(
        webhook,
        public_url=settings.public_url,
        allow_any=settings.allow_any_webhook,
    )
    return notifier.send_test()


@app.get("/api/me/watches", response_model=list[Watch])
def my_watches(
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> list[Watch]:
    return users.list_watches(user.uid)


@app.get("/api/me/bootstrap")
def me_bootstrap(
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store_dep),
    users: UserRepository = Depends(get_user_store_dep),
) -> dict[str, Any]:
    return _me_bootstrap(store, users, user)


@app.post("/api/me/watches")
def add_my_watch(
    payload: WatchCreate,
    user: AuthUser = Depends(current_user),
    store: Store = Depends(get_store_dep),
    users: UserRepository = Depends(get_user_store_dep),
) -> dict[str, Any]:
    profile = users.ensure_profile(user)
    try:
        ref = parse_program_url(payload.url)
    except UnsupportedProgramLink as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        adapter = _adapter(ref.platform)
        result = sync_program(store, adapter, ref)
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AdapterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if result.status == "error":
        raise HTTPException(
            status_code=502,
            detail=result.message or "The program could not be read from its public page.",
        )

    program = store.get_program(result.program_id)
    if not program:
        raise HTTPException(
            status_code=500,
            detail="The program was fetched but no stored program was created.",
        )

    prefs = profile.preferences
    interval = payload.interval_minutes or prefs.interval_minutes or settings.default_interval_minutes
    interval = max(settings.min_interval_minutes, min(1440, int(interval)))
    now = utcnow()
    watch = Watch(
        uid=user.uid,
        program_id=program.id,
        platform=program.platform,
        handle=program.handle,
        program_name=program.name,
        program_url=program.url,
        interval_minutes=interval,
        alert_mode=payload.alert_mode or prefs.alert_mode,
        min_materiality=(
            payload.min_materiality
            if payload.min_materiality is not None
            else prefs.min_materiality
        ),
        slack_webhook=payload.slack_webhook or prefs.slack_webhook,
        created_at=now,
        last_checked_at=now,
        next_check_at=now + timedelta(minutes=interval),
        last_sync_status=result.status,
        last_change_id=result.change_id,
    )
    users.upsert_watch(watch)
    return {"watch": watch, "program": program, "result": result}


@app.patch("/api/me/watches/{program_id}", response_model=Watch)
def update_my_watch(
    program_id: str,
    payload: WatchUpdate,
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> Watch:
    watch = users.get_watch(user.uid, program_id)
    if not watch:
        raise HTTPException(status_code=404, detail="Watch not found")
    updates: dict[str, Any] = {}
    if payload.interval_minutes is not None:
        updates["interval_minutes"] = max(
            settings.min_interval_minutes, min(1440, payload.interval_minutes)
        )
        updates["next_check_at"] = utcnow() + timedelta(
            minutes=updates["interval_minutes"]
        )
    if payload.active is not None:
        updates["active"] = payload.active
        if payload.active:
            updates["next_check_at"] = utcnow()
    if payload.alert_mode is not None:
        updates["alert_mode"] = payload.alert_mode
    if payload.min_materiality is not None:
        updates["min_materiality"] = payload.min_materiality
    if payload.slack_webhook is not None:
        updates["slack_webhook"] = payload.slack_webhook
    updated = watch.model_copy(update=updates)
    return users.upsert_watch(updated)


@app.delete("/api/me/watches/{program_id}")
def delete_my_watch(
    program_id: str,
    user: AuthUser = Depends(current_user),
    users: UserRepository = Depends(get_user_store_dep),
) -> dict[str, bool]:
    users.delete_watch(user.uid, program_id)
    return {"deleted": True}


@app.get("/api/platforms", response_model=list[PlatformStatus])
def platforms(store: Store = Depends(get_store_dep)) -> list[PlatformStatus]:
    return store.platform_status()


@app.get("/api/programs", response_model=list[Program])
def programs(
    platform: str | None = None,
    q: str | None = None,
    store: Store = Depends(get_store_dep),
) -> list[Program]:
    rows = store.list_programs()
    if platform:
        rows = [p for p in rows if p.platform == platform]
    if q:
        needle = q.lower()
        rows = [
            p
            for p in rows
            if needle in p.name.lower() or needle in p.handle.lower()
        ]
    return rows


@app.get("/api/programs/{program_id}", response_model=Program)
def program(program_id: str, store: Store = Depends(get_store_dep)) -> Program:
    row = store.get_program(program_id)
    if not row:
        raise HTTPException(status_code=404, detail="Program not found")
    return row


@app.get("/api/programs/{program_id}/assets")
def program_assets(program_id: str, store: Store = Depends(get_store_dep)) -> list[dict]:
    if not store.get_program(program_id):
        raise HTTPException(status_code=404, detail="Program not found")
    return [asset.model_dump(mode="json") for asset in store.list_assets(program_id)]


@app.get("/api/programs/{program_id}/versions")
def program_versions(program_id: str, store: Store = Depends(get_store_dep)) -> list[dict]:
    if not store.get_program(program_id):
        raise HTTPException(status_code=404, detail="Program not found")
    return [version.model_dump(mode="json") for version in store.list_versions(program_id)]


@app.get("/api/changes", response_model=list[Change])
def changes(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    program_id: str | None = None,
    platform: str | None = None,
    impact: str | None = None,
    confidence: str | None = None,
    status: str | None = None,
    q: str | None = None,
    store: Store = Depends(get_store_dep),
) -> list[Change]:
    return store.list_changes(
        limit=limit,
        offset=offset,
        program_id=program_id,
        platform=platform,
        impact=impact,
        confidence=confidence,
        status=status,
        q=q,
    )


@app.get("/api/changes/{change_id}", response_model=Change)
def change(change_id: str, store: Store = Depends(get_store_dep)) -> Change:
    row = store.get_change(change_id)
    if not row:
        raise HTTPException(status_code=404, detail="Change not found")
    return row


@app.get("/api/changes/{change_id}/items", response_model=list[ChangeItem])
def change_items(change_id: str, store: Store = Depends(get_store_dep)) -> list[ChangeItem]:
    if not store.get_change(change_id):
        raise HTTPException(status_code=404, detail="Change not found")
    return store.get_items(change_id)


@app.get("/api/changes/{change_id}/diff", response_model=DiffResponse)
def change_diff(change_id: str, store: Store = Depends(get_store_dep)) -> DiffResponse:
    row = store.get_change(change_id)
    if not row:
        raise HTTPException(status_code=404, detail="Change not found")
    return DiffResponse(change=row, items=store.get_items(change_id))


@app.get("/api/runs", response_model=list[SourceRun])
def runs(limit: int = Query(default=20, ge=1, le=100), store: Store = Depends(get_store_dep)) -> list[SourceRun]:
    return store.list_runs(limit)


@app.get("/api/admin/overview", response_model=AdminOverview)
def admin_overview(store: Store = Depends(get_store_dep)) -> AdminOverview:
    programs_count = len(store.list_programs())
    changes_count = len(store.list_changes(limit=100))
    return AdminOverview(
        platforms=store.platform_status(),
        runs=store.list_runs(20),
        programs=programs_count,
        changes=changes_count,
    )


def _adapter(platform: str):
    if platform == "bugcrowd":
        return BugcrowdAdapter()
    if platform == "hackerone":
        return HackerOneAdapter(
            username=settings.h1_api_user, token=settings.h1_api_token
        )
    if platform == "intigriti":
        return IntigritiAdapter()
    if platform == "sandbox":
        return FixtureAdapter()
    raise HTTPException(status_code=400, detail=f"Unknown platform: {platform}")


@app.post(
    "/internal/sync",
    response_model=SyncResponse,
    dependencies=[Depends(internal_guard)],
)
def trigger_sync(
    request: SyncRequest,
    store: Store = Depends(get_store_dep),
) -> SyncResponse:
    adapter = _adapter(request.platform)
    notifier = _notifier()
    try:
        if request.all:
            refs = adapter.list_programs(limit=request.limit)
            if not refs:
                raise HTTPException(
                    status_code=400,
                    detail=f"{request.platform} does not expose a program directory to this worker",
                )
            results = sync_many(
                store,
                adapter,
                refs,
                force=request.force,
                notifier=notifier,
                alert_min_score=settings.slack_min_score,
            )
            return SyncResponse(results=results)
        if not request.handle:
            raise HTTPException(
                status_code=400, detail="handle is required when all=false"
            )
        ref = ProgramRef(platform=request.platform, handle=request.handle)
        result = sync_program(
            store,
            adapter,
            ref,
            force=request.force,
            notifier=notifier,
            alert_min_score=settings.slack_min_score,
        )
        return SyncResponse(results=[result])
    except AdapterNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except AdapterError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except StoreError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post(
    "/internal/simulate",
    dependencies=[Depends(internal_guard)],
)
def trigger_simulation(
    request: SimulateRequest,
    store: Store = Depends(get_store_dep),
) -> dict:
    if request.scenario not in {"acme-v8", "sandbox"}:
        raise HTTPException(status_code=400, detail="Unknown simulation scenario")
    try:
        return simulate_next(store)
    except StoreError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except AdapterError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post(
    "/internal/seed",
    dependencies=[Depends(internal_guard)],
)
def trigger_seed(store: Store = Depends(get_store_dep)) -> dict:
    try:
        program_id = ensure_sandbox(store)
        return {"program_id": program_id, "message": "Sandbox baseline ready"}
    except StoreError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post(
    "/internal/alerts/test",
    response_model=AlertResult,
    dependencies=[Depends(internal_guard)],
)
def test_alert(request: AlertTestRequest) -> AlertResult:
    notifier = _notifier(request.webhook_url)
    return notifier.send_test()


@app.post(
    "/internal/cron",
    dependencies=[Depends(internal_guard)],
)
def cron_watches(
    store: Store = Depends(get_store_dep),
    users: UserRepository = Depends(get_user_store_dep),
) -> dict[str, Any]:
    """Run every minute from Cloud Scheduler.

    Watches carry their own next_check_at, so a single cron cadence supports
    per-user 1/5/15/60 minute intervals without one scheduler job per watch.
    """
    now = utcnow()
    due = users.list_due_watches(now)
    grouped: dict[str, list[Watch]] = {}
    for watch in due:
        grouped.setdefault(watch.program_id, []).append(watch)

    checked = 0
    changed = 0
    notified = 0
    errors: list[dict[str, str]] = []

    for program_id, group in grouped.items():
        first = group[0]
        try:
            ref = ProgramRef(
                platform=first.platform,
                handle=first.handle,
                url=first.program_url,
            )
            adapter = _adapter(first.platform)
            result = sync_program(store, adapter, ref)
            checked += 1
            if result.status == "error":
                errors.append({"program_id": program_id, "error": result.message})
            elif result.change_id:
                changed += 1

            watchers = users.list_watchers(program_id)
            for watcher in watchers:
                interval = max(1, watcher.interval_minutes)
                users.upsert_watch(
                    watcher.model_copy(
                        update={
                            "last_checked_at": now,
                            "next_check_at": now + timedelta(minutes=interval),
                            "last_sync_status": result.status,
                            "last_change_id": result.change_id or watcher.last_change_id,
                        }
                    )
                )

            if result.change_id and result.status in {"changed", "review"}:
                change = store.get_change(result.change_id)
                if change and not change.is_baseline:
                    change_items = store.get_items(change.id)
                    for watcher in watchers:
                        if watcher.last_notified_change_id == change.id:
                            continue
                        profile = users.get_profile(watcher.uid)
                        preferences = (
                            profile.preferences if profile else UserPreferences()
                        )
                        if not watch_should_alert(
                            watcher, change, change_items, preferences
                        ):
                            continue
                        webhook = watcher.slack_webhook or preferences.slack_webhook
                        if not webhook:
                            continue
                        alert = SlackNotifier(
                            webhook,
                            public_url=settings.public_url,
                            allow_any=settings.allow_any_webhook,
                        ).send_change(change, change_items)
                        if alert.status == "sent":
                            users.upsert_watch(
                                watcher.model_copy(
                                    update={
                                        "last_notified_change_id": change.id,
                                    }
                                )
                            )
                            notified += 1
        except Exception as exc:  # noqa: BLE001 - a bad source must not stop the cron
            errors.append({"program_id": program_id, "error": str(exc)})
            for watcher in group:
                interval = max(1, watcher.interval_minutes)
                users.upsert_watch(
                    watcher.model_copy(
                        update={
                            "last_checked_at": now,
                            "next_check_at": now + timedelta(minutes=interval),
                            "last_sync_status": "error",
                        }
                    )
                )

    return {
        "due": len(due),
        "programs": len(grouped),
        "checked": checked,
        "changed": changed,
        "notified": notified,
        "errors": errors,
    }


@app.get("/api/meta")
def meta() -> dict[str, Any]:
    return {
        "name": "ScopeDiff",
        "version": "0.1.0",
        "demo": settings.demo,
        "public_url": settings.public_url,
        "limits": {"changes_page": 100, "programs_page": 100},
        "generated_at": time.time(),
    }
