mod auth;
mod commands;
mod credentials;
mod crypto;
mod db;
mod plugins;
mod sync;

use std::sync::Arc;

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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let db = Database::new(app.handle()).map_err(|error| error.to_string())?;
            let sessions_db = SessionsDb::new(app.handle()).map_err(|error| error.to_string())?;
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
                    if !sync::shutdown_started() {
                        sync::mark_shutdown_started();
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
            commands::attach_credential_to_connection,
            commands::list_groups,
            commands::create_group,
            commands::update_group,
            commands::delete_group,
            commands::reorder_groups,
            commands::list_credentials,
            commands::auth_current_user,
            commands::get_app_setting,
            commands::set_app_setting,
            auth::auth_passphrase_status,
            auth::auth_set_passphrase,
            auth::auth_unlock,
            auth::auth_lock,
            auth::auth_change_passphrase,
            auth::auth_start_oauth,
            auth::auth_complete_oauth,
            auth::auth_sign_out,
            credentials::list_credentials_view,
            credentials::create_credential,
            credentials::update_credential,
            credentials::delete_credential,
            credentials::decrypt_credential,
            sync::sync_push,
            sync::sync_pull,
            sync::sync_run,
            commands::update_document,
            commands::delete_document,
            commands::update_row,
            commands::delete_row,
            commands::set_redis_value,
            commands::delete_redis_key,
            commands::expire_redis_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
