---
name: deepseek-harness-desktop
description: Use when re-applying or maintaining the Tauri desktop client in deepseek-harness — the apps/desktop Tauri 2 host that wraps dsh web, the Rust host owning the dsh web --no-open --port 0 backend, the platform titlebars (macOS overlay / Windows-Linux frameless), the prepare-desktop staging closure, and the desktop:dev / desktop:prepare / desktop:build workflows — especially after a source version upgrade that removed the local desktop modifications.
---

# DeepSeek Harness Desktop Client (Tauri)

## When to use

Apply this skill whenever the desktop client work must be reproduced, extended, or repaired:

- After a source-code version upgrade of this repository that dropped the local desktop commits, to re-apply the full desktop-client modification.
- To modify or troubleshoot `apps/desktop`, the Tauri titlebar, or the `desktop:*` scripts.

The desktop work exists as four **local, unmerged commits** on top of the released tree. Upstream releases do not carry them, so every upgrade reintroduces this work. Treat this skill as the durable record of what those commits do and how to redo it.

## What the desktop client is

`apps/desktop` is a Tauri 2 application with **no compile-time window** and no separately installed Node requirement. The Rust host:

1. Spawns the real built backend as `dsh web --no-open --port 0` on an operating-system-assigned loopback port so the backend does not open the system browser.
2. Consumes the backend's readiness line (`dsh web: http://127.0.0.1:<port>`), validates it is an explicit HTTP loopback URL, and only then creates the WebView against that URL.
3. Owns the child process through application exit: teardown kills a live child and waits for it.
4. Stores `dsh-platform=tauri` and `dsh-os=<macos|windows|linux>` in the WebView URL fragment. The fragment survives the launch-token redirect without reaching the backend. The shared web layout renders the 48px platform titlebar **only** for those markers; plain browser launches keep the ordinary sidebar control and no window chrome.
5. Ships a self-contained installer: the target platform's Node executable plus a symlink-free production dependency closure, staged by `scripts/prepare-desktop.ts`.
6. Owns a native tray icon: closing the main window hides it, `显示窗口` restores it, and `退出程序` kills and waits for the backend before exiting.

Security posture: the WebView receives only window-control permissions (close, minimize, toggle-maximize, start-dragging), scoped to the owned `http://127.0.0.1:*` origin — no filesystem, shell, process, or application commands.

## The four source commits

All four are sequential; re-apply in this order. The net effect of the last two (3 + 4) is the current Windows titlebar: brand in the titlebar, no title text.

| Order | Commit | Subject | Net effect |
| --- | --- | --- | --- |
| 1 | `48baebd56a` | Add Tauri desktop host wrapping dsh web | Creates `apps/desktop` (Tauri 2 app, Rust host, config, icons), `scripts/prepare-desktop.ts`, root `desktop:*` scripts, workspace-constraint/runtime-closure updates, the shared 48px titlebar (macOS overlay, Windows/Linux frameless), `Cmd/Ctrl+B` sidebar fold, keyless e2e snapshots, bilingual Agent Note + README records, third-party notices. |
| 2 | `597e41f4e9` | fix(desktop): NSIS installer, short backend staging path, startup error dialog | Stages the prod closure in the short root `.dsh-desktop/` path (Windows installer path limit), restores pnpm workspace state after deploy, starts the backend from the bundled directory with a **relative** CLI entry (install paths may contain spaces), uses the GUI subsystem on Windows (`windows_subsystem`), shows a native error dialog with `desktop-startup.log` on startup failure, makes `install-lefthook.mjs` import `lefthook/package.json` lazily. |
| 3 | `abf75ddfce` | remove windows title | Drops the centered "DeepSeek Harness" title text and its CSS from the Windows titlebar. |
| 4 | `64758830b7` | custom windows titlebar | Windows moves the sidebar's banner into the titlebar: `BrandWordmark` left of the fold control when the sidebar is expanded; when collapsed the fold control rests on the whale mark (`FishLogo`) and hovering swaps in the panel icon; the sidebar's own logo row hides in both states. |

