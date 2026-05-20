use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::credentials;
use crate::db::{
    AppUserRecord, ConnectionInput, ConnectionRecord, CredentialRecord, GroupRecord,
};
use crate::plugins::{DocumentResult, KeyValue, PluginInfo, RedisKey, TableResult};
use crate::AppState;

#[derive(Debug, Serialize)]
pub struct LegacyExport {
    pub schema_version: u32,
    pub exported_at: String,
    pub connections: Vec<ConnectionRecord>,
    pub groups: Vec<GroupRecord>,
    pub credentials: Vec<CredentialRecord>,
    pub app_settings: serde_json::Map<String, serde_json::Value>,
}

/// Snapshot of pre-server-refactor data. Used by the migration modal to
/// produce a JSON file the user can re-import manually after the wipe.
#[tauri::command]
pub fn export_legacy_data(state: State<'_, AppState>) -> Result<LegacyExport, String> {
    let connections = state.db.list_connections().unwrap_or_default();
    let groups = state.db.list_groups().unwrap_or_default();
    let credentials = state.db.list_credentials().unwrap_or_default();
    let mut app_settings = serde_json::Map::new();
    if let Ok(rows) = state.db.list_app_settings_for_export() {
        for (k, v) in rows {
            app_settings.insert(k, serde_json::Value::String(v));
        }
    }
    Ok(LegacyExport {
        schema_version: state.db.schema_version().unwrap_or(0),
        exported_at: chrono::Utc::now().to_rfc3339(),
        connections,
        groups,
        credentials,
        app_settings,
    })
}

/// Returns true when the local SQLite still has any legacy data tables that
/// the upcoming server-first refactor will drop. Used to gate the migration
/// modal: don't show it on fresh installs.
#[tauri::command]
pub fn has_legacy_data(state: State<'_, AppState>) -> Result<bool, String> {
    state.db.has_any_legacy_data()
}

// === Server-as-source-of-truth CRUDs ===
//
// After the F1 wipe, connection/group/credential data lives on the active
// org's server. These commands proxy HTTP to that server through `org_http`
// (TLS-pinned + bearer-authenticated). The local SQLite no longer stores
// these rows. Server returns ConnectionRecord-shaped JSON; we deserialize
// directly into the existing struct so the frontend contract is unchanged.

