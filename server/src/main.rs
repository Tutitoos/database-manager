use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod connections;
mod credentials_crud;
mod crypto;
mod db;
mod discovery;
mod groups;
mod orgs;
mod plugins;
mod plugins_exec;
mod plugins_installed;
mod state;
mod tls;
mod workspaces;

use crate::state::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env first, then .env.local overrides (Vite/Next style).
    // DOTENV_PATH (explicit) wins over both.
    let _ = dotenvy::dotenv();
    if std::path::Path::new(".env.local").exists() {
        let _ = dotenvy::from_filename_override(".env.local");
    }
    if let Ok(path) = std::env::var("DOTENV_PATH") {
        let _ = dotenvy::from_path_override(path);
    }
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let cfg = config::Config::from_env()?;
    let store = db::Store::open(&cfg.database_path)?;
    // Init at-rest crypto KEK before serving — read DBM_SERVER_KEY env or
    // generate `dbm.key` next to the SQLite file.
    let data_dir = std::path::Path::new(&cfg.database_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    crypto::init(&data_dir)?;
    // Adopt the latest admin-token hash from the env var on every boot. This
    // is how the desktop client tells us the user's current passphrase token
    // after a change — the spawn command always includes the freshest hash.
    if let Ok(hash) = std::env::var("DBM_LOCAL_ADMIN_HASH") {
        if !hash.is_empty() {
            store.upsert_local_admin_hash(&hash)?;
            // Eagerly seed the synthetic local user + "Local" org so the
            // client's `set_org_remote_id` ("org_local") points at a row that
            // already exists. Authenticated requests would also create it
            // lazily, but the client races ahead.
            store.ensure_local_user_and_org()?;
        }
    }
    let bind: SocketAddr = format!("{}:{}", cfg.bind_addr, cfg.port).parse()?;
    let server_name = cfg.server_name.clone();
    let accent = cfg.accent_color.clone();
    let providers = cfg.enabled_providers();
    let port = cfg.port;
    let state = Arc::new(AppState { cfg, store });

    let health_state = state.clone();
    let app = Router::new()
        .nest("/api/auth", auth::router())
        .nest("/api/orgs", orgs::router())
        .nest("/api/plugins", plugins::router())
        .nest("/api/plugins_exec", plugins_exec::router())
        .nest("/api/connections", connections::router())
        .nest("/api/groups", groups::router())
        .nest("/api/credentials", credentials_crud::router())
        .nest("/api/workspaces", workspaces::router())
        .nest("/api/plugins_installed", plugins_installed::router())
        .route(
            "/health",
            axum::routing::get({
                let st = health_state.clone();
                move || {
                    let st = st.clone();
                    async move {
                        axum::Json(serde_json::json!({
                            "ok": true,
                            "name": st.cfg.server_name,
                            "version": env!("CARGO_PKG_VERSION"),
                            "accent_color": st.cfg.accent_color,
                            "providers": st.cfg.enabled_providers(),
                            "min_client_version": st.cfg.min_client_version,
                            "plugin_signing_pubkey_b64": plugins::signing_pubkey_b64(),
                        }))
                    }
                }
            }),
        )
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    tracing::info!("dbm-server listening on http://{bind}");

    // Announce via mDNS so desktop clients in the same LAN can auto-discover.
    // Skip when bound to loopback: the announce would advertise the LAN IP
    // even though the server only accepts loopback connections, leading to
    // confusing "discovered but unreachable" entries in the client wizard.
    let _mdns_keeper = if bind.ip().is_loopback() {
        tracing::info!("loopback bind ({}) — skipping mDNS announce", bind.ip());
        None
    } else {
        discovery::announce(&server_name, port, accent.as_deref(), &providers)
            .map_err(|e| {
                tracing::warn!("mDNS announce failed: {e}");
                e
            })
            .ok()
    };

    // When the user enabled "Share on LAN" (BIND_ADDR != 127.0.0.1) we force
    // HTTPS via a self-signed cert. The desktop client pins the leaf cert on
    // first contact (TOFU), so subsequent connections from the same client
    // detect MITM swaps. 127.0.0.1 stays plain HTTP — only this loopback can
    // reach it, no wire to protect.
    if bind.ip().to_string() == "127.0.0.1" {
        let listener = tokio::net::TcpListener::bind(bind).await?;
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    } else {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut hosts = vec!["localhost".to_string(), bind.ip().to_string()];
        if let Ok(name) = hostname::get() {
            hosts.push(name.to_string_lossy().into_owned());
        }
        let mat = tls::ensure_self_signed(&data_dir, &hosts)?;
        let cfg = tls::rustls_config_from(&mat).await?;
        tracing::info!("serving HTTPS (self-signed) on {bind}");
        axum_server::bind_rustls(bind, cfg)
            .serve(app.into_make_service())
            .await?;
    }
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
