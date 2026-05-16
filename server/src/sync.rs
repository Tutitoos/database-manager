use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::require_auth;
use crate::db::SyncEnvelope;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/push", post(push))
        .route("/pull", get(pull))
}

#[derive(Deserialize)]
struct PushBody {
    envelopes: Vec<SyncEnvelope>,
}

#[derive(Serialize)]
struct PushResponse {
    ok: bool,
    server_now: String,
}

async fn push(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<PushBody>,
) -> Result<Json<PushResponse>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let now = state
        .store
        .sync_push(&user_id, &body.envelopes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(PushResponse {
        ok: true,
        server_now: now,
    }))
}

#[derive(Deserialize)]
struct PullQuery {
    since: Option<String>,
}

#[derive(Serialize)]
struct PullResponse {
    envelopes: Vec<SyncEnvelope>,
    server_now: String,
}

async fn pull(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<PullQuery>,
) -> Result<Json<PullResponse>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let (envelopes, server_now) = state
        .store
        .sync_pull(&user_id, q.since.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(PullResponse {
        envelopes,
        server_now,
    }))
}
