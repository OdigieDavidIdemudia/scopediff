from __future__ import annotations

import json
import os
import threading
from abc import ABC, abstractmethod
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.models import (
    Asset,
    Change,
    ChangeItem,
    PlatformStatus,
    Program,
    Snapshot,
    SourceRun,
    Version,
)


class StoreError(Exception):
    pass


def _change_doc(change: Change, items_count: int = 0) -> dict[str, Any]:
    doc = change.model_dump(mode="json")
    doc["items"] = []
    doc["items_count"] = items_count
    return doc


def _strip_hidden(doc: dict[str, Any]) -> dict[str, Any]:
    doc = dict(doc)
    doc.pop("hidden", None)
    return doc


class Store(ABC):
    @abstractmethod
    def get_program(self, program_id: str) -> Program | None: ...

    @abstractmethod
    def list_programs(self) -> list[Program]: ...

    @abstractmethod
    def upsert_program(self, program: Program) -> None: ...

    @abstractmethod
    def get_snapshot(self, program_id: str, version: int) -> Snapshot | None: ...

    @abstractmethod
    def get_current_snapshot(self, program_id: str) -> Snapshot | None: ...

    @abstractmethod
    def commit(
        self,
        *,
        program: Program,
        snapshot: Snapshot,
        change: Change,
        items: list[ChangeItem],
        run: SourceRun | None = None,
    ) -> None: ...

    @abstractmethod
    def update_change(self, change: Change) -> None: ...

    @abstractmethod
    def get_change(self, change_id: str) -> Change | None: ...

    @abstractmethod
    def list_changes(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        program_id: str | None = None,
        platform: str | None = None,
        impact: str | None = None,
        confidence: str | None = None,
        status: str | None = None,
        q: str | None = None,
    ) -> list[Change]: ...

    @abstractmethod
    def get_items(self, change_id: str) -> list[ChangeItem]: ...

    @abstractmethod
    def list_versions(self, program_id: str) -> list[Version]: ...

    @abstractmethod
    def list_assets(self, program_id: str) -> list[Asset]: ...

    @abstractmethod
    def ever_seen_keys(self, program_id: str) -> set[str]: ...

    @abstractmethod
    def get_pending(self, program_id: str) -> Snapshot | None: ...

    @abstractmethod
    def set_pending(self, program_id: str, snapshot: Snapshot) -> None: ...

    @abstractmethod
    def clear_pending(self, program_id: str) -> None: ...

    @abstractmethod
    def record_run(self, run: SourceRun) -> None: ...

    @abstractmethod
    def list_runs(self, limit: int = 20) -> list[SourceRun]: ...

    @abstractmethod
    def platform_status(self) -> list[PlatformStatus]: ...


def _empty() -> dict[str, Any]:
    return {
        "programs": {},
        "versions": {},
        "snapshots": {},
        "changes": {},
        "items": {},
        "pending": {},
        "runs": [],
    }


