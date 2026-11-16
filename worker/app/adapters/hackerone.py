from __future__ import annotations

import os
import time
from typing import Any

from app.adapters.base import (
    AdapterError,
    AdapterNotConfigured,
    ProgramRef,
    RawRevision,
    parse_datetime,
    program_id,
)
from app.adapters.http import FetchError, HttpClient
from app.models import AssetAttrs, Program, RawAsset

BASE = "https://api.hackerone.com/v1"
USER_AGENT = "ScopeDiff/0.1 (scope-change watcher; contact: scopediff@example.com)"

TYPE_MAP = {
    "URL": "web",
    "WILDCARD": "wildcard",
    "IP_ADDRESS": "ip",
    "CIDR": "cidr",
    "MOBILE_APP": "other",
    "HARDWARE": "hardware",
    "SOURCE_CODE": "source_code",
    "OTHER": "other",
}


def _family(asset_type: str, identifier: str) -> str:
    low = identifier.lower()
    if asset_type == "URL" and ("api." in low or "/api/" in low):
        return "api"
    if asset_type == "MOBILE_APP":
        if "play.google.com" in low or "android" in low:
            return "mobile_android"
        if "apps.apple.com" in low or "itunes.apple.com" in low:
            return "mobile_ios"
        if low.isdigit():
            return "mobile_ios"
        if low.count(".") >= 2 and "/" not in low:
            return "mobile_android"
    return TYPE_MAP.get(asset_type, "other")


class HackerOneAdapter:
    platform = "hackerone"

    def __init__(self, http: HttpClient | None = None, username: str | None = None, token: str | None = None):
        self.http = http or HttpClient(user_agent=USER_AGENT)
        self.username = username or os.getenv("H1_API_USER")
        self.token = token or os.getenv("H1_API_TOKEN")

    @property
    def configured(self) -> bool:
        return bool(self.username and self.token)

    def _auth(self) -> tuple[str, str]:
        if not self.configured:
            raise AdapterNotConfigured(
                "HackerOne is not configured. Set H1_API_USER and H1_API_TOKEN "
                "(Hacker API credentials from hackerone.com/settings/api)."
            )
        return (self.username or "", self.token or "")

    def list_programs(self, limit: int = 50) -> list[ProgramRef]:
        auth = self._auth()
        refs: list[ProgramRef] = []
        url: str | None = f"{BASE}/hackers/programs"
        params: dict[str, Any] | None = {"page[size]": 100}
        while url and len(refs) < limit:
            try:
                payload = self.http.get_json(url, params=params, auth=auth)
            except FetchError as exc:
                raise AdapterError(f"HackerOne program directory failed: {exc}") from exc
            for item in payload.get("data") or []:
                attrs = item.get("attributes") or {}
                handle = attrs.get("handle") or item.get("id")
                if not handle:
                    continue
                refs.append(
                    ProgramRef(
                        platform=self.platform,
                        handle=str(handle),
                        name=attrs.get("name"),
                        url=attrs.get("url") or f"https://hackerone.com/{handle}",
                        meta={"offers_bounties": attrs.get("offers_bounties")},
                    )
                )
                if len(refs) >= limit:
                    break
            url = (payload.get("links") or {}).get("next")
            params = None
            time.sleep(0.8)
        return refs

    def fetch(self, ref: ProgramRef) -> RawRevision:
        auth = self._auth()
        handle = ref.handle
        try:
            program_payload = self.http.get_json(
                f"{BASE}/hackers/programs/{handle}", auth=auth
            )
        except FetchError as exc:
            raise AdapterError(f"HackerOne program fetch failed for {handle}: {exc}") from exc
        attrs = (program_payload.get("data") or {}).get("attributes") or {}

        scopes: list[dict[str, Any]] = []
        url: str | None = f"{BASE}/hackers/programs/{handle}/structured_scopes"
        params: dict[str, Any] | None = {"page[size]": 100}
        capped = False
        while url:
            try:
                payload = self.http.get_json(url, params=params, auth=auth)
            except FetchError as exc:
                raise AdapterError(
                    f"HackerOne structured scopes failed for {handle}: {exc}"
                ) from exc
            page = payload.get("data") or []
            scopes.extend(page)
            if len(scopes) >= 10_000:
                capped = True
                break
            url = (payload.get("links") or {}).get("next")
            params = None
            time.sleep(1.2)  # respect the 50 req/min structured-scope limit

        assets: list[RawAsset] = []
        for item in scopes:
            scope_attrs = item.get("attributes") or {}
            identifier = (scope_attrs.get("asset_identifier") or "").strip()
            if not identifier:
                continue
            asset_type = (scope_attrs.get("asset_type") or "OTHER").upper()
            in_scope = bool(scope_attrs.get("eligible_for_submission", True))
            assets.append(
                RawAsset(
                    family=_family(asset_type, identifier),
                    kind="in" if in_scope else "out",
                    target=identifier,
                    name=None,
                    source_ids=[str(item.get("id"))] if item.get("id") else [],
                    group=None,
                    attrs=AssetAttrs(
                        bounty_eligible=in_scope
                        and bool(scope_attrs.get("eligible_for_bounty")),
                        bounty_tier=None,
                        max_bounty=None,
                        currency=attrs.get("currency"),
                        max_severity=scope_attrs.get("max_severity"),
                        instruction=scope_attrs.get("instruction"),
                        tags=[asset_type],
                    ),
                    raw=item,
                )
            )

        if not assets:
            raise AdapterError(f"HackerOne program {handle} produced no structured scopes")

        updated = parse_datetime(attrs.get("updated_at"))
        program = Program(
            id=program_id(self.platform, handle),
            platform="hackerone",
            handle=handle,
            name=(attrs.get("name") or ref.name or handle).strip(),
            url=attrs.get("url") or f"https://hackerone.com/{handle}",
            status=str(attrs.get("submission_state") or "open").lower(),
            industry=attrs.get("industry"),
            offers_bounties=bool(attrs.get("offers_bounties")),
            currency=attrs.get("currency") or "USD",
            min_bounty=None,
            max_bounty=None,
            tags=[],
        )
        return RawRevision(
            program=program,
            assets=assets,
            source_revision_id=attrs.get("updated_at"),
            source_published_at=updated,
            source_url=program.url,
            complete=not capped,
            notes=[
                f"{len(assets)} structured scopes",
                *(["capped at 10,000 scopes; use filter[id__gt] for a full backfill"] if capped else []),
            ],
            raw={"program": program_payload, "scopes": scopes[:50]},
        )