pub(crate) async fn proxy_get<T: serde::de::DeserializeOwned>(
    state: &AppState,
    path: &str,
) -> Result<T, String> {
    let org_id = state.db.active_org_id()?;
    let (client, url, remote_id, token) = crate::orgs::org_http(state, org_id).await?;
    let mut req = client.get(format!("{url}{path}")).bearer_auth(&token);
    if let Some(rid) = &remote_id {
        req = req.query(&[("org_id", rid)]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    res.json::<T>().await.map_err(|e| e.to_string())
}

pub(crate) async fn proxy_send<T: serde::de::DeserializeOwned, B: serde::Serialize>(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    body: Option<&B>,
) -> Result<T, String> {
    let org_id = state.db.active_org_id()?;
    let (client, url, remote_id, token) = crate::orgs::org_http(state, org_id).await?;
    let mut req = client
        .request(method, format!("{url}{path}"))
        .bearer_auth(&token);
    if let Some(rid) = &remote_id {
        req = req.query(&[("org_id", rid)]);
    }
    if let Some(body) = body {
        req = req.json(body);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    res.json::<T>().await.map_err(|e| e.to_string())
}

/// Server-side plugin runtime proxy. When the user has flipped
/// `app.plugins_server_mode` on, the client forwards the operation to
/// `/api/plugins_exec/<plugin_id>/exec` instead of spawning the local
/// subprocess. Returns `Ok(None)` if the flag is off — caller falls back to
/// `state.plugins.<op>(...)`.
async fn maybe_exec_remote(
    state: &AppState,
    plugin_id: &str,
    op: &str,
    args: serde_json::Value,
) -> Result<Option<serde_json::Value>, String> {
    let raw = state
        .db
        .get_app_setting("app.plugins_server_mode")
        .ok()
        .flatten();
    let on = matches!(raw.as_deref(), Some("true") | Some("\"true\""));
    if !on {
        return Ok(None);
    }
    let org_id = state.db.active_org_id()?;
    let (client, base, remote_id, token) = crate::orgs::org_http(state, org_id).await?;
    let rid = remote_id.unwrap_or_else(|| "org_local".to_string());
    let url = format!("{base}/api/plugins_exec/{plugin_id}/exec");
    let body = serde_json::json!({ "op": op, "args": args, "org_id": rid });
    let res = client
        .post(&url)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server-mode exec returned {}", res.status()));
    }
    #[derive(serde::Deserialize)]
    struct R { ok: bool, result: serde_json::Value, #[serde(default)] error: Option<String> }
    let r: R = res.json().await.map_err(|e| e.to_string())?;
    if !r.ok {
        return Err(r.error.unwrap_or_else(|| "server-mode exec failed".into()));
    }
    Ok(Some(r.result))
}

pub(crate) async fn proxy_delete(state: &AppState, path: &str) -> Result<(), String> {
    let org_id = state.db.active_org_id()?;
    let (client, url, remote_id, token) = crate::orgs::org_http(state, org_id).await?;
    let mut req = client.delete(format!("{url}{path}")).bearer_auth(&token);
    if let Some(rid) = &remote_id {
        req = req.query(&[("org_id", rid)]);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("server returned {}", res.status()));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionRecord>, String> {
    proxy_get(&state, "/api/connections").await
}

#[tauri::command]
pub async fn create_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    proxy_send(&state, reqwest::Method::POST, "/api/connections", Some(&input)).await
}

#[tauri::command]
pub async fn update_connection(
    state: State<'_, AppState>,
    id: i64,
    input: ConnectionInput,
) -> Result<ConnectionRecord, String> {
    proxy_send(
        &state,
        reqwest::Method::PATCH,
        &format!("/api/connections/{id}"),
        Some(&input),
    )
    .await
}

#[tauri::command]
pub async fn delete_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    proxy_delete(&state, &format!("/api/connections/{id}")).await
}

#[tauri::command]
pub fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    state.plugins.list()
}

#[tauri::command]
pub async fn enable_plugin(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), String> {
    // Server-first plugin lifecycle:
    //   1. Tell the active org's server the plugin is installed (idempotent
    //      upsert in `org_plugins_installed`).
    //   2. If the binary isn't in the local cache yet, download it from the
    //      server's `/api/plugins` manifest and verify signature + checksum
    //      via `install_org_plugin` (which also runs a rescan).
    //   3. Hand off to the runtime PluginManager to spawn the subprocess.
    let installed_payload = serde_json::json!({ "enabled": true, "settings_json": "{}" });
    let _ = proxy_send::<serde_json::Value, _>(
        &state,
        reqwest::Method::PUT,
        &format!("/api/plugins_installed/{plugin_id}"),
        Some(&installed_payload),
    )
    .await;
    // Best-effort install if missing from local cache.
    let exists_locally = state
        .plugins
        .list()
        .unwrap_or_default()
        .into_iter()
        .any(|p| p.id == plugin_id);
    if !exists_locally {
        let _ = crate::orgs::install_org_plugin(state.clone(), app, None, plugin_id.clone()).await;
    }
    state.plugins.enable(&plugin_id).await
}

#[tauri::command]
pub async fn disable_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    // Mirror the enable path: tell the server first, then stop the runtime.
    let _ = proxy_delete(
        &state,
        &format!("/api/plugins_installed/{plugin_id}"),
    )
    .await;
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
    let input = credentials::materialize(&state, input).await?;
    if let Some(_) = maybe_exec_remote(&state, &input.plugin_id, "test_connection", serde_json::json!({ "input": input })).await? {
        return Ok(());
    }
    state.plugins.test_connection(&input).await
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<Vec<String>, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "list_databases", serde_json::json!({ "input": input })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    state.plugins.list_databases(&input).await
}

