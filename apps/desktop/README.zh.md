# DeepSeek Harness Desktop

[English](README.md) | 中文

本 package 使用 Tauri 包装随附的 `dsh web` 应用。Rust 宿主使用 `--no-open --host 0.0.0.0` 在操作系统分配的端口上启动真实 Harness 后端，使 Tauri WebView 成为唯一的应用窗口，同时同一 GUI 也能被网络上的其他设备访问。宿主等待后端就绪行，并仅在 HTTP API 和前端可用后创建 WebView。宿主把桌面平台标记放在 URL fragment 中；这些标记仅供客户端读取，并且会在启动 token 重定向到 `/` 后保留。关闭应用会终止后端进程并等待其结束。

桌面 WebView 在 macOS、Windows 和 Linux 上使用平台专用 Tauri 窗口框架和统一的 48px 应用标题栏。标题栏与无右边框的侧边栏使用相同填充色，对话区域从标题栏下方开始，并带有 15px 左上圆角。侧边栏开关在 macOS 上使用 `Command+B`，在 Windows 和 Linux 上使用 `Control+B`。在 macOS 和 Windows 上，展开状态的标题栏会在收起按钮旁显示 DeepSeek Harness wordmark；收起状态的按钮会显示 DeepSeek 鲸鱼图标，并在 hover 时换成展开图标。macOS overlay 保留原生交通灯与系统窗口圆角，并把标题栏品牌和控件放在交通灯按钮组右侧。进入 macOS 全屏后，原生交通灯会消失；此时控件取消这段内边距，并与展开侧边栏的左边缘或收起轨道的图标列对齐。Windows 和 Linux 使用无边框窗口，最小化、最大化或还原以及关闭控件位于右侧。Tauri 只在主窗口显示所属的 `http://127.0.0.1:*` 后端时授予这些操作权限。普通浏览器应用保留原有侧边栏控件，不渲染桌面窗口框架。

原生系统托盘使用应用图标，并提供 `显示窗口`、`DSH Web（端口：xxx）`、`复制访问地址` 和 `退出程序`。关闭主窗口会将其隐藏，同时保持后端可用；`显示窗口` 会恢复并聚焦主窗口。`DSH Web（端口：xxx）` 会在默认浏览器中打开正在运行的 Web 应用，其中 `xxx` 是后端的实际端口。`复制访问地址` 会把携带认证 token 的 LAN URL 复制到剪贴板，供网络上的其他设备打开同一个 GUI。`退出程序` 会同步终止所属 Node 后端并等待其结束，然后退出 Tauri 进程。

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

Tauri 将平台安装包写入 `apps/desktop/src-tauri/target/release/bundle/`。Windows 构建生成 NSIS `x64-setup.exe`；MSI 不是默认目标，因为 WiX 依赖 Windows 的可选 VBSCRIPT 功能，而且 SemVer 预发布版本需要单独提供纯数字安装包版本。macOS 签名和公证以及 Windows 代码签名使用标准 Tauri 环境变量和 CI 配置，仓库不会提供签名凭据。

应用图标由 [`apps/web/public/favicon.svg`](../web/public/favicon.svg) 生成；该文件是 Web 应用已经使用的 DeepSeek 官方标志。

## 启动诊断

安装后的宿主以随附 backend 目录为工作目录，并通过相对 CLI 入口启动 Node，因此 Windows 安装路径可以包含空格。Windows release 宿主使用 GUI subsystem，并以无控制台窗口方式启动 Node。如果后端无法启动，应用会显示错误与 `desktop-startup.log` 的位置；该文件包含捕获的后端 stdout 和 stderr。
