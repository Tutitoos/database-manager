use serde_json::Value;
use tauri::State;

use crate::db::{ConnectionInput, ConnectionRecord};
use crate::plugins::{DocumentResult, KeyValue, PluginInfo, RedisKey, TableResult};
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

#[tauri::command]
pub async fn get_table_data(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
    limit: i64,
    offset: i64,
    filter: String,
    cursor: String,
) -> Result<TableResult, String> {
    state.plugins.get_table_data(&input, &database, &table, limit, offset, &filter, &cursor).await
}

#[tauri::command]
pub async fn get_documents(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    collection: String,
    limit: i64,
    offset: i64,
    filter: String,
    cursor: String,
) -> Result<DocumentResult, String> {
    state.plugins.get_documents(&input, &database, &collection, limit, offset, &filter, &cursor).await
}

#[tauri::command]
pub async fn get_key_value(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
) -> Result<KeyValue, String> {
    state.plugins.get_key_value(&input, &database, &key).await
}

#[tauri::command]
pub async fn list_redis_keys(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<RedisKey>, String> {
    state.plugins.list_redis_keys(&input, &database).await
}

#[tauri::command]
pub async fn get_db_metrics(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Value, String> {
    state.plugins.get_db_metrics(&input, &database).await
}

#[tauri::command]
pub async fn explain_query(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
    filter: String,
    cursor: String,
    pk_column: String,
) -> Result<Value, String> {
    state.plugins.explain_query(&input, &database, &table, &filter, &cursor, &pk_column).await
}

#[tauri::command]
pub async fn get_table_indexes(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
) -> Result<Value, String> {
    state.plugins.get_table_indexes(&input, &database, &table).await
}

#[tauri::command]
pub async fn get_distinct_values(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
    column: String,
    search: String,
) -> Result<Value, String> {
    state.plugins.get_distinct_values(&input, &database, &table, &column, &search).await
}

#[tauri::command]
pub async fn redis_subscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    state.plugins.redis_subscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_unsubscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    state.plugins.redis_unsubscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_publish(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
    payload: String,
) -> Result<(), String> {
    state.plugins.redis_publish(&input, &channel, &payload).await
}

#[tauri::command]
pub fn save_sessions(state: State<'_, AppState>, data: String) -> Result<(), String> {
    state.sessions_db.save_sessions(&data)
}

#[tauri::command]
pub fn load_sessions(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.sessions_db.load_sessions()
}
