//! Tauri host that owns the local `dsh web` process and its WebView window.

use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, mpsc::RecvTimeoutError, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const READY_PREFIX: &str = "dsh web: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

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

fn mark_desktop_url(mut url: Url) -> Url {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    url.query_pairs_mut()
        .append_pair("dsh-platform", "tauri")
        .append_pair("dsh-os", os);
    url
}

fn spawn_backend(app: &tauri::AppHandle, log: SharedLog) -> Result<(Child, Url), String> {
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
        .args(["web", "--port", "0"])
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
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    let message = format!("dsh desktop stdout: {line}");
                    eprintln!("{message}");
                    log_line(&log, &message);
                    if let Some(url) = parse_ready_url(&line) {
                        let _ = sender.send(url);
                    }
                }
                Err(error) => {
                    let message = format!("dsh desktop: failed to read backend stdout: {error}");
                    eprintln!("{message}");
                    log_line(&log, &message);
                    break;
                }
            }
        }
    });

    match receiver.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(url)) => Ok((child, mark_desktop_url(url))),
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error)
        }
        Err(RecvTimeoutError::Timeout) => {
            let status = child.try_wait().ok().flatten();
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "backend did not become ready within 60 seconds (status: {status:?})"
            ))
        }
        Err(RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            let status = child.wait().ok();
            Err(format!(
                "backend output closed before the readiness line (status: {status:?})"
            ))
        }
    }
}

fn stop_backend(child: &ManagedChild) {
    let Some(mut child) = child.lock().expect("backend mutex poisoned").take() else {
        return;
    };
    if child.try_wait().ok().flatten().is_none() {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Start the desktop host and keep the backend alive until the application exits.
pub fn run() {
    let backend: ManagedChild = Arc::new(Mutex::new(None));
    let setup_backend = Arc::clone(&backend);
    let exit_backend = Arc::clone(&backend);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            let (log, log_path) = startup_log(app.handle()).unwrap_or_else(|| {
                let path = PathBuf::from("desktop-startup.log unavailable");
                let file = tempfile_log();
                (file, path)
            });
            let (child, url) = match spawn_backend(app.handle(), Arc::clone(&log)) {
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
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
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
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build DeepSeek Harness desktop application")
        .run(move |_app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                stop_backend(&exit_backend);
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
    use super::{mark_desktop_url, parse_ready_url, release_backend_command};
    use std::path::{Path, PathBuf};

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
            format!("http://127.0.0.1:43123/?dsh-platform=tauri&dsh-os={os}")
        );
    }
}
