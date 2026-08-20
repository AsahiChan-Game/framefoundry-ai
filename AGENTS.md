# FrameFoundry AI 协作规则

- 默认使用中文沟通和文档；代码标识、API 与工具名保留英文。
- 修改前阅读本文件和 `README.md`，并检查 `git status`。
- Web 界面位于 `app/`，本地控制服务位于 `backend/`，不要把模型调用塞进浏览器端。
- 节点在线状态必须来自实际 HTTP 探测；模拟任务必须明确标记为模拟。
- GPU 重任务保持串行调度，除非有经过验证的显存隔离方案。
- 不提交 `.env`、`data/`、模型权重、参考素材、生成产物、日志或本机绝对路径。
- 工作流输入只允许提交到配置中的节点地址，不接受请求体自带任意 URL。
- 前端修改至少运行 `npm run lint` 和 `npm run build`。
- 后端修改至少运行 `.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v`。
- 未经用户单独授权，不创建 GitHub 仓库、不提交、不推送、不部署。
