//! Org-scoped credential store. Replaces the client-side `credentials` table.
//! Secret value is encrypted at rest via `crypto::encrypt`; clients receive
//! plaintext (TLS protects the wire).

use std::sync::Arc;

use anyhow::Result;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::auth::require_auth;
use crate::crypto;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRow {
    pub id: i64,
    pub org_id: String,
    pub name: String,
    pub kind: String,
    pub username: Option<String>,
    pub secret: Option<String>, // decrypted on read
    pub metadata_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredentialInput {
    pub name: String,
    pub kind: String,
    pub username: Option<String>,
    pub secret: Option<String>,
    #[serde(default = "default_meta")]
    pub metadata_json: String,
}

fn default_meta() -> String { "{}".into() }

#[derive(Debug, Deserialize)]
pub struct OrgQuery {
    pub org_id: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/:id", get(get_one).patch(update).delete(delete_one))
}

async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Vec<CredentialRow>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let role = require_member(&state, &q.org_id, &user_id)?;
    let rows = state.store.list_org_credentials(&q.org_id).map_err(internal)?;
    // Viewers see metadata but not the decrypted secret.
    let rows = rows.into_iter().map(|r| decrypt_row(r, &role)).collect();
    Ok(Json(rows))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<CredentialRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let row = state
        .store
        .get_org_credential(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    let role = require_member(&state, &row.org_id, &user_id)?;
    Ok(Json(decrypt_row(row, &role)))
}

async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
    Json(input): Json<CredentialInput>,
) -> Result<Json<CredentialRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_writer(&state, &q.org_id, &user_id)?;
    let enc = input
        .secret
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(crypto::encrypt)
        .transpose()
        .map_err(internal)?;
    let row = state
        .store
        .create_org_credential(&q.org_id, &input, enc.as_deref())
        .map_err(internal)?;
    Ok(Json(decrypt_row(row, "member")))
}

async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<CredentialInput>,
) -> Result<Json<CredentialRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_credential(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    let enc = input
        .secret
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(crypto::encrypt)
        .transpose()
        .map_err(internal)?;
    let row = state
        .store
        .update_org_credential(id, &input, enc.as_deref())
        .map_err(internal)?;
    Ok(Json(decrypt_row(row, "member")))
}

async fn delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_credential(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    state.store.delete_org_credential(id).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Decrypt `secret` only for non-viewer roles. Viewers see metadata + null secret.
fn decrypt_row(mut row: CredentialRow, role: &str) -> CredentialRow {
    if role == "viewer" {
        row.secret = None;
        return row;
    }
    if let Some(enc) = row.secret.take() {
        row.secret = crypto::decrypt(&enc).ok();
    }
    row
}

fn require_member(state: &AppState, org_id: &str, user_id: &str) -> Result<String, (StatusCode, String)> {
    state
        .store
        .get_member_role(org_id, user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))
}

fn require_writer(state: &AppState, org_id: &str, user_id: &str) -> Result<(), (StatusCode, String)> {
    let role = require_member(state, org_id, user_id)?;
    if role == "viewer" {
        return Err((StatusCode::FORBIDDEN, "viewer cannot mutate".into()));
    }
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

impl crate::db::Store {
    pub fn list_org_credentials(&self, org_id: &str) -> Result<Vec<CredentialRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, org_id, name, kind, username, secret_enc, metadata_json, created_at, updated_at
             FROM org_credentials WHERE org_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![org_id], map_cred)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn get_org_credential(&self, id: i64) -> Result<Option<CredentialRow>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, org_id, name, kind, username, secret_enc, metadata_json, created_at, updated_at
             FROM org_credentials WHERE id = ?1",
            params![id],
            map_cred,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn create_org_credential(
        &self,
        org_id: &str,
        input: &CredentialInput,
        secret_enc: Option<&str>,
    ) -> Result<CredentialRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO org_credentials (org_id, name, kind, username, secret_enc, metadata_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                org_id, input.name, input.kind, input.username, secret_enc,
                input.metadata_json, now,
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_org_credential(id)?
            .ok_or_else(|| anyhow::anyhow!("created row vanished"))
    }

    pub fn update_org_credential(
        &self,
        id: i64,
        input: &CredentialInput,
        secret_enc: Option<&str>,
    ) -> Result<CredentialRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "UPDATE org_credentials SET name = ?1, kind = ?2, username = ?3,
                secret_enc = COALESCE(?4, secret_enc), metadata_json = ?5, updated_at = ?6
             WHERE id = ?7",
            params![
                input.name, input.kind, input.username, secret_enc,
                input.metadata_json, now, id,
            ],
        )?;
        drop(conn);
        self.get_org_credential(id)?
            .ok_or_else(|| anyhow::anyhow!("row vanished after update"))
    }

    pub fn delete_org_credential(&self, id: i64) -> Result<()> {
        self.lock()
            .execute("DELETE FROM org_credentials WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn map_cred(row: &rusqlite::Row<'_>) -> rusqlite::Result<CredentialRow> {
    Ok(CredentialRow {
        id: row.get(0)?,
        org_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        username: row.get(4)?,
        secret: row.get(5)?,
        metadata_json: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}
