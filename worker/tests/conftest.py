from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

WORKER = Path(__file__).resolve().parents[1]
if str(WORKER) not in sys.path:
    sys.path.insert(0, str(WORKER))

from app.adapters.base import ProgramRef, RawRevision, program_id
from app.models import AssetAttrs, Program, RawAsset, ScopeGroup
from app.normalize.canonical import build_snapshot
from app.pipeline.store import JsonStore

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture()
def store(tmp_path: Path) -> JsonStore:
    return JsonStore(tmp_path / "store.json")


@pytest.fixture()
def demo_store() -> JsonStore:
    root = Path(__file__).resolve().parents[2]
    return JsonStore(None, demo_path=root / "data" / "demo.json")


def raw(
    target: str,
    *,
    family: str = "web",
    kind: str = "in",
    name: str | None = None,
    source_ids: list[str] | None = None,
    group: ScopeGroup | None = None,
    **attrs,
) -> RawAsset:
    return RawAsset(
        family=family,
        kind=kind,  # type: ignore[arg-type]
        target=target,
        name=name,
        source_ids=source_ids or [],
        group=group,
        attrs=AssetAttrs(**attrs),
    )


def snapshot(
    rows: list[RawAsset],
    *,
    version: int = 1,
    program: str = "p1",
    complete: bool = True,
):
    return build_snapshot(
        program,
        rows,
        version=version,
        captured_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        source_revision_id=f"rev-{version}",
        complete=complete,
    )


def make_revision(
    rows: list[RawAsset],
    *,
    handle: str = "acme-cloud",
    revision_id: str = "rev-1",
    complete: bool = True,
    published: datetime | None = None,
) -> RawRevision:
    pid = program_id("sandbox", handle)
    program = Program(
        id=pid,
        platform="sandbox",
        handle=handle,
        name="Acme Cloud (Sandbox)",
        url="https://example.com/sandbox/acme-cloud",
        offers_bounties=True,
        max_bounty=8000,
    )
    return RawRevision(
        program=program,
        assets=rows,
        source_revision_id=revision_id,
        source_published_at=published or datetime(2026, 1, 1, tzinfo=timezone.utc),
        source_url=f"https://example.com/sandbox/acme-cloud/revisions/{revision_id}",
        complete=complete,
    )


class FakeAdapter:
    platform = "sandbox"

    def __init__(self, revisions: list[RawRevision]):
        self.revisions = revisions
        self.index = 0

    def list_programs(self, limit: int = 50) -> list[ProgramRef]:
        return [
            ProgramRef(platform=self.platform, handle=f"fixture-{i}")
            for i in range(min(limit, len(self.revisions)))
        ]

    def fetch(self, ref: ProgramRef) -> RawRevision:
        revision = self.revisions[min(self.index, len(self.revisions) - 1)]
        self.index += 1
        return revision
