from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEMO = ROOT / "data" / "demo.json"


def load() -> dict:
    return json.loads(DEMO.read_text(encoding="utf-8"))


def test_demo_shape_and_sandbox_state() -> None:
    demo = load()
    assert demo["meta"]["demo"] is True
    assert len(demo["programs"]) == 4
    assert len(demo["versions"]) == 10
    assert len(demo["snapshots"]) == 11
    assert len(demo["changes"]) == 7
    assert len(demo["items"]) == 16
    sandbox = next(p for p in demo["programs"] if p["id"] == "sandbox__acme-cloud")
    assert sandbox["current_version"] == 7
    assert sandbox["scope_counts"]["in_scope"] == 13
    assert sandbox["scope_counts"]["out_of_scope"] == 1


def test_v8_is_hidden_until_simulated() -> None:
    demo = load()
    v8 = next(c for c in demo["changes"] if c["id"].endswith("__v8"))
    assert v8["hidden"] is True
    assert v8["is_simulation"] is True
    assert v8["counts"] == {
        "added": 2,
        "removed": 1,
        "reintroduced": 0,
        "modified": 1,
        "moved_in": 0,
        "moved_out": 0,
        "total": 4,
    }
    assert v8["materiality_score"] >= 75
    assert v8["impact"] == "mixed"
    assert len(v8["items_preview"]) == 3

    v8_snapshot = next(
        s for s in demo["snapshots"] if s["program_id"] == "sandbox__acme-cloud" and s["version"] == 8
    )
    assert v8_snapshot["counts"]["in_scope"] == 14
    assert v8_snapshot["counts"]["total"] == 15

    items = [i for i in demo["items"] if i["change_id"] == v8["id"]]
    assert len(items) == 4
    displays = {i["display"] for i in items}
    assert "Staging wildcard" in displays
    assert "Staging API" in displays
    assert "Legacy portal" in displays
    assert "Production wildcard" in displays


def test_every_item_belongs_to_a_change() -> None:
    demo = load()
    change_ids = {c["id"] for c in demo["changes"]}
    assert all(i["change_id"] in change_ids for i in demo["items"])
    for change in demo["changes"]:
        item_count = sum(1 for i in demo["items"] if i["change_id"] == change["id"])
        assert item_count == change["counts"]["total"]


def test_reserved_demo_values() -> None:
    demo = load()
    text = json.dumps(demo)
    assert "nubank" not in text.lower()
    assert "hackerone.com/" not in text.lower()
    assert "bugcrowd.com/" not in text.lower()
    assert "intigriti.com/" not in text.lower()
    # The sandbox is explicitly a demo, not a real program.
    sandbox = next(p for p in demo["programs"] if p["id"] == "sandbox__acme-cloud")
    assert "sandbox" in sandbox["name"].lower()
    assert sandbox["url"].startswith("https://example.com/")
