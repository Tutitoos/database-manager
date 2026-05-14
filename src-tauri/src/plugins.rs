use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::{timeout, Duration};

use crate::db::{ConnectionInput, Database, PluginDbRecord};

#[derive(Debug, Serialize, Deserialize)]
pub struct TableResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub total: i64,
    #[serde(default)]
    pub is_estimated: bool,
    #[serde(default)]
    pub next_cursor: Option<String>,
    #[serde(default)]
    pub pk_column: Option<String>,
    #[serde(default)]
    pub query_ms: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentResult {
    pub documents: Vec<Value>,
    pub total: i64,
    #[serde(default)]
    pub query_ms: i64,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyValue {
    pub key_type: String,
    pub value: Value,
    pub ttl: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RedisKey {
    pub key: String,
    pub key_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub default_port: Option<u16>,
    pub executable: String,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default)]
    pub settings: Vec<Value>,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
    pub loaded: bool,
    pub error: Option<String>,
    pub builtin: bool,
    pub manifest: PluginManifest,
}

struct RuntimePlugin {
    manifest: PluginManifest,
    path: PathBuf,
    enabled: bool,
    loaded: bool,
    error: Option<String>,
    process: Option<Arc<PluginProcess>>,
}

struct PluginProcess {
    child: AsyncMutex<Child>,
    stdin: AsyncMutex<ChildStdin>,
    stdout: AsyncMutex<BufReader<tokio::process::ChildStdout>>,
    next_id: AsyncMutex<u64>,
}

#[derive(Clone)]
pub struct PluginManager {
    app: AppHandle,
    db: Database,
    plugins: Arc<Mutex<HashMap<String, RuntimePlugin>>>,
}

#[derive(Serialize)]
struct RpcRequest {
    jsonrpc: &'static str,
    method: String,
    params: Value,
    id: u64,
}

#[derive(Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct RpcError {
    message: String,
}

