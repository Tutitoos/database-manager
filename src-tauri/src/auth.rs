//! Auth surface after the passphrase removal pass.
//!
//! The legacy passphrase-wrapped master key is gone. What's left:
//! - OAuth flow (`auth_start_oauth` + `auth_complete_oauth`) for remote orgs.
//! - Synthetic local user materialization (`auth_create_local_user`) for the
//!   embedded local server.
//! - Sign out (`auth_sign_out`) + current user lookup helpers.
//! - Biometry availability probe + biometric bearer reload, both
//!   keychain-account-agnostic.
//! - Lightweight keychain diagnostic (`auth_keychain_diag`).
//!
//! All cryptographic wrapping moved server-side. The client just stores
//! bearer tokens (random for local, OAuth session for remote) in the
//! keychain when "remember me" is on.

use tauri::{AppHandle, State};

use crate::db::AppUserRecord;
use crate::keychain;

/// Account name used by the local-server bearer entry. Single per install.
const KEYCHAIN_ACCOUNT_LOCAL_BEARER: &str = "local-bearer";

#[derive(Clone, Default)]
pub struct AuthState;

impl AuthState {
    pub fn new() -> Self { Self }
}

#[tauri::command]
pub async fn auth_start_oauth(
    _app: AppHandle,
    provider: String,
    server_url: String,
) -> Result<String, String> {
    if !matches!(provider.as_str(), "discord" | "github" | "google" | "microsoft") {
        return Err(format!("unsupported provider: {provider}"));
    }
    let url = format!(
        "{}/api/auth/sign-in/{}?callbackURL=database-manager%3A%2F%2Fauth%2Fcallback",
        server_url.trim_end_matches('/'),
        provider
    );
    Ok(url)
}

#[tauri::command]
pub async fn auth_complete_oauth(
    state: State<'_, crate::AppState>,
    server_url: String,
    code: String,
    pinned: Option<String>,
) -> Result<AppUserRecord, String> {
    let (client, _captured) =
        crate::tls::build_pinning_client(pinned, std::time::Duration::from_secs(30))?;
    let res = client
        .post(format!(
            "{}/api/auth/exchange",
            server_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    let user: AppUserRecord = res.json().await.map_err(|e| e.to_string())?;
    state.db.upsert_app_user(&user)?;
    // Pin this OAuth identity to the active org so `get_app_user` resolves
    // back to it after a switch (multiple identities can coexist).
    if let Ok(org_id) = state.db.active_org_id() {
        let _ = state.db.set_org_user_link(org_id, &user.user_id, &user.email);
        // Also backfill the server-side org UUID into `organizations.remote_id`
        // so members / invites / plugin install can target the right path.
        // Server exposes `GET /api/orgs/me` returning the orgs this user
        // belongs to; we pick the first match (single-org self-host case).
        if let Ok(token) = user.session_token_ref.clone().ok_or("no token") {
            let me_res = client
                .get(format!("{}/api/orgs/me", server_url.trim_end_matches('/')))
                .bearer_auth(&token)
                .send()
                .await;
            if let Ok(r) = me_res {
                if r.status().is_success() {
                    if let Ok(body) = r.json::<serde_json::Value>().await {
                        let orgs = body
                            .get("orgs")
                            .or(Some(&body))
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        if let Some(first) = orgs.first() {
                            if let Some(rid) = first.get("id").and_then(|v| v.as_str()) {
                                let _ = state.db.set_org_remote_id(org_id, rid);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(user)
}

/// Materialize a synthetic `app_user` row for the local server. Called from
/// WelcomePage after the bearer token is generated. Keeps the rest of the
/// app (sidebar UserMenu, currentUser checks, org_http auth) functioning
/// without an OAuth flow.
#[tauri::command]
pub fn auth_create_local_user(
    state: State<'_, crate::AppState>,
    token: String,
) -> Result<(), String> {
    state.db.upsert_app_user(&crate::db::AppUserRecord {
        user_id: "__local__".into(),
        email: "local@dbm.local".into(),
        name: Some("Local".into()),
        avatar_url: None,
        linked_providers: "[]".into(),
        master_key_enc_blob: None,
        session_token_ref: Some(token),
        last_synced_at: None,
    })?;
    Ok(())
}

#[tauri::command]
pub fn auth_sign_out(state: State<'_, crate::AppState>) -> Result<(), String> {
    state.db.clear_app_user()?;
    Ok(())
}

/// Wipe the locally cached bearer + clear app_user. Used by Settings →
/// Security → "Sign out and forget local bearer".
#[tauri::command]
pub fn auth_forget_device(state: State<'_, crate::AppState>) -> Result<(), String> {
    keychain::delete(KEYCHAIN_ACCOUNT_LOCAL_BEARER);
    let _ = state.db.delete_app_setting("local.admin_token");
    state.db.clear_app_user()?;
    Ok(())
}

#[tauri::command]
pub fn auth_biometry_supported() -> bool {
    keychain::biometry_supported()
}

/// Optional biometric reload of the locally-stored bearer. Used when the
/// user opted into the macOS Touch ID gate at the keychain ACL level. We
/// prompt LAContext first, then re-read the entry (the OS may still ask
/// again depending on policy).
#[tauri::command]
pub async fn auth_load_bearer_biometric() -> Result<bool, String> {
    let ok = tokio::task::spawn_blocking(|| {
        crate::biometry::evaluate("Unlock Database Manager")
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(ok)
}

