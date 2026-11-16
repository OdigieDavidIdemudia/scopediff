from __future__ import annotations

from urllib.parse import urlsplit

from app.adapters.base import ProgramRef


class UnsupportedProgramLink(ValueError):
    pass


SUPPORTED = (
    "Bugcrowd, HackerOne and Intigriti program links are supported. "
    "Paste the public program page URL."
)


def _path_parts(url: str) -> tuple[str, list[str], str]:
    parsed = urlsplit(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"}:
        raise UnsupportedProgramLink(SUPPORTED)
    parts = [part for part in parsed.path.split("/") if part]
    return host, parts, url.strip()


def parse_program_url(url: str) -> ProgramRef:
    """Turn a supported public program URL into an adapter reference."""
    host, parts, original = _path_parts(url)

    if host in {"bugcrowd.com", "www.bugcrowd.com"}:
        if not parts:
            raise UnsupportedProgramLink("A Bugcrowd program URL needs a handle.")
        if parts[0] in {"engagements", "programs"} and len(parts) > 1:
            handle = parts[1]
        else:
            handle = parts[0]
        return ProgramRef(
            platform="bugcrowd",
            handle=handle,
            url=f"https://bugcrowd.com/{handle}",
        )

    if host in {"hackerone.com", "www.hackerone.com"}:
        if not parts:
            raise UnsupportedProgramLink("A HackerOne program URL needs a handle.")
        if parts[0] in {"opportunities", "programs"} and len(parts) > 1:
            handle = parts[1]
        else:
            handle = parts[0]
        return ProgramRef(
            platform="hackerone",
            handle=handle,
            url=f"https://hackerone.com/{handle}",
        )

    if host in {"app.intigriti.com", "www.intigriti.com"}:
        if "programs" in parts:
            index = parts.index("programs")
            rest = parts[index + 1 :]
            if len(rest) >= 2:
                handle = f"{rest[0]}/{rest[1]}"
                return ProgramRef(
                    platform="intigriti",
                    handle=handle,
                    url=f"https://app.intigriti.com/programs/{handle}/detail",
                )
        raise UnsupportedProgramLink(
            "Use the Intigriti program URL in the form "
            "https://app.intigriti.com/programs/company/program/detail"
        )

    raise UnsupportedProgramLink(SUPPORTED)
