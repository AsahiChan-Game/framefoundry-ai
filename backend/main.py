from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .comfyui import (
    ComfyUIClient,
    extract_output_files,
    substitute_placeholders,
    validate_workflow,
)
from .config import (
    ASSET_DIR,
    DATABASE_PATH,
    MAX_REFERENCE_BYTES,
    NODES,
    OUTPUT_DIR,
    REAL_JOB_TIMEOUT_SECONDS,
    UPLOAD_DIR,
    NodeConfig,
    prepare_directories,
)
from .models import (
    AssetCreate,
    AssetPackImport,
    AssetResponse,
    JobCreate,
    JobResponse,
    WorkflowValidateRequest,
    WorkflowValidateResponse,
)
from .store import JobStore


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("framefoundry")

store = JobStore(DATABASE_PATH)
dispatcher_task: asyncio.Task[None] | None = None

ALLOWED_REFERENCE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".mp4",
    ".mov",
    ".webm",
    ".wav",
    ".mp3",
    ".json",
}


def public_job(record: dict[str, Any]) -> JobResponse:
    return JobResponse.model_validate(record)


def public_asset(record: dict[str, Any]) -> AssetResponse:
    return AssetResponse.model_validate(record)


def _safe_filename(filename: str) -> str:
    filename = Path(filename).name
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_REFERENCE_SUFFIXES:
        raise HTTPException(status_code=415, detail=f"不支持的素材类型：{suffix or '无扩展名'}")
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", Path(filename).stem).strip("-.")
    if not stem:
        stem = "reference"
    return f"{stem[:80]}{suffix}"


def save_reference(job_id: str, payload: JobCreate) -> str | None:
    if not payload.reference_data or not payload.reference_name:
        return None
    try:
        raw = base64.b64decode(payload.reference_data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="参考素材不是有效的 Base64 数据") from exc
    if len(raw) > MAX_REFERENCE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"参考素材超过 {MAX_REFERENCE_BYTES // (1024 * 1024)} MB 限制",
        )
    safe_name = _safe_filename(payload.reference_name)
    job_upload_dir = (UPLOAD_DIR / job_id).resolve()
    if UPLOAD_DIR not in job_upload_dir.parents:
        raise HTTPException(status_code=400, detail="无效的素材保存路径")
    job_upload_dir.mkdir(parents=True, exist_ok=True)
    target = (job_upload_dir / safe_name).resolve()
    if job_upload_dir not in target.parents:
        raise HTTPException(status_code=400, detail="无效的素材文件名")
    target.write_bytes(raw)
    return str(target)


def decode_asset_file(payload: AssetCreate) -> tuple[bytes, str] | None:
    if not payload.file_data or not payload.file_name:
        return None
    try:
        raw = base64.b64decode(payload.file_data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="资产文件不是有效的 Base64 数据") from exc
    if len(raw) > MAX_REFERENCE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"资产文件超过 {MAX_REFERENCE_BYTES // (1024 * 1024)} MB 限制",
        )
    return raw, _safe_filename(payload.file_name)


def save_asset_file(asset_id: str, payload: AssetCreate) -> str | None:
    decoded = decode_asset_file(payload)
    if decoded is None:
        return None
    raw, safe_name = decoded
    asset_directory = (ASSET_DIR / asset_id).resolve()
    if ASSET_DIR not in asset_directory.parents:
        raise HTTPException(status_code=400, detail="无效的资产保存路径")
    asset_directory.mkdir(parents=True, exist_ok=True)
    target = (asset_directory / safe_name).resolve()
    if asset_directory not in target.parents:
        raise HTTPException(status_code=400, detail="无效的资产文件名")
    target.write_bytes(raw)
    return str(target)


def create_asset_record(payload: AssetCreate) -> dict[str, Any]:
    asset_id = uuid.uuid4().hex[:16]
    file_path = save_asset_file(asset_id, payload)
    return store.create_asset(
        {
            **payload.model_dump(exclude={"file_data"}),
            "id": asset_id,
            "file_path": file_path,
        }
    )


async def probe_node(node: NodeConfig) -> dict[str, Any]:
    started = asyncio.get_running_loop().time()
    try:
        async with httpx.AsyncClient(timeout=1.6, follow_redirects=True) as client:
            response = await client.get(f"{node.base_url}{node.probe_path}")
            response.raise_for_status()
        latency_ms = round((asyncio.get_running_loop().time() - started) * 1000)
        return {
            "id": node.id,
            "name": node.name,
            "role": node.role,
            "url": node.base_url.replace("http://", "").replace("https://", ""),
            "status": "online",
            "latency_ms": latency_ms,
            "detail": f"HTTP {response.status_code}",
        }
    except Exception as exc:
        return {
            "id": node.id,
            "name": node.name,
            "role": node.role,
            "url": node.base_url.replace("http://", "").replace("https://", ""),
            "status": "offline",
            "latency_ms": None,
            "detail": exc.__class__.__name__,
        }


