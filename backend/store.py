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
                    asset_ids_json TEXT NOT NULL DEFAULT '[]',
                    night_run_id TEXT,
                    production_stage TEXT NOT NULL DEFAULT 'manual',
                    parent_job_id TEXT,
                    review_status TEXT NOT NULL DEFAULT 'not_required',
                    review_reasons_json TEXT NOT NULL DEFAULT '[]'
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
            job_migrations = {
                "night_run_id": "ALTER TABLE jobs ADD COLUMN night_run_id TEXT",
                "production_stage": (
                    "ALTER TABLE jobs ADD COLUMN production_stage "
                    "TEXT NOT NULL DEFAULT 'manual'"
                ),
                "parent_job_id": "ALTER TABLE jobs ADD COLUMN parent_job_id TEXT",
                "review_status": (
                    "ALTER TABLE jobs ADD COLUMN review_status "
                    "TEXT NOT NULL DEFAULT 'not_required'"
                ),
                "review_reasons_json": (
                    "ALTER TABLE jobs ADD COLUMN review_reasons_json "
                    "TEXT NOT NULL DEFAULT '[]'"
                ),
            }
            for column, statement in job_migrations.items():
                if column not in job_columns:
                    connection.execute(statement)
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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS night_runs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    objective TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    topics_json TEXT NOT NULL DEFAULT '[]',
                    must_have_json TEXT NOT NULL DEFAULT '[]',
                    should_have_json TEXT NOT NULL DEFAULT '[]',
                    explore_json TEXT NOT NULL DEFAULT '[]',
                    forbidden_json TEXT NOT NULL DEFAULT '[]',
                    max_previews INTEGER NOT NULL DEFAULT 8,
                    max_finals INTEGER NOT NULL DEFAULT 4,
                    max_consecutive_failures INTEGER NOT NULL DEFAULT 2,
                    consecutive_failures INTEGER NOT NULL DEFAULT 0,
                    cutoff_at TEXT,
                    fallback_policy TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_night_runs_created_at "
                "ON night_runs(created_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_jobs_night_run "
                "ON jobs(night_run_id, production_stage, review_status)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS library_items (
                    id TEXT PRIMARY KEY,
                    source_kind TEXT NOT NULL,
                    source_key TEXT NOT NULL UNIQUE,
                    job_id TEXT,
                    name TEXT NOT NULL,
                    batch_name TEXT NOT NULL DEFAULT '',
                    file_path TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    media_type TEXT NOT NULL DEFAULT 'video/mp4',
                    size_bytes INTEGER NOT NULL DEFAULT 0,
                    modified_at TEXT NOT NULL,
                    prompt TEXT NOT NULL DEFAULT '',
                    mode TEXT NOT NULL DEFAULT '',
                    stage TEXT NOT NULL DEFAULT 'unknown',
                    seed INTEGER,
                    width INTEGER,
                    height INTEGER,
                    duration_seconds REAL,
                    fps REAL,
                    qc_status TEXT NOT NULL DEFAULT 'unreviewed',
                    review_notes TEXT NOT NULL DEFAULT '',
                    metadata_quality TEXT NOT NULL DEFAULT 'filename_only',
                    reference_paths_json TEXT NOT NULL DEFAULT '[]',
                    asset_ids_json TEXT NOT NULL DEFAULT '[]',
                    variants_json TEXT NOT NULL DEFAULT '[]',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_library_file_path "
                "ON library_items(file_path COLLATE NOCASE)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_library_modified_at "
                "ON library_items(modified_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_library_filters "
                "ON library_items(source_kind, stage, metadata_quality, qc_status)"
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
            "night_run_id": values.get("night_run_id"),
            "production_stage": values.get("production_stage", "manual"),
            "parent_job_id": values.get("parent_job_id"),
            "review_status": (
                "needs_review"
                if values.get("production_stage") == "preview"
                else "not_required"
            ),
            "review_reasons_json": "[]",
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
                """
                SELECT jobs.*
                FROM jobs
                LEFT JOIN night_runs ON night_runs.id = jobs.night_run_id
                WHERE jobs.status = 'queued'
                  AND (
                    jobs.night_run_id IS NULL
                    OR night_runs.status = 'active'
                  )
                ORDER BY jobs.created_at ASC
                LIMIT 1
                """
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
            "review_status",
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

    def create_night_run(self, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        record = {
            "id": values["id"],
            "name": values["name"],
            "objective": values["objective"],
            "status": "active",
            "topics_json": json.dumps(values.get("topics", []), ensure_ascii=False),
            "must_have_json": json.dumps(
                values.get("must_have", []), ensure_ascii=False
            ),
            "should_have_json": json.dumps(
                values.get("should_have", []), ensure_ascii=False
            ),
            "explore_json": json.dumps(values.get("explore", []), ensure_ascii=False),
            "forbidden_json": json.dumps(
                values.get("forbidden", []), ensure_ascii=False
            ),
            "max_previews": values.get("max_previews", 8),
            "max_finals": values.get("max_finals", 4),
            "max_consecutive_failures": values.get("max_consecutive_failures", 2),
            "consecutive_failures": 0,
            "cutoff_at": values.get("cutoff_at"),
            "fallback_policy": values.get("fallback_policy", ""),
            "created_at": now,
            "updated_at": now,
        }
        columns = ", ".join(record)
        placeholders = ", ".join(f":{column}" for column in record)
        with self._lock, self._connection() as connection:
            connection.execute(
                f"INSERT INTO night_runs ({columns}) VALUES ({placeholders})", record
            )
            connection.commit()
        return self.get_night_run(record["id"])

    def get_night_run(self, night_run_id: str) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM night_runs WHERE id = ?", (night_run_id,)
            ).fetchone()
            if row is None:
                raise KeyError(night_run_id)
            metrics = self._night_run_metrics(connection, night_run_id)
        return self._decode_night_run(row, metrics)

    def list_night_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM night_runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [
                self._decode_night_run(
                    row, self._night_run_metrics(connection, row["id"])
                )
                for row in rows
            ]

    def update_night_run_status(
        self, night_run_id: str, status: str
    ) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                "UPDATE night_runs SET status = ?, updated_at = ? WHERE id = ?",
                (status, utc_now(), night_run_id),
            )
            connection.commit()
        if cursor.rowcount == 0:
            raise KeyError(night_run_id)
        return self.get_night_run(night_run_id)

    def pause_expired_night_runs(self) -> int:
        now = datetime.now(timezone.utc)
        expired_ids: list[str] = []
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                """
                SELECT id, cutoff_at
                FROM night_runs
                WHERE status = 'active' AND cutoff_at IS NOT NULL
                """
            ).fetchall()
            for row in rows:
                try:
                    cutoff = datetime.fromisoformat(row["cutoff_at"].replace("Z", "+00:00"))
                    if cutoff.tzinfo is None:
                        cutoff = cutoff.replace(tzinfo=timezone.utc)
                    if cutoff <= now:
                        expired_ids.append(row["id"])
                except ValueError:
                    continue
            if expired_ids:
                placeholders = ",".join("?" for _ in expired_ids)
                connection.execute(
                    f"UPDATE night_runs SET status = 'paused', updated_at = ? "
                    f"WHERE id IN ({placeholders})",
                    (utc_now(), *expired_ids),
                )
                connection.commit()
        return len(expired_ids)

    def review_preview(
        self, job_id: str, decision: str, reasons: list[str]
    ) -> dict[str, Any]:
        review_status = "passed" if decision == "pass" else "rejected"
        now = utc_now()
        with self._lock, self._connection() as connection:
            job = connection.execute(
                "SELECT * FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if job is None:
                raise KeyError(job_id)
            if job["production_stage"] != "preview" or job["status"] != "completed":
                raise ValueError("只有已完成的夜班样片可以审核")
            if job["review_status"] != "needs_review":
                raise ValueError("这条样片已经审核，不能重复计入熔断")
            night_run_id = job["night_run_id"]
            run = connection.execute(
                "SELECT * FROM night_runs WHERE id = ?", (night_run_id,)
            ).fetchone()
            if run is None:
                raise ValueError("样片关联的守夜计划不存在")
            connection.execute(
                """
                UPDATE jobs
                SET review_status = ?, review_reasons_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (review_status, json.dumps(reasons, ensure_ascii=False), now, job_id),
            )
            consecutive = 0
            run_status = run["status"]
            if decision == "reject":
                consecutive = run["consecutive_failures"] + 1
                if consecutive >= run["max_consecutive_failures"]:
                    run_status = "paused"
            connection.execute(
                """
                UPDATE night_runs
                SET consecutive_failures = ?, status = ?, updated_at = ?
                WHERE id = ?
                """,
                (consecutive, run_status, now, night_run_id),
            )
            connection.commit()
        return self.get(job_id)

    def upsert_library_item(self, values: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        file_path = str(Path(values["file_path"]).resolve())
        metadata_rank = {"filename_only": 0, "partial": 1, "complete": 2}
        with self._lock, self._connection() as connection:
            existing = connection.execute(
                """
                SELECT * FROM library_items
                WHERE source_key = ? OR file_path = ? COLLATE NOCASE
                LIMIT 1
                """,
                (values["source_key"], file_path),
            ).fetchone()
            if existing is not None and metadata_rank.get(
                values.get("metadata_quality", "filename_only"), 0
            ) < metadata_rank.get(existing["metadata_quality"], 0):
                return self._decode_library_item(existing)

            record = {
                "id": existing["id"] if existing is not None else values["id"],
                "source_kind": values.get("source_kind", "discovered"),
                "source_key": values["source_key"],
                "job_id": values.get("job_id"),
                "name": values.get("name") or Path(file_path).stem,
                "batch_name": values.get("batch_name", ""),
                "file_path": file_path,
                "file_name": values.get("file_name") or Path(file_path).name,
                "media_type": values.get("media_type", "video/mp4"),
                "size_bytes": int(values.get("size_bytes") or 0),
                "modified_at": values.get("modified_at") or now,
                "prompt": values.get("prompt", ""),
                "mode": values.get("mode", ""),
                "stage": values.get("stage", "unknown"),
                "seed": values.get("seed"),
                "width": values.get("width"),
                "height": values.get("height"),
                "duration_seconds": values.get("duration_seconds"),
                "fps": values.get("fps"),
                "qc_status": values.get("qc_status", "unreviewed"),
                "review_notes": values.get("review_notes", ""),
                "metadata_quality": values.get(
                    "metadata_quality", "filename_only"
                ),
                "reference_paths_json": json.dumps(
                    values.get("reference_paths", []), ensure_ascii=False
                ),
                "asset_ids_json": json.dumps(
                    values.get("asset_ids", []), ensure_ascii=False
                ),
                "variants_json": json.dumps(
                    values.get("variants", []), ensure_ascii=False
                ),
                "tags_json": json.dumps(
                    values.get("tags", []), ensure_ascii=False
                ),
                "created_at": existing["created_at"] if existing is not None else now,
                "updated_at": now,
            }
            if existing is None:
                columns = ", ".join(record)
                placeholders = ", ".join(f":{column}" for column in record)
                connection.execute(
                    f"INSERT INTO library_items ({columns}) VALUES ({placeholders})",
                    record,
                )
            else:
                columns = [column for column in record if column not in {"id", "created_at"}]
                assignments = ", ".join(f"{column} = :{column}" for column in columns)
                connection.execute(
                    f"UPDATE library_items SET {assignments} WHERE id = :id",
                    record,
                )
            connection.commit()
        return self.get_library_item(record["id"])

    def get_library_item(self, item_id: str) -> dict[str, Any]:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM library_items WHERE id = ?", (item_id,)
            ).fetchone()
        if row is None:
            raise KeyError(item_id)
        return self._decode_library_item(row)

    def list_library_items(
        self,
        *,
        query: str = "",
        source_kind: str = "",
        stage: str = "",
        metadata_quality: str = "",
        qc_status: str = "",
        sort: str = "newest",
        limit: int = 60,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses: list[str] = []
        params: list[Any] = []
        if query.strip():
            needle = f"%{query.strip()}%"
            clauses.append(
                "(name LIKE ? OR batch_name LIKE ? OR prompt LIKE ? OR file_name LIKE ?)"
            )
            params.extend([needle, needle, needle, needle])
        for column, value in (
            ("source_kind", source_kind),
            ("stage", stage),
            ("metadata_quality", metadata_quality),
            ("qc_status", qc_status),
        ):
            if value:
                clauses.append(f"{column} = ?")
                params.append(value)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order_by = {
            "oldest": "modified_at ASC",
            "name": "name COLLATE NOCASE ASC",
        }.get(sort, "modified_at DESC")
        with self._lock, self._connection() as connection:
            total = int(
                connection.execute(
                    f"SELECT COUNT(*) FROM library_items {where}", params
                ).fetchone()[0]
            )
            rows = connection.execute(
                f"SELECT * FROM library_items {where} ORDER BY {order_by} LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
        return [self._decode_library_item(row) for row in rows], total

    def library_summary(self) -> dict[str, int]:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                """
                SELECT
                    COUNT(*) total,
                    SUM(CASE WHEN prompt <> '' THEN 1 ELSE 0 END) with_prompt,
                    SUM(CASE WHEN metadata_quality = 'filename_only' THEN 1 ELSE 0 END) needs_metadata,
                    SUM(CASE WHEN qc_status IN ('pass', 'passed', 'selected', 'selected_with_flag') THEN 1 ELSE 0 END) reviewed,
                    SUM(CASE WHEN source_kind = 'managed' THEN 1 ELSE 0 END) managed
                FROM library_items
                """
            ).fetchone()
            paths = [
                item[0]
                for item in connection.execute("SELECT file_path FROM library_items")
            ]
        return {
            "total": int(row["total"] or 0),
            "with_prompt": int(row["with_prompt"] or 0),
            "needs_metadata": int(row["needs_metadata"] or 0),
            "reviewed": int(row["reviewed"] or 0),
            "managed": int(row["managed"] or 0),
            "playable": sum(Path(path).is_file() for path in paths),
        }

    def update_library_item(
        self, item_id: str, changes: dict[str, Any]
    ) -> dict[str, Any]:
        if not changes:
            return self.get_library_item(item_id)
        allowed = {"name", "prompt", "stage", "qc_status", "review_notes", "tags"}
        unexpected = set(changes) - allowed
        if unexpected:
            raise ValueError(f"Unsupported library fields: {sorted(unexpected)}")
        encoded = {
            ("tags_json" if key == "tags" else key): (
                json.dumps(value, ensure_ascii=False) if key == "tags" else value
            )
            for key, value in changes.items()
        }
        encoded["updated_at"] = utc_now()
        assignments = ", ".join(f"{field} = :{field}" for field in encoded)
        with self._lock, self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE library_items SET {assignments} WHERE id = :id",
                {**encoded, "id": item_id},
            )
            connection.commit()
        if cursor.rowcount == 0:
            raise KeyError(item_id)
        return self.get_library_item(item_id)

    def update_library_by_job(self, job_id: str, **changes: Any) -> None:
        allowed = {"qc_status", "review_notes"}
        encoded = {key: value for key, value in changes.items() if key in allowed}
        if not encoded:
            return
        encoded["updated_at"] = utc_now()
        assignments = ", ".join(f"{field} = :{field}" for field in encoded)
        with self._lock, self._connection() as connection:
            connection.execute(
                f"UPDATE library_items SET {assignments} WHERE job_id = :job_id",
                {**encoded, "job_id": job_id},
            )
            connection.commit()

    def known_library_paths(self) -> set[str]:
        known: set[str] = set()
        with self._lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT file_path, variants_json FROM library_items"
            ).fetchall()
        for row in rows:
            known.add(str(Path(row["file_path"]).resolve()).lower())
            for variant in json.loads(row["variants_json"] or "[]"):
                if variant.get("path"):
                    known.add(str(Path(variant["path"]).resolve()).lower())
        return known

    @staticmethod
    def _night_run_metrics(
        connection: sqlite3.Connection, night_run_id: str
    ) -> dict[str, int]:
        row = connection.execute(
            """
            SELECT
                SUM(CASE WHEN production_stage = 'preview' THEN 1 ELSE 0 END) preview_count,
                SUM(CASE WHEN production_stage = 'final' THEN 1 ELSE 0 END) final_count,
                SUM(CASE WHEN review_status = 'needs_review' AND status = 'completed' THEN 1 ELSE 0 END) awaiting_review_count,
                SUM(CASE WHEN review_status = 'passed' THEN 1 ELSE 0 END) passed_count,
                SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) rejected_count
            FROM jobs
            WHERE night_run_id = ?
            """,
            (night_run_id,),
        ).fetchone()
        return {key: int(row[key] or 0) for key in row.keys()}

    @staticmethod
    def _decode(row: sqlite3.Row, include_workflow: bool = False) -> dict[str, Any]:
        result = dict(row)
        result["simulated"] = bool(result["simulated"])
        workflow_json = result.pop("workflow_json", None)
        asset_ids_json = result.pop("asset_ids_json", "[]")
        review_reasons_json = result.pop("review_reasons_json", "[]")
        result["asset_ids"] = json.loads(asset_ids_json) if asset_ids_json else []
        result["review_reasons"] = (
            json.loads(review_reasons_json) if review_reasons_json else []
        )
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

    @staticmethod
    def _decode_night_run(
        row: sqlite3.Row, metrics: dict[str, int]
    ) -> dict[str, Any]:
        result = dict(row)
        for field in ("topics", "must_have", "should_have", "explore", "forbidden"):
            raw = result.pop(f"{field}_json", "[]")
            result[field] = json.loads(raw) if raw else []
        result.update(metrics)
        return result

    @staticmethod
    def _decode_library_item(row: sqlite3.Row) -> dict[str, Any]:
        result = dict(row)
        for field in ("reference_paths", "asset_ids", "variants", "tags"):
            raw = result.pop(f"{field}_json", "[]")
            result[field] = json.loads(raw) if raw else []
        result["playable"] = Path(result["file_path"]).is_file()
        return result
