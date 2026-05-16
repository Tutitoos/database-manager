use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::crypto::{
    self, derive_key_from_passphrase, encrypt_b64, random_master_key, salt_from_b64,
    wrap_master_key, KeyVault, MasterKey,
};
use crate::db::{AppUserRecord, Database};

const KEYRING_SERVICE: &str = "com.gtrave.database-manager";
const KEYRING_USER: &str = "master-key";
const APP_SETTING_SALT: &str = "auth.passphrase_salt";
const APP_SETTING_WRAPPED: &str = "auth.master_key_wrapped";

#[derive(Clone)]
pub struct AuthState {
    pub vault: KeyVault,
}

impl AuthState {
    pub fn new() -> Self {
        Self {
            vault: KeyVault::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PassphraseStatus {
    pub configured: bool,
    pub unlocked: bool,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn try_load_master_key_from_os(db: &Database) -> Option<MasterKey> {
    let entry = keyring_entry().ok()?;
    let pw = entry.get_password().ok()?;
    let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &pw).ok()?;
    if bytes.len() != crypto::MASTER_KEY_LEN {
        return None;
    }
    let mut mk = [0u8; crypto::MASTER_KEY_LEN];
    mk.copy_from_slice(&bytes);
    let _ = db;
    Some(MasterKey(mk))
}

fn store_master_key_in_os(mk: &MasterKey) -> Result<(), String> {
    let entry = keyring_entry()?;
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, mk.0);
    entry.set_password(&b64).map_err(|e| e.to_string())
}

fn clear_master_key_from_os() {
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
}

#[tauri::command]
pub fn auth_passphrase_status(
    state: State<'_, crate::AppState>,
) -> Result<PassphraseStatus, String> {
    let configured = state.db.get_app_setting(APP_SETTING_WRAPPED)?.is_some();
    let mut unlocked = state.auth.vault.is_unlocked();
    if !unlocked && configured {
        if let Some(mk) = try_load_master_key_from_os(&state.db) {
            state.auth.vault.set(mk);
            unlocked = true;
        }
    }
    Ok(PassphraseStatus {
        configured,
        unlocked,
    })
}

#[tauri::command]
pub fn auth_set_passphrase(
    state: State<'_, crate::AppState>,
    passphrase: String,
) -> Result<(), String> {
    if passphrase.len() < 8 {
        return Err("passphrase must be at least 8 characters".to_string());
    }
    let salt = crypto::random_salt();
    let mk = random_master_key();
    let derived = derive_key_from_passphrase(&passphrase, &salt_from_b64(&salt)?)?;
    let wrapped = wrap_master_key(&mk, &derived)?;
    state.db.set_app_setting(APP_SETTING_SALT, &serde_json::Value::String(salt).to_string())?;
    state
        .db
        .set_app_setting(APP_SETTING_WRAPPED, &serde_json::Value::String(wrapped).to_string())?;
    let _ = store_master_key_in_os(&mk);
    state.auth.vault.set(mk);
    Ok(())
}

#[tauri::command]
pub fn auth_unlock(
    state: State<'_, crate::AppState>,
    passphrase: String,
) -> Result<(), String> {
    let salt_json = state
        .db
        .get_app_setting(APP_SETTING_SALT)?
        .ok_or_else(|| "passphrase not configured".to_string())?;
    let wrapped_json = state
        .db
        .get_app_setting(APP_SETTING_WRAPPED)?
        .ok_or_else(|| "passphrase not configured".to_string())?;
    let salt: String = serde_json::from_str(&salt_json).map_err(|e| e.to_string())?;
    let wrapped: String = serde_json::from_str(&wrapped_json).map_err(|e| e.to_string())?;
    let derived = derive_key_from_passphrase(&passphrase, &salt_from_b64(&salt)?)?;
    let mk = crypto::unwrap_master_key(&wrapped, &derived)?;
    let _ = store_master_key_in_os(&mk);
    state.auth.vault.set(mk);
    Ok(())
}

#[tauri::command]
pub fn auth_lock(state: State<'_, crate::AppState>) -> Result<(), String> {
    state.auth.vault.clear();
    clear_master_key_from_os();
    Ok(())
}

#[tauri::command]
pub fn auth_change_passphrase(
    state: State<'_, crate::AppState>,
    old_passphrase: String,
    new_passphrase: String,
) -> Result<(), String> {
    if new_passphrase.len() < 8 {
        return Err("new passphrase must be at least 8 characters".to_string());
    }
    let salt_json = state
        .db
        .get_app_setting(APP_SETTING_SALT)?
        .ok_or_else(|| "passphrase not configured".to_string())?;
    let wrapped_json = state
        .db
        .get_app_setting(APP_SETTING_WRAPPED)?
        .ok_or_else(|| "passphrase not configured".to_string())?;
    let salt: String = serde_json::from_str(&salt_json).map_err(|e| e.to_string())?;
    let wrapped: String = serde_json::from_str(&wrapped_json).map_err(|e| e.to_string())?;
    let old_derived = derive_key_from_passphrase(&old_passphrase, &salt_from_b64(&salt)?)?;
    let mk = crypto::unwrap_master_key(&wrapped, &old_derived)?;
    let new_salt = crypto::random_salt();
    let new_derived = derive_key_from_passphrase(&new_passphrase, &salt_from_b64(&new_salt)?)?;
    let new_wrapped = wrap_master_key(&mk, &new_derived)?;
    state
        .db
        .set_app_setting(APP_SETTING_SALT, &serde_json::Value::String(new_salt).to_string())?;
    state.db.set_app_setting(
        APP_SETTING_WRAPPED,
        &serde_json::Value::String(new_wrapped).to_string(),
    )?;
    let _ = store_master_key_in_os(&mk);
    state.auth.vault.set(mk);
    Ok(())
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
) -> Result<AppUserRecord, String> {
    let client = reqwest::Client::new();
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
    Ok(user)
}

#[tauri::command]
pub fn auth_sign_out(state: State<'_, crate::AppState>) -> Result<(), String> {
    state.db.clear_app_user()?;
    Ok(())
}

pub fn encrypt_password(
    vault: &KeyVault,
    record_context: &str,
    plaintext: &str,
) -> Result<String, String> {
    let mk = vault
        .get()
        .ok_or_else(|| "vault is locked".to_string())?;
    encrypt_b64(&mk, record_context, plaintext.as_bytes())
}

pub fn decrypt_password(
    vault: &KeyVault,
    record_context: &str,
    ciphertext: &str,
) -> Result<String, String> {
    let mk = vault
        .get()
        .ok_or_else(|| "vault is locked".to_string())?;
    let pt = crypto::decrypt_b64(&mk, record_context, ciphertext)?;
    String::from_utf8(pt).map_err(|e| e.to_string())
}

