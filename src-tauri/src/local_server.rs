//! Embedded local server lifecycle.
//!
//! On app startup we spawn the `dbm-server` binary as a child process bound
//! to `127.0.0.1:<port>` (or `0.0.0.0:<port>` if the LAN toggle is on).
//! The binary path resolution:
//!
//! 1. Production builds bundle the binary via `tauri.conf.json.externalBin`,
//!    resolved at runtime through `tauri::path::resolve_resource`.
//! 2. Dev builds (when no bundled binary is found) fall back to
//!    `target/release/dbm-server` from the workspace.
//!
//! Health gate: after spawn we poll `/health` up to 3 times with exponential
//! backoff (1s, 2s, 4s). Failure surfaces as an error string with the
//! captured stderr tail so the UI can render `ServerOfflineScreen`.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::AppState;

/// Argon2id password hash of the bearer token. Sent once at spawn-time via
/// `DBM_LOCAL_ADMIN_HASH` env so the server has the verifier. Each call
/// returns a different hash (random salt) but all verify against the same
/// token.
fn hash_token(token: &str) -> Result<String, String> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    use argon2::Argon2;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(token.as_bytes(), &salt)
        .map_err(|e| format!("argon2: {e}"))
        .map(|h| h.to_string())
}

/// Generate a fresh random bearer + its Argon2id hash. The token is stored
/// client-side in `local.admin_token` (and ideally the OS keychain) and the
/// hash is injected into the server child via `DBM_LOCAL_ADMIN_HASH` env.
#[tauri::command]
pub fn gen_local_admin_token() -> Result<DerivedToken, String> {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = base64::engine::general_purpose::STANDARD.encode(bytes);
    let hash = hash_token(&token)?;
    Ok(DerivedToken { token, hash })
}

#[derive(Debug, Clone, Serialize)]
pub struct DerivedToken {
    pub token: String,
    pub hash: String,
}

#[tauri::command]
pub async fn local_server_setup_admin(
    server_url: String,
    hash: String,
) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("{}/api/auth/admin/setup", server_url.trim_end_matches('/'));
    let res = client
        .post(&url)
        .json(&serde_json::json!({ "hash": hash }))
        .send()
        .await
        .map_err(|e| format!("setup request failed: {e}"))?;
    if res.status().is_success() { return Ok(true); }
    if res.status() == reqwest::StatusCode::CONFLICT { return Ok(false); }
    Err(format!("setup returned {}", res.status()))
}

#[derive(Debug, Default)]
pub struct LocalServerHandle {
    inner: Mutex<Option<RunningServer>>,
}

#[derive(Debug)]
struct RunningServer {
    child: Child,
    port: u16,
    bind: String,
    started_at: chrono::DateTime<chrono::Utc>,
    log_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub bind: Option<String>,
    pub uptime_secs: Option<i64>,
    pub log_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StartOptions {
    /// TCP port to bind. Defaults to 18787.
    #[serde(default)]
    pub port: Option<u16>,
    /// Bind 0.0.0.0 + force TLS instead of 127.0.0.1. Defaults to false.
    #[serde(default)]
    pub lan: bool,
    /// Argon2-hashed admin token. Sent via env so the server has the
    /// passphrase-derived credential to verify client requests. None on
    /// subsequent restarts — server reads the persisted hash from its DB.
    pub admin_token_hash: Option<String>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))
        .map(|p| p.join("local-server"))
}

pub(crate) fn resolve_binary_for_autostart(app: &AppHandle) -> Result<PathBuf, String> {
    binary_path(app)
}

fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    // Production: resolve via bundled resource (externalBin auto-suffixed).
    let triple = current_triple();
    if let Ok(resolved) = app
        .path()
        .resolve(format!("binaries/dbm-server-{triple}"), tauri::path::BaseDirectory::Resource)
    {
        if resolved.exists() {
            return Ok(resolved);
        }
    }
    // Dev fallback: target/release relative to the source tree.
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut probe = cwd.clone();
    for _ in 0..5 {
        let candidate = probe.join("target/release/dbm-server");
        if candidate.exists() {
            return Ok(candidate);
        }
        let Some(parent) = probe.parent() else { break };
        probe = parent.to_path_buf();
    }
    Err("dbm-server binary not found. In dev, run `cargo build --release -p dbm-server` first.".into())
}

fn current_triple() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unknown"
    }
}

