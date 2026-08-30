# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This package wraps the shipped `dsh web` application in Tauri. The Rust host starts the real Harness backend with `--no-open --host 0.0.0.0` on an operating-system-assigned port, so the Tauri WebView is the only application window and the same GUI is reachable from other devices on the network. It waits for the backend readiness line and creates the WebView only after the HTTP API and frontend are available. It carries the desktop platform markers in the URL fragment, which remains client-only and survives the launch-token redirect to `/`. Closing the application terminates and waits for the backend process.

The desktop WebView uses platform-specific Tauri chrome around a 48px application titlebar on macOS, Windows, and Linux. The titlebar shares the borderless sidebar fill, while the conversation region starts below it with a 15px top-left corner. Its sidebar toggle uses `Command+B` on macOS and `Control+B` on Windows and Linux. On macOS and Windows, the expanded titlebar shows the DeepSeek Harness wordmark beside the fold control; the collapsed control shows the DeepSeek whale and swaps it for the expand icon on hover. The macOS overlay preserves the native traffic lights and system-rounded window corners and places the titlebar brand and control after the traffic-light group. In macOS fullscreen, where the native traffic lights disappear, the control releases that inset and aligns with the expanded sidebar's left edge or the collapsed rail's icon column. Windows and Linux use a frameless window with minimize, maximize/restore, and close controls at the right edge. Tauri grants those actions only to the main window while it displays the owned `http://127.0.0.1:*` backend. The ordinary browser application keeps its existing sidebar control and does not render desktop window chrome.

The native system tray uses the application icon and provides `显示窗口`, `DSH Web（端口：xxx）`, `复制访问地址`, and `退出程序`. Closing the main window hides it while the backend remains available; `显示窗口` restores and focuses it. `DSH Web（端口：xxx）` opens the running web application in the default browser, with `xxx` replaced by the backend's actual port. `复制访问地址` copies the LAN URL with its authentication token to the clipboard, so another device on the network can open the same GUI. `退出程序` synchronously terminates and waits for the owned Node backend before exiting the Tauri process.

## Development

From the repository root, install dependencies and build the JavaScript artifacts before starting Tauri:

```sh
pnpm install
pnpm run desktop:dev
```

The development host runs `apps/cli/lib/bin.js`, so frontend and package changes require the same rebuilds as `dsh web`.

## Distribution

Build on each target operating system so native Node dependencies match the installer. The preparation step creates a symlink-free production dependency tree and copies the current Node executable into Tauri resources; users do not need Node or pnpm installed.

```sh
pnpm run desktop:build
```

Tauri writes the platform installers under `apps/desktop/src-tauri/target/release/bundle/`. Windows builds produce an NSIS `x64-setup.exe`; MSI is not a default target because WiX requires the optional Windows VBSCRIPT feature and a separate numeric installer version for SemVer prereleases. macOS signing/notarization and Windows code signing use the standard Tauri environment and CI configuration and are intentionally not supplied with repository credentials.

The application icon is generated from [`apps/web/public/favicon.svg`](../web/public/favicon.svg), the official DeepSeek mark already used by the Web application.

## Startup diagnostics

The installed host starts Node from the bundled backend directory with a relative CLI entry, so Windows installation paths may contain spaces. Windows release hosts use the GUI subsystem and start Node without a console window. If the backend cannot start, the application shows the failure and the location of `desktop-startup.log`; that file contains the captured backend stdout and stderr.
