from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from app.adapters.base import Adapter, AdapterError, ProgramRef, RawRevision, program_id
from app.diff.engine import diff_snapshots
from app.models import (
    Change,
    ChangeCounts,
    Program,
    SourceRef,
    SourceRun,
    SyncResult,
)
from app.normalize.canonical import build_snapshot
from app.pipeline.alerts import SlackNotifier
from app.pipeline.store import Store


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def _change_id(program_id: str, version: int) -> str:
    return f"{program_id}__v{version}"


def _apply_program_metadata(program: Program, revision: RawRevision, now: datetime) -> Program:
    incoming = revision.program
    return program.model_copy(
        update={
            "name": incoming.name,
            "url": incoming.url,
            "status": incoming.status,
            "industry": incoming.industry or program.industry,
            "offers_bounties": incoming.offers_bounties,
            "currency": incoming.currency or program.currency,
            "min_bounty": incoming.min_bounty if incoming.min_bounty is not None else program.min_bounty,
            "max_bounty": incoming.max_bounty if incoming.max_bounty is not None else program.max_bounty,
            "tags": sorted(set(program.tags) | set(incoming.tags)),
            "last_checked_at": now,
            "source": SourceRef(
                adapter=incoming.platform,
                revision_id=revision.source_revision_id,
                published_at=revision.source_published_at,
                fetched_at=now,
                url=revision.source_url,
            ),
        }
    )


def _baseline_change(
    program: Program, snapshot, now: datetime, revision: RawRevision
) -> Change:
    return Change(
        id=_change_id(program.id, snapshot.version),
        program_id=program.id,
        program_name=program.name,
        platform=program.platform,
        program_url=program.url,
        from_version=0,
        to_version=snapshot.version,
        detected_at=now,
        source_published_at=revision.source_published_at,
        source_revision_id=revision.source_revision_id,
        source_url=revision.source_url,
        is_baseline=True,
        is_simulation=False,
        confidence=snapshot.confidence,
        impact="neutral",
        magnitude="low",
        materiality_score=0,
        reasons=[
            f"Baseline captured: {snapshot.counts.in_scope} in-scope targets"
        ],
        counts=ChangeCounts(),
        status="ready",
        items_preview=[],
        items=[],
        alert_status="skipped",
    )


def _finish_run(
    run: SourceRun,
    *,
    status: str,
    notes: list[str] | None = None,
    error: str | None = None,
    changed: int = 0,
    assets: int = 0,
) -> SourceRun:
    finish = _now()
    return run.model_copy(
        update={
            "finished_at": finish,
            "status": status,
            "programs_seen": 1,
            "programs_changed": changed,
            "assets_seen": assets,
            "latency_ms": int((finish - run.started_at).total_seconds() * 1000),
            "notes": notes or [],
            "error": error,
        }
    )


