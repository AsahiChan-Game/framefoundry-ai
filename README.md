<div align="center">

# 帧造工场 · FrameFoundry AI

### 面向中文创作者的本地优先 AI 视频生产控制台

把任务创建、节点探测、单 GPU 队列、ComfyUI API 工作流提交和产物登记放进同一个 Web 界面。

[![Version](https://img.shields.io/badge/version-v1.0.0-7c3aed.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-Windows-2563eb.svg)](#快速开始windows)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-%3E%3D3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License](https://img.shields.io/badge/license-MIT-0f766e.svg)](LICENSE)

简体中文 | [English](README_EN.md) | [版本记录](CHANGELOG.md) | [问题反馈](https://github.com/AsahiChan-Game/framefoundry-ai/issues)

</div>

当前版本：`v1.0.0`。这是独立项目，不是 MoneyPrinterTurbo 的分支，也不包含任何模型权重。

## 1.0 已实现

- 中文创作台：项目名、提示词、T2VA / I2VA / FL2VA / Ref2VA、分辨率、时长和 seed。
- 素材入口：参考图片、视频或音频保存到本地任务目录，单文件默认上限 20 MiB。
- 工作流入口：读取 ComfyUI `API Format` JSON，支持安全占位符替换。
- 本地节点探测：默认检查 `8188` 至 `8192` 五个服务，不响应就明确显示离线。
- SQLite 任务库：任务状态、进度、错误、ComfyUI `prompt_id` 与产物地址持久化。
- 单 GPU 串行调度：同一时间只执行一个重任务，其余任务按创建顺序等待。
- 安全模拟：不调用 GPU，在数秒内验证创建、排队、阶段推进和产物登记。
- 真实 ComfyUI 适配：提交 `/prompt`，轮询 `/history/{prompt_id}`，登记返回产物。
- 响应式 Web 界面：创作台、任务队列、工作流、素材库和节点监控五个视图。

## 快速开始（Windows）

要求：

- Node.js `>= 22.13.0`
- Python `>= 3.11`
- PowerShell 5.1 或更高版本

最省事的启动方式：

```powershell
.\scripts\start-local.cmd
```

脚本会在项目内创建 `.venv`、安装必要依赖，并启动：

- Web 控制台：`http://127.0.0.1:3000`
- 控制 API：`http://127.0.0.1:8766`
- API 文档：`http://127.0.0.1:8766/docs`

首次使用建议保持“安全模拟”开启，创建一个任务确认完整链路工作。

### 分开启动

终端一：

```powershell
.\scripts\start-api.ps1
```

终端二：

```powershell
npm install
npm run dev
```

## 工作方式

```mermaid
flowchart LR
    UI[Web 创作台] --> API[本地控制 API]
    API --> DB[(SQLite 任务库)]
    API --> Q[单 GPU 串行队列]
    API --> Probe[节点健康探测]
    Q --> Sim[安全模拟]
    Q --> CUI[ComfyUI /prompt]
    CUI --> History[/history 轮询]
    History --> Assets[产物登记]
```

安全模拟会走完整的控制层状态机，但只生成
`data/outputs/<job-id>/simulation-manifest.json`，不会伪装成真实视频。

真实模式在 1.0 中负责一个 ComfyUI API 工作流的提交与跟踪。工作流本身可以包含同一
ComfyUI 实例中的完整节点图；跨 `8189`、`8190`、`8191` 多服务自动串联属于后续版本。

## 接入 H3 / ComfyUI

1. 先在 ComfyUI 中确认 H3 工作流可以独立运行。
2. 开启开发者选项，导出 `Save (API Format)` JSON。
3. 可把需要动态注入的值替换为：

   - `{{prompt}}`
   - `{{seed}}`
   - `{{duration_seconds}}`
   - `{{resolution}}`
   - `{{reference_path}}`
   - `{{output_dir}}`
   - `{{job_id}}`

4. 在创作台选择工作流 JSON，关闭“安全模拟”，再提交任务。

例如，完整值 `"seed": "{{seed}}"` 会保留整数类型。更详细说明见
[examples/README.md](examples/README.md)。项目不内置虚构的 H3 节点图，因为不同安装中的
自定义节点名称与输入结构可能不同。

默认目标节点是 `http://127.0.0.1:8189`。复制 `.env.example` 为 `.env` 后，可以覆盖五个
节点地址和数据目录。

## 本地数据

运行数据默认保存在：

```text
data/
├── framefoundry.db
├── uploads/<job-id>/
└── outputs/<job-id>/
```

`.env`、数据库、上传素材、产物、虚拟环境和运行日志都已加入 `.gitignore`，不会进入后续
GitHub 仓库。

## API

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 控制服务版本与调度策略 |
| `GET` | `/api/nodes` | 实时探测五个本地节点 |
| `GET` | `/api/jobs` | 任务列表 |
| `POST` | `/api/jobs` | 创建模拟或真实任务 |
| `GET` | `/api/jobs/{id}` | 查询任务详情 |
| `POST` | `/api/jobs/{id}/cancel` | 停止本地跟踪并标记取消 |
| `POST` | `/api/workflows/validate` | 校验 API 工作流节点与占位符 |

## 验证

```powershell
npm test
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

`npm test` 包含 ESLint、生产构建和服务端 HTML 断言。后端测试覆盖工作流占位符、节点识别、
SQLite 生命周期和异常中断恢复。

## 1.0 边界

- 控制 API 只绑定 `127.0.0.1`，当前版本不支持公网部署或多人账号。
- 节点监控只证明 HTTP 服务响应，不代表工作流或模型权重一定完整。
- 浏览器上传的参考文件会保存到本机；ComfyUI 必须能访问替换后的 `reference_path`。
- 取消已提交的真实任务只停止 FrameFoundry 的跟踪，不会调用 ComfyUI 的全局 `/interrupt`，
  以免误停其他任务。
- 真实跨节点超分、ntsc-rs 后期、自动 QC、WebSocket 实时进度与视频预览计划放到 1.1+。

## 项目结构

```text
app/                 Web 控制台
backend/             FastAPI、SQLite、调度器和 ComfyUI 适配
backend/tests/       后端单元测试
examples/            工作流接入说明
scripts/             Windows 本地启动脚本
tests/               Web 服务端渲染测试
```

## 参与开发

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

## 致谢与设计参考

本项目在产品方向上参考了
[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) 将复杂视频生产过程收束到 WebUI、
任务流和一键启动体验中的思路。FrameFoundry AI 的代码与架构为独立实现，1.0 更专注于本地
ComfyUI 节点编排、真实节点状态和单 GPU 串行调度。

## License

[MIT](LICENSE)
