# @deepseek-ai/dsh-file-changes

Final File Changes V3.4 的 Host 侧撤销服务。它只为最终产物表格提供单文件 Undo Remote，不拦截 Agent 写入，也不注册任何模型工具。

## Model Experience

无。模型继续使用 Harness 原生 `write` / `edit` 等工具；这个包只处理用户点击【撤销】后的安全回滚。

## 安装

该包是一个 `dsh.bundle`：把它装进任何加载了 base bundle 的 dsh profile（base 提供 Remote 注入所需的 `fs`、`sessions` 与 typert 服务）。

- 来自打包 tarball：`dsh plugin --profile <name> add ./@deepseek-ai-dsh-file-changes-0.1.0-rc.5.tgz`
- 来自本仓库源码：在 `packages/extensions/file-changes/` 执行 `pnpm pack`，然后安装产出的 tarball。
- 发布后来自 npm：`dsh plugin --profile <name> add @deepseek-ai/dsh-file-changes`

包内的 `cordis.patch.yml` 插入一个空闲的 `file-changes` 行；仅当 profile 提供 `fs`、`sessions` 与 typert 服务时它才会激活。

## Dependencies

该 bundle 需由 base `dsh` 安装提供其 peer 依赖。源码清单把它们声明为 `workspace:^`；`pnpm pack` 在 tarball 发布前会把它们重写为已发布的版本区间，因此发布后的包只依赖已发布的 registry 版本。插件从不自带 Harness 服务的私有副本。

## Known Limitations and Deferred Work

- Undo 仅支持文本：当目标不再是普通文本文件，或创建型 / 片段型撤销时当前内容与该包记录的 after-image 不再一致，都会拒绝执行。
- 该服务仅在提供 `fs`、`sessions` 与 typert 服务的 profile 内激活；缺少这些 surface 的 profile 会让该行保持空闲。
- 撤销在所在会话解析的沙箱策略下执行，因此产物文件仍须位于该会话 workspace 根内才可写；被拒时报 `FS_SANDBOX_DENIED`。创建型撤销的删除路径用直接 unlink 移除文件,不走策略围栏。



