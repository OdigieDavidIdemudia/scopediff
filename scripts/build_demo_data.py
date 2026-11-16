"""Build the deterministic ScopeDiff demo dataset.

This script is the single source of truth for the demo. It runs real snapshots
through the real normaliser and diff engine, then writes:

  data/demo.json                 web demo data (v8 is hidden until simulated)
  worker/tests/fixtures/*.json   raw revisions used by the simulator/tests
  worker/.data/store.json        worker store (current state is v7)

Run from the repo root:

  python scripts/build_demo_data.py

Every target uses RFC 2606 (.example) or RFC 5737 (192.0.2.0/24) reserved values.
"""

from __future__ import annotations

import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "worker"))

from app.adapters.base import program_id  # noqa: E402
from app.diff.engine import diff_snapshots  # noqa: E402
from app.models import (  # noqa: E402
    Change,
    PlatformStatus,
    Program,
    RawAsset,
    SourceRef,
    SourceRun,
    Version,
)  # noqa: E402
from app.normalize.canonical import build_snapshot  # noqa: E402

GROUP_IDS = {
    "Core web": "grp-core",
    "API": "grp-api",
    "Legacy": "grp-legacy",
    "Mobile": "grp-mobile",
    "Source": "grp-source",
    "Staging": "grp-staging",
    "Out of scope": "grp-out",
    "Platform": "grp-platform",
    "Directory": "grp-directory",
    "Mobile apps": "grp-mobile-apps",
}


def dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _slug(value: str) -> str:
    return (
        value.lower()
        .replace("https://", "")
        .replace("http://", "")
        .replace("*", "wildcard")
        .replace("/", "-")
        .replace(".", "-")
        .replace(":", "-")
    )


def asset(
    target: str,
    family: str,
    *,
    kind: str = "in",
    name: str | None = None,
    group: str = "Core web",
    tier: str = "Tier 2",
    max_bounty: int = 4000,
    bounty: bool = True,
    instruction: str | None = None,
    tags: list[str] | None = None,
    prefix: str = "acme",
) -> dict:
    in_scope = kind == "in"
    return {
        "family": family,
        "kind": kind,
        "target": target,
        "name": name,
        "source_ids": [f"{prefix}-{_slug(target)}"],
        "group": {
            "id": GROUP_IDS.get(group, f"grp-{_slug(group)}"),
            "name": group,
            "in_scope": in_scope,
            "tier": None,
        },
        "attrs": {
            "bounty_eligible": bool(bounty and in_scope),
            "bounty_tier": tier if in_scope and bounty else None,
            "max_bounty": max_bounty if in_scope and bounty else None,
            "currency": "USD" if in_scope and bounty else None,
            "max_severity": "critical" if in_scope else None,
            "instruction": instruction,
            "tags": tags or [family],
        },
    }


def find(rows: list[dict], target: str) -> dict:
    for row in rows:
        if row["target"] == target:
            return row
    raise KeyError(target)


def remove(rows: list[dict], target: str) -> None:
    rows[:] = [row for row in rows if row["target"] != target]


def base_acme() -> list[dict]:
    return [
        asset("www.acme.example", "web", name="Marketing site", tier="Tier 2", max_bounty=4000),
        asset("admin.acme.example", "web", name="Admin console", tier="Tier 1", max_bounty=10000),
        asset("api.acme.example", "api", name="Public API", group="API", tier="Tier 1", max_bounty=8000),
        asset("*.acme.example", "wildcard", name="Production wildcard", group="API", tier="Tier 1", max_bounty=8000),
        asset("legacy.acme.example", "web", name="Legacy portal", group="Legacy", tier="Tier 3", max_bounty=1000),
        asset("192.0.2.10", "ip", name="Edge host", group="Platform", tier="Tier 2", max_bounty=4000),
        asset("com.acme.cloud", "mobile_android", name="Acme Cloud for Android", group="Mobile", tier="Tier 2", max_bounty=3000),
        asset("1234567890", "mobile_ios", name="Acme Cloud for iOS", group="Mobile", tier="Tier 2", max_bounty=3000),
        asset("https://github.com/acme/cloud-sdk", "source_code", name="Cloud SDK", group="Source", tier="Tier 3", max_bounty=500),
        asset("docs.acme.example", "web", kind="out", name="Docs (out of scope)", group="Out of scope"),
    ]


