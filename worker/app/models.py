"""ScopeDiff domain models.

Everything the worker persists or serves is defined here so the web app, the
demo seed and the API all speak the same shape.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

Platform = Literal["bugcrowd", "hackerone", "intigriti", "sandbox"]
AssetFamily = Literal[
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
]
AssetKind = Literal["in", "out", "conflict"]
Impact = Literal["risk", "opportunity", "neutral", "mixed"]
Magnitude = Literal["critical", "high", "medium", "low"]
Confidence = Literal["high", "low"]
ChangeKind = Literal[
    "added", "removed", "reintroduced", "modified", "moved_in", "moved_out"
]
ChangeStatus = Literal["ready", "review", "failed"]
AlertStatus = Literal["pending", "sent", "skipped", "failed"]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ScopeGroup(BaseModel):
    id: str
    name: str
    in_scope: bool = True
    tier: str | None = None


class AssetAttrs(BaseModel):
    bounty_eligible: bool = False
    bounty_tier: str | None = None
    max_bounty: int | None = None
    currency: str | None = None
    max_severity: str | None = None
    instruction: str | None = None
    tags: list[str] = Field(default_factory=list)


class Asset(BaseModel):
    key: str
    family: AssetFamily
    kind: AssetKind
    target: str
    display: str
    source_ids: list[str] = Field(default_factory=list)
    groups: list[ScopeGroup] = Field(default_factory=list)
    attrs: AssetAttrs = Field(default_factory=AssetAttrs)


class RawAsset(BaseModel):
    """Adapter output before canonicalisation."""

    family: str
    kind: AssetKind = "in"
    target: str
    name: str | None = None
    source_ids: list[str] = Field(default_factory=list)
    group: ScopeGroup | None = None
    attrs: AssetAttrs = Field(default_factory=AssetAttrs)
    raw: dict[str, Any] | None = None


class ScopeCounts(BaseModel):
    in_scope: int = 0
    out_of_scope: int = 0
    conflict: int = 0
    total: int = 0
    bounty_eligible: int = 0


class SourceRef(BaseModel):
    adapter: str
    revision_id: str | None = None
    published_at: datetime | None = None
    fetched_at: datetime = Field(default_factory=utcnow)
    url: str | None = None


class Program(BaseModel):
    id: str
    platform: Platform
    handle: str
    name: str
    url: str
    status: str = "open"
    industry: str | None = None
    offers_bounties: bool = True
    currency: str = "USD"
    min_bounty: int | None = None
    max_bounty: int | None = None
    tags: list[str] = Field(default_factory=list)
    current_version: int = 0
    current_hash: str = ""
    scope_counts: ScopeCounts = Field(default_factory=ScopeCounts)
    first_seen_at: datetime = Field(default_factory=utcnow)
    last_checked_at: datetime = Field(default_factory=utcnow)
    last_changed_at: datetime | None = None
    source: SourceRef | None = None


class Snapshot(BaseModel):
    program_id: str
    version: int = 0
    hash: str = ""
    assets: list[Asset] = Field(default_factory=list)
    groups: list[ScopeGroup] = Field(default_factory=list)
    captured_at: datetime = Field(default_factory=utcnow)
    source_revision_id: str | None = None
    source_published_at: datetime | None = None
    source_url: str | None = None
    confidence: Confidence = "high"
    complete: bool = True
    counts: ScopeCounts = Field(default_factory=ScopeCounts)


class Version(BaseModel):
    program_id: str
    version: int
    hash: str
    captured_at: datetime
    source_revision_id: str | None = None
    source_published_at: datetime | None = None
    source_url: str | None = None
    is_baseline: bool = False
    confidence: Confidence = "high"
    counts: ScopeCounts = Field(default_factory=ScopeCounts)
    change_id: str | None = None


class FieldChange(BaseModel):
    field: str
    label: str
    before: Any = None
    after: Any = None


class ChangeItem(BaseModel):
    id: str
    change_id: str
    kind: ChangeKind
    asset_key: str
    family: AssetFamily
    target: str
    display: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    fields: list[FieldChange] = Field(default_factory=list)
    impact: Impact = "neutral"
    materiality_score: int = 0
    reasons: list[str] = Field(default_factory=list)
    group_names: list[str] = Field(default_factory=list)


class ChangeCounts(BaseModel):
    added: int = 0
    removed: int = 0
    reintroduced: int = 0
    modified: int = 0
    moved_in: int = 0
    moved_out: int = 0
    total: int = 0


class Change(BaseModel):
    id: str
    program_id: str
    program_name: str
    platform: Platform
    program_url: str | None = None
    from_version: int
    to_version: int
    detected_at: datetime = Field(default_factory=utcnow)
    source_published_at: datetime | None = None
    source_revision_id: str | None = None
    source_url: str | None = None
    is_baseline: bool = False
    is_simulation: bool = False
    confidence: Confidence = "high"
    impact: Impact = "neutral"
    magnitude: Magnitude = "low"
    materiality_score: int = 0
    reasons: list[str] = Field(default_factory=list)
    counts: ChangeCounts = Field(default_factory=ChangeCounts)
    status: ChangeStatus = "ready"
    items_preview: list[ChangeItem] = Field(default_factory=list)
    # Full items are persisted in a subcollection / separate array and excluded
    # from the change document to stay under Firestore's 1 MiB limit.
    items: list[ChangeItem] = Field(default_factory=list)
    alert_status: AlertStatus = "skipped"
    alerted_at: datetime | None = None
    alert_error: str | None = None


class DiffResult(BaseModel):
    items: list[ChangeItem] = Field(default_factory=list)
    counts: ChangeCounts = Field(default_factory=ChangeCounts)
    impact: Impact = "neutral"
    magnitude: Magnitude = "low"
    materiality_score: int = 0
    reasons: list[str] = Field(default_factory=list)


class SourceRun(BaseModel):
    id: str
    platform: str
    target: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    status: Literal["ok", "warn", "error", "running"] = "ok"
    programs_seen: int = 0
    programs_changed: int = 0
    assets_seen: int = 0
    latency_ms: int | None = None
    error: str | None = None
    notes: list[str] = Field(default_factory=list)


class PlatformStatus(BaseModel):
    id: str
    name: str
    status: Literal["ok", "warn", "error", "unknown"] = "unknown"
    last_run_at: datetime | None = None
    programs_count: int = 0
    latency_ms: int | None = None
    message: str | None = None


class SyncResult(BaseModel):
    program_id: str
    status: Literal[
        "baseline", "changed", "unchanged", "review", "skipped", "error"
    ]
    change_id: str | None = None
    message: str = ""
    latency_ms: int | None = None


class AlertResult(BaseModel):
    status: AlertStatus
    message: str
    detail: str | None = None


class UserPreferences(BaseModel):
    role: Literal["hunter", "team", "consultancy", "other"] = "hunter"
    experience: Literal["beginner", "intermediate", "advanced", "professional"] = "intermediate"
    interests: list[AssetFamily] = Field(default_factory=list)
    platforms: list[Platform] = Field(default_factory=list)
    bounty_range: Literal["any", "100", "500", "1000", "5000"] = "any"
    severity: Literal["any", "low", "medium", "high", "critical"] = "any"
    alert_mode: Literal["all", "high", "mine"] = "high"
    min_materiality: int = Field(default=25, ge=0, le=100)
    interval_minutes: int = Field(default=15, ge=1, le=1440)
    testing_targets: list[str] = Field(default_factory=list)
    slack_webhook: str | None = None
    email_digest: bool = True
    onboarding_complete: bool = False
    updated_at: datetime = Field(default_factory=utcnow)


class UserProfile(BaseModel):
    uid: str
    email: str | None = None
    name: str = "Hunter"
    photo_url: str | None = None
    preferences: UserPreferences = Field(default_factory=UserPreferences)
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Watch(BaseModel):
    uid: str = ""
    program_id: str
    platform: Platform
    handle: str
    program_name: str
    program_url: str
    interval_minutes: int = Field(default=15, ge=1, le=1440)
    active: bool = True
    status: Literal["active", "pending", "error"] = "active"
    error: str | None = None
    alert_mode: Literal["all", "high", "mine"] = "high"
    min_materiality: int = Field(default=25, ge=0, le=100)
    slack_webhook: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    last_checked_at: datetime | None = None
    next_check_at: datetime = Field(default_factory=utcnow)
    last_sync_status: str | None = None
    last_change_id: str | None = None
    last_notified_change_id: str | None = None


class WatchCreate(BaseModel):
    url: str
    interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    alert_mode: Literal["all", "high", "mine"] | None = None
    min_materiality: int | None = Field(default=None, ge=0, le=100)
    slack_webhook: str | None = None


class WatchUpdate(BaseModel):
    interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    active: bool | None = None
    alert_mode: Literal["all", "high", "mine"] | None = None
    min_materiality: int | None = Field(default=None, ge=0, le=100)
    slack_webhook: str | None = None
