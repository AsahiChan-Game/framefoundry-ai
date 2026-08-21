from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self._lock = threading.RLock()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    stage TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    resolution TEXT NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    seed INTEGER,
                    simulated INTEGER NOT NULL DEFAULT 1,
                    target_node TEXT NOT NULL DEFAULT 'h3',
                    workflow_json TEXT,
                    prompt_id TEXT,
                    reference_path TEXT,
                    output_path TEXT,
                    error TEXT,
                    asset_ids_json TEXT NOT NULL DEFAULT '[]'
                )
                """
            )
            job_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(jobs)")
            }
            if "asset_ids_json" not in job_columns:
                connection.execute(
                    "ALTER TABLE jobs ADD COLUMN asset_ids_json TEXT NOT NULL DEFAULT '[]'"
                )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    prompt_hint TEXT NOT NULL DEFAULT '',
                    control TEXT NOT NULL DEFAULT 'reference',
                    file_name TEXT,
                    mime_type TEXT,
                    file_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC)"
            )
            connection.commit()

    def create(self, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        record = {
            "id": values["id"],
            "name": values["name"],
            "prompt": values["prompt"],
            "status": "queued",
            "progress": 0,
            "stage": "等待调度",
            "created_at": now,
            "updated_at": now,
            "mode": values["mode"],
            "resolution": values["resolution"],
            "duration_seconds": values["duration_seconds"],
            "seed": values.get("seed"),
            "simulated": 1 if values.get("simulated", True) else 0,
            "target_node": values.get("target_node", "h3"),
            "workflow_json": json.dumps(values.get("workflow"), ensure_ascii=False)
            if values.get("workflow") is not None
            else None,
            "prompt_id": None,
            "reference_path": values.get("reference_path"),
            "output_path": None,
            "error": None,
            "asset_ids_json": json.dumps(values.get("asset_ids", [])),
        }
        columns = ", ".join(record)
        placeholders = ", ".join(f":{column}" for column in record)
        with self._lock, self._connection() as connection:
            connection.execute(
                f"INSERT INTO jobs ({columns}) VALUES ({placeholders})", record
            )
            connection.commit()
        return self.get(record["id"])

    def get(self, job_id: str, include_workflow: bool = False) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
        if row is None:
            raise KeyError(job_id)
        return self._decode(row, include_workflow=include_workflow)

    def list(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._decode(row) for row in rows]

    def next_queued(self) -> dict[str, Any] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
            ).fetchone()
        return self._decode(row, include_workflow=True) if row else None

    def recover_interrupted(self) -> int:
        now = utc_now()
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE jobs
                SET status = 'failed',
                    stage = '控制 API 意外停止',
                    error = '任务在控制 API 重启前仍处于运行状态；为避免重复提交，已标记失败。',
                    updated_at = ?
                WHERE status = 'running'
                """,
                (now,),
            )
            connection.commit()
        return cursor.rowcount

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        if not changes:
            return self.get(job_id)
        allowed = {
            "status",
            "progress",
            "stage",
            "prompt_id",
            "reference_path",
            "output_path",
            "error",
        }
        unexpected = set(changes) - allowed
        if unexpected:
            raise ValueError(f"Unsupported job fields: {sorted(unexpected)}")
        changes["updated_at"] = utc_now()
        assignments = ", ".join(f"{field} = :{field}" for field in changes)
        values = {**changes, "id": job_id}
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE jobs SET {assignments} WHERE id = :id", values
            )
            connection.commit()
        if cursor.rowcount == 0:
            raise KeyError(job_id)
        return self.get(job_id)

    def create_asset(self, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        record = {
            "id": values["id"],
            "name": values["name"],
            "kind": values["kind"],
            "description": values.get("description", ""),
            "tags_json": json.dumps(values.get("tags", []), ensure_ascii=False),
            "prompt_hint": values.get("prompt_hint", ""),
            "control": values.get("control", "reference"),
            "file_name": values.get("file_name"),
            "mime_type": values.get("mime_type"),
            "file_path": values.get("file_path"),
            "created_at": now,
            "updated_at": now,
        }
        columns = ", ".join(record)
        placeholders = ", ".join(f":{column}" for column in record)
        with self._lock, self._connection() as connection:
            connection.execute(
                f"INSERT INTO assets ({columns}) VALUES ({placeholders})", record
            )
            connection.commit()
        return self.get_asset(record["id"])

    def get_asset(self, asset_id: str) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM assets WHERE id = ?", (asset_id,)
            ).fetchone()
        if row is None:
            raise KeyError(asset_id)
        return self._decode_asset(row)

    def list_assets(self, limit: int = 500) -> list[dict[str, Any]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM assets ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._decode_asset(row) for row in rows]

    def get_assets(self, asset_ids: list[str]) -> list[dict[str, Any]]:
        if not asset_ids:
            return []
        return [self.get_asset(asset_id) for asset_id in asset_ids]

    def asset_paths(self, asset_ids: list[str]) -> list[str]:
        return [
            asset["file_path"]
            for asset in self.get_assets(asset_ids)
            if asset.get("file_path")
        ]

    @staticmethod
    def _decode(row: sqlite3.Row, include_workflow: bool = False) -> dict[str, Any]:
        result = dict(row)
        result["simulated"] = bool(result["simulated"])
        workflow_json = result.pop("workflow_json", None)
        asset_ids_json = result.pop("asset_ids_json", "[]")
        result["asset_ids"] = json.loads(asset_ids_json) if asset_ids_json else []
        if include_workflow:
            result["workflow"] = json.loads(workflow_json) if workflow_json else None
        return result

    @staticmethod
    def _decode_asset(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        tags_json = result.pop("tags_json", "[]")
        result["tags"] = json.loads(tags_json) if tags_json else []
        result["has_file"] = bool(result.get("file_path"))
        return result
