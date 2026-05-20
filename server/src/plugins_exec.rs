//! Server-side plugin execution.
//!
//! Opt-in alternative to client-side plugin runtime. Clients with
//! `app.plugins_server_mode = true` send commands to `/api/plugins/:id/exec`
//! instead of spawning the plugin binary locally. The server spawns the
//! plugin from `<plugins_dir>/<id>/binary_server` and proxies the JSON-RPC
//! response back.
//!
//! Sandboxing: out of scope this iteration. macOS sandbox-exec / Linux
//! seccomp / Windows Job Objects come in F+1. Documented as a known gap.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::auth::require_auth;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct ExecRequest {
    pub op: String,
    #[serde(default)]
    pub args: serde_json::Value,
    pub org_id: String,
}

#[derive(Debug, Serialize)]
pub struct ExecResponse {
    pub ok: bool,
    pub result: serde_json::Value,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/:plugin_id/exec", post(exec))
}

async fn exec(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    Json(req): Json<ExecRequest>,
) -> Result<Json<ExecResponse>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    if !is_safe_plugin_id(&plugin_id) {
        return Err((StatusCode::BAD_REQUEST, "invalid plugin id".into()));
    }
    let role = state
        .store
        .get_member_role(&req.org_id, &user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    if role == "viewer" {
        return Err((StatusCode::FORBIDDEN, "viewer cannot exec".into()));
    }
    let installed = state
        .store
        .get_installed_plugin(&req.org_id, &plugin_id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "plugin not installed in this org".into()))?;
    if !installed.enabled {
        return Err((StatusCode::CONFLICT, "plugin disabled".into()));
    }

    let bin = resolve_plugin_binary(&plugin_id)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    if !bin.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            format!("server-side binary missing at {bin:?}"),
        ));
    }

    let payload = serde_json::json!({ "op": req.op, "args": req.args });
    let result = run_plugin(&bin, payload).await.map_err(internal)?;
    Ok(Json(ExecResponse { ok: true, result }))
}

/// Plugin ids must look like a package slug — alphanumerics, dashes,
/// underscores, dots — and nothing that could traverse out of the plugins
/// directory. Reject empty strings, separators, and leading dots so a
/// plugin can't shadow a real binary or escape via `..`.
pub(crate) fn is_safe_plugin_id(id: &str) -> bool {
    if id.is_empty() || id.starts_with('.') {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Resolve the plugin binary path and verify it stays within the configured
/// plugins directory. Defense in depth on top of `is_safe_plugin_id` — even
/// if a future change loosens id validation, this canonicalize step prevents
/// path traversal against an existing binary outside the base directory.
fn resolve_plugin_binary(plugin_id: &str) -> Result<PathBuf, String> {
    let base_raw = std::env::var("DBM_PLUGINS_DIR").unwrap_or_else(|_| "./plugins".into());
    let base = std::path::PathBuf::from(&base_raw);
    let candidate = base.join(plugin_id).join("binary_server");
    let base_abs = std::fs::canonicalize(&base).unwrap_or(base);
    if let Ok(candidate_abs) = std::fs::canonicalize(&candidate) {
        if !candidate_abs.starts_with(&base_abs) {
            return Err("plugin binary path escapes plugins dir".into());
        }
        return Ok(candidate_abs);
    }
    // Binary may not exist yet; the caller checks `exists()` afterwards.
    Ok(candidate)
}

async fn run_plugin(
    bin: &PathBuf,
    payload: serde_json::Value,
) -> Result<serde_json::Value, anyhow::Error> {
    let mut child = sandboxed_command(bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdin = child.stdin.take().expect("piped");
    let stdout = child.stdout.take().expect("piped");

    let request_line = format!("{}\n", serde_json::to_string(&payload)?);
    stdin.write_all(request_line.as_bytes()).await?;
    stdin.flush().await?;
    drop(stdin);

    let mut reader = BufReader::new(stdout).lines();
    let line = tokio::time::timeout(Duration::from_secs(30), reader.next_line())
        .await
        .map_err(|_| anyhow::anyhow!("plugin exec timeout (30s)"))??
        .ok_or_else(|| anyhow::anyhow!("plugin produced no output"))?;
    let _ = child.kill().await;
    let value: serde_json::Value = serde_json::from_str(&line)?;
    Ok(value)
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// Minimal sandbox wrapper for server-side plugin runtime. Filters filesystem
/// + network at the OS level on macOS via `sandbox-exec`; uses
/// `systemd-run --user --scope` on Linux when available to namespace the
/// process; falls back to a bare command otherwise. Real granular
/// restrictions (seccomp filters, capability drops) belong in a follow-up.
fn sandboxed_command(bin: &PathBuf) -> Command {
    #[cfg(target_os = "macos")]
    {
        // Generic sandbox profile: deny everything by default, allow basic
        // process exec + read on system libs + stdio. Plugin is expected to
        // open outbound DB connections itself — those need network-outbound
        // which we permit. Tighten in F+1.
        let profile = r#"(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-read*)
(allow file-write-data (subpath "/tmp"))
(allow network-outbound)
(allow mach-lookup)
(allow signal (target self))
"#;
        let mut cmd = Command::new("sandbox-exec");
        cmd.arg("-p").arg(profile).arg(bin);
        cmd
    }
    #[cfg(target_os = "linux")]
    {
        // systemd-run isolates the process into a transient unit so we can
        // resource-limit it. If unavailable on the host, fall back to bare.
        if which::which("systemd-run").is_ok() {
            let mut cmd = Command::new("systemd-run");
            cmd.args([
                "--user",
                "--scope",
                "--quiet",
                "-p", "PrivateTmp=yes",
                "-p", "NoNewPrivileges=yes",
            ])
            .arg(bin);
            return cmd;
        }
        return Command::new(bin);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Command::new(bin)
    }
}
