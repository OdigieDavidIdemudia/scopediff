from __future__ import annotations

import hashlib
from typing import Iterable

from app.diff.materiality import score_added, score_modified, score_removed
from app.models import (
    Asset,
    ChangeCounts,
    ChangeItem,
    DiffResult,
    FieldChange,
    Impact,
    Magnitude,
    Snapshot,
)

KIND_LABELS = {"in": "In scope", "out": "Out of scope", "conflict": "Conflict"}


def _item_id(change_id: str, kind: str, asset_key: str) -> str:
    digest = hashlib.sha1(f"{change_id}|{kind}|{asset_key}".encode("utf-8")).hexdigest()
    return f"ci_{digest[:16]}"


def asset_summary(asset: Asset) -> dict:
    return {
        "target": asset.display,
        "canonical": asset.target,
        "family": asset.family,
        "kind": asset.kind,
        "bounty_eligible": asset.attrs.bounty_eligible,
        "bounty_tier": asset.attrs.bounty_tier,
        "max_bounty": asset.attrs.max_bounty,
        "currency": asset.attrs.currency,
        "max_severity": asset.attrs.max_severity,
        "instruction": asset.attrs.instruction,
        "groups": sorted({g.name for g in asset.groups}),
        "tags": sorted(asset.attrs.tags),
    }


def compare_assets(before: Asset, after: Asset) -> list[FieldChange]:
    fields: list[FieldChange] = []

    def add(field: str, label: str, old, new) -> None:
        if old != new:
            fields.append(FieldChange(field=field, label=label, before=old, after=new))

    add("kind", "Scope", KIND_LABELS.get(before.kind), KIND_LABELS.get(after.kind))
    add(
        "bounty_eligible",
        "Bounty eligible",
        before.attrs.bounty_eligible,
        after.attrs.bounty_eligible,
    )
    add("bounty_tier", "Reward tier", before.attrs.bounty_tier, after.attrs.bounty_tier)
    add("max_bounty", "Max bounty", before.attrs.max_bounty, after.attrs.max_bounty)
    add("currency", "Currency", before.attrs.currency, after.attrs.currency)
    add("max_severity", "Max severity", before.attrs.max_severity, after.attrs.max_severity)
    add(
        "instruction",
        "Testing instructions",
        (before.attrs.instruction or "").strip() or None,
        (after.attrs.instruction or "").strip() or None,
    )
    if before.family != after.family:
        fields.append(
            FieldChange(field="family", label="Target type", before=before.family, after=after.family)
        )
    if before.target != after.target:
        fields.append(
            FieldChange(
                field="target",
                label="Target",
                before=before.display,
                after=after.display,
            )
        )
    old_groups = sorted({g.name for g in before.groups})
    new_groups = sorted({g.name for g in after.groups})
    add("groups", "Groups", old_groups, new_groups)
    if old_groups == new_groups:
        old_details = sorted(
            [
                {"name": g.name, "in_scope": g.in_scope, "tier": g.tier}
                for g in before.groups
            ],
            key=lambda g: g["name"],
        )
        new_details = sorted(
            [
                {"name": g.name, "in_scope": g.in_scope, "tier": g.tier}
                for g in after.groups
            ],
            key=lambda g: g["name"],
        )
        if old_details != new_details:
            fields.append(
                FieldChange(
                    field="group_details",
                    label="Scope group details",
                    before=old_details,
                    after=new_details,
                )
            )
    old_tags = sorted(before.attrs.tags)
    new_tags = sorted(after.attrs.tags)
    add("tags", "Tags", old_tags, new_tags)
    return fields


def _make_item(
    change_id: str,
    kind: str,
    before: Asset | None,
    after: Asset | None,
    *,
    fields: list[FieldChange] | None = None,
    score: int,
    impact: Impact,
    reasons: list[str],
) -> ChangeItem:
    asset = after or before
    assert asset is not None
    return ChangeItem(
        id=_item_id(change_id, kind, asset.key),
        change_id=change_id,
        kind=kind,  # type: ignore[arg-type]
        asset_key=asset.key,
        family=asset.family,
        target=asset.target,
        display=asset.display,
        before=asset_summary(before) if before else None,
        after=asset_summary(after) if after else None,
        fields=fields or [],
        impact=impact,
        materiality_score=score,
        reasons=reasons,
        group_names=sorted({g.name for g in asset.groups}),
    )


def _added_item(change_id: str, asset: Asset, reintroduced: bool = False) -> ChangeItem:
    score, impact, reasons = score_added(asset, reintroduced=reintroduced)
    return _make_item(
        change_id,
        "reintroduced" if reintroduced else "added",
        None,
        asset,
        score=score,
        impact=impact,
        reasons=reasons,
    )


def _removed_item(change_id: str, asset: Asset) -> ChangeItem:
    score, impact, reasons = score_removed(asset)
    return _make_item(
        change_id, "removed", asset, None, score=score, impact=impact, reasons=reasons
    )


