//! Tauri host that owns the local `dsh web` process and its WebView window.

use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{mpsc, mpsc::RecvTimeoutError, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const READY_PREFIX: &str = "dsh web: ";
const READY_LAN_PREFIX: &str = "(LAN: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const TRAY_SHOW_WINDOW_ID: &str = "tray-show-window";
const TRAY_OPEN_WEB_ID: &str = "tray-open-web";
const TRAY_COPY_ADDRESS_ID: &str = "tray-copy-address";
const TRAY_QUIT_ID: &str = "tray-quit";

type ManagedChild = Arc<Mutex<Option<Child>>>;
type SharedLog = Arc<Mutex<File>>;

struct BackendCommand {
    executable: PathBuf,
    working_directory: PathBuf,
    prefix_args: Vec<PathBuf>,
}

fn backend_command(app: &tauri::AppHandle) -> Result<BackendCommand, String> {
    if let Some(command) = std::env::var_os("DSH_DESKTOP_BACKEND") {
        return Ok(BackendCommand {
            executable: PathBuf::from(command),
            working_directory: std::env::current_dir()
                .map_err(|error| format!("cannot locate the working directory: {error}"))?,
            prefix_args: Vec::new(),
        });
    }

    if cfg!(debug_assertions) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        return Ok(BackendCommand {
            executable: std::env::var_os("DSH_DESKTOP_NODE")
                .map_or_else(|| PathBuf::from("node"), PathBuf::from),
            working_directory: root.clone(),
            prefix_args: vec![root.join("apps/cli/lib/bin.js")],
        });
    }

    let backend = app
        .path()
        .resource_dir()
        .map_err(|error| format!("cannot locate bundled resources: {error}"))?
        .join("resources/backend");
    Ok(release_backend_command(backend))
}

fn release_backend_command(backend: PathBuf) -> BackendCommand {
    BackendCommand {
        executable: backend.join(if cfg!(windows) { "node.exe" } else { "node" }),
        working_directory: backend,
        prefix_args: vec![PathBuf::from("node_modules/@deepseek-ai/dsh/lib/bin.js")],
    }
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn log_line(log: &SharedLog, line: &str) {
    if let Ok(mut file) = log.lock() {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

fn startup_log(app: &tauri::AppHandle) -> Option<(SharedLog, PathBuf)> {
    let directory = app.path().app_log_dir().ok()?;
    if fs::create_dir_all(&directory).is_err() {
        return None;
    }
    let path = directory.join("desktop-startup.log");
    match File::create(&path) {
        Ok(file) => Some((Arc::new(Mutex::new(file)), path)),
        Err(_) => None,
    }
}

fn drain<R: Read + Send + 'static>(reader: R, label: &'static str, log: SharedLog) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) => {
                    let message = format!("dsh desktop {label}: {line}");
                    eprintln!("{message}");
                    log_line(&log, &message);
                }
                Err(error) => {
                    let message = format!("dsh desktop: failed to read backend {label}: {error}");
                    eprintln!("{message}");
                    log_line(&log, &message);
                    break;
                }
            }
        }
    });
}

fn parse_ready_url(line: &str) -> Option<Result<Url, String>> {
    let raw = line
        .strip_prefix(READY_PREFIX)?
        .split_whitespace()
        .next()
        .unwrap_or_default();
    let url = match Url::parse(raw) {
        Ok(url) => url,
        Err(error) => {
            return Some(Err(format!(
                "backend printed an invalid readiness URL: {error}"
            )))
        }
    };
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none() {
        return Some(Err(format!(
            "backend readiness URL is not an explicit HTTP loopback port: {url}"
        )));
    }
    Some(Ok(url))
}

/// Extract the optional LAN URL from a readiness line: `(LAN: http://... )`.
fn parse_ready_lan_url(line: &str) -> Option<Result<Url, String>> {
    let rest = line.strip_prefix(READY_PREFIX)?;
    let start = rest.find(READY_LAN_PREFIX)?;
    let mut raw = rest[start + READY_LAN_PREFIX.len()..]
        .split_whitespace()
        .next()
        .unwrap_or_default();
    if let Some(stripped) = raw.strip_suffix(')') {
        raw = stripped;
    }
    let url = match Url::parse(raw) {
        Ok(url) => url,
        Err(error) => {
            return Some(Err(format!(
                "backend printed an invalid LAN readiness URL: {error}"
            )))
        }
    };
    if url.scheme() != "http" || url.port().is_none() {
        return Some(Err(format!(
            "backend LAN readiness URL is not an explicit HTTP port: {url}"
        )));
    }
    Some(Ok(url))
}

fn mark_desktop_url(mut url: Url) -> Url {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    url.set_fragment(Some(&format!("dsh-platform=tauri&dsh-os={os}")));
    url
}

