from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Protocol

from pydantic import BaseModel, Field

from app.models import Program, RawAsset


class AdapterError(Exception):
    pass


class AdapterNotConfigured(AdapterError):
    pass


class ProgramRef(BaseModel):
    platform: str
    handle: str
    name: str | None = None
    url: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)


class RawRevision(BaseModel):
    program: Program
    assets: list[RawAsset]
    source_revision_id: str | None = None
    source_published_at: datetime | None = None
    source_url: str | None = None
    complete: bool = True
    notes: list[str] = Field(default_factory=list)
    raw: dict[str, Any] | None = None


class Adapter(Protocol):
    platform: str

    def list_programs(self, limit: int = 50) -> list[ProgramRef]: ...

    def fetch(self, ref: ProgramRef) -> RawRevision: ...


def slug(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9/_-]+", "-", value)
    return value.strip("-").replace("/", "__")


def program_id(platform: str, handle: str) -> str:
    return f"{platform}__{slug(handle)}"


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None