impl PluginManager {
    pub fn new(app: AppHandle, db: Database) -> Self {
        Self {
            app,
            db,
            plugins: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn rescan_blocking(&self) -> Result<(), String> {
        tauri::async_runtime::block_on(self.rescan())
    }

    pub async fn rescan(&self) -> Result<(), String> {
        self.seed_development_plugins()?;
        let plugins_dir = Database::app_plugins_dir(&self.app)?;
        let mut discovered = Vec::new();

        for entry in std::fs::read_dir(&plugins_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            let manifest = read_manifest(&manifest_path)?;
            let existing_enabled = self.db.plugin_enabled(&manifest.id)?.unwrap_or(true);
            let now = Utc::now().to_rfc3339();
            self.db.upsert_plugin(&PluginDbRecord {
                id: manifest.id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                description: manifest.description.clone(),
                path: path.to_string_lossy().to_string(),
                enabled: existing_enabled,
                installed_at: now.clone(),
                updated_at: now,
            })?;
            discovered.push((manifest, path, existing_enabled));
        }

        // Capture existing builtin state so rescan doesn't restart their processes.
        let existing_builtins: HashMap<String, (bool, Option<String>, Option<Arc<PluginProcess>>)> = {
            let guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            guard
                .iter()
                .filter(|(_, r)| r.manifest.builtin)
                .map(|(id, r)| (id.clone(), (r.loaded, r.error.clone(), r.process.clone())))
                .collect()
        };

        let mut next = HashMap::new();
        for (manifest, path, enabled) in discovered {
            if manifest.builtin {
                if let Some((loaded, error, process)) = existing_builtins.get(&manifest.id) {
                    next.insert(manifest.id.clone(), RuntimePlugin {
                        manifest,
                        path,
                        enabled,
                        loaded: *loaded,
                        error: error.clone(),
                        process: process.clone(),
                    });
                    continue;
                }
            }
            let mut runtime = RuntimePlugin {
                manifest,
                path,
                enabled,
                loaded: false,
                error: None,
                process: None,
            };
            if enabled {
                if let Err(error) = start_runtime_plugin(&mut runtime).await {
                    runtime.error = Some(error);
                }
            }
            next.insert(runtime.manifest.id.clone(), runtime);
        }

        let old = {
            let mut guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            std::mem::replace(&mut *guard, next)
        };
        for (_, plugin) in old {
            if plugin.manifest.builtin {
                continue; // process Arc now lives in `next`, don't shut it down
            }
            if let Some(process) = plugin.process {
                process.shutdown().await;
            }
        }

        Ok(())
    }

    pub fn list(&self) -> Result<Vec<PluginInfo>, String> {
        let guard = self
            .plugins
            .lock()
            .map_err(|_| "plugin lock poisoned".to_string())?;
        let mut plugins = guard
            .values()
            .map(|plugin| PluginInfo {
                id: plugin.manifest.id.clone(),
                name: plugin.manifest.name.clone(),
                version: plugin.manifest.version.clone(),
                description: plugin.manifest.description.clone(),
                path: plugin.path.to_string_lossy().to_string(),
                enabled: plugin.enabled,
                loaded: plugin.loaded,
                error: plugin.error.clone(),
                builtin: plugin.manifest.builtin,
                manifest: plugin.manifest.clone(),
            })
            .collect::<Vec<_>>();
        plugins.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(plugins)
    }

    pub async fn enable(&self, plugin_id: &str) -> Result<(), String> {
        let mut runtime = {
            let mut guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            guard
                .remove(plugin_id)
                .ok_or_else(|| format!("plugin not found: {plugin_id}"))?
        };
        runtime.enabled = true;
        runtime.error = None;
        if let Err(error) = start_runtime_plugin(&mut runtime).await {
            runtime.error = Some(error.clone());
            self.plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?
                .insert(plugin_id.to_string(), runtime);
            return Err(error);
        }
        self.db.set_plugin_enabled(plugin_id, true)?;
        self.plugins
            .lock()
            .map_err(|_| "plugin lock poisoned".to_string())?
            .insert(plugin_id.to_string(), runtime);
        Ok(())
    }

    pub async fn disable(&self, plugin_id: &str) -> Result<(), String> {
        let process = {
            let mut guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard
                .get_mut(plugin_id)
                .ok_or_else(|| format!("plugin not found: {plugin_id}"))?;
            plugin.enabled = false;
            plugin.loaded = false;
            plugin.error = None;
            plugin.process.take()
        };
        if let Some(process) = process {
            process.shutdown().await;
        }
        self.db.set_plugin_enabled(plugin_id, false)
    }

    pub async fn test_connection(&self, input: &ConnectionInput) -> Result<(), String> {
        let process = {
            let guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard
                .get(&input.plugin_id)
                .ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled {
                return Err(format!("plugin '{}' is disabled", input.plugin_id));
            }
            plugin
                .process
                .clone()
                .ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };

        process
            .call(
                "test_connection",
                json!({
                    "params": {
                        "driver": input.plugin_id,
                        "host": input.host,
                        "port": input.port,
                        "database": input.database,
                        "username": input.username,
                        "password": input.password,
                        "ssl_mode": input.ssl_mode
                    }
                }),
            )
            .await
            .map(|_| ())
    }

    pub async fn list_databases(&self, input: &ConnectionInput) -> Result<Vec<String>, String> {
        let process = {
            let guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard
                .get(&input.plugin_id)
                .ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled {
                return Err(format!("plugin '{}' is disabled", input.plugin_id));
            }
            plugin
                .process
                .clone()
                .ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };

        let result = process
            .call(
                "get_databases",
                json!({
                    "params": {
                        "driver": input.plugin_id,
                        "host": input.host,
                        "port": input.port,
                        "database": input.database,
                        "username": input.username,
                        "password": input.password,
                        "ssl_mode": input.ssl_mode
                    }
                }),
            )
            .await?;

        serde_json::from_value(result)
            .map_err(|error| format!("invalid databases response: {error}"))
    }

    pub async fn list_collections(&self, input: &ConnectionInput, database: &str) -> Result<Vec<String>, String> {
        let process = {
            let guard = self
                .plugins
                .lock()
                .map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard
                .get(&input.plugin_id)
                .ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled {
                return Err(format!("plugin '{}' is disabled", input.plugin_id));
            }
            plugin
                .process
                .clone()
                .ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };

        let params = json!({
            "params": {
                "driver": input.plugin_id,
                "host": input.host,
                "port": input.port,
                "database": database,
                "username": input.username,
                "password": input.password,
                "ssl_mode": input.ssl_mode
            }
        });

        let result = process
            .call(
                "get_collections",
                params,
            )
            .await?;

        serde_json::from_value(result)
            .map_err(|error| format!("invalid collections response: {error}"))
    }

    pub async fn get_table_data(&self, input: &ConnectionInput, database: &str, table: &str, limit: i64, offset: i64, filter: &str, cursor: &str) -> Result<TableResult, String> {
        let process = {
            let guard = self.plugins.lock().map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard.get(&input.plugin_id).ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled { return Err(format!("plugin '{}' is disabled", input.plugin_id)); }
            plugin.process.clone().ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };
        let result = process.call("get_table_data", json!({
            "params": { "driver": input.plugin_id, "host": input.host, "port": input.port, "database": input.database, "username": input.username, "password": input.password, "ssl_mode": input.ssl_mode },
            "database": database, "table": table, "limit": limit, "offset": offset, "where": filter, "cursor": cursor
        })).await?;
        serde_json::from_value(result).map_err(|e| format!("invalid table data response: {e}"))
    }

    pub async fn get_documents(&self, input: &ConnectionInput, database: &str, collection: &str, limit: i64, offset: i64, filter: &str, cursor: &str) -> Result<DocumentResult, String> {
        let process = {
            let guard = self.plugins.lock().map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard.get(&input.plugin_id).ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled { return Err(format!("plugin '{}' is disabled", input.plugin_id)); }
            plugin.process.clone().ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };
        let result = process.call("get_documents", json!({
            "params": { "driver": input.plugin_id, "host": input.host, "port": input.port, "database": input.database, "username": input.username, "password": input.password, "ssl_mode": input.ssl_mode },
            "database": database, "collection": collection, "limit": limit, "offset": offset, "filter": filter, "cursor": cursor
        })).await?;
        serde_json::from_value(result).map_err(|e| format!("invalid documents response: {e}"))
    }

    pub async fn get_key_value(&self, input: &ConnectionInput, database: &str, key: &str) -> Result<KeyValue, String> {
        let process = {
            let guard = self.plugins.lock().map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard.get(&input.plugin_id).ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled { return Err(format!("plugin '{}' is disabled", input.plugin_id)); }
            plugin.process.clone().ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };
        let result = process.call("get_key_value", json!({
            "params": { "driver": input.plugin_id, "host": input.host, "port": input.port, "database": input.database, "username": input.username, "password": input.password, "ssl_mode": input.ssl_mode },
            "database": database, "key": key
        })).await?;
        serde_json::from_value(result).map_err(|e| format!("invalid key value response: {e}"))
    }

    pub async fn list_redis_keys(&self, input: &ConnectionInput, database: &str) -> Result<Vec<RedisKey>, String> {
        let process = {
            let guard = self.plugins.lock().map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard.get(&input.plugin_id).ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled { return Err(format!("plugin '{}' is disabled", input.plugin_id)); }
            plugin.process.clone().ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };
        let result = process.call("get_keys_with_types", json!({
            "params": { "driver": input.plugin_id, "host": input.host, "port": input.port, "database": database, "username": input.username, "password": input.password, "ssl_mode": input.ssl_mode }
        })).await?;
        serde_json::from_value(result).map_err(|e| format!("invalid redis keys response: {e}"))
    }

    pub async fn get_db_metrics(&self, input: &ConnectionInput, database: &str) -> Result<Value, String> {
        let process = {
            let guard = self.plugins.lock().map_err(|_| "plugin lock poisoned".to_string())?;
            let plugin = guard.get(&input.plugin_id).ok_or_else(|| format!("plugin not found: {}", input.plugin_id))?;
            if !plugin.enabled { return Err(format!("plugin '{}' is disabled", input.plugin_id)); }
            plugin.process.clone().ok_or_else(|| format!("plugin '{}' is not loaded", input.plugin_id))?
        };
        process.call("get_metrics", json!({
            "params": { "driver": input.plugin_id, "host": input.host, "port": input.port, "database": input.database, "username": input.username, "password": input.password, "ssl_mode": input.ssl_mode },
            "database": database
        })).await
    }

    fn seed_development_plugins(&self) -> Result<(), String> {
        let app_plugins = Database::app_plugins_dir(&self.app)?;
        let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;
        let repo_plugins = if current_dir.join("plugins").exists() {
            current_dir.join("plugins")
        } else {
            current_dir.join("..").join("plugins")
        };
        if !repo_plugins.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(repo_plugins).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let source = entry.path();
            if !source.is_dir() {
                continue;
            }
            let Some(name) = source.file_name() else {
                continue;
            };
            let dest = app_plugins.join(name);
            copy_dir_all(&source, &dest)?;
        }
        Ok(())
    }
}

impl PluginProcess {
    async fn start(executable: PathBuf) -> Result<Self, String> {
        let mut child = Command::new(executable)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("failed to start plugin: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open plugin stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open plugin stdout".to_string())?;
        Ok(Self {
            child: AsyncMutex::new(child),
            stdin: AsyncMutex::new(stdin),
            stdout: AsyncMutex::new(BufReader::new(stdout)),
            next_id: AsyncMutex::new(1),
        })
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = {
            let mut guard = self.next_id.lock().await;
            let id = *guard;
            *guard += 1;
            id
        };
        let request = RpcRequest {
            jsonrpc: "2.0",
            method: method.to_string(),
            params,
            id,
        };
        let payload = serde_json::to_string(&request).map_err(|error| error.to_string())? + "\n";
        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(payload.as_bytes())
                .await
                .map_err(|error| error.to_string())?;
            stdin.flush().await.map_err(|error| error.to_string())?;
        }
        let mut line = String::new();
        timeout(Duration::from_secs(60), async {
            let mut stdout = self.stdout.lock().await;
            stdout.read_line(&mut line).await
        })
        .await
        .map_err(|_| "plugin request timed out".to_string())?
        .map_err(|error| error.to_string())?;
        let response: RpcResponse = serde_json::from_str(&line)
            .map_err(|error| format!("invalid plugin response: {error}"))?;
        if let Some(error) = response.error {
            return Err(error.message);
        }
        Ok(response.result.unwrap_or(Value::Null))
    }

    async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        if let Err(error) = child.kill().await {
            eprintln!("warning: failed to kill plugin process: {error}");
        }
    }
}

async fn start_runtime_plugin(runtime: &mut RuntimePlugin) -> Result<(), String> {
    let executable = runtime.path.join(&runtime.manifest.executable);
    if !executable.exists() {
        return Err(format!(
            "plugin executable not found: {}. Run `pnpm plugins:build` and then refresh plugins.",
            executable.display()
        ));
    }
    let process = Arc::new(PluginProcess::start(executable).await?);
    process.call("initialize", json!({ "settings": {} })).await?;
    runtime.loaded = true;
    runtime.process = Some(process);
    Ok(())
}

fn read_manifest(path: &Path) -> Result<PluginManifest, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn default_color() -> String {
    "#2563eb".to_string()
}

fn copy_dir_all(source: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|error| error.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let next_dest = dest.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_all(&entry.path(), &next_dest)?;
        } else {
            std::fs::copy(entry.path(), next_dest).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