fn spawn_backend(
    app: &tauri::AppHandle,
    log: SharedLog,
) -> Result<(Child, Url, Option<Url>), String> {
    let backend = backend_command(app)?;
    log_line(
        &log,
        &format!(
            "dsh desktop: starting {} from {}",
            backend.executable.display(),
            backend.working_directory.display()
        ),
    );
    let mut command = Command::new(&backend.executable);
    command
        .current_dir(&backend.working_directory)
        .args(&backend.prefix_args)
        .args(["web", "--no-open", "--host", "0.0.0.0", "--port", "0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start {}: {error}", backend.executable.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("backend stdout was not captured")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("backend stderr was not captured")?;
    drain(stderr, "stderr", Arc::clone(&log));

    let (sender, receiver) = mpsc::sync_channel(1);
    let stdout_log = Arc::clone(&log);
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    let message = format!("dsh desktop stdout: {line}");
                    eprintln!("{message}");
                    log_line(&stdout_log, &message);
                    if let Some(url) = parse_ready_url(&line) {
                        let lan_url = parse_ready_lan_url(&line).transpose();
                        let _ = sender.send(url.map(|url| (url, lan_url)));
                    }
                }
                Err(error) => {
                    let message = format!("dsh desktop: failed to read backend stdout: {error}");
                    eprintln!("{message}");
                    log_line(&stdout_log, &message);
                    break;
                }
            }
        }
    });

    let (url, lan_url) = match receiver.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Err(RecvTimeoutError::Timeout) => {
            let status = child.try_wait().ok().flatten();
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "backend did not become ready within 60 seconds (status: {status:?})"
            ));
        }
        Err(RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            let status = child.wait().ok();
            return Err(format!(
                "backend output closed before the readiness line (status: {status:?})"
            ));
        }
    };
    let lan_url = match lan_url {
        Ok(Some(url)) => Some(url),
        Ok(None) => None,
        Err(error) => {
            log_line(&log, &format!("dsh desktop: {error}"));
            None
        }
    };
    Ok((child, url, lan_url))
}

fn stop_backend(child: &ManagedChild) -> Option<ExitStatus> {
    let mut child = child.lock().expect("backend mutex poisoned").take()?;
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    child.wait().ok()
}

fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window("main")
        .ok_or(tauri::Error::WindowNotFound)?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()
}

fn tray_web_label(url: &Url) -> String {
    format!("Web端口:{}", url.port().expect("readiness URL port"))
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("cannot open the system clipboard: {error}"))?;
    clipboard
        .set_text(text.to_owned())
        .map_err(|error| format!("cannot write the system clipboard: {error}"))
}

fn install_tray(
    app: &tauri::App,
    backend: ManagedChild,
    web_url: Url,
    lan_url: Option<Url>,
) -> tauri::Result<()> {
    let show_window = MenuItem::with_id(app, TRAY_SHOW_WINDOW_ID, "显示窗口", true, None::<&str>)?;
    let open_web = MenuItem::with_id(
        app,
        TRAY_OPEN_WEB_ID,
        tray_web_label(&web_url),
        true,
        None::<&str>,
    )?;
    let copy_address = MenuItem::with_id(
        app,
        TRAY_COPY_ADDRESS_ID,
        "复制访问地址",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_window, &open_web, &copy_address, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".to_owned()))?;
    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("DeepSeek Harness")
        .menu(&menu)
        .show_menu_on_left_click(true);
    #[cfg(target_os = "macos")]
    let tray = tray.icon_as_template(true);
    tray.on_menu_event(move |app, event| {
        if event.id() == TRAY_SHOW_WINDOW_ID {
            if let Err(error) = show_main_window(app) {
                eprintln!("dsh desktop: cannot show the main window: {error}");
            }
        } else if event.id() == TRAY_OPEN_WEB_ID {
            if let Err(error) = open::that(web_url.as_str()) {
                eprintln!("dsh desktop: cannot open DSH Web in the default browser: {error}");
            }
        } else if event.id() == TRAY_COPY_ADDRESS_ID {
            // Prefer the LAN URL, which another device on the network can open;
            // fall back to the loopback URL for a local browser.
            let address = lan_url.as_ref().unwrap_or(&web_url).as_str();
            if let Err(error) = copy_to_clipboard(address) {
                eprintln!("dsh desktop: cannot copy the DSH Web address: {error}");
            }
        } else if event.id() == TRAY_QUIT_ID {
            let _ = stop_backend(&backend);
            app.exit(0);
        }
    })
    .build(app)?;
    Ok(())
}

/// Start the desktop host and keep the backend alive until the application exits.
pub fn run() {
    let backend: ManagedChild = Arc::new(Mutex::new(None));
    let setup_backend = Arc::clone(&backend);
    let exit_backend = Arc::clone(&backend);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("dsh desktop: cannot hide the main window: {error}");
                }
            }
        })
        .setup(move |app| {
            let (log, log_path) = startup_log(app.handle()).unwrap_or_else(|| {
                let path = PathBuf::from("desktop-startup.log unavailable");
                let file = tempfile_log();
                (file, path)
            });
            let (child, url, lan_url) = match spawn_backend(app.handle(), Arc::clone(&log)) {
                Ok(result) => result,
                Err(error) => {
                    log_line(&log, &format!("dsh desktop startup failed: {error}"));
                    app.dialog()
                        .message(format!(
                            "DeepSeek Harness could not start.\n\n{error}\n\nLog: {}",
                            log_path.display()
                        ))
                        .title("DeepSeek Harness startup failed")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(std::io::Error::other(error).into());
                }
            };
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(mark_desktop_url(url.clone())),
            )
            .title("DeepSeek Harness")
            .shadow(true)
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 620.0);
            #[cfg(target_os = "macos")]
            let window = window
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(12.0, 26.0));
            #[cfg(not(target_os = "macos"))]
            let window = window.decorations(false);
            let window = window.build();
            if let Err(error) = window {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
            *setup_backend.lock().expect("backend mutex poisoned") = Some(child);
            if let Err(error) = install_tray(app, Arc::clone(&setup_backend), url, lan_url) {
                let _ = stop_backend(&setup_backend);
                return Err(error.into());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Harness desktop application")
        .run(move |_app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let _ = stop_backend(&exit_backend);
            }
        });
}

