# Agent Note: Tauri 桌面宿主

Status: implemented

[English](2026-08-14-tauri-desktop-host.md) | 中文

## 问题

浏览器应用依赖 Host 运行时注入 `window.__DSH_BOOT__` 并承载 API。直接在桌面 WebView 中加载 `apps/web/dist/index.html` 只能得到无法使用的壳，而要求用户另行安装 Node 运行时会使桌面安装包不完整。

## 决策

[`apps/desktop`](../../../../apps/desktop/README.md) 是一个没有编译期窗口的 Tauri 2 应用。其 Rust 宿主在环回地址启动真实的已构建 `dsh web --port 0` 入口，消费现有的 `dsh web:` 就绪行，并在组装应用完成启动后创建一个外部 URL WebView。宿主在应用退出前持有子进程；清理过程会终止仍在运行的子进程并等待其结束。

生产安装包携带目标平台的 Node 可执行文件，以及以 `@deepseek-ai/dsh-desktop` 为根、由 `pnpm deploy --prod` 生成的无符号链接依赖闭包。仓库构建完成后，`scripts/prepare-desktop.ts` 将该目录物化到 Tauri 资源中，并在打包前移除桌面源码目录。桌面 package 使用显式源文件白名单，防止生成的 Tauri target 和暂存资源递归进入该闭包。因此桌面构建要分别在目标操作系统上运行，使 Node 和原生 npm 依赖与 macOS、Windows 或 Linux 匹配；安装后的客户端不需要 Node 或 pnpm。

桌面图标由 Web 应用已有的 DeepSeek 官方 SVG 生成。Tauri 从这一个源文件生成原生 ICNS、ICO 和 PNG 表示。

Rust 宿主在所属 WebView URL 上附加 `dsh-platform=tauri` 和编译目标 `dsh-os`。共享布局仅在存在这些标记时渲染 48px 拖拽区域，然后把现有侧边栏 store 的开关移动到其左侧，并在 macOS 上将其绑定到 `Command+B`，在其他平台上绑定到 `Control+B`。标题栏整条使用无右边框的侧边栏填充色，对话区域的 15px 左上圆角会露出该填充色。macOS 使用 Tauri overlay 标题栏，保留原生装饰，把标题文字隐藏，将原生交通灯放在与 iNotes 相同的内边距，并保留系统窗口圆角；HTML 侧边栏开关位于交通灯右侧。标题栏会观察原生全屏状态变化，因为 macOS 在全屏时会移除交通灯：处于全屏状态时，该控件会取消交通灯内边距，并使用展开侧边栏的 12px 内容内边距或收起轨道的 10px 图标内边距。Windows 和 Linux 使用无边框窗口，并在右侧提供 HTML 最小化、最大化或还原以及关闭控件。没有这些标记的浏览器启动仍使用现有侧边栏框架，且不会获得桌面快捷键。

## 安全与生命周期

后端沿用 Web profile 的默认值绑定 `127.0.0.1`，并由操作系统分配端口。WebView 只接受所属子进程就绪行提供的 URL。标准 Web 组合继续负责 Host header 信任、API 路由、持久化、凭据和沙箱策略。`main` WebView 仅获得 Tauri 的关闭、最小化、切换最大化和开始拖拽窗口权限，并且这些权限限定在所属的 `http://127.0.0.1:*` 来源；它不获得文件系统、shell、进程或应用 command 权限。

子进程继承桌面进程环境，因为模型提供方凭据和 Harness 配置使用这个既有渠道。宿主持续排空后端的 stdout 和 stderr。运行时缺失、后端提前退出、就绪 URL 格式错误或启动超过 60 秒都会使应用启动失败，而不会打开失去连接的窗口。

## 考虑过的替代方案

**通过 `file://` 加载 Vite 输出。** 这种方式没有注入启动 manifest，也没有 HTTP API 载体，因此应用无法初始化。

**要求用户单独启动 `dsh web`。** 这会拆分生命周期所有权、把端口选择暴露给用户，并使桌面包依赖外部 Node 安装。

**把 CLI 编译成 Node 单文件可执行程序。** Profile launcher 会维护供用户安装插件使用的磁盘 package fallback，而 SEA 虚拟文件系统不能提供普通的磁盘 package 目标。捆绑 Node 可执行文件和真实的已部署 package 目录，可在三个桌面平台上保留标准模块解析和 profile 行为。

## 后果

桌面应用与 `dsh web` 使用相同的后端、profile、持久化和浏览器前端，且平台安装包自包含。代价是安装包会因包含 Node 和生产 JavaScript 依赖目录而增大。发布任务必须在各目标操作系统上原生构建，并在仓库之外提供平台签名或公证凭据。

Cargo 编译检查 Rust 生命周期代码，`desktop:prepare` 则在物化生产闭包后验证已发布 CLI 入口。无密钥组装 Web 快照覆盖 macOS 和 Windows 标题栏及其共享侧边栏开关。现有 Web 和 CLI 测试套件仍是行为权威，因为桌面宿主不会分叉任何一个实现。
