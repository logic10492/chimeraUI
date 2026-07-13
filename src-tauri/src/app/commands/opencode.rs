// ============================================
// Chimera Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::{OwnedServiceProcess, ServiceState};
use serde::Serialize;
use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::Ordering, mpsc},
    thread,
    time::{Duration, Instant},
};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChimeraServiceResult {
    started: bool,
    started_by_us: bool,
    url: Option<String>,
}

struct SpawnedChimeraServe {
    child: Child,
    output: mpsc::Receiver<String>,
}

fn owned_service_process(child: Child) -> OwnedServiceProcess {
    #[cfg(unix)]
    let process_group_id = child.id() as i32;

    OwnedServiceProcess {
        child,
        #[cfg(unix)]
        process_group_id,
    }
}

/// 检查 Chimera 服务是否在运行（通过 health endpoint）
pub async fn is_service_running(url: &str) -> bool {
    let health_url = format!("{}/global/health", url.trim_end_matches('/'));
    match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client
            .get(&health_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// 启动 chimera serve 进程
fn spawn_chimera_serve(
    binary_path: &str,
    env_vars: &std::collections::HashMap<String, String>,
) -> Result<SpawnedChimeraServe, String> {
    log::info!("Starting chimera serve with binary: {}", binary_path);
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    let serve_args = ["serve".to_string()];

    let mut cmd = build_chimera_command(binary_path, &serve_args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // 注入用户配置的环境变量
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start '{}': {}. Check that the path is correct.",
            binary_path, e
        )
    })?;

    let (tx, output) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader(stderr, tx);
    }

    Ok(SpawnedChimeraServe { child, output })
}

fn spawn_output_reader<R>(reader: R, tx: mpsc::Sender<String>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(sender) = tx.as_ref() {
                if sender.send(line).is_err() {
                    tx = None;
                }
            }
        }
    });
}

fn parse_listening_url(line: &str) -> Option<String> {
    let start = line.find("http://").or_else(|| line.find("https://"))?;
    let raw_url = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(|c| matches!(c, ',' | ';' | ')'));
    let normalized = raw_url
        .replace("http://0.0.0.0:", "http://127.0.0.1:")
        .replace("https://0.0.0.0:", "https://127.0.0.1:");
    let parsed = reqwest::Url::parse(&normalized).ok()?;

    Some(parsed.to_string().trim_end_matches('/').to_string())
}

fn remember_recent_output(recent_output: &mut VecDeque<String>, line: String) {
    if recent_output.len() >= 8 {
        recent_output.pop_front();
    }
    recent_output.push_back(line);
}

