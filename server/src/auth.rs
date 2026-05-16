use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::config::OAuthApp;
use crate::state::AppState;

#[derive(Clone, Copy)]
enum Provider {
    Discord,
    Github,
    Google,
    Microsoft,
}

impl Provider {
    fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "discord" => Provider::Discord,
            "github" => Provider::Github,
            "google" => Provider::Google,
            "microsoft" => Provider::Microsoft,
            _ => return None,
        })
    }
    fn as_str(self) -> &'static str {
        match self {
            Provider::Discord => "discord",
            Provider::Github => "github",
            Provider::Google => "google",
            Provider::Microsoft => "microsoft",
        }
    }
}

struct ProviderCfg<'a> {
    app: &'a OAuthApp,
    authorize_url: String,
    token_url: String,
    userinfo_url: &'static str,
    scope: &'static str,
}

fn provider_cfg<'a>(state: &'a AppState, p: Provider) -> ProviderCfg<'a> {
    match p {
        Provider::Discord => ProviderCfg {
            app: &state.cfg.discord,
            authorize_url: "https://discord.com/oauth2/authorize".into(),
            token_url: "https://discord.com/api/oauth2/token".into(),
            userinfo_url: "https://discord.com/api/users/@me",
            scope: "identify email",
        },
        Provider::Github => ProviderCfg {
            app: &state.cfg.github,
            authorize_url: "https://github.com/login/oauth/authorize".into(),
            token_url: "https://github.com/login/oauth/access_token".into(),
            userinfo_url: "https://api.github.com/user",
            scope: "read:user user:email",
        },
        Provider::Google => ProviderCfg {
            app: &state.cfg.google,
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            userinfo_url: "https://www.googleapis.com/oauth2/v3/userinfo",
            scope: "openid email profile",
        },
        Provider::Microsoft => ProviderCfg {
            app: &state.cfg.microsoft,
            authorize_url: format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
                state.cfg.microsoft_tenant
            ),
            token_url: format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                state.cfg.microsoft_tenant
            ),
            userinfo_url: "https://graph.microsoft.com/oidc/userinfo",
            scope: "openid email profile",
        },
    }
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sign-in/:provider", get(sign_in))
        .route("/callback/:provider", get(callback))
        .route("/exchange", post(exchange))
}

#[derive(Deserialize)]
struct SignInQuery {
    #[serde(rename = "callbackURL")]
    callback_url: Option<String>,
}

async fn sign_in(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    Query(q): Query<SignInQuery>,
    headers: HeaderMap,
) -> Result<Redirect, (StatusCode, String)> {
    let provider = Provider::from_str(&provider)
        .ok_or((StatusCode::BAD_REQUEST, "unknown provider".to_string()))?;
    let cfg = provider_cfg(&state, provider);
    if cfg.app.client_id.is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("{} client id not configured", provider.as_str()),
        ));
    }
    let state_code = format!("state_{}", uuid::Uuid::new_v4().simple());
    let callback = q
        .callback_url
        .clone()
        .unwrap_or_else(|| state.cfg.deep_link_redirect.clone());
    state
        .store
        .create_oauth_code(&state_code, &format!("pending:{callback}"))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let base = state
        .cfg
        .public_base_url
        .clone()
        .unwrap_or_else(|| inferred_origin(&headers));
    let redirect_uri = format!("{}/api/auth/callback/{}", base, provider.as_str());
    let mut authorize = url::Url::parse(&cfg.authorize_url)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    authorize
        .query_pairs_mut()
        .append_pair("client_id", &cfg.app.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", cfg.scope)
        .append_pair("state", &state_code);
    Ok(Redirect::temporary(authorize.as_str()))
}

