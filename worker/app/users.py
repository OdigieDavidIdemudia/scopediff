from __future__ import annotations

import json
import os
import threading
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException
from pydantic import BaseModel

from urllib.parse import urlsplit

from app.config import get_settings
from app.models import Change, ChangeItem, UserPreferences, UserProfile, Watch, utcnow


class AuthUser(BaseModel):
    uid: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None


def _firebase_app() -> None:
    import firebase_admin
    from firebase_admin import credentials

    if firebase_admin._apps:
        return
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if path and Path(path).exists():
        cred = credentials.Certificate(path)
    else:
        cred = credentials.ApplicationDefault()
    project = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCLOUD_PROJECT") or "scopediff"
    firebase_admin.initialize_app(cred, {"projectId": project})


def current_user(authorization: str | None = Header(default=None)) -> AuthUser:
    settings = get_settings()
    if settings.allow_insecure_auth:
        return AuthUser(
            uid=settings.debug_uid,
            email=f"{settings.debug_uid}@scopediff.local",
            name="Debug Hunter",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in with a Firebase account.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        from firebase_admin import auth

        _firebase_app()
        decoded = auth.verify_id_token(token, check_revoked=False)
    except Exception as exc:  # noqa: BLE001 - Firebase raises several types
        raise HTTPException(status_code=401, detail="Invalid or expired session.") from exc
    return AuthUser(
        uid=str(decoded["uid"]),
        email=decoded.get("email"),
        name=decoded.get("name"),
        picture=decoded.get("picture"),
    )


class UserRepository(ABC):
    @abstractmethod
    def get_profile(self, uid: str) -> UserProfile | None: ...

    @abstractmethod
    def ensure_profile(self, user: AuthUser) -> UserProfile: ...

    @abstractmethod
    def save_preferences(self, uid: str, prefs: UserPreferences) -> UserProfile: ...

    @abstractmethod
    def list_watches(self, uid: str) -> list[Watch]: ...

    @abstractmethod
    def get_watch(self, uid: str, program_id: str) -> Watch | None: ...

    @abstractmethod
    def upsert_watch(self, watch: Watch) -> Watch: ...

    @abstractmethod
    def delete_watch(self, uid: str, program_id: str) -> None: ...

    @abstractmethod
    def list_due_watches(self, now: datetime) -> list[Watch]: ...

    @abstractmethod
    def list_watchers(self, program_id: str) -> list[Watch]: ...


def _new_profile(user: AuthUser) -> UserProfile:
    return UserProfile(
        uid=user.uid,
        email=user.email,
        name=(user.name or user.email or "Hunter").strip(),
        photo_url=user.picture,
        preferences=UserPreferences(updated_at=utcnow()),
        created_at=utcnow(),
        updated_at=utcnow(),
    )


def _touch_watch(watch: Watch, now: datetime) -> Watch:
    return watch.model_copy(
        update={
            "last_checked_at": now,
            "next_check_at": now + timedelta(minutes=max(1, watch.interval_minutes)),
        }
    )


class JsonUserRepository(UserRepository):
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        self._data: dict[str, Any] = {"profiles": {}, "watches": {}}
        if path.exists():
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                self._data["profiles"] = raw.get("profiles") or {}
                self._data["watches"] = raw.get("watches") or {}
            except (OSError, json.JSONDecodeError):
                self._data = {"profiles": {}, "watches": {}}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix(".tmp")
        temp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
        temp.replace(self.path)

    def get_profile(self, uid: str) -> UserProfile | None:
        with self._lock:
            doc = self._data["profiles"].get(uid)
        return UserProfile.model_validate(doc) if doc else None

    def ensure_profile(self, user: AuthUser) -> UserProfile:
        with self._lock:
            doc = self._data["profiles"].get(user.uid)
            if doc:
                profile = UserProfile.model_validate(doc)
                updates: dict[str, Any] = {"updated_at": utcnow()}
                if user.email and profile.email != user.email:
                    updates["email"] = user.email
                if user.name and profile.name != user.name:
                    updates["name"] = user.name
                if user.picture and profile.photo_url != user.picture:
                    updates["photo_url"] = user.picture
                profile = profile.model_copy(update=updates)
            else:
                profile = _new_profile(user)
            self._data["profiles"][user.uid] = profile.model_dump(mode="json")
            self._save()
            return profile

    def save_preferences(self, uid: str, prefs: UserPreferences) -> UserProfile:
        with self._lock:
            doc = self._data["profiles"].get(uid)
            if not doc:
                raise KeyError("Profile not found")
            profile = UserProfile.model_validate(doc)
            profile = profile.model_copy(
                update={
                    "preferences": prefs.model_copy(update={"updated_at": utcnow()}),
                    "updated_at": utcnow(),
                }
            )
            self._data["profiles"][uid] = profile.model_dump(mode="json")
            self._save()
            return profile

    def list_watches(self, uid: str) -> list[Watch]:
        with self._lock:
            rows = list((self._data["watches"].get(uid) or {}).values())
        watches = [Watch.model_validate(row) for row in rows]
        watches.sort(key=lambda row: row.created_at, reverse=True)
        return watches

    def get_watch(self, uid: str, program_id: str) -> Watch | None:
        with self._lock:
            doc = (self._data["watches"].get(uid) or {}).get(program_id)
        return Watch.model_validate(doc) if doc else None

    def upsert_watch(self, watch: Watch) -> Watch:
        with self._lock:
            self._data["watches"].setdefault(watch.uid, {})[watch.program_id] = watch.model_dump(
                mode="json"
            )
            self._save()
        return watch

    def delete_watch(self, uid: str, program_id: str) -> None:
        with self._lock:
            bucket = self._data["watches"].get(uid) or {}
            bucket.pop(program_id, None)
            self._data["watches"][uid] = bucket
            self._save()

    def list_due_watches(self, now: datetime) -> list[Watch]:
        with self._lock:
            buckets = list((self._data["watches"] or {}).values())
        due: list[Watch] = []
        for bucket in buckets:
            for row in bucket.values():
                watch = Watch.model_validate(row)
                if watch.active and watch.next_check_at <= now:
                    due.append(watch)
        return due

    def list_watchers(self, program_id: str) -> list[Watch]:
        with self._lock:
            buckets = list((self._data["watches"] or {}).values())
        rows: list[Watch] = []
        for bucket in buckets:
            row = bucket.get(program_id)
            if row:
                watch = Watch.model_validate(row)
                if watch.active:
                    rows.append(watch)
        return rows


class FirestoreUserRepository(UserRepository):
    def __init__(self) -> None:
        from firebase_admin import firestore

        _firebase_app()
        self.db = firestore.client()

    def _profile_ref(self, uid: str):
        return self.db.collection("users").document(uid)

    def _watch_ref(self, uid: str, program_id: str):
        return self._profile_ref(uid).collection("watches").document(program_id)

    def get_profile(self, uid: str) -> UserProfile | None:
        doc = self._profile_ref(uid).get()
        return UserProfile.model_validate(doc.to_dict()) if doc.exists else None

    def ensure_profile(self, user: AuthUser) -> UserProfile:
        ref = self._profile_ref(user.uid)
        doc = ref.get()
        if doc.exists:
            profile = UserProfile.model_validate(doc.to_dict())
            updates: dict[str, Any] = {"updated_at": utcnow()}
            if user.email and profile.email != user.email:
                updates["email"] = user.email
            if user.name and profile.name != user.name:
                updates["name"] = user.name
            if user.picture and profile.photo_url != user.picture:
                updates["photo_url"] = user.picture
            profile = profile.model_copy(update=updates)
            ref.set({"email": profile.email, "name": profile.name, "photo_url": profile.photo_url, "updated_at": profile.updated_at}, merge=True)
            return profile
        profile = _new_profile(user)
        ref.set(profile.model_dump(mode="python"))
        return profile

    def save_preferences(self, uid: str, prefs: UserPreferences) -> UserProfile:
        ref = self._profile_ref(uid)
        doc = ref.get()
        if not doc.exists:
            raise KeyError("Profile not found")
        profile = UserProfile.model_validate(doc.to_dict())
        prefs = prefs.model_copy(update={"updated_at": utcnow()})
        profile = profile.model_copy(update={"preferences": prefs, "updated_at": utcnow()})
        ref.set(
            {
                "preferences": prefs.model_dump(mode="python"),
                "updated_at": profile.updated_at,
            },
            merge=True,
        )
        return profile

    def list_watches(self, uid: str) -> list[Watch]:
        docs = self._profile_ref(uid).collection("watches").stream()
        watches = [Watch.model_validate(doc.to_dict()) for doc in docs]
        watches.sort(key=lambda row: row.created_at, reverse=True)
        return watches

    def get_watch(self, uid: str, program_id: str) -> Watch | None:
        doc = self._watch_ref(uid, program_id).get()
        return Watch.model_validate(doc.to_dict()) if doc.exists else None

    def upsert_watch(self, watch: Watch) -> Watch:
        self._watch_ref(watch.uid, watch.program_id).set(watch.model_dump(mode="python"))
        return watch

    def delete_watch(self, uid: str, program_id: str) -> None:
        self._watch_ref(uid, program_id).delete()

    def list_due_watches(self, now: datetime) -> list[Watch]:
        query = (
            self.db.collection_group("watches")
            .where("active", "==", True)
            .where("next_check_at", "<=", now)
        )
        rows: list[Watch] = []
        for doc in query.stream():
            payload = doc.to_dict() or {}
            payload.setdefault("uid", doc.reference.parent.parent.id)
            rows.append(Watch.model_validate(payload))
        return rows

    def list_watchers(self, program_id: str) -> list[Watch]:
        query = (
            self.db.collection_group("watches")
            .where("program_id", "==", program_id)
            .where("active", "==", True)
        )
        rows: list[Watch] = []
        for doc in query.stream():
            payload = doc.to_dict() or {}
            payload.setdefault("uid", doc.reference.parent.parent.id)
            rows.append(Watch.model_validate(payload))
        return rows


@lru_cache(maxsize=1)
def get_user_store() -> UserRepository:
    settings = get_settings()
    if settings.store_kind == "firestore":
        return FirestoreUserRepository()
    return JsonUserRepository(settings.data_dir / "users.json")


def schedule_watch(watch: Watch, now: datetime | None = None) -> Watch:
    start = now or utcnow()
    return watch.model_copy(
        update={
            "last_checked_at": start,
            "next_check_at": start + timedelta(minutes=max(1, watch.interval_minutes)),
        }
    )


def reschedule_watch(watch: Watch, now: datetime | None = None) -> Watch:
    return _touch_watch(watch, now or utcnow())


def _normalize_target(value: str) -> str:
    out = (value or "").strip().lower()
    if "://" in out:
        parsed = urlsplit(out)
        out = f"{parsed.netloc}{parsed.path}".rstrip("/")
    return out.rstrip("/")


def _host(value: str) -> str:
    return _normalize_target(value).split("/")[0].split("?")[0]


def _target_matches(pattern: str, value: str) -> bool:
    needle = _normalize_target(pattern)
    candidate = _normalize_target(value)
    if not needle or not candidate:
        return False
    if needle == candidate:
        return True
    wildcard = needle.startswith("*.")
    if wildcard:
        bare = needle[2:]
        host = _host(candidate)
        return host == bare or host.endswith(f".{bare}")
    return _host(needle) == _host(candidate)


def item_matches_targets(item: ChangeItem, targets: list[str]) -> bool:
    values = [item.target]
    for side in (item.before, item.after):
        if side:
            values.extend(str(side.get(key) or "") for key in ("canonical", "target"))
    return any(_target_matches(target, value) for target in targets for value in values)


def change_matches_targets(change: Change, items: list[ChangeItem], targets: list[str]) -> bool:
    if not targets:
        return False
    return any(item_matches_targets(item, targets) for item in items)


def watch_should_alert(
    watch: Watch,
    change: Change,
    items: list[ChangeItem],
    preferences: UserPreferences,
) -> bool:
    if change.is_baseline or change.counts.total == 0:
        return False
    if change.materiality_score < watch.min_materiality:
        return False
    if watch.alert_mode == "high" and change.magnitude not in {"high", "critical"}:
        return False
    if watch.alert_mode == "mine" and not change_matches_targets(
        change, items, preferences.testing_targets
    ):
        return False
    return True
