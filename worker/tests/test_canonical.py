from __future__ import annotations

from app.normalize.canonical import (
    asset_key,
    build_snapshot,
    canonical_target,
    count_assets,
    infer_family,
    normalize_url,
    snapshot_hash,
)

from conftest import raw


def test_normalize_url_defaults_and_sorts() -> None:
    assert (
        normalize_url("HTTPS://Example.COM:443/a/?b=2&a=1#frag")
        == "https://example.com/a?a=1&b=2"
    )
    assert normalize_url("example.com/path/") == "https://example.com/path"
    assert normalize_url("http://example.com:80") == "http://example.com"


def test_infer_family() -> None:
    assert infer_family("*.example.com") == "wildcard"
    assert infer_family("prod-*.example.com") == "wildcard"
    assert infer_family("192.0.2.10") == "ip"
    assert infer_family("198.51.100.0/24") == "cidr"
    assert infer_family("https://api.example.com/v1") == "web"
    assert infer_family("api.example.com", "api") == "api"
    assert infer_family("https://apps.apple.com/app/id123") == "mobile_ios"
    assert infer_family("https://play.google.com/store/apps/details?id=com.foo.bar") == "mobile_android"
    assert infer_family("https://github.com/acme/repo") == "source_code"


def test_wildcard_and_ip_canonicalisation() -> None:
    assert canonical_target("wildcard", "HTTPS://*.Example.com/") == "*.example.com"
    assert canonical_target("wildcard", "prod-*.example.com") == "prod-*.example.com"
    assert canonical_target("cidr", "192.0.2.99/24") == "192.0.2.0/24"
    assert canonical_target("ip", "2001:0DB8::1") == "2001:db8::1"


def test_mobile_canonicalisation() -> None:
    assert (
        canonical_target(
            "mobile_android",
            "https://play.google.com/store/apps/details?id=com.foo.bar&hl=en",
        )
        == "com.foo.bar"
    )
    assert (
        canonical_target(
            "mobile_ios",
            "https://apps.apple.com/us/app/foo/id123456789",
        )
        == "123456789"
    )


def test_scheme_and_bare_host_share_a_key() -> None:
    assert asset_key("web", canonical_target("web", "example.com")) == asset_key(
        "web", canonical_target("web", "https://example.com/")
    )


def test_duplicate_in_and_out_becomes_conflict() -> None:
    snap = build_snapshot(
        "p1",
        [
            raw("example.com", kind="in"),
            raw("https://example.com/", kind="out"),
        ],
    )
    assert snap.counts.total == 1
    assert snap.assets[0].kind == "conflict"
    assert snap.confidence == "low"


def test_hash_is_order_independent_and_ignores_source_ids() -> None:
    a = [raw("a.example", source_ids=["1"]), raw("b.example", family="api", source_ids=["2"])]
    b = [raw("b.example", family="api", source_ids=["999"]), raw("a.example", source_ids=["888"])]
    snap_a = build_snapshot("p1", a)
    snap_b = build_snapshot("p1", b)
    assert snap_a.hash == snap_b.hash
    snap_c = build_snapshot("p1", a + [raw("c.example")])
    assert snap_a.hash != snap_c.hash


def test_counts_and_bounty_eligible() -> None:
    snap = build_snapshot(
        "p1",
        [
            raw("a.example", bounty_eligible=True, bounty_tier="Tier 1"),
            raw("b.example", kind="out"),
            raw("c.example", bounty_eligible=False),
        ],
    )
    counts = count_assets(snap.assets)
    assert counts.in_scope == 2
    assert counts.out_of_scope == 1
    assert counts.total == 3
    assert counts.bounty_eligible == 1


def test_display_and_key_are_stable() -> None:
    snap = build_snapshot("p1", [raw("https://Example.com/Path/", name="Path")])
    asset = snap.assets[0]
    assert asset.key == "web|https://example.com/Path"
    assert asset.display == "Path"
    assert snapshot_hash(snap.assets, snap.groups) == snap.hash
