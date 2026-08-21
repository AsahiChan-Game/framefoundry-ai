from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
ProductionStage = Literal["manual", "preview", "final"]
ReviewStatus = Literal["not_required", "needs_review", "passed", "rejected"]
NightRunStatus = Literal["active", "paused", "completed", "cancelled"]
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
    night_run_id: str | None = Field(default=None, max_length=32)
    production_stage: ProductionStage = "manual"
    parent_job_id: str | None = Field(default=None, max_length=32)

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
        if self.production_stage != "manual" and not self.night_run_id:
            raise ValueError("夜班样片或正式任务必须关联守夜计划")
        if self.production_stage == "final" and not self.parent_job_id:
            raise ValueError("夜班正式任务必须关联已通过的样片")
        if self.production_stage != "final" and self.parent_job_id:
            raise ValueError("只有夜班正式任务可以关联父样片")
        if self.production_stage == "manual" and (
            self.night_run_id or self.parent_job_id
        ):
            raise ValueError("普通任务不能关联守夜计划或父样片")
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
    night_run_id: str | None = None
    production_stage: ProductionStage = "manual"
    parent_job_id: str | None = None
    review_status: ReviewStatus = "not_required"
    review_reasons: list[str] = Field(default_factory=list)


class JobReviewRequest(BaseModel):
    decision: Literal["pass", "reject"]
    reasons: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("reasons")
    @classmethod
    def normalize_reasons(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            reason = value.strip()
            if reason and reason not in normalized:
                normalized.append(reason[:80])
        return normalized


class NightRunCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=2000)
    topics: list[str] = Field(default_factory=list, max_length=30)
    must_have: list[str] = Field(default_factory=list, max_length=30)
    should_have: list[str] = Field(default_factory=list, max_length=30)
    explore: list[str] = Field(default_factory=list, max_length=30)
    forbidden: list[str] = Field(default_factory=list, max_length=30)
    max_previews: int = Field(default=8, ge=1, le=200)
    max_finals: int = Field(default=4, ge=1, le=100)
    max_consecutive_failures: int = Field(default=2, ge=1, le=20)
    cutoff_at: str | None = Field(default=None, max_length=64)
    fallback_policy: str = Field(default="", max_length=1000)

    @field_validator("name", "objective")
    @classmethod
    def strip_night_run_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value

    @field_validator("topics", "must_have", "should_have", "explore", "forbidden")
    @classmethod
    def normalize_rule_list(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            rule = value.strip()
            if rule and rule not in normalized:
                normalized.append(rule[:160])
        return normalized


class NightRunResponse(BaseModel):
    id: str
    name: str
    objective: str
    status: NightRunStatus
    topics: list[str]
    must_have: list[str]
    should_have: list[str]
    explore: list[str]
    forbidden: list[str]
    max_previews: int
    max_finals: int
    max_consecutive_failures: int
    consecutive_failures: int
    cutoff_at: str | None = None
    fallback_policy: str
    preview_count: int = 0
    final_count: int = 0
    awaiting_review_count: int = 0
    passed_count: int = 0
    rejected_count: int = 0
    created_at: str
    updated_at: str


class NightRunStatusRequest(BaseModel):
    status: NightRunStatus


class WorkflowValidateRequest(BaseModel):
    workflow: dict[str, Any]


class WorkflowValidateResponse(BaseModel):
    valid: bool
    node_count: int
    placeholders: list[str]
    warnings: list[str]
