use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Result;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod account;
mod auth;
mod config;
mod db;
mod state;
mod sync;

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
    let bind: SocketAddr = format!("{}:{}", cfg.bind_addr, cfg.port).parse()?;
    let state = Arc::new(AppState { cfg, store });

    let app = Router::new()
        .nest("/api/auth", auth::router())
        .nest("/api/sync", sync::router())
        .nest("/api/account", account::router())
        .route(
            "/health",
            axum::routing::get(|| async { axum::Json(serde_json::json!({ "ok": true })) }),
        )
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    tracing::info!("dbm-server listening on http://{bind}");
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}
