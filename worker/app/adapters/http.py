from __future__ import annotations

import time
from typing import Any

import requests


class FetchError(Exception):
    pass


class HttpClient:
    """Small retrying JSON client.

    Keeping this explicit (rather than pulling in a large HTTP framework)
    makes the adapters easy to test and easy to read during a demo.
    """

    def __init__(self, *, user_agent: str, timeout: int = 30, retries: int = 3):
        self.timeout = timeout
        self.retries = retries
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": user_agent,
                "Accept": "application/json",
            }
        )

    def get_json(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        auth: tuple[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                response = self.session.get(
                    url,
                    params=params,
                    auth=auth,
                    headers=headers,
                    timeout=self.timeout,
                )
                if response.status_code == 200:
                    return response.json()
                if response.status_code in {429, 500, 502, 503, 504} and attempt < self.retries:
                    retry_after = response.headers.get("Retry-After")
                    delay = float(retry_after) if retry_after and retry_after.isdigit() else 1.5 * (attempt + 1)
                    time.sleep(min(delay, 10))
                    continue
                raise FetchError(
                    f"GET {url} returned {response.status_code}: {response.text[:200]}"
                )
            except requests.RequestException as exc:
                last_error = exc
                if attempt >= self.retries:
                    break
                time.sleep(1.5 * (attempt + 1))
        raise FetchError(f"GET {url} failed after {self.retries + 1} attempts: {last_error}")

    def close(self) -> None:
        self.session.close()
