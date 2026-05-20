use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Redirect;
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
        // First-time local-server setup: accept an Argon2id hash and store it
        // as the bearer verifier. Locked once any hash is already present so
        // a rogue client can't hijack an established server. Rotation after
        // setup requires `/admin/rotate-token` (TODO) auth'd with the old
        // bearer; not implemented yet.
        .route("/admin/setup", post(admin_setup))
}

#[derive(Deserialize)]
struct AdminSetupBody {
    hash: String,
}

async fn admin_setup(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AdminSetupBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let existing = state
        .store
        .get_local_admin_hash()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if existing.is_some() {
        return Err((StatusCode::CONFLICT, "admin token already configured".into()));
    }
    if body.hash.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "empty hash".into()));
    }
    state
        .store
        .upsert_local_admin_hash(&body.hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Materialize the synthetic local user + org so the very first
    // bearer-auth'd request finds a join target.
    state
        .store
        .ensure_local_user_and_org()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true })))
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
    // Open-redirect guard: never trust a callback URL coming straight from the
    // query string — after OAuth completes we'd attach the exchange code to
    // it and bounce the browser there, handing the code to whoever the URL
    // pointed at. Restrict to the configured desktop deep link (or its
    // scheme), or operator-managed prefixes via env.
    validate_callback(&callback, &state.cfg.deep_link_redirect)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
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
    // x-forwarded-proto is client-spoofable when no proxy strips it. Clamp to
    // http/https so a forged value can't smuggle e.g. `javascript:` into a
    // URL we later parse.
    let scheme = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .filter(|s| *s == "http" || *s == "https")
        .unwrap_or("http");
    let host = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    format!("{scheme}://{host}")
}

fn validate_callback(callback: &str, configured: &str) -> Result<(), String> {
    let url = url::Url::parse(callback).map_err(|_| "invalid callback URL".to_string())?;
    // Exact match against the configured deep link is always allowed.
    if callback == configured {
        return Ok(());
    }
    // Match the configured deep link's scheme — desktop builds may pass a
    // distinct path (e.g. `database-manager://auth/success`) but the scheme
    // is fixed at build time so it's safe to allow the whole scheme.
    if let Ok(configured_url) = url::Url::parse(configured) {
        if url.scheme() == configured_url.scheme()
            && configured_url.scheme() != "http"
            && configured_url.scheme() != "https"
        {
            return Ok(());
        }
    }
    // Operator-managed allow-list of URL prefixes (comma-separated). Use this
    // when the server is fronted by a web dashboard that needs to receive the
    // exchange code. Example:
    //   OAUTH_CALLBACK_ALLOWED_PREFIXES=https://dash.example.com/
    if let Ok(list) = std::env::var("OAUTH_CALLBACK_ALLOWED_PREFIXES") {
        for prefix in list.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            if callback.starts_with(prefix) {
                return Ok(());
            }
        }
    }
    Err(format!("callback URL not allowed: {callback}"))
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
    // Defense in depth: re-validate the callback URL even though sign_in()
    // already gated it on insert. A stored URL is still attacker-supplied.
    validate_callback(&callback, &state.cfg.deep_link_redirect)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

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
    // Self-host UX: first-time login on a fresh server means the user has no
    // org memberships yet. Auto-create a personal "owner" org so /api/orgs/me
    // is non-empty and the client can address CRUD endpoints with a valid
    // org_id. The org name defaults to the user's display name (or email
    // local-part) and can be renamed later.
    let memberships = state
        .store
        .list_user_orgs(&user.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if memberships.is_empty() {
        let display = user
            .name
            .clone()
            .unwrap_or_else(|| user.email.split('@').next().unwrap_or("Personal").to_string());
        let _ = state
            .store
            .create_org(&display, None, None, &user.id)
            .map_err(|e| tracing::warn!("auto-create org failed: {e}"));
    }
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
    // Path 1: regular OAuth session token (remote orgs, multi-user).
    if let Some(uid) = state
        .store
        .session_user(&token)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        return Ok(uid);
    }
    // Path 2: local-server admin token (passphrase-derived). Argon2id-hashed
    // hash lives in `local_admin_token`; on match we map the request to the
    // synthetic local user `__local__` who owns the default "Local" org.
    if let Some(hash) = state
        .store
        .get_local_admin_hash()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    {
        if crate::crypto::verify_admin_token(&token, &hash) {
            return state
                .store
                .ensure_local_user_and_org()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
        }
    }
    Err((StatusCode::UNAUTHORIZED, "invalid token".to_string()))
}

