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

fn mark_dirty(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    local_updated_at: &str,
    deleted_at: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_state (entity_type, entity_id, local_updated_at, dirty, deleted_at) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT(entity_type, entity_id) DO UPDATE SET local_updated_at = excluded.local_updated_at, dirty = 1, deleted_at = COALESCE(excluded.deleted_at, sync_state.deleted_at)",
        params![entity_type, entity_id, local_updated_at, deleted_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn map_connection_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionRecord> {
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
        position: row.get(12)?,
        credential_id: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> Result<(), String> {
    let exists: bool = {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let cols = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        let mut found = false;
        for col in cols {
            if col.map_err(|e| e.to_string())? == column {
                found = true;
                break;
            }
        }
        found
    };
    if exists {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    pub position: i64,
    pub credential_id: Option<i64>,
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
    #[serde(default)]
    pub credential_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRecord {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRecord {
    pub id: i64,
    pub name: String,
    pub username: String,
    pub encrypted_password: String,
    pub encrypted_meta: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppUserRecord {
    pub user_id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub linked_providers: String,
    pub master_key_enc_blob: Option<String>,
    pub session_token_ref: Option<String>,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEnvelope {
    pub entity_type: String,
    pub entity_id: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub ciphertext: String,
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

                CREATE TABLE IF NOT EXISTS credentials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    username TEXT NOT NULL,
                    encrypted_password TEXT NOT NULL,
                    encrypted_meta TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );

                CREATE TABLE IF NOT EXISTS app_user (
                    user_id TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    name TEXT,
                    avatar_url TEXT,
                    linked_providers TEXT NOT NULL DEFAULT '[]',
                    master_key_enc_blob TEXT,
                    session_token_ref TEXT,
                    last_synced_at TEXT
                );

                CREATE TABLE IF NOT EXISTS sync_state (
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    local_updated_at TEXT NOT NULL,
                    remote_updated_at TEXT,
                    dirty INTEGER NOT NULL DEFAULT 1,
                    deleted_at TEXT,
                    PRIMARY KEY (entity_type, entity_id)
                );

                CREATE INDEX IF NOT EXISTS idx_sync_state_dirty ON sync_state(dirty) WHERE dirty = 1;
                "#,
            )
            .map_err(|error| error.to_string())?;
            add_column_if_missing(conn, "connections", "position", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_missing(conn, "connections", "credential_id", "INTEGER REFERENCES credentials(id)")?;
            add_column_if_missing(conn, "connections", "deleted_at", "TEXT")?;
            add_column_if_missing(conn, "connection_groups", "deleted_at", "TEXT")?;
            add_column_if_missing(conn, "connection_groups", "parent_id", "INTEGER REFERENCES connection_groups(id)")?;
            Ok(())
        })
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, position, credential_id, created_at, updated_at
                     FROM connections WHERE deleted_at IS NULL ORDER BY position ASC, updated_at DESC",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map([], |row| Ok(map_connection_row(row)?))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
        })
    }

    pub fn create_connection(&self, input: ConnectionInput) -> Result<ConnectionRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let next_position: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM connections WHERE COALESCE(group_id, 0) = COALESCE(?1, 0)",
                    params![input.group_id],
                    |row| row.get(0),
                )
                .map_err(|error| error.to_string())?;
            conn.execute(
                "INSERT INTO connections (name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, position, credential_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
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
                    next_position,
                    input.credential_id,
                    now,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
            let id = conn.last_insert_rowid();
            mark_dirty(conn, "connection", &id.to_string(), &now, None)?;
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
                "UPDATE connections SET name = ?1, plugin_id = ?2, host = ?3, port = ?4, database = ?5, username = ?6, password = ?7, ssl_mode = ?8, settings_json = ?9, group_id = ?10, enabled = ?11, credential_id = ?12, updated_at = ?13 WHERE id = ?14",
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
                    input.credential_id,
                    now,
                    id
                ],
            )
            .map_err(|error| error.to_string())?;
            if rows == 0 {
                return Err(format!("connection not found: {id}"));
            }
            mark_dirty(conn, "connection", &id.to_string(), &now, None)?;
            self.get_connection_by_id_locked(conn, id)
        })
    }

    pub fn reorder_connections(&self, ids: &[i64]) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            for (idx, id) in ids.iter().enumerate() {
                conn.execute(
                    "UPDATE connections SET position = ?1, updated_at = ?2 WHERE id = ?3",
                    params![idx as i64, now, id],
                )
                .map_err(|error| error.to_string())?;
                mark_dirty(conn, "connection", &id.to_string(), &now, None)?;
            }
            Ok(())
        })
    }

    pub fn move_connection_to_group(
        &self,
        connection_id: i64,
        group_id: Option<i64>,
        position: i64,
    ) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE connections SET position = ?1, group_id = ?2, updated_at = ?3 WHERE id = ?4",
                params![position, group_id, now, connection_id],
            )
            .map_err(|error| error.to_string())?;
            mark_dirty(conn, "connection", &connection_id.to_string(), &now, None)?;
            Ok(())
        })
    }

    pub fn attach_credential_to_connection(
        &self,
        connection_id: i64,
        credential_id: Option<i64>,
    ) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let rows = if credential_id.is_some() {
                conn.execute(
                    "UPDATE connections SET credential_id = ?1, password = '', updated_at = ?2 WHERE id = ?3",
                    params![credential_id, now, connection_id],
                )
            } else {
                conn.execute(
                    "UPDATE connections SET credential_id = NULL, updated_at = ?1 WHERE id = ?2",
                    params![now, connection_id],
                )
            }
            .map_err(|error| error.to_string())?;
            if rows == 0 {
                return Err(format!("connection not found: {connection_id}"));
            }
            mark_dirty(conn, "connection", &connection_id.to_string(), &now, None)?;
            Ok(())
        })
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    pub fn list_groups(&self) -> Result<Vec<GroupRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM connection_groups WHERE deleted_at IS NULL ORDER BY sort_order ASC, name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(GroupRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn create_group(
        &self,
        name: &str,
        parent_id: Option<i64>,
    ) -> Result<GroupRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let next: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM connection_groups",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO connection_groups (name, parent_id, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![name, parent_id, next, now, now],
            )
            .map_err(|e| e.to_string())?;
            let id = conn.last_insert_rowid();
            mark_dirty(conn, "group", &id.to_string(), &now, None)?;
            Ok(GroupRecord {
                id,
                name: name.to_string(),
                parent_id,
                sort_order: next,
                created_at: now.clone(),
                updated_at: now,
            })
        })
    }

    pub fn update_group(&self, id: i64, name: &str) -> Result<GroupRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let rows = conn
                .execute(
                    "UPDATE connection_groups SET name = ?1, updated_at = ?2 WHERE id = ?3",
                    params![name, now, id],
                )
                .map_err(|e| e.to_string())?;
            if rows == 0 {
                return Err(format!("group not found: {id}"));
            }
            mark_dirty(conn, "group", &id.to_string(), &now, None)?;
            conn.query_row(
                "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM connection_groups WHERE id = ?1",
                params![id],
                |row| {
                    Ok(GroupRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        parent_id: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                },
            )
            .map_err(|e| e.to_string())
        })
    }

    pub fn delete_group(
        &self,
        id: i64,
        reassign_to: Option<i64>,
    ) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE connections SET group_id = ?1, updated_at = ?2 WHERE group_id = ?3",
                params![reassign_to, now, id],
            )
            .map_err(|e| e.to_string())?;
            let rows = conn
                .execute(
                    "UPDATE connection_groups SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![now, id],
                )
                .map_err(|e| e.to_string())?;
            if rows == 0 {
                return Err(format!("group not found: {id}"));
            }
            mark_dirty(conn, "group", &id.to_string(), &now, Some(&now))?;
            Ok(())
        })
    }

    pub fn reorder_groups(&self, ids: &[i64]) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            for (idx, id) in ids.iter().enumerate() {
                conn.execute(
                    "UPDATE connection_groups SET sort_order = ?1, updated_at = ?2 WHERE id = ?3",
                    params![idx as i64, now, id],
                )
                .map_err(|e| e.to_string())?;
                mark_dirty(conn, "group", &id.to_string(), &now, None)?;
            }
            Ok(())
        })
    }

    // ── Credentials ───────────────────────────────────────────────────────────

    pub fn list_credentials(&self) -> Result<Vec<CredentialRecord>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, username, encrypted_password, encrypted_meta, created_at, updated_at FROM credentials WHERE deleted_at IS NULL ORDER BY name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(CredentialRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        username: row.get(2)?,
                        encrypted_password: row.get(3)?,
                        encrypted_meta: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn get_credential(&self, id: i64) -> Result<CredentialRecord, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT id, name, username, encrypted_password, encrypted_meta, created_at, updated_at FROM credentials WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |row| {
                    Ok(CredentialRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        username: row.get(2)?,
                        encrypted_password: row.get(3)?,
                        encrypted_meta: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
            .map_err(|e| e.to_string())
        })
    }

    pub fn create_credential(
        &self,
        name: &str,
        username: &str,
        encrypted_password: &str,
        encrypted_meta: &str,
    ) -> Result<CredentialRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO credentials (name, username, encrypted_password, encrypted_meta, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![name, username, encrypted_password, encrypted_meta, now],
            )
            .map_err(|e| e.to_string())?;
            let id = conn.last_insert_rowid();
            mark_dirty(conn, "credential", &id.to_string(), &now, None)?;
            Ok(CredentialRecord {
                id,
                name: name.to_string(),
                username: username.to_string(),
                encrypted_password: encrypted_password.to_string(),
                encrypted_meta: encrypted_meta.to_string(),
                created_at: now.clone(),
                updated_at: now,
            })
        })
    }

    pub fn update_credential(
        &self,
        id: i64,
        name: &str,
        username: &str,
        encrypted_password: Option<&str>,
        encrypted_meta: Option<&str>,
    ) -> Result<CredentialRecord, String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            if let Some(pw) = encrypted_password {
                conn.execute(
                    "UPDATE credentials SET name = ?1, username = ?2, encrypted_password = ?3, encrypted_meta = COALESCE(?4, encrypted_meta), updated_at = ?5 WHERE id = ?6",
                    params![name, username, pw, encrypted_meta, now, id],
                )
            } else {
                conn.execute(
                    "UPDATE credentials SET name = ?1, username = ?2, encrypted_meta = COALESCE(?3, encrypted_meta), updated_at = ?4 WHERE id = ?5",
                    params![name, username, encrypted_meta, now, id],
                )
            }
            .map_err(|e| e.to_string())?;
            mark_dirty(conn, "credential", &id.to_string(), &now, None)?;
            self.get_credential_locked(conn, id)
        })
    }

    pub fn delete_credential(&self, id: i64) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE credentials SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                params![now, id],
            )
            .map_err(|e| e.to_string())?;
            mark_dirty(conn, "credential", &id.to_string(), &now, Some(&now))?;
            Ok(())
        })
    }

    fn get_credential_locked(
        &self,
        conn: &Connection,
        id: i64,
    ) -> Result<CredentialRecord, String> {
        conn.query_row(
            "SELECT id, name, username, encrypted_password, encrypted_meta, created_at, updated_at FROM credentials WHERE id = ?1",
            params![id],
            |row| {
                Ok(CredentialRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    username: row.get(2)?,
                    encrypted_password: row.get(3)?,
                    encrypted_meta: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    // ── App user (single row) ─────────────────────────────────────────────────

    pub fn get_app_user(&self) -> Result<Option<AppUserRecord>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT user_id, email, name, avatar_url, linked_providers, master_key_enc_blob, session_token_ref, last_synced_at FROM app_user LIMIT 1",
                [],
                |row| {
                    Ok(AppUserRecord {
                        user_id: row.get(0)?,
                        email: row.get(1)?,
                        name: row.get(2)?,
                        avatar_url: row.get(3)?,
                        linked_providers: row.get(4)?,
                        master_key_enc_blob: row.get(5)?,
                        session_token_ref: row.get(6)?,
                        last_synced_at: row.get(7)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    pub fn upsert_app_user(&self, user: &AppUserRecord) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO app_user (user_id, email, name, avatar_url, linked_providers, master_key_enc_blob, session_token_ref, last_synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, linked_providers = excluded.linked_providers, master_key_enc_blob = COALESCE(excluded.master_key_enc_blob, app_user.master_key_enc_blob), session_token_ref = COALESCE(excluded.session_token_ref, app_user.session_token_ref), last_synced_at = COALESCE(excluded.last_synced_at, app_user.last_synced_at)",
                params![
                    user.user_id,
                    user.email,
                    user.name,
                    user.avatar_url,
                    user.linked_providers,
                    user.master_key_enc_blob,
                    user.session_token_ref,
                    user.last_synced_at,
                ],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn clear_app_user(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM app_user", [])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn set_last_synced_at(&self, when: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE app_user SET last_synced_at = ?1",
                params![when],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    // ── Sync state ────────────────────────────────────────────────────────────

    pub fn list_dirty_sync(&self) -> Result<Vec<(String, String, String, Option<String>)>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT entity_type, entity_id, local_updated_at, deleted_at FROM sync_state WHERE dirty = 1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn clear_dirty_sync(
        &self,
        entries: &[(String, String, String)],
    ) -> Result<(), String> {
        self.with_conn(|conn| {
            for (entity_type, entity_id, remote_updated_at) in entries {
                conn.execute(
                    "UPDATE sync_state SET dirty = 0, remote_updated_at = ?1 WHERE entity_type = ?2 AND entity_id = ?3",
                    params![remote_updated_at, entity_type, entity_id],
                )
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        })
    }

    // ── App settings ──────────────────────────────────────────────────────────

    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    pub fn set_app_setting(&self, key: &str, value_json: &str) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![key, value_json, now],
            )
            .map_err(|e| e.to_string())?;
            mark_dirty(conn, "app_setting", key, &now, None)?;
            Ok(())
        })
    }

    pub fn delete_connection(&self, id: i64) -> Result<(), String> {
        let now = Utc::now().to_rfc3339();
        self.with_conn(|conn| {
            let rows = conn
                .execute(
                    "UPDATE connections SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
                    params![now, id],
                )
                .map_err(|error| error.to_string())?;
            if rows == 0 {
                return Err(format!("connection not found: {id}"));
            }
            mark_dirty(conn, "connection", &id.to_string(), &now, Some(&now))?;
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
            "SELECT id, name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, position, credential_id, created_at, updated_at FROM connections WHERE id = ?1",
            params![id],
            |row| map_connection_row(row),
        )
        .map_err(|error| error.to_string())
    }

    pub fn get_connection(&self, id: i64) -> Result<ConnectionRecord, String> {
        self.with_conn(|conn| self.get_connection_by_id_locked(conn, id))
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
