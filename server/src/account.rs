use std::sync::Arc;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::{require_auth, sign_out};
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/me", get(me))
        .route("/master-key", get(get_master_key).post(set_master_key))
        .route("/sign-out", post(sign_out))
}

#[derive(Serialize)]
struct MeResponse {
    id: String,
    email: String,
    name: Option<String>,
    avatar_url: Option<String>,
    linked_providers: String,
    master_key_enc_blob: Option<String>,
}

async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let user = state
        .store
        .get_user(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;
    Ok(Json(MeResponse {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        linked_providers: user.linked_providers,
        master_key_enc_blob: user.master_key_enc_blob,
    }))
}

#[derive(Deserialize)]
struct MasterKeyBody {
    master_key_enc_blob: String,
}

async fn set_master_key(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<MasterKeyBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    state
        .store
        .set_master_key(&user_id, &body.master_key_enc_blob)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn get_master_key(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let blob = state
        .store
        .get_master_key(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        serde_json::json!({ "master_key_enc_blob": blob }),
    ))
}