async fn probe_health(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("health returned {}", res.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn start_local_server(
    app: AppHandle,
    state: State<'_, AppState>,
    handle: State<'_, LocalServerHandle>,
    options: StartOptions,
) -> Result<LocalServerStatus, String> {
    // If a previous child is still alive, no-op and return status.
    {
        let mut guard = handle.inner.lock().unwrap();
        if let Some(server) = guard.as_mut() {
            // Reap if dead.
            match server.child.try_wait() {
                Ok(Some(_)) => { *guard = None; }
                Ok(None) => return Ok(status_from(server)),
                Err(_) => { *guard = None; }
            }
        }
    }

    let port = options.port.unwrap_or(18787);
    let bind = if options.lan { "0.0.0.0".to_string() } else { "127.0.0.1".to_string() };
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let plugins_dir = dir.join("plugins");
    std::fs::create_dir_all(&plugins_dir).ok();
    let db_path = dir.join("dbm.sqlite");
    let log_path = dir.join("server.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open log: {e}"))?;
    let stderr = log_file.try_clone().map_err(|e| e.to_string())?;

    let bin = binary_path(&app)?;
    let mut cmd = Command::new(&bin);
    cmd.env("PORT", port.to_string())
        .env("BIND_ADDR", &bind)
        .env(
            "DATABASE_URL",
            db_path.to_string_lossy().to_string(),
        )
        .env("SERVER_NAME", "Local")
        .env("RUST_LOG", "info")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));
    if let Some(hash) = options.admin_token_hash.as_deref() {
        cmd.env("DBM_LOCAL_ADMIN_HASH", hash);
    }
    let child = cmd.spawn().map_err(|e| format!("spawn server: {e}"))?;

    // Retry health probe with backoff.
    let mut last_err = String::new();
    for delay in [1u64, 2, 4] {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        match probe_health(port).await {
            Ok(()) => {
                let running = RunningServer {
                    child,
                    port,
                    bind: bind.clone(),
                    started_at: chrono::Utc::now(),
                    log_path: log_path.clone(),
                };
                let status = status_from(&running);
                *handle.inner.lock().unwrap() = Some(running);
                let _ = state; // marker — state may be needed for future hooks
                return Ok(status);
            }
            Err(e) => { last_err = e; }
        }
    }
    // Health never came up. Best-effort kill and return error.
    let _ = drop_child(child);
    Err(format!("local server failed to start: {last_err}. See {log_path:?}."))
}

/// Fire-and-forget boot hook: when the app launches and the active org is
/// local-like, spawn the embedded `dbm-server` so the user doesn't have to
/// hit a "Start" button before the rest of the UI works. Safe no-op when
/// something is already serving on the port (external daemon / autostart
/// LaunchAgent) — we just leave it alone.
pub async fn auto_start_on_boot(
    app: AppHandle,
    handle_state: tauri::State<'_, LocalServerHandle>,
    port: u16,
    admin_token_hash: Option<String>,
) -> Result<(), String> {
    // Already-running? probe_health will succeed against an external daemon
    // or a previously-spawned child. Don't double-spawn or 48-EADDRINUSE.
    if probe_health(port).await.is_ok() {
        return Ok(());
    }
    let bind = "127.0.0.1".to_string();
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.join("plugins")).ok();
    let db_path = dir.join("dbm.sqlite");
    let log_path = dir.join("server.log");
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open log: {e}"))?;
    let stderr = log_file.try_clone().map_err(|e| e.to_string())?;
    let bin = binary_path(&app)?;
    let mut cmd = Command::new(&bin);
    cmd.env("PORT", port.to_string())
        .env("BIND_ADDR", &bind)
        .env("DATABASE_URL", db_path.to_string_lossy().to_string())
        .env("SERVER_NAME", "Local")
        .env("RUST_LOG", "info")
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));
    if let Some(hash) = admin_token_hash.as_deref() {
        cmd.env("DBM_LOCAL_ADMIN_HASH", hash);
    }
    let child = cmd.spawn().map_err(|e| format!("spawn server: {e}"))?;
    for delay in [1u64, 2, 4] {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        if probe_health(port).await.is_ok() {
            *handle_state.inner.lock().unwrap() = Some(RunningServer {
                child,
                port,
                bind: bind.clone(),
                started_at: chrono::Utc::now(),
                log_path: log_path.clone(),
            });
            return Ok(());
        }
    }
    let _ = drop_child(child);
    Err("auto-start: server failed to come up".into())
}

#[tauri::command]
pub async fn stop_local_server(
    app: AppHandle,
    handle: State<'_, LocalServerHandle>,
) -> Result<(), String> {
    // Tracked child first.
    {
        let mut guard = handle.inner.lock().unwrap();
        if let Some(server) = guard.take() {
            drop_child(server.child)?;
            return Ok(());
        }
    }
    // Adopted external server: locate the PID via the configured port and
    // SIGTERM it. lsof on macOS/Linux returns the holder of a TCP port; on
    // Windows we leave it as a no-op for now.
    #[cfg(unix)]
    {
        let port = read_configured_port(&app);
        if let Ok(out) = std::process::Command::new("lsof")
            .args(["-ti", &format!("tcp:{port}")])
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Ok(pid) = line.trim().parse::<i32>() {
                    unsafe { libc_kill(pid, 15); }
                }
            }
        }
    }
    #[cfg(not(unix))]
    let _ = app;
    Ok(())
}

/// Best-effort lookup of the configured local-server port from app_settings.
/// Falls back to 18787 when unset / malformed.
fn read_configured_port(app: &AppHandle) -> u16 {
    let state = app.state::<crate::AppState>();
    state
        .db
        .get_app_setting("local.server_port")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| match v {
            serde_json::Value::Number(n) => n.as_u64().map(|n| n as u16),
            serde_json::Value::String(s) => s.parse::<u16>().ok(),
            _ => None,
        })
        .unwrap_or(18787)
}