Recover the exact diffs at any time:

```sh
git log --oneline -8        # confirm the four subjects are present
git show 48baebd56a         # then 597e41f4e9, abf75ddfce, 64758830b7
```

If the commits still exist and the upgraded tree has not drifted in the touched files, cherry-pick them in order. Otherwise — or on conflicts — hand-apply the recipe below, which is the complete, self-contained description of the modification.

## Step 0 — inventory the current checkout

Before changing anything, decide what the upgrade already contains:

- Does `apps/desktop/` exist? Does `scripts/prepare-desktop.ts` exist? Do the root `desktop:*` scripts exist?
- Does `packages/client/ui-layout/src/client/DesktopTitlebar.tsx` exist? Does `AppFrame.tsx` parse `dsh-platform`?
- Do the e2e snapshots under `apps/web/tests/snapshots/desktop-titlebar/` exist?

Apply only the missing pieces; do not duplicate what survived. Every path below is exact.

## Recipe — file by file

### 1. `apps/desktop` skeleton

- `apps/desktop/package.json` — name `@deepseek-ai/dsh-desktop`, `"type": "module"`, version equal to the current `dsh` release, `files` allowlist (`frontend`, `src-tauri/capabilities`, `src-tauri/icons`, `src-tauri/src`, `src-tauri/Cargo.lock`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`), scripts `dev`/`build` (`tauri dev` / `tauri build`), devDependency `@tauri-apps/cli`. The `dependencies` block must declare the **entire workspace runtime closure** (mirroring what the web app needs, `@deepseek-ai/dsh` plus every `dsh-*` service and client package) — this is the closure `pnpm deploy` stages into the installer. See `../../../apps/desktop/package.json`.
- `apps/desktop/frontend/index.html` — minimal HTML stub; the real UI is the external backend URL, so there is no Vite build.
- `apps/desktop/src-tauri/Cargo.toml` — package `deepseek-harness-desktop`, version synced to the `dsh` release, edition 2021, `rust-version = "1.77.2"`, lib name `deepseek_harness_desktop_lib` with `crate-type = ["staticlib", "cdylib", "rlib"]`, build-dependency `tauri-build = "2"`, dependencies `tauri = { version = "2", features = ["tray-icon"] }` and `tauri-plugin-dialog = "2"`.
- `apps/desktop/src-tauri/build.rs` — `fn main() { tauri_build::build() }`.
- `apps/desktop/src-tauri/tauri.conf.json` — `productName: "DeepSeek Harness"`, `version` synced to the `dsh` release, `identifier: "com.deepseek.harness"`, `build.frontendDist: "../frontend"`, `app.windows: []` (windows are created in Rust), `app.security.csp: null`, `bundle.targets: "all"`, `bundle.resources: ["resources"]`, icon list covering 32/128/@2x PNG, ICNS, ICO. The build-time config override (see §3) remaps the staged closure into `resources/backend/`.
- `apps/desktop/src-tauri/capabilities/desktop.json` — window `"main"`, `remote.urls: ["http://127.0.0.1:*"]`, permissions `core:default` + `core:window:allow-close` + `allow-minimize` + `allow-start-dragging` + `allow-toggle-maximize`. Do not widen these.
- `apps/desktop/src-tauri/icons/*` — generated from `../../../apps/web/public/favicon.svg` via the Tauri CLI `icon` command (the official DeepSeek mark the web app already owns). Reuse the committed icons; regenerate only if missing.
- `apps/desktop/src-tauri/resources/.gitkeep` — the staging override replaces the resources content at build time.
- `apps/desktop/src-tauri/Cargo.lock` — produced by `cargo build`.
- `apps/desktop/.gitignore` — Tauri build output (`src-tauri/target/` etc.).

### 2. Rust host (`apps/desktop/src-tauri/src/main.rs` + `src/lib.rs`)

`main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    deepseek_harness_desktop_lib::run()
}
```

`lib.rs` responsibilities (see `../../../apps/desktop/src-tauri/src/lib.rs` for the reference implementation):

- Constants: `READY_PREFIX = "dsh web: "`, `STARTUP_TIMEOUT = 60s`.
- `backend_command()` resolution order: (a) `DSH_DESKTOP_BACKEND` env override → run it from the current working directory with no prefix args; (b) debug builds → `node` (or `DSH_DESKTOP_NODE`) running `apps/cli/lib/bin.js` from the repository root; (c) release → `resources/backend/node(.exe)` with **working directory = `resources/backend`** and the **relative** entry `node_modules/@deepseek-ai/dsh/lib/bin.js` (relative so Windows install paths containing spaces work).
- `spawn_backend()`: always pass `--no-open`; `stdin` null, stdout/stderr piped; `CREATE_NO_WINDOW` (`0x0800_0000`) on Windows; continuously drain both streams into `desktop-startup.log` in the app log directory (fall back to a temp file); parse the readiness line from stdout; on timeout / early exit / closed output, kill the child and fail with a **native error dialog** (tauri-plugin-dialog, `blocking_show`) that shows the failure and the log path.
- `mark_desktop_url()`: store `dsh-platform=tauri` and `dsh-os` (`macos` | `windows` | `linux` from compile target) in the URL fragment via `set_fragment`; browser authentication redirects the token-bearing request to `/` while retaining that client-only fragment.
- Window: title "DeepSeek Harness", `shadow(true)`, `inner_size(1280, 820)`, `min_inner_size(900, 620)`. macOS: `decorations(true)` + `TitleBarStyle::Overlay` + `hidden_title(true)` + `traffic_light_position(12, 26)`. Windows/Linux: `decorations(false)`.
- Tray: build it from the default bundled application icon with native menu items `显示窗口` and `退出程序`; a main-window close request prevents destruction and hides the window; show restores, unminimizes, and focuses it; quit synchronously kills and waits for the `ManagedChild` before calling `app.exit(0)`.
- Lifecycle: `ManagedChild = Arc<Mutex<Option<Child>>>`; tray quit and `RunEvent::Exit | ExitRequested` kill a live child and wait. The second cleanup is an idempotent no-op because the first takes the child from the option.
- Keep the unit tests: release backend command uses a relative entry from an install directory containing spaces; readiness parsing accepts the loopback line and rejects non-loopback URLs; the marker URL is exact.

### 3. Staging script and repository wiring

- `scripts/prepare-desktop.ts` (new; see `../../../scripts/prepare-desktop.ts`): stages the symlink-free prod closure into the short root path `.dsh-desktop/` by invoking pnpm through `npm_execpath` (`pnpm --filter @deepseek-ai/dsh-desktop deploy --legacy --prod --ignore-scripts --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true <output>`), saves and restores `node_modules/.pnpm-workspace-state-v1.json` around the deploy, removes the staged `frontend`/`src-tauri`, restores direct dependencies from `apps/desktop/node_modules`, materializes symlinks (dereference-copy, prune `.bin`), copies the current `process.execPath` as `node(.exe)` (chmod 755 off Windows), verifies the built CLI entry exists at `node_modules/@deepseek-ai/dsh/lib/bin.js`, and with `--build` invokes the Tauri CLI through Node with a `--config` bundle-resources override mapping `.dsh-desktop/` → `resources/backend/` and `--bundles nsis` on win32.
- Root `package.json` scripts:

  ```jsonc
  "desktop:dev": "pnpm run build && pnpm --filter @deepseek-ai/dsh-desktop run dev",
  "desktop:prepare": "tsx scripts/prepare-desktop.ts",
  "desktop:build": "pnpm run build && pnpm run verify-desktop-runtime-closure && tsx scripts/prepare-desktop.ts --build",
  "verify-desktop-runtime-closure": "tsx scripts/verify-runtime-closure.ts --manifest apps/desktop/package.json"
  ```

- `scripts/check-workspace-constraints.ts` — add `'@deepseek-ai/dsh-desktop': ['frontend', 'src-tauri']` to `appPackageFiles`; the app-package rule then requires `files` to be exactly `["frontend", "src-tauri"]` in the desktop manifest.
- `scripts/verify-runtime-closure.ts` — the root `verify-desktop-runtime-closure` script runs it with `--manifest apps/desktop/package.json`; the current implementation already supports `--manifest` and globs every workspace package.
- `.gitignore` — add `.dsh-desktop/`.
- `tsconfig.host.json` and `apps/web/tsconfig.json` — add `apps/web/tests/desktop-titlebar.e2e.ts` to the file lists.
- `scripts/install-lefthook.mjs` — import `lefthook/package.json` lazily (`await import('lefthook/package.json', { with: { type: 'json' } })`, tolerate `ERR_MODULE_NOT_FOUND`) so the postinstall survives environments without the wrapper package.
- `pnpm-lock.yaml` (regenerated by `pnpm install`) and `THIRD_PARTY_NOTICES.md` (add `@tauri-apps/api` under runtime packages and `@tauri-apps/cli` under tooling, both "Apache-2.0 OR MIT").

### 4. Shared client UI

- `packages/client/ui-layout/package.json` — add dependency `@tauri-apps/api` (ordinary third-party library, bundled privately into `lib/client.js`); `@deepseek-ai/dsh-client-ui-primitives` is a platform baseline module and a static client input, so declare it only in devDependencies (it supplies `BrandWordmark`, `FishLogo`, `IconCloseOutline16`, `IconPanelLeftOutline16`, `Tooltip`).
- `packages/client/ui-layout/src/client/AppFrame.tsx` — `desktopPlatform()` reads `dsh-platform` (must equal `tauri`) and `dsh-os` (`linux` | `macos` | `windows`; throw on any other value) from `window.location.hash`. When a platform is present: bind `Cmd+B` (macOS, `metaKey`) / `Ctrl+B` (elsewhere, `ctrlKey`) to `actions.toggleSidebar()` (ignore when alt/shift or a non-`b` key), render `<DesktopTitlebar>` above the frame inside a `.desktopShell` wrapper, and set `data-platform={desktopOs}` on the sidebar column (drives sidebar CSS).
- `packages/client/ui-layout/src/client/DesktopTitlebar.tsx` (new) — 48px `<header>` with `role="toolbar"`, `aria-label` bilingual ("Window controls" / "窗口控制"), `data-tauri-drag-region`, and `gridTemplateColumns: sidebarWidth px + minmax(0,1fr)`. Left cell: the sidebar fold button (bilingual aria-label "Collapse/Open sidebar", tooltip shows `⌘B`/`Ctrl+B`); on macOS and Windows, `BrandWordmark` appears before the button when expanded and `FishLogo` (size 24) rests inside the button when collapsed, swapping to `IconPanelLeftOutline16` on hover. Right cell (`platform !== 'macos'`): minimize, maximize/restore, close buttons calling `@tauri-apps/api/window` `getCurrentWindow()`; close uses `IconCloseOutline16`. Double-click on the drag region (not on a button) toggles maximize. macOS: no HTML window buttons (native traffic lights); observe fullscreen through `desktopWindow.isFullscreen()` + `onResized`, guarded by `'__TAURI_INTERNALS__' in window`, and expose it via `data-fullscreen` so the brand and toggle release the traffic-light inset while fullscreen.
- `packages/client/ui-layout/src/client/AppFrame.module.css` — `.desktopShell` (titlebar above frame), `.titlebar` (48px, borderless sidebar fill, drag region), `.titlebarSidebar`, `.titlebarMain`, `.windowControls` (absolutely positioned right), `.windowControl`, minimize/maximize icon spans, `.titlebarWordmark` (brand ink, part of the drag region), and the macOS/Windows collapsed rules that hide `.titlebarPanelIcon` until hover, when it swaps in and `.titlebarFish` hides. The conversation region exposes the sidebar fill through a 15px top-left corner.
- `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` — `[data-desktop-titlebar] .logoRow { display: none; }` because the titlebar owns the desktop brand and fold control.

### 5. E2E snapshots and documentation

- `apps/web/tests/desktop-titlebar.e2e.ts` + `apps/web/tests/snapshots/desktop-titlebar/macos-titlebar.expected.md` + `windows-titlebar.expected.md` — keyless assembled coverage: enter through the real token URL with `#dsh-platform=tauri&dsh-os=macos`, assert that the redirect clears the token query while retaining the fragment, then cover the toolbar (drag region, data-platform, no HTML minimize button on macOS), geometry (titlebar top 0 / height 48, frame top 48, brand/toggle placement, 15px center radius), fullscreen inset release, and the macOS/Windows wordmark/whale states. The browser path without markers renders no titlebar. `captureStableAria` output must match the committed `*.expected.md` snapshots.
- `apps/desktop/README.md` + `README.zh.md` + `README.i18n.yaml` — development, distribution (NSIS `x64-setup.exe` on Windows; MSI not default: WiX needs the optional VBSCRIPT feature and a numeric version MSI cannot express for `rc.N` prereleases), icon provenance, startup diagnostics (`desktop-startup.log`).
- Agent Note triplet `.agents/notes/implemented/architecture/2026-08-14-tauri-desktop-host.{md,zh.md,i18n.yaml}` — the decision record; keep it current with what shipped.

## Adapting to a new source version

When the four commits no longer apply cleanly after an upgrade:

- **Version sync**: the `dsh` release version must match across `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/src-tauri/tauri.conf.json`.
- **Lockfiles**: `cargo build` regenerates `Cargo.lock`; `pnpm install` regenerates `pnpm-lock.yaml` and may bump `@tauri-apps/api` / `@tauri-apps/cli` / `tauri` / `tauri-plugin-dialog` — verify the capability schema and `getCurrentWindow` API still match.
- **Closure drift**: if the new version adds runtime packages to the web app's closure, mirror them into `apps/desktop/package.json` dependencies; `pnpm run verify-desktop-runtime-closure` reports missing workspace peers.
- **Client drift**: re-apply the marker logic (`desktopPlatform`, keydown handler, `data-platform`) onto the upgraded `AppFrame.tsx`; the e2e geometry assertions (48px titlebar, toggle insets, 15px corner) must match the CSS you write.
- **Preserve the net Windows behavior** from commits 3 + 4: no title text; wordmark when expanded, whale mark + hover-swap when collapsed; sidebar logo row hidden.

## Verification

Run in this order; each gate must pass before the next:

```sh
pnpm install                                   # pulls @tauri-apps/cli + @tauri-apps/api
pnpm run build                                 # desktop host runs the real built backend
cd apps/desktop/src-tauri && cargo test        # Rust lifecycle unit tests
pnpm run test:gui                              # client suites (AppFrame/DesktopTitlebar/sidebar)
DSH_SNAPSHOT=replay pnpm run test:web          # keyless e2e incl. titlebar snapshots
pnpm run desktop:prepare                       # stages .dsh-desktop, verifies CLI entry
pnpm run desktop:build                         # per target OS; Windows -> NSIS x64-setup.exe
```

`desktop:build` must run **on each target operating system** so Node and native dependencies match the installer. Manual smoke per platform: titlebar renders 48px with the platform controls; `Cmd/Ctrl+B` toggles the sidebar; macOS fullscreen releases the traffic-light inset; Windows shows wordmark/whale; closing the main window hides it; the tray restores it; tray quit terminates both the backend and desktop process.

## Red lines

- Browser launches (no `dsh-platform` marker) keep the ordinary sidebar control and must never render desktop chrome.
- Never widen Tauri permissions beyond the four window controls on the loopback origin; the backend continues to own Host-header trust, API routing, persistence, credentials, and sandbox policy.
- Keep the NSIS default on Windows; do not switch to MSI without updating the README and the Agent Note (WiX VBSCRIPT + SemVer version constraints).
- The host runs the real `dsh web --no-open --port 0` backend — never a mock; installers must stay self-contained (bundled Node, no user Node/pnpm).
- Tray quit must synchronously kill and wait for the owned backend before the desktop process exits; window close only hides the reusable main WebView.
- Do not commit credentials or signing secrets; signing/notarization stays in CI or external configuration.