def sync_revision(
    store: Store,
    ref: ProgramRef,
    revision: RawRevision,
    *,
    force: bool = False,
    is_simulation: bool = False,
    notifier: SlackNotifier | None = None,
    alert_min_score: int = 25,
) -> SyncResult:
    started = _now()
    run = SourceRun(
        id=_run_id(),
        platform=revision.program.platform,
        target=ref.handle,
        started_at=started,
        status="running",
    )
    try:
        existing = store.get_program(revision.program.id)
        current = store.get_current_snapshot(revision.program.id)
        version = (current.version if current else 0) + 1
        snapshot = build_snapshot(
            revision.program.id,
            revision.assets,
            version=version,
            captured_at=started,
            source_revision_id=revision.source_revision_id,
            source_published_at=revision.source_published_at,
            source_url=revision.source_url,
            complete=revision.complete,
        )

        if snapshot.counts.total == 0:
            message = "Fetch returned zero targets; refusing to overwrite the last good snapshot"
            store.record_run(_finish_run(run, status="error", error=message))
            return SyncResult(program_id=revision.program.id, status="error", message=message)

        if existing:
            program = _apply_program_metadata(existing, revision, started)
        else:
            program = _apply_program_metadata(revision.program, revision, started)
            program = program.model_copy(update={"first_seen_at": started})

        if current is None:
            program = program.model_copy(
                update={
                    "current_version": snapshot.version,
                    "current_hash": snapshot.hash,
                    "scope_counts": snapshot.counts,
                    "last_changed_at": None,
                }
            )
            change = _baseline_change(program, snapshot, started, revision)
            run = _finish_run(
                run,
                status="ok",
                notes=[
                    f"Baseline: {snapshot.counts.in_scope} in-scope, "
                    f"{snapshot.counts.out_of_scope} out-of-scope"
                ],
                assets=snapshot.counts.total,
            )
            store.commit(
                program=program, snapshot=snapshot, change=change, items=[], run=run
            )
            return SyncResult(
                program_id=program.id,
                status="baseline",
                change_id=change.id,
                message=change.reasons[0],
                latency_ms=run.latency_ms,
            )

        # A partial fetch or a sudden scope collapse is treated as a source
        # problem, not a scope change. This is the single most important guard
        # against false positives.
        current_in = {
            a.key for a in current.assets if a.kind == "in"
        }
        new_in = {a.key for a in snapshot.assets if a.kind == "in"}
        removed_ratio = len(current_in - new_in) / max(1, len(current_in))
        suspicious = (
            not force
            and len(current_in) >= 4
            and (
                removed_ratio >= 0.5
                or snapshot.counts.in_scope < len(current_in) * 0.4
            )
        )
        confirmed = False
        if suspicious:
            pending = store.get_pending(program.id)
            if pending and pending.hash == snapshot.hash:
                confirmed = True
                store.clear_pending(program.id)
            else:
                store.set_pending(program.id, snapshot)
                message = (
                    "Large removal held for confirmation (1/2). "
                    "Run the sync again to confirm the same snapshot."
                )
                store.record_run(
                    _finish_run(
                        run,
                        status="warn",
                        notes=[message],
                        assets=snapshot.counts.total,
                    )
                )
                return SyncResult(
                    program_id=program.id,
                    status="review",
                    message=message,
                    latency_ms=int((_now() - started).total_seconds() * 1000),
                )
        else:
            store.clear_pending(program.id)

        if snapshot.hash == current.hash:
            program = program.model_copy(
                update={
                    "current_version": current.version,
                    "current_hash": current.hash,
                    "scope_counts": current.counts,
                }
            )
            run = _finish_run(
                run,
                status="ok",
                notes=["No material scope change"],
                assets=snapshot.counts.total,
            )
            store.upsert_program(program)
            store.record_run(run)
            return SyncResult(
                program_id=program.id,
                status="unchanged",
                message="No material scope change",
                latency_ms=run.latency_ms,
            )

        change_id = _change_id(program.id, snapshot.version)
        diff = diff_snapshots(
            current,
            snapshot,
            change_id,
            ever_seen_keys=store.ever_seen_keys(program.id),
        )
        if not diff.items:
            # Hash changed but nothing material survived normalisation. Keep the
            # current snapshot so the next run can settle on a real revision.
            run = _finish_run(
                run,
                status="warn",
                notes=["Revision hash changed but no material diff was found"],
                assets=snapshot.counts.total,
            )
            store.upsert_program(program)
            store.record_run(run)
            return SyncResult(
                program_id=program.id,
                status="unchanged",
                message="Revision changed but no material scope diff",
                latency_ms=run.latency_ms,
            )

        reasons = list(diff.reasons)
        if confirmed:
            reasons.insert(0, "Confirmed on second identical fetch")
        if force:
            reasons.insert(0, "Admin forced past the truncation guard")

        change = Change(
            id=change_id,
            program_id=program.id,
            program_name=program.name,
            platform=program.platform,
            program_url=program.url,
            from_version=current.version,
            to_version=snapshot.version,
            detected_at=started,
            source_published_at=revision.source_published_at,
            source_revision_id=revision.source_revision_id,
            source_url=revision.source_url,
            is_baseline=False,
            is_simulation=is_simulation,
            confidence="high" if revision.complete and not suspicious else "low",
            impact=diff.impact,
            magnitude=diff.magnitude,
            materiality_score=diff.materiality_score,
            reasons=reasons[:8],
            counts=diff.counts,
            status="ready",
            items_preview=diff.items[:3],
            items=diff.items,
            alert_status="pending",
        )
        program = program.model_copy(
            update={
                "current_version": snapshot.version,
                "current_hash": snapshot.hash,
                "scope_counts": snapshot.counts,
                "last_changed_at": started,
            }
        )
        run = _finish_run(
            run,
            status="ok",
            notes=[f"{snapshot.counts.total} targets checked"],
            changed=1,
            assets=snapshot.counts.total,
        )
        store.commit(
            program=program,
            snapshot=snapshot,
            change=change,
            items=diff.items,
            run=run,
        )

        if notifier and notifier.configured and change.materiality_score >= alert_min_score:
            result = notifier.send_change(change, diff.items)
            change = change.model_copy(
                update={
                    "alert_status": result.status,
                    "alerted_at": _now() if result.status == "sent" else None,
                    "alert_error": None if result.status == "sent" else result.message,
                }
            )
            store.update_change(change)
        elif notifier and notifier.configured:
            change = change.model_copy(
                update={
                    "alert_status": "skipped",
                    "alert_error": f"Below alert threshold ({alert_min_score})",
                }
            )
            store.update_change(change)

        return SyncResult(
            program_id=program.id,
            status="changed",
            change_id=change.id,
            message=f"{diff.counts.total} targets changed · score {diff.materiality_score}",
            latency_ms=run.latency_ms,
        )
    except Exception as exc:  # noqa: BLE001 - the CLI must never crash mid-fleet
        message = f"{type(exc).__name__}: {exc}"
        store.record_run(_finish_run(run, status="error", error=message))
        return SyncResult(
            program_id=revision.program.id,
            status="error",
            message=message,
            latency_ms=int((_now() - started).total_seconds() * 1000),
        )


def sync_program(
    store: Store,
    adapter: Adapter,
    ref: ProgramRef,
    *,
    force: bool = False,
    notifier: SlackNotifier | None = None,
    alert_min_score: int = 25,
) -> SyncResult:
    started = _now()
    try:
        revision = adapter.fetch(ref)
    except AdapterError as exc:
        run = SourceRun(
            id=_run_id(),
            platform=adapter.platform,
            target=ref.handle,
            started_at=started,
            finished_at=_now(),
            status="error",
            error=str(exc),
            latency_ms=int((_now() - started).total_seconds() * 1000),
        )
        store.record_run(run)
        return SyncResult(
            program_id=program_id(adapter.platform, ref.handle),
            status="error",
            message=str(exc),
            latency_ms=run.latency_ms,
        )
    return sync_revision(
        store,
        ref,
        revision,
        force=force,
        notifier=notifier,
        alert_min_score=alert_min_score,
    )


def sync_many(
    store: Store,
    adapter: Adapter,
    refs: list[ProgramRef],
    *,
    force: bool = False,
    notifier: SlackNotifier | None = None,
    alert_min_score: int = 25,
) -> list[SyncResult]:
    results: list[SyncResult] = []
    for ref in refs:
        results.append(
            sync_program(
                store,
                adapter,
                ref,
                force=force,
                notifier=notifier,
                alert_min_score=alert_min_score,
            )
        )
        time.sleep(0.3)
    return results
