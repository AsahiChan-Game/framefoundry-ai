from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .store import JobStore


VIDEO_MEDIA_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".webm": "video/webm",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
}
SCAN_SKIP_DIRECTORIES = {
    ".git",
    ".tmp",
    "tmp",
    "keyframes",
    "references",
    "reference",
    "research",
    "scripts",
    "workflows",
    "jobs",
    "qc",
}


def _stable_id(source_key: str) -> str:
    return hashlib.sha256(source_key.encode("utf-8", errors="replace")).hexdigest()[:16]


def _modified_at(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()


def _clean_legacy_text(value: Any, fallback: str = "") -> str:
    text = str(value or "").strip()
    if not text or "�" in text:
        return fallback
    return text


def is_path_allowed(path: Path, roots: Iterable[Path]) -> bool:
    resolved = path.resolve()
    return any(resolved == root.resolve() or root.resolve() in resolved.parents for root in roots)


def _repair_history_path(value: Any, production_root: Path) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    direct = Path(text).resolve()
    if direct.is_file():
        return direct
    normalized = text.replace("/", "\\")
    marker = "\\production\\"
    marker_index = normalized.lower().find(marker)
    if marker_index >= 0:
        suffix = normalized[marker_index + len(marker) :]
        repaired = (production_root / Path(suffix)).resolve()
        if repaired.is_file():
            return repaired
    return None


def _variant(kind: str, label: str, path: Path | None) -> dict[str, str] | None:
    if path is None or not path.is_file():
        return None
    return {"kind": kind, "label": label, "path": str(path)}


def _dedupe_variants(values: list[dict[str, str] | None]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for value in values:
        if value is None:
            continue
        key = str(Path(value["path"]).resolve()).lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def sync_history_database(
    store: JobStore,
    history_database: Path | None,
    allowed_roots: tuple[Path, ...],
) -> dict[str, Any]:
    if history_database is None:
        return {"configured": False, "processed": 0, "skipped": 0}
    history_database = history_database.resolve()
    if not history_database.is_file():
        return {"configured": True, "processed": 0, "skipped": 0, "missing": True}

    production_root = history_database.parent.resolve()
    if not is_path_allowed(production_root, allowed_roots):
        raise ValueError("历史数据库不在已配置的成片库目录中")
    uri = f"file:{history_database.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    try:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if not {"clips", "batches"}.issubset(tables):
            raise ValueError("历史数据库缺少 clips 或 batches 表")
        clip_rows = connection.execute(
            """
            SELECT clips.*, batches.summary batch_summary
            FROM clips
            LEFT JOIN batches ON batches.batch_id = clips.batch_id
            ORDER BY clips.updated_at DESC
            """
        ).fetchall()
        postprocess_by_clip: dict[tuple[str, str], list[sqlite3.Row]] = defaultdict(list)
        if "postprocess_runs" in tables:
            for row in connection.execute(
                """
                SELECT * FROM postprocess_runs
                ORDER BY recorded_at ASC
                """
            ):
                postprocess_by_clip[(row["batch_id"], row["clip_id"])].append(row)

        processed = 0
        skipped = 0
        for row in clip_rows:
            raw_path = _repair_history_path(row["raw_path"], production_root)
            upscaled_path = _repair_history_path(row["upscaled_path"], production_root)
            postprocess_variants: list[dict[str, str] | None] = []
            for postprocess_index, postprocess in enumerate(
                postprocess_by_clip.get((row["batch_id"], row["clip_id"]), [])
            ):
                path = _repair_history_path(postprocess["output_path"], production_root)
                tool = _clean_legacy_text(postprocess["tool"], "后期")
                mode = _clean_legacy_text(postprocess["mode"])
                label = f"{tool} · {mode}" if mode else tool
                postprocess_variants.append(
                    _variant(f"postprocess-{postprocess_index + 1}", label, path)
                )
            variants = _dedupe_variants(
                [
                    _variant("raw", "H3 原片", raw_path),
                    _variant("enhanced", "SeedVR2 增强", upscaled_path),
                    *postprocess_variants,
                ]
            )
            if not variants:
                skipped += 1
                continue
            preferred = upscaled_path or raw_path or Path(variants[-1]["path"])
            if not is_path_allowed(preferred, allowed_roots):
                skipped += 1
                continue
            reference_path = _repair_history_path(row["reference_image"], production_root)
            stat = preferred.stat()
            fps = float(row["fps"]) if row["fps"] else None
            frame_count = int(row["frame_count"]) if row["frame_count"] else None
            duration = frame_count / fps if frame_count and fps else None
            width = int(row["width"]) if row["width"] else None
            height = int(row["height"]) if row["height"] else None
            upscale_scale = (
                float(row["upscale_scale"]) if row["upscale_scale"] else None
            )
            if upscaled_path and upscale_scale:
                width = round(width * upscale_scale) if width else None
                height = round(height * upscale_scale) if height else None
            prompt = _clean_legacy_text(row["prompt_text"])
            review_notes = _clean_legacy_text(row["review_notes"])
            source_key = f"history:{row['batch_id']}:{row['clip_id']}"
            tags = [
                value
                for value in (
                    _clean_legacy_text(row["category"]),
                    _clean_legacy_text(row["level_name"]),
                    _clean_legacy_text(row["quality_lane"]),
                )
                if value
            ]
            store.upsert_library_item(
                {
                    "id": _stable_id(source_key),
                    "source_kind": "history",
                    "source_key": source_key,
                    "name": _clean_legacy_text(row["name_zh"], row["clip_id"]),
                    "batch_name": row["batch_id"],
                    "file_path": str(preferred),
                    "file_name": preferred.name,
                    "media_type": VIDEO_MEDIA_TYPES.get(
                        preferred.suffix.lower(), "video/mp4"
                    ),
                    "size_bytes": stat.st_size,
                    "modified_at": _modified_at(preferred),
                    "prompt": prompt,
                    "mode": _clean_legacy_text(row["generation_mode"]),
                    "stage": "enhanced" if upscaled_path else "raw",
                    "seed": row["seed"],
                    "width": width,
                    "height": height,
                    "duration_seconds": duration,
                    "fps": fps,
                    "qc_status": _clean_legacy_text(row["qc_status"], "unreviewed"),
                    "review_notes": review_notes,
                    "metadata_quality": "complete" if prompt else "partial",
                    "reference_paths": [str(reference_path)] if reference_path else [],
                    "variants": variants,
                    "tags": tags,
                }
            )
            processed += 1
        return {"configured": True, "processed": processed, "skipped": skipped}
    finally:
        connection.close()


def guess_stage(path: Path) -> str:
    parts = {part.lower() for part in path.parts}
    joined = " ".join(parts)
    if any(token in joined for token in ("release", "deliverable", "share_package")):
        return "release"
    if any(token in joined for token in ("high-quality", "upscale", "seedvr", "enhanced")):
        return "enhanced"
    if any(token in joined for token in ("preview", "sample", "draft")):
        return "preview"
    if any(token in parts for token in ("raw", "visible-start", "videos")):
        return "raw"
    return "unknown"


def scan_library_roots(
    store: JobStore,
    roots: tuple[Path, ...],
    *,
    limit: int = 500,
) -> dict[str, Any]:
    known = store.known_library_paths()
    candidates: list[Path] = []
    for root in roots:
        root = root.resolve()
        if not root.is_dir():
            continue
        for current_root, directories, files in os.walk(root, followlinks=False):
            directories[:] = [
                name
                for name in directories
                if name.lower() not in SCAN_SKIP_DIRECTORIES
                and not (Path(current_root) / name).is_symlink()
            ]
            for name in files:
                candidate = Path(current_root) / name
                if candidate.suffix.lower() in VIDEO_MEDIA_TYPES:
                    candidates.append(candidate.resolve())
    candidates.sort(key=lambda path: path.stat().st_mtime, reverse=True)

    processed = 0
    skipped = 0
    for path in candidates:
        if processed >= limit:
            break
        path_key = str(path).lower()
        if path_key in known:
            skipped += 1
            continue
        owner_root = next(
            (root.resolve() for root in roots if is_path_allowed(path, (root,))), None
        )
        if owner_root is None:
            skipped += 1
            continue
        relative = path.relative_to(owner_root)
        batch_name = relative.parts[0] if len(relative.parts) > 1 else owner_root.name
        source_key = f"file:{hashlib.sha256(path_key.encode()).hexdigest()}"
        stat = path.stat()
        stage = guess_stage(relative)
        store.upsert_library_item(
            {
                "id": _stable_id(source_key),
                "source_kind": "discovered",
                "source_key": source_key,
                "name": path.stem,
                "batch_name": batch_name,
                "file_path": str(path),
                "file_name": path.name,
                "media_type": VIDEO_MEDIA_TYPES[path.suffix.lower()],
                "size_bytes": stat.st_size,
                "modified_at": _modified_at(path),
                "stage": stage,
                "qc_status": "unreviewed",
                "metadata_quality": "filename_only",
                "variants": [
                    {"kind": stage, "label": "发现的本地文件", "path": str(path)}
                ],
                "tags": [stage] if stage != "unknown" else [],
            }
        )
        known.add(path_key)
        processed += 1
    return {
        "processed": processed,
        "skipped": skipped,
        "candidates": len(candidates),
        "limit": limit,
    }


def resolve_comfyui_output(
    output_files: list[str],
    *,
    job_id: str,
    output_root: Path,
    node_output_root: Path | None,
) -> Path | None:
    roots = [output_root.resolve()]
    if node_output_root is not None:
        roots.append(node_output_root.resolve())
    for output_file in output_files:
        supplied = Path(output_file)
        candidates = [supplied] if supplied.is_absolute() else []
        candidates.extend(
            [
                output_root / job_id / supplied,
                output_root / supplied,
            ]
        )
        if node_output_root is not None:
            candidates.append(node_output_root / supplied)
        for candidate in candidates:
            resolved = candidate.resolve()
            if (
                resolved.suffix.lower() in VIDEO_MEDIA_TYPES
                and resolved.is_file()
                and is_path_allowed(resolved, roots)
            ):
                return resolved
    return None


def register_managed_job_output(
    store: JobStore,
    job: dict[str, Any],
    output_path: Path,
) -> dict[str, Any]:
    source_key = f"job:{job['id']}"
    stat = output_path.stat()
    stage = {
        "preview": "preview",
        "final": "release",
    }.get(job.get("production_stage"), "raw")
    reference_paths = list(
        dict.fromkeys(
            path
            for path in [
                job.get("reference_path"),
                *store.asset_paths(job.get("asset_ids", [])),
            ]
            if path
        )
    )
    return store.upsert_library_item(
        {
            "id": _stable_id(source_key),
            "source_kind": "managed",
            "source_key": source_key,
            "job_id": job["id"],
            "name": job["name"],
            "batch_name": job.get("night_run_id") or "FrameFoundry AI",
            "file_path": str(output_path),
            "file_name": output_path.name,
            "media_type": VIDEO_MEDIA_TYPES.get(output_path.suffix.lower(), "video/mp4"),
            "size_bytes": stat.st_size,
            "modified_at": _modified_at(output_path),
            "prompt": job["prompt"],
            "mode": job["mode"],
            "stage": stage,
            "seed": job.get("seed"),
            "duration_seconds": job.get("duration_seconds"),
            "qc_status": (
                "needs_review"
                if job.get("production_stage") == "preview"
                else "unreviewed"
            ),
            "metadata_quality": "complete",
            "reference_paths": reference_paths,
            "asset_ids": job.get("asset_ids", []),
            "variants": [
                {"kind": stage, "label": "FrameFoundry 产物", "path": str(output_path)}
            ],
        }
    )
