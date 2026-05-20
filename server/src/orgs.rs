use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::require_auth;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_org))
        .route("/me", get(list_my_orgs))
        .route("/:org_id", patch(update_org).delete(delete_org))
        .route("/:org_id/members", get(list_members).post(invite))
        .route("/:org_id/members/:user_id", patch(set_role).delete(remove_member))
        .route("/invites/:token", get(invite_info))
        .route("/invites/:token/redeem", post(redeem_invite))
}

fn role_rank(role: &str) -> u8 {
    match role {
        "owner" => 4,
        "admin" => 3,
        "member" => 2,
        "viewer" => 1,
        _ => 0,
    }
}

fn require_role(state: &AppState, headers: &HeaderMap, org_id: &str, min: &str) -> Result<(String, String), (StatusCode, String)> {
    let user_id = require_auth(state, headers)?;
    let role = state.store.get_member_role(org_id, &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::FORBIDDEN, "not a member".into()))?;
    if role_rank(&role) < role_rank(min) {
        return Err((StatusCode::FORBIDDEN, format!("requires {min}")));
    }
    Ok((user_id, role))
}

#[derive(Deserialize)]
struct CreateOrgBody {
    name: String,
    accent_color: Option<String>,
    icon_url: Option<String>,
}

#[derive(Serialize)]
struct OrgView {
    id: String,
    name: String,
    accent_color: Option<String>,
    icon_url: Option<String>,
    role: Option<String>,
}

async fn create_org(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<CreateOrgBody>,
) -> Result<Json<OrgView>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let org = state.store.create_org(&body.name, body.accent_color.as_deref(), body.icon_url.as_deref(), &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(OrgView {
        id: org.id, name: org.name, accent_color: org.accent_color, icon_url: org.icon_url,
        role: Some("owner".into()),
    }))
}

async fn list_my_orgs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<OrgView>>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let mut rows = state.store.list_user_orgs(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Self-heal for sessions that pre-date the auto-create-on-exchange fix:
    // if the authenticated user still has zero memberships, mint a personal
    // org on the fly so the client doesn't get stuck with `user belongs to
    // no orgs on this server`.
    if rows.is_empty() {
        if let Some(user) = state.store.get_user(&user_id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        {
            let display = user
                .name
                .clone()
                .unwrap_or_else(|| user.email.split('@').next().unwrap_or("Personal").to_string());
            let _ = state.store.create_org(&display, None, None, &user.id);
            rows = state.store.list_user_orgs(&user_id)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }
    Ok(Json(rows.into_iter().map(|(o, role)| OrgView {
        id: o.id, name: o.name, accent_color: o.accent_color, icon_url: o.icon_url, role: Some(role),
    }).collect()))
}

#[derive(Deserialize)]
struct UpdateOrgBody {
    name: Option<String>,
    accent_color: Option<String>,
    icon_url: Option<String>,
}

async fn update_org(
    State(state): State<Arc<AppState>>,
    Path(org_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<UpdateOrgBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let _ = require_role(&state, &headers, &org_id, "admin")?;
    state.store.update_org(&org_id, body.name.as_deref(), body.accent_color.as_deref(), body.icon_url.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn delete_org(
    State(state): State<Arc<AppState>>,
    Path(org_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let _ = require_role(&state, &headers, &org_id, "owner")?;
    state.store.delete_org(&org_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn list_members(
    State(state): State<Arc<AppState>>,
    Path(org_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let _ = require_role(&state, &headers, &org_id, "viewer")?;
    let members = state.store.list_members(&org_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "members": members })))
}

#[derive(Deserialize)]
struct InviteBody {
    role: String,
    ttl_hours: Option<i64>,
}

async fn invite(
    State(state): State<Arc<AppState>>,
    Path(org_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<InviteBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let (user_id, _) = require_role(&state, &headers, &org_id, "admin")?;
    if !matches!(body.role.as_str(), "admin" | "member" | "viewer") {
        return Err((StatusCode::BAD_REQUEST, "invalid role".into()));
    }
    let token = state.store.create_invite(&org_id, &body.role, &user_id, body.ttl_hours.unwrap_or(72))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "token": token })))
}

#[derive(Deserialize)]
struct RoleBody {
    role: String,
}

async fn set_role(
    State(state): State<Arc<AppState>>,
    Path((org_id, user_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<RoleBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let (actor, actor_role) = require_role(&state, &headers, &org_id, "admin")?;
    if actor == user_id {
        return Err((StatusCode::BAD_REQUEST, "cannot change own role".into()));
    }
    if !matches!(body.role.as_str(), "owner" | "admin" | "member" | "viewer") {
        return Err((StatusCode::BAD_REQUEST, "invalid role".into()));
    }
    if body.role == "owner" && actor_role != "owner" {
        return Err((StatusCode::FORBIDDEN, "only owner can promote to owner".into()));
    }
    state.store.set_member_role(&org_id, &user_id, &body.role)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn remove_member(
    State(state): State<Arc<AppState>>,
    Path((org_id, user_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let (actor, _) = require_role(&state, &headers, &org_id, "admin")?;
    if actor == user_id {
        return Err((StatusCode::BAD_REQUEST, "use leave endpoint instead".into()));
    }
    state.store.remove_member(&org_id, &user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn invite_info(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let info = state.store.invite_info(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "invite not found or already used".into()))?;
    Ok(Json(serde_json::json!({
        "org": { "id": info.0.id, "name": info.0.name, "accent_color": info.0.accent_color, "icon_url": info.0.icon_url },
        "role": info.1,
    })))
}

async fn redeem_invite(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = require_auth(&state, &headers)?;
    let invite = state.store.redeem_invite(&token, &user_id)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(Json(serde_json::json!({ "org_id": invite.org_id, "role": invite.role })))
}
