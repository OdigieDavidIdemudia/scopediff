from __future__ import annotations

import pytest

from app.adapters.links import UnsupportedProgramLink, parse_program_url


@pytest.mark.parametrize(
    ("url", "platform", "handle"),
    [
        ("https://bugcrowd.com/acme", "bugcrowd", "acme"),
        ("https://bugcrowd.com/engagements/acme/", "bugcrowd", "acme"),
        ("https://hackerone.com/rails", "hackerone", "rails"),
        ("https://hackerone.com/opportunities/rails", "hackerone", "rails"),
        (
            "https://app.intigriti.com/programs/cmcom/cmcom/detail",
            "intigriti",
            "cmcom/cmcom",
        ),
    ],
)
def test_parse_supported_program_urls(url: str, platform: str, handle: str) -> None:
    ref = parse_program_url(url)
    assert ref.platform == platform
    assert ref.handle == handle


def test_parse_rejects_unknown_and_bad_urls() -> None:
    with pytest.raises(UnsupportedProgramLink):
        parse_program_url("https://example.com/program")
    with pytest.raises(UnsupportedProgramLink):
        parse_program_url("not-a-url")
    with pytest.raises(UnsupportedProgramLink):
        parse_program_url("https://app.intigriti.com/programs/only-one")
