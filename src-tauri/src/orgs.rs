use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgRecord {
    pub id: i64,
    pub name: String,
    pub server_url: Option<String>,
    pub server_kind: String, // "local" | "discovered" | "manual"
    pub cert_fingerprint: Option<String>,
    pub accent_color: Option<String>,
    pub icon_url: Option<String>,
    pub version: Option<String>,
    pub last_health_ok: bool,
    pub user_email: Option<String>,
    pub user_id: Option<String>,
    pub role: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgHealth {
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub providers: Vec<String>,
    #[serde(default)]
    pub min_client_version: Option<String>,
    /// SHA256 of leaf cert if HTTPS (populated by client, not server payload).
    #[serde(default)]
    pub cert_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OrgInput {
    pub name: String,
    pub server_url: Option<String>,
    pub server_kind: String,
    pub accent_color: Option<String>,
    pub icon_url: Option<String>,
    pub cert_fingerprint: Option<String>,
    pub version: Option<String>,
    pub user_email: Option<String>,
    pub user_id: Option<String>,
    pub role: Option<String>,
}

fn map_org(row: &rusqlite::Row<'_>) -> rusqlite::Result<OrgRecord> {
    Ok(OrgRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        server_url: row.get(2)?,
        server_kind: row.get(3)?,
        cert_fingerprint: row.get(4)?,
        accent_color: row.get(5)?,
        icon_url: row.get(6)?,
        version: row.get(7)?,
        last_health_ok: row.get::<_, i64>(8)? == 1,
        user_email: row.get(9)?,
        user_id: row.get(10)?,
        role: row.get(11)?,
        position: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
    })
}

const SELECT: &str =
    "SELECT id, name, server_url, server_kind, cert_fingerprint, accent_color, icon_url, version, last_health_ok, user_email, user_id, role, position, created_at, updated_at FROM organizations";

#[tauri::command]
pub fn list_organizations(state: State<'_, AppState>) -> Result<Vec<OrgRecord>, String> {
    state.db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(&format!("{SELECT} ORDER BY position ASC, id ASC"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_org)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    })
}

