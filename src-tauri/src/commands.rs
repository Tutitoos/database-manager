use serde_json::Value;
use tauri::State;

use crate::credentials;
use crate::db::{
    AppUserRecord, ConnectionInput, ConnectionRecord, CredentialRecord, GroupRecord,
};
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
    let input = credentials::materialize(&state, input)?;
    state.plugins.test_connection(&input).await
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<Vec<String>, String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.list_databases(&input).await
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<String>, String> {
    let input = credentials::materialize(&state, input)?;
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
    let input = credentials::materialize(&state, input)?;
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
    let input = credentials::materialize(&state, input)?;
    state.plugins.get_documents(&input, &database, &collection, limit, offset, &filter, &cursor).await
}

#[tauri::command]
pub async fn get_key_value(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
) -> Result<KeyValue, String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.get_key_value(&input, &database, &key).await
}

#[tauri::command]
pub async fn list_redis_keys(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<RedisKey>, String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.list_redis_keys(&input, &database).await
}

#[tauri::command]
pub async fn get_db_metrics(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input)?;
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
    let input = credentials::materialize(&state, input)?;
    state.plugins.explain_query(&input, &database, &table, &filter, &cursor, &pk_column).await
}

#[tauri::command]
pub async fn get_table_indexes(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input)?;
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
    let input = credentials::materialize(&state, input)?;
    state.plugins.get_distinct_values(&input, &database, &table, &column, &search).await
}

#[tauri::command]
pub async fn redis_subscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.redis_subscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_unsubscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.redis_unsubscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_publish(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
    payload: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.redis_publish(&input, &channel, &payload).await
}

#[tauri::command]
pub async fn update_document(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    collection: String,
    document_id: String,
    update_json: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .update_document(&input, &database, &collection, &document_id, &update_json)
        .await
}

#[tauri::command]
pub async fn delete_document(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    collection: String,
    document_id: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .delete_document(&input, &database, &collection, &document_id)
        .await
}

#[tauri::command]
pub async fn update_row(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
    pk_column: String,
    pk_value: Value,
    values: Value,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .update_row(&input, &database, &table, &pk_column, pk_value, values)
        .await
}

#[tauri::command]
pub async fn delete_row(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
    pk_column: String,
    pk_value: Value,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .delete_row(&input, &database, &table, &pk_column, pk_value)
        .await
}

#[tauri::command]
pub async fn set_redis_value(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .set_redis_value(&input, &database, &key, &value)
        .await
}

#[tauri::command]
pub async fn delete_redis_key(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state.plugins.delete_redis_key(&input, &database, &key).await
}

#[tauri::command]
pub async fn expire_redis_key(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
    ttl: i64,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input)?;
    state
        .plugins
        .expire_redis_key(&input, &database, &key, ttl)
        .await
}

#[tauri::command]
pub fn save_sessions(state: State<'_, AppState>, data: String) -> Result<(), String> {
    state.sessions_db.save_sessions(&data)
}

#[tauri::command]
pub fn load_sessions(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.sessions_db.load_sessions()
}

#[tauri::command]
pub fn reorder_connections(state: State<'_, AppState>, ids: Vec<i64>) -> Result<(), String> {
    state.db.reorder_connections(&ids)
}

#[tauri::command]
pub fn move_connection_to_group(
    state: State<'_, AppState>,
    connection_id: i64,
    group_id: Option<i64>,
    position: i64,
) -> Result<(), String> {
    state.db.move_connection_to_group(connection_id, group_id, position)
}

#[tauri::command]
pub fn attach_credential_to_connection(
    state: State<'_, AppState>,
    connection_id: i64,
    credential_id: Option<i64>,
) -> Result<(), String> {
    state.db.attach_credential_to_connection(connection_id, credential_id)
}

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<GroupRecord>, String> {
    state.db.list_groups()
}

#[tauri::command]
pub fn create_group(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<i64>,
) -> Result<GroupRecord, String> {
    state.db.create_group(&name, parent_id)
}

#[tauri::command]
pub fn update_group(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<GroupRecord, String> {
    state.db.update_group(id, &name)
}

#[tauri::command]
pub fn delete_group(
    state: State<'_, AppState>,
    id: i64,
    reassign_to: Option<i64>,
) -> Result<(), String> {
    state.db.delete_group(id, reassign_to)
}

#[tauri::command]
pub fn reorder_groups(state: State<'_, AppState>, ids: Vec<i64>) -> Result<(), String> {
    state.db.reorder_groups(&ids)
}

#[tauri::command]
pub fn list_credentials(state: State<'_, AppState>) -> Result<Vec<CredentialRecord>, String> {
    state.db.list_credentials()
}

#[tauri::command]
pub fn auth_current_user(state: State<'_, AppState>) -> Result<Option<AppUserRecord>, String> {
    state.db.get_app_user()
}

#[tauri::command]
pub fn get_app_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.db.get_app_setting(&key)
}

#[tauri::command]
pub fn set_app_setting(
    state: State<'_, AppState>,
    key: String,
    value_json: String,
) -> Result<(), String> {
    state.db.set_app_setting(&key, &value_json)
}
