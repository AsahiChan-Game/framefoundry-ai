"use client";

import {
  Activity,
  AudioLines,
  Aperture,
  Archive,
  Bell,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Clapperboard,
  CloudOff,
  Copy,
  Cpu,
  Database,
  FileJson,
  Film,
  FolderSearch,
  FolderOpen,
  Gauge,
  Grid2X2,
  HardDrive,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  List,
  Menu,
  MonitorDot,
  MoonStar,
  MoreHorizontal,
  Pause,
  Play,
  Palette,
  Plus,
  PackageOpen,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
  TerminalSquare,
  ThumbsDown,
  ThumbsUp,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Section = "create" | "night" | "queue" | "library" | "workflows" | "assets" | "nodes";
type NodeState = "online" | "offline" | "checking";
type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";
type ProductionStage = "manual" | "preview" | "final";
type ReviewStatus = "not_required" | "needs_review" | "passed" | "rejected";
type NightRunStatus = "active" | "paused" | "completed" | "cancelled";
type AssetKind = "character" | "scene" | "style" | "prop" | "audio" | "custom";
type AssetControl = "identity" | "scene" | "style" | "prop" | "audio" | "reference";

type PipelineNode = {
  id: string;
  name: string;
  role: string;
  url: string;
  status: NodeState;
  latency_ms?: number | null;
  detail?: string | null;
};

type Job = {
  id: string;
  name: string;
  prompt: string;
  status: JobState;
  progress: number;
  stage: string;
  created_at: string;
  mode: string;
  resolution: string;
  duration_seconds: number;
  seed?: number | null;
  simulated: boolean;
  output_path?: string | null;
  asset_ids: string[];
  night_run_id?: string | null;
  production_stage: ProductionStage;
  parent_job_id?: string | null;
  review_status: ReviewStatus;
  review_reasons: string[];
};

type NightRun = {
  id: string;
  name: string;
  objective: string;
  status: NightRunStatus;
  topics: string[];
  must_have: string[];
  should_have: string[];
  explore: string[];
  forbidden: string[];
  max_previews: number;
  max_finals: number;
  max_consecutive_failures: number;
  consecutive_failures: number;
  cutoff_at?: string | null;
  fallback_policy: string;
  preview_count: number;
  final_count: number;
  awaiting_review_count: number;
  passed_count: number;
  rejected_count: number;
  created_at: string;
  updated_at: string;
};

type NightRunDraft = {
  name: string;
  objective: string;
  topics: string[];
  must_have: string[];
  should_have: string[];
  explore: string[];
  forbidden: string[];
  max_previews: number;
  max_finals: number;
  max_consecutive_failures: number;
  cutoff_at: string | null;
  fallback_policy: string;
};

type Asset = {
  id: string;
  name: string;
  kind: AssetKind;
  description: string;
  tags: string[];
  prompt_hint: string;
  control: AssetControl;
  file_name?: string | null;
  mime_type?: string | null;
  has_file: boolean;
  created_at: string;
  updated_at: string;
};

type LibraryVariant = {
  kind: string;
  label: string;
  path: string;
};

type LibraryItem = {
  id: string;
  source_kind: "managed" | "history" | "discovered";
  source_key: string;
  job_id?: string | null;
  name: string;
  batch_name: string;
  file_path: string;
  file_name: string;
  media_type: string;
  size_bytes: number;
  modified_at: string;
  prompt: string;
  mode: string;
  stage: "preview" | "raw" | "enhanced" | "release" | "unknown";
  seed?: number | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  fps?: number | null;
  qc_status: string;
  review_notes: string;
  metadata_quality: "complete" | "partial" | "filename_only";
  reference_paths: string[];
  asset_ids: string[];
  variants: LibraryVariant[];
  tags: string[];
  playable: boolean;
  created_at: string;
  updated_at: string;
};

type LibrarySummary = {
  total: number;
  playable: number;
  with_prompt: number;
  needs_metadata: number;
  reviewed: number;
  managed: number;
};

type LibrarySource = {
  id: string;
  label: string;
  path: string;
  kind: "database" | "folder";
  available: boolean;
};

type ApiState = "connecting" | "online" | "offline";

const API_BASE =
  process.env.NEXT_PUBLIC_FRAMEFOUNDRY_API_URL ?? "http://127.0.0.1:8766/api";

const EMPTY_LIBRARY_SUMMARY: LibrarySummary = {
  total: 0,
  playable: 0,
  with_prompt: 0,
  needs_metadata: 0,
  reviewed: 0,
  managed: 0,
};

const NAV_ITEMS: Array<{
  id: Section;
  label: string;
  sublabel: string;
  icon: LucideIcon;
}> = [
  { id: "create", label: "创作台", sublabel: "Create", icon: LayoutDashboard },
  { id: "night", label: "守夜监制", sublabel: "Night Supervisor", icon: MoonStar },
  { id: "queue", label: "任务队列", sublabel: "Queue", icon: Layers3 },
  { id: "library", label: "成片库", sublabel: "Clip Library", icon: Clapperboard },
  { id: "workflows", label: "工作流", sublabel: "Workflows", icon: Boxes },
  { id: "assets", label: "素材库", sublabel: "Assets", icon: FolderOpen },
  { id: "nodes", label: "节点监控", sublabel: "Nodes", icon: MonitorDot },
];

const DEFAULT_NODES: PipelineNode[] = [
  { id: "ltx", name: "LTX 2.3", role: "视频实验", url: "127.0.0.1:8188", status: "checking" },
  { id: "h3", name: "MiniMax H3", role: "核心生成", url: "127.0.0.1:8189", status: "checking" },
  { id: "seedvr", name: "SeedVR2", role: "超分增强", url: "127.0.0.1:8190", status: "checking" },
  { id: "ntsc", name: "ntsc-rs", role: "模拟电视", url: "127.0.0.1:8191", status: "checking" },
  { id: "music", name: "Music 3", role: "音乐生成", url: "127.0.0.1:8192", status: "checking" },
];

const WORKFLOW_STEPS = [
  { label: "条件整理", detail: "参考图与提示词", icon: ImagePlus },
  { label: "H3 生成", detail: "原生音画输出", icon: WandSparkles },
  { label: "可见帧检查", detail: "时序暖机验证", icon: Aperture },
  { label: "SeedVR2", detail: "2.5× 超分", icon: Sparkles },
  { label: "发布分支", detail: "QC 与交付", icon: Archive },
];

const WORKFLOW_CARDS = [
  { name: "H3 单镜头", type: "I2VA · 推荐", color: "violet", desc: "参考图锁定主体，生成带原生立体声的连续镜头。", status: "本机模型就绪 · 待导入 JSON", statusTone: "local" },
  { name: "H3 Motion Context 长视频", type: "FL2VA · Experimental", color: "green", desc: "用前一段的潜空间和原生音频续写下一段；节点已安装，仍需真实 GPU 验证和父子任务编排。", status: "社区节点 · 未生产验证", statusTone: "experimental" },
  { name: "LTX 长镜头实验", type: "T2V · 15s+", color: "blue", desc: "用于连续运动、空间探索和时序稳定性测试。", status: "流程说明", statusTone: "planned" },
  { name: "SeedVR2 发布增强", type: "Upscale · 2.5×", color: "amber", desc: "保留干净母版，输出高分辨率发布分支。", status: "待接入 API JSON", statusTone: "planned" },
  { name: "证据带复古分支", type: "ntsc-rs · Optional", color: "green", desc: "添加克制的磁带、复合视频与扫描线质感。", status: "可选发布分支", statusTone: "local" },
];

const ASSET_KINDS: Array<{ id: AssetKind; label: string; icon: LucideIcon }> = [
  { id: "character", label: "角色", icon: UserRound },
  { id: "scene", label: "场景", icon: ImageIcon },
  { id: "style", label: "风格", icon: Palette },
  { id: "prop", label: "道具", icon: PackageOpen },
  { id: "audio", label: "音频", icon: AudioLines },
  { id: "custom", label: "自定义", icon: Boxes },
];

const ASSET_CONTROL_LABELS: Record<AssetControl, string> = {
  identity: "身份一致性",
  scene: "场景参考",
  style: "风格参考",
  prop: "道具参考",
  audio: "声音参考",
  reference: "通用参考",
};

function assetKindLabel(kind: AssetKind) {
  return ASSET_KINDS.find((item) => item.id === kind)?.label ?? "自定义";
}

function assetKindIcon(kind: AssetKind) {
  return ASSET_KINDS.find((item) => item.id === kind)?.icon ?? Boxes;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatFileSize(value: number) {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function libraryStageLabel(stage: LibraryItem["stage"]) {
  return {
    preview: "样片",
    raw: "原片",
    enhanced: "增强片",
    release: "发布版",
    unknown: "待判断",
  }[stage];
}

function librarySourceLabel(source: LibraryItem["source_kind"]) {
  return {
    managed: "系统新片",
    history: "历史记录",
    discovered: "发现旧片",
  }[source];
}

function libraryQualityLabel(quality: LibraryItem["metadata_quality"]) {
  return {
    complete: "资料完整",
    partial: "部分恢复",
    filename_only: "待补资料",
  }[quality];
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

function jobStatusLabel(status: JobState) {
  return {
    queued: "排队中",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }[status];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

export function FrameFoundryConsole() {
  const [section, setSection] = useState<Section>("create");
  const [mobileNav, setMobileNav] = useState(false);
  const [apiState, setApiState] = useState<ApiState>("connecting");
  const [nodes, setNodes] = useState<PipelineNode[]>(DEFAULT_NODES);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nightRuns, setNightRuns] = useState<NightRun[]>([]);
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary>(EMPTY_LIBRARY_SUMMARY);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(
    "一只橘猫在无尽的荧光灯走廊中谨慎前行，低机位跟拍，空气中有轻微尘埃，环境压抑但不恐怖，连续单镜头。",
  );
  const [projectName, setProjectName] = useState("后室探索 · 序章");
  const [mode, setMode] = useState("I2VA");
  const [resolution, setResolution] = useState("768P");
  const [duration, setDuration] = useState("15");
  const [seed, setSeed] = useState("随机");
  const [reference, setReference] = useState<File | null>(null);
  const [workflowFile, setWorkflowFile] = useState<File | null>(null);
  const [simulation, setSimulation] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<"all" | JobState>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNightRunId, setSelectedNightRunId] = useState("");
  const [productionStage, setProductionStage] = useState<ProductionStage>("manual");
  const [parentJobId, setParentJobId] = useState("");

  const refreshAssets = useCallback(async () => {
    const response = await fetch(`${API_BASE}/assets`, { cache: "no-store" });
    if (!response.ok) throw new Error("asset request was not successful");
    const payload = (await response.json()) as { assets: Asset[] };
    setAssets(payload.assets);
    setSelectedAssetIds((current) => current.filter((id) => payload.assets.some((asset) => asset.id === id)));
  }, []);

  const refreshNightRuns = useCallback(async () => {
    const response = await fetch(`${API_BASE}/night-runs`, { cache: "no-store" });
    if (!response.ok) throw new Error("night run request was not successful");
    const payload = (await response.json()) as { night_runs: NightRun[] };
    setNightRuns(payload.night_runs);
  }, []);

  const refreshLibrarySummary = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/library?limit=1`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { summary: LibrarySummary };
      setLibrarySummary(payload.summary);
    } catch {
      // The primary runtime poll owns the visible API state.
    }
  }, []);

  const fetchRuntime = useCallback(async () => {
    setApiState("connecting");
    try {
      const [healthResponse, nodeResponse, jobsResponse, assetsResponse, nightRunsResponse] = await Promise.all([
        fetch(`${API_BASE}/health`, { cache: "no-store" }),
        fetch(`${API_BASE}/nodes`, { cache: "no-store" }),
        fetch(`${API_BASE}/jobs`, { cache: "no-store" }),
        fetch(`${API_BASE}/assets`, { cache: "no-store" }),
        fetch(`${API_BASE}/night-runs`, { cache: "no-store" }),
      ]);
      if (!healthResponse.ok || !nodeResponse.ok || !jobsResponse.ok || !assetsResponse.ok || !nightRunsResponse.ok) {
        throw new Error("API response was not successful");
      }
      const nodePayload = (await nodeResponse.json()) as { nodes: PipelineNode[] };
      const jobsPayload = (await jobsResponse.json()) as { jobs: Job[] };
      const assetsPayload = (await assetsResponse.json()) as { assets: Asset[] };
      const nightRunsPayload = (await nightRunsResponse.json()) as { night_runs: NightRun[] };
      setNodes(nodePayload.nodes);
      setJobs(jobsPayload.jobs);
      setAssets(assetsPayload.assets);
      setNightRuns(nightRunsPayload.night_runs);
      setSelectedAssetIds((current) => current.filter((id) => assetsPayload.assets.some((asset) => asset.id === id)));
      setApiState("online");
    } catch {
      setApiState("offline");
      setNodes((current) =>
        current.map((node) => ({ ...node, status: "offline", detail: "控制 API 未启动" })),
      );
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void fetchRuntime();
      void refreshLibrarySummary();
    }, 0);
    const interval = window.setInterval(() => {
      void fetchRuntime();
      void refreshLibrarySummary();
    }, 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [fetchRuntime, refreshLibrarySummary]);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/jobs`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs: Job[] };
        setJobs(payload.jobs);
      } catch {
        // The main runtime poll owns the visible API connection state.
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const activeJobs = jobs.filter((job) => job.status === "running").length;
  const onlineNodes = nodes.filter((node) => node.status === "online").length;
  const completedJobs = jobs.filter((job) => job.status === "completed").length;
  const filteredJobs = useMemo(
    () => jobs.filter((job) => {
      const matchesFilter = queueFilter === "all" || job.status === queueFilter;
      const query = searchTerm.trim().toLocaleLowerCase("zh-CN");
      const matchesSearch = !query || `${job.name} ${job.prompt} ${job.id}`.toLocaleLowerCase("zh-CN").includes(query);
      return matchesFilter && matchesSearch;
    }),
    [jobs, queueFilter, searchTerm],
  );

  async function submitJob() {
    if (!projectName.trim() || !prompt.trim()) {
      setNotice("请填写项目名称和生成描述。");
      return;
    }
    if (apiState !== "online") {
      setNotice("本地控制 API 未启动，请先运行 scripts/start-local.ps1。");
      return;
    }
    if (productionStage === "final" && !parentJobId) {
      setNotice("正式生产必须选择一条已通过审核的样片。");
      return;
    }
    setSubmitting(true);
    try {
      if (reference && reference.size > 20 * 1024 * 1024) {
        setNotice("参考素材超过 20 MB，本地 1.0 暂不接收。");
        return;
      }
      let workflow: Record<string, unknown> | null = null;
      if (workflowFile) {
        workflow = JSON.parse(await workflowFile.text()) as Record<string, unknown>;
        const validationResponse = await fetch(`${API_BASE}/workflows/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflow }),
        });
        if (!validationResponse.ok) throw new Error("workflow validation failed");
        const validation = (await validationResponse.json()) as {
          valid: boolean;
          node_count: number;
          placeholders: string[];
        };
        if (!validation.valid) {
          setNotice("工作流中没有检测到 ComfyUI API 节点（class_type）。");
          return;
        }
        const supportedPlaceholders = new Set([
          "prompt",
          "seed",
          "duration_seconds",
          "resolution",
          "reference_path",
          "reference_paths",
          "output_dir",
          "job_id",
        ]);
        const unknownPlaceholders = validation.placeholders.filter(
          (placeholder) => !supportedPlaceholders.has(placeholder),
        );
        if (!simulation && unknownPlaceholders.length) {
          setNotice(`工作流包含未知占位符：${unknownPlaceholders.join("、")}`);
          return;
        }
      }
      if (!simulation && !workflow) {
        setNotice("真实提交需要选择 ComfyUI 的 API 工作流 JSON。");
        return;
      }
      const referenceData = reference ? await fileToBase64(reference) : null;
      const response = await fetch(`${API_BASE}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          prompt: prompt.trim(),
          mode,
          resolution,
          duration_seconds: Number(duration),
          seed: seed === "随机" ? null : Number(seed),
          simulated: simulation,
          workflow,
          reference_name: reference?.name ?? null,
          reference_mime: reference?.type ?? null,
          reference_data: referenceData,
          asset_ids: selectedAssetIds,
          night_run_id: selectedNightRunId || null,
          production_stage: selectedNightRunId ? productionStage : "manual",
          parent_job_id: productionStage === "final" ? parentJobId : null,
        }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(failure?.detail ?? "任务创建失败");
      }
      const created = (await response.json()) as Job;
      setJobs((current) => [created, ...current]);
      setNotice(simulation ? "模拟任务已进入队列。" : "真实任务已进入队列。");
      setSection("queue");
    } catch (error) {
      setNotice(error instanceof SyntaxError ? "工作流 JSON 格式无效。" : error instanceof Error ? error.message : "任务创建失败，请检查本地 API 日志。");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob(id: string) {
    try {
      const response = await fetch(`${API_BASE}/jobs/${id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error("cancel failed");
      const cancelled = (await response.json()) as Job;
      setJobs((current) => current.map((job) => (job.id === id ? cancelled : job)));
      setNotice("任务已取消。");
    } catch {
      setNotice("取消失败，请检查 API 状态。");
    }
  }

  async function createNightRun(payload: NightRunDraft) {
    const response = await fetch(`${API_BASE}/night-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error("守夜计划创建失败");
    const created = (await response.json()) as NightRun;
    setNightRuns((current) => [created, ...current]);
    setNotice("守夜计划已启动；先提交低成本样片进行校准。");
  }

  async function updateNightRunStatus(id: string, status: NightRunStatus) {
    try {
      const response = await fetch(`${API_BASE}/night-runs/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error("status update failed");
      const updated = (await response.json()) as NightRun;
      setNightRuns((current) => current.map((run) => run.id === id ? updated : run));
      setNotice(status === "active" ? "守夜计划已恢复。" : status === "paused" ? "守夜计划已暂停，队列不会继续取新任务。" : "守夜计划状态已更新。");
    } catch {
      setNotice("守夜计划状态更新失败。");
    }
  }

  async function reviewNightJob(jobId: string, decision: "pass" | "reject", reasons: string[]) {
    try {
      const response = await fetch(`${API_BASE}/jobs/${jobId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reasons }),
      });
      if (!response.ok) throw new Error("review failed");
      const updated = (await response.json()) as Job;
      setJobs((current) => current.map((job) => job.id === jobId ? updated : job));
      try {
        await refreshNightRuns();
      } catch {
        // The regular runtime poll will refresh plan counters.
      }
      setNotice(decision === "pass" ? "样片已通过，正式生产入口已解锁。" : "样片已拒绝；达到连续失败阈值时会自动暂停整批任务。");
    } catch {
      setNotice("样片审核失败，请刷新后重试。");
    }
  }

  function prepareNightJob(runId: string, stage: "preview" | "final", source?: Job) {
    setSelectedNightRunId(runId);
    setProductionStage(stage);
    setParentJobId(source?.id ?? "");
    if (stage === "preview") {
      setResolution("512P 实验");
      setDuration("5");
    } else if (source) {
      setProjectName(`${source.name} · 正式版`);
      setPrompt(source.prompt);
      setMode(source.mode);
      setResolution("768P");
      setDuration(String(Math.max(source.duration_seconds, 8)));
      setSeed(source.seed == null ? "随机" : String(source.seed));
      setSelectedAssetIds(source.asset_ids);
    }
    setSection("create");
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId].slice(-20),
    );
  }

  return (
    <div className="app-shell">
      <aside className={classNames("sidebar", mobileNav && "sidebar-open")}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>帧造工场</strong>
            <small>FRAMEFOUNDRY AI</small>
          </div>
          <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭菜单">
            <X size={18} />
          </button>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">A</div>
          <div>
            <strong>本地工作空间</strong>
            <span>Local workspace</span>
          </div>
          <ChevronDown size={15} />
        </div>

        <nav className="side-nav" aria-label="主导航">
          <span className="nav-eyebrow">生产控制台</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={classNames("nav-item", section === item.id && "active")}
                onClick={() => {
                  setSection(item.id);
                  setMobileNav(false);
                }}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>
                  {item.label}
                  <small>{item.sublabel}</small>
                </span>
                {item.id === "queue" && jobs.length > 0 ? <b>{jobs.length}</b> : null}
                {item.id === "night" && nightRuns.reduce((total, run) => total + run.awaiting_review_count, 0) > 0 ? <b>{nightRuns.reduce((total, run) => total + run.awaiting_review_count, 0)}</b> : null}
                {item.id === "library" && librarySummary.total > 0 ? <b>{librarySummary.total > 999 ? "999+" : librarySummary.total}</b> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item utility-item" onClick={() => setNotice("1.0 的节点、端口和目录设置位于 .env 文件。") }>
            <Settings size={18} />
            <span>偏好设置<small>Settings</small></span>
          </button>
          <div className="version-card">
            <div className="version-icon"><TerminalSquare size={18} /></div>
            <div><strong>FrameFoundry AI</strong><span>Local · v1.0.0</span></div>
            <span className="version-dot" />
          </div>
        </div>
      </aside>

      {mobileNav ? <button className="sidebar-scrim" onClick={() => setMobileNav(false)} aria-label="关闭菜单" /> : null}

      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Menu size={20} /></button>
          <div className="breadcrumb"><span>帧造工场</span><b>/</b><strong>{NAV_ITEMS.find((item) => item.id === section)?.label}</strong></div>
          <div className="topbar-actions">
            <div className="search-box"><Search size={16} /><input aria-label="搜索任务" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setSection("queue"); }} placeholder="搜索任务…" /><kbd>↵</kbd></div>
            <button className="icon-button" onClick={() => setNotice(jobs.some((job) => job.status === "failed") ? "有任务执行失败，请在任务队列查看错误。" : "当前没有新的异常通知。") } aria-label="通知"><Bell size={18} /><span className="notification-dot" /></button>
            <div className="api-pill">
              <span className={classNames("state-dot", apiState)} />
              {apiState === "online" ? "控制 API 在线" : apiState === "connecting" ? "正在连接" : "控制 API 离线"}
            </div>
          </div>
        </header>

        <div className="page-content">
          {section === "create" ? (
            <CreateView
              activeJobs={activeJobs}
              onlineNodes={onlineNodes}
              completedJobs={completedJobs}
              nodes={nodes}
              jobs={jobs}
              apiState={apiState}
              prompt={prompt}
              setPrompt={setPrompt}
              projectName={projectName}
              setProjectName={setProjectName}
              mode={mode}
              setMode={setMode}
              resolution={resolution}
              setResolution={setResolution}
              duration={duration}
              setDuration={setDuration}
              seed={seed}
              setSeed={setSeed}
              reference={reference}
              setReference={setReference}
              workflowFile={workflowFile}
              setWorkflowFile={setWorkflowFile}
              simulation={simulation}
              setSimulation={setSimulation}
              submitting={submitting}
              submitJob={submitJob}
              refresh={fetchRuntime}
              openSection={setSection}
              assets={assets}
              selectedAssetIds={selectedAssetIds}
              toggleAsset={toggleAsset}
              nightRuns={nightRuns}
              selectedNightRunId={selectedNightRunId}
              setSelectedNightRunId={setSelectedNightRunId}
              productionStage={productionStage}
              setProductionStage={setProductionStage}
              parentJobId={parentJobId}
              setParentJobId={setParentJobId}
            />
          ) : null}
          {section === "night" ? (
            <NightSupervisorView
              nightRuns={nightRuns}
              jobs={jobs}
              createNightRun={createNightRun}
              updateNightRunStatus={updateNightRunStatus}
              reviewNightJob={reviewNightJob}
              prepareNightJob={prepareNightJob}
              announce={setNotice}
            />
          ) : null}
          {section === "queue" ? (
            <QueueView jobs={filteredJobs} filter={queueFilter} setFilter={setQueueFilter} cancelJob={cancelJob} openCreate={() => setSection("create")} />
          ) : null}
          {section === "library" ? (
            <LibraryView
              announce={setNotice}
              onSummary={setLibrarySummary}
            />
          ) : null}
          {section === "workflows" ? <WorkflowView openCreate={() => setSection("create")} /> : null}
          {section === "assets" ? (
            <AssetsView
              assets={assets}
              selectedAssetIds={selectedAssetIds}
              toggleAsset={toggleAsset}
              openCreate={() => setSection("create")}
              refreshAssets={refreshAssets}
              announce={setNotice}
            />
          ) : null}
          {section === "nodes" ? <NodesView nodes={nodes} apiState={apiState} refresh={fetchRuntime} /> : null}
        </div>
      </main>

      {notice ? <div className="toast"><span><Check size={16} /></span>{notice}</div> : null}
    </div>
  );
}

type CreateViewProps = {
  activeJobs: number;
  onlineNodes: number;
  completedJobs: number;
  nodes: PipelineNode[];
  jobs: Job[];
  apiState: ApiState;
  prompt: string;
  setPrompt: (value: string) => void;
  projectName: string;
  setProjectName: (value: string) => void;
  mode: string;
  setMode: (value: string) => void;
  resolution: string;
  setResolution: (value: string) => void;
  duration: string;
  setDuration: (value: string) => void;
  seed: string;
  setSeed: (value: string) => void;
  reference: File | null;
  setReference: (value: File | null) => void;
  workflowFile: File | null;
  setWorkflowFile: (value: File | null) => void;
  simulation: boolean;
  setSimulation: (value: boolean) => void;
  submitting: boolean;
  submitJob: () => void;
  refresh: () => void;
  openSection: (section: Section) => void;
  assets: Asset[];
  selectedAssetIds: string[];
  toggleAsset: (assetId: string) => void;
  nightRuns: NightRun[];
  selectedNightRunId: string;
  setSelectedNightRunId: (value: string) => void;
  productionStage: ProductionStage;
  setProductionStage: (value: ProductionStage) => void;
  parentJobId: string;
  setParentJobId: (value: string) => void;
};

function CreateView(props: CreateViewProps) {
  const onlinePercent = Math.round((props.onlineNodes / Math.max(props.nodes.length, 1)) * 100);
  const selectedAssets = props.assets.filter((asset) => props.selectedAssetIds.includes(asset.id));
  const activeNightRuns = props.nightRuns.filter((run) => run.status === "active");
  const passedPreviews = props.jobs.filter(
    (job) => job.night_run_id === props.selectedNightRunId
      && job.production_stage === "preview"
      && job.review_status === "passed",
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow"><span /> AI VIDEO OPERATIONS</div>
          <h1>把灵感锻造成每一帧。</h1>
          <p>从提示词、参考素材到超分与质检，在一条本地生产线上完成。</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={props.refresh}><RefreshCw size={16} />刷新状态</button>
          <button className="primary-button" onClick={() => document.getElementById("composer")?.scrollIntoView({ behavior: "smooth" })}><Plus size={17} />新建生成</button>
        </div>
      </section>

      <section className="metrics-grid" aria-label="运行概览">
        <MetricCard label="正在运行" value={String(props.activeJobs).padStart(2, "0")} suffix="个任务" icon={Activity} tone="purple" detail="单 GPU 串行调度" />
        <MetricCard label="在线节点" value={`${props.onlineNodes}/${props.nodes.length}`} suffix={`${onlinePercent}% 可用`} icon={Server} tone="green" detail={props.apiState === "online" ? "实时探测" : "等待控制 API"} />
        <MetricCard label="队列等待" value={String(props.jobs.filter((job) => job.status === "queued").length).padStart(2, "0")} suffix="个任务" icon={Clock3} tone="blue" detail="按创建时间排序" />
        <MetricCard label="已完成" value={String(props.completedJobs).padStart(2, "0")} suffix="个产物" icon={Film} tone="amber" detail="本地工作空间" />
      </section>

      <section className="workspace-grid" id="composer">
        <div className="panel composer-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">GENERATION BRIEF</span><h2><Sparkles size={19} />创建视频任务</h2></div>
            <div className={classNames("mode-badge", props.simulation ? "simulation" : "production")}>
              {props.simulation ? "模拟模式" : "真实提交"}
            </div>
          </div>

          <div className="form-grid">
            <label className="field full-field">
              <span>项目名称 <em>Project</em></span>
              <input value={props.projectName} onChange={(event) => props.setProjectName(event.target.value)} placeholder="给这次生成起一个名字" />
            </label>
            <div className="field full-field">
              <span>生成模式 <em>Generation mode</em></span>
              <div className="segmented-control">
                {["T2VA", "I2VA", "FL2VA", "Ref2VA"].map((item) => (
                  <button key={item} className={props.mode === item ? "selected" : ""} onClick={() => props.setMode(item)}>{item}</button>
                ))}
              </div>
            </div>
            <label className="field prompt-field full-field">
              <span>画面与声音描述 <em>Prompt</em><b>{props.prompt.length}/1200</b></span>
              <textarea maxLength={1200} value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} />
              <div className="prompt-tools"><button type="button" onClick={() => { if (!props.prompt.startsWith("【画面】")) props.setPrompt(`【画面】${props.prompt}\n【镜头】连续单镜头，保持主体与空间关系稳定。\n【声音】环境声与画面动作同步，无旁白。`); }}><WandSparkles size={14} />结构化提示词</button><span>H3 Context-IR</span></div>
            </label>
            <div className="field reference-field">
              <span>参考素材 <em>Reference</em></span>
              <input
                id="reference-file"
                className="visually-hidden"
                type="file"
                accept="image/*,video/*,audio/*"
                onChange={(event) => props.setReference(event.target.files?.[0] ?? null)}
              />
              <div className="upload-row">
                <label htmlFor="reference-file" className={classNames("upload-zone", props.reference && "has-file")}>
                  {props.reference ? <FileJson size={22} /> : <Upload size={22} />}
                  <span><strong>{props.reference ? props.reference.name : "选择参考图片、视频或音频"}</strong><small>{props.reference ? "点击重新选择文件" : "单文件最大 20 MB · 保存到本机"}</small></span>
                </label>
                {props.reference ? <button type="button" className="file-clear" onClick={() => props.setReference(null)} aria-label="移除参考素材"><X size={15} /></button> : null}
              </div>
            </div>
            <div className="field workflow-file-field">
              <span>API 工作流 <em>ComfyUI JSON</em></span>
              <input
                id="workflow-file"
                className="visually-hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => props.setWorkflowFile(event.target.files?.[0] ?? null)}
              />
              <div className="upload-row">
                <label htmlFor="workflow-file" className={classNames("upload-zone", props.workflowFile && "has-file")}>
                  <FileJson size={22} />
                  <span><strong>{props.workflowFile ? props.workflowFile.name : "选择 API 格式工作流 JSON"}</strong><small>{props.workflowFile ? "提交前自动验证节点与占位符" : props.simulation ? "模拟模式下可选" : "真实提交时必填"}</small></span>
                </label>
                {props.workflowFile ? <button type="button" className="file-clear" onClick={() => props.setWorkflowFile(null)} aria-label="移除工作流"><X size={15} /></button> : null}
              </div>
            </div>
            <div className="field full-field linked-assets-field">
              <span>资产中心 <em>Reusable assets</em><b>{selectedAssets.length}/20</b></span>
              <div className="linked-assets-row">
                <div className="asset-chip-list">
                  {selectedAssets.length ? selectedAssets.map((asset) => {
                    const Icon = assetKindIcon(asset.kind);
                    return (
                      <button key={asset.id} type="button" className="asset-chip" onClick={() => props.toggleAsset(asset.id)} title="点击移除">
                        <Icon size={13} />
                        <span>{asset.name}</span>
                        <X size={12} />
                      </button>
                    );
                  }) : <span className="asset-chip-empty">尚未选择可复用资产；多参考任务可一次加入多个角色、场景或风格。</span>}
                </div>
                <button type="button" className="secondary-button asset-browse-button" onClick={() => props.openSection("assets")}><FolderOpen size={15} />浏览资产</button>
              </div>
            </div>
            <div className="field full-field night-link-field">
              <span>守夜计划 <em>Night Supervisor</em></span>
              <div className="night-link-grid">
                <select
                  aria-label="关联守夜计划"
                  value={props.selectedNightRunId}
                  onChange={(event) => {
                    const value = event.target.value;
                    props.setSelectedNightRunId(value);
                    props.setProductionStage(value ? "preview" : "manual");
                    props.setParentJobId("");
                  }}
                >
                  <option value="">普通任务 · 不进入夜班审核门</option>
                  {activeNightRuns.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}
                </select>
                {props.selectedNightRunId ? (
                  <div className="segmented-control compact-segmented">
                    <button type="button" className={props.productionStage === "preview" ? "selected" : ""} onClick={() => { props.setProductionStage("preview"); props.setParentJobId(""); }}>低成本样片</button>
                    <button type="button" className={props.productionStage === "final" ? "selected" : ""} onClick={() => props.setProductionStage("final")}>正式生产</button>
                  </div>
                ) : null}
              </div>
              {props.selectedNightRunId && props.productionStage === "final" ? (
                <select aria-label="已通过的父样片" value={props.parentJobId} onChange={(event) => props.setParentJobId(event.target.value)}>
                  <option value="">选择已通过审核的样片…</option>
                  {passedPreviews.map((job) => <option key={job.id} value={job.id}>{job.name} · {job.id.slice(0, 6)}</option>)}
                </select>
              ) : null}
              <small>{props.selectedNightRunId ? props.productionStage === "preview" ? "样片完成后会停在晨间审片台，不会自动高清。" : "只有已通过样片能进入正式生产。" : "普通任务沿用 1.0 的直接队列。"}</small>
            </div>
            <label className="field"><span>输出尺寸 <em>Resolution</em></span><select value={props.resolution} onChange={(event) => props.setResolution(event.target.value)}><option>768P</option><option>1080P</option><option>512P 实验</option></select></label>
            <label className="field"><span>时长 <em>Duration</em></span><div className="input-suffix"><input type="number" min="3" max="30" value={props.duration} onChange={(event) => props.setDuration(event.target.value)} /><b>秒</b></div></label>
            <label className="field"><span>随机种子 <em>Seed</em></span><input value={props.seed} onChange={(event) => props.setSeed(event.target.value)} /></label>
          </div>

          <div className="submit-row">
            <label className="toggle-line" htmlFor="simulation-toggle">
              <input id="simulation-toggle" aria-label="启用安全模拟模式" type="checkbox" checked={props.simulation} onChange={(event) => props.setSimulation(event.target.checked)} />
              <span className="toggle"><i /></span>
              <span><strong>安全模拟</strong><small>不调用 GPU，快速验证完整流程</small></span>
            </label>
            <button className="launch-button" disabled={props.submitting} onClick={props.submitJob}>
              {props.submitting ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              {props.submitting ? "正在创建…" : "加入生产队列"}
            </button>
          </div>
        </div>

        <div className="panel node-panel">
          <div className="panel-header compact">
            <div><span className="panel-kicker">NODE RACK</span><h2><Cpu size={18} />本地节点</h2></div>
            <button className="text-button" onClick={() => props.openSection("nodes")}>查看详情</button>
          </div>
          <div className="node-list">
            {props.nodes.map((node) => <NodeRow key={node.id} node={node} />)}
          </div>
          <div className="resource-card">
            <div className="resource-top"><span><Gauge size={16} />调度策略</span><strong>单 GPU 串行</strong></div>
            <div className="resource-track"><span style={{ width: props.activeJobs ? "64%" : "8%" }} /></div>
            <p>{props.activeJobs ? "重任务正在执行，其余任务自动排队。" : "GPU 当前空闲，等待生产任务。"}</p>
          </div>
        </div>
      </section>

      <section className="panel pipeline-panel">
        <div className="panel-header compact"><div><span className="panel-kicker">PRODUCTION LINE</span><h2><Clapperboard size={18} />默认生产线</h2></div><button className="text-button" onClick={() => props.openSection("workflows")}>管理工作流</button></div>
        <div className="pipeline-flow">
          {WORKFLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            return <div className="pipeline-step" key={step.label}><div className="step-index">0{index + 1}</div><div className="step-icon"><Icon size={18} /></div><div><strong>{step.label}</strong><span>{step.detail}</span></div>{index < WORKFLOW_STEPS.length - 1 ? <i /> : null}</div>;
          })}
        </div>
      </section>

      <RecentJobs jobs={props.jobs.slice(0, 4)} openQueue={() => props.openSection("queue")} />
    </>
  );
}

