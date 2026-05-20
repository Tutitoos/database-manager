//! Per-org plugin enablement registry. Admins enable/disable plugins for
//! their org; clients reflect the state. The actual binary catalog lives in
//! `plugins.rs` (manifest store + signing).

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
pub struct InstalledRow {
    pub org_id: String,
    pub plugin_id: String,
    pub enabled: bool,
    pub settings_json: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstalledInput {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_settings")]
    pub settings_json: String,
}

fn default_true() -> bool { true }
fn default_settings() -> String { "{}".into() }

#[derive(Debug, Deserialize)]
pub struct OrgQuery {
    pub org_id: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list))
        .route("/:plugin_id", get(get_one).put(upsert).delete(delete_one))
}

async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<OrgQuery>,
) -> Result<Json<Vec<InstalledRow>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    Ok(Json(state.store.list_installed_plugins(&q.org_id).map_err(internal)?))
}

async fn get_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    Query(q): Query<OrgQuery>,
) -> Result<Json<InstalledRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_member(&state, &q.org_id, &user_id)?;
    let row = state
        .store
        .get_installed_plugin(&q.org_id, &plugin_id)
        .map_err(internal)?
        .ok_or((StatusCode::NOT_FOUND, "not installed".into()))?;
    Ok(Json(row))
}

async fn upsert(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    Query(q): Query<OrgQuery>,
    Json(input): Json<InstalledInput>,
) -> Result<Json<InstalledRow>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_admin(&state, &q.org_id, &user_id)?;
    Ok(Json(state
        .store
        .upsert_installed_plugin(&q.org_id, &plugin_id, &input)
        .map_err(internal)?))
}

async fn delete_one(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(plugin_id): Path<String>,
    Query(q): Query<OrgQuery>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    require_admin(&state, &q.org_id, &user_id)?;
    state
        .store
        .delete_installed_plugin(&q.org_id, &plugin_id)
        .map_err(internal)?;
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

fn require_admin(state: &AppState, org_id: &str, user_id: &str) -> Result<(), (StatusCode, String)> {
    let role = state
        .store
        .get_member_role(org_id, user_id)
        .map_err(internal)?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    if role != "owner" && role != "admin" {
        return Err((StatusCode::FORBIDDEN, "admin required".into()));
    }
    Ok(())
}

fn internal<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

impl crate::db::Store {
    pub fn list_installed_plugins(&self, org_id: &str) -> Result<Vec<InstalledRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT org_id, plugin_id, enabled, settings_json, installed_at
             FROM org_plugins_installed WHERE org_id = ?1 ORDER BY plugin_id ASC",
        )?;
        let rows = stmt.query_map(params![org_id], map_installed)?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn get_installed_plugin(&self, org_id: &str, plugin_id: &str) -> Result<Option<InstalledRow>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT org_id, plugin_id, enabled, settings_json, installed_at
             FROM org_plugins_installed WHERE org_id = ?1 AND plugin_id = ?2",
            params![org_id, plugin_id],
            map_installed,
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn upsert_installed_plugin(
        &self,
        org_id: &str,
        plugin_id: &str,
        input: &InstalledInput,
    ) -> Result<InstalledRow> {
        let now = Utc::now().to_rfc3339();
        self.lock().execute(
            "INSERT INTO org_plugins_installed (org_id, plugin_id, enabled, settings_json, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(org_id, plugin_id) DO UPDATE SET
                enabled = excluded.enabled,
                settings_json = excluded.settings_json",
            params![
                org_id, plugin_id, if input.enabled { 1 } else { 0 },
                input.settings_json, now,
            ],
        )?;
        Ok(InstalledRow {
            org_id: org_id.into(),
            plugin_id: plugin_id.into(),
            enabled: input.enabled,
            settings_json: input.settings_json.clone(),
            installed_at: now,
        })
    }

    pub fn delete_installed_plugin(&self, org_id: &str, plugin_id: &str) -> Result<()> {
        self.lock().execute(
            "DELETE FROM org_plugins_installed WHERE org_id = ?1 AND plugin_id = ?2",
            params![org_id, plugin_id],
        )?;
        Ok(())
    }
}

fn map_installed(row: &rusqlite::Row<'_>) -> rusqlite::Result<InstalledRow> {
    Ok(InstalledRow {
        org_id: row.get(0)?,
        plugin_id: row.get(1)?,
        enabled: row.get::<_, i64>(2)? == 1,
        settings_json: row.get(3)?,
        installed_at: row.get(4)?,
    })
}
