//! Server-first credential commands. The client no longer encrypts/stores
//! credentials locally — the active org's server is the source of truth and
//! handles at-rest encryption (AES-GCM, transparent over TLS).
//!
//! `materialize()` still resolves a `credential_id` on a `ConnectionInput`
//! into `(username, password)` before handing the input to a plugin runtime;
//! it just fetches via HTTP now instead of the local vault.

use serde::{Deserialize, Serialize};
use tauri::State;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ServerCredential {
    id: i64,
    org_id: String,
    name: String,
    kind: String,
    username: Option<String>,
    secret: Option<String>,
    metadata_json: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct CredentialInputPayload<'a> {
    name: &'a str,
    kind: &'a str,
    username: Option<&'a str>,
    secret: Option<&'a str>,
    metadata_json: &'a str,
}

#[tauri::command]
pub async fn list_credentials_view(
    state: State<'_, AppState>,
) -> Result<Vec<CredentialView>, String> {
    let rows: Vec<ServerCredential> = crate::commands::proxy_get(&state, "/api/credentials").await?;
    Ok(rows.into_iter().map(into_view).collect())
}

#[tauri::command]
pub async fn create_credential(
    state: State<'_, AppState>,
    name: String,
    username: String,
    password: String,
) -> Result<CredentialView, String> {
    let payload = CredentialInputPayload {
        name: &name,
        kind: "password",
        username: Some(username.as_str()),
        secret: Some(password.as_str()),
        metadata_json: "{}",
    };
    let row: ServerCredential =
        crate::commands::proxy_send(&state, reqwest::Method::POST, "/api/credentials", Some(&payload))
            .await?;
    Ok(into_view(row))
}

#[tauri::command]
pub async fn update_credential(
    state: State<'_, AppState>,
    id: i64,
    name: String,
    username: String,
    password: Option<String>,
) -> Result<CredentialView, String> {
    let payload = CredentialInputPayload {
        name: &name,
        kind: "password",
        username: Some(username.as_str()),
        secret: password.as_deref(),
        metadata_json: "{}",
    };
    let row: ServerCredential = crate::commands::proxy_send(
        &state,
        reqwest::Method::PATCH,
        &format!("/api/credentials/{id}"),
        Some(&payload),
    )
    .await?;
    Ok(into_view(row))
}

#[tauri::command]
pub async fn delete_credential(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    crate::commands::proxy_delete(&state, &format!("/api/credentials/{id}")).await
}

#[tauri::command]
pub async fn decrypt_credential(
    state: State<'_, AppState>,
    id: i64,
) -> Result<DecryptedCredential, String> {
    let row: ServerCredential =
        crate::commands::proxy_get(&state, &format!("/api/credentials/{id}")).await?;
    Ok(DecryptedCredential {
        id: row.id,
        name: row.name,
        username: row.username.clone().unwrap_or_default(),
        password: row.secret.clone().unwrap_or_default(),
    })
}

fn into_view(row: ServerCredential) -> CredentialView {
    CredentialView {
        id: row.id,
        name: row.name,
        username: row.username.unwrap_or_default(),
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

pub async fn resolve_credential_for_connection(
    state: &AppState,
    credential_id: Option<i64>,
) -> Result<Option<(String, String)>, String> {
    let Some(id) = credential_id else {
        return Ok(None);
    };
    let row: ServerCredential =
        crate::commands::proxy_get(state, &format!("/api/credentials/{id}")).await?;
    Ok(Some((row.username.unwrap_or_default(), row.secret.unwrap_or_default())))
}

pub async fn materialize(
    state: &AppState,
    mut input: crate::db::ConnectionInput,
) -> Result<crate::db::ConnectionInput, String> {
    if let Some((username, password)) =
        resolve_credential_for_connection(state, input.credential_id).await?
    {
        input.username = username;
        input.password = password;
    }
    Ok(input)
}