#[tauri::command]
pub async fn list_collections(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<String>, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "list_collections", serde_json::json!({ "input": input, "database": database })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
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
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_table_data", serde_json::json!({
        "input": input, "database": database, "table": table, "limit": limit, "offset": offset, "filter": filter, "cursor": cursor
    })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
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
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_documents", serde_json::json!({
        "input": input, "database": database, "collection": collection, "limit": limit, "offset": offset, "filter": filter, "cursor": cursor
    })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    state.plugins.get_documents(&input, &database, &collection, limit, offset, &filter, &cursor).await
}

#[tauri::command]
pub async fn get_key_value(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    key: String,
) -> Result<KeyValue, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_key_value", serde_json::json!({ "input": input, "database": database, "key": key })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    state.plugins.get_key_value(&input, &database, &key).await
}

#[tauri::command]
pub async fn list_redis_keys(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Vec<RedisKey>, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "list_redis_keys", serde_json::json!({ "input": input, "database": database })).await? {
        return serde_json::from_value(v).map_err(|e| e.to_string());
    }
    state.plugins.list_redis_keys(&input, &database).await
}

#[tauri::command]
pub async fn get_db_metrics(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_db_metrics", serde_json::json!({ "input": input, "database": database })).await? {
        return Ok(v);
    }
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
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "explain_query", serde_json::json!({
        "input": input, "database": database, "table": table, "filter": filter, "cursor": cursor, "pk_column": pk_column
    })).await? {
        return Ok(v);
    }
    state.plugins.explain_query(&input, &database, &table, &filter, &cursor, &pk_column).await
}

#[tauri::command]
pub async fn get_table_indexes(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_table_indexes", serde_json::json!({ "input": input, "database": database, "table": table })).await? {
        return Ok(v);
    }
    state.plugins.get_table_indexes(&input, &database, &table).await
}

#[tauri::command]
pub async fn get_columns_info(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    table: String,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_columns_info", serde_json::json!({ "input": input, "database": database, "table": table })).await? {
        return Ok(v);
    }
    state.plugins.get_columns_info(&input, &database, &table).await
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
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "get_distinct_values", serde_json::json!({
        "input": input, "database": database, "table": table, "column": column, "search": search
    })).await? {
        return Ok(v);
    }
    state.plugins.get_distinct_values(&input, &database, &table, &column, &search).await
}

#[tauri::command]
pub async fn execute_sql_query(
    state: State<'_, AppState>,
    input: ConnectionInput,
    database: String,
    sql: String,
    query_id: String,
    cap: Option<i64>,
) -> Result<Value, String> {
    let input = credentials::materialize(&state, input).await?;
    if let Some(v) = maybe_exec_remote(&state, &input.plugin_id, "execute_sql_query", serde_json::json!({
        "input": input, "database": database, "sql": sql, "query_id": query_id, "cap": cap
    })).await? {
        return Ok(v);
    }
    state.plugins.execute_sql_query(&input, &database, &sql, &query_id, cap).await
}

#[tauri::command]
pub async fn cancel_sql_query(
    state: State<'_, AppState>,
    input: ConnectionInput,
    query_id: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input).await?;
    state.plugins.cancel_sql_query(&input, &query_id).await
}

#[tauri::command]
pub async fn redis_subscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input).await?;
    state.plugins.redis_subscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_unsubscribe(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input).await?;
    state.plugins.redis_unsubscribe(&input, &channel).await
}

#[tauri::command]
pub async fn redis_publish(
    state: State<'_, AppState>,
    input: ConnectionInput,
    channel: String,
    payload: String,
) -> Result<(), String> {
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
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
    let input = credentials::materialize(&state, input).await?;
    state
        .plugins
        .expire_redis_key(&input, &database, &key, ttl)
        .await
}