class JsonStore(Store):
    """Single-file store for the demo, tests, and local development.

    The whole file is rewritten atomically on every commit. That is more than
    enough for a hackathon demo and keeps the data easy to inspect.
    """

    def __init__(self, path: Path | None, demo_path: Path | None = None):
        self.path = path
        self.demo_path = demo_path
        self._lock = threading.RLock()
        self._data = _empty()
        if path and path.exists():
            self._load_file()
        elif demo_path and demo_path.exists():
            self.load_demo(demo_path)
        if path and not path.exists():
            self._save()

    def _load_file(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))  # type: ignore[union-attr]
        except (OSError, json.JSONDecodeError) as exc:
            raise StoreError(f"Could not read store {self.path}: {exc}") from exc
        data = _empty()
        data.update(raw)
        # Only snapshots with a committed version are part of published history.
        # The demo dataset keeps v8 snapshot data for the web fixture but omits
        # its version document until the simulation publishes it.
        snapshots = {}
        for program_id, version_map in data["versions"].items():
            allowed = set(version_map)
            snapshots[program_id] = {
                version: snapshot
                for version, snapshot in (data["snapshots"].get(program_id) or {}).items()
                if version in allowed
            }
        data["snapshots"] = snapshots
        self._data = data

    def load_demo(self, path: Path) -> None:
        raw = json.loads(path.read_text(encoding="utf-8"))
        data = _empty()
        for program in raw.get("programs") or []:
            data["programs"][program["id"]] = program

        versions: dict[str, dict[str, Any]] = defaultdict(dict)
        for version in raw.get("versions") or []:
            versions[version["program_id"]][str(version["version"])] = version
        data["versions"] = dict(versions)

        snapshots: dict[str, dict[str, Any]] = defaultdict(dict)
        for snapshot in raw.get("snapshots") or []:
            program_versions = versions.get(snapshot["program_id"], {})
            if str(snapshot["version"]) not in program_versions:
                continue
            snapshots[snapshot["program_id"]][str(snapshot["version"])] = snapshot
        data["snapshots"] = dict(snapshots)

        changes: dict[str, Any] = {}
        for change in raw.get("changes") or []:
            if change.get("hidden"):
                continue
            changes[change["id"]] = _strip_hidden(change)
        data["changes"] = changes

        items: dict[str, list[Any]] = defaultdict(list)
        for item in raw.get("items") or []:
            if item.get("change_id") in changes:
                items[item["change_id"]].append(item)
        data["items"] = dict(items)
        data["runs"] = raw.get("runs") or []
        self._data = data
        if self.path:
            self._save()

    def _save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(
            json.dumps(self._data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        os.replace(tmp, self.path)

    def get_program(self, program_id: str) -> Program | None:
        with self._lock:
            doc = self._data["programs"].get(program_id)
        return Program.model_validate(doc) if doc else None

    def list_programs(self) -> list[Program]:
        with self._lock:
            docs = list(self._data["programs"].values())
        return sorted(
            [Program.model_validate(d) for d in docs],
            key=lambda p: (p.platform, p.name.lower()),
        )

    def upsert_program(self, program: Program) -> None:
        with self._lock:
            self._data["programs"][program.id] = program.model_dump(mode="json")
            self._save()

    def get_snapshot(self, program_id: str, version: int) -> Snapshot | None:
        with self._lock:
            doc = self._data["snapshots"].get(program_id, {}).get(str(version))
        return Snapshot.model_validate(doc) if doc else None

    def get_current_snapshot(self, program_id: str) -> Snapshot | None:
        program = self.get_program(program_id)
        if not program or not program.current_version:
            return None
        return self.get_snapshot(program_id, program.current_version)

    def commit(
        self,
        *,
        program: Program,
        snapshot: Snapshot,
        change: Change,
        items: list[ChangeItem],
        run: SourceRun | None = None,
    ) -> None:
        with self._lock:
            self._data["programs"][program.id] = program.model_dump(mode="json")
            self._data["versions"].setdefault(program.id, {})[
                str(snapshot.version)
            ] = Version(
                program_id=program.id,
                version=snapshot.version,
                hash=snapshot.hash,
                captured_at=snapshot.captured_at,
                source_revision_id=snapshot.source_revision_id,
                source_published_at=snapshot.source_published_at,
                source_url=snapshot.source_url,
                is_baseline=change.is_baseline,
                confidence=snapshot.confidence,
                counts=snapshot.counts,
                change_id=None if change.is_baseline else change.id,
            ).model_dump(mode="json")
            self._data["snapshots"].setdefault(program.id, {})[
                str(snapshot.version)
            ] = snapshot.model_dump(mode="json")
            self._data["changes"][change.id] = _change_doc(change, len(items))
            self._data["items"][change.id] = [
                item.model_dump(mode="json") for item in items
            ]
            if run:
                self._data["runs"] = [
                    r for r in self._data["runs"] if r.get("id") != run.id
                ] + [run.model_dump(mode="json")]
            self._data["pending"].pop(program.id, None)
            self._save()

    def update_change(self, change: Change) -> None:
        with self._lock:
            existing = self._data["changes"].get(change.id, {})
            doc = _change_doc(change, int(existing.get("items_count") or 0))
            # Keep any fields the caller didn't set.
            merged = {**existing, **doc}
            self._data["changes"][change.id] = merged
            self._save()

    def get_change(self, change_id: str) -> Change | None:
        with self._lock:
            doc = self._data["changes"].get(change_id)
        return Change.model_validate(doc) if doc else None

    def list_changes(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        program_id: str | None = None,
        platform: str | None = None,
        impact: str | None = None,
        confidence: str | None = None,
        status: str | None = None,
        q: str | None = None,
    ) -> list[Change]:
        with self._lock:
            docs = list(self._data["changes"].values())
        rows = [Change.model_validate(d) for d in docs]
        if program_id:
            rows = [c for c in rows if c.program_id == program_id]
        if platform:
            rows = [c for c in rows if c.platform == platform]
        if impact:
            rows = [c for c in rows if c.impact == impact]
        if confidence:
            rows = [c for c in rows if c.confidence == confidence]
        if status:
            rows = [c for c in rows if c.status == status]
        if q:
            needle = q.lower()
            rows = [
                c
                for c in rows
                if needle in c.program_name.lower()
                or any(needle in (i.display or "").lower() for i in c.items_preview)
            ]
        rows.sort(key=lambda c: c.detected_at, reverse=True)
        return rows[offset : offset + limit]

    def get_items(self, change_id: str) -> list[ChangeItem]:
        with self._lock:
            docs = list(self._data["items"].get(change_id, []))
        return sorted(
            [ChangeItem.model_validate(d) for d in docs],
            key=lambda i: (-i.materiality_score, i.kind, i.display),
        )

    def list_versions(self, program_id: str) -> list[Version]:
        with self._lock:
            docs = list(self._data["versions"].get(program_id, {}).values())
        return sorted(
            [Version.model_validate(d) for d in docs],
            key=lambda v: v.version,
            reverse=True,
        )

    def list_assets(self, program_id: str) -> list[Asset]:
        snapshot = self.get_current_snapshot(program_id)
        return snapshot.assets if snapshot else []

    def ever_seen_keys(self, program_id: str) -> set[str]:
        """Keys from committed versions only.

        Hidden demo snapshots are deliberately excluded until a version is
        published, otherwise the first real change would be misclassified as a
        reintroduction.
        """
        with self._lock:
            versions = self._data["versions"].get(program_id, {})
            snapshots = self._data["snapshots"].get(program_id, {})
        keys: set[str] = set()
        for version_doc in versions.values():
            snapshot = snapshots.get(str(version_doc["version"]))
            if snapshot:
                keys.update(asset["key"] for asset in snapshot.get("assets") or [])
        return keys

    def get_pending(self, program_id: str) -> Snapshot | None:
        with self._lock:
            doc = self._data["pending"].get(program_id)
        return Snapshot.model_validate(doc) if doc else None

    def set_pending(self, program_id: str, snapshot: Snapshot) -> None:
        with self._lock:
            self._data["pending"][program_id] = snapshot.model_dump(mode="json")
            self._save()

    def clear_pending(self, program_id: str) -> None:
        with self._lock:
            self._data["pending"].pop(program_id, None)
            self._save()

    def record_run(self, run: SourceRun) -> None:
        with self._lock:
            self._data["runs"] = [
                r for r in self._data["runs"] if r.get("id") != run.id
            ] + [run.model_dump(mode="json")]
            self._save()

    def list_runs(self, limit: int = 20) -> list[SourceRun]:
        with self._lock:
            docs = list(self._data["runs"])
        rows = [SourceRun.model_validate(d) for d in docs]
        rows.sort(key=lambda r: r.started_at, reverse=True)
        return rows[:limit]

    def platform_status(self) -> list[PlatformStatus]:
        programs = self.list_programs()
        runs = self.list_runs(200)
        names = {
            "bugcrowd": "Bugcrowd",
            "hackerone": "HackerOne",
            "intigriti": "Intigriti",
            "sandbox": "Sandbox",
        }
        result: list[PlatformStatus] = []
        for platform, name in names.items():
            platform_programs = [p for p in programs if p.platform == platform]
            platform_runs = [r for r in runs if r.platform == platform]
            last = platform_runs[0] if platform_runs else None
            if not last:
                status = "unknown"
                message = "No sync yet"
                latency = None
            elif last.status == "error":
                status = "error"
                message = last.error or "Last sync failed"
                latency = last.latency_ms
            elif last.status == "warn":
                status = "warn"
                message = "; ".join(last.notes) or "Completed with warnings"
                latency = last.latency_ms
            elif last.status == "running":
                status = "warn"
                message = "Sync in progress"
                latency = None
            else:
                status = "ok"
                label = "program" if last.programs_seen == 1 else "programs"
                message = f"{last.programs_seen} {label} checked"
                latency = last.latency_ms
            result.append(
                PlatformStatus(
                    id=platform,
                    name=name,
                    status=status,  # type: ignore[arg-type]
                    last_run_at=last.finished_at or last.started_at if last else None,
                    programs_count=len(platform_programs),
                    latency_ms=latency,
                    message=message,
                )
            )
        return result


class FirestoreStore(Store):
    """Firestore-backed store used when SCOPEDIFF_STORE=firestore.

    Schema:
      programs/{id}
      programs/{id}/versions/{version}   (snapshot JSON or GCS path)
      programs/{id}/pending/current
      changes/{id}
      changes/{id}/items/{item_id}
      source_runs/{id}

    Snapshots above 900 KB are written to Cloud Storage instead of Firestore.
    """

    def __init__(self, project: str | None = None, bucket: str | None = None):
        try:
            from google.cloud import firestore
        except ImportError as exc:
            raise StoreError(
                "Firestore mode needs google-cloud-firestore. "
                "Install worker/requirements.txt or set SCOPEDIFF_STORE=json."
            ) from exc
        self._firestore = firestore
        self.db = firestore.Client(project=project)
        self.bucket_name = bucket

    def _version_ref(self, program_id: str, version: int):
        return (
            self.db.collection("programs")
            .document(program_id)
            .collection("versions")
            .document(str(version))
        )

    def _pending_ref(self, program_id: str):
        return (
            self.db.collection("programs")
            .document(program_id)
            .collection("pending")
            .document("current")
        )

    def get_program(self, program_id: str) -> Program | None:
        doc = self.db.collection("programs").document(program_id).get()
        return Program.model_validate(doc.to_dict()) if doc.exists else None

    def list_programs(self) -> list[Program]:
        rows = [
            Program.model_validate(doc.to_dict())
            for doc in self.db.collection("programs").stream()
        ]
        return sorted(rows, key=lambda p: (p.platform, p.name.lower()))

    def upsert_program(self, program: Program) -> None:
        self.db.collection("programs").document(program.id).set(
            program.model_dump(mode="json")
        )

    def _snapshot_fields(self, program_id: str, snapshot: Snapshot) -> dict[str, Any]:
        payload = snapshot.model_dump(mode="json")
        size = len(json.dumps(payload).encode("utf-8"))
        if size <= 900_000:
            return {"snapshot": payload}
        if not self.bucket_name:
            raise StoreError(
                f"Snapshot for {program_id} is {size} bytes; set SCOPEDIFF_SNAPSHOT_BUCKET "
                "to store large snapshots in Cloud Storage."
            )
        from google.cloud import storage

        blob_path = f"snapshots/{program_id}/{snapshot.version}.json"
        blob = storage.Client().bucket(self.bucket_name).blob(blob_path)
        blob.upload_from_string(
            json.dumps(payload), content_type="application/json"
        )
        return {"snapshot_gcs_path": f"gs://{self.bucket_name}/{blob_path}"}

    def get_snapshot(self, program_id: str, version: int) -> Snapshot | None:
        doc = self._version_ref(program_id, version).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        if data.get("snapshot"):
            return Snapshot.model_validate(data["snapshot"])
        path = data.get("snapshot_gcs_path")
        if not path:
            return None
        from google.cloud import storage

        if not path.startswith("gs://"):
            raise StoreError(f"Invalid snapshot path: {path}")
        bucket_name, blob_path = path[5:].split("/", 1)
        blob = storage.Client().bucket(bucket_name).blob(blob_path)
        return Snapshot.model_validate(json.loads(blob.download_as_text()))

    def get_current_snapshot(self, program_id: str) -> Snapshot | None:
        program = self.get_program(program_id)
        if not program or not program.current_version:
            return None
        return self.get_snapshot(program_id, program.current_version)

    def commit(
        self,
        *,
        program: Program,
        snapshot: Snapshot,
        change: Change,
        items: list[ChangeItem],
        run: SourceRun | None = None,
    ) -> None:
        # Write items first so a reader never sees a change doc with no items.
        change_ref = self.db.collection("changes").document(change.id)
        for start in range(0, len(items), 400):
            batch = self.db.batch()
            for item in items[start : start + 400]:
                batch.set(change_ref.collection("items").document(item.id), item.model_dump(mode="json"))
            batch.commit()

        batch = self.db.batch()
        batch.set(
            self.db.collection("programs").document(program.id),
            program.model_dump(mode="json"),
        )
        version_doc = Version(
            program_id=program.id,
            version=snapshot.version,
            hash=snapshot.hash,
            captured_at=snapshot.captured_at,
            source_revision_id=snapshot.source_revision_id,
            source_published_at=snapshot.source_published_at,
            source_url=snapshot.source_url,
            is_baseline=change.is_baseline,
            confidence=snapshot.confidence,
            counts=snapshot.counts,
            change_id=None if change.is_baseline else change.id,
        ).model_dump(mode="json")
        version_doc.update(self._snapshot_fields(program.id, snapshot))
        batch.set(self._version_ref(program.id, snapshot.version), version_doc)
        batch.set(change_ref, _change_doc(change, len(items)))
        if run:
            batch.set(self.db.collection("source_runs").document(run.id), run.model_dump(mode="json"))
        batch.delete(self._pending_ref(program.id))
        batch.commit()

    def update_change(self, change: Change) -> None:
        ref = self.db.collection("changes").document(change.id)
        current = ref.get()
        items_count = (current.to_dict() or {}).get("items_count", 0) if current.exists else 0
        ref.set(_change_doc(change, int(items_count)), merge=True)

    def get_change(self, change_id: str) -> Change | None:
        doc = self.db.collection("changes").document(change_id).get()
        return Change.model_validate(doc.to_dict()) if doc.exists else None

    def list_changes(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        program_id: str | None = None,
        platform: str | None = None,
        impact: str | None = None,
        confidence: str | None = None,
        status: str | None = None,
        q: str | None = None,
    ) -> list[Change]:
        query = self.db.collection("changes")
        if program_id:
            query = query.where("program_id", "==", program_id)
        if platform:
            query = query.where("platform", "==", platform)
        if impact:
            query = query.where("impact", "==", impact)
        if confidence:
            query = query.where("confidence", "==", confidence)
        if status:
            query = query.where("status", "==", status)
        query = query.order_by(
            "detected_at", direction=self._firestore.Query.DESCENDING
        ).limit(limit).offset(offset)
        rows = [Change.model_validate(doc.to_dict()) for doc in query.stream()]
        if q:
            needle = q.lower()
            rows = [
                c
                for c in rows
                if needle in c.program_name.lower()
                or any(needle in (i.display or "").lower() for i in c.items_preview)
            ]
        return rows

    def get_items(self, change_id: str) -> list[ChangeItem]:
        docs = (
            self.db.collection("changes")
            .document(change_id)
            .collection("items")
            .order_by("materiality_score", direction=self._firestore.Query.DESCENDING)
            .stream()
        )
        return [ChangeItem.model_validate(doc.to_dict()) for doc in docs]

    def list_versions(self, program_id: str) -> list[Version]:
        docs = (
            self.db.collection("programs")
            .document(program_id)
            .collection("versions")
            .order_by("version", direction=self._firestore.Query.DESCENDING)
            .stream()
        )
        return [Version.model_validate(doc.to_dict()) for doc in docs]

    def list_assets(self, program_id: str) -> list[Asset]:
        snapshot = self.get_current_snapshot(program_id)
        return snapshot.assets if snapshot else []

    def ever_seen_keys(self, program_id: str) -> set[str]:
        snapshot = self.get_current_snapshot(program_id)
        return {a.key for a in snapshot.assets} if snapshot else set()

    def get_pending(self, program_id: str) -> Snapshot | None:
        doc = self._pending_ref(program_id).get()
        return Snapshot.model_validate(doc.to_dict()) if doc.exists else None

    def set_pending(self, program_id: str, snapshot: Snapshot) -> None:
        self._pending_ref(program_id).set(snapshot.model_dump(mode="json"))

    def clear_pending(self, program_id: str) -> None:
        self._pending_ref(program_id).delete()

    def record_run(self, run: SourceRun) -> None:
        self.db.collection("source_runs").document(run.id).set(
            run.model_dump(mode="json")
        )

    def list_runs(self, limit: int = 20) -> list[SourceRun]:
        query = (
            self.db.collection("source_runs")
            .order_by("started_at", direction=self._firestore.Query.DESCENDING)
            .limit(limit)
        )
        return [SourceRun.model_validate(doc.to_dict()) for doc in query.stream()]

    def platform_status(self) -> list[PlatformStatus]:
        programs = self.list_programs()
        runs = self.list_runs(200)
        names = {
            "bugcrowd": "Bugcrowd",
            "hackerone": "HackerOne",
            "intigriti": "Intigriti",
            "sandbox": "Sandbox",
        }
        result: list[PlatformStatus] = []
        for platform, name in names.items():
            platform_programs = [p for p in programs if p.platform == platform]
            platform_runs = [r for r in runs if r.platform == platform]
            last = platform_runs[0] if platform_runs else None
            status = "unknown" if not last else (
                "error" if last.status == "error" else
                "warn" if last.status in {"warn", "running"} else "ok"
            )
            result.append(
                PlatformStatus(
                    id=platform,
                    name=name,
                    status=status,  # type: ignore[arg-type]
                    last_run_at=(last.finished_at or last.started_at) if last else None,
                    programs_count=len(platform_programs),
                    latency_ms=last.latency_ms if last else None,
                    message=(last.error or "; ".join(last.notes) or "No sync yet") if last else "No sync yet",
                )
            )
        return result


def get_store() -> Store:
    settings = get_settings()
    kind = settings.store_kind
    if kind == "firestore":
        return FirestoreStore(project=settings.gcp_project, bucket=settings.snapshot_bucket)
    path = None if kind == "memory" else settings.db_path
    return JsonStore(path, demo_path=settings.demo_data_path if settings.demo else None)
