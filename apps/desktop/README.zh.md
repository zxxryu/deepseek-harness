# DeepSeek Harness Desktop

[English](README.md) | 中文

本 package 使用 Tauri 包装随附的 `dsh web` 应用。Rust 宿主在操作系统分配的环回端口上启动真实 Harness 后端，等待其就绪行，并仅在 HTTP API 和前端可用后创建 WebView。关闭应用会终止后端进程并等待其结束。

桌面 WebView 在 macOS、Windows 和 Linux 上使用平台专用 Tauri 窗口框架和统一的 48px 应用标题栏。标题栏与无右边框的侧边栏使用相同填充色，对话区域从标题栏下方开始，并带有 15px 左上圆角。侧边栏开关在 macOS 上使用 `Command+B`，在 Windows 和 Linux 上使用 `Control+B`。macOS overlay 保留原生交通灯与系统窗口圆角，使控件上下居中，并让侧边栏开关像 iNotes 一样位于交通灯按钮组右侧。进入 macOS 全屏后，原生交通灯会消失；此时开关取消这段内边距，并与展开侧边栏的左边缘或收起轨道的图标列对齐。Windows 和 Linux 使用无边框窗口，最小化、最大化或还原以及关闭控件位于右侧。Tauri 只在主窗口显示所属的 `http://127.0.0.1:*` 后端时授予这些操作权限。普通浏览器应用保留原有侧边栏控件，不渲染桌面窗口框架。

## 开发

在仓库根目录安装依赖并构建 JavaScript 产物，然后启动 Tauri：

```sh
pnpm install
pnpm run desktop:dev
```

开发宿主运行 `apps/cli/lib/bin.js`，因此前端和 package 变更需要执行与 `dsh web` 相同的重新构建。

## 分发

需要在每个目标操作系统上构建，使原生 Node 依赖与安装包匹配。准备步骤会创建无符号链接的生产依赖目录，并把当前 Node 可执行文件复制到 Tauri 资源中；用户不需要安装 Node 或 pnpm。

```sh
pnpm run desktop:build
```

Tauri 将平台安装包写入 `apps/desktop/src-tauri/target/release/bundle/`。macOS 签名和公证以及 Windows 代码签名使用标准 Tauri 环境变量和 CI 配置，仓库不会提供签名凭据。

应用图标由 [`apps/web/public/favicon.svg`](../web/public/favicon.svg) 生成；该文件是 Web 应用已经使用的 DeepSeek 官方标志。
