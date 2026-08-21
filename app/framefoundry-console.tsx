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
  Cpu,
  FileJson,
  Film,
  FolderOpen,
  Gauge,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  List,
  Menu,
  MonitorDot,
  MoreHorizontal,
  Play,
  Palette,
  Plus,
  PackageOpen,
  RefreshCw,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Section = "create" | "queue" | "workflows" | "assets" | "nodes";
type NodeState = "online" | "offline" | "checking";
type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";
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
  simulated: boolean;
  output_path?: string | null;
  asset_ids: string[];
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

type ApiState = "connecting" | "online" | "offline";

const API_BASE =
  process.env.NEXT_PUBLIC_FRAMEFOUNDRY_API_URL ?? "http://127.0.0.1:8766/api";

const NAV_ITEMS: Array<{
  id: Section;
  label: string;
  sublabel: string;
  icon: LucideIcon;
}> = [
  { id: "create", label: "创作台", sublabel: "Create", icon: LayoutDashboard },
  { id: "queue", label: "任务队列", sublabel: "Queue", icon: Layers3 },
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

  const refreshAssets = useCallback(async () => {
    const response = await fetch(`${API_BASE}/assets`, { cache: "no-store" });
    if (!response.ok) throw new Error("asset request was not successful");
    const payload = (await response.json()) as { assets: Asset[] };
    setAssets(payload.assets);
    setSelectedAssetIds((current) => current.filter((id) => payload.assets.some((asset) => asset.id === id)));
  }, []);

  const fetchRuntime = useCallback(async () => {
    setApiState("connecting");
    try {
      const [healthResponse, nodeResponse, jobsResponse, assetsResponse] = await Promise.all([
        fetch(`${API_BASE}/health`, { cache: "no-store" }),
        fetch(`${API_BASE}/nodes`, { cache: "no-store" }),
        fetch(`${API_BASE}/jobs`, { cache: "no-store" }),
        fetch(`${API_BASE}/assets`, { cache: "no-store" }),
      ]);
      if (!healthResponse.ok || !nodeResponse.ok || !jobsResponse.ok || !assetsResponse.ok) {
        throw new Error("API response was not successful");
      }
      const nodePayload = (await nodeResponse.json()) as { nodes: PipelineNode[] };
      const jobsPayload = (await jobsResponse.json()) as { jobs: Job[] };
      const assetsPayload = (await assetsResponse.json()) as { assets: Asset[] };
      setNodes(nodePayload.nodes);
      setJobs(jobsPayload.jobs);
      setAssets(assetsPayload.assets);
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
    }, 0);
    const interval = window.setInterval(() => {
      void fetchRuntime();
    }, 15000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [fetchRuntime]);

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
        }),
      });
      if (!response.ok) throw new Error("create job failed");
      const created = (await response.json()) as Job;
      setJobs((current) => [created, ...current]);
      setNotice(simulation ? "模拟任务已进入队列。" : "真实任务已进入队列。");
      setSection("queue");
    } catch (error) {
      setNotice(error instanceof SyntaxError ? "工作流 JSON 格式无效。" : "任务创建失败，请检查本地 API 日志。");
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
            />
          ) : null}
          {section === "queue" ? (
            <QueueView jobs={filteredJobs} filter={queueFilter} setFilter={setQueueFilter} cancelJob={cancelJob} openCreate={() => setSection("create")} />
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
};

function CreateView(props: CreateViewProps) {
  const onlinePercent = Math.round((props.onlineNodes / Math.max(props.nodes.length, 1)) * 100);
  const selectedAssets = props.assets.filter((asset) => props.selectedAssetIds.includes(asset.id));
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
  return <div className="job-row"><div className="job-thumb"><Film size={18} /><span>{job.mode}</span></div><div className="job-main"><div><strong>{job.name}</strong>{job.simulated ? <b className="demo-tag">模拟</b> : null}</div><span>{job.resolution} · {formatTime(job.created_at)} · {job.stage}</span></div><div className="job-progress"><div><span style={{ width: `${job.progress}%` }} /></div><b>{job.progress}%</b></div><span className={`status-chip ${job.status}`}><i />{jobStatusLabel(job.status)}</span>{onCancel && (job.status === "queued" || job.status === "running") ? <button className="icon-button small" onClick={() => onCancel(job.id)} aria-label={`取消 ${job.name}`}><Square size={13} /></button> : <span />}</div>;
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

function NodesView({ nodes, apiState, refresh }: { nodes: PipelineNode[]; apiState: ApiState; refresh: () => void }) {
  return <><SectionHeading eyebrow="LOCAL INFRASTRUCTURE" title="节点监控" description="直接探测本机模型服务，不把未响应端口标记为可用。" action={<button className="secondary-button" onClick={refresh}><RefreshCw size={16} />重新探测</button>} /><section className="node-grid">{nodes.map((node) => <article className="node-card" key={node.id}><div className="node-card-top"><div className={`node-glyph large ${node.status}`}><Server size={21} /></div><span className={`status-chip ${node.status === "online" ? "completed" : node.status === "checking" ? "queued" : "failed"}`}><i />{node.status === "online" ? "在线" : node.status === "checking" ? "探测中" : "离线"}</span></div><h3>{node.name}</h3><p>{node.role}</p><dl><div><dt>地址</dt><dd>{node.url}</dd></div><div><dt>延迟</dt><dd>{node.latency_ms ? `${node.latency_ms} ms` : "—"}</dd></div><div><dt>说明</dt><dd>{node.detail ?? "等待探测"}</dd></div></dl></article>)}</section>{apiState === "offline" ? <div className="offline-banner"><CloudOff size={19} /><div><strong>控制 API 尚未启动</strong><span>运行 scripts/start-local.ps1 后，本页会自动刷新真实节点状态。</span></div></div> : null}</>;
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action: React.ReactNode }) {
  return <section className="page-heading compact-heading"><div><div className="eyebrow"><span />{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{action}</div></section>;
}

function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: LucideIcon; title: string; description: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><div><Icon size={26} /></div><h3>{title}</h3><p>{description}</p><button className="secondary-button" onClick={onAction}>{action}</button></div>;
}
