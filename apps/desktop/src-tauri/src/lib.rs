//! Tauri host that owns the local `dsh web` process and its WebView window.

use std::{
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

const READY_PREFIX: &str = "dsh web: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);

type ManagedChild = Arc<Mutex<Option<Child>>>;

fn backend_command(app: &tauri::AppHandle) -> Result<(PathBuf, Vec<PathBuf>), String> {
    if let Some(command) = std::env::var_os("DSH_DESKTOP_BACKEND") {
        return Ok((PathBuf::from(command), Vec::new()));
    }

    if cfg!(debug_assertions) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        return Ok((
            std::env::var_os("DSH_DESKTOP_NODE")
                .map_or_else(|| PathBuf::from("node"), PathBuf::from),
            vec![root.join("apps/cli/lib/bin.js")],
        ));
    }

    let backend = app
        .path()
        .resource_dir()
        .map_err(|error| format!("cannot locate bundled resources: {error}"))?
        .join("resources/backend");
    let node = backend.join(if cfg!(windows) { "node.exe" } else { "node" });
    let entry = backend.join("node_modules/@deepseek-ai/dsh/lib/bin.js");
    Ok((node, vec![entry]))
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

fn drain<R: Read + Send + 'static>(reader: R, label: &'static str) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) => eprintln!("dsh desktop {label}: {line}"),
                Err(error) => {
                    eprintln!("dsh desktop: failed to read backend {label}: {error}");
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

fn spawn_backend(app: &tauri::AppHandle) -> Result<(Child, Url), String> {
    let (executable, prefix_args) = backend_command(app)?;
    let mut command = Command::new(&executable);
    command
        .args(prefix_args)
        .args(["web", "--port", "0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start {}: {error}", executable.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("backend stdout was not captured")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("backend stderr was not captured")?;
    drain(stderr, "stderr");

    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    eprintln!("dsh desktop stdout: {line}");
                    if let Some(url) = parse_ready_url(&line) {
                        let _ = sender.send(url);
                    }
                }
                Err(error) => {
                    eprintln!("dsh desktop: failed to read backend stdout: {error}");
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
        Err(error) => {
            let status = child.try_wait().ok().flatten();
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "backend did not become ready within 60 seconds ({error}; status: {status:?})"
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
        .setup(move |app| {
            let (child, url) = spawn_backend(app.handle()).map_err(std::io::Error::other)?;
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

#[cfg(test)]
mod tests {
    use super::{mark_desktop_url, parse_ready_url};

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
