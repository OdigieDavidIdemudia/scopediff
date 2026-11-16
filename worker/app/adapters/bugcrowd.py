from __future__ import annotations

import time
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

BASE = "https://bugcrowd.com"
USER_AGENT = "ScopeDiff/0.1 (scope-change watcher; contact: scopediff@example.com)"

FAMILY_MAP = {
    "website": "web",
    "web": "web",
    "api": "api",
    "android": "mobile_android",
    "ios": "mobile_ios",
    "ip_address": "ip",
    "ip": "ip",
    "network": "cidr",
    "cidr": "cidr",
    "hardware": "hardware",
    "source_code": "source_code",
    "source": "source_code",
    "wildcard": "wildcard",
    "other": "other",
}


def _family(category: str | None, value: str) -> str:
    hint = (category or "").lower()
    if "*" in value and hint in {"website", "api", "other", "web"}:
        return "wildcard"
    return FAMILY_MAP.get(hint, "other")


def _tier(reward_data: dict[str, Any]) -> tuple[str | None, int | None, int | None]:
    """Return (label, max_reward, min_reward) from Bugcrowd's rewardRangeData."""
    best_tier: str | None = None
    max_reward: int | None = None
    min_reward: int | None = None
    for key in sorted(reward_data, key=lambda k: int(k) if str(k).isdigit() else 99):
        row = reward_data[key] or {}
        high = row.get("max")
        low = row.get("min")
        if high and (max_reward is None or high > max_reward):
            max_reward = int(high)
        if low and (min_reward is None or low < min_reward):
            min_reward = int(low)
        if high and best_tier is None:
            best_tier = key
    return (f"Tier {best_tier}" if best_tier else None, max_reward, min_reward)


class BugcrowdAdapter:
    platform = "bugcrowd"

    def __init__(self, http: HttpClient | None = None):
        self.http = http or HttpClient(user_agent=USER_AGENT)

    def list_programs(self, limit: int = 50, max_pages: int = 3) -> list[ProgramRef]:
        refs: list[ProgramRef] = []
        for page in range(1, max_pages + 1):
            try:
                payload = self.http.get_json(
                    f"{BASE}/engagements.json",
                    params={"category": "bug_bounty", "page": page},
                )
            except FetchError as exc:
                raise AdapterError(str(exc)) from exc
            engagements = payload.get("engagements") or []
            for engagement in engagements:
                if engagement.get("isDemo") or engagement.get("isPrivate"):
                    continue
                brief_url = engagement.get("briefUrl") or ""
                handle = brief_url.rstrip("/").split("/")[-1]
                if not handle:
                    continue
                refs.append(
                    ProgramRef(
                        platform=self.platform,
                        handle=handle,
                        name=(engagement.get("name") or handle).strip(),
                        url=f"{BASE}{brief_url}",
                        meta={
                            "industry": engagement.get("industryName"),
                            "reward": engagement.get("rewardSummary"),
                        },
                    )
                )
                if len(refs) >= limit:
                    return refs
            meta = payload.get("paginationMeta") or {}
            total_pages = meta.get("totalPages") or meta.get("total_pages")
            if total_pages and page >= int(total_pages):
                break
            if not engagements:
                break
            time.sleep(0.2)
        return refs

    def fetch(self, ref: ProgramRef) -> RawRevision:
        handle = ref.handle
        try:
            changelog = self.http.get_json(f"{BASE}/engagements/{handle}/changelog.json")
        except FetchError as exc:
            raise AdapterError(f"Bugcrowd changelog failed for {handle}: {exc}") from exc

        revisions = changelog.get("changelogs") or []
        revisions.sort(key=lambda r: r.get("publishedAt") or "", reverse=True)
        if not revisions:
            raise AdapterError(f"Bugcrowd program {handle} has no changelog revisions")

        selected: dict[str, Any] | None = None
        selected_meta: dict[str, Any] | None = None
        for revision in revisions[:4]:
            try:
                payload = self.http.get_json(
                    f"{BASE}/engagements/{handle}/changelog/{revision['id']}.json"
                )
            except FetchError:
                continue
            scope = (payload.get("data") or {}).get("scope") or []
            if scope:
                selected = payload
                selected_meta = revision
                break
            time.sleep(0.25)
        if not selected or not selected_meta:
            raise AdapterError(f"Bugcrowd program {handle} has no scope-bearing revision")

        data = selected.get("data") or {}
        brief = data.get("brief") or {}
        engagement = data.get("engagement") or {}
        name = (brief.get("name") or engagement.get("name") or ref.name or handle).strip()
        url = f"{BASE}/engagements/{handle}"
        published_at = parse_datetime(selected_meta.get("publishedAt"))

        assets: list[RawAsset] = []
        max_bounty: int | None = None
        min_bounty: int | None = None
        all_groups: list[ScopeGroup] = []
        for group in data.get("scope") or []:
            group_id = str(group.get("id") or group.get("name") or "group")
            group_name = (group.get("name") or "Scope").strip()
            in_scope = bool(group.get("inScope"))
            tier_label, group_max, group_min = _tier(group.get("rewardRangeData") or {})
            if group_max is not None:
                max_bounty = max(max_bounty or 0, group_max)
            if group_min is not None:
                min_bounty = min(min_bounty or group_min, group_min)
            scope_group = ScopeGroup(
                id=group_id,
                name=group_name,
                in_scope=in_scope,
                tier=tier_label,
            )
            all_groups.append(scope_group)
            for target in group.get("targets") or []:
                value = (
                    target.get("ipAddress")
                    or target.get("uri")
                    or target.get("name")
                    or ""
                ).strip()
                if not value:
                    continue
                category = target.get("category")
                family = _family(category, value)
                tags = [t.get("name") for t in (target.get("tags") or []) if t.get("name")]
                attrs = AssetAttrs(
                    bounty_eligible=in_scope and bool(group_max),
                    bounty_tier=tier_label if in_scope else None,
                    max_bounty=group_max if in_scope else None,
                    currency="USD" if in_scope and group_max else None,
                    max_severity=None,
                    instruction=(target.get("description") or group.get("description") or None),
                    tags=sorted(set(tags)),
                )
                assets.append(
                    RawAsset(
                        family=family,
                        kind="in" if in_scope else "out",
                        target=value,
                        name=(target.get("name") or "").strip() or None,
                        source_ids=[str(target.get("id"))] if target.get("id") else [],
                        group=scope_group,
                        attrs=attrs,
                        raw=target,
                    )
                )

        if not assets:
            raise AdapterError(f"Bugcrowd program {handle} revision contained no targets")

        program = Program(
            id=program_id(self.platform, handle),
            platform="bugcrowd",
            handle=handle,
            name=name,
            url=url,
            status=(selected.get("statusLabel") or "open").lower(),
            industry=selected.get("industryName") or ref.meta.get("industry"),
            offers_bounties=bool(max_bounty),
            currency="USD",
            min_bounty=min_bounty,
            max_bounty=max_bounty,
            tags=[],
            source=None,
        )
        return RawRevision(
            program=program,
            assets=assets,
            source_revision_id=str(selected_meta.get("id")),
            source_published_at=published_at,
            source_url=f"{BASE}{selected_meta.get('changelogShowUrl') or ''}",
            complete=True,
            notes=[f"{len(assets)} targets across {len(all_groups)} groups"],
            raw=selected,
        )