#[tauri::command]
pub async fn local_server_status(
    app: AppHandle,
    handle: State<'_, LocalServerHandle>,
) -> Result<LocalServerStatus, String> {
    // Path 1: child tracked by our process (launched via start_local_server
    // or the boot auto-spawn).
    {
        let mut guard = handle.inner.lock().unwrap();
        if let Some(server) = guard.as_mut() {
            match server.child.try_wait() {
                Ok(Some(_)) => { *guard = None; }
                Ok(None) => return Ok(status_from(server)),
                Err(_) => { *guard = None; }
            }
        }
    }
    // Path 2: external daemon / LaunchAgent / previously-spawned instance
    // we no longer own. Probe the configured port — if something answers
    // /health, treat the server as up so the UI shows Running + Restart
    // instead of Start.
    let port = read_configured_port(&app);
    if probe_health(port).await.is_ok() {
        return Ok(LocalServerStatus {
            running: true,
            pid: None,
            port: Some(port),
            bind: Some("127.0.0.1".into()),
            uptime_secs: None,
            log_path: Some(data_dir(&app)?.join("server.log").to_string_lossy().to_string()),
        });
    }
    Ok(LocalServerStatus {
        running: false,
        pid: None,
        port: None,
        bind: None,
        uptime_secs: None,
        log_path: None,
    })
}

#[tauri::command]
pub fn local_server_log_tail(
    app: AppHandle,
    handle: State<'_, LocalServerHandle>,
    lines: Option<usize>,
) -> Result<String, String> {
    let path = if let Some(server) = handle.inner.lock().unwrap().as_ref() {
        server.log_path.clone()
    } else {
        data_dir(&app)?.join("server.log")
    };
    if !path.exists() {
        return Ok(String::new());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let n = lines.unwrap_or(100);
    let collected: Vec<&str> = content.lines().rev().take(n).collect();
    let mut out = String::new();
    for line in collected.into_iter().rev() {
        out.push_str(line);
        out.push('\n');
    }
    Ok(out)
}

/// Upload a plugin binary (any platform-specific .so/.dylib/.dll OR a manifest+binary
/// archive) into the local server's plugins directory. The destination layout is
/// `local-server/plugins/<id>/(manifest.json|binary)`. For raw shared libraries we
/// create a stub manifest derived from the filename so the server can pick it up.
///
/// Caller responsibility: validate the file before sending. We refuse anything
/// outside the allow-listed extensions and writes outside the plugins dir.
#[tauri::command]
pub fn upload_local_plugin(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if filename.is_empty() || filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("invalid filename".into());
    }
    let lower = filename.to_lowercase();
    let allowed = [".so", ".dylib", ".dll", ".zip", ".tar.gz"];
    if !allowed.iter().any(|ext| lower.ends_with(ext)) {
        return Err(format!("unsupported extension: {filename}"));
    }
    if bytes.is_empty() {
        return Err("empty payload".into());
    }
    let plugins_dir = data_dir(&app)?.join("plugins");
    std::fs::create_dir_all(&plugins_dir).map_err(|e| format!("mkdir plugins: {e}"))?;
    let stem = std::path::Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("plugin")
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_', "_");
    let plugin_dir = plugins_dir.join(&stem);
    std::fs::create_dir_all(&plugin_dir).map_err(|e| format!("mkdir {stem}: {e}"))?;
    let target = plugin_dir.join(&filename);
    std::fs::write(&target, &bytes).map_err(|e| format!("write: {e}"))?;
    // Generate a stub manifest if none exists yet so the server's plugins
    // endpoint lists it. User can edit `manifest.json` to refine.
    let manifest_path = plugin_dir.join("manifest.json");
    if !manifest_path.exists() {
        let manifest = serde_json::json!({
            "id": stem,
            "name": stem,
            "version": "0.0.0",
            "binary": filename,
            "platforms": [],
        });
        std::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).unwrap_or_default())
            .map_err(|e| format!("write manifest: {e}"))?;
    }
    Ok(target.to_string_lossy().to_string())
}

fn status_from(s: &RunningServer) -> LocalServerStatus {
    LocalServerStatus {
        running: true,
        pid: Some(s.child.id()),
        port: Some(s.port),
        bind: Some(s.bind.clone()),
        uptime_secs: Some((chrono::Utc::now() - s.started_at).num_seconds()),
        log_path: Some(s.log_path.to_string_lossy().to_string()),
    }
}

fn drop_child(mut child: Child) -> Result<(), String> {
    // Graceful SIGTERM first (best-effort on Unix), then SIGKILL via Child::kill.
    #[cfg(unix)]
    {
        unsafe {
            libc_kill(child.id() as i32, 15);
        }
        for _ in 0..6 {
            std::thread::sleep(Duration::from_millis(500));
            if let Ok(Some(_)) = child.try_wait() {
                return Ok(());
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32, sig: i32) -> i32 {
    kill(pid, sig)
}
