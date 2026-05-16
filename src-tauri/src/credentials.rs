use serde::{Deserialize, Serialize};
use tauri::State;

use crate::auth::{decrypt_password, encrypt_password};
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialView {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptedCredential {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub password: String,
}

fn context_for(id: i64) -> String {
    format!("credential.v1.{id}")
}

fn placeholder_context() -> &'static str {
    "credential.v1.new"
}

#[tauri::command]
pub fn list_credentials_view(state: State<'_, AppState>) -> Result<Vec<CredentialView>, String> {
    Ok(state
        .db
        .list_credentials()?
        .into_iter()
        .map(|c| CredentialView {
            id: c.id,
            name: c.name,
            username: c.username,
            created_at: c.created_at,
            updated_at: c.updated_at,
        })
        .collect())
}

#[tauri::command]
pub fn create_credential(
    state: State<'_, AppState>,
    name: String,
    username: String,
    password: String,
) -> Result<CredentialView, String> {
    let enc = encrypt_password(&state.auth.vault, placeholder_context(), &password)?;
    let rec = state.db.create_credential(&name, &username, &enc, "{}")?;
    // Re-encrypt under the real per-record context now that we have the id.
    let pt = decrypt_password(&state.auth.vault, placeholder_context(), &rec.encrypted_password)?;
    let final_enc = encrypt_password(&state.auth.vault, &context_for(rec.id), &pt)?;
    let updated = state
        .db
        .update_credential(rec.id, &rec.name, &rec.username, Some(&final_enc), None)?;
    Ok(CredentialView {
        id: updated.id,
        name: updated.name,
        username: updated.username,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
    })
}

#[tauri::command]
pub fn update_credential(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    username: String,
    password: Option<String>,
) -> Result<CredentialView, String> {
    let encrypted = if let Some(pw) = password {
        Some(encrypt_password(&state.auth.vault, &context_for(id), &pw)?)
    } else {
        None
    };
    let rec =
        state
            .db
            .update_credential(id, &name, &username, encrypted.as_deref(), None)?;
    Ok(CredentialView {
        id: rec.id,
        name: rec.name,
        username: rec.username,
        created_at: rec.created_at,
        updated_at: rec.updated_at,
    })
}

#[tauri::command]
pub fn delete_credential(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.delete_credential(id)
}

#[tauri::command]
pub fn decrypt_credential(
    state: State<'_, AppState>,
    id: i64,
) -> Result<DecryptedCredential, String> {
    let rec = state.db.get_credential(id)?;
    let password = decrypt_password(&state.auth.vault, &context_for(rec.id), &rec.encrypted_password)?;
    Ok(DecryptedCredential {
        id: rec.id,
        name: rec.name,
        username: rec.username,
        password,
    })
}

pub fn resolve_credential_for_connection(
    state: &AppState,
    credential_id: Option<i64>,
) -> Result<Option<(String, String)>, String> {
    let Some(id) = credential_id else {
        return Ok(None);
    };
    let rec = state.db.get_credential(id)?;
    let password = decrypt_password(&state.auth.vault, &context_for(rec.id), &rec.encrypted_password)?;
    Ok(Some((rec.username, password)))
}

pub fn materialize(
    state: &AppState,
    mut input: crate::db::ConnectionInput,
) -> Result<crate::db::ConnectionInput, String> {
    if let Some((username, password)) = resolve_credential_for_connection(state, input.credential_id)? {
        input.username = username;
        input.password = password;
    }
    Ok(input)
}
