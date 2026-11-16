from __future__ import annotations

import hashlib
import ipaddress
import json
import re
from typing import Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.models import (
    Asset,
    AssetAttrs,
    AssetFamily,
    AssetKind,
    RawAsset,
    ScopeCounts,
    ScopeGroup,
    Snapshot,
)

DEFAULT_PORTS = {"http": 80, "https": 443}
WILDCARD_RE = re.compile(r"^\*\.")
PACKAGE_RE = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$", re.IGNORECASE)


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def _idna(host: str) -> str:
    host = host.strip().strip(".").lower()
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError:
        return host


def normalize_url(value: str) -> str:
    """Canonicalise a URL without changing its meaning.

    - https is the default scheme for bare hosts
    - scheme/host lowercased, default ports removed, fragment dropped
    - query parameters sorted
    - trailing slash removed unless the path is root
    """
    raw = clean(value)
    if not raw:
        return ""
    if WILDCARD_RE.match(raw):
        # Wildcards are handled separately; keep this safe if called directly.
        return raw.lower().rstrip("/")
    if "://" not in raw:
        raw = "https://" + raw
    parts = urlsplit(raw)
    scheme = (parts.scheme or "https").lower()
    host = _idna(parts.hostname or "")
    if not host:
        return clean(value).lower().rstrip("/")
    port = parts.port
    netloc = host
    if port and DEFAULT_PORTS.get(scheme) != port:
        netloc = f"{host}:{port}"
    path = re.sub(r"/{2,}", "/", parts.path or "")
    if path == "/":
        path = ""
    if path.endswith("/"):
        path = path.rstrip("/")
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    return urlunsplit((scheme, netloc, path, query, ""))


def normalize_host(value: str) -> str:
    raw = clean(value)
    if "://" in raw:
        raw = urlsplit(raw).hostname or raw
    return _idna(raw)


def is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(clean(value))
        return True
    except ValueError:
        return False


def is_cidr(value: str) -> bool:
    try:
        ipaddress.ip_network(clean(value), strict=False)
        return "/" in clean(value)
    except ValueError:
        return False


def infer_family(value: str, hint: str | None = None) -> AssetFamily:
    hint = (hint or "").lower().strip()
    raw = clean(value)
    low = raw.lower()
    if hint in {
        "web",
        "api",
        "wildcard",
        "ip",
        "cidr",
        "mobile_android",
        "mobile_ios",
        "source_code",
        "hardware",
        "other",
    }:
        return hint  # type: ignore[return-value]
    if "*" in low and " " not in low:
        return "wildcard"
    if is_cidr(raw):
        return "cidr"
    if is_ip(raw):
        return "ip"
    if "play.google.com" in low or "android" in hint:
        return "mobile_android"
    if "apps.apple.com" in low or "itunes.apple.com" in low or "ios" in hint:
        return "mobile_ios"
    if "github.com" in low or "gitlab.com" in low or hint in {"source", "source_code", "code"}:
        return "source_code"
    if hint in {"hardware", "device"}:
        return "hardware"
    if hint in {"api"}:
        return "api"
    if PACKAGE_RE.match(raw) and not low.startswith(("http", "www.")):
        # Android package names are common bare values.
        return "mobile_android"
    if "." in low or low.startswith(("http://", "https://")):
        return "web"
    return "other"


