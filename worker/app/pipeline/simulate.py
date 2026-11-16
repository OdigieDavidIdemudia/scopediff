from __future__ import annotations

from pathlib import Path

from app.adapters.fixture import FixtureAdapter
from app.adapters.base import ProgramRef
from app.pipeline.store import Store
from app.pipeline.sync import sync_revision

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
SANDBOX_HANDLE = "acme-cloud"


def _ref(fixture: str) -> ProgramRef:
    return ProgramRef(
        platform="sandbox",
        handle=fixture,
        meta={"path": str(FIXTURE_DIR / f"{fixture}.json")},
    )


def ensure_sandbox(store: Store) -> str:
    """Create the sandbox baseline if it does not exist yet."""
    adapter = FixtureAdapter(FIXTURE_DIR)
    revision = adapter.fetch(_ref("acme_v7"))
    existing = store.get_program(revision.program.id)
    if existing:
        return revision.program.id
    result = sync_revision(store, _ref("acme_v7"), revision)
    return result.program_id


def simulate_next(store: Store) -> dict:
    """Apply the v8 sandbox revision through the real diff pipeline."""
    ensure_sandbox(store)
    adapter = FixtureAdapter(FIXTURE_DIR)
    ref = _ref("acme_v8")
    revision = adapter.fetch(ref)
    result = sync_revision(
        store,
        ref,
        revision,
        is_simulation=True,
        force=False,
    )
    change = store.get_change(result.change_id) if result.change_id else None
    return {
        "result": result.model_dump(mode="json"),
        "change": change.model_dump(mode="json") if change else None,
    }
