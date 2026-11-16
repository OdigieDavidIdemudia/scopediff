from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER_ROOT = Path(__file__).resolve().parents[1]


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Settings:
    demo: bool = True
    store_kind: str = "json"
    data_dir: Path = field(default_factory=lambda: WORKER_ROOT / ".data")
    db_path: Path = field(default_factory=lambda: WORKER_ROOT / ".data" / "store.json")
    raw_dir: Path = field(default_factory=lambda: WORKER_ROOT / ".data" / "raw")
    demo_data_path: Path = field(default_factory=lambda: ROOT / "data" / "demo.json")
    public_url: str = "http://localhost:5173"
    slack_webhook_url: str | None = None
    slack_min_score: int = 25
    internal_token: str | None = None
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    h1_api_user: str | None = None
    h1_api_token: str | None = None
    gcp_project: str | None = None
    snapshot_bucket: str | None = None
    allow_any_webhook: bool = False
    allow_insecure_auth: bool = False
    debug_uid: str = "debug-user"
    default_interval_minutes: int = 15
    min_interval_minutes: int = 1


def _csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_env()
    demo = _bool(os.getenv("SCOPEDIFF_DEMO"), True)
    data_dir = Path(os.getenv("SCOPEDIFF_DATA_DIR") or (WORKER_ROOT / ".data"))
    store_kind = (os.getenv("SCOPEDIFF_STORE") or ("json" if demo else "firestore")).lower()
    cors = _csv(os.getenv("SCOPEDIFF_CORS_ORIGINS")) or ["http://localhost:5173"]
    return Settings(
        demo=demo,
        store_kind=store_kind,
        data_dir=data_dir,
        db_path=Path(os.getenv("SCOPEDIFF_DB_PATH") or (data_dir / "store.json")),
        raw_dir=Path(os.getenv("SCOPEDIFF_RAW_DIR") or (data_dir / "raw")),
        demo_data_path=Path(os.getenv("SCOPEDIFF_DEMO_DATA") or (ROOT / "data" / "demo.json")),
        public_url=(os.getenv("SCOPEDIFF_PUBLIC_URL") or "http://localhost:5173").rstrip("/"),
        slack_webhook_url=os.getenv("SLACK_WEBHOOK_URL") or None,
        slack_min_score=int(os.getenv("SCOPEDIFF_SLACK_MIN_SCORE") or "25"),
        internal_token=os.getenv("SCOPEDIFF_INTERNAL_TOKEN") or None,
        cors_origins=cors,
        h1_api_user=os.getenv("H1_API_USER") or None,
        h1_api_token=os.getenv("H1_API_TOKEN") or None,
        gcp_project=os.getenv("GOOGLE_CLOUD_PROJECT") or None,
        snapshot_bucket=os.getenv("SCOPEDIFF_SNAPSHOT_BUCKET") or None,
        allow_any_webhook=_bool(os.getenv("SCOPEDIFF_ALLOW_ANY_WEBHOOK"), False),
        allow_insecure_auth=_bool(os.getenv("SCOPEDIFF_ALLOW_INSECURE_AUTH"), False),
        debug_uid=os.getenv("SCOPEDIFF_DEBUG_UID") or "debug-user",
        default_interval_minutes=int(os.getenv("SCOPEDIFF_DEFAULT_INTERVAL_MINUTES") or "15"),
        min_interval_minutes=int(os.getenv("SCOPEDIFF_MIN_INTERVAL_MINUTES") or "1"),
    )
