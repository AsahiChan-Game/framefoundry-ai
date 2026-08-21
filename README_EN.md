<div align="center">

# FrameFoundry AI

### A local-first AI video production console for Chinese creators

[![Version](https://img.shields.io/badge/version-v1.0.0-7c3aed.svg)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/platform-Windows-2563eb.svg)](#quick-start-windows)
[![License](https://img.shields.io/badge/license-MIT-0f766e.svg)](LICENSE)

[简体中文](README.md) | English | [Changelog](CHANGELOG.md) | [Issues](https://github.com/AsahiChan-Game/framefoundry-ai/issues)

</div>

FrameFoundry AI brings task creation, local node probing, a single-GPU queue, ComfyUI API workflow submission, and output registration into one Web console.

Version `v1.0.0` is an independent project. It is not a MoneyPrinterTurbo fork and does not include model weights.

The `1.1` development branch includes a **Night Supervisor** MVP: overnight plans generate review-gated previews first, and only an approved preview can unlock a final task. Preview/final budgets, cutoffs, and consecutive-failure circuit breakers are enforced by the local API.

The development branch also includes a local **Clip Library**. It can preview registered videos, recover prompts and QC metadata from an existing read-only production-history database, and discover untracked files only from explicitly configured folders. Legacy files are never moved or copied.

## What 1.0 includes

- A Chinese-first Web console for T2VA, I2VA, FL2VA, and Ref2VA tasks.
- Reference media and ComfyUI `API Format` workflow inputs.
- Honest health checks for five configurable local services on ports `8188` to `8192`.
- SQLite task persistence and a serial queue for single-GPU workstations.
- A clearly labeled simulation mode for validating the complete task lifecycle without using a GPU.
- Real ComfyUI `/prompt` submission, `/history/{prompt_id}` polling, and output registration.
- Windows scripts for starting the Web console and local FastAPI service together.
- A local asset center for reusable character, scene, style, prop, audio, and custom references.
- A review-gated Night Supervisor flow for safer unattended batches.
- A searchable local Clip Library with playable videos, prompts, references, stages, variants, and QC notes.

## Quick start (Windows)

Requirements:

- Node.js `>= 22.13.0`
- Python `>= 3.11`
- PowerShell 5.1 or later

Run:

```powershell
.\scripts\start-local.cmd
```

The script starts:

- Web console: `http://127.0.0.1:3000`
- Control API: `http://127.0.0.1:8766`
- API documentation: `http://127.0.0.1:8766/docs`

Keep **Safe simulation** enabled for your first task. Real generation requires a working ComfyUI API workflow exported with `Save (API Format)`.

## Verification

```powershell
npm test
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

## Current boundaries

- The control API binds to `127.0.0.1`; v1.0 is not a hosted multi-user service.
- Health checks prove that an HTTP service responded, not that every model or custom node is installed.
- Real mode tracks one ComfyUI workflow. Cross-service orchestration across `8189`–`8191` is planned for a later release.
- Cancelling a submitted real task stops FrameFoundry tracking but does not call ComfyUI's global `/interrupt` endpoint.
- The Night Supervisor MVP provides deterministic budgets, review gates, and circuit breaking. Automated visual/semantic taste scoring is not presented as complete yet.
- Legacy clip discovery is intentionally partial: files without trustworthy metadata remain marked as filename-only records instead of receiving invented prompts.

See the [Chinese README](README.md) for full API, workflow placeholder, storage, and architecture documentation.

## Acknowledgements

The product direction was inspired by [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo), especially its approachable WebUI, task-oriented flow, and one-command startup experience. FrameFoundry AI is an independent implementation focused on local ComfyUI orchestration and honest node state reporting.

## License

[MIT](LICENSE)
