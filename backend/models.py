from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
AssetKind = Literal["character", "scene", "style", "prop", "audio", "custom"]
AssetControl = Literal[
    "identity", "scene", "style", "prop", "audio", "reference"
]


class AssetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: AssetKind = "custom"
    description: str = Field(default="", max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    prompt_hint: str = Field(default="", max_length=4000)
    control: AssetControl = "reference"
    file_name: str | None = Field(default=None, max_length=255)
    mime_type: str | None = Field(default=None, max_length=120)
    file_data: str | None = None

    @field_validator("name")
    @classmethod
    def strip_asset_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            tag = value.strip()
            if tag and tag not in normalized:
                normalized.append(tag[:40])
        return normalized

    @model_validator(mode="after")
    def validate_asset_file(self) -> "AssetCreate":
        if self.file_data and not self.file_name:
            raise ValueError("资产文件数据必须带文件名")
        return self


class AssetResponse(BaseModel):
    id: str
    name: str
    kind: AssetKind
    description: str
    tags: list[str]
    prompt_hint: str
    control: AssetControl
    file_name: str | None = None
    mime_type: str | None = None
    has_file: bool
    created_at: str
    updated_at: str


class AssetPackImport(BaseModel):
    pack_name: str = Field(default="未命名资产包", min_length=1, max_length=120)
    version: str = Field(default="1.0", max_length=20)
    assets: list[AssetCreate] = Field(min_length=1, max_length=100)


class JobCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=12000)
    mode: Literal["T2VA", "I2VA", "FL2VA", "Ref2VA"] = "I2VA"
    resolution: str = Field(default="768P", max_length=30)
    duration_seconds: int = Field(default=15, ge=3, le=120)
    seed: int | None = None
    simulated: bool = True
    target_node: str = "h3"
    workflow: dict[str, Any] | None = None
    reference_name: str | None = Field(default=None, max_length=255)
    reference_mime: str | None = Field(default=None, max_length=120)
    reference_data: str | None = None
    asset_ids: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("name", "prompt")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @model_validator(mode="after")
    def require_workflow_for_real_jobs(self) -> "JobCreate":
        if not self.simulated and self.workflow is None:
            raise ValueError("真实任务必须提供 ComfyUI API 工作流 JSON")
        if self.reference_data and not self.reference_name:
            raise ValueError("参考素材数据必须带文件名")
        self.asset_ids = list(dict.fromkeys(self.asset_ids))
        return self


class JobResponse(BaseModel):
    id: str
    name: str
    prompt: str
    status: JobStatus
    progress: int
    stage: str
    created_at: str
    updated_at: str
    mode: str
    resolution: str
    duration_seconds: int
    seed: int | None = None
    simulated: bool
    target_node: str
    prompt_id: str | None = None
    reference_path: str | None = None
    output_path: str | None = None
    error: str | None = None
    asset_ids: list[str] = Field(default_factory=list)


class WorkflowValidateRequest(BaseModel):
    workflow: dict[str, Any]


class WorkflowValidateResponse(BaseModel):
    valid: bool
    node_count: int
    placeholders: list[str]
    warnings: list[str]