// Workspace sessions (tabs + filtros) sync via the active org's server so
// multi-device users see the same workspace state. We still keep the local
// `sessions_db` (`workspaces.sqlite` next to the app data dir) as a fallback
// for offline reads, but the server is the source of truth.

#[derive(Debug, Serialize, serde::Deserialize)]
struct WorkspaceSnapshot {
    snapshot_json: String,
}

#[derive(Debug, serde::Deserialize)]
struct WorkspaceRow {
    snapshot_json: String,
}

#[tauri::command]
pub async fn save_sessions(state: State<'_, AppState>, data: String) -> Result<(), String> {
    // Best-effort local cache first — if server write fails we still keep a
    // local copy for next boot.
    let _ = state.sessions_db.save_sessions(&data);
    let payload = WorkspaceSnapshot { snapshot_json: data };
    let _: serde_json::Value =
        proxy_send(&state, reqwest::Method::PUT, "/api/workspaces", Some(&payload)).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_sessions(state: State<'_, AppState>) -> Result<Option<String>, String> {
    match proxy_get::<Option<WorkspaceRow>>(&state, "/api/workspaces").await {
        Ok(Some(row)) => Ok(Some(row.snapshot_json)),
        Ok(None) => Ok(state.sessions_db.load_sessions().unwrap_or(None)),
        Err(_) => Ok(state.sessions_db.load_sessions().unwrap_or(None)),
    }
}

// Reorder + move + attach are stubbed during the server-first refactor.
// The server doesn't expose dedicated endpoints yet — clients still call
// these for sidebar DnD UX, so we accept the call and no-op. Persistence
// of order/group/credential attachment will return when the server exposes
// `POST /api/connections/reorder` etc. (planned F+1 after F1).

#[tauri::command]
pub fn reorder_connections(_state: State<'_, AppState>, ids: Vec<i64>) -> Result<(), String> {
    let _ = ids;
    Ok(())
}

#[tauri::command]
pub fn move_connection_to_group(
    _state: State<'_, AppState>,
    connection_id: i64,
    group_id: Option<i64>,
    position: i64,
) -> Result<(), String> {
    let _ = (connection_id, group_id, position);
    Ok(())
}

#[tauri::command]
pub async fn list_groups(state: State<'_, AppState>) -> Result<Vec<GroupRecord>, String> {
    proxy_get(&state, "/api/groups").await
}

#[derive(Debug, Serialize)]
struct GroupInputPayload<'a> {
    name: &'a str,
    color: Option<&'a str>,
    position: i64,
}

#[tauri::command]
pub async fn create_group(
    state: State<'_, AppState>,
    name: String,
    parent_id: Option<i64>,
) -> Result<GroupRecord, String> {
    // `parent_id` is preserved for FE compat but ignored — server schema
    // doesn't model nested groups yet.
    let _ = parent_id;
    let payload = GroupInputPayload { name: &name, color: None, position: 0 };
    proxy_send(&state, reqwest::Method::POST, "/api/groups", Some(&payload)).await
}

#[tauri::command]
pub async fn update_group(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> Result<GroupRecord, String> {
    let payload = GroupInputPayload { name: &name, color: None, position: 0 };
    proxy_send(
        &state,
        reqwest::Method::PATCH,
        &format!("/api/groups/{id}"),
        Some(&payload),
    )
    .await
}

#[tauri::command]
pub async fn delete_group(
    state: State<'_, AppState>,
    id: i64,
    reassign_to: Option<i64>,
) -> Result<(), String> {
    let _ = reassign_to;
    proxy_delete(&state, &format!("/api/groups/{id}")).await
}

#[tauri::command]
pub fn reorder_groups(_state: State<'_, AppState>, ids: Vec<i64>) -> Result<(), String> {
    let _ = ids;
    Ok(())
}

#[tauri::command]
pub async fn list_credentials(state: State<'_, AppState>) -> Result<Vec<CredentialRecord>, String> {
    proxy_get(&state, "/api/credentials").await
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