function MetricCard({ label, value, suffix, icon: Icon, tone, detail }: { label: string; value: string; suffix: string; icon: LucideIcon; tone: string; detail: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div className="metric-copy"><span>{label}</span><strong>{value}<small>{suffix}</small></strong><p><i />{detail}</p></div><MoreHorizontal size={18} className="metric-more" /></article>;
}

function NodeRow({ node }: { node: PipelineNode }) {
  return <div className="node-row"><div className={`node-glyph ${node.status}`}><Server size={17} /></div><div className="node-copy"><strong>{node.name}</strong><span>{node.role} · {node.url}</span></div><div className={`node-state ${node.status}`}><i />{node.status === "online" ? `${node.latency_ms ?? "—"} ms` : node.status === "checking" ? "探测中" : "离线"}</div></div>;
}

function RecentJobs({ jobs, openQueue }: { jobs: Job[]; openQueue: () => void }) {
  return <section className="panel jobs-panel"><div className="panel-header compact"><div><span className="panel-kicker">RECENT RUNS</span><h2><Clock3 size={18} />最近任务</h2></div><button className="text-button" onClick={openQueue}>全部任务</button></div>{jobs.length ? <div className="job-table">{jobs.map((job) => <JobRow key={job.id} job={job} />)}</div> : <div className="empty-inline"><div><Clapperboard size={21} /></div><span><strong>还没有生产任务</strong><small>完成上方配置并加入队列，任务会显示在这里。</small></span></div>}</section>;
}

function JobRow({ job, onCancel }: { job: Job; onCancel?: (id: string) => void }) {
  return <div className="job-row"><div className="job-thumb"><Film size={18} /><span>{job.mode}</span></div><div className="job-main"><div><strong>{job.name}</strong>{job.simulated ? <b className="demo-tag">模拟</b> : null}{job.production_stage === "preview" ? <b className="preview-tag">样片</b> : job.production_stage === "final" ? <b className="final-tag">正式</b> : null}</div><span>{job.resolution} · {formatTime(job.created_at)} · {job.stage}</span></div><div className="job-progress"><div><span style={{ width: `${job.progress}%` }} /></div><b>{job.progress}%</b></div><span className={`status-chip ${job.status}`}><i />{jobStatusLabel(job.status)}</span>{onCancel && (job.status === "queued" || job.status === "running") ? <button className="icon-button small" onClick={() => onCancel(job.id)} aria-label={`取消 ${job.name}`}><Square size={13} /></button> : <span />}</div>;
}

type NightSupervisorViewProps = {
  nightRuns: NightRun[];
  jobs: Job[];
  createNightRun: (payload: NightRunDraft) => Promise<void>;
  updateNightRunStatus: (id: string, status: NightRunStatus) => Promise<void>;
  reviewNightJob: (jobId: string, decision: "pass" | "reject", reasons: string[]) => Promise<void>;
  prepareNightJob: (runId: string, stage: "preview" | "final", source?: Job) => void;
  announce: (message: string) => void;
};

function NightSupervisorView(props: NightSupervisorViewProps) {
  const [showComposer, setShowComposer] = useState(props.nightRuns.length === 0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("今晚 · 样片校准");
  const [objective, setObjective] = useState("先验证创意方向和核心动作，再决定是否扩大生产与高清化。");
  const [topics, setTopics] = useState("梦核，池核，阈限空间");
  const [mustHave, setMustHave] = useState("奇诡但自然，画面有美感，核心动作明确");
  const [shouldHave, setShouldHave] = useState("自然手持，柔焦黑柔，开头有短视频钩子");
  const [explore, setExplore] = useState("允许少量反差和恶搞趣味");
  const [forbidden, setForbidden] = useState("重复参考图，静止假动作，过暗，乱码文字");
  const [fallbackPolicy, setFallbackPolicy] = useState("新方向连续失败后暂停，剩余预算回到最近审核通过的稳定题材。");
  const [maxPreviews, setMaxPreviews] = useState("8");
  const [maxFinals, setMaxFinals] = useState("4");
  const [failureLimit, setFailureLimit] = useState("2");
  const [cutoffAt, setCutoffAt] = useState("");

  const awaitingJobs = props.jobs.filter(
    (job) => job.production_stage === "preview"
      && job.status === "completed"
      && job.review_status === "needs_review",
  );
  const passedJobs = props.jobs.filter(
    (job) => job.production_stage === "preview" && job.review_status === "passed",
  );
  const activeRuns = props.nightRuns.filter((run) => run.status === "active").length;
  const pausedRuns = props.nightRuns.filter((run) => run.status === "paused").length;

  function rules(value: string) {
    return value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
  }

  async function submitNightRun() {
    if (!name.trim() || !objective.trim()) {
      props.announce("请填写守夜计划名称和今晚的目标。");
      return;
    }
    setSaving(true);
    try {
      await props.createNightRun({
        name: name.trim(),
        objective: objective.trim(),
        topics: rules(topics),
        must_have: rules(mustHave),
        should_have: rules(shouldHave),
        explore: rules(explore),
        forbidden: rules(forbidden),
        max_previews: Number(maxPreviews),
        max_finals: Number(maxFinals),
        max_consecutive_failures: Number(failureLimit),
        cutoff_at: cutoffAt ? new Date(cutoffAt).toISOString() : null,
        fallback_policy: fallbackPolicy.trim(),
      });
      setShowComposer(false);
    } catch {
      props.announce("守夜计划创建失败，请检查预算和截止时间。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionHeading
        eyebrow="NIGHT SUPERVISOR"
        title="守夜监制"
        description="把过夜生产拆成样片校准、人工审核和正式扩产；方向错误时自动熔断。"
        action={<button className="primary-button" onClick={() => setShowComposer((current) => !current)}><Plus size={17} />新建守夜计划</button>}
      />

      <section className="metrics-grid night-metrics" aria-label="守夜概览">
        <MetricCard label="运行计划" value={String(activeRuns).padStart(2, "0")} suffix="个" icon={MoonStar} tone="purple" detail="只调度运行中的批次" />
        <MetricCard label="等待审片" value={String(awaitingJobs.length).padStart(2, "0")} suffix="条样片" icon={Clock3} tone="amber" detail="不会自动进入高清" />
        <MetricCard label="已通过" value={String(passedJobs.length).padStart(2, "0")} suffix="条样片" icon={ShieldCheck} tone="green" detail="已解锁正式生产" />
        <MetricCard label="已熔断" value={String(pausedRuns).padStart(2, "0")} suffix="个计划" icon={Pause} tone="blue" detail="暂停后不再取新任务" />
      </section>

      {showComposer ? (
        <section className="panel night-composer" id="night-composer">
          <div className="panel-header">
            <div><span className="panel-kicker">OVERNIGHT CONTRACT</span><h2><MoonStar size={19} />今晚的生产契约</h2></div>
            <button className="icon-button small" onClick={() => setShowComposer(false)} aria-label="关闭守夜计划表单"><X size={15} /></button>
          </div>
          <div className="form-grid night-form-grid">
            <label className="field"><span>计划名称 <em>Name</em></span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="field"><span>停止时间 <em>Cutoff</em></span><input type="datetime-local" value={cutoffAt} onChange={(event) => setCutoffAt(event.target.value)} /></label>
            <label className="field full-field"><span>今晚目标 <em>Objective</em></span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
            <label className="field full-field"><span>题材分组 <em>Topics</em></span><input value={topics} onChange={(event) => setTopics(event.target.value)} placeholder="用逗号分隔" /></label>
            <label className="field"><span>必须满足 <em>Must</em></span><textarea value={mustHave} onChange={(event) => setMustHave(event.target.value)} /></label>
            <label className="field"><span>禁止出现 <em>Never</em></span><textarea value={forbidden} onChange={(event) => setForbidden(event.target.value)} /></label>
            <label className="field"><span>尽量满足 <em>Should</em></span><textarea value={shouldHave} onChange={(event) => setShouldHave(event.target.value)} /></label>
            <label className="field"><span>允许探索 <em>Explore</em></span><textarea value={explore} onChange={(event) => setExplore(event.target.value)} /></label>
            <label className="field"><span>样片上限 <em>Preview budget</em></span><input type="number" min="1" max="200" value={maxPreviews} onChange={(event) => setMaxPreviews(event.target.value)} /></label>
            <label className="field"><span>正式片上限 <em>Final budget</em></span><input type="number" min="1" max="100" value={maxFinals} onChange={(event) => setMaxFinals(event.target.value)} /></label>
            <label className="field"><span>连续失败熔断 <em>Circuit breaker</em></span><input type="number" min="1" max="20" value={failureLimit} onChange={(event) => setFailureLimit(event.target.value)} /></label>
            <label className="field full-field"><span>失败后的保底策略 <em>Fallback</em></span><input value={fallbackPolicy} onChange={(event) => setFallbackPolicy(event.target.value)} /></label>
          </div>
          <div className="asset-composer-actions"><button className="secondary-button" onClick={() => setShowComposer(false)}>取消</button><button className="primary-button" disabled={saving} onClick={() => { void submitNightRun(); }}>{saving ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{saving ? "正在创建…" : "启动守夜计划"}</button></div>
        </section>
      ) : null}

      <div className="night-run-grid">
        {props.nightRuns.map((run) => {
          const progress = Math.min(100, Math.round((run.preview_count / Math.max(run.max_previews, 1)) * 100));
          return (
            <article className={classNames("panel", "night-run-card", `run-${run.status}`)} key={run.id}>
              <div className="night-run-head"><div><span className="panel-kicker">{run.id.slice(0, 8)}</span><h3>{run.name}</h3></div><span className={classNames("run-status", run.status)}><i />{run.status === "active" ? "运行中" : run.status === "paused" ? "已暂停" : run.status === "completed" ? "已完成" : "已取消"}</span></div>
              <p>{run.objective}</p>
              <div className="night-budget"><div><span style={{ width: `${progress}%` }} /></div><b>样片 {run.preview_count}/{run.max_previews} · 正式 {run.final_count}/{run.max_finals}</b></div>
              <div className="night-stat-row"><span>待审 <b>{run.awaiting_review_count}</b></span><span>通过 <b>{run.passed_count}</b></span><span>拒绝 <b>{run.rejected_count}</b></span><span>连续失败 <b>{run.consecutive_failures}/{run.max_consecutive_failures}</b></span></div>
              <div className="night-rule-groups">
                <div><strong>必须</strong>{run.must_have.slice(0, 3).map((rule) => <span key={rule}>{rule}</span>)}</div>
                <div className="forbidden"><strong>禁止</strong>{run.forbidden.slice(0, 3).map((rule) => <span key={rule}>{rule}</span>)}</div>
              </div>
              <div className="night-run-actions">
                {run.status === "active" ? <><button className="primary-button" onClick={() => props.prepareNightJob(run.id, "preview")}><Play size={15} />添加校准样片</button><button className="secondary-button" onClick={() => { void props.updateNightRunStatus(run.id, "paused"); }}><Pause size={15} />暂停</button></> : null}
                {run.status === "paused" ? <button className="primary-button" onClick={() => { void props.updateNightRunStatus(run.id, "active"); }}><Play size={15} />恢复计划</button> : null}
                {(run.status === "active" || run.status === "paused") ? <button className="text-button" onClick={() => { void props.updateNightRunStatus(run.id, "completed"); }}>结束本轮</button> : null}
              </div>
            </article>
          );
        })}
      </div>

      <section className="panel review-desk">
        <div className="panel-header compact"><div><span className="panel-kicker">MORNING REVIEW</span><h2><ShieldCheck size={18} />晨间审片台</h2></div><span className="review-count">{awaitingJobs.length} 条等待决定</span></div>
        {awaitingJobs.length ? (
          <div className="review-list">
            {awaitingJobs.map((job) => (
              <article className="review-card" key={job.id}>
                <div className="review-thumb"><Film size={22} /><span>{job.mode}</span></div>
                <div className="review-copy"><div><strong>{job.name}</strong><b>{job.resolution} · {job.duration_seconds}s</b></div><p>{job.prompt}</p><small>{job.output_path ?? "产物正在登记"}</small></div>
                <div className="review-actions"><button className="review-pass" onClick={() => { void props.reviewNightJob(job.id, "pass", ["方向正确"]); }}><ThumbsUp size={15} />通过</button><button onClick={() => { void props.reviewNightJob(job.id, "reject", ["没意思"]); }}><ThumbsDown size={14} />没意思</button><button onClick={() => { void props.reviewNightJob(job.id, "reject", ["动作错误"]); }}>动作错误</button><button onClick={() => { void props.reviewNightJob(job.id, "reject", ["内容重复"]); }}>重复</button><button onClick={() => { void props.reviewNightJob(job.id, "reject", ["画面太暗"]); }}>太暗</button></div>
              </article>
            ))}
          </div>
        ) : <EmptyState icon={ShieldCheck} title="暂时没有等待审核的样片" description="样片完成后会停在这里，不会直接进入高清和后处理。" action="查看运行计划" onAction={() => document.querySelector(".night-run-grid")?.scrollIntoView({ behavior: "smooth" })} />}
      </section>

      {passedJobs.length ? (
        <section className="panel approved-previews"><div className="panel-header compact"><div><span className="panel-kicker">PROMOTION GATE</span><h2><ThumbsUp size={18} />已通过样片</h2></div><span className="review-count">{passedJobs.length} 条可扩产</span></div><div className="approved-grid">{passedJobs.map((job) => <article key={job.id}><div><strong>{job.name}</strong><span>{job.review_reasons.join(" · ") || "人工审核通过"}</span></div><button className="primary-button" onClick={() => props.prepareNightJob(job.night_run_id ?? "", "final", job)}>进入正式生产</button></article>)}</div></section>
      ) : null}
    </>
  );
}

function QueueView({ jobs, filter, setFilter, cancelJob, openCreate }: { jobs: Job[]; filter: "all" | JobState; setFilter: (value: "all" | JobState) => void; cancelJob: (id: string) => void; openCreate: () => void }) {
  const filters: Array<["all" | JobState, string]> = [["all", "全部"], ["running", "生成中"], ["queued", "排队中"], ["completed", "已完成"], ["failed", "异常"]];
  return <><SectionHeading eyebrow="ORCHESTRATION" title="任务队列" description="查看生成进度、流水线阶段与调度状态。" action={<button className="primary-button" onClick={openCreate}><Plus size={17} />创建任务</button>} /><section className="panel view-panel"><div className="filter-row"><div className="filter-tabs">{filters.map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="filter-hint"><SlidersHorizontal size={14} />状态筛选</span></div>{jobs.length ? <div className="job-table spacious">{jobs.map((job) => <JobRow key={job.id} job={job} onCancel={cancelJob} />)}</div> : <EmptyState icon={Clock3} title="这个视图还没有任务" description="创建一个模拟任务即可验证排队、进度与完成状态。" action="前往创作台" onAction={openCreate} />}</section></>;
}

function WorkflowView({ openCreate }: { openCreate: () => void }) {
  return <><SectionHeading eyebrow="PIPELINE LIBRARY" title="工作流模板" description="把模型调用、增强与质检组合成可重复的生产线；状态只表示当前本机接入事实。" action={<button className="primary-button" onClick={openCreate}><Play size={16} />前往创作台</button>} /><div className="workflow-grid">{WORKFLOW_CARDS.map((card, index) => <article className="workflow-card" key={card.name}><div className={`workflow-preview ${card.color}`}><span>0{index + 1}</span><Boxes size={28} /></div><div className="workflow-body"><span className="workflow-type">{card.type}</span><h3>{card.name}</h3><p>{card.desc}</p><div className="workflow-footer"><span className={card.statusTone}><Activity size={14} />{card.status}</span><button onClick={openCreate}>配置任务</button></div></div></article>)}</div></>;
}

type AssetsViewProps = {
  assets: Asset[];
  selectedAssetIds: string[];
  toggleAsset: (assetId: string) => void;
  openCreate: () => void;
  refreshAssets: () => Promise<void>;
  announce: (message: string) => void;
};

function AssetsView({ assets, selectedAssetIds, toggleAsset, openCreate, refreshAssets, announce }: AssetsViewProps) {
  const [filter, setFilter] = useState<"all" | AssetKind>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [showComposer, setShowComposer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<AssetKind>("character");
  const [draftControl, setDraftControl] = useState<AssetControl>("identity");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPromptHint, setDraftPromptHint] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftFile, setDraftFile] = useState<File | null>(null);

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return assets
      .filter((asset) => filter === "all" || asset.kind === filter)
      .filter((asset) => !normalizedQuery || `${asset.name} ${asset.description} ${asset.tags.join(" ")}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery))
      .sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name, "zh-CN");
        const direction = sort === "newest" ? -1 : 1;
        return direction * left.created_at.localeCompare(right.created_at);
      });
  }, [assets, filter, query, sort]);

  function resetComposer() {
    setDraftName("");
    setDraftKind("character");
    setDraftControl("identity");
    setDraftDescription("");
    setDraftPromptHint("");
    setDraftTags("");
    setDraftFile(null);
    setShowComposer(false);
  }

  async function saveAsset() {
    if (!draftName.trim()) {
      announce("请先填写资产名称。");
      return;
    }
    if (draftFile && draftFile.size > 20 * 1024 * 1024) {
      announce("资产文件超过 20 MB 限制。");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftName.trim(),
          kind: draftKind,
          description: draftDescription.trim(),
          tags: draftTags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
          prompt_hint: draftPromptHint.trim(),
          control: draftControl,
          file_name: draftFile?.name ?? null,
          mime_type: draftFile?.type ?? null,
          file_data: draftFile ? await fileToBase64(draftFile) : null,
        }),
      });
      if (!response.ok) throw new Error("create asset failed");
      await refreshAssets();
      resetComposer();
      announce("资产已保存到本地资产中心。");
    } catch {
      announce("资产保存失败，请检查文件类型和本地 API 日志。");
    } finally {
      setSaving(false);
    }
  }

  async function importAssetPack(file: File | null) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      const response = await fetch(`${API_BASE}/assets/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("import asset pack failed");
      const result = (await response.json()) as { imported_count: number; pack_name: string };
      await refreshAssets();
      announce(`资产包“${result.pack_name}”已导入 ${result.imported_count} 项。`);
    } catch {
      announce("资产包导入失败；请选择符合 FFAI 1.0 资产包格式的 JSON。");
    }
  }

  function changeKind(kind: AssetKind) {
    const controlByKind: Record<AssetKind, AssetControl> = {
      character: "identity",
      scene: "scene",
      style: "style",
      prop: "prop",
      audio: "audio",
      custom: "reference",
    };
    setDraftKind(kind);
    setDraftControl(controlByKind[kind]);
  }

  return (
    <>
      <SectionHeading
        eyebrow="LOCAL ASSET CENTER"
        title="资产中心"
        description="沉淀可复用的角色、场景、风格包、道具和声音，并直接加入本地 H3 创作。"
        action={(
          <>
            <input id="asset-pack-file" className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { void importAssetPack(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} />
            <label htmlFor="asset-pack-file" className="secondary-button"><Upload size={16} />导入资产包</label>
            <button className="primary-button" onClick={() => setShowComposer((current) => !current)}><Plus size={17} />添加资产</button>
          </>
        )}
      />

      {showComposer ? (
        <section className="panel asset-composer" aria-label="添加资产">
          <div className="asset-composer-heading">
            <div><span className="panel-kicker">NEW REUSABLE ASSET</span><h2><Plus size={18} />添加本地资产</h2></div>
            <button className="icon-button small" onClick={resetComposer} aria-label="关闭资产编辑器"><X size={15} /></button>
          </div>
          <div className="asset-form-grid">
            <label className="field"><span>资产名称 <em>Name</em></span><input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="例如：橘猫主角 · 正面参考" /></label>
            <label className="field"><span>资产分类 <em>Category</em></span><select value={draftKind} onChange={(event) => changeKind(event.target.value as AssetKind)}>{ASSET_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select></label>
            <label className="field"><span>控制用途 <em>H3 control</em></span><select value={draftControl} onChange={(event) => setDraftControl(event.target.value as AssetControl)}>{Object.entries(ASSET_CONTROL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="field full-field"><span>简介 <em>Description</em></span><input value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} placeholder="说明这个资产适合在哪些镜头中使用" /></label>
            <label className="field full-field"><span>提示词片段 <em>Prompt hint</em></span><textarea value={draftPromptHint} onChange={(event) => setDraftPromptHint(event.target.value)} placeholder="可选：锁定外观、材质、光线或声音特征的提示词" /></label>
            <label className="field"><span>标签 <em>Tags</em></span><input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="角色，橘猫，主角" /></label>
            <div className="field asset-file-field"><span>本地文件 <em>File</em></span><input id="asset-source-file" className="visually-hidden" type="file" accept="image/*,video/*,audio/*,.json" onChange={(event) => setDraftFile(event.target.files?.[0] ?? null)} /><label htmlFor="asset-source-file" className={classNames("upload-zone", draftFile && "has-file")}><Upload size={19} /><span><strong>{draftFile?.name ?? "选择参考文件"}</strong><small>{draftFile ? "点击重新选择" : "图片、视频、音频或 JSON · 最大 20 MB"}</small></span></label></div>
          </div>
          <div className="asset-composer-actions"><button className="secondary-button" onClick={resetComposer}>取消</button><button className="primary-button" disabled={saving} onClick={() => { void saveAsset(); }}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "正在保存…" : "保存资产"}</button></div>
        </section>
      ) : null}

      <section className="panel view-panel asset-center-panel">
        <div className="asset-toolbar">
          <div className="asset-category-tabs">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>所有类型 <b>{assets.length}</b></button>
            {ASSET_KINDS.map((kind) => {
              const Icon = kind.icon;
              const count = assets.filter((asset) => asset.kind === kind.id).length;
              return <button key={kind.id} className={filter === kind.id ? "active" : ""} onClick={() => setFilter(kind.id)}><Icon size={14} />{kind.label}{count ? <b>{count}</b> : null}</button>;
            })}
          </div>
          <div className="asset-tools">
            <label className="asset-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产…" /></label>
            <select aria-label="资产排序" value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest" | "name")}><option value="newest">最近更新</option><option value="oldest">最早添加</option><option value="name">名称排序</option></select>
            <div className="asset-layout-switch" aria-label="资产布局"><button aria-label="网格布局" className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")}><Grid2X2 size={16} /></button><button aria-label="列表布局" className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}><List size={17} /></button></div>
          </div>
        </div>

        {visibleAssets.length ? (
          <div className={classNames("asset-grid", layout === "list" && "list-layout")}>
            {visibleAssets.map((asset) => {
              const Icon = assetKindIcon(asset.kind);
              const selected = selectedAssetIds.includes(asset.id);
              const isImage = asset.mime_type?.startsWith("image/") && asset.has_file;
              return (
                <article className={classNames("asset-card", selected && "selected")} key={asset.id}>
                  <div className={classNames("asset-preview", `kind-${asset.kind}`)}>
                    {isImage ? <div className="asset-image" role="img" aria-label={asset.name} style={{ backgroundImage: `url(${API_BASE}/assets/${encodeURIComponent(asset.id)}/content)` }} /> : <Icon size={30} />}
                    <span>{assetKindLabel(asset.kind)}</span>
                    {selected ? <i className="asset-selected-mark"><Check size={13} /></i> : null}
                  </div>
                  <div className="asset-card-body">
                    <div><strong>{asset.name}</strong><small>{ASSET_CONTROL_LABELS[asset.control]}</small></div>
                    <p>{asset.description || asset.file_name || "本地可复用资产"}</p>
                    {asset.tags.length ? <div className="asset-tags">{asset.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div> : null}
                    <button className={selected ? "asset-use-button selected" : "asset-use-button"} onClick={() => toggleAsset(asset.id)}>{selected ? <><X size={13} />移出创作</> : <><Plus size={13} />加入创作</>}</button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Archive} title={assets.length ? "没有匹配的资产" : "还没有任何资产"} description={assets.length ? "调整分类或搜索词，找到要复用的角色、场景或风格。" : "点击右上角添加资产，或导入 FFAI JSON 资产包。"} action={assets.length ? "清除筛选" : "添加第一个资产"} onAction={() => { if (assets.length) { setFilter("all"); setQuery(""); } else { setShowComposer(true); } }} />
        )}
        {selectedAssetIds.length ? <div className="asset-selection-bar"><span><Check size={15} />已选择 {selectedAssetIds.length} 个资产，可通过 <code>{"{{reference_paths}}"}</code> 传给 H3</span><button className="primary-button" onClick={openCreate}><Play size={15} />返回创作台</button></div> : null}
      </section>
    </>
  );
}

function LibraryView({ announce, onSummary }: { announce: (message: string) => void; onSummary: (summary: LibrarySummary) => void }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [summary, setSummary] = useState<LibrarySummary>(EMPTY_LIBRARY_SUMMARY);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const [stage, setStage] = useState("");
  const [quality, setQuality] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<"history" | "files" | null>(null);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [selectedVariant, setSelectedVariant] = useState("");
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editQc, setEditQc] = useState("unreviewed");
  const [editNotes, setEditNotes] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "24", sort });
      if (query.trim()) params.set("query", query.trim());
      if (sourceKind) params.set("source_kind", sourceKind);
      if (stage) params.set("stage", stage);
      if (quality) params.set("metadata_quality", quality);
      const response = await fetch(`${API_BASE}/library?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("library request failed");
      const payload = (await response.json()) as {
        items: LibraryItem[];
        total: number;
        summary: LibrarySummary;
        sources: LibrarySource[];
      };
      setItems(payload.items);
      setTotal(payload.total);
      setSummary(payload.summary);
      setSources(payload.sources);
      onSummary(payload.summary);
    } catch {
      announce("成片库读取失败，请确认本地控制 API 已更新并启动。");
    } finally {
      setLoading(false);
    }
  }, [announce, onSummary, quality, query, sort, sourceKind, stage]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshLibrary();
    }, query ? 220 : 0);
    return () => window.clearTimeout(timeout);
  }, [refreshLibrary, query]);

  async function syncLibrary(mode: "history" | "files") {
    setSyncing(mode);
    try {
      const response = await fetch(`${API_BASE}/library/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, limit: mode === "files" ? 500 : 5000 }),
      });
      if (!response.ok) throw new Error("library sync failed");
      const payload = (await response.json()) as { result: Record<string, { processed?: number; skipped?: number }> };
      const result = payload.result[mode];
      announce(mode === "history" ? `历史记录同步完成：恢复 ${result?.processed ?? 0} 条。` : `旧片扫描完成：新增 ${result?.processed ?? 0} 条，已知文件自动跳过。`);
      await refreshLibrary();
    } catch {
      announce(mode === "history" ? "历史记录同步失败，请检查配置的数据库路径。" : "旧片扫描失败，请检查配置的片库目录。");
    } finally {
      setSyncing(null);
    }
  }

  function openItem(item: LibraryItem) {
    setSelected(item);
    setSelectedVariant(item.variants.find((variant) => variant.path === item.file_path)?.kind ?? "");
    setEditName(item.name);
    setEditPrompt(item.prompt);
    setEditQc(item.qc_status);
    setEditNotes(item.review_notes);
    setEditTags(item.tags.join("，"));
  }

  async function saveItem() {
    if (!selected || !editName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/library/${encodeURIComponent(selected.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          prompt: editPrompt.trim(),
          qc_status: editQc,
          review_notes: editNotes.trim(),
          tags: editTags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error("library update failed");
      const updated = (await response.json()) as LibraryItem;
      setSelected(updated);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      announce("成片资料已更新，不会改动原视频文件。");
    } catch {
      announce("成片资料保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    if (!selected?.prompt) return;
    try {
      await navigator.clipboard.writeText(selected.prompt);
      announce("提示词已复制。");
    } catch {
      announce("浏览器未允许复制，请在详情中手动选择提示词。");
    }
  }

  const selectedContentUrl = selected
    ? `${API_BASE}/library/${encodeURIComponent(selected.id)}/content${selectedVariant ? `?variant=${encodeURIComponent(selectedVariant)}` : ""}`
    : "";

  return (
    <>
      <SectionHeading
        eyebrow="LOCAL CLIP LIBRARY"
        title="成片库"
        description="直接预览本地成片，把提示词、参考素材、生成阶段和审核结论重新连回每一条视频。"
        action={(
          <>
            <button className="secondary-button" disabled={syncing !== null} onClick={() => { void syncLibrary("history"); }}><Database size={16} />{syncing === "history" ? "正在同步…" : "同步历史记录"}</button>
            <button className="primary-button" disabled={syncing !== null} onClick={() => { void syncLibrary("files"); }}><FolderSearch size={16} />{syncing === "files" ? "正在扫描…" : "发现最近旧片"}</button>
          </>
        )}
      />

      <section className="metrics-grid library-metrics" aria-label="成片库概览">
        <MetricCard label="已登记" value={String(summary.total).padStart(2, "0")} suffix="条" icon={Clapperboard} tone="purple" detail="记录不会移动原文件" />
        <MetricCard label="可直接播放" value={String(summary.playable).padStart(2, "0")} suffix="条" icon={Play} tone="green" detail="文件仍在原位置" />
        <MetricCard label="带提示词" value={String(summary.with_prompt).padStart(2, "0")} suffix="条" icon={FileJson} tone="blue" detail="可复制复用与检索" />
        <MetricCard label="待补资料" value={String(summary.needs_metadata).padStart(2, "0")} suffix="条" icon={Info} tone="amber" detail="仅有文件名的旧片" />
      </section>

      <section className="panel library-source-strip" aria-label="成片来源">
        <div><HardDrive size={18} /><span><strong>只读来源</strong><small>旧片保持原位；新片完成后自动登记</small></span></div>
        <div className="library-source-list">
          {sources.map((source) => <span className={source.available ? "available" : "missing"} key={source.id} title={source.path}><i />{source.label}</span>)}
          {!sources.length ? <span className="missing"><i />尚未配置历史目录</span> : null}
        </div>
      </section>

      <section className="panel view-panel clip-library-panel">
        <div className="clip-toolbar">
          <label className="asset-search clip-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索片名、批次或提示词…" /></label>
          <select aria-label="片库来源" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="">全部来源</option><option value="managed">系统新片</option><option value="history">历史记录</option><option value="discovered">发现旧片</option></select>
          <select aria-label="成片阶段" value={stage} onChange={(event) => setStage(event.target.value)}><option value="">全部阶段</option><option value="preview">样片</option><option value="raw">原片</option><option value="enhanced">增强片</option><option value="release">发布版</option><option value="unknown">待判断</option></select>
          <select aria-label="资料完整度" value={quality} onChange={(event) => setQuality(event.target.value)}><option value="">全部资料状态</option><option value="complete">资料完整</option><option value="partial">部分恢复</option><option value="filename_only">待补资料</option></select>
          <select aria-label="成片排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">最近生成</option><option value="oldest">最早生成</option><option value="name">名称排序</option></select>
          <span className="clip-result-count">显示 {items.length}/{total}</span>
        </div>

        {loading ? (
          <div className="library-loading"><LoaderCircle className="spin" size={22} />正在整理片库…</div>
        ) : items.length ? (
          <div className="clip-grid">
            {items.map((item) => (
              <article className="clip-card" key={item.id}>
                <div className="clip-preview">
                  {item.playable ? <video src={`${API_BASE}/library/${encodeURIComponent(item.id)}/content`} preload="metadata" muted playsInline><track kind="captions" src="data:text/vtt,WEBVTT%0A%0A" srcLang="zh" label="无字幕" /></video> : <div className="clip-missing"><Film size={26} /><span>文件已移动</span></div>}
                  <span className={classNames("clip-stage", item.stage)}>{libraryStageLabel(item.stage)}</span>
                  <button onClick={() => openItem(item)} aria-label={`预览 ${item.name}`}><Play size={18} fill="currentColor" /></button>
                </div>
                <div className="clip-card-body">
                  <div className="clip-title-row"><strong title={item.name}>{item.name}</strong><span className={classNames("clip-quality", item.metadata_quality)}>{libraryQualityLabel(item.metadata_quality)}</span></div>
                  <p className="clip-batch" title={item.batch_name}>{item.batch_name || "未分批次"}</p>
                  <p className={item.prompt ? "clip-prompt" : "clip-prompt empty"}>{item.prompt || "只有文件名；可在详情里补录提示词与评价。"}</p>
                  <div className="clip-meta"><span>{item.mode || librarySourceLabel(item.source_kind)}</span><span>{item.width && item.height ? `${item.width}×${item.height}` : formatFileSize(item.size_bytes)}</span><span>{formatTime(item.modified_at)}</span></div>
                  <button className="clip-detail-button" onClick={() => openItem(item)}><Info size={14} />查看提示词与素材</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={Clapperboard} title="还没有可显示的成片" description="先同步已有生产记录；需要时再扫描最近旧片，不必一次整理全部历史目录。" action="同步历史记录" onAction={() => { void syncLibrary("history"); }} />
        )}
      </section>

      {selected ? (
        <div className="clip-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="clip-detail-modal" role="dialog" aria-modal="true" aria-label={`${selected.name} 成片详情`}>
            <div className="clip-detail-head"><div><span className="panel-kicker">CLIP RECORD</span><h2>{selected.name}</h2><p>{librarySourceLabel(selected.source_kind)} · {selected.batch_name || "未分批次"}</p></div><button className="icon-button" onClick={() => setSelected(null)} aria-label="关闭成片详情"><X size={17} /></button></div>
            <div className="clip-detail-layout">
              <div className="clip-player-column">
                <div className="clip-player">{selected.playable ? <video key={selectedContentUrl} src={selectedContentUrl} controls preload="metadata" playsInline><track kind="captions" src="data:text/vtt,WEBVTT%0A%0A" srcLang="zh" label="无字幕" /></video> : <div className="clip-missing"><Film size={32} /><span>原文件已移动，记录仍然保留</span></div>}</div>
                {selected.variants.length > 1 ? <div className="clip-variants"><strong>可用阶段</strong><div>{selected.variants.map((variant) => <button className={selectedVariant === variant.kind ? "active" : ""} key={`${variant.kind}-${variant.path}`} onClick={() => setSelectedVariant(variant.kind)}>{variant.label}</button>)}</div></div> : null}
                <dl className="clip-facts">
                  <div><dt>阶段</dt><dd>{libraryStageLabel(selected.stage)}</dd></div><div><dt>模式</dt><dd>{selected.mode || "未知"}</dd></div><div><dt>Seed</dt><dd>{selected.seed ?? "—"}</dd></div><div><dt>画幅</dt><dd>{selected.width && selected.height ? `${selected.width}×${selected.height}` : "—"}</dd></div><div><dt>时长</dt><dd>{selected.duration_seconds ? `${selected.duration_seconds.toFixed(1)}s` : "—"}</dd></div><div><dt>帧率</dt><dd>{selected.fps ? `${selected.fps} fps` : "—"}</dd></div><div><dt>大小</dt><dd>{formatFileSize(selected.size_bytes)}</dd></div><div><dt>文件</dt><dd title={selected.file_path}>{selected.file_name}</dd></div>
                </dl>
                <div className="clip-references"><strong>关联素材</strong>{selected.reference_paths.length ? selected.reference_paths.map((path) => <span key={path} title={path}><ImageIcon size={13} />{basename(path)}</span>) : <p>历史记录中没有可恢复的参考素材路径。</p>}</div>
              </div>
              <div className="clip-record-column">
                <label className="field"><span>片名 <em>Name</em></span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                <label className="field clip-prompt-editor"><span>生成提示词 <em>Prompt</em><button type="button" onClick={() => { void copyPrompt(); }} disabled={!selected.prompt}><Copy size={13} />复制</button></span><textarea value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} placeholder="旧片若无法自动恢复，可以在这里补录；新片会自动保存。" /></label>
                <div className="clip-edit-row"><label className="field"><span>审核状态 <em>QC</em></span><select value={editQc} onChange={(event) => setEditQc(event.target.value)}><option value="unreviewed">未审核</option><option value="needs_review">待审核</option><option value="review">复核中</option><option value="pass">通过</option><option value="selected">精选</option><option value="selected_with_flag">精选（有备注）</option><option value="not_official">非正式候选</option><option value="rejected">淘汰</option></select></label><label className="field"><span>标签 <em>Tags</em></span><input value={editTags} onChange={(event) => setEditTags(event.target.value)} placeholder="收藏，梦核，竖屏" /></label></div>
                <label className="field clip-notes-editor"><span>复盘与评价 <em>Review notes</em></span><textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} placeholder="记录好在哪里、哪里不行、是否值得复用。" /></label>
                <div className="clip-path-note"><Tag size={15} /><span><strong>{libraryQualityLabel(selected.metadata_quality)}</strong><small title={selected.file_path}>{selected.file_path}</small></span></div>
                <div className="clip-detail-actions"><button className="secondary-button" onClick={() => setSelected(null)}>关闭</button><button className="primary-button" disabled={saving || !editName.trim()} onClick={() => { void saveItem(); }}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saving ? "正在保存…" : "保存资料"}</button></div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function NodesView({ nodes, apiState, refresh }: { nodes: PipelineNode[]; apiState: ApiState; refresh: () => void }) {
  return <><SectionHeading eyebrow="LOCAL INFRASTRUCTURE" title="节点监控" description="直接探测本机模型服务，不把未响应端口标记为可用。" action={<button className="secondary-button" onClick={refresh}><RefreshCw size={16} />重新探测</button>} /><section className="node-grid">{nodes.map((node) => <article className="node-card" key={node.id}><div className="node-card-top"><div className={`node-glyph large ${node.status}`}><Server size={21} /></div><span className={`status-chip ${node.status === "online" ? "completed" : node.status === "checking" ? "queued" : "failed"}`}><i />{node.status === "online" ? "在线" : node.status === "checking" ? "探测中" : "离线"}</span></div><h3>{node.name}</h3><p>{node.role}</p><dl><div><dt>地址</dt><dd>{node.url}</dd></div><div><dt>延迟</dt><dd>{node.latency_ms ? `${node.latency_ms} ms` : "—"}</dd></div><div><dt>说明</dt><dd>{node.detail ?? "等待探测"}</dd></div></dl></article>)}</section>{apiState === "offline" ? <div className="offline-banner"><CloudOff size={19} /><div><strong>控制 API 尚未启动</strong><span>运行 scripts/start-local.ps1 后，本页会自动刷新真实节点状态。</span></div></div> : null}</>;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action: React.ReactNode }) {
  return <section className="page-heading compact-heading"><div><div className="eyebrow"><span />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{action}</div></section>;
}

function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><div><Icon size={26} /></div><h3>{title}</h3><p>{description}</p><button className="secondary-button" onClick={onAction}>{action}</button></div>;
}