def canonical_target(family: AssetFamily, value: str) -> str:
    raw = clean(value)
    if not raw:
        return ""
    if family == "wildcard":
        stripped = raw
        if "://" in stripped:
            parts = urlsplit(stripped)
            stripped = parts.netloc + parts.path
        stripped = stripped.lower().strip()
        if stripped.startswith("*."):
            return stripped.rstrip("/")
        # Some platforms express wildcards as "prod-*.example.com".
        return stripped.rstrip("/")
    if family == "ip":
        try:
            return str(ipaddress.ip_address(raw))
        except ValueError:
            return raw.lower()
    if family == "cidr":
        try:
            return str(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            return raw.lower()
    if family == "mobile_android":
        if "://" in raw:
            parts = urlsplit(raw)
            qs = dict(parse_qsl(parts.query, keep_blank_values=True))
            if qs.get("id"):
                return qs["id"].lower()
            return normalize_url(raw)
        return raw.lower()
    if family == "mobile_ios":
        if "://" in raw:
            parts = urlsplit(raw)
            path = parts.path.rstrip("/")
            match = re.search(r"/id(\d+)", path)
            if match:
                return match.group(1)
            return normalize_url(raw)
        return raw.lower()
    if family == "source_code":
        normalized = normalize_url(raw)
        if normalized.endswith(".git"):
            normalized = normalized[:-4]
        return normalized
    if family in {"web", "api"}:
        return normalize_url(raw)
    return re.sub(r"\s+", " ", raw.lower()).strip(" ,;")


def display_target(family: AssetFamily, value: str) -> str:
    raw = clean(value)
    if family in {"web", "api"}:
        if raw.startswith("https://"):
            raw = raw[len("https://") :]
        elif raw.startswith("http://"):
            raw = raw[len("http://") :]
        return raw.rstrip("/") or raw
    if family == "source_code":
        return normalize_url(raw).replace("https://", "").rstrip("/")
    if family == "mobile_ios" and raw.isdigit():
        return f"iOS app {raw}"
    if family == "mobile_android" and PACKAGE_RE.match(raw):
        return raw
    return raw


def asset_key(family: AssetFamily, target: str) -> str:
    return f"{family}|{target}"


def normalize_asset(raw: RawAsset) -> Asset:
    family = infer_family(raw.target, raw.family)
    canonical = canonical_target(family, raw.target)
    display = clean(raw.name) or display_target(family, raw.target)
    return Asset(
        key=asset_key(family, canonical),
        family=family,
        kind=raw.kind,
        target=canonical,
        display=display,
        source_ids=sorted({s for s in raw.source_ids if s}),
        groups=[raw.group] if raw.group else [],
        attrs=raw.attrs,
    )


def _merge_attrs(a: AssetAttrs, b: AssetAttrs) -> AssetAttrs:
    tiers = [t for t in (a.bounty_tier, b.bounty_tier) if t]
    return AssetAttrs(
        bounty_eligible=a.bounty_eligible or b.bounty_eligible,
        bounty_tier=min(tiers) if tiers else None,
        max_bounty=max(
            [v for v in (a.max_bounty, b.max_bounty) if v is not None], default=None
        ),
        currency=a.currency or b.currency,
        max_severity=a.max_severity or b.max_severity,
        instruction=a.instruction or b.instruction,
        tags=sorted(set(a.tags) | set(b.tags)),
    )


def merge_assets(assets: Iterable[Asset]) -> list[Asset]:
    merged: dict[str, Asset] = {}
    for asset in assets:
        existing = merged.get(asset.key)
        if not existing:
            merged[asset.key] = asset
            continue
        kinds = {existing.kind, asset.kind}
        if "conflict" in kinds or ("in" in kinds and "out" in kinds):
            kind: AssetKind = "conflict"
        else:
            kind = existing.kind if existing.kind == asset.kind else "conflict"
        groups_by_id: dict[str, ScopeGroup] = {g.id: g for g in existing.groups}
        for group in asset.groups:
            if group.id not in groups_by_id:
                groups_by_id[group.id] = group
            else:
                current = groups_by_id[group.id]
                if group.in_scope and not current.in_scope:
                    groups_by_id[group.id] = group
        merged[asset.key] = Asset(
            key=asset.key,
            family=asset.family,
            kind=kind,
            target=asset.target,
            display=existing.display or asset.display,
            source_ids=sorted(set(existing.source_ids) | set(asset.source_ids)),
            groups=sorted(groups_by_id.values(), key=lambda g: (g.name, g.id)),
            attrs=_merge_attrs(existing.attrs, asset.attrs),
        )
    return sorted(
        merged.values(),
        key=lambda a: (0 if a.kind == "in" else 1 if a.kind == "conflict" else 2, a.family, a.target),
    )


def count_assets(assets: Iterable[Asset]) -> ScopeCounts:
    items = list(assets)
    return ScopeCounts(
        in_scope=sum(1 for a in items if a.kind == "in"),
        out_of_scope=sum(1 for a in items if a.kind == "out"),
        conflict=sum(1 for a in items if a.kind == "conflict"),
        total=len(items),
        bounty_eligible=sum(1 for a in items if a.attrs.bounty_eligible),
    )


def _hash_payload(assets: Iterable[Asset], groups: Iterable[ScopeGroup]) -> dict:
    """Volatile fields (timestamps, source ids, display names) are excluded."""
    asset_rows = []
    for asset in sorted(assets, key=lambda a: a.key):
        asset_rows.append(
            {
                "key": asset.key,
                "family": asset.family,
                "kind": asset.kind,
                "target": asset.target,
                "groups": sorted(
                    [
                        {
                            "id": g.id,
                            "name": g.name,
                            "in_scope": g.in_scope,
                            "tier": g.tier,
                        }
                        for g in asset.groups
                    ],
                    key=lambda g: g["id"],
                ),
                "attrs": {
                    "bounty_eligible": asset.attrs.bounty_eligible,
                    "bounty_tier": asset.attrs.bounty_tier,
                    "max_bounty": asset.attrs.max_bounty,
                    "currency": asset.attrs.currency,
                    "max_severity": asset.attrs.max_severity,
                    "instruction": asset.attrs.instruction,
                    "tags": sorted(asset.attrs.tags),
                },
            }
        )
    group_rows = sorted(
        [
            {"id": g.id, "name": g.name, "in_scope": g.in_scope, "tier": g.tier}
            for g in {g.id: g for g in groups}.values()
        ],
        key=lambda g: g["id"],
    )
    return {"assets": asset_rows, "groups": group_rows}


def snapshot_hash(assets: Iterable[Asset], groups: Iterable[ScopeGroup]) -> str:
    payload = json.dumps(
        _hash_payload(assets, groups), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def build_snapshot(
    program_id: str,
    raw_assets: Iterable[RawAsset],
    *,
    version: int = 0,
    captured_at=None,
    source_revision_id: str | None = None,
    source_published_at=None,
    source_url: str | None = None,
    complete: bool = True,
    extra_groups: Iterable[ScopeGroup] = (),
) -> Snapshot:
    from app.models import utcnow

    assets = merge_assets(normalize_asset(raw) for raw in raw_assets)
    groups_by_id: dict[str, ScopeGroup] = {g.id: g for g in extra_groups}
    for asset in assets:
        for group in asset.groups:
            groups_by_id.setdefault(group.id, group)
    groups = sorted(groups_by_id.values(), key=lambda g: (g.name, g.id))
    counts = count_assets(assets)
    return Snapshot(
        program_id=program_id,
        version=version,
        hash=snapshot_hash(assets, groups),
        assets=assets,
        groups=groups,
        captured_at=captured_at or utcnow(),
        source_revision_id=source_revision_id,
        source_published_at=source_published_at,
        source_url=source_url,
        confidence="high" if complete and counts.conflict == 0 else "low",
        complete=complete,
        counts=counts,
    )
