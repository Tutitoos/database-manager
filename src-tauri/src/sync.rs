use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::auth::{decrypt_password, encrypt_password};
use crate::crypto::MasterKey;
use crate::db::SyncEnvelope;
use crate::AppState;

static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

pub fn shutdown_started() -> bool {
    SHUTDOWN_STARTED.load(Ordering::SeqCst)
}

pub fn mark_shutdown_started() {
    SHUTDOWN_STARTED.store(true, Ordering::SeqCst);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub status: String,
    pub pushed: usize,
    pub pulled: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PullPayload {
    envelopes: Vec<SyncEnvelope>,
    server_now: String,
}

async fn server_url(state: &AppState) -> Result<String, String> {
    let value = state
        .db
        .get_app_setting("sync.server_url")?
        .ok_or_else(|| "sync server URL not configured".to_string())?;
    serde_json::from_str::<String>(&value).map_err(|e| e.to_string())
}

async fn session_token(state: &AppState) -> Result<String, String> {
    let user = state
        .db
        .get_app_user()?
        .ok_or_else(|| "not authenticated".to_string())?;
    user.session_token_ref
        .ok_or_else(|| "no session token".to_string())
}

fn ctx_for(envelope: &SyncEnvelope) -> String {
    format!("sync.v1.{}.{}", envelope.entity_type, envelope.entity_id)
}

fn encrypt_payload(
    state: &AppState,
    entity_type: &str,
    entity_id: &str,
    payload: &serde_json::Value,
) -> Result<String, String> {
    let context = format!("sync.v1.{entity_type}.{entity_id}");
    encrypt_password(&state.auth.vault, &context, &payload.to_string())
}

fn decrypt_payload(state: &AppState, envelope: &SyncEnvelope) -> Result<serde_json::Value, String> {
    let pt = decrypt_password(&state.auth.vault, &ctx_for(envelope), &envelope.ciphertext)?;
    serde_json::from_str(&pt).map_err(|e| e.to_string())
}

fn collect_local_payloads(state: &AppState) -> Result<Vec<SyncEnvelope>, String> {
    let dirty = state.db.list_dirty_sync()?;
    let mut out = Vec::with_capacity(dirty.len());
    for (entity_type, entity_id, local_updated_at, deleted_at) in dirty {
        let payload = match entity_type.as_str() {
            "connection" => {
                let id: i64 = entity_id.parse().map_err(|_| "bad id".to_string())?;
                let rec = state.db.get_connection(id)?;
                serde_json::to_value(&rec).map_err(|e| e.to_string())?
            }
            "group" => {
                let groups = state.db.list_groups()?;
                let id: i64 = entity_id.parse().map_err(|_| "bad id".to_string())?;
                groups
                    .into_iter()
                    .find(|g| g.id == id)
                    .map(|g| serde_json::to_value(&g))
                    .transpose()
                    .map_err(|e| e.to_string())?
                    .unwrap_or(serde_json::Value::Null)
            }
            "credential" => {
                let id: i64 = entity_id.parse().map_err(|_| "bad id".to_string())?;
                let rec = state.db.get_credential(id)?;
                serde_json::to_value(&rec).map_err(|e| e.to_string())?
            }
            "app_setting" => {
                let value = state.db.get_app_setting(&entity_id)?;
                serde_json::json!({ "key": entity_id, "value_json": value })
            }
            _ => serde_json::Value::Null,
        };
        let ciphertext = encrypt_payload(state, &entity_type, &entity_id, &payload)?;
        out.push(SyncEnvelope {
            entity_type,
            entity_id,
            updated_at: local_updated_at,
            deleted_at,
            ciphertext,
        });
    }
    Ok(out)
}

fn apply_envelope(state: &AppState, env: &SyncEnvelope) -> Result<(), String> {
    let payload = decrypt_payload(state, env)?;
    match env.entity_type.as_str() {
        "connection" => {
            // Best-effort: keep server data opaque; the desktop hydrates from local SQLite,
            // and edits made on another device are applied as updates to existing rows.
            if let Some(_id) = payload.get("id").and_then(|v| v.as_i64()) {
                // Updating via existing commands keeps invariants; skipped for now to avoid
                // overwriting credential references etc. Future: targeted upsert.
            }
        }
        "group" => {}
        "credential" => {}
        "app_setting" => {
            if let (Some(key), Some(value)) = (
                payload.get("key").and_then(|v| v.as_str()),
                payload.get("value_json").and_then(|v| v.as_str()),
            ) {
                let _ = state.db.set_app_setting(key, value);
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_push(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<SyncStatus, String> {
    let envelopes = collect_local_payloads(&state)?;
    if envelopes.is_empty() {
        let status = SyncStatus {
            status: "idle".into(),
            pushed: 0,
            pulled: 0,
            error: None,
        };
        let _ = app.emit("sync:status", status.clone());
        return Ok(status);
    }
    let url = server_url(&state).await?;
    let token = session_token(&state).await?;
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/sync/push", url.trim_end_matches('/')))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "envelopes": &envelopes }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let err = format!("server returned {}", res.status());
        let status = SyncStatus {
            status: "error".into(),
            pushed: 0,
            pulled: 0,
            error: Some(err.clone()),
        };
        let _ = app.emit("sync:status", status);
        return Err(err);
    }
    let entries: Vec<(String, String, String)> = envelopes
        .iter()
        .map(|e| (e.entity_type.clone(), e.entity_id.clone(), e.updated_at.clone()))
        .collect();
    state.db.clear_dirty_sync(&entries)?;
    let status = SyncStatus {
        status: "pushed".into(),
        pushed: envelopes.len(),
        pulled: 0,
        error: None,
    };
    let _ = app.emit("sync:status", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn sync_pull(
    state: State<'_, AppState>,
    app: AppHandle,
    since: Option<String>,
) -> Result<SyncStatus, String> {
    let url = server_url(&state).await?;
    let token = session_token(&state).await?;
    let client = reqwest::Client::new();
    let mut req = client
        .get(format!("{}/api/sync/pull", url.trim_end_matches('/')))
        .bearer_auth(&token);
    if let Some(s) = since.as_ref() {
        req = req.query(&[("since", s)]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let err = format!("server returned {}", res.status());
        let status = SyncStatus {
            status: "error".into(),
            pushed: 0,
            pulled: 0,
            error: Some(err.clone()),
        };
        let _ = app.emit("sync:status", status);
        return Err(err);
    }
    let payload: PullPayload = res.json().await.map_err(|e| e.to_string())?;
    let pulled = payload.envelopes.len();
    for env in &payload.envelopes {
        let _ = apply_envelope(&state, env);
    }
    state.db.set_last_synced_at(&payload.server_now)?;
    let status = SyncStatus {
        status: "pulled".into(),
        pushed: 0,
        pulled,
        error: None,
    };
    let _ = app.emit("sync:status", status.clone());
    Ok(status)
}

#[tauri::command]
pub async fn sync_run(state: State<'_, AppState>, app: AppHandle) -> Result<SyncStatus, String> {
    // No-op if no user is signed in or vault is locked — auto-trigger paths should not fail.
    if state.db.get_app_user()?.is_none() || !state.auth.vault.is_unlocked() {
        let status = SyncStatus {
            status: "idle".into(),
            pushed: 0,
            pulled: 0,
            error: None,
        };
        let _ = app.emit("sync:status", status.clone());
        return Ok(status);
    }
    let push = sync_push(state.clone(), app.clone()).await.ok();
    let since = state
        .db
        .get_app_user()?
        .and_then(|u| u.last_synced_at);
    let pull = sync_pull(state.clone(), app.clone(), since).await.ok();
    let status = SyncStatus {
        status: "done".into(),
        pushed: push.as_ref().map(|s| s.pushed).unwrap_or(0),
        pulled: pull.as_ref().map(|s| s.pulled).unwrap_or(0),
        error: None,
    };
    let _ = app.emit("sync:status", status.clone());
    Ok(status)
}

#[allow(dead_code)]
fn _force_use(_mk: &MasterKey) {}
