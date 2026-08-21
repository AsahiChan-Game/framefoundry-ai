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
- `{{reference_paths}}`
- `{{output_dir}}`
- `{{job_id}}`

完整值占位符会保留数字类型，例如 `"seed": "{{seed}}"` 会在提交时成为整数。
`{{reference_paths}}` 会保留为本地资产路径数组，适合 H3 多参考、首尾帧等支持多输入的节点。
嵌入字符串的占位符会转为文本，例如 `"prefix-{{job_id}}"`。

本仓库不内置虚构的 H3 节点图。不同 H3 / ComfyUI 安装的自定义节点名称和输入结构可能不同，
请从已经验证过的本地工作流导出 API JSON 后再接入。

## 资产包格式

资产中心可导入 JSON 文件，结构见 [asset-pack.example.json](asset-pack.example.json)。每项资产支持：

- `kind`：`character`、`scene`、`style`、`prop`、`audio` 或 `custom`
- `control`：`identity`、`scene`、`style`、`prop`、`audio` 或 `reference`
- `tags`、`description` 和 `prompt_hint`
- 可选的 `file_name`、`mime_type` 和 Base64 `file_data`

单文件默认上限 20 MiB。未嵌入文件的资产仍可作为提示词与控制用途卡片保存。
