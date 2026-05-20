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

/// First-run seeding for the multi-org system:
///   • Always ensure a "Local" org (id=1 conceptually, no server) exists.
///   • If the legacy `sync.server_url` setting exists, create a "Default" org
///     bound to it and migrate any orphan connections/credentials/groups under it.
fn seed_default_orgs(conn: &Connection) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let local_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM organizations WHERE server_kind = 'local' LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let local_id = match local_id {
        Some(id) => id,
        None => {
            conn.execute(
                "INSERT INTO organizations (name, server_url, server_kind, accent_color, position, created_at, updated_at) VALUES (?1, NULL, 'local', ?2, 0, ?3, ?3)",
                params!["Local", "#71717a", now],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        }
    };

    let legacy_url: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = 'sync.server_url'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
        .filter(|s| !s.trim().is_empty());

    let default_id: Option<i64> = if let Some(url) = legacy_url {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM organizations WHERE server_url = ?1",
                params![url],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match existing {
            Some(id) => Some(id),
            None => {
                conn.execute(
                    "INSERT INTO organizations (name, server_url, server_kind, accent_color, position, created_at, updated_at) VALUES (?1, ?2, 'manual', ?3, 1, ?4, ?4)",
                    params!["Default", url, "#0ea5e9", now],
                )
                .map_err(|e| e.to_string())?;
                Some(conn.last_insert_rowid())
            }
        }
    } else {
        None
    };

    // Backfill: rows without org_id go to Default (if exists) else Local.
    let target_id = default_id.unwrap_or(local_id);
    for table in ["connections", "credentials", "connection_groups"] {
        let sql = format!("UPDATE {table} SET org_id = ?1 WHERE org_id IS NULL");
        conn.execute(&sql, params![target_id]).map_err(|e| e.to_string())?;
    }

    // Persist active_org_id default if unset.
    let active: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = 'app.active_org_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if active.is_none() {
        conn.execute(
            "INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES ('app.active_org_id', ?1, ?2)",
            params![target_id.to_string(), now],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
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

fn map_app_user_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AppUserRecord> {
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgRowLite {
    pub id: i64,
    pub name: String,
    pub server_url: Option<String>,
    pub server_kind: String,
    pub accent_color: Option<String>,
    pub remote_id: Option<String>,
    pub role: Option<String>,
    pub cert_fingerprint: Option<String>,
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
        db.maybe_apply_server_first_wipe()?;
        db.maybe_apply_passphrase_purge()?;
        Ok(db)
    }

    /// Post-passphrase-removal cleanup. Installs that ran the v2 wipe and
    /// then *re-set* a passphrase via the old WelcomePage flow have residual
    /// `auth.passphrase_salt` / `auth.master_key_wrapped` rows lying around.
    /// Drop them once; the keychain entry under `master-key` is left to age
    /// out naturally (keyring crate doesn't expose a "delete all under
    /// service" sweep without enumerating accounts).
    fn maybe_apply_passphrase_purge(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            let done: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key = 'app.passphrase_purged'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if done.is_some() {
                return Ok(());
            }
            conn.execute_batch(
                r#"
                DELETE FROM app_settings WHERE key LIKE 'auth.passphrase_salt%';
                DELETE FROM app_settings WHERE key LIKE 'auth.master_key_wrapped%';
                DELETE FROM app_settings WHERE key LIKE 'auth.biometry_enabled%';
                "#,
            )
            .map_err(|e| e.to_string())?;
            crate::keychain::delete("master-key");
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('app.passphrase_purged', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![format!("\"{now}\""), now],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    /// Server-first refactor migration: once the user has acknowledged the
    /// export modal (F0), drop all legacy data tables that have moved to the
    /// server. Idempotent — checks an `app_settings` flag so it only runs
    /// once.
    ///
    /// Preserves only the cross-boot settings the UI needs to bootstrap:
    /// theme/locale/zoom/shortcuts. **Wipes** legacy data tables AND the
    /// `organizations` catalog + `app.active_org_id` setting so the user
    /// lands on WelcomePage with a clean slate. Legacy "Default" rows
    /// pointing at the old `sync.server_url` would otherwise survive and
    /// pollute the org switcher.
    fn maybe_apply_server_first_wipe(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            let acked: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key = 'app.migration_export_acked'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if acked.is_none() {
                return Ok(());
            }
            // Versioned wipe flag. Bumping the suffix re-runs the wipe so
            // installs that ran an earlier (partial) wipe still get the new
            // sweep — e.g. when we extend the DROP list to include
            // `organizations` after legacy "Default" rows survived.
            let already_wiped: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key = 'app.server_first_wiped.v2'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if already_wiped.is_some() {
                return Ok(());
            }
            // NOTE: `plugins` + `plugin_settings` are NOT dropped — they are
            // the PluginManager's local runtime cache (enabled flag, settings
            // overrides), not user data, and the manager queries them at boot
            // before migrate() recreates them. Dropping them would panic on
            // first launch with "no such table: plugins".
            conn.execute_batch(
                r#"
                DROP TABLE IF EXISTS connections;
                DROP TABLE IF EXISTS connection_groups;
                DROP TABLE IF EXISTS credentials;
                DROP TABLE IF EXISTS sessions;
                DROP TABLE IF EXISTS sync_state;
                DROP TABLE IF EXISTS app_user;
                DROP TABLE IF EXISTS organizations;
                DROP TABLE IF EXISTS sync_outbox;
                DELETE FROM app_settings WHERE key IN (
                    'app.active_org_id',
                    'sync.server_url',
                    'app.discovered_servers',
                    'auth.passphrase_salt',
                    'auth.master_key_wrapped',
                    'local.admin_token'
                );
                DELETE FROM app_settings WHERE key LIKE 'auth.passphrase_salt.org_%';
                DELETE FROM app_settings WHERE key LIKE 'auth.master_key_wrapped.org_%';
                DELETE FROM app_settings WHERE key LIKE 'auth.biometry_enabled.org_%';
                "#,
            )
            .map_err(|e| e.to_string())?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('app.server_first_wiped.v2', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                params![format!("\"{now}\""), now],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
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

                CREATE TABLE IF NOT EXISTS organizations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    server_url TEXT,
                    server_kind TEXT NOT NULL DEFAULT 'local',
                    cert_fingerprint TEXT,
                    accent_color TEXT,
                    icon_url TEXT,
                    version TEXT,
                    last_health_check TEXT,
                    last_health_ok INTEGER NOT NULL DEFAULT 0,
                    user_email TEXT,
                    user_id TEXT,
                    role TEXT,
                    vault_salt BLOB,
                    vault_wrapped BLOB,
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_org_server_url ON organizations(server_url) WHERE server_url IS NOT NULL;
                "#,
            )
            .map_err(|error| error.to_string())?;
            add_column_if_missing(conn, "connections", "position", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_missing(conn, "connections", "credential_id", "INTEGER REFERENCES credentials(id)")?;
            add_column_if_missing(conn, "connections", "deleted_at", "TEXT")?;
            add_column_if_missing(conn, "connections", "notes", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "connections", "color", "TEXT")?;
            add_column_if_missing(conn, "connections", "org_id", "INTEGER REFERENCES organizations(id)")?;
            add_column_if_missing(conn, "connection_groups", "deleted_at", "TEXT")?;
            add_column_if_missing(conn, "connection_groups", "parent_id", "INTEGER REFERENCES connection_groups(id)")?;
            add_column_if_missing(conn, "connection_groups", "org_id", "INTEGER REFERENCES organizations(id)")?;
            add_column_if_missing(conn, "credentials", "org_id", "INTEGER REFERENCES organizations(id)")?;
            add_column_if_missing(conn, "organizations", "remote_id", "TEXT")?;
            // Skip auto-seeding "Local" + "Default" orgs once the server-first
            // wipe has run. From that point the WelcomePage is the only
            // legitimate path to materialize an org, so the user has to pick
            // Local-or-Remote explicitly.
            let post_wipe: bool = conn
                .query_row(
                    "SELECT 1 FROM app_settings WHERE key = 'app.server_first_wiped.v2'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if !post_wipe {
                seed_default_orgs(conn)?;
            }
            Ok(())
        })
    }

    pub fn list_org_ids(&self) -> Result<Vec<i64>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT id FROM organizations ORDER BY position ASC, id ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        })
    }

    pub fn get_org(&self, id: i64) -> Result<Option<OrgRowLite>, String> {
        self.with_conn(|conn| {
            conn.query_row(
                "SELECT id, name, server_url, server_kind, accent_color, remote_id, role, cert_fingerprint FROM organizations WHERE id = ?1",
                params![id],
                |row| Ok(OrgRowLite {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    server_url: row.get(2)?,
                    server_kind: row.get(3)?,
                    accent_color: row.get(4)?,
                    remote_id: row.get(5)?,
                    role: row.get(6)?,
                    cert_fingerprint: row.get(7)?,
                }),
            )
            .optional()
            .map_err(|e| e.to_string())
        })
    }

    pub fn set_org_remote_id(&self, id: i64, remote: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE organizations SET remote_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![remote, Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn set_org_user_link(&self, id: i64, user_id: &str, user_email: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE organizations SET user_id = ?1, user_email = ?2, updated_at = ?3 WHERE id = ?4",
                params![user_id, user_email, Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn set_org_cert_fingerprint(&self, id: i64, fingerprint: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE organizations SET cert_fingerprint = ?1, updated_at = ?2 WHERE id = ?3",
                params![fingerprint, Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn set_org_health(&self, id: i64, ok: bool) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE organizations SET last_health_ok = ?1, last_health_check = ?2 WHERE id = ?3",
                params![if ok { 1 } else { 0 }, Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionRecord>, String> {
        let org_id = self.active_org_id()?;
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, plugin_id, host, port, database, username, password, ssl_mode, settings_json, group_id, enabled, position, credential_id, created_at, updated_at
                     FROM connections WHERE deleted_at IS NULL AND COALESCE(org_id, ?1) = ?1 ORDER BY position ASC, updated_at DESC",
                )
                .map_err(|error| error.to_string())?;
            let rows = stmt
                .query_map(params![org_id], |row| map_connection_row(row))
                .map_err(|error| error.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
        })
    }

    /// Returns the currently active organization id. Falls back to the lowest
    /// `local` org id if the setting is missing or invalid.
    pub fn active_org_id(&self) -> Result<i64, String> {
        self.with_conn(|conn| {
            let raw: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM app_settings WHERE key = 'app.active_org_id'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if let Some(raw) = raw {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let id = match parsed {
                        serde_json::Value::Number(n) => n.as_i64(),
                        serde_json::Value::String(s) => s.parse::<i64>().ok(),
                        _ => None,
                    };
                    if let Some(id) = id {
                        return Ok(id);
                    }
                }
            }
            conn.query_row(
                "SELECT id FROM organizations WHERE server_kind = 'local' ORDER BY id ASC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())
        })
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    pub fn list_groups(&self) -> Result<Vec<GroupRecord>, String> {
        let org_id = self.active_org_id()?;
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, parent_id, sort_order, created_at, updated_at FROM connection_groups WHERE deleted_at IS NULL AND COALESCE(org_id, ?1) = ?1 ORDER BY sort_order ASC, name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![org_id], |row| {
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

    // ── Credentials ───────────────────────────────────────────────────────────

    pub fn list_credentials(&self) -> Result<Vec<CredentialRecord>, String> {
        let org_id = self.active_org_id()?;
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT id, name, username, encrypted_password, encrypted_meta, created_at, updated_at FROM credentials WHERE deleted_at IS NULL AND COALESCE(org_id, ?1) = ?1 ORDER BY name ASC",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![org_id], |row| {
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

    // ── App user (one row per identity) ──────────────────────────────────────


    pub fn get_app_user(&self) -> Result<Option<AppUserRecord>, String> {
        // Resolve the user tied to the active org. Multiple rows can coexist
        // (synthetic `__local__` + one OAuth identity per remote org), so the
        // old `LIMIT 1` would return whichever row inserted first — usually
        // the local one — even after the user signed into a remote.
        let active_org = self.active_org_id().ok();
        self.with_conn(|conn| {
            // 1. If the active org has `user_id` set (remote OAuth join), use
            //    that exact row.
            if let Some(org_id) = active_org {
                // `user_id` column is NULL when the org has never been OAuth-
                // linked (legacy seed, fresh local install). Using `String`
                // here would surface NULLs as rusqlite errors, propagate up
                // through `?`, and surface to JS as a rejected invoke — which
                // makes the entire `auth_current_user` lookup return null
                // even though the synthetic `__local__` row exists.
                let linked: Option<String> = conn
                    .query_row(
                        "SELECT user_id FROM organizations WHERE id = ?1",
                        params![org_id],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?
                    .flatten();
                if let Some(uid) = linked.as_deref().filter(|s| !s.is_empty()) {
                    let row = conn
                        .query_row(
                            "SELECT user_id, email, name, avatar_url, linked_providers, master_key_enc_blob, session_token_ref, last_synced_at FROM app_user WHERE user_id = ?1",
                            params![uid],
                            map_app_user_row,
                        )
                        .optional()
                        .map_err(|e| e.to_string())?;
                    if row.is_some() {
                        return Ok(row);
                    }
                }
                // 2. Local org with no linked `user_id` → use the synthetic.
                let kind: Option<String> = conn
                    .query_row(
                        "SELECT server_kind FROM organizations WHERE id = ?1",
                        params![org_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                if kind.as_deref() == Some("local") {
                    return conn
                        .query_row(
                            "SELECT user_id, email, name, avatar_url, linked_providers, master_key_enc_blob, session_token_ref, last_synced_at FROM app_user WHERE user_id = '__local__'",
                            [],
                            map_app_user_row,
                        )
                        .optional()
                        .map_err(|e| e.to_string());
                }
            }
            // 3. No active org or remote without linked user → any row (legacy fallback).
            conn.query_row(
                "SELECT user_id, email, name, avatar_url, linked_providers, master_key_enc_blob, session_token_ref, last_synced_at FROM app_user LIMIT 1",
                [],
                map_app_user_row,
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

    pub fn list_app_settings_for_export(&self) -> Result<Vec<(String, String)>, String> {
        self.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT key, value_json FROM app_settings ORDER BY key")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| e.to_string())?);
            }
            Ok(out)
        })
    }

    pub fn schema_version(&self) -> Result<u32, String> {
        self.with_conn(|conn| {
            conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .map(|v| v as u32)
                .map_err(|e| e.to_string())
        })
    }

    /// True iff any legacy table (will be dropped in the upcoming migration)
    /// contains at least one row. Used to decide whether to show the export
    /// modal on app launch.
    pub fn has_any_legacy_data(&self) -> Result<bool, String> {
        self.with_conn(|conn| {
            for table in &["connections", "credentials", "connection_groups"] {
                let exists: i64 = conn
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                        params![table],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if exists == 0 {
                    continue;
                }
                let n: i64 = conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                    .map_err(|e| e.to_string())?;
                if n > 0 {
                    return Ok(true);
                }
            }
            Ok(false)
        })
    }

    pub fn delete_app_setting(&self, key: &str) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
                .map_err(|e| e.to_string())?;
            Ok(())
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

    pub fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
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

    /// Drop any cached UI session snapshot. Called by the server-first wipe
    /// hook so stale "open tab" rows don't survive a reset.
    pub fn clear_sessions(&self) -> Result<(), String> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM kv WHERE key = 'sessions'", [])
                .map_err(|e| e.to_string())?;
            Ok(())
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
