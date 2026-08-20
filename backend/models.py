from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


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


class WorkflowValidateRequest(BaseModel):
    workflow: dict[str, Any]


class WorkflowValidateResponse(BaseModel):
    valid: bool
    node_count: int
    placeholders: list[str]
    warnings: list[str]
