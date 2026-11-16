from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app, get_store_dep, get_user_store_dep
from app.pipeline.store import JsonStore
from app.users import AuthUser, JsonUserRepository, current_user


def _client(store: JsonStore) -> TestClient:
    app.dependency_overrides[get_store_dep] = lambda: store
    return TestClient(app)


def test_health_and_programs(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    assert client.get("/healthz").json()["ok"] is True
    programs = client.get("/api/programs").json()
    assert len(programs) == 4
    sandbox = client.get("/api/programs/sandbox__acme-cloud").json()
    assert sandbox["current_version"] == 7
    assert sandbox["scope_counts"]["in_scope"] == 13


def test_changes_and_diff(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    changes = client.get("/api/changes?platform=sandbox").json()
    assert len(changes) == 6
    assert all(c["is_baseline"] is False for c in changes)
    latest = changes[0]
    assert latest["id"].endswith("__v7")
    items = client.get(f"/api/changes/{latest['id']}/items").json()
    assert len(items) == 2
    diff = client.get(f"/api/changes/{latest['id']}/diff").json()
    assert diff["change"]["id"] == latest["id"]
    assert len(diff["items"]) == 2


def test_filters(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    opportunity = client.get("/api/changes?impact=opportunity").json()
    assert len(opportunity) >= 1
    assert all(c["impact"] == "opportunity" for c in opportunity)
    low = client.get("/api/changes?confidence=low").json()
    assert len(low) == 1
    assert low[0]["from_version"] == 3
    none = client.get("/api/changes?platform=hackerone").json()
    assert none == []


def test_bootstrap_contract(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    payload = client.get("/api/bootstrap").json()
    assert set(payload) == {
        "meta",
        "viewer",
        "platforms",
        "programs",
        "versions",
        "snapshots",
        "changes",
        "items",
        "runs",
    }
    assert payload["meta"]["demo"] is True
    assert payload["viewer"]["handle"] == "demo"
    assert len(payload["programs"]) == 4
    assert len(payload["versions"]) == 10
    assert len(payload["snapshots"]) == 10
    assert all(snapshot["version"] != 8 for snapshot in payload["snapshots"])
    assert len(payload["changes"]) == 6
    assert len(payload["items"]) == 12
    assert all(not change["id"].endswith("__v8") for change in payload["changes"])
    assert all("items" in change for change in payload["changes"])


def test_admin_overview(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    overview = client.get("/api/admin/overview").json()
    assert overview["programs"] == 4
    assert len(overview["platforms"]) == 4
    assert len(overview["runs"]) == 4


def test_simulate_reveals_v8(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    response = client.post("/internal/simulate", json={"scenario": "acme-v8"})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["result"]["status"] == "changed", payload
    change_id = payload["result"]["change_id"]
    assert change_id.endswith("__v8")
    change = client.get(f"/api/changes/{change_id}").json()
    assert change["is_simulation"] is True
    assert change["counts"]["added"] == 2
    assert change["counts"]["reintroduced"] == 0
    assert change["counts"]["removed"] == 1
    assert change["counts"]["modified"] == 1
    assert change["materiality_score"] == 91
    items = client.get(f"/api/changes/{change_id}/items").json()
    assert len(items) == 4
    assert {item["kind"] for item in items} == {"added", "removed", "modified"}
    program = client.get("/api/programs/sandbox__acme-cloud").json()
    assert program["current_version"] == 8
    assert program["scope_counts"]["in_scope"] == 14
    assert len(client.get("/api/changes?platform=sandbox").json()) == 7


def test_me_profile_preferences_and_bootstrap(demo_store: JsonStore, tmp_path) -> None:
    repo = JsonUserRepository(tmp_path / "users.json")
    app.dependency_overrides[get_store_dep] = lambda: demo_store
    app.dependency_overrides[current_user] = lambda: AuthUser(
        uid="u1", email="one@example.com", name="One Hunter"
    )
    app.dependency_overrides[get_user_store_dep] = lambda: repo
    try:
        client = TestClient(app)
        profile = client.get("/api/me/profile").json()
        assert profile["uid"] == "u1"
        assert profile["preferences"]["onboarding_complete"] is False

        prefs = profile["preferences"]
        prefs.update(
            {
                "onboarding_complete": True,
                "testing_targets": ["api.example.com"],
                "interests": ["api"],
                "interval_minutes": 15,
            }
        )
        saved = client.put("/api/me/preferences", json=prefs)
        assert saved.status_code == 200, saved.text
        assert saved.json()["preferences"]["onboarding_complete"] is True

        boot = client.get("/api/me/bootstrap").json()
        assert boot["meta"]["demo"] is False
        assert boot["profile"]["uid"] == "u1"
        assert boot["viewer"]["testing"] == ["api.example.com"]
        assert boot["programs"] == []

        bad = client.post(
            "/api/me/watches",
            json={"url": "https://example.com/not-a-supported-program"},
        )
        assert bad.status_code == 400

        cron = client.post("/internal/cron")
        assert cron.status_code == 200
        assert cron.json()["due"] == 0
    finally:
        app.dependency_overrides.pop(current_user, None)
        app.dependency_overrides.pop(get_user_store_dep, None)
        app.dependency_overrides.pop(get_store_dep, None)


def test_404s(demo_store: JsonStore) -> None:
    client = _client(demo_store)
    assert client.get("/api/programs/nope").status_code == 404
    assert client.get("/api/changes/nope").status_code == 404
    assert client.get("/api/changes/nope/items").status_code == 404
    assert client.post("/internal/simulate", json={"scenario": "unknown"}).status_code == 400
