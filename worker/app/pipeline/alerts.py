from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests

from app.models import AlertResult, Change, ChangeItem


class AlertError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hooks_allowed(url: str, allow_any: bool) -> bool:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    if allow_any:
        return True
    return parts.hostname in {"hooks.slack.com", "hooks.slack-gov.com"}


def _counts_line(change: Change) -> str:
    parts = []
    if change.counts.added:
        parts.append(f"+{change.counts.added} added")
    if change.counts.removed:
        parts.append(f"-{change.counts.removed} removed")
    if change.counts.reintroduced:
        parts.append(f"{change.counts.reintroduced} reintroduced")
    if change.counts.modified:
        parts.append(f"~{change.counts.modified} changed")
    if change.counts.moved_in:
        parts.append(f"{change.counts.moved_in} moved in")
    if change.counts.moved_out:
        parts.append(f"{change.counts.moved_out} moved out")
    return " · ".join(parts) or "No target changes"


def _item_line(item: ChangeItem) -> str:
    marker = {"added": "+", "removed": "−", "reintroduced": "↺", "modified": "~", "moved_in": "+", "moved_out": "−"}.get(
        item.kind, "•"
    )
    return f"{marker} `{item.display}` — {item.reasons[0] if item.reasons else item.kind}"


def slack_payload(change: Change, items: list[ChangeItem], public_url: str) -> dict:
    top = items[:4]
    diff_url = f"{public_url.rstrip('/')}/changes/{change.id}"
    return {
        "text": f"ScopeDiff: {change.program_name} changed ({_counts_line(change)})",
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"Scope change: {change.program_name}",
                    "emoji": False,
                },
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"*{change.platform}* · v{change.from_version} → v{change.to_version} · {change.magnitude} · score {change.materiality_score}/100 · {change.confidence} confidence",
                    }
                ],
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "\n".join(_item_line(i) for i in top)
                    or "A scope revision was detected.",
                },
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": " · ".join(change.reasons[:4]) or "No materiality reason recorded",
                    }
                ],
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Open diff", "emoji": False},
                        "url": diff_url,
                        "style": "primary",
                    }
                ],
            },
        ],
    }


class SlackNotifier:
    def __init__(
        self,
        webhook_url: str | None,
        *,
        public_url: str = "http://localhost:5173",
        allow_any: bool = False,
        timeout: int = 10,
    ):
        self.webhook_url = webhook_url
        self.public_url = public_url
        self.allow_any = allow_any
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.webhook_url)

    def send_change(self, change: Change, items: list[ChangeItem]) -> AlertResult:
        if not self.webhook_url:
            return AlertResult(status="skipped", message="Slack webhook not configured")
        if not _hooks_allowed(self.webhook_url, self.allow_any):
            return AlertResult(
                status="failed",
                message="Refusing to post to an unexpected webhook host",
                detail="Set SCOPEDIFF_ALLOW_ANY_WEBHOOK=1 only for local testing.",
            )
        payload = slack_payload(change, items, self.public_url)
        try:
            response = requests.post(
                self.webhook_url, json=payload, timeout=self.timeout
            )
        except requests.RequestException as exc:
            return AlertResult(
                status="failed",
                message="Slack request failed",
                detail=type(exc).__name__,
            )
        if response.status_code >= 300:
            return AlertResult(
                status="failed",
                message=f"Slack returned {response.status_code}",
                detail=response.text[:200],
            )
        return AlertResult(status="sent", message="Slack alert sent")

    def send_test(self) -> AlertResult:
        if not self.webhook_url:
            return AlertResult(status="skipped", message="Slack webhook not configured")
        if not _hooks_allowed(self.webhook_url, self.allow_any):
            return AlertResult(status="failed", message="Unexpected webhook host")
        try:
            response = requests.post(
                self.webhook_url,
                json={
                    "text": "ScopeDiff test alert — your Slack webhook is wired correctly.",
                    "blocks": [
                        {
                            "type": "section",
                            "text": {
                                "type": "mrkdwn",
                                "text": "*ScopeDiff test alert*\nYour Slack webhook is wired correctly. No scope data was fetched.",
                            },
                        }
                    ],
                },
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            return AlertResult(status="failed", message="Slack request failed", detail=type(exc).__name__)
        if response.status_code >= 300:
            return AlertResult(status="failed", message=f"Slack returned {response.status_code}")
        return AlertResult(status="sent", message="Test alert sent")
