from __future__ import annotations

from pathlib import Path

import pytest

from app.adapters.base import AdapterNotConfigured, ProgramRef
from app.adapters.bugcrowd import BugcrowdAdapter
from app.adapters.fixture import FixtureAdapter
from app.adapters.hackerone import HackerOneAdapter
from app.adapters.intigriti import IntigritiAdapter

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"


def test_fixture_adapter_loads_v7() -> None:
    adapter = FixtureAdapter(FIXTURE_DIR)
    ref = ProgramRef(platform="sandbox", handle="acme_v7", meta={"path": str(FIXTURE_DIR / "acme_v7.json")})
    revision = adapter.fetch(ref)
    assert revision.program.name == "Acme Cloud (Sandbox)"
    assert revision.program.id == "sandbox__acme-cloud"
    assert len(revision.assets) >= 10
    assert revision.complete is True


def test_bugcrowd_family_mapping() -> None:
    from app.adapters.bugcrowd import _family

    assert _family("website", "https://example.com") == "web"
    assert _family("api", "https://api.example.com") == "api"
    assert _family("android", "https://play.google.com/store/apps/details?id=com.foo") == "mobile_android"
    assert _family("ios", "https://apps.apple.com/app/id123") == "mobile_ios"
    assert _family("other", "*.example.com") == "wildcard"
    assert _family("api", "prod-*.example.com") == "wildcard"
    assert _family("network", "198.51.100.0/24") == "cidr"


def test_intigriti_family_mapping() -> None:
    from app.adapters.intigriti import _family

    assert _family(1, "login.cm.com") == "web"
    assert _family(2, "com.cm.cashregister") == "mobile_android"
    assert _family(3, "1199521324") == "mobile_ios"
    assert _family(6, "https://github.com/cmdotcom") == "source_code"
    assert _family(7, "*.cm.com") == "wildcard"
    assert _family(99, "api.example.com") == "web"


def test_hackerone_family_mapping() -> None:
    from app.adapters.hackerone import _family

    assert _family("URL", "https://api.example.com/v1") == "api"
    assert _family("URL", "https://www.example.com") == "web"
    assert _family("WILDCARD", "*.example.com") == "wildcard"
    assert _family("IP_ADDRESS", "192.0.2.10") == "ip"
    assert _family("CIDR", "198.51.100.0/24") == "cidr"
    assert _family("MOBILE_APP", "com.foo.bar") == "mobile_android"
    assert _family("MOBILE_APP", "https://apps.apple.com/app/id123") == "mobile_ios"


def test_hackerone_requires_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("H1_API_USER", raising=False)
    monkeypatch.delenv("H1_API_TOKEN", raising=False)
    adapter = HackerOneAdapter(username="", token="")
    # Passing empty strings still falls back to env, which is now empty.
    adapter.username = None
    adapter.token = None
    assert adapter.configured is False
    with pytest.raises(AdapterNotConfigured):
        adapter.list_programs()
    with pytest.raises(AdapterNotConfigured):
        adapter.fetch(ProgramRef(platform="hackerone", handle="acme"))


def test_adapters_expose_platform_names() -> None:
    assert BugcrowdAdapter.platform == "bugcrowd"
    assert HackerOneAdapter.platform == "hackerone"
    assert IntigritiAdapter.platform == "intigriti"
    assert FixtureAdapter.platform == "sandbox"
