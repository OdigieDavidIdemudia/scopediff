from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from app.models import (
    Change,
    ChangeCounts,
    ChangeItem,
    UserPreferences,
    Watch,
    utcnow,
)
from app.users import (
    AuthUser,
    JsonUserRepository,
    item_matches_targets,
    watch_should_alert,
)


def _watch(**updates) -> Watch:
    now = utcnow()
    base = Watch(
        uid="u1",
        program_id="hackerone__rails",
        platform="hackerone",
        handle="rails",
        program_name="Rails",
        program_url="https://hackerone.com/rails",
        interval_minutes=15,
        created_at=now,
        last_checked_at=now,
        next_check_at=now + timedelta(minutes=15),
    )
    return base.model_copy(update=updates)


def _change(**updates) -> Change:
    base = Change(
        id="hackerone__rails__v2",
        program_id="hackerone__rails",
        program_name="Rails",
        platform="hackerone",
        from_version=1,
        to_version=2,
        magnitude="high",
        materiality_score=70,
        counts=ChangeCounts(added=1, total=1),
    )
    return base.model_copy(update=updates)


def test_json_user_store_profiles_watches_and_due(tmp_path: Path) -> None:
    repo = JsonUserRepository(tmp_path / "users.json")
    user = AuthUser(uid="u1", email="one@example.com", name="One")
    profile = repo.ensure_profile(user)
    assert profile.uid == "u1"
    assert profile.preferences.onboarding_complete is False

    prefs = profile.preferences.model_copy(
        update={
            "onboarding_complete": True,
            "testing_targets": ["api.example.com"],
            "interests": ["api"],
        }
    )
    saved = repo.save_preferences("u1", prefs)
    assert saved.preferences.onboarding_complete is True
    assert repo.get_profile("u1").preferences.testing_targets == ["api.example.com"]

    watch = _watch(next_check_at=utcnow() - timedelta(seconds=1))
    repo.upsert_watch(watch)
    assert repo.get_watch("u1", "hackerone__rails") is not None
    assert len(repo.list_due_watches(utcnow())) == 1
    assert len(repo.list_watchers("hackerone__rails")) == 1

    repo.upsert_watch(watch.model_copy(update={"active": False}))
    assert repo.list_due_watches(utcnow()) == []
    assert repo.list_watchers("hackerone__rails") == []

    repo.delete_watch("u1", "hackerone__rails")
    assert repo.list_watches("u1") == []


def test_item_matching_for_wildcards_and_paths() -> None:
    item = ChangeItem(
        id="i1",
        change_id="c1",
        kind="added",
        asset_key="api|https://api.example.com",
        family="api",
        target="https://api.example.com",
        display="API",
        after={"canonical": "https://api.example.com"},
        impact="opportunity",
        materiality_score=80,
    )
    assert item_matches_targets(item, ["api.example.com"])
    assert item_matches_targets(item, ["*.example.com"])
    assert not item_matches_targets(item, ["other.example.com"])


def test_watch_alert_modes_and_floor() -> None:
    item = ChangeItem(
        id="i1",
        change_id="c1",
        kind="added",
        asset_key="api|https://api.example.com",
        family="api",
        target="https://api.example.com",
        display="API",
        after={"canonical": "https://api.example.com"},
        impact="opportunity",
        materiality_score=80,
    )
    change = _change()
    prefs = UserPreferences(
        testing_targets=["api.example.com"],
        slack_webhook="https://hooks.slack.com/services/test",
    )

    assert watch_should_alert(_watch(alert_mode="all"), change, [item], prefs)
    assert watch_should_alert(_watch(alert_mode="high"), change, [item], prefs)
    assert watch_should_alert(_watch(alert_mode="mine"), change, [item], prefs)
    assert not watch_should_alert(
        _watch(alert_mode="high"), _change(magnitude="low"), [item], prefs
    )
    assert not watch_should_alert(
        _watch(alert_mode="all", min_materiality=90), change, [item], prefs
    )
    assert not watch_should_alert(
        _watch(alert_mode="mine"),
        change,
        [item],
        UserPreferences(testing_targets=["other.example.com"]),
    )
    assert not watch_should_alert(
        _watch(alert_mode="all"), _change(is_baseline=True), [item], prefs
    )
