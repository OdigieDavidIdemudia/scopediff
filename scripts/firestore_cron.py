"""Free-plan cron runner.

Reads pending watches and due watches from Firestore, fetches the published
program revisions with the normal adapters, stores diffs and sends Slack alerts.

This replaces Cloud Run + Cloud Scheduler. It is intended to run from a GitHub
Actions scheduled workflow every 30 minutes.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))
try:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT") or "scopediff"
PUBLIC_URL = os.getenv("SCOPEDIFF_PUBLIC_URL") or "https://scopediff.web.app"


def _init_firebase():
    import firebase_admin
    from firebase_admin import credentials

    raw = os.getenv("FIREBASE_SERVICE_ACCOUNT")
    if raw and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        # google-cloud-firestore reads ADC independently of firebase-admin.
        path = Path(tempfile.gettempdir()) / "scopediff-cron-service-account.json"
        path.write_text(raw, encoding="utf-8")
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(path)

    if firebase_admin._apps:
        return
    if raw:
        cred = credentials.Certificate(json.loads(raw))
    else:
        cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": PROJECT})


def _adapter(platform: str):
    from app.adapters.bugcrowd import BugcrowdAdapter
    from app.adapters.hackerone import HackerOneAdapter
    from app.adapters.intigriti import IntigritiAdapter

    if platform == "bugcrowd":
        return BugcrowdAdapter()
    if platform == "hackerone":
        return HackerOneAdapter(
            username=os.getenv("H1_API_USER"),
            token=os.getenv("H1_API_TOKEN"),
        )
    if platform == "intigriti":
        return IntigritiAdapter()
    raise ValueError(f"Unsupported platform: {platform}")


def main() -> int:
    _init_firebase()
    from firebase_admin import firestore

    from app.adapters.base import ProgramRef
    from app.adapters.links import parse_program_url
    from app.models import Watch, utcnow
    from app.pipeline.alerts import SlackNotifier
    from app.pipeline.store import FirestoreStore
    from app.pipeline.sync import sync_program
    from app.users import FirestoreUserRepository, watch_should_alert

    db = firestore.client()
    store = FirestoreStore(project=PROJECT)
    users = FirestoreUserRepository()
    now = utcnow()
    summary = {"pending": 0, "activated": 0, "checked": 0, "changed": 0, "notified": 0, "errors": []}

    # Free-plan scale is small, so scan user watch subcollections directly.
    # This avoids collection-group composite-index requirements.
    all_watch_docs: list[tuple[str, object]] = []
    for user_doc in db.collection("users").stream():
        for watch_doc in (
            db.collection("users")
            .document(user_doc.id)
            .collection("watches")
            .stream()
        ):
            all_watch_docs.append((user_doc.id, watch_doc))

    # 1. Turn queued URLs into real watches and capture the first baseline.
    pending = [
        (uid, doc)
        for uid, doc in all_watch_docs
        if (doc.to_dict() or {}).get("status") == "pending"
    ]
    summary["pending"] = len(pending)
    for uid, doc in pending:
        data = doc.to_dict() or {}
        try:
            ref = parse_program_url(str(data.get("program_url") or ""))
            result = sync_program(store, _adapter(ref.platform), ref)
            if result.status == "error":
                raise RuntimeError(result.message or "Could not fetch the program")
            program = store.get_program(result.program_id)
            if not program:
                raise RuntimeError("No stored program after baseline fetch")
            interval = max(30, int(data.get("interval_minutes") or 30))
            watch = Watch(
                uid=uid,
                program_id=program.id,
                platform=program.platform,
                handle=program.handle,
                program_name=program.name,
                program_url=program.url,
                interval_minutes=interval,
                active=True,
                status="active",
                alert_mode=data.get("alert_mode") or "high",
                min_materiality=int(data.get("min_materiality") or 25),
                slack_webhook=data.get("slack_webhook") or None,
                created_at=now,
                last_checked_at=now,
                next_check_at=now + timedelta(minutes=interval),
                last_sync_status=result.status,
                last_change_id=result.change_id,
            )
            users.upsert_watch(watch)
            doc.reference.delete()
            summary["activated"] += 1
        except Exception as exc:  # noqa: BLE001 - keep one bad URL from stopping the run
            doc.reference.update(
                {
                    "status": "error",
                    "error": str(exc)[:500],
                    "next_check_at": now + timedelta(minutes=30),
                }
            )
            summary["errors"].append({"pending": doc.id, "error": str(exc)[:300]})

    # 2. Check due active watches, grouped by program so one fetch updates every watcher.
    from app.models import Watch as WatchModel

    due: list[Watch] = []
    for uid, doc in all_watch_docs:
        data = doc.to_dict() or {}
        if data.get("status") != "active" or data.get("active") is False:
            continue
        try:
            watch = WatchModel.model_validate({**data, "uid": uid})
        except Exception:
            continue
        if watch.next_check_at <= now:
            due.append(watch)
    grouped: dict[str, list[Watch]] = {}
    for watch in due:
        grouped.setdefault(watch.program_id, []).append(watch)

    for program_id, group in grouped.items():
        first = group[0]
        try:
            ref = ProgramRef(
                platform=first.platform,
                handle=first.handle,
                url=first.program_url,
            )
            result = sync_program(store, _adapter(first.platform), ref)
            summary["checked"] += 1
            if result.status == "error":
                summary["errors"].append({"program": program_id, "error": result.message})
            elif result.change_id:
                summary["changed"] += 1

            watchers = [
                watch
                for watch in users.list_watchers(program_id)
                if watch.status == "active" and watch.active
            ]
            for watcher in watchers:
                users.upsert_watch(
                    watcher.model_copy(
                        update={
                            "last_checked_at": now,
                            "next_check_at": now
                            + timedelta(minutes=max(30, watcher.interval_minutes)),
                            "last_sync_status": result.status,
                            "last_change_id": result.change_id
                            or watcher.last_change_id,
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
                            profile.preferences if profile else None
                        )
                        if not preferences:
                            continue
                        if not watch_should_alert(
                            watcher, change, change_items, preferences
                        ):
                            continue
                        webhook = watcher.slack_webhook or preferences.slack_webhook
                        if not webhook:
                            continue
                        alert = SlackNotifier(
                            webhook,
                            public_url=PUBLIC_URL,
                            allow_any=False,
                        ).send_change(change, change_items)
                        if alert.status == "sent":
                            users.upsert_watch(
                                watcher.model_copy(
                                    update={"last_notified_change_id": change.id}
                                )
                            )
                            summary["notified"] += 1
        except Exception as exc:  # noqa: BLE001
            summary["errors"].append({"program": program_id, "error": str(exc)[:300]})
            for watcher in group:
                users.upsert_watch(
                    watcher.model_copy(
                        update={
                            "last_checked_at": now,
                            "next_check_at": now
                            + timedelta(minutes=max(30, watcher.interval_minutes)),
                            "last_sync_status": "error",
                        }
                    )
                )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
