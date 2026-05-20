//! Org-scoped workspace snapshots (open tabs + filters). One row per
//! (org_id, user_id). PUT replaces the entire snapshot; GET reads it.
//! Conflict resolution: last-write-wins (timestamp from server).

use std::sync::Arc;

use anyhow::Result;
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::auth::require_auth;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceRow {
    pub org_id: String,
    pub user_id: String,
    pub snapshot_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceInput {
    pub snapshot_json: String,
}

#[derive(Debug, Deserialize)]
pub struct OrgQuery {
    pub org_id: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(read).put(write))
}

async fn read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Option<WorkspaceRow>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    Ok(Json(state.store.get_workspace(&q.org_id, &user_id).map_err(internal)?))
}

async fn write(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
    Json(input): Json<WorkspaceInput>,
) -> Result<Json<WorkspaceRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    Ok(Json(state
        .store
        .upsert_workspace(&q.org_id, &user_id, &input.snapshot_json)
        .map_err(internal)?))
}

fn require_member(state: &AppState, org_id: &str, user_id: &str) -> Result<(), (StatusCode, String)> {
    state
        .store
        .get_member_role(org_id, user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

impl crate::db::Store {
    pub fn get_workspace(&self, org_id: &str, user_id: &str) -> Result<Option<WorkspaceRow>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT org_id, user_id, snapshot_json, updated_at FROM org_workspace_sessions
             WHERE org_id = ?1 AND user_id = ?2",
            params![org_id, user_id],
            |row| Ok(WorkspaceRow {
                org_id: row.get(0)?,
                user_id: row.get(1)?,
                snapshot_json: row.get(2)?,
                updated_at: row.get(3)?,
            }),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn upsert_workspace(
        &self,
        org_id: &str,
        user_id: &str,
        snapshot_json: &str,
    ) -> Result<WorkspaceRow> {
        let now = Utc::now().to_rfc3339();
        self.lock().execute(
            "INSERT INTO org_workspace_sessions (org_id, user_id, snapshot_json, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(org_id, user_id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json,
                updated_at = excluded.updated_at",
            params![org_id, user_id, snapshot_json, now],
        )?;
        Ok(WorkspaceRow {
            org_id: org_id.into(),
            user_id: user_id.into(),
            snapshot_json: snapshot_json.into(),
            updated_at: now,
        })
    }
}
