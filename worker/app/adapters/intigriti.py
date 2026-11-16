from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.adapters.base import (
    AdapterError,
    ProgramRef,
    RawRevision,
    parse_datetime,
    program_id,
)
from app.adapters.http import FetchError, HttpClient
from app.models import AssetAttrs, Program, RawAsset, ScopeGroup

BASE = "https://app.intigriti.com"
USER_AGENT = "ScopeDiff/0.1 (scope-change watcher; contact: scopediff@example.com)"

# Intigriti's public API exposes numeric type ids. These are the values we have
# observed on public programs; the family is also inferred from the target when
# the id is unknown.
TYPE_MAP = {
    1: "web",
    2: "mobile_android",
    3: "mobile_ios",
    4: "ip",
    5: "hardware",
    6: "source_code",
    7: "wildcard",
    8: "other",
    9: "other",
}

TIER_LABELS = {1: "Tier 1", 2: "Tier 2", 3: "Tier 3", 4: "Tier 4", 5: "No bounty"}


def _created_at(value: Any) -> datetime | None:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        if value.isdigit():
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        return parse_datetime(value)
    return None


def _family(type_id: Any, name: str) -> str:
    mapped = TYPE_MAP.get(type_id if isinstance(type_id, int) else int(type_id or 0))
    if mapped and mapped != "other":
        return mapped
    low = name.lower()
    if low.startswith("*.") or "*" in low:
        return "wildcard"
    if "play.google.com" in low or low.startswith(("com.", "io.", "org.", "net.")):
        return "mobile_android"
    if "apps.apple.com" in low or low.isdigit():
        return "mobile_ios"
    if "github.com" in low or "gitlab.com" in low:
        return "source_code"
    return "web"


class IntigritiAdapter:
    platform = "intigriti"

    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient(user_agent=USER_AGENT)

    def list_programs(self, limit: int = 50) -> list[ProgramRef]:
        # Intigriti does not publish a stable zero-credential directory endpoint.
        # The worker accepts explicit company/program handles for v1.
        return []

    def fetch(self, ref: ProgramRef) -> RawRevision:
        handle = ref.handle.strip().strip("/")
        if "/" not in handle:
            raise AdapterError(
                "Intigriti handles must be in company/program form, e.g. cmcom/cmcom"
            )
        company, program_handle = handle.split("/", 1)
        url = f"{BASE}/api/core/public/programs/{company}/{program_handle}"
        try:
            payload = self.http.get_json(url)
        except FetchError as exc:
            raise AdapterError(f"Intigriti fetch failed for {handle}: {exc}") from exc

        collection = payload.get("assetsCollection") or []
        if not collection:
            raise AdapterError(f"Intigriti program {handle} has no asset revisions")
        revision = max(collection, key=lambda r: r.get("createdAt") or 0)
        content = revision.get("content") or {}
        raw_assets = content.get("assetsAndGroups") or []
        if not raw_assets:
            raise AdapterError(f"Intigriti program {handle} revision has no assets")

        metadata = {
            str(m.get("assetId")): m.get("source")
            for m in (payload.get("assetsMetadata") or [])
            if m.get("assetId")
        }

        assets: list[RawAsset] = []
        groups: list[ScopeGroup] = []
        for entry in raw_assets:
            children = entry.get("assets")
            if children:
                group = ScopeGroup(
                    id=str(entry.get("id") or entry.get("name") or "group"),
                    name=(entry.get("name") or "Scope").strip(),
                    in_scope=True,
                )
                groups.append(group)
                for child in children:
                    item = self._asset(child, metadata, group)
                    if item:
                        assets.append(item)
            else:
                item = self._asset(entry, metadata, None)
                if item:
                    assets.append(item)

        if not assets:
            raise AdapterError(f"Intigriti program {handle} produced no targets")

        created = _created_at(revision.get("createdAt"))
        program = Program(
            id=program_id(self.platform, handle),
            platform="intigriti",
            handle=handle,
            name=(payload.get("name") or ref.name or program_handle).strip(),
            url=f"{BASE}/programs/{company}/{program_handle}/detail",
            status=str(payload.get("status") or "open").lower(),
            industry=payload.get("industry"),
            offers_bounties=bool(payload.get("bountyTables")),
            currency="EUR",
            min_bounty=None,
            max_bounty=None,
            tags=[],
        )
        return RawRevision(
            program=program,
            assets=assets,
            source_revision_id=str(revision.get("createdAt") or ""),
            source_published_at=created,
            source_url=program.url,
            complete=True,
            notes=[f"{len(assets)} targets across {len(groups)} groups"],
            raw={"content": content, "program": {k: v for k, v in payload.items() if k not in {"assetsCollection", "description", "faqs", "rulesOfEngagements"}}},
        )

    def _asset(
        self,
        entry: dict[str, Any],
        metadata: dict[str, str | None],
        group: ScopeGroup | None,
    ) -> RawAsset | None:
        name = (entry.get("name") or "").strip()
        if not name:
            return None
        type_id = entry.get("typeId")
        family = _family(type_id, name)
        tier_id = entry.get("bountyTierId")
        tier = TIER_LABELS.get(tier_id) if isinstance(tier_id, int) else None
        source = metadata.get(str(entry.get("id"))) or metadata.get(
            str(entry.get("companyAssetId"))
        )
        display = name
        if family in {"mobile_android", "mobile_ios"} and source:
            display = source
        attrs = AssetAttrs(
            bounty_eligible=bool(tier and tier != "No bounty"),
            bounty_tier=tier,
            max_bounty=None,
            currency="EUR" if tier and tier != "No bounty" else None,
            max_severity=None,
            instruction=(entry.get("description") or None),
            tags=[],
        )
        return RawAsset(
            family=family,
            kind="in",
            target=name,
            name=display,
            source_ids=[
                str(value)
                for value in (entry.get("id"), entry.get("companyAssetId"))
                if value
            ],
            group=group,
            attrs=attrs,
            raw=entry,
        )
