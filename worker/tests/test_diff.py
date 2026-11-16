from __future__ import annotations

from app.diff.engine import diff_snapshots

from conftest import raw, snapshot


def test_added_removed_modified() -> None:
    previous = snapshot(
        [
            raw("a.example", bounty_eligible=True, bounty_tier="Tier 2"),
            raw("b.example", family="api", bounty_eligible=True, bounty_tier="Tier 1"),
        ],
        version=1,
    )
    current = snapshot(
        [
            raw("a.example", bounty_eligible=True, bounty_tier="Tier 2"),
            raw("b.example", family="api", bounty_eligible=False),
            raw("c.example", family="wildcard", bounty_eligible=True, bounty_tier="Tier 1"),
        ],
        version=2,
    )
    result = diff_snapshots(previous, current, "chg-1")
    assert result.counts.added == 1
    assert result.counts.modified == 1
    assert result.counts.removed == 0
    assert result.counts.total == 2
    assert result.materiality_score > 0
    assert result.impact in {"risk", "mixed", "opportunity"}
    kinds = {item.kind for item in result.items}
    assert kinds == {"added", "modified"}


def test_reorder_is_a_noop() -> None:
    a = [raw("a.example"), raw("b.example", family="api"), raw("c.example", family="wildcard")]
    b = [raw("c.example", family="wildcard"), raw("a.example"), raw("b.example", family="api")]
    result = diff_snapshots(snapshot(a, version=1), snapshot(b, version=2), "chg")
    assert result.items == []
    assert result.materiality_score == 0


def test_rename_rescue_uses_source_id() -> None:
    previous = snapshot(
        [raw("old.example", source_ids=["target-1"], name="Old")], version=1
    )
    current = snapshot(
        [raw("new.example", source_ids=["target-1"], name="New")], version=2
    )
    result = diff_snapshots(previous, current, "chg")
    assert result.counts.added == 0
    assert result.counts.removed == 0
    assert result.counts.modified == 1
    item = result.items[0]
    assert item.kind == "modified"
    assert any(f.field == "target" for f in item.fields)


def test_moved_out_of_scope() -> None:
    previous = snapshot([raw("a.example", bounty_eligible=True)], version=1)
    current = snapshot([raw("a.example", kind="out")], version=2)
    result = diff_snapshots(previous, current, "chg")
    assert result.counts.moved_out == 1
    item = result.items[0]
    assert item.kind == "moved_out"
    assert item.impact == "risk"
    assert item.materiality_score >= 50


def test_reintroduced() -> None:
    previous = snapshot([raw("a.example"), raw("b.example")], version=2)
    current = snapshot([raw("a.example"), raw("c.example")], version=3)
    result = diff_snapshots(
        previous,
        current,
        "chg",
        ever_seen_keys={"web|https://a.example", "web|https://c.example"},
    )
    assert result.counts.reintroduced == 1
    assert result.counts.added == 0
    assert any(i.kind == "reintroduced" for i in result.items)


def test_baseline_style_all_added() -> None:
    previous = snapshot([], version=0)
    current = snapshot([raw("a.example"), raw("b.example")], version=1)
    result = diff_snapshots(previous, current, "chg")
    assert result.counts.added == 2
    assert result.counts.total == 2
    assert result.impact == "opportunity"


def test_bounty_loss_is_material() -> None:
    previous = snapshot(
        [raw("a.example", bounty_eligible=True, bounty_tier="Tier 1", max_bounty=5000)],
        version=1,
    )
    current = snapshot(
        [raw("a.example", bounty_eligible=False, bounty_tier="Tier 4", max_bounty=100)],
        version=2,
    )
    result = diff_snapshots(previous, current, "chg")
    item = result.items[0]
    assert item.impact == "risk"
    assert item.materiality_score >= 60
    assert any("bounty" in reason for reason in item.reasons)
    assert any(f.field == "bounty_eligible" for f in item.fields)


def test_group_rule_change_is_not_lost() -> None:
    from app.models import ScopeGroup

    previous = snapshot(
        [
            raw(
                "a.example",
                group=ScopeGroup(id="g1", name="Core", in_scope=True, tier="Tier 1"),
            )
        ],
        version=1,
    )
    current = snapshot(
        [
            raw(
                "a.example",
                group=ScopeGroup(id="g1", name="Core", in_scope=True, tier="Tier 3"),
            )
        ],
        version=2,
    )
    result = diff_snapshots(previous, current, "chg")
    assert result.counts.modified == 1
    assert any(f.field == "group_details" for f in result.items[0].fields)


def test_large_removal_is_risk_and_high_score() -> None:
    previous = snapshot([raw(f"host{i}.example") for i in range(6)], version=1)
    current = snapshot([raw("host0.example")], version=2)
    result = diff_snapshots(previous, current, "chg")
    assert result.counts.removed == 5
    assert result.impact == "risk"
    assert result.materiality_score >= 40
