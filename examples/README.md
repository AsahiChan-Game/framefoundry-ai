# ComfyUI 工作流接入

FrameFoundry AI 需要 ComfyUI 的 **API Format** 工作流 JSON，而不是普通界面工作流。

1. 在已经可以独立运行的 H3 / ComfyUI 工作流中开启开发者选项。
2. 使用 `Save (API Format)` 导出 JSON。
3. 可以把需要动态替换的输入值改为以下占位符：

- `{{prompt}}`
- `{{seed}}`
- `{{duration_seconds}}`
- `{{resolution}}`
- `{{reference_path}}`
- `{{output_dir}}`
- `{{job_id}}`

完整值占位符会保留数字类型，例如 `"seed": "{{seed}}"` 会在提交时成为整数。
嵌入字符串的占位符会转为文本，例如 `"prefix-{{job_id}}"`。

本仓库不内置虚构的 H3 节点图。不同 H3 / ComfyUI 安装的自定义节点名称和输入结构可能不同，
请从已经验证过的本地工作流导出 API JSON 后再接入。