fn tempfile_log() -> SharedLog {
    let path = std::env::temp_dir().join("deepseek-harness-desktop-startup.log");
    let file = File::create(path)
        .unwrap_or_else(|error| panic!("cannot create a desktop startup log: {error}"));
    Arc::new(Mutex::new(file))
}

#[cfg(test)]
mod tests {
    use super::{
        mark_desktop_url, parse_ready_lan_url, parse_ready_url, release_backend_command,
        stop_backend, tray_web_label,
    };
    use std::{
        path::{Path, PathBuf},
        process::{Command, Stdio},
        sync::{Arc, Mutex},
        thread,
        time::Duration,
    };

    #[test]
    fn release_backend_uses_a_relative_entry_from_its_install_directory() {
        let directory = PathBuf::from(r"D:\Program Files\DeepSeek Harness\resources\backend");
        let command = release_backend_command(directory.clone());
        assert_eq!(command.working_directory, directory);
        assert_eq!(
            command.prefix_args,
            [Path::new("node_modules/@deepseek-ai/dsh/lib/bin.js")]
        );
    }

    #[test]
    fn accepts_the_owned_loopback_readiness_line() {
        let url = parse_ready_url("dsh web: http://127.0.0.1:43123 (LAN: http://192.0.2.1:43123)")
            .expect("readiness line")
            .expect("valid URL");
        assert_eq!(url.as_str(), "http://127.0.0.1:43123/");
    }

    #[test]
    fn accepts_the_lan_readiness_url_when_present() {
        let line =
            "dsh web: http://127.0.0.1:43123/?token=abc (LAN: http://192.0.2.1:43123/?token=abc)";
        let lan = parse_ready_lan_url(line)
            .expect("readiness line")
            .expect("valid LAN URL");
        assert_eq!(lan.as_str(), "http://192.0.2.1:43123/?token=abc");
        assert!(parse_ready_lan_url("dsh web: http://127.0.0.1:43123/?token=abc").is_none());
    }

    #[test]
    fn ignores_other_output_and_rejects_non_loopback_urls() {
        assert!(parse_ready_url("loader: ready").is_none());
        assert!(parse_ready_url("dsh web: https://example.com/")
            .expect("readiness line")
            .is_err());
    }

    #[test]
    fn marks_the_owned_url_for_desktop_chrome() {
        let url = parse_ready_url("dsh web: http://127.0.0.1:43123")
            .expect("readiness line")
            .expect("valid URL");
        let os = if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(target_os = "windows") {
            "windows"
        } else {
            "linux"
        };
        assert_eq!(
            mark_desktop_url(url).as_str(),
            format!("http://127.0.0.1:43123/#dsh-platform=tauri&dsh-os={os}")
        );
    }

    #[test]
    fn labels_the_web_tray_item_with_the_backend_port() {
        let url = parse_ready_url("dsh web: http://127.0.0.1:43123")
            .expect("readiness line")
            .expect("valid URL");
        assert_eq!(tray_web_label(&url), "Web端口:43123");
    }

    #[test]
    fn stops_and_reaps_the_owned_backend() {
        let child = Command::new(std::env::current_exe().expect("test executable"))
            .args(["--exact", "tests::managed_child_fixture", "--ignored"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("managed child");
        let backend = Arc::new(Mutex::new(Some(child)));

        let status = stop_backend(&backend).expect("reaped child status");

        assert!(!status.success());
        assert!(backend.lock().expect("backend mutex").is_none());
    }

    #[test]
    #[ignore = "spawned only by stops_and_reaps_the_owned_backend"]
    fn managed_child_fixture() {
        thread::sleep(Duration::from_secs(60));
    }
}