fn format_recent_output(recent_output: &VecDeque<String>) -> String {
    if recent_output.is_empty() {
        return String::new();
    }

    format!(
        " Recent output: {}",
        recent_output
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

fn build_chimera_command(binary_path: &str, args: &[String]) -> Command {
    #[cfg(target_os = "windows")]
    {
        let path = Path::new(binary_path);
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let requires_shell = ext.eq_ignore_ascii_case("cmd")
            || ext.eq_ignore_ascii_case("bat")
            || path.extension().is_none();

        if requires_shell {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C").arg(binary_path).args(args);
            return cmd;
        }
    }

    let mut cmd = Command::new(binary_path);
    cmd.args(args);
    cmd
}

fn patched_env_var(
    env_vars: &std::collections::HashMap<String, String>,
    key: &str,
) -> Option<OsString> {
    for (env_key, value) in env_vars {
        if env_key.eq_ignore_ascii_case(key) {
            return Some(OsString::from(value));
        }
    }
    env::var_os(key)
}

fn path_candidates(env_vars: &std::collections::HashMap<String, String>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(bin) = patched_env_var(env_vars, "CHIMERA_BIN") {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }

    let Some(path) = patched_env_var(env_vars, "PATH") else {
        return candidates;
    };

    let names: Vec<&str> = if cfg!(windows) {
        vec!["chimera.exe", "chimera.cmd", "chimera.bat", "chimera"]
    } else {
        vec!["chimera"]
    };

    for dir in env::split_paths(&path) {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }

    candidates
}

fn compatibility_path_candidates(
    env_vars: &std::collections::HashMap<String, String>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(bin) = patched_env_var(env_vars, "OPENCODE_BIN") {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }
    candidates.extend(path_candidates(env_vars));
    candidates
}

fn is_runnable_file(path: &Path) -> bool {
    path.is_file()
}

/// 自动检测 Chimera 可执行文件，行为接近直接在终端输入 `chimera`。
#[tauri::command]
pub async fn detect_chimera_service(
    env_vars: std::collections::HashMap<String, String>,
) -> Result<Option<String>, String> {
    for candidate in path_candidates(&env_vars) {
        if is_runnable_file(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

const SERVICE_STOP_GRACE: Duration = Duration::from_secs(2);

#[cfg(unix)]
fn signal_process_group(process_group_id: i32, signal: i32) -> Result<(), String> {
    let result = unsafe { libc::kill(-process_group_id, signal) };
    if result == 0 {
        return Ok(());
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    Err(format!(
        "Failed to signal service process group {}: {}",
        process_group_id, error
    ))
}

#[cfg(unix)]
fn process_group_exists(process_group_id: i32) -> Result<bool, String> {
    let result = unsafe { libc::kill(-process_group_id, 0) };
    if result == 0 {
        return Ok(true);
    }

    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(false);
    }
    if error.raw_os_error() == Some(libc::EPERM) {
        return Ok(true);
    }
    Err(format!(
        "Failed to inspect service process group {}: {}",
        process_group_id, error
    ))
}

#[cfg(unix)]
fn wait_for_process_group_exit(
    process: &mut OwnedServiceProcess,
    deadline: Instant,
) -> Result<bool, String> {
    loop {
        process
            .child
            .try_wait()
            .map_err(|error| error.to_string())?;
        if !process_group_exists(process.process_group_id)? {
            return Ok(true);
        }
        if Instant::now() >= deadline {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn terminate_owned_process(process: &mut OwnedServiceProcess) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let pid = process.child.id();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|error| format!("Failed to stop service process tree {pid}: {error}"))?;
        if !status.success()
            && process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
        {
            return Err(format!(
                "taskkill failed for service process tree {pid}: {status}"
            ));
        }
        process
            .child
            .wait()
            .map_err(|error| format!("Failed to reap service process {pid}: {error}"))?;
        return Ok(());
    }

    #[cfg(unix)]
    {
        signal_process_group(process.process_group_id, libc::SIGTERM)?;
        if wait_for_process_group_exit(process, Instant::now() + SERVICE_STOP_GRACE)? {
            return Ok(());
        }

        signal_process_group(process.process_group_id, libc::SIGKILL)?;
        if wait_for_process_group_exit(process, Instant::now() + SERVICE_STOP_GRACE)? {
            return Ok(());
        }

        return Err(format!(
            "Service process group {} did not exit after SIGKILL",
            process.process_group_id
        ));
    }

    #[cfg(not(any(target_os = "windows", unix)))]
    {
        let pid = process.child.id();
        Err(format!(
            "Unsupported desktop platform while stopping service process {pid}"
        ))
    }
}

fn clear_owned_service_metadata(state: &ServiceState) -> Result<(), String> {
    state.child_pid.store(0, Ordering::SeqCst);
    state.we_started.store(false, Ordering::SeqCst);
    *state
        .service_url
        .lock()
        .map_err(|error| error.to_string())? = None;
    Ok(())
}

pub fn cleanup_owned_service(state: &ServiceState) -> Result<(), String> {
    let mut owned_process = state
        .owned_process
        .lock()
        .map_err(|error| error.to_string())?;
    if let Some(process) = owned_process.as_mut() {
        log::info!(
            "Stopping app-owned chimera serve, PID: {}",
            process.child.id()
        );
        terminate_owned_process(process)?;
        owned_process.take();
    }
    drop(owned_process);
    clear_owned_service_metadata(state)
}

fn release_owned_service(state: &ServiceState) -> Result<(), String> {
    state
        .owned_process
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    clear_owned_service_metadata(state)
}

/// 检查 Chimera 服务是否在运行
#[tauri::command]
pub async fn check_chimera_service(url: String) -> Result<bool, String> {
    Ok(is_service_running(&url).await)
}

/// 启动 chimera serve
#[tauri::command]
pub async fn start_chimera_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
) -> Result<StartChimeraServiceResult, String> {
    let _start_guard = state.start_lock.lock().await;

    if state.we_started.load(Ordering::SeqCst) {
        let current_url = state.service_url.lock().map_err(|e| e.to_string())?.clone();
        if let Some(current_url) = current_url {
            if is_service_running(&current_url).await {
                log::info!("Chimera service already running at {}", current_url);
                return Ok(StartChimeraServiceResult {
                    started: false,
                    started_by_us: true,
                    url: Some(current_url),
                });
            }
        }
    }
    cleanup_owned_service(&state)?;

    if is_service_running(&url).await {
        log::info!("Chimera service already running at {}", url);
        return Ok(StartChimeraServiceResult {
            started: false,
            started_by_us: false,
            url: Some(url),
        });
    }

    let SpawnedChimeraServe { child, output } = spawn_chimera_serve(&binary_path, &env_vars)?;
    let pid = child.id();
    log::info!("Started chimera serve, PID: {}", pid);

    {
        let mut owned_process = state
            .owned_process
            .lock()
            .map_err(|error| error.to_string())?;
        *owned_process = Some(owned_service_process(child));
        state.child_pid.store(pid, Ordering::SeqCst);
        state.we_started.store(true, Ordering::SeqCst);
        *state.service_url.lock().map_err(|e| e.to_string())? = None;
    }

    let mut detected_url: Option<String> = None;
    let mut recent_output = VecDeque::new();

    for _ in 0..30 {
        while let Ok(line) = output.try_recv() {
            if let Some(parsed_url) = parse_listening_url(&line) {
                log::info!("Detected chimera serve URL: {}", parsed_url);
                *state.service_url.lock().map_err(|e| e.to_string())? = Some(parsed_url.clone());
                detected_url = Some(parsed_url);
            }
            remember_recent_output(&mut recent_output, line);
        }

        let child_status = {
            let mut owned_process = state
                .owned_process
                .lock()
                .map_err(|error| error.to_string())?;
            let Some(process) = owned_process.as_mut() else {
                return Err("chimera serve startup was cancelled".to_string());
            };
            process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
        };
        if let Some(status) = child_status {
            let message = format!(
                "chimera serve exited during startup with status {}.{}",
                status,
                format_recent_output(&recent_output)
            );
            if let Err(error) = cleanup_owned_service(&state) {
                return Err(format!("{message} Cleanup failed: {error}"));
            }
            return Err(message);
        }

        let health_url = detected_url.as_deref().unwrap_or(&url);
        if is_service_running(health_url).await {
            let owns_running_process = {
                let mut owned_process = state
                    .owned_process
                    .lock()
                    .map_err(|error| error.to_string())?;
                let Some(process) = owned_process.as_mut() else {
                    return Err("chimera serve startup was cancelled".to_string());
                };
                process
                    .child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_none()
            };
            if !owns_running_process {
                let message = format!(
                    "chimera serve exited while completing startup.{}",
                    format_recent_output(&recent_output)
                );
                if let Err(error) = cleanup_owned_service(&state) {
                    return Err(format!("{message} Cleanup failed: {error}"));
                }
                return Err(message);
            }

            log::info!("Chimera service is ready at {}", health_url);
            *state.service_url.lock().map_err(|e| e.to_string())? = Some(health_url.to_string());
            return Ok(StartChimeraServiceResult {
                started: true,
                started_by_us: true,
                url: Some(health_url.to_string()),
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let message = format!(
        "chimera serve did not become healthy before the startup timeout.{}",
        format_recent_output(&recent_output)
    );
    if let Err(error) = cleanup_owned_service(&state) {
        return Err(format!("{message} Cleanup failed: {error}"));
    }
    Err(message)
}

/// 停止 chimera serve
#[tauri::command]
pub async fn stop_chimera_service(state: State<'_, ServiceState>) -> Result<(), String> {
    cleanup_owned_service(&state)
}

#[tauri::command]
pub async fn detect_opencode_binary(
    env_vars: std::collections::HashMap<String, String>,
) -> Result<Option<String>, String> {
    for candidate in compatibility_path_candidates(&env_vars) {
        if is_runnable_file(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn check_opencode_service(url: String) -> Result<bool, String> {
    check_chimera_service(url).await
}

#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
) -> Result<StartChimeraServiceResult, String> {
    start_chimera_service(state, url, binary_path, env_vars).await
}

#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    stop_chimera_service(state).await
}

/// 查询是否由我们启动了 Chimera 服务
#[tauri::command]
pub async fn get_service_started_by_us(state: State<'_, ServiceState>) -> Result<bool, String> {
    Ok(state.we_started.load(Ordering::SeqCst))
}

/// 确认关闭应用（前端调用，可选择是否同时停止服务）
#[tauri::command]
pub async fn confirm_close_app(
    window: tauri::Window,
    state: State<'_, ServiceState>,
    stop_service: bool,
) -> Result<(), String> {
    if stop_service {
        cleanup_owned_service(&state)?;
    } else {
        log::info!("Closing app, keeping chimera serve running");
        release_owned_service(&state)?;
    }

    window.destroy().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_chimera_command, cleanup_owned_service, compatibility_path_candidates,
        path_candidates, terminate_owned_process,
    };
    use crate::app::service::{OwnedServiceProcess, ServiceState};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn candidates_prefer_chimera_bin_and_never_guess_opencode() {
        let env_vars = HashMap::from([
            (
                "CHIMERA_BIN".to_string(),
                "/opt/chimera/bin/chimera".to_string(),
            ),
            ("PATH".to_string(), "/usr/local/bin".to_string()),
        ]);
        let candidates = path_candidates(&env_vars);

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/opt/chimera/bin/chimera"))
        );
        assert!(candidates.iter().any(|path| path.ends_with("chimera")));
        assert!(!candidates.iter().any(|path| path.ends_with("opencode")));
    }

    #[test]
    fn explicit_legacy_binary_path_is_preserved() {
        let command = build_chimera_command("/opt/legacy/opencode", &["serve".to_string()]);

        assert_eq!(command.get_program(), "/opt/legacy/opencode");
    }

    #[test]
    fn legacy_detection_accepts_only_explicit_opencode_bin() {
        let env_vars = HashMap::from([
            (
                "OPENCODE_BIN".to_string(),
                "/opt/legacy/opencode".to_string(),
            ),
            (
                "CHIMERA_BIN".to_string(),
                "/opt/chimera/bin/chimera".to_string(),
            ),
            ("PATH".to_string(), "/usr/local/bin".to_string()),
        ]);
        let candidates = compatibility_path_candidates(&env_vars);

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/opt/legacy/opencode"))
        );
        assert!(candidates
            .iter()
            .any(|path| path == &PathBuf::from("/opt/chimera/bin/chimera")));
        assert_eq!(
            candidates
                .iter()
                .filter(|path| path.ends_with("opencode"))
                .count(),
            1
        );
    }

    #[test]
    fn cleanup_without_owned_process_is_idempotent() {
        let state = ServiceState::default();

        cleanup_owned_service(&state).expect("first cleanup should succeed");
        cleanup_owned_service(&state).expect("second cleanup should succeed");
    }

    #[cfg(unix)]
    #[test]
    fn unix_cleanup_terminates_and_reaps_process_group() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("trap '' TERM; while :; do sleep 30; done")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("spawn process-group fixture");
        let process_group_id = child.id() as i32;
        let mut process = OwnedServiceProcess {
            child,
            process_group_id,
        };

        terminate_owned_process(&mut process).expect("terminate process group");

        let result = unsafe { libc::kill(-process_group_id, 0) };
        assert_eq!(result, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }

    #[cfg(unix)]
    #[test]
    fn unix_cleanup_kills_descendants_after_group_leader_exits() {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg("trap '' TERM; sleep 30 & exit 0")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let child = command.spawn().expect("spawn descendant fixture");
        let process_group_id = child.id() as i32;
        let mut process = OwnedServiceProcess {
            child,
            process_group_id,
        };
        process.child.wait().expect("wait for process-group leader");

        assert_eq!(unsafe { libc::kill(-process_group_id, 0) }, 0);
        terminate_owned_process(&mut process).expect("terminate remaining descendants");

        let result = unsafe { libc::kill(-process_group_id, 0) };
        assert_eq!(result, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
}