fn inferred_origin(headers: &HeaderMap) -> String {
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    format!("{scheme}://{host}")
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

async fn callback(
    State(state): State<Arc<AppState>>,
    Path(provider): Path<String>,
    Query(q): Query<CallbackQuery>,
    headers: HeaderMap,
) -> Result<Redirect, (StatusCode, String)> {
    let provider = Provider::from_str(&provider)
        .ok_or((StatusCode::BAD_REQUEST, "unknown provider".to_string()))?;
    let pending = state
        .store
        .take_oauth_code(&q.state)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "unknown state".to_string()))?;
    let callback = pending.strip_prefix("pending:").unwrap_or(&pending).to_string();

    let cfg = provider_cfg(&state, provider);
    let base = state
        .cfg
        .public_base_url
        .clone()
        .unwrap_or_else(|| inferred_origin(&headers));
    let redirect_uri = format!("{}/api/auth/callback/{}", base, provider.as_str());

    let client = reqwest::Client::new();
    let token_res = client
        .post(&cfg.token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", cfg.app.client_id.as_str()),
            ("client_secret", cfg.app.client_secret.as_str()),
            ("code", q.code.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !token_res.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("token exchange failed: {}", token_res.status()),
        ));
    }
    let token_json: serde_json::Value = token_res
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or((StatusCode::BAD_GATEWAY, "no access token".to_string()))?
        .to_string();

    let user_res = client
        .get(cfg.userinfo_url)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "database-manager")
        .send()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    if !user_res.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            format!("userinfo failed: {}", user_res.status()),
        ));
    }
    let profile: serde_json::Value = user_res
        .json()
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    let email = profile
        .get("email")
        .and_then(|v| v.as_str())
        .or_else(|| profile.get("mail").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            format!(
                "{}-{}@local",
                provider.as_str(),
                profile.get("id").and_then(|v| v.as_str()).unwrap_or("unknown")
            )
        });
    let name = profile
        .get("name")
        .and_then(|v| v.as_str())
        .or_else(|| profile.get("username").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    let avatar = profile
        .get("avatar_url")
        .and_then(|v| v.as_str())
        .or_else(|| profile.get("picture").and_then(|v| v.as_str()))
        .map(|s| s.to_string());

    let mut linked = state
        .store
        .user_linked_providers(&email)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if !linked.iter().any(|p| p == provider.as_str()) {
        linked.push(provider.as_str().to_string());
    }
    let linked_json = serde_json::to_string(&linked).unwrap_or_else(|_| "[]".to_string());
    let user = state
        .store
        .upsert_user(&email, name.as_deref(), avatar.as_deref(), &linked_json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let exchange_code = format!("xcode_{}", uuid::Uuid::new_v4().simple());
    state
        .store
        .create_oauth_code(&exchange_code, &user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut target = url::Url::parse(&callback)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    target.query_pairs_mut().append_pair("code", &exchange_code);
    Ok(Redirect::to(target.as_str()))
}

#[derive(Deserialize)]
struct ExchangeBody {
    code: String,
}

#[derive(Serialize)]
struct ExchangeResponse {
    user_id: String,
    email: String,
    name: Option<String>,
    avatar_url: Option<String>,
    linked_providers: String,
    master_key_enc_blob: Option<String>,
    session_token_ref: String,
    last_synced_at: Option<String>,
}

async fn exchange(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExchangeBody>,
) -> Result<Json<ExchangeResponse>, (StatusCode, String)> {
    let user_id = state
        .store
        .take_oauth_code(&body.code)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::BAD_REQUEST, "unknown code".to_string()))?;
    let token = state
        .store
        .create_session(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let user = state
        .store
        .get_user(&user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;
    Ok(Json(ExchangeResponse {
        user_id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        linked_providers: user.linked_providers,
        master_key_enc_blob: user.master_key_enc_blob,
        session_token_ref: token,
        last_synced_at: None,
    }))
}

pub fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")))
        .map(|s| s.to_string())
}

pub fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<String, (StatusCode, String)> {
    let token = bearer(headers).ok_or((StatusCode::UNAUTHORIZED, "missing token".to_string()))?;
    state
        .store
        .session_user(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid token".to_string()))
}

pub async fn sign_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(token) = bearer(&headers) {
        let _ = state.store.delete_session(&token);
    }
    Json(serde_json::json!({ "ok": true }))
}