def is_cancelled(job_id: str) -> bool:
    try:
        return store.get(job_id)["status"] == "cancelled"
    except KeyError:
        return True


async def run_simulated_job(job: dict[str, Any]) -> None:
    stages = [
        ("检查输入与工作流", 12),
        ("H3 生成模拟", 38),
        ("可见帧检查", 58),
        ("SeedVR2 增强模拟", 79),
        ("QC 与交付登记", 94),
    ]
    for stage, progress in stages:
        if is_cancelled(job["id"]):
            return
        store.update(job["id"], status="running", stage=stage, progress=progress)
        await asyncio.sleep(0.7)

    if is_cancelled(job["id"]):
        return
    output_dir = (OUTPUT_DIR / job["id"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "simulation-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "kind": "simulation",
                "notice": "This manifest proves orchestration only; no video was generated.",
                "job": {
                    "id": job["id"],
                    "name": job["name"],
                    "mode": job["mode"],
                    "resolution": job["resolution"],
                    "duration_seconds": job["duration_seconds"],
                    "asset_ids": job.get("asset_ids", []),
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    store.update(
        job["id"],
        status="completed",
        stage="模拟流程完成",
        progress=100,
        output_path=str(manifest_path),
    )


async def run_real_job(job: dict[str, Any]) -> None:
    workflow = job.get("workflow")
    if not isinstance(workflow, dict):
        raise ValueError("真实任务缺少 ComfyUI API 工作流")
    target = next((node for node in NODES if node.id == job["target_node"]), None)
    if target is None:
        raise ValueError(f"未知目标节点：{job['target_node']}")

    asset_paths = store.asset_paths(job.get("asset_ids", []))
    reference_paths = list(
        dict.fromkeys(
            [path for path in [job.get("reference_path"), *asset_paths] if path]
        )
    )
    variables = {
        "prompt": job["prompt"],
        "seed": job["seed"] if job["seed"] is not None else -1,
        "duration_seconds": job["duration_seconds"],
        "resolution": job["resolution"],
        "reference_path": reference_paths[0] if reference_paths else "",
        "reference_paths": reference_paths,
        "output_dir": str((OUTPUT_DIR / job["id"]).resolve()),
        "job_id": job["id"],
    }
    hydrated_workflow = substitute_placeholders(workflow, variables)
    node_count, unresolved, warnings = validate_workflow(hydrated_workflow)
    if node_count == 0:
        raise ValueError("工作流不包含有效的 ComfyUI API 节点")
    if unresolved:
        raise ValueError(f"工作流仍有未解析占位符：{', '.join(unresolved)}")
    for warning in warnings:
        logger.warning("Job %s workflow: %s", job["id"], warning)

    store.update(job["id"], status="running", progress=10, stage="提交到 ComfyUI")
    client = ComfyUIClient(target.base_url)
    prompt_id = await client.submit(hydrated_workflow)
    store.update(
        job["id"],
        prompt_id=prompt_id,
        progress=25,
        stage=f"{target.name} 正在生成",
    )
    history = await client.wait_for_completion(
        prompt_id,
        timeout_seconds=REAL_JOB_TIMEOUT_SECONDS,
        cancelled=lambda: is_cancelled(job["id"]),
    )
    if is_cancelled(job["id"]):
        return
    output_files = extract_output_files(history)
    output_path = (
        f"comfyui://{target.id}/{output_files[0]}"
        if output_files
        else f"comfyui://{target.id}/history/{prompt_id}"
    )
    store.update(
        job["id"],
        status="completed",
        progress=100,
        stage="ComfyUI 生成完成",
        output_path=output_path,
    )


async def queue_dispatcher() -> None:
    logger.info("Single-GPU queue dispatcher started")
    while True:
        job = store.next_queued()
        if job is None:
            await asyncio.sleep(0.5)
            continue
        try:
            if job["simulated"]:
                await run_simulated_job(job)
            else:
                await run_real_job(job)
        except asyncio.CancelledError:
            if is_cancelled(job["id"]):
                continue
            raise
        except Exception as exc:
            logger.exception("Job %s failed", job["id"])
            if not is_cancelled(job["id"]):
                store.update(
                    job["id"],
                    status="failed",
                    stage="执行失败",
                    error=str(exc)[:1000],
                )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global dispatcher_task
    prepare_directories()
    store.initialize()
    recovered = store.recover_interrupted()
    if recovered:
        logger.warning("Marked %s interrupted job(s) as failed", recovered)
    dispatcher_task = asyncio.create_task(queue_dispatcher())
    yield
    dispatcher_task.cancel()
    with suppress(asyncio.CancelledError):
        await dispatcher_task


app = FastAPI(
    title="FrameFoundry AI Control API",
    version="1.0.0",
    description="帧造工场本地任务、资产、节点探测与 ComfyUI 调度 API。",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "name": "FrameFoundry AI Control API",
        "version": "1.0.0",
        "queue_policy": "single-gpu-serial",
    }


@app.get("/api/nodes")
async def list_nodes() -> dict[str, Any]:
    return {"nodes": await asyncio.gather(*(probe_node(node) for node in NODES))}


@app.get("/api/assets")
async def list_assets(
    limit: int = Query(default=500, ge=1, le=500),
) -> dict[str, Any]:
    return {"assets": [public_asset(record) for record in store.list_assets(limit)]}


@app.get("/api/assets/{asset_id}", response_model=AssetResponse)
async def get_asset(asset_id: str) -> AssetResponse:
    try:
        return public_asset(store.get_asset(asset_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="资产不存在") from exc


@app.get("/api/assets/{asset_id}/content")
async def get_asset_content(asset_id: str) -> FileResponse:
    try:
        asset = store.get_asset(asset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="资产不存在") from exc
    file_path = asset.get("file_path")
    resolved_path = Path(file_path).resolve() if file_path else None
    if (
        resolved_path is None
        or ASSET_DIR not in resolved_path.parents
        or not resolved_path.is_file()
    ):
        raise HTTPException(status_code=404, detail="资产没有可预览文件")
    return FileResponse(
        resolved_path,
        media_type=asset.get("mime_type") or "application/octet-stream",
        filename=asset.get("file_name") or Path(file_path).name,
        content_disposition_type="inline",
    )


@app.post("/api/assets", response_model=AssetResponse, status_code=201)
async def create_asset(payload: AssetCreate) -> AssetResponse:
    return public_asset(create_asset_record(payload))


@app.post("/api/assets/import", status_code=201)
async def import_asset_pack(payload: AssetPackImport) -> dict[str, Any]:
    for asset in payload.assets:
        decode_asset_file(asset)
    imported = [public_asset(create_asset_record(asset)) for asset in payload.assets]
    return {
        "pack_name": payload.pack_name,
        "version": payload.version,
        "imported_count": len(imported),
        "assets": imported,
    }


@app.get("/api/jobs")
async def list_jobs(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    return {"jobs": [public_job(record) for record in store.list(limit=limit)]}


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    try:
        return public_job(store.get(job_id))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc


@app.post("/api/jobs", response_model=JobResponse, status_code=201)
async def create_job(payload: JobCreate) -> JobResponse:
    if payload.target_node not in {node.id for node in NODES}:
        raise HTTPException(status_code=422, detail="目标节点不在允许列表中")
    job_id = uuid.uuid4().hex[:16]
    reference_path = save_reference(job_id, payload)
    try:
        selected_assets = store.get_assets(payload.asset_ids)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=f"资产不存在：{exc.args[0]}") from exc
    if reference_path is None:
        reference_path = next(
            (asset.get("file_path") for asset in selected_assets if asset.get("file_path")),
            None,
        )
    record = store.create(
        {
            **payload.model_dump(
                exclude={"reference_data", "reference_name", "reference_mime"}
            ),
            "id": job_id,
            "reference_path": reference_path,
        }
    )
    return public_job(record)


@app.post("/api/jobs/{job_id}/cancel", response_model=JobResponse)
async def cancel_job(job_id: str) -> JobResponse:
    try:
        job = store.get(job_id)
        if job["status"] in {"completed", "failed", "cancelled"}:
            return public_job(job)
        return public_job(
            store.update(
                job_id,
                status="cancelled",
                stage="用户取消",
                error=None,
            )
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="任务不存在") from exc


@app.post("/api/workflows/validate", response_model=WorkflowValidateResponse)
async def validate_workflow_endpoint(
    payload: WorkflowValidateRequest,
) -> WorkflowValidateResponse:
    node_count, placeholders, warnings = validate_workflow(payload.workflow)
    return WorkflowValidateResponse(
        valid=node_count > 0,
        node_count=node_count,
        placeholders=placeholders,
        warnings=warnings,
    )
