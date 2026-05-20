mod app_menu;
mod autostart;
mod auth;
mod biometry;
mod commands;
mod keychain;
mod credentials;
mod db;
mod discovery;
mod local_server;
mod orgs;
mod plugins;
mod tls;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

static SHUTDOWN_STARTED: AtomicBool = AtomicBool::new(false);

use auth::AuthState;
use db::{Database, SessionsDb};
use plugins::PluginManager;
use tauri::{Emitter, Manager, WindowEvent};

pub struct AppState {
    pub db: Database,
    pub sessions_db: SessionsDb,
    pub plugins: Arc<PluginManager>,
    pub auth: Arc<AuthState>,
}

pub fn run() {
    // rustls 0.23 needs a process-level CryptoProvider before any ClientConfig::builder()
    // call (used by tls.rs for TOFU pinning). reqwest's rustls-tls feature pulls ring in,
    // but the default provider is not auto-registered when both ring and aws-lc-rs could
    // be available, so we install it explicitly here.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // Linux + NVIDIA proprietary driver: WebKitGTK DMA-BUF renderer falla con
    // `nv_common_gbm_create_device failed` y `DRM_IOCTL_MODE_CREATE_DUMB: Permission denied`,
    // dejando la ventana en gris. Forzamos el renderer no-DMABUF antes de inicializar WebKit.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        // Fallback adicional para WebKitGTK antiguos (Ubuntu 22.04 / Debian 12 con HWAccel buggy).
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    tauri::Builder::default()
        // window-state plugin: persist size/position on quit but skip the
        // restore-on-launch step so the boot phase machinery in main.tsx is
        // the only thing deciding the initial window size (compact while
        // bootstrapping, full while ready).
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::SIZE
                        - tauri_plugin_window_state::StateFlags::POSITION,
                )
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let db = Database::new(app.handle()).map_err(|error| error.to_string())?;
            let sessions_db = SessionsDb::new(app.handle()).map_err(|error| error.to_string())?;
            // If the server-first wipe ran this boot, also drop any cached
            // session snapshot from sessions.db so stale topbar tabs (e.g.
            // "Kena-new" from the legacy install) don't survive the reset.
            // We piggyback on the same v2 flag; clearing is idempotent.
            if db
                .get_app_setting("app.sessions_cleared_after_wipe.v2")
                .ok()
                .flatten()
                .is_none()
                && db
                    .get_app_setting("app.server_first_wiped.v2")
                    .ok()
                    .flatten()
                    .is_some()
            {
                let _ = sessions_db.clear_sessions();
                let _ = db.set_app_setting(
                    "app.sessions_cleared_after_wipe.v2",
                    &format!("\"{}\"", chrono::Utc::now().to_rfc3339()),
                );
            }
            let plugins = Arc::new(PluginManager::new(app.handle().clone(), db.clone()));
            plugins
                .rescan_blocking()
                .map_err(|error| error.to_string())?;
            let auth = Arc::new(AuthState::new());
            app.manage(AppState {
                db,
                sessions_db,
                plugins: plugins.clone(),
                auth,
            });
            // Lifecycle handle for the embedded local server. The actual
            // child process is spawned later via `start_local_server` when
            // the user reaches the WelcomePage or returns to a local org.
            app.manage(local_server::LocalServerHandle::default());

            // Auto-spawn the embedded server in the background. Reads the
            // last persisted port (default 18787) and skips when something is
            // already serving the port. The probe + retry chain runs off the
            // setup thread so a slow disk / bound port doesn't stall window
            // creation.
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let port: u16 = state
                        .db
                        .get_app_setting("local.server_port")
                        .ok()
                        .flatten()
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
                        .and_then(|v| match v {
                            serde_json::Value::Number(n) => n.as_u64().map(|n| n as u16),
                            serde_json::Value::String(s) => s.parse::<u16>().ok(),
                            _ => None,
                        })
                        .unwrap_or(18787);
                    let handle_state = app_handle.state::<local_server::LocalServerHandle>();
                    let _ = local_server::auto_start_on_boot(
                        app_handle.clone(),
                        handle_state,
                        port,
                        None,
                    )
                    .await;
                });
            }

            // Native application menu — wires keyboard shortcuts + macOS top bar
            // + Win/Linux in-window menubar. Each item emits `menu:<id>`.
            app_menu::build(app.handle()).map_err(|e| e.to_string())?;
            app_menu::install_event_handler(app.handle());

            // macOS vibrancy — translucent window with sidebar material so the
            // desktop wallpaper shows through underneath.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }

            let handle = app.handle().clone();
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h2 = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    let _ = h2.emit(
                        "auth:deep-link",
                        urls.iter().map(|u| u.as_str().to_string()).collect::<Vec<_>>(),
                    );
                });
            }
            let _ = handle;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if !SHUTDOWN_STARTED.swap(true, Ordering::SeqCst) {
                        api.prevent_close();
                        let app_handle = window.app_handle().clone();
                        let plugins = state.plugins.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = tokio::time::timeout(
                                std::time::Duration::from_secs(3),
                                plugins.shutdown_all(),
                            )
                            .await;
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.destroy();
                            }
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_connections,
            commands::create_connection,
            commands::update_connection,
            commands::delete_connection,
            commands::list_plugins,
            commands::enable_plugin,
            commands::disable_plugin,
            commands::rescan_plugins,
            commands::test_connection,
            commands::list_databases,
            commands::list_collections,
            commands::get_table_data,
            commands::get_documents,
            commands::get_key_value,
            commands::list_redis_keys,
            commands::get_db_metrics,
            commands::explain_query,
            commands::get_table_indexes,
            commands::get_distinct_values,
            commands::redis_subscribe,
            commands::redis_unsubscribe,
            commands::redis_publish,
            commands::save_sessions,
            commands::load_sessions,
            commands::reorder_connections,
            commands::move_connection_to_group,
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            commands::reorder_groups,
            commands::list_credentials,
            commands::auth_current_user,
            commands::get_app_setting,
            commands::set_app_setting,
            commands::export_legacy_data,
            commands::has_legacy_data,
            auth::auth_start_oauth,
            auth::auth_complete_oauth,
            auth::auth_create_local_user,
            auth::auth_sign_out,
            auth::auth_forget_device,
            auth::auth_biometry_supported,
            auth::auth_load_bearer_biometric,
            credentials::list_credentials_view,
            credentials::create_credential,
            credentials::update_credential,
            credentials::delete_credential,
            credentials::decrypt_credential,
            commands::update_document,
            commands::delete_document,
            commands::update_row,
            commands::delete_row,
            commands::set_redis_value,
            commands::delete_redis_key,
            commands::expire_redis_key,
            commands::execute_sql_query,
            commands::cancel_sql_query,
            orgs::list_organizations,
            orgs::get_organization,
            orgs::add_organization,
            orgs::update_organization,
            orgs::delete_organization,
            orgs::get_active_organization,
            orgs::set_active_organization,
            orgs::org_health,
            orgs::sync_org_plugins,
            orgs::install_org_plugin,
            orgs::org_list_members,
            orgs::org_create_invite,
            orgs::org_set_member_role,
            orgs::org_remove_member,
            orgs::org_invite_info,
            orgs::org_redeem_invite,
            orgs::set_org_remote_id,
            discovery::start_org_discovery,
            discovery::stop_org_discovery,
            local_server::start_local_server,
            local_server::stop_local_server,
            local_server::local_server_status,
            local_server::local_server_log_tail,
            local_server::gen_local_admin_token,
            local_server::local_server_setup_admin,
            local_server::upload_local_plugin,
            autostart::enable_autostart,
            autostart::disable_autostart,
            autostart::autostart_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