def acme_versions() -> list[dict]:
    rows = base_acme()
    versions: list[dict] = []

    versions.append(
        {
            "n": 1,
            "published_at": dt("2026-08-04T10:00:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Baseline",
        }
    )

    # v2 — a slow-burn change: status page added, API tier downgraded.
    rows = copy.deepcopy(rows)
    rows.append(
        asset(
            "status.acme.example",
            "web",
            name="Public status page",
            tier="Tier 3",
            max_bounty=500,
            bounty=False,
        )
    )
    find(rows, "api.acme.example")["attrs"].update(
        {"bounty_tier": "Tier 2", "max_bounty": 6000, "currency": "USD"}
    )
    versions.append(
        {
            "n": 2,
            "published_at": dt("2026-08-21T14:10:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Status page + API tier change",
        }
    )

    # v3 — two new web assets.
    rows = copy.deepcopy(rows)
    rows.append(asset("cdn.acme.example", "web", name="CDN origin", tier="Tier 2", max_bounty=2000))
    rows.append(asset("support.acme.example", "web", name="Support portal", tier="Tier 3", max_bounty=500))
    versions.append(
        {
            "n": 3,
            "published_at": dt("2026-09-08T11:30:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "CDN and support added",
        }
    )

    # v4 — reward ceilings raised (and a deliberately low-confidence capture).
    rows = copy.deepcopy(rows)
    find(rows, "*.acme.example")["attrs"]["max_bounty"] = 10000
    find(rows, "api.acme.example")["attrs"]["max_bounty"] = 9000
    versions.append(
        {
            "n": 4,
            "published_at": dt("2026-09-22T16:05:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Reward ceilings raised",
            "confidence": "low",
            "extra_reason": "Partial fetch — one page was retried",
        }
    )

    # v5 — IP retired, dashboard added.
    rows = copy.deepcopy(rows)
    remove(rows, "192.0.2.10")
    rows.append(asset("dashboard.acme.example", "web", name="Customer dashboard", tier="Tier 2", max_bounty=3000))
    versions.append(
        {
            "n": 5,
            "published_at": dt("2026-10-06T09:45:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Edge host retired, dashboard added",
        }
    )

    # v6 — status page becomes reward-eligible; www tier improves.
    rows = copy.deepcopy(rows)
    status = find(rows, "status.acme.example")
    status["attrs"].update(
        {
            "bounty_eligible": True,
            "bounty_tier": "Tier 2",
            "max_bounty": 1500,
            "currency": "USD",
        }
    )
    www = find(rows, "www.acme.example")
    www["attrs"].update({"bounty_tier": "Tier 1", "max_bounty": 5000})
    versions.append(
        {
            "n": 6,
            "published_at": dt("2026-10-19T13:20:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Status page reward + www tier",
        }
    )

    # v7 — partner portal added, API ceiling trimmed.
    rows = copy.deepcopy(rows)
    rows.append(asset("partner.acme.example", "web", name="Partner portal", tier="Tier 2", max_bounty=3000))
    find(rows, "api.acme.example")["attrs"]["max_bounty"] = 8000
    versions.append(
        {
            "n": 7,
            "published_at": dt("2026-11-02T10:15:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Partner portal + API ceiling",
        }
    )

    # v8 — the simulated change: staging expansion, legacy removal, wildcard downgrade.
    rows = copy.deepcopy(rows)
    rows.append(
        asset(
            "api.staging.acme.example",
            "api",
            name="Staging API",
            group="Staging",
            tier="Tier 2",
            max_bounty=3000,
            instruction="Use the seeded staging tenant. Never test production checkout.",
        )
    )
    rows.append(
        asset(
            "*.staging.acme.example",
            "wildcard",
            name="Staging wildcard",
            group="Staging",
            tier="Tier 1",
            max_bounty=5000,
            instruction="Staging only. Rate limit: 5 req/s.",
        )
    )
    remove(rows, "legacy.acme.example")
    wildcard = find(rows, "*.acme.example")
    wildcard["attrs"].update({"bounty_tier": "Tier 3", "max_bounty": 2000})
    versions.append(
        {
            "n": 8,
            "published_at": dt("2026-11-16T09:09:00Z"),
            "assets": copy.deepcopy(rows),
            "note": "Staging expansion + production wildcard downgrade",
            "simulated": True,
        }
    )
    return versions


def extra_programs() -> list[dict]:
    return [
        {
            "platform": "bugcrowd",
            "handle": "globex-demo",
            "name": "Globex API (Demo)",
            "industry": "Developer tools",
            "max_bounty": 10000,
            "assets": [
                asset("api.globex.example", "api", name="Globex API", group="API", tier="Tier 1", max_bounty=10000, prefix="globex"),
                asset("*.globex.example", "wildcard", name="Globex wildcard", group="API", tier="Tier 1", max_bounty=10000, prefix="globex"),
                asset("status.globex.example", "web", name="Status page", tier="Tier 3", max_bounty=500, prefix="globex"),
                asset("198.51.100.0/24", "cidr", name="Edge range", group="Platform", tier="Tier 2", max_bounty=2000, prefix="globex"),
                asset("docs.globex.example", "web", kind="out", name="Docs", group="Out of scope", prefix="globex"),
            ],
        },
        {
            "platform": "hackerone",
            "handle": "initech-demo",
            "name": "Initech Mobile (Demo)",
            "industry": "Fintech",
            "max_bounty": 6000,
            "assets": [
                asset("com.initech.app", "mobile_android", name="Initech for Android", group="Mobile apps", tier="Tier 2", max_bounty=4000, prefix="initech"),
                asset("987654321", "mobile_ios", name="Initech for iOS", group="Mobile apps", tier="Tier 2", max_bounty=4000, prefix="initech"),
                asset("api.initech.example", "api", name="Initech API", group="API", tier="Tier 1", max_bounty=6000, prefix="initech"),
                asset("*.initech.example", "wildcard", name="Initech wildcard", group="API", tier="Tier 1", max_bounty=6000, prefix="initech"),
            ],
        },
        {
            "platform": "intigriti",
            "handle": "umbrella-labs-demo",
            "name": "Umbrella Labs (Demo)",
            "industry": "Security",
            "max_bounty": 3000,
            "assets": [
                asset("portal.umbrella.example", "web", name="Research portal", group="Core web", tier="Tier 2", max_bounty=3000, prefix="umbrella"),
                asset("*.umbrella.example", "wildcard", name="Research wildcard", group="Core web", tier="Tier 2", max_bounty=3000, prefix="umbrella"),
                asset("github.com/umbrella/lab", "source_code", name="Lab tooling", group="Source", tier="Tier 3", max_bounty=500, prefix="umbrella"),
                asset("portal.umbrella.example/admin", "web", name="Admin surface", group="Core web", tier="Tier 3", max_bounty=1000, prefix="umbrella"),
            ],
        },
    ]


def build_snapshot_for(program: Program, rows: list[dict], version: int, published: datetime, detected: datetime, confidence: str = "high"):
    return build_snapshot(
        program.id,
        [RawAsset(**row) for row in rows],
        version=version,
        captured_at=detected,
        source_revision_id=f"rev-{version}",
        source_published_at=published,
        source_url=f"{program.url}/revisions/{version}",
        complete=confidence == "high",
    )


def main() -> None:
    now = dt("2026-11-16T10:00:00Z")
    sandbox_handle = "acme-cloud"
    sandbox_id = program_id("sandbox", sandbox_handle)
    sandbox_url = "https://example.com/sandbox/acme-cloud"
    sandbox_program = Program(
        id=sandbox_id,
        platform="sandbox",
        handle=sandbox_handle,
        name="Acme Cloud (Sandbox)",
        url=sandbox_url,
        status="open",
        industry="Cloud infrastructure",
        offers_bounties=True,
        currency="USD",
        min_bounty=100,
        max_bounty=10000,
        tags=["sandbox", "cloud", "api"],
        first_seen_at=dt("2026-08-04T10:06:00Z"),
        last_checked_at=dt("2026-11-16T08:45:00Z"),
    )

    versions = acme_versions()
    snapshots = []
    changes = []
    all_items = []
    versions_out = []
    seen_keys: set[str] = set()
    previous = None

    for row in versions:
        n = row["n"]
        published = row["published_at"]
        detected = published + timedelta(minutes=6)
        confidence = row.get("confidence", "high")
        snapshot = build_snapshot_for(
            sandbox_program, row["assets"], n, published, detected, confidence
        )
        snapshots.append(snapshot)
        if n <= 7:
            versions_out.append(
                Version(
                    program_id=sandbox_id,
                    version=n,
                    hash=snapshot.hash,
                    captured_at=detected,
                    source_revision_id=f"rev-{n}",
                    source_published_at=published,
                    source_url=f"{sandbox_url}/revisions/{n}",
                    is_baseline=n == 1,
                    confidence=confidence,
                    counts=snapshot.counts,
                    change_id=None if n == 1 else f"{sandbox_id}__v{n}",
                )
            )
        if previous is not None:
            change_id = f"{sandbox_id}__v{n}"
            diff = diff_snapshots(previous, snapshot, change_id, ever_seen_keys=seen_keys)
            reasons = list(diff.reasons)
            if row.get("extra_reason"):
                reasons.insert(0, row["extra_reason"])
            alert_status = "sent" if n >= 5 else "skipped"
            change = Change(
                id=change_id,
                program_id=sandbox_id,
                program_name=sandbox_program.name,
                platform="sandbox",
                program_url=sandbox_url,
                from_version=previous.version,
                to_version=n,
                detected_at=detected,
                source_published_at=published,
                source_revision_id=f"rev-{n}",
                source_url=f"{sandbox_url}/revisions/{n}",
                is_baseline=False,
                is_simulation=bool(row.get("simulated")),
                confidence=confidence,
                impact=diff.impact,
                magnitude=diff.magnitude,
                materiality_score=diff.materiality_score,
                reasons=reasons[:8],
                counts=diff.counts,
                status="ready",
                items_preview=diff.items[:3],
                items=[],
                alert_status=alert_status,
                alerted_at=detected + timedelta(minutes=1) if alert_status == "sent" else None,
            )
            payload = change.model_dump(mode="json")
            if row.get("simulated"):
                payload["hidden"] = True
            changes.append(payload)
            all_items.extend(item.model_dump(mode="json") for item in diff.items)
        seen_keys.update(a.key for a in snapshot.assets)
        previous = snapshot

    current = snapshots[6]  # v7
    sandbox_program = sandbox_program.model_copy(
        update={
            "current_version": 7,
            "current_hash": current.hash,
            "scope_counts": current.counts,
            "last_changed_at": dt("2026-11-02T10:21:00Z"),
            "source": SourceRef(
                adapter="sandbox",
                revision_id="rev-7",
                published_at=dt("2026-11-02T10:15:00Z"),
                fetched_at=dt("2026-11-16T08:45:00Z"),
                url=f"{sandbox_url}/revisions/7",
            ),
        }
    )

    programs_out = [sandbox_program]
    snapshots_out = list(snapshots)
    versions_out = list(versions_out)

    for extra in extra_programs():
        pid = program_id(extra["platform"], extra["handle"])
        url = f"https://example.com/demo/{extra['handle']}"
        program = Program(
            id=pid,
            platform=extra["platform"],  # type: ignore[arg-type]
            handle=extra["handle"],
            name=extra["name"],
            url=url,
            status="open",
            industry=extra["industry"],
            offers_bounties=True,
            currency="USD",
            min_bounty=100,
            max_bounty=extra["max_bounty"],
            tags=["demo"],
            current_version=1,
            current_hash="",
            first_seen_at=dt("2026-10-01T09:00:00Z"),
            last_checked_at=dt("2026-11-16T08:40:00Z"),
            source=SourceRef(
                adapter=extra["platform"],
                revision_id="seed-1",
                published_at=dt("2026-10-01T08:55:00Z"),
                fetched_at=dt("2026-11-16T08:40:00Z"),
                url=f"{url}/revisions/1",
            ),
        )
        snapshot = build_snapshot(
            pid,
            [RawAsset(**row) for row in extra["assets"]],
            version=1,
            captured_at=dt("2026-10-01T09:00:00Z"),
            source_revision_id="seed-1",
            source_published_at=dt("2026-10-01T08:55:00Z"),
            source_url=f"{url}/revisions/1",
            complete=True,
        )
        program = program.model_copy(
            update={"current_hash": snapshot.hash, "scope_counts": snapshot.counts}
        )
        programs_out.append(program)
        snapshots_out.append(snapshot)
        versions_out.append(
            Version(
                program_id=pid,
                version=1,
                hash=snapshot.hash,
                captured_at=dt("2026-10-01T09:00:00Z"),
                source_revision_id="seed-1",
                source_published_at=dt("2026-10-01T08:55:00Z"),
                source_url=f"{url}/revisions/1",
                is_baseline=True,
                confidence="high",
                counts=snapshot.counts,
                change_id=None,
            )
        )

    runs = [
        SourceRun(
            id="run_seed_bugcrowd",
            platform="bugcrowd",
            target="directory",
            started_at=dt("2026-11-16T08:40:00Z"),
            finished_at=dt("2026-11-16T08:40:01Z"),
            status="ok",
            programs_seen=2,
            programs_changed=0,
            assets_seen=9,
            latency_ms=430,
            notes=["Demo seed"],
        ),
        SourceRun(
            id="run_seed_hackerone",
            platform="hackerone",
            target="directory",
            started_at=dt("2026-11-16T08:41:00Z"),
            finished_at=dt("2026-11-16T08:41:01Z"),
            status="ok",
            programs_seen=1,
            programs_changed=0,
            assets_seen=4,
            latency_ms=610,
            notes=["Demo seed"],
        ),
        SourceRun(
            id="run_seed_intigriti",
            platform="intigriti",
            target="directory",
            started_at=dt("2026-11-16T08:42:00Z"),
            finished_at=dt("2026-11-16T08:42:01Z"),
            status="ok",
            programs_seen=1,
            programs_changed=0,
            assets_seen=4,
            latency_ms=520,
            notes=["Demo seed"],
        ),
        SourceRun(
            id="run_seed_sandbox",
            platform="sandbox",
            target="acme-cloud",
            started_at=dt("2026-11-16T08:45:00Z"),
            finished_at=dt("2026-11-16T08:45:01Z"),
            status="ok",
            programs_seen=1,
            programs_changed=0,
            assets_seen=current.counts.total,
            latency_ms=8,
            notes=["Demo seed"],
        ),
    ]

    platforms = [
        PlatformStatus(
            id="bugcrowd",
            name="Bugcrowd",
            status="ok",
            last_run_at=dt("2026-11-16T08:40:01Z"),
            programs_count=1,
            latency_ms=430,
            message="Demo snapshot · 1 program",
        ),
        PlatformStatus(
            id="hackerone",
            name="HackerOne",
            status="ok",
            last_run_at=dt("2026-11-16T08:41:01Z"),
            programs_count=1,
            latency_ms=610,
            message="Demo snapshot · 1 program",
        ),
        PlatformStatus(
            id="intigriti",
            name="Intigriti",
            status="ok",
            last_run_at=dt("2026-11-16T08:42:01Z"),
            programs_count=1,
            latency_ms=520,
            message="Demo snapshot · 1 program",
        ),
        PlatformStatus(
            id="sandbox",
            name="Sandbox",
            status="ok",
            last_run_at=dt("2026-11-16T08:45:01Z"),
            programs_count=1,
            latency_ms=8,
            message="Sandbox · current revision v7",
        ),
    ]

    demo = {
        "meta": {
            "title": "ScopeDiff demo dataset",
            "generated_at": iso(now),
            "demo": True,
            "sandbox": True,
            "note": "All targets use RFC 2606 reserved domains and RFC 5737 test ranges. The three platform programs are seeded examples, not live programs.",
        },
        "viewer": {
            "name": "Demo Hunter",
            "handle": "demo",
            "testing": ["api.acme.example", "*.acme.example", "com.acme.cloud"],
            "watchlist": [sandbox_id, program_id("hackerone", "initech-demo")],
        },
        "platforms": [p.model_dump(mode="json") for p in platforms],
        "programs": [p.model_dump(mode="json") for p in programs_out],
        "versions": [v.model_dump(mode="json") for v in versions_out],
        "snapshots": [s.model_dump(mode="json") for s in snapshots_out],
        "changes": changes,
        "items": all_items,
        "runs": [r.model_dump(mode="json") for r in runs],
    }

    demo_path = ROOT / "data" / "demo.json"
    demo_path.parent.mkdir(parents=True, exist_ok=True)
    demo_path.write_text(json.dumps(demo, indent=2, ensure_ascii=False), encoding="utf-8")

    # Raw fixtures used by the simulator and the tests (v7 is current, v8 is next).
    fixture_dir = ROOT / "worker" / "tests" / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    for n, filename in ((7, "acme_v7.json"), (8, "acme_v8.json")):
        row = next(r for r in versions if r["n"] == n)
        payload = {
            "program": {
                "name": sandbox_program.name,
                "handle": sandbox_handle,
                "url": sandbox_url,
                "status": "open",
                "industry": sandbox_program.industry,
                "offers_bounties": True,
                "currency": "USD",
                "min_bounty": 100,
                "max_bounty": 10000,
                "tags": ["sandbox", "cloud", "api"],
            },
            "assets": row["assets"],
            "source": {
                "revision_id": f"rev-{n}",
                "published_at": iso(row["published_at"]),
                "url": f"{sandbox_url}/revisions/{n}",
            },
            "complete": row.get("confidence", "high") == "high",
            "notes": [row["note"]],
        }
        (fixture_dir / filename).write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    # Worker store: current state is v7. Hidden v8 remains web-only until the
    # simulator publishes it, so the first diff is "added", not "reintroduced".
    worker_store = {
        "programs": {p.id: p.model_dump(mode="json") for p in programs_out},
        "versions": {},
        "snapshots": {},
        "changes": {
            c["id"]: c for c in changes if not c.get("hidden")
        },
        "items": {},
        "pending": {},
        "runs": [r.model_dump(mode="json") for r in runs],
    }
    for version in versions_out:
        worker_store["versions"].setdefault(version.program_id, {})[
            str(version.version)
        ] = version.model_dump(mode="json")
    for snapshot in snapshots_out:
        allowed = worker_store["versions"].get(snapshot.program_id, {})
        if str(snapshot.version) not in allowed:
            continue
        worker_store["snapshots"].setdefault(snapshot.program_id, {})[
            str(snapshot.version)
        ] = snapshot.model_dump(mode="json")
    for item in all_items:
        worker_store["items"].setdefault(item["change_id"], []).append(item)
    store_path = ROOT / "worker" / ".data" / "store.json"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text(
        json.dumps(worker_store, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"wrote {demo_path} ({demo_path.stat().st_size:,} bytes)")
    print(f"wrote {store_path} ({store_path.stat().st_size:,} bytes)")
    print(f"wrote {fixture_dir / 'acme_v7.json'}")
    print(f"wrote {fixture_dir / 'acme_v8.json'}")
    print(
        f"programs={len(programs_out)} versions={len(versions_out)} "
        f"snapshots={len(snapshots_out)} changes={len(changes)} items={len(all_items)}"
    )


if __name__ == "__main__":
    main()
