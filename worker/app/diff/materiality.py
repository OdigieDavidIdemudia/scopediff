from __future__ import annotations

import re
from typing import Iterable

from app.models import Asset, FieldChange, Impact

FAMILY_WEIGHT = {
    "web": 30,
    "api": 32,
    "wildcard": 42,
    "ip": 28,
    "cidr": 30,
    "mobile_android": 24,
    "mobile_ios": 24,
    "source_code": 20,
    "hardware": 18,
    "other": 12,
}

SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def tier_number(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


def family_weight(family: str) -> int:
    return FAMILY_WEIGHT.get(family, 12)


def _tier_bonus(asset: Asset) -> tuple[int, list[str]]:
    tier = tier_number(asset.attrs.bounty_tier)
    if tier == 1:
        return 10, ["Tier 1 reward"]
    if tier == 2:
        return 5, ["Tier 2 reward"]
    return 0, []


def score_added(asset: Asset, reintroduced: bool = False) -> tuple[int, Impact, list[str]]:
    if asset.kind == "out":
        return 8, "neutral", ["out-of-scope target added"]
    score = family_weight(asset.family)
    reasons = ["new in-scope asset"]
    if reintroduced:
        score += 5
        reasons.append("previously seen target returned")
    if asset.attrs.bounty_eligible:
        score += 15
        reasons.append("bounty eligible")
    if asset.family == "wildcard":
        score += 10
        reasons.append("wildcard coverage")
    bonus, tier_reasons = _tier_bonus(asset)
    score += bonus
    reasons.extend(tier_reasons)
    if (asset.attrs.max_bounty or 0) >= 1000:
        score += 5
        reasons.append("high max bounty")
    return min(score, 100), "opportunity", reasons


def score_removed(asset: Asset) -> tuple[int, Impact, list[str]]:
    if asset.kind == "out":
        return 8, "neutral", ["out-of-scope target removed"]
    score = 38
    reasons = ["in-scope asset removed"]
    if asset.attrs.bounty_eligible:
        score += 10
        reasons.append("bounty-eligible target lost")
    if asset.family == "wildcard":
        score += 8
        reasons.append("wildcard coverage removed")
    bonus, tier_reasons = _tier_bonus(asset)
    score += bonus
    reasons.extend(tier_reasons)
    return min(score, 100), "risk", reasons


def score_modified(
    before: Asset, after: Asset, fields: Iterable[FieldChange]
) -> tuple[int, Impact, list[str]]:
    field_names = {f.field for f in fields}
    score = 0
    risk = 0
    opportunity = 0
    reasons: list[str] = []

    if "kind" in field_names:
        if before.kind == "in" and after.kind == "out":
            score += 55
            risk += 55
            reasons.append("moved out of scope")
        elif before.kind == "out" and after.kind == "in":
            score += 40
            opportunity += 40
            reasons.append("moved into scope")
        else:
            score += 20
            risk += 20
            reasons.append("scope conflict")

    if "bounty_eligible" in field_names:
        if before.attrs.bounty_eligible and not after.attrs.bounty_eligible:
            score += 45
            risk += 45
            reasons.append("bounty eligibility removed")
        elif not before.attrs.bounty_eligible and after.attrs.bounty_eligible:
            score += 30
            opportunity += 30
            reasons.append("bounty eligibility added")

    if "bounty_tier" in field_names:
        old = tier_number(before.attrs.bounty_tier)
        new = tier_number(after.attrs.bounty_tier)
        if old is not None and new is not None and old != new:
            delta = abs(new - old)
            if new > old:
                points = min(36, 12 * delta)
                score += points
                risk += points
                reasons.append(f"reward tier downgraded (Tier {old} → Tier {new})")
            else:
                points = min(24, 8 * delta)
                score += points
                opportunity += points
                reasons.append(f"reward tier upgraded (Tier {old} → Tier {new})")
        else:
            score += 10
            risk += 10
            reasons.append("reward tier changed")

    if "max_bounty" in field_names:
        old = before.attrs.max_bounty or 0
        new = after.attrs.max_bounty or 0
        if new < old:
            score += 30
            risk += 30
            reasons.append("max bounty reduced")
        elif new > old:
            score += 15
            opportunity += 15
            reasons.append("max bounty increased")

    if "max_severity" in field_names:
        old = SEVERITY_RANK.get((before.attrs.max_severity or "").lower(), -1)
        new = SEVERITY_RANK.get((after.attrs.max_severity or "").lower(), -1)
        if new < old:
            score += 15
            risk += 15
            reasons.append("accepted severity reduced")
        elif new > old:
            score += 8
            opportunity += 8
            reasons.append("accepted severity increased")

    if "instruction" in field_names:
        score += 6
        risk += 6
        reasons.append("testing instructions changed")

    if "groups" in field_names:
        score += 5
        risk += 5
        reasons.append("scope group changed")

    if "group_details" in field_names:
        score += 4
        risk += 4
        reasons.append("scope group rules changed")

    if "tags" in field_names:
        score += 4
        reasons.append("target tags changed")

    if "target" in field_names:
        score += 6
        opportunity += 6
        reasons.append("target renamed")

    if "family" in field_names:
        score += 4
        reasons.append("target type changed")

    if "currency" in field_names:
        score += 2
        reasons.append("reward currency changed")

    if not reasons:
        score = 8
        reasons.append("target metadata changed")

    if risk and opportunity:
        impact: Impact = "mixed"
    elif risk:
        impact = "risk" if risk >= 20 else "neutral"
    elif opportunity:
        impact = "opportunity" if opportunity >= 15 else "neutral"
    else:
        impact = "neutral"
    return min(score, 100), impact, reasons
