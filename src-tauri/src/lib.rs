mod commands;
mod db;
mod plugins;

use std::sync::Arc;

use db::{Database, SessionsDb};
use plugins::PluginManager;
use tauri::Manager;

pub struct AppState {
    pub db: Database,
    pub sessions_db: SessionsDb,
    pub plugins: Arc<PluginManager>,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db = Database::new(app.handle()).map_err(|error| error.to_string())?;
            let sessions_db = SessionsDb::new(app.handle()).map_err(|error| error.to_string())?;
            let plugins = Arc::new(PluginManager::new(app.handle().clone(), db.clone()));
            plugins
                .rescan_blocking()
                .map_err(|error| error.to_string())?;
            app.manage(AppState { db, sessions_db, plugins });
            Ok(())
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
            commands::load_sessions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
