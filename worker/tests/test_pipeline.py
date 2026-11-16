from __future__ import annotations

from pathlib import Path

from app.adapters.fixture import FixtureAdapter
from app.adapters.base import ProgramRef
from app.pipeline.store import JsonStore
from app.pipeline.sync import sync_program, sync_revision

from conftest import FakeAdapter, make_revision, raw

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def test_baseline_then_changed(store: JsonStore) -> None:
    adapter = FakeAdapter(
        [
            make_revision(
                [
                    raw("a.example"),
                    raw(
                        "b.example",
                        family="api",
                        bounty_eligible=True,
                        bounty_tier="Tier 1",
                    ),
                ],
                revision_id="r1",
            )
        ]
    )
    ref = ProgramRef(platform="sandbox", handle="acme-cloud")
    baseline = sync_program(store, adapter, ref)
    assert baseline.status == "baseline"
    program = store.get_program(baseline.program_id)
    assert program is not None
    assert program.current_version == 1
    assert program.scope_counts.total == 2

    adapter.revisions.append(
        make_revision(
            [
                raw("a.example"),
                raw("b.example", family="api", bounty_eligible=False),
                raw("c.example", family="wildcard"),
            ],
            revision_id="r2",
        )
    )
    changed = sync_program(store, adapter, ref)
    assert changed.status == "changed", changed.message
    program = store.get_program(baseline.program_id)
    assert program is not None
    assert program.current_version == 2
    assert program.scope_counts.in_scope == 3
    change = store.get_change(changed.change_id or "")
    assert change is not None
    assert change.counts.total == 2
    assert len(store.get_items(change.id)) == 2


def test_unchanged_revision_does_not_create_a_version(store: JsonStore) -> None:
    rows = [raw("a.example"), raw("b.example")]
    adapter = FakeAdapter([make_revision(rows, revision_id="r1")])
    ref = ProgramRef(platform="sandbox", handle="acme-cloud")
    baseline = sync_program(store, adapter, ref)
    unchanged = sync_program(store, adapter, ref)
    assert unchanged.status == "unchanged"
    program = store.get_program(baseline.program_id)
    assert program is not None
    assert program.current_version == 1
    assert len(store.list_versions(program.id)) == 1


def test_truncation_gate_requires_two_strikes(store: JsonStore) -> None:
    big = [raw(f"host{i}.example") for i in range(6)]
    tiny = [raw("host0.example")]
    revisions = [
        make_revision(big, revision_id="r1"),
        make_revision(tiny, revision_id="r2"),
        make_revision(tiny, revision_id="r2"),
    ]
    adapter = FakeAdapter(revisions)
    ref = ProgramRef(platform="sandbox", handle="acme-cloud")
    baseline = sync_program(store, adapter, ref)
    pid = baseline.program_id

    first = sync_program(store, adapter, ref)
    assert first.status == "review"
    assert store.get_program(pid).current_version == 1  # type: ignore[union-attr]
    assert store.get_pending(pid) is not None

    second = sync_program(store, adapter, ref)
    assert second.status == "changed", second.message
    program = store.get_program(pid)
    assert program is not None
    assert program.current_version == 2
    change = store.get_change(second.change_id or "")
    assert change is not None
    assert any("Confirmed on second identical fetch" in reason for reason in change.reasons)
    assert store.get_pending(pid) is None


def test_partial_fetch_marks_low_confidence(store: JsonStore) -> None:
    adapter = FakeAdapter(
        [
            make_revision([raw("a.example")], revision_id="r1"),
            make_revision(
                [raw("a.example"), raw("b.example")],
                revision_id="r2",
                complete=False,
            ),
        ]
    )
    ref = ProgramRef(platform="sandbox", handle="acme-cloud")
    sync_program(store, adapter, ref)
    changed = sync_program(store, adapter, ref)
    assert changed.status == "changed"
    change = store.get_change(changed.change_id or "")
    assert change is not None
    assert change.confidence == "low"


def test_force_bypasses_truncation_gate(store: JsonStore) -> None:
    big = [raw(f"host{i}.example") for i in range(6)]
    tiny = [raw("host0.example")]
    adapter = FakeAdapter(
        [make_revision(big, revision_id="r1"), make_revision(tiny, revision_id="r2")]
    )
    ref = ProgramRef(platform="sandbox", handle="acme-cloud")
    sync_program(store, adapter, ref)
    forced = sync_program(store, adapter, ref, force=True)
    assert forced.status == "changed"
    change = store.get_change(forced.change_id or "")
    assert change is not None
    assert any("forced" in reason.lower() for reason in change.reasons)


def test_fixture_simulator_produces_v8(store: JsonStore) -> None:
    adapter = FixtureAdapter(FIXTURE_DIR)
    ref7 = ProgramRef(platform="sandbox", handle="acme_v7", meta={"path": str(FIXTURE_DIR / "acme_v7.json")})
    baseline = sync_revision(store, ref7, adapter.fetch(ref7))
    assert baseline.status == "baseline"
    ref8 = ProgramRef(platform="sandbox", handle="acme_v8", meta={"path": str(FIXTURE_DIR / "acme_v8.json")})
    changed = sync_revision(
        store, ref8, adapter.fetch(ref8), is_simulation=True
    )
    assert changed.status == "changed", changed.message
    change = store.get_change(changed.change_id or "")
    assert change is not None
    assert change.is_simulation is True
    assert change.counts.added == 2
    assert change.counts.removed == 1
    assert change.counts.modified == 1
    assert len(store.get_items(change.id)) == 4
    assert change.materiality_score >= 75
