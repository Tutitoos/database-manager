use tauri::State;

use crate::db::{ConnectionInput, ConnectionRecord};
use crate::plugins::PluginInfo;
use crate::AppState;

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionRecord>, String> {
    state.db.list_connections()
}

#[tauri::command]
pub fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    state.db.create_connection(input)
}

#[tauri::command]
pub fn update_connection(
    state: State<'_, AppState>,
    id: i64,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    state.db.update_connection(id, input)
}

#[tauri::command]
pub fn delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    state.db.delete_connection(id)
}

#[tauri::command]
pub fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    state.plugins.list()
}

#[tauri::command]
pub async fn enable_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    state.plugins.enable(&plugin_id).await
}

#[tauri::command]
pub async fn disable_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    state.plugins.disable(&plugin_id).await
}

#[tauri::command]
pub async fn rescan_plugins(state: State<'_, AppState>) -> Result<(), String> {
    state.plugins.rescan().await
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<(), String> {
    state.plugins.test_connection(&input).await
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<Vec<String>, String> {
    state.plugins.list_databases(&input).await
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<String>, String> {
    state.plugins.list_collections(&input, &database).await
}
