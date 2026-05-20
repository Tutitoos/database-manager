//! Org-scoped connection groups (workspaces in the sidebar UI). Replaces
//! the client-side `connection_groups` table.

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
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRow {
    pub id: i64,
    pub org_id: String,
    pub name: String,
    pub color: Option<String>,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GroupInput {
    pub name: String,
    pub color: Option<String>,
    #[serde(default)]
    pub position: i64,
}

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
) -> Result<Json<Vec<GroupRow>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    Ok(Json(state.store.list_org_groups(&q.org_id).map_err(internal)?))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<GroupRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let row = state
        .store
        .get_org_group(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_member(&state, &row.org_id, &user_id)?;
    Ok(Json(row))
}

async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
    Json(input): Json<GroupInput>,
) -> Result<Json<GroupRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_writer(&state, &q.org_id, &user_id)?;
    Ok(Json(state.store.create_org_group(&q.org_id, &input).map_err(internal)?))
}

async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(input): Json<GroupInput>,
) -> Result<Json<GroupRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_group(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    Ok(Json(state.store.update_org_group(id, &input).map_err(internal)?))
}

async fn delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let existing = state
        .store
        .get_org_group(id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not found".into()))?;
    require_writer(&state, &existing.org_id, &user_id)?;
    state.store.delete_org_group(id).map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
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

impl crate::db::Store {
    pub fn list_org_groups(&self, org_id: &str) -> Result<Vec<GroupRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, org_id, name, color, position, created_at, updated_at
             FROM org_groups WHERE org_id = ?1 ORDER BY position ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![org_id], map_group)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn get_org_group(&self, id: i64) -> Result<Option<GroupRow>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, org_id, name, color, position, created_at, updated_at FROM org_groups WHERE id = ?1",
            params![id],
            map_group,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn create_org_group(&self, org_id: &str, input: &GroupInput) -> Result<GroupRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO org_groups (org_id, name, color, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![org_id, input.name, input.color, input.position, now],
        )?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_org_group(id)?
            .ok_or_else(|| anyhow::anyhow!("created row vanished"))
    }

    pub fn update_org_group(&self, id: i64, input: &GroupInput) -> Result<GroupRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "UPDATE org_groups SET name = ?1, color = ?2, position = ?3, updated_at = ?4 WHERE id = ?5",
            params![input.name, input.color, input.position, now, id],
        )?;
        drop(conn);
        self.get_org_group(id)?
            .ok_or_else(|| anyhow::anyhow!("row vanished after update"))
    }

    pub fn delete_org_group(&self, id: i64) -> Result<()> {
        self.lock().execute("DELETE FROM org_groups WHERE id = ?1", params![id])?;
        Ok(())
    }
}

fn map_group(row: &rusqlite::Row<'_>) -> rusqlite::Result<GroupRow> {
    Ok(GroupRow {
        id: row.get(0)?,
        org_id: row.get(1)?,
        name: row.get(2)?,
        color: row.get(3)?,
        position: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
