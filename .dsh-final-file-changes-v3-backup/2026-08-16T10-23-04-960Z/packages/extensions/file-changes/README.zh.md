# @deepseek-ai/dsh-file-changes

Final File Changes V3.3 的 Host 侧撤销服务。它只为最终产物表格提供单文件 Undo Remote，不拦截 Agent 写入，也不注册任何模型工具。

## Model Experience

无。模型继续使用 Harness 原生 `write` / `edit` 等工具；这个包只处理用户点击【撤销】后的安全回滚。
