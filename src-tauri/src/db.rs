use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRecord {
    pub id: i64,
    pub name: String,
    pub plugin_id: String,
    pub host: String,
    pub port: Option<i64>,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: String,
    pub settings_json: String,
    pub group_id: Option<i64>,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInput {
    pub name: String,
    pub plugin_id: String,
    pub host: String,
    pub port: Option<i64>,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: String,
    pub settings_json: String,
    pub group_id: Option<i64>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDbRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub enabled: bool,
    pub installed_at: String,
    pub updated_at: String,
}

impl Database {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("app data dir unavailable: {error}"))?;
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("failed to create app data dir: {error}"))?;
        let path = dir.join("db.sqlite");
        let conn =
            Connection::open(path).map_err(|error| format!("failed to open db.sqlite: {error}"))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS connection_groups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS connections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    plugin_id TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER,
                    database TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL DEFAULT '',
                    password TEXT NOT NULL DEFAULT '',
                    ssl_mode TEXT NOT NULL DEFAULT '',
                    settings_json TEXT NOT NULL DEFAULT '{}',
                    group_id INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(group_id) REFERENCES connection_groups(id)
                );

                CREATE TABLE IF NOT EXISTS plugins (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    version TEXT NOT NULL,
                    description TEXT NOT NULL,
                    path TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    installed_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plugin_settings (
                    plugin_id TEXT PRIMARY KEY,
                    settings_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                "#,
            )
            .map_err(|error| error.to_string())
        })
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, created_at, updated_at
                     FROM connections ORDER BY updated_at DESC",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(ConnectionRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        plugin_id: row.get(2)?,
                        host: row.get(3)?,
                        port: row.get(4)?,
                        database: row.get(5)?,
                        username: row.get(6)?,
                        password: row.get(7)?,
                        ssl_mode: row.get(8)?,
                        settings_json: row.get(9)?,
                        group_id: row.get(10)?,
                        enabled: row.get::<_, i64>(11)? == 1,
                        created_at: row.get(12)?,
                        updated_at: row.get(13)?,
                    })
                })
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
        })
    }

    pub fn create_connection(&self, input: ConnectionInput) -> Result<ConnectionRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO connections (name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    input.name,
                    input.plugin_id,
                    input.host,
                    input.port,
                    input.database,
                    input.username,
                    input.password,
                    input.ssl_mode,
                    input.settings_json,
                    input.group_id,
                    if input.enabled { 1 } else { 0 },
                    now,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
            let id = conn.last_insert_rowid();
            self.get_connection_by_id_locked(conn, id)
        })
    }

    pub fn update_connection(
        &self,
        id: i64,
        input: ConnectionInput,
    ) -> Result<ConnectionRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let rows = conn.execute(
                "UPDATE connections SET name = ?1, plugin_id = ?2, host = ?3, port = ?4, database = ?5, username = ?6, password = ?7, ssl_mode = ?8, settings_json = ?9, group_id = ?10, enabled = ?11, updated_at = ?12 WHERE id = ?13",
                params![
                    input.name,
                    input.plugin_id,
                    input.host,
                    input.port,
                    input.database,
                    input.username,
                    input.password,
                    input.ssl_mode,
                    input.settings_json,
                    input.group_id,
                    if input.enabled { 1 } else { 0 },
                    now,
                    id
                ],
            )
            .map_err(|error| error.to_string())?;
            if rows == 0 {
                return Err(format!("connection not found: {id}"));
            }
            self.get_connection_by_id_locked(conn, id)
        })
    }

    pub fn delete_connection(&self, id: i64) -> Result<(), String> {
        self.with_conn(|conn| {
            let rows = conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
                .map_err(|error| error.to_string())?;
            if rows == 0 {
                return Err(format!("connection not found: {id}"));
            }
            Ok(())
        })
    }

    pub fn upsert_plugin(&self, plugin: &PluginDbRecord) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO plugins (id, name, version, description, path, enabled, installed_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, description = excluded.description, path = excluded.path, updated_at = excluded.updated_at",
                params![
                    plugin.id,
                    plugin.name,
                    plugin.version,
                    plugin.description,
                    plugin.path,
                    if plugin.enabled { 1 } else { 0 },
                    plugin.installed_at,
                    plugin.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn set_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE plugins SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
                params![if enabled { 1 } else { 0 }, now, plugin_id],
            )
            .map_err(|error| error.to_string())?;
            Ok(())
        })
    }

    pub fn plugin_enabled(&self, plugin_id: &str) -> Result<Option<bool>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT enabled FROM plugins WHERE id = ?1",
                params![plugin_id],
                |row| Ok(row.get::<_, i64>(0)? == 1),
            )
            .optional()
            .map_err(|error| error.to_string())
        })
    }

    pub fn app_plugins_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("app data dir unavailable: {error}"))?
            .join("plugins");
        std::fs::create_dir_all(&dir)
            .map_err(|error| format!("failed to create plugins dir: {error}"))?;
        Ok(dir)
    }

    fn get_connection_by_id_locked(
        &self,
        conn: &Connection,
        id: i64,
    ) -> Result<ConnectionRecord, String> {
        conn.query_row(
            "SELECT id, name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, created_at, updated_at FROM connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(ConnectionRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    plugin_id: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    database: row.get(5)?,
                    username: row.get(6)?,
                    password: row.get(7)?,
                    ssl_mode: row.get(8)?,
                    settings_json: row.get(9)?,
                    group_id: row.get(10)?,
                    enabled: row.get::<_, i64>(11)? == 1,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            },
        )
        .map_err(|error| error.to_string())
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "database lock poisoned".to_string())?;
        f(&guard)
    }
}

// ── Sessions DB ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct SessionsDb {
    conn: Arc<Mutex<Connection>>,
}

impl SessionsDb {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let home = app
            .path()
            .home_dir()
            .map_err(|e| format!("home dir unavailable: {e}"))?;
        let dir = home.join("database-manager");
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("failed to create sessions dir: {e}"))?;
        let path = dir.join("sessions.db");
        let conn = Connection::open(&path)
            .map_err(|e| format!("failed to open sessions.db: {e}"))?;
        let db = Self { conn: Arc::new(Mutex::new(conn)) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
            )
            .map_err(|e| e.to_string())
        })
    }

    pub fn save_sessions(&self, data: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR REPLACE INTO kv (key, value) VALUES ('sessions', ?1)",
                params![data],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn load_sessions(&self) -> Result<Option<String>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT value FROM kv WHERE key = 'sessions'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| "sessions db lock poisoned".to_string())?;
        f(&guard)
    }
}