def _modified_item(
    change_id: str,
    before: Asset,
    after: Asset,
    *,
    kind: str | None = None,
) -> ChangeItem | None:
    fields = compare_assets(before, after)
    if not fields:
        return None
    if kind is None:
        if before.kind == "in" and after.kind == "out":
            kind = "moved_out"
        elif before.kind == "out" and after.kind == "in":
            kind = "moved_in"
        else:
            kind = "modified"
    score, impact, reasons = score_modified(before, after, fields)
    return _make_item(
        change_id,
        kind,
        before,
        after,
        fields=fields,
        score=score,
        impact=impact,
        reasons=reasons,
    )


def _rescue_renames(
    removed: dict[str, Asset], added: dict[str, Asset]
) -> list[tuple[Asset, Asset]]:
    """Pair a removed and added asset sharing a platform source id.

    Platforms sometimes replace a target row rather than editing it in place,
    which would otherwise show up as one removal plus one addition.
    """
    pairs: list[tuple[Asset, Asset]] = []
    added_by_source: dict[str, list[Asset]] = {}
    for asset in added.values():
        for source_id in asset.source_ids:
            added_by_source.setdefault(source_id, []).append(asset)

    used_added: set[str] = set()
    for asset in removed.values():
        candidates: list[Asset] = []
        for source_id in asset.source_ids:
            for candidate in added_by_source.get(source_id, []):
                if candidate.key not in used_added and candidate not in candidates:
                    candidates.append(candidate)
        if len(candidates) == 1:
            candidate = candidates[0]
            pairs.append((asset, candidate))
            used_added.add(candidate.key)
    return pairs


def diff_snapshots(
    previous: Snapshot,
    current: Snapshot,
    change_id: str,
    *,
    ever_seen_keys: Iterable[str] | None = None,
) -> DiffResult:
    previous_map = {a.key: a for a in previous.assets}
    current_map = {a.key: a for a in current.assets}
    ever_seen = set(ever_seen_keys or ())

    added = {k: v for k, v in current_map.items() if k not in previous_map}
    removed = {k: v for k, v in previous_map.items() if k not in current_map}
    common = set(previous_map) & set(current_map)

    items: list[ChangeItem] = []
    counts = ChangeCounts()

    # Rename rescue first, so the pair is counted as a modification.
    for old_asset, new_asset in _rescue_renames(removed, added):
        removed.pop(old_asset.key, None)
        added.pop(new_asset.key, None)
        item = _modified_item(change_id, old_asset, new_asset)
        if item:
            items.append(item)
            counts.modified += 1

    for key, asset in added.items():
        reintroduced = key in ever_seen
        items.append(_added_item(change_id, asset, reintroduced=reintroduced))
        if reintroduced:
            counts.reintroduced += 1
        else:
            counts.added += 1

    for key, asset in removed.items():
        items.append(_removed_item(change_id, asset))
        counts.removed += 1

    for key in common:
        before = previous_map[key]
        after = current_map[key]
        item = _modified_item(change_id, before, after)
        if not item:
            continue
        items.append(item)
        if item.kind == "moved_out":
            counts.moved_out += 1
        elif item.kind == "moved_in":
            counts.moved_in += 1
        else:
            counts.modified += 1

    items.sort(key=lambda i: (-i.materiality_score, i.kind, i.display))
    counts.total = len(items)

    if not items:
        return DiffResult(
            items=[],
            counts=counts,
            impact="neutral",
            magnitude="low",
            materiality_score=0,
            reasons=[],
        )

    max_score = max(i.materiality_score for i in items)
    materiality = min(100, max_score + min(15, max(0, len(items) - 1) * 3))
    magnitude: Magnitude
    if materiality >= 75:
        magnitude = "critical"
    elif materiality >= 50:
        magnitude = "high"
    elif materiality >= 25:
        magnitude = "medium"
    else:
        magnitude = "low"

    risk_points = sum(i.materiality_score for i in items if i.impact == "risk")
    opp_points = sum(i.materiality_score for i in items if i.impact == "opportunity")
    if risk_points and opp_points and min(risk_points, opp_points) >= 20:
        impact: Impact = "mixed"
    elif risk_points >= opp_points and risk_points:
        impact = "risk"
    elif opp_points:
        impact = "opportunity"
    else:
        impact = "neutral"

    reasons: list[str] = []
    for item in sorted(items, key=lambda i: (-i.materiality_score, i.kind)):
        for reason in item.reasons:
            if reason not in reasons:
                reasons.append(reason)
            if len(reasons) >= 6:
                break
        if len(reasons) >= 6:
            break
    if counts.total > 1:
        reasons.append(f"{counts.total} targets affected")

    return DiffResult(
        items=items,
        counts=counts,
        impact=impact,
        magnitude=magnitude,
        materiality_score=materiality,
        reasons=reasons,
    )
