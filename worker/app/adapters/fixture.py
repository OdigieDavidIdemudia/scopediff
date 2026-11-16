from __future__ import annotations

import json
from pathlib import Path

from app.adapters.base import AdapterError, ProgramRef, RawRevision, parse_datetime, program_id
from app.models import AssetAttrs, Program, RawAsset, ScopeGroup

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


class FixtureAdapter:
    """Loads a deterministic raw revision from a JSON fixture.

    Used by the demo simulator and the test suite, never by production sync.
    """

    platform = "sandbox"

    def __init__(self, fixture_dir: Path | None = None):
        self.fixture_dir = fixture_dir or FIXTURE_DIR

    def list_programs(self, limit: int = 50) -> list[ProgramRef]:
        refs: list[ProgramRef] = []
        for path in sorted(self.fixture_dir.glob("*.json")):
            if ".snapshot." in path.name:
                continue
            refs.append(
                ProgramRef(
                    platform=self.platform,
                    handle=path.stem,
                    meta={"path": str(path)},
                )
            )
            if len(refs) >= limit:
                break
        return refs

    def fetch(self, ref: ProgramRef) -> RawRevision:
        path_value = ref.meta.get("path") or str(self.fixture_dir / f"{ref.handle}.json")
        path = Path(path_value)
        if not path.exists():
            raise AdapterError(f"Fixture not found: {path}")
        payload = json.loads(path.read_text(encoding="utf-8"))
        program_data = payload.get("program") or {}
        handle = program_data.get("handle") or ref.handle
        program = Program(
            id=program_id(self.platform, handle),
            platform="sandbox",
            handle=handle,
            name=program_data.get("name") or ref.name or handle,
            url=program_data.get("url") or f"https://example.com/{handle}",
            status=program_data.get("status") or "open",
            industry=program_data.get("industry"),
            offers_bounties=program_data.get("offers_bounties", False),
            currency=program_data.get("currency") or "USD",
            min_bounty=program_data.get("min_bounty"),
            max_bounty=program_data.get("max_bounty"),
            tags=program_data.get("tags") or ["sandbox"],
        )
        assets: list[RawAsset] = []
        for row in payload.get("assets") or []:
            group = row.get("group")
            assets.append(
                RawAsset(
                    family=row.get("family") or "other",
                    kind=row.get("kind") or "in",
                    target=row.get("target") or "",
                    name=row.get("name"),
                    source_ids=row.get("source_ids") or [],
                    group=ScopeGroup(**group) if group else None,
                    attrs=AssetAttrs(**(row.get("attrs") or {})),
                    raw=row,
                )
            )
        source = payload.get("source") or {}
        return RawRevision(
            program=program,
            assets=assets,
            source_revision_id=source.get("revision_id"),
            source_published_at=parse_datetime(source.get("published_at")),
            source_url=source.get("url") or program.url,
            complete=payload.get("complete", True),
            notes=payload.get("notes") or [],
            raw=payload,
        )
