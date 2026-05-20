//! Org-scoped connection CRUD. Replaces the client-side connections table.
//!
//! Auth: session bearer (remote) or admin bearer (local). RBAC: viewer
//! cannot mutate. Passwords stored encrypted via `crypto::encrypt`; clients
//! receive them plain (TLS protects the wire).

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
pub struct ConnectionRow {
    pub id: i64,
    pub org_id: String,
    pub name: String,
    pub plugin_id: String,
    pub host: String,
    pub port: i64,
    pub database: String,
    pub username: String,
    pub password: Option<String>, // decrypted on read
    pub ssl_mode: Option<String>,
    pub settings_json: String,
    pub group_id: Option<i64>,
    pub enabled: bool,
    pub position: i64,
    pub credential_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConnectionInput {
    pub name: String,
    pub plugin_id: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: i64,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub username: String,
    pub password: Option<String>,
    pub ssl_mode: Option<String>,
    #[serde(default = "default_settings")]
    pub settings_json: String,
    pub group_id: Option<i64>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub position: i64,
    pub credential_id: Option<i64>,
}

fn default_settings() -> String { "{}".into() }
fn default_true() -> bool { true }

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
) -> Result<Json<Vec<ConnectionRow>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    let rows = state
        .store
        .list_org_connections(&q.org_id)
        .map_err(internal)?;
    Ok(Json(rows.into_iter().map(decrypt_row).collect()))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<ConnectionRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let row = state
        .store
        .get_org_connection(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_member(&state, &row.org_id, &user_id)?;
    Ok(Json(decrypt_row(row)))
}

async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
    Json(input): Json<ConnectionInput>,
) -> Result<Json<ConnectionRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_writer(&state, &q.org_id, &user_id)?;
    let enc = input
        .password
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(crypto::encrypt)
        .transpose()
        .map_err(internal)?;
    let row = state
        .store
        .create_org_connection(&q.org_id, &input, enc.as_deref())
        .map_err(internal)?;
    Ok(Json(decrypt_row(row)))
}

async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<ConnectionInput>,
) -> Result<Json<ConnectionRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_connection(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    let enc = input
        .password
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(crypto::encrypt)
        .transpose()
        .map_err(internal)?;
    let row = state
        .store
        .update_org_connection(id, &input, enc.as_deref())
        .map_err(internal)?;
    Ok(Json(decrypt_row(row)))
}

async fn delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_connection(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    state.store.delete_org_connection(id).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

fn decrypt_row(mut row: ConnectionRow) -> ConnectionRow {
    if let Some(enc) = row.password.take() {
        row.password = crypto::decrypt(&enc).ok();
    }
    row
}

fn require_member(state: &AppState, org_id: &str, user_id: &str) -> Result<(), (StatusCode, String)> {
    state
        .store
        .get_member_role(org_id, user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    Ok(())
}

fn require_writer(state: &AppState, org_id: &str, user_id: &str) -> Result<(), (StatusCode, String)> {
    let role = state
        .store
        .get_member_role(org_id, user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    if role == "viewer" {
        return Err((StatusCode::FORBIDDEN, "viewer cannot mutate".into()));
    }
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

// ===== Store impl pieces (live in db.rs but referenced from here) =====

impl crate::db::Store {
    pub fn list_org_connections(&self, org_id: &str) -> Result<Vec<ConnectionRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, org_id, name, plugin_id, host, port, database_name, username,
                    password_enc, ssl_mode, settings_json, group_id, enabled, position,
                    credential_id, created_at, updated_at
             FROM org_connections WHERE org_id = ?1 ORDER BY position ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![org_id], map_connection)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn get_org_connection(&self, id: i64) -> Result<Option<ConnectionRow>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, org_id, name, plugin_id, host, port, database_name, username,
                    password_enc, ssl_mode, settings_json, group_id, enabled, position,
                    credential_id, created_at, updated_at
             FROM org_connections WHERE id = ?1",
            params![id],
            map_connection,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn create_org_connection(
        &self,
        org_id: &str,
        input: &ConnectionInput,
        password_enc: Option<&str>,
    ) -> Result<ConnectionRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO org_connections (org_id, name, plugin_id, host, port, database_name,
                username, password_enc, ssl_mode, settings_json, group_id, enabled, position,
                credential_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![
                org_id, input.name, input.plugin_id, input.host, input.port,
                input.database, input.username, password_enc, input.ssl_mode,
                input.settings_json, input.group_id, if input.enabled { 1 } else { 0 },
                input.position, input.credential_id, now,
            ],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_org_connection(id)?
            .ok_or_else(|| anyhow::anyhow!("created row vanished"))
    }

    pub fn update_org_connection(
        &self,
        id: i64,
        input: &ConnectionInput,
        password_enc: Option<&str>,
    ) -> Result<ConnectionRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "UPDATE org_connections SET name = ?1, plugin_id = ?2, host = ?3, port = ?4,
                database_name = ?5, username = ?6,
                password_enc = COALESCE(?7, password_enc),
                ssl_mode = ?8, settings_json = ?9, group_id = ?10, enabled = ?11,
                position = ?12, credential_id = ?13, updated_at = ?14
             WHERE id = ?15",
            params![
                input.name, input.plugin_id, input.host, input.port, input.database,
                input.username, password_enc, input.ssl_mode, input.settings_json,
                input.group_id, if input.enabled { 1 } else { 0 }, input.position,
                input.credential_id, now, id,
            ],
        )?;
        drop(conn);
        self.get_org_connection(id)?
            .ok_or_else(|| anyhow::anyhow!("row vanished after update"))
    }

    pub fn delete_org_connection(&self, id: i64) -> Result<()> {
        self.lock()
            .execute("DELETE FROM org_connections WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn map_connection(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionRow> {
    Ok(ConnectionRow {
        id: row.get(0)?,
        org_id: row.get(1)?,
        name: row.get(2)?,
        plugin_id: row.get(3)?,
        host: row.get(4)?,
        port: row.get(5)?,
        database: row.get(6)?,
        username: row.get(7)?,
        password: row.get(8)?,
        ssl_mode: row.get(9)?,
        settings_json: row.get(10)?,
        group_id: row.get(11)?,
        enabled: row.get::<_, i64>(12)? == 1,
        position: row.get(13)?,
        credential_id: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}
