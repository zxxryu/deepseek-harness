# Agent Note: Tauri 桌面宿主

Status: implemented

[English](2026-08-14-tauri-desktop-host.md) | 中文

## 问题

浏览器应用依赖 Host 运行时注入 `window.__DSH_BOOT__` 并承载 API。直接在桌面 WebView 中加载 `apps/web/dist/index.html` 只能得到无法使用的壳，而要求用户另行安装 Node 运行时会使桌面安装包不完整。

## 决策

[`apps/desktop`](../../../../apps/desktop/README.zh.md) 是一个没有编译期窗口的 Tauri 2 应用。其 Rust 宿主在所有接口上启动真实的已构建 `dsh web --no-open --host 0.0.0.0 --port 0` 入口，防止后端打开系统浏览器，同时让 GUI 可被局域网访问；宿主消费现有的 `dsh web:` 就绪行（loopback URL 及可选的携带 token 的 LAN URL），并在组装应用完成启动后创建一个外部 URL WebView。宿主在应用退出前持有子进程；清理过程会终止仍在运行的子进程并等待其结束。

生产安装包携带目标平台的 Node 可执行文件，以及以 `@deepseek-ai/dsh-desktop` 为根、由 `pnpm deploy --prod` 生成的无符号链接依赖闭包。`scripts/prepare-desktop.ts` 将该目录物化到仓库根目录下较短的 `.dsh-desktop` 暂存目录，在 legacy deploy 后恢复 pnpm 工作区状态文件，并仅在 Tauri 打包时将该目录映射到 `resources/backend`。较短的源路径让嵌套 NPM 依赖保持在 Windows 安装包工具的路径长度限制以内，同时不改变安装后的资源路径。桌面 package 使用显式源文件白名单，防止生成的 Tauri target 和暂存资源递归进入该闭包。

桌面构建要分别在目标操作系统上运行，使 Node 和原生 NPM 依赖与 macOS、Windows 或 Linux 匹配；安装后的客户端不需要 Node 或 pnpm。Windows 构建选择 NSIS 安装包，因为它接受共享 SemVer 版本，而且不依赖 WiX MSI 构建所需的 Windows 可选 VBSCRIPT 功能。其他平台仍使用 Tauri 的平台目标。

桌面图标由 Web 应用已有的 DeepSeek 官方 SVG 生成。Tauri 从这一个源文件生成原生 ICNS、ICO 和 PNG 表示。

Rust 宿主把 `dsh-platform=tauri` 和编译目标 `dsh-os` 存入所属 WebView 的 URL fragment。fragment 仅供客户端读取，并且会在浏览器认证通过启动 token 重定向到干净的 `/` URL 后保留。共享布局仅在存在这些标记时渲染 48px 拖拽区域，然后把现有侧边栏 store 的开关移动到其左侧，并在 macOS 上将其绑定到 `Command+B`，在其他平台上绑定到 `Control+B`。标题栏整条使用无右边框的侧边栏填充色，对话区域的 15px 左上圆角会露出该填充色。macOS 使用 Tauri overlay 标题栏，保留原生装饰，把标题文字隐藏，将原生交通灯放在与 iNotes 相同的内边距，并保留系统窗口圆角；HTML 品牌和控件位于交通灯右侧。macOS 和 Windows 在侧边栏展开时显示 DeepSeek Harness wordmark，收起时则把鲸鱼图标放进按钮，并在 hover 时换成展开图标。标题栏会观察原生全屏变化，因为 macOS 在全屏时会移除交通灯：处于全屏状态时，该控件会取消交通灯内边距，并使用展开侧边栏的 12px 内容内边距或收起轨道的 10px 图标内边距。Windows 和 Linux 使用无边框窗口，并在右侧提供 HTML 最小化、最大化或还原以及关闭控件。没有这些标记的浏览器启动仍使用现有侧边栏框架，且不会获得桌面快捷键。

原生系统托盘使用随附的应用图标，并持有四个菜单操作：`显示窗口` 会恢复并聚焦主窗口，`DSH Web（端口：xxx）` 会使用后端的实际端口在默认浏览器中打开正在运行的 Web 应用，`复制访问地址` 会把携带 token 的 LAN URL（没有则回退到 loopback URL）写入剪贴板，供其他设备打开同一个 GUI；`退出程序` 会同步终止 Node 后端并等待其结束，然后请求退出应用。主窗口关闭请求会隐藏窗口而不是销毁窗口，因此托盘可以恢复同一个 WebView 和后端会话。

## 安全与生命周期

后端绑定 `0.0.0.0`，由操作系统分配端口，刻意把 Web 应用暴露到网络；浏览器会话认证和打印的 LAN URL 携带的进程 token 是唯一防线，剪贴板中的 LAN URL 保留其 token。WebView 只接受所属子进程就绪行提供的 URL。标准 Web 组合继续负责 Host header 信任、API 路由、持久化、凭据和沙箱策略。`main` WebView 仅获得 Tauri 的关闭、最小化、切换最大化和开始拖拽窗口权限，并且这些权限限定在所属的 `http://127.0.0.1:*` 来源；它不获得文件系统、shell、进程或应用 command 权限。

子进程继承桌面进程环境，因为模型提供方凭据和 Harness 配置使用这个既有渠道。生产环境以随附 backend 为工作目录并传入相对 CLI 入口，因此 Windows 不必保留包含空格的绝对脚本参数。Windows release 宿主选择 GUI subsystem，后端子进程则使用无控制台创建标志。宿主持续排空后端的 stdout 和 stderr，并写入应用日志目录下的 `desktop-startup.log`。运行时缺失、后端提前退出、就绪 URL 格式错误或启动超过 60 秒时，应用会通过原生错误对话框显示该日志路径并使启动失败，而不会打开失去连接的窗口。

## 考虑过的替代方案

**通过 `file://` 加载 Vite 输出。** 这种方式没有注入启动 manifest，也没有 HTTP API 载体，因此应用无法初始化。

**要求用户单独启动 `dsh web`。** 这会拆分生命周期所有权、把端口选择暴露给用户，并使桌面包依赖外部 Node 安装。

**把 CLI 编译成 Node 单文件可执行程序。** Profile launcher 会维护供用户安装插件使用的磁盘 package fallback，而 SEA 虚拟文件系统不能提供普通的磁盘 package 目标。捆绑 Node 可执行文件和真实的已部署 package 目录，可在三个桌面平台上保留标准模块解析和 profile 行为。

**默认在 Windows 上构建 MSI。** WiX 依赖 Windows 的可选 VBSCRIPT 功能，而且 MSI 版本不能直接表示共享的 `rc.N` SemVer 预发布版本。NSIS 无需增加这两项宿主或版本同步要求，即可生成标准 Windows 安装程序。

## 后果

桌面应用与 `dsh web` 使用相同的后端、profile、持久化和浏览器前端，且平台安装包自包含。代价是安装包会因包含 Node 和生产 JavaScript 依赖目录而增大。发布任务必须在各目标操作系统上原生构建，并在仓库之外提供平台签名或公证凭据；默认 Windows 产物是 NSIS 安装程序而不是 MSI package。

Rust 生命周期测试固定就绪解析、fragment 标记，以及从包含空格的安装目录启动时使用的相对生产入口；`desktop:prepare` 则在物化生产闭包后验证已发布 CLI 入口。无密钥组装 Web 快照经过真实启动 token 重定向，并覆盖 macOS 和 Windows 标题栏、品牌状态及其共享侧边栏开关。现有 Web 和 CLI 测试套件仍是行为权威，因为桌面宿主不会分叉任何一个实现。
