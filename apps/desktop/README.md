# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This package wraps the shipped `dsh web` application in Tauri. The Rust host starts the real Harness backend on an operating-system-assigned loopback port, waits for its readiness line, and creates the WebView only after the HTTP API and frontend are available. Closing the application terminates and waits for the backend process.

The desktop WebView uses platform-specific Tauri chrome around a 48px application titlebar on macOS, Windows, and Linux. The titlebar shares the borderless sidebar fill, while the conversation region starts below it with a 15px top-left corner. Its sidebar toggle uses `Command+B` on macOS and `Control+B` on Windows and Linux. The macOS overlay preserves the native traffic lights and system-rounded window corners, vertically centers the controls, and places the sidebar toggle after the traffic-light group as in iNotes. In macOS fullscreen, where the native traffic lights disappear, the toggle releases that inset and aligns with the expanded sidebar's left edge or the collapsed rail's icon column. Windows and Linux use a frameless window with minimize, maximize/restore, and close controls at the right edge. Tauri grants those actions only to the main window while it displays the owned `http://127.0.0.1:*` backend. The ordinary browser application keeps its existing sidebar control and does not render desktop window chrome.

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
