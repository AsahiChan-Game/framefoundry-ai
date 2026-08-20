from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any

import httpx


PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def find_placeholders(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for nested in value.values():
            found.update(find_placeholders(nested))
    elif isinstance(value, list):
        for nested in value:
            found.update(find_placeholders(nested))
    elif isinstance(value, str):
        found.update(PLACEHOLDER_PATTERN.findall(value))
    return found


def substitute_placeholders(value: Any, variables: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: substitute_placeholders(nested, variables) for key, nested in value.items()}
    if isinstance(value, list):
        return [substitute_placeholders(nested, variables) for nested in value]
    if not isinstance(value, str):
        return value

    full_match = PLACEHOLDER_PATTERN.fullmatch(value)
    if full_match and full_match.group(1) in variables:
        return variables[full_match.group(1)]

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return str(variables.get(key, match.group(0)))

    return PLACEHOLDER_PATTERN.sub(replace, value)


def validate_workflow(workflow: dict[str, Any]) -> tuple[int, list[str], list[str]]:
    warnings: list[str] = []
    if "prompt" in workflow and isinstance(workflow["prompt"], dict):
        workflow = workflow["prompt"]
        warnings.append("检测到外层 prompt 包装；提交时会自动解包。")
    node_count = sum(
        1
        for value in workflow.values()
        if isinstance(value, dict) and "class_type" in value
    )
    if node_count == 0:
        warnings.append("没有检测到 ComfyUI API 节点（class_type）。")
    placeholders = sorted(find_placeholders(workflow))
    return node_count, placeholders, warnings


class ComfyUIClient:
    def __init__(self, base_url: str, timeout_seconds: float = 15.0):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds

    async def submit(self, workflow: dict[str, Any]) -> str:
        if "prompt" in workflow and isinstance(workflow["prompt"], dict):
            workflow = workflow["prompt"]
        client_id = str(uuid.uuid4())
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            response = await client.post(
                f"{self.base_url}/prompt",
                json={"prompt": workflow, "client_id": client_id},
            )
            response.raise_for_status()
            payload = response.json()
        prompt_id = payload.get("prompt_id")
        if not isinstance(prompt_id, str) or not prompt_id:
            raise RuntimeError(f"ComfyUI response has no prompt_id: {json.dumps(payload)[:300]}")
        return prompt_id

    async def wait_for_completion(
        self,
        prompt_id: str,
        timeout_seconds: int,
        cancelled: callable,
    ) -> dict[str, Any]:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            while asyncio.get_running_loop().time() < deadline:
                if cancelled():
                    raise asyncio.CancelledError
                response = await client.get(f"{self.base_url}/history/{prompt_id}")
                response.raise_for_status()
                payload = response.json()
                history = payload.get(prompt_id)
                if isinstance(history, dict):
                    status = history.get("status", {})
                    if status.get("status_str") == "error":
                        raise RuntimeError("ComfyUI reported an execution error")
                    return history
                await asyncio.sleep(2)
        raise TimeoutError(f"ComfyUI task timed out after {timeout_seconds} seconds")


def extract_output_files(history: dict[str, Any]) -> list[str]:
    files: list[str] = []
    for node_output in history.get("outputs", {}).values():
        if not isinstance(node_output, dict):
            continue
        for values in node_output.values():
            if not isinstance(values, list):
                continue
            for value in values:
                if isinstance(value, dict) and value.get("filename"):
                    files.append(str(value["filename"]))
    return files