#[tauri::command]
pub fn get_organization(state: State<'_, AppState>, id: i64) -> Result<Option<OrgRecord>, String> {
    state.db.with_conn(|conn| {
        conn.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_org)
            .optional()
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn add_organization(state: State<'_, AppState>, input: OrgInput) -> Result<OrgRecord, String> {
    let now = Utc::now().to_rfc3339();
    let id = state.db.with_conn(|conn| {
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM organizations",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO organizations (name, server_url, server_kind, cert_fingerprint, accent_color, icon_url, version, user_email, user_id, role, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                input.name,
                input.server_url,
                input.server_kind,
                input.cert_fingerprint,
                input.accent_color,
                input.icon_url,
                input.version,
                input.user_email,
                input.user_id,
                input.role,
                position,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok::<i64, String>(conn.last_insert_rowid())
    })?;
    get_organization(state, id)?.ok_or_else(|| "failed to load created org".into())
}

#[tauri::command]
pub fn update_organization(
    state: State<'_, AppState>,
    id: i64,
    name: Option<String>,
    accent_color: Option<String>,
    icon_url: Option<String>,
    cert_fingerprint: Option<String>,
    version: Option<String>,
) -> Result<OrgRecord, String> {
    let now = Utc::now().to_rfc3339();
    state.db.with_conn(|conn| {
        conn.execute(
            "UPDATE organizations SET
                name = COALESCE(?1, name),
                accent_color = COALESCE(?2, accent_color),
                icon_url = COALESCE(?3, icon_url),
                cert_fingerprint = COALESCE(?4, cert_fingerprint),
                version = COALESCE(?5, version),
                updated_at = ?6
             WHERE id = ?7",
            params![name, accent_color, icon_url, cert_fingerprint, version, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })?;
    get_organization(state, id)?.ok_or_else(|| "org not found".into())
}

#[tauri::command]
pub fn delete_organization(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.with_conn(|conn| {
        // Block deletion of the last local org so the app always has somewhere
        // to fall back to.
        let kind: Option<String> = conn
            .query_row(
                "SELECT server_kind FROM organizations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if kind.as_deref() == Some("local") {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM organizations WHERE server_kind = 'local'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if count <= 1 {
                return Err("La organización 'Local' es requerida y no se puede eliminar.".into());
            }
        }
        conn.execute("DELETE FROM organizations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn get_active_organization(state: State<'_, AppState>) -> Result<Option<OrgRecord>, String> {
    let id = active_org_id(&state)?;
    match id {
        Some(id) => get_organization(state, id),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn set_active_organization(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    state.db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('app.active_org_id', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![serde_json::to_string(&id.to_string()).unwrap_or_default(), now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

fn active_org_id(state: &State<'_, AppState>) -> Result<Option<i64>, String> {
    state.db.with_conn(|conn| {
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = 'app.active_org_id'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(raw) = raw else { return Ok(None) };
        let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let id = match parsed {
            serde_json::Value::Number(n) => n.as_i64(),
            serde_json::Value::String(s) => s.parse::<i64>().ok(),
            _ => None,
        };
        Ok(id)
    })
}

/// Fetch /health from a server URL. Performs TOFU TLS pinning: captures the
/// leaf certificate SHA256 during the handshake. Caller may pass `pinned` to
/// reject the handshake if the fingerprint doesn't match.
#[tauri::command]
pub async fn org_health(url: String, pinned: Option<String>) -> Result<OrgHealth, String> {
    let normalized = normalize_server_url(&url);
    let (client, captured) = crate::tls::build_pinning_client(pinned, Duration::from_secs(8))?;
    let endpoint = format!("{normalized}/health");
    let res = client
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("No se pudo conectar a {endpoint}: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Servidor respondió HTTP {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut health: OrgHealth = serde_json::from_value(body.clone()).unwrap_or(OrgHealth {
        name: body.get("name").and_then(|v| v.as_str()).unwrap_or("Servidor").to_string(),
        version: None,
        accent_color: None,
        icon_url: None,
        providers: Vec::new(),
        min_client_version: None,
        cert_fingerprint: None,
    });
    if health.name.is_empty() {
        health.name = "Servidor".to_string();
    }
    if let Ok(guard) = captured.lock() {
        if let Some(fp) = guard.clone() {
            health.cert_fingerprint = Some(fp);
        }
    }
    Ok(health)
}

fn normalize_server_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub checksum_sha256: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub signature_b64: Option<String>,
    /// Set by the client after verifying with the org's signing pubkey.
    #[serde(default)]
    pub signature_valid: Option<bool>,
}

/// Build a pinning HTTP client + base URL + remote org id + bearer token for
/// the given local org. Used by commands that proxy to the org's server.
///
/// Token resolution:
/// - **Local org** (server_kind == "local"): use the passphrase-derived bearer
///   stored in `app_settings.local.admin_token` (set on first run after the
///   server is spawned). No OAuth session needed.
/// - **Remote org**: use the OAuth session token from `app_user`.
pub(crate) async fn org_http(state: &AppState, org_id: i64) -> Result<(reqwest::Client, String, Option<String>, String), String> {
    let org = state.db.get_org(org_id)?.ok_or_else(|| "org not found".to_string())?;
    let url = org.server_url.ok_or_else(|| "org has no server URL".to_string())?;
    let token = if org.server_kind == "local" {
        state
            .db
            .get_app_setting("local.admin_token")?
            .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
            .ok_or_else(|| "local admin token not configured".to_string())?
    } else {
        let user = state.db.get_app_user()?.ok_or_else(|| "not authenticated".to_string())?;
        user.session_token_ref.ok_or_else(|| "no session token".to_string())?
    };
    let (client, _captured) =
        crate::tls::build_pinning_client(org.cert_fingerprint.clone(), Duration::from_secs(15))?;
    // Fallback: a local org row with no `remote_id` (older installs that
    // skipped `set_org_remote_id`) still needs an `org_id` query param on
    // every CRUD call — otherwise the server returns 400 "Failed to
    // deserialize query string". The seeded synthetic local org is always
    // named "org_local" so we substitute that.
    let remote = org.remote_id.or_else(|| {
        if org.server_kind == "local" { Some("org_local".to_string()) } else { None }
    });
    Ok((client, url.trim_end_matches('/').to_string(), remote, token))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberView {
    pub user_id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub joined_at: String,
}

/// Lazy backfill: when an existing local org row has no `remote_id` (added
/// before the OAuth-complete sync, or migrated from an earlier schema), fetch
/// `/api/orgs/me` and pick the first org as the linked UUID. Persists the
/// resolved id so subsequent calls hit the right path.
async fn ensure_remote_id(
    state: &AppState,
    org_id: i64,
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<String, String> {
    if let Some(org) = state.db.get_org(org_id)? {
        if let Some(rid) = org.remote_id {
            return Ok(rid);
        }
    }
    let res = client
        .get(format!("{url}/api/orgs/me"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("/api/orgs/me returned {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let orgs = body
        .get("orgs")
        .or(Some(&body))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let rid = orgs
        .first()
        .and_then(|o| o.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "user belongs to no orgs on this server".to_string())?
        .to_string();
    state.db.set_org_remote_id(org_id, &rid)?;
    Ok(rid)
}

#[tauri::command]
pub async fn org_list_members(state: State<'_, AppState>, org_id: i64) -> Result<Vec<MemberView>, String> {
    let (client, url, remote_id, token) = org_http(&state, org_id).await?;
    let remote_id = match remote_id {
        Some(r) => r,
        None => ensure_remote_id(&state, org_id, &client, &url, &token).await?,
    };
    let res = client.get(format!("{url}/api/orgs/{remote_id}/members"))
        .bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let members = body.get("members").cloned().unwrap_or(serde_json::Value::Array(vec![]));
    serde_json::from_value(members).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn org_create_invite(state: State<'_, AppState>, org_id: i64, role: String, ttl_hours: Option<i64>) -> Result<String, String> {
    let (client, url, remote_id, token) = org_http(&state, org_id).await?;
    let remote_id = remote_id.ok_or_else(|| "org has no remote id".to_string())?;
    let res = client.post(format!("{url}/api/orgs/{remote_id}/members"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "role": role, "ttl_hours": ttl_hours }))
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(body.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string())
}

#[tauri::command]
pub async fn org_set_member_role(state: State<'_, AppState>, org_id: i64, user_id: String, role: String) -> Result<(), String> {
    let (client, url, remote_id, token) = org_http(&state, org_id).await?;
    let remote_id = remote_id.ok_or_else(|| "org has no remote id".to_string())?;
    let res = client.patch(format!("{url}/api/orgs/{remote_id}/members/{user_id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "role": role }))
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn org_remove_member(state: State<'_, AppState>, org_id: i64, user_id: String) -> Result<(), String> {
    let (client, url, remote_id, token) = org_http(&state, org_id).await?;
    let remote_id = remote_id.ok_or_else(|| "org has no remote id".to_string())?;
    let res = client.delete(format!("{url}/api/orgs/{remote_id}/members/{user_id}"))
        .bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn org_invite_info(server_url: String, token: String) -> Result<serde_json::Value, String> {
    let url = normalize_server_url(&server_url);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(format!("{url}/api/orgs/invites/{token}"))
        .send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn org_redeem_invite(state: State<'_, AppState>, server_url: String, invite_token: String) -> Result<serde_json::Value, String> {
    let url = normalize_server_url(&server_url);
    let user = state.db.get_app_user()?.ok_or_else(|| "not authenticated".to_string())?;
    let token = user.session_token_ref.ok_or_else(|| "no session token".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.post(format!("{url}/api/orgs/invites/{invite_token}/redeem"))
        .bearer_auth(&token).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    res.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_org_remote_id(state: State<'_, AppState>, org_id: i64, remote_id: String) -> Result<(), String> {
    state.db.set_org_remote_id(org_id, &remote_id)
}

#[tauri::command]
pub async fn sync_org_plugins(state: State<'_, AppState>, org_id: Option<i64>) -> Result<Vec<RemotePluginManifest>, String> {
    use base64::Engine as _;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let id = match org_id {
        Some(id) => id,
        None => state.db.active_org_id()?,
    };
    let Some(org) = state.db.get_org(id)? else { return Err("org not found".into()) };
    let Some(url) = org.server_url else { return Ok(Vec::new()) };
    let base = url.trim_end_matches('/').to_string();

    let (client, _captured) = crate::tls::build_pinning_client(None, Duration::from_secs(8))?;

    // Fetch /health to obtain the signing pubkey.
    let health_res = client.get(format!("{base}/health")).send().await.map_err(|e| e.to_string())?;
    let pubkey_b64 = if health_res.status().is_success() {
        let body: serde_json::Value = health_res.json().await.map_err(|e| e.to_string())?;
        body.get("plugin_signing_pubkey_b64").and_then(|v| v.as_str()).map(|s| s.to_string())
    } else {
        None
    };
    let verifying_key: Option<VerifyingKey> = pubkey_b64
        .as_deref()
        .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
        .filter(|b| b.len() == 32)
        .and_then(|b| {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            VerifyingKey::from_bytes(&arr).ok()
        });

    // List plugins.
    let res = client.get(format!("{base}/api/plugins")).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    let mut manifests: Vec<RemotePluginManifest> = res.json().await.map_err(|e| e.to_string())?;

    if let Some(vk) = verifying_key {
        for m in manifests.iter_mut() {
            let canonical = canonical_manifest_json(m);
            let valid = m
                .signature_b64
                .as_deref()
                .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok())
                .filter(|b| b.len() == 64)
                .map(|b| {
                    let mut arr = [0u8; 64];
                    arr.copy_from_slice(&b);
                    Signature::from_bytes(&arr)
                })
                .map(|sig| vk.verify(canonical.as_bytes(), &sig).is_ok())
                .unwrap_or(false);
            m.signature_valid = Some(valid);
        }
    } else {
        for m in manifests.iter_mut() {
            m.signature_valid = None; // server provided no key — can't verify
        }
    }

    Ok(manifests)
}

/// Download + verify + install a remote plugin into the local plugins directory.
/// Refuses to proceed unless the manifest signature verifies against the org's
/// signing pubkey (from `/health`). After write, triggers a rescan.
#[tauri::command]
pub async fn install_org_plugin(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    org_id: Option<i64>,
    plugin_id: String,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};

    let id = match org_id {
        Some(id) => id,
        None => state.db.active_org_id()?,
    };
    let manifests = sync_org_plugins(state.clone(), Some(id)).await?;
    let manifest = manifests
        .into_iter()
        .find(|m| m.id == plugin_id)
        .ok_or_else(|| format!("plugin '{plugin_id}' not found on server"))?;

    if manifest.signature_valid != Some(true) {
        return Err("plugin signature is missing or invalid — refusing to install".into());
    }
    let download_url = manifest
        .download_url
        .as_deref()
        .ok_or_else(|| "manifest has no download_url".to_string())?;
    let expected_sha = manifest
        .checksum_sha256
        .as_deref()
        .ok_or_else(|| "manifest has no checksum_sha256".to_string())?;

    let org = state.db.get_org(id)?.ok_or_else(|| "org not found".to_string())?;
    let (client, _captured) =
        crate::tls::build_pinning_client(org.cert_fingerprint.clone(), Duration::from_secs(60))?;
    let bytes = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let actual_sha = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    if !actual_sha.eq_ignore_ascii_case(expected_sha) {
        return Err(format!(
            "checksum mismatch: expected {expected_sha} got {actual_sha}"
        ));
    }

    let plugins_dir = crate::db::Database::app_plugins_dir(&app)?;
    let target_dir = plugins_dir.join(&plugin_id);
    std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    let manifest_json = serde_json::to_vec_pretty(&serde_json::json!({
        "id": manifest.id,
        "name": manifest.name,
        "version": manifest.version,
        "checksum_sha256": manifest.checksum_sha256,
        "platforms": manifest.platforms,
    }))
    .map_err(|e| e.to_string())?;
    std::fs::write(target_dir.join("manifest.json"), manifest_json)
        .map_err(|e| e.to_string())?;
    // Bytes were downloaded base64-encoded? No — they are the raw binary.
    let binary_name = download_url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("plugin.bin");
    std::fs::write(target_dir.join(binary_name), &bytes).map_err(|e| e.to_string())?;

    state.plugins.rescan().await?;
    Ok(())
}

fn canonical_manifest_json(m: &RemotePluginManifest) -> String {
    let v = serde_json::json!({
        "checksum_sha256": m.checksum_sha256,
        "download_url": m.download_url,
        "id": m.id,
        "name": m.name,
        "platforms": m.platforms,
        "version": m.version,
    });
    v.to_string()
}
