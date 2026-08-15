# Agent Note: Tauri desktop host

Status: implemented

English | [中文](2026-08-14-tauri-desktop-host.zh.md)

## Problem

The browser application requires the Host runtime to inject `window.__DSH_BOOT__` and carry its API. Loading `apps/web/dist/index.html` directly in a desktop WebView produces an unusable shell, while requiring a separately installed Node runtime would make the desktop installer incomplete.

## Decision

[`apps/desktop`](../../../../apps/desktop/README.md) is a Tauri 2 application with no compile-time window. Its Rust host starts the real built `dsh web --port 0` entry on loopback, consumes the existing `dsh web:` readiness line, and creates one external-URL WebView after the assembled application settles. The host owns the child process through application exit; teardown kills a live child and waits for it to finish.

The production installer carries the target platform's Node executable and a symlink-free `pnpm deploy --prod` closure rooted at `@deepseek-ai/dsh-desktop`. `scripts/prepare-desktop.ts` materializes that tree in the short root `.dsh-desktop` staging directory, restores pnpm's workspace-state file after legacy deploy, and maps the directory to `resources/backend` only while Tauri bundles it. The short source path keeps nested npm dependencies below the path limit of Windows installer tools without changing the installed resource path. The desktop package uses an explicit source-file allowlist so generated Tauri targets and staged resources cannot recurse into that closure.

Desktop builds run on each target operating system so Node and native npm dependencies match macOS, Windows, or Linux; installed clients require neither Node nor pnpm. Windows builds select the NSIS installer because it accepts the shared SemVer version and does not require the optional Windows VBSCRIPT feature used by WiX MSI builds. Other platforms retain Tauri's platform targets.

The desktop icon is generated from the official DeepSeek SVG already owned by the Web application. Tauri produces the native ICNS, ICO, and PNG representations from that single source.

The Rust host appends `dsh-platform=tauri` and the compile-target `dsh-os` to its owned WebView URL. The shared layout renders a 48px drag region only for those markers, then moves the existing sidebar-store toggle into its left edge and binds it to `Command+B` on macOS or `Control+B` elsewhere. The titlebar uses the borderless sidebar fill across its full width, and the conversation region exposes that fill through a 15px top-left corner. macOS uses Tauri's overlay titlebar with native decorations, hidden title text, native traffic lights at the iNotes inset, and system-rounded corners; the HTML control follows the traffic lights. The titlebar observes native fullscreen changes because macOS removes the traffic lights there: while fullscreen, the control releases the traffic-light inset and uses the expanded sidebar's 12px content inset or the collapsed rail's 10px icon inset. Windows and Linux use a frameless window with HTML minimize, maximize/restore, and close controls on the right. Browser launches without the markers keep the existing sidebar chrome and do not acquire the desktop shortcut.

## Security and lifecycle

The backend binds to `127.0.0.1` through the Web profile's existing default and receives an operating-system-assigned port. The WebView URL is accepted only from the readiness line produced by the owned child. Standard Web composition continues to own Host-header trust, API routing, persistence, credentials, and sandbox policy. The `main` WebView receives only Tauri's close, minimize, toggle-maximize, and start-dragging window permissions, scoped to the owned `http://127.0.0.1:*` origin; it receives no filesystem, shell, process, or application command permission.

The child receives the desktop process environment because model-provider credentials and Harness configuration use that established channel. Production launches set the bundled backend as the working directory and pass a relative CLI entry, so Windows does not have to preserve an absolute script argument containing spaces. Windows release hosts select the GUI subsystem, while backend children use the no-console creation flag. Backend stdout and stderr are continuously drained into the application log directory's `desktop-startup.log`. A missing runtime, early backend exit, malformed readiness URL, or 60-second startup timeout shows a native error dialog with that log path and fails application setup instead of opening an unconnected window.

## Alternatives considered

**Load the Vite output through `file://`.** This loses the injected boot manifest and HTTP API carrier, so the application cannot initialize.

**Require users to start `dsh web` separately.** This splits lifecycle ownership, exposes port selection to the user, and makes the desktop package depend on an external Node installation.

**Compile the CLI into a Node single executable.** The profile launcher maintains an on-disk package fallback for user-installed plugins, while a SEA virtual filesystem does not provide ordinary on-disk package targets. A bundled Node executable plus a real deployed package tree preserves standard module resolution and profile behavior on all three desktop platforms.

**Build MSI by default on Windows.** WiX requires the optional Windows VBSCRIPT feature, and MSI versions cannot directly represent the shared `rc.N` SemVer prerelease. NSIS produces a standard Windows setup executable without adding either host or version synchronization requirements.

## Consequences

The desktop application uses the same backend, profiles, persistence, and browser frontend as `dsh web`, and platform installers are self-contained. The cost is a larger installer containing Node and the production JavaScript dependency tree. Release jobs must build natively per operating system and apply platform signing or notarization credentials outside the repository; the default Windows artifact is an NSIS setup executable rather than an MSI package.

The Rust lifecycle tests pin readiness parsing and the relative production entry used from installation directories containing spaces, while `desktop:prepare` verifies the published CLI entry after materializing the production closure. Keyless assembled Web snapshots cover the macOS and Windows titlebars and their shared sidebar toggle. Existing Web and CLI suites remain the behavior authority because the desktop host deliberately does not fork either implementation.
