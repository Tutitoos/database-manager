use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub linked_providers: String,
    pub master_key_enc_blob: Option<String>,
}

impl Store {
    pub fn open(path: &str) -> Result<Self> {
        if let Some(parent) = Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                name TEXT,
                avatar_url TEXT,
                linked_providers TEXT NOT NULL DEFAULT '[]',
                master_key_enc_blob TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS oauth_codes (
                code TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orgs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                accent_color TEXT,
                icon_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS org_members (
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
                joined_at TEXT NOT NULL,
                PRIMARY KEY (org_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
            CREATE TABLE IF NOT EXISTS org_invites (
                token TEXT PRIMARY KEY,
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')),
                created_by TEXT NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_by TEXT REFERENCES users(id),
                used_at TEXT
            );
            -- F1a: server-as-source-of-truth tables. Data that used to live in
            -- the client's SQLite now lives here, scoped per org.
            CREATE TABLE IF NOT EXISTS org_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                plugin_id TEXT NOT NULL,
                host TEXT NOT NULL DEFAULT '',
                port INTEGER NOT NULL DEFAULT 0,
                database_name TEXT NOT NULL DEFAULT '',
                username TEXT NOT NULL DEFAULT '',
                password_enc TEXT,
                ssl_mode TEXT,
                settings_json TEXT NOT NULL DEFAULT '{}',
                group_id INTEGER,
                enabled INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL DEFAULT 0,
                credential_id INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_org_connections_org ON org_connections(org_id, position);
            CREATE TABLE IF NOT EXISTS org_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                color TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_org_groups_org ON org_groups(org_id, position);
            CREATE TABLE IF NOT EXISTS org_credentials (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                username TEXT,
                secret_enc TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_org_credentials_org ON org_credentials(org_id);
            CREATE TABLE IF NOT EXISTS org_workspace_sessions (
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                snapshot_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (org_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS org_plugins_installed (
                org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
                plugin_id TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                settings_json TEXT NOT NULL DEFAULT '{}',
                installed_at TEXT NOT NULL,
                PRIMARY KEY (org_id, plugin_id)
            );
            CREATE TABLE IF NOT EXISTS local_admin_token (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                hash TEXT NOT NULL,
                set_at TEXT NOT NULL
            );
            "#,
        )?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("db poisoned")
    }

    pub fn create_oauth_code(&self, code: &str, value: &str) -> Result<()> {
        self.lock().execute(
            "INSERT INTO oauth_codes (code, user_id, created_at) VALUES (?1, ?2, ?3)",
            params![code, value, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn take_oauth_code(&self, code: &str) -> Result<Option<String>> {
        let conn = self.lock();
        let value: Option<String> = conn
            .query_row(
                "SELECT user_id FROM oauth_codes WHERE code = ?1",
                params![code],
                |row| row.get(0),
            )
            .optional()?;
        conn.execute("DELETE FROM oauth_codes WHERE code = ?1", params![code])?;
        Ok(value)
    }

    pub fn upsert_user(
        &self,
        email: &str,
        name: Option<&str>,
        avatar: Option<&str>,
        linked_providers: &str,
    ) -> Result<UserRow> {
        let conn = self.lock();
        let existing: Option<UserRow> = conn
            .query_row(
                "SELECT id, email, name, avatar_url, linked_providers, master_key_enc_blob FROM users WHERE email = ?1",
                params![email],
                |row| {
                    Ok(UserRow {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        name: row.get(2)?,
                        avatar_url: row.get(3)?,
                        linked_providers: row.get(4)?,
                        master_key_enc_blob: row.get(5)?,
                    })
                },
            )
            .optional()?;
        let now = Utc::now().to_rfc3339();
        if let Some(mut u) = existing {
            conn.execute(
                "UPDATE users SET name = COALESCE(?1, name), avatar_url = COALESCE(?2, avatar_url), linked_providers = ?3, updated_at = ?4 WHERE id = ?5",
                params![name, avatar, linked_providers, now, u.id],
            )?;
            u.name = name.map(|s| s.to_string()).or(u.name);
            u.avatar_url = avatar.map(|s| s.to_string()).or(u.avatar_url);
            u.linked_providers = linked_providers.to_string();
            Ok(u)
        } else {
            let id = format!("user_{}", uuid::Uuid::new_v4().simple());
            conn.execute(
                "INSERT INTO users (id, email, name, avatar_url, linked_providers, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, email, name, avatar, linked_providers, now],
            )?;
            Ok(UserRow {
                id,
                email: email.to_string(),
                name: name.map(|s| s.to_string()),
                avatar_url: avatar.map(|s| s.to_string()),
                linked_providers: linked_providers.to_string(),
                master_key_enc_blob: None,
            })
        }
    }

    pub fn user_linked_providers(&self, email: &str) -> Result<Vec<String>> {
        let conn = self.lock();
        let raw: Option<String> = conn
            .query_row(
                "SELECT linked_providers FROM users WHERE email = ?1",
                params![email],
                |row| row.get(0),
            )
            .optional()?;
        match raw {
            Some(s) => serde_json::from_str(&s).map_err(Into::into),
            None => Ok(Vec::new()),
        }
    }

    pub fn create_session(&self, user_id: &str) -> Result<String> {
        let token = format!("sess_{}", uuid::Uuid::new_v4().simple());
        let expires = (Utc::now() + chrono::Duration::days(30)).to_rfc3339();
        self.lock().execute(
            "INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)",
            params![token, user_id, expires],
        )?;
        Ok(token)
    }

    pub fn session_user(&self, token: &str) -> Result<Option<String>> {
        let conn = self.lock();
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT user_id, expires_at FROM sessions WHERE token = ?1",
                params![token],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        Ok(row.and_then(|(uid, expires)| {
            if chrono::DateTime::parse_from_rfc3339(&expires)
                .map(|d| d < Utc::now())
                .unwrap_or(true)
            {
                None
            } else {
                Some(uid)
            }
        }))
    }

    pub fn get_user(&self, id: &str) -> Result<Option<UserRow>> {
        self.lock()
            .query_row(
                "SELECT id, email, name, avatar_url, linked_providers, master_key_enc_blob FROM users WHERE id = ?1",
                params![id],
                |row| {
                    Ok(UserRow {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        name: row.get(2)?,
                        avatar_url: row.get(3)?,
                        linked_providers: row.get(4)?,
                        master_key_enc_blob: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    // ===== Organizations =====

    pub fn create_org(&self, name: &str, accent: Option<&str>, icon: Option<&str>, owner_user_id: &str) -> Result<OrgRow> {
        let id = format!("org_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO orgs (id, name, accent_color, icon_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, accent, icon, now],
        )?;
        conn.execute(
            "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)",
            params![id, owner_user_id, now],
        )?;
        Ok(OrgRow {
            id,
            name: name.to_string(),
            accent_color: accent.map(|s| s.to_string()),
            icon_url: icon.map(|s| s.to_string()),
        })
    }

    pub fn list_user_orgs(&self, user_id: &str) -> Result<Vec<(OrgRow, String)>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT o.id, o.name, o.accent_color, o.icon_url, m.role
             FROM orgs o INNER JOIN org_members m ON m.org_id = o.id
             WHERE m.user_id = ?1 ORDER BY o.created_at ASC",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok((
                OrgRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    accent_color: row.get(2)?,
                    icon_url: row.get(3)?,
                },
                row.get::<_, String>(4)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn update_org(&self, org_id: &str, name: Option<&str>, accent: Option<&str>, icon: Option<&str>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.lock().execute(
            "UPDATE orgs SET name = COALESCE(?1, name), accent_color = COALESCE(?2, accent_color), icon_url = COALESCE(?3, icon_url), updated_at = ?4 WHERE id = ?5",
            params![name, accent, icon, now, org_id],
        )?;
        Ok(())
    }

    pub fn delete_org(&self, org_id: &str) -> Result<()> {
        self.lock().execute("DELETE FROM orgs WHERE id = ?1", params![org_id])?;
        Ok(())
    }

    pub fn get_member_role(&self, org_id: &str, user_id: &str) -> Result<Option<String>> {
        self.lock()
            .query_row(
                "SELECT role FROM org_members WHERE org_id = ?1 AND user_id = ?2",
                params![org_id, user_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_members(&self, org_id: &str) -> Result<Vec<MemberRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT m.user_id, u.email, u.name, u.avatar_url, m.role, m.joined_at
             FROM org_members m INNER JOIN users u ON u.id = m.user_id
             WHERE m.org_id = ?1 ORDER BY m.joined_at ASC",
        )?;
        let rows = stmt.query_map(params![org_id], |row| {
            Ok(MemberRow {
                user_id: row.get(0)?,
                email: row.get(1)?,
                name: row.get(2)?,
                avatar_url: row.get(3)?,
                role: row.get(4)?,
                joined_at: row.get(5)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows { out.push(r?); }
        Ok(out)
    }

    pub fn set_member_role(&self, org_id: &str, user_id: &str, role: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE org_members SET role = ?1 WHERE org_id = ?2 AND user_id = ?3",
            params![role, org_id, user_id],
        )?;
        Ok(())
    }

    pub fn remove_member(&self, org_id: &str, user_id: &str) -> Result<()> {
        self.lock().execute(
            "DELETE FROM org_members WHERE org_id = ?1 AND user_id = ?2",
            params![org_id, user_id],
        )?;
        Ok(())
    }

    pub fn create_invite(&self, org_id: &str, role: &str, created_by: &str, ttl_hours: i64) -> Result<String> {
        let token = format!("inv_{}", uuid::Uuid::new_v4().simple());
        let now = Utc::now();
        self.lock().execute(
            "INSERT INTO org_invites (token, org_id, role, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![token, org_id, role, created_by, now.to_rfc3339(), (now + chrono::Duration::hours(ttl_hours)).to_rfc3339()],
        )?;
        Ok(token)
    }

    pub fn redeem_invite(&self, token: &str, user_id: &str) -> Result<InviteRow> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        let row: Option<InviteRow> = conn.query_row(
            "SELECT token, org_id, role, expires_at, used_by FROM org_invites WHERE token = ?1",
            params![token],
            |row| Ok(InviteRow {
                token: row.get(0)?,
                org_id: row.get(1)?,
                role: row.get(2)?,
                expires_at: row.get(3)?,
                used_by: row.get(4)?,
            }),
        ).optional()?;
        let invite = row.ok_or_else(|| anyhow::anyhow!("invite not found"))?;
        if invite.used_by.is_some() {
            return Err(anyhow::anyhow!("invite already redeemed"));
        }
        if chrono::DateTime::parse_from_rfc3339(&invite.expires_at)
            .map(|d| d < Utc::now()).unwrap_or(true)
        {
            return Err(anyhow::anyhow!("invite expired"));
        }
        conn.execute(
            "INSERT OR IGNORE INTO org_members (org_id, user_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)",
            params![invite.org_id, user_id, invite.role, now],
        )?;
        conn.execute(
            "UPDATE org_invites SET used_by = ?1, used_at = ?2 WHERE token = ?3",
            params![user_id, now, token],
        )?;
        Ok(invite)
    }

    #[allow(dead_code)]
    pub fn get_org(&self, id: &str) -> Result<Option<OrgRow>> {
        self.lock().query_row(
            "SELECT id, name, accent_color, icon_url FROM orgs WHERE id = ?1",
            params![id],
            |row| Ok(OrgRow {
                id: row.get(0)?,
                name: row.get(1)?,
                accent_color: row.get(2)?,
                icon_url: row.get(3)?,
            }),
        ).optional().map_err(Into::into)
    }

    pub fn invite_info(&self, token: &str) -> Result<Option<(OrgRow, String)>> {
        let conn = self.lock();
        conn.query_row(
            "SELECT o.id, o.name, o.accent_color, o.icon_url, i.role
             FROM org_invites i INNER JOIN orgs o ON o.id = i.org_id
             WHERE i.token = ?1 AND i.used_by IS NULL",
            params![token],
            |row| Ok((
                OrgRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    accent_color: row.get(2)?,
                    icon_url: row.get(3)?,
                },
                row.get::<_, String>(4)?,
            )),
        ).optional().map_err(Into::into)
    }

    // ===== Local-server admin token =====
    //
    // The client derives a stable Argon2id-hashed token from the user's
    // global passphrase and sends it via the `DBM_LOCAL_ADMIN_HASH` env var
    // on every spawn. The server upserts it at startup so the same client
    // keeps authenticating after restarts. `verify_admin_token` (in
    // `crypto.rs`) compares incoming Bearer headers against this hash.

    pub fn upsert_local_admin_hash(&self, hash: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.lock().execute(
            "INSERT INTO local_admin_token (id, hash, set_at) VALUES (1, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, set_at = excluded.set_at",
            params![hash, now],
        )?;
        Ok(())
    }

    pub fn get_local_admin_hash(&self) -> Result<Option<String>> {
        self.lock()
            .query_row(
                "SELECT hash FROM local_admin_token WHERE id = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(Into::into)
    }

    /// Ensure the synthetic local user + "Local" org exist. Returns the
    /// user id. Used by `auth::require_auth` when the admin token matches.
    pub fn ensure_local_user_and_org(&self) -> Result<String> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        // user
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM users WHERE id = '__local__'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            conn.execute(
                "INSERT INTO users (id, email, name, linked_providers, created_at, updated_at)
                 VALUES ('__local__', 'local@dbm.local', 'Local user', '[]', ?1, ?1)",
                params![now],
            )?;
        }
        // org
        let org_exists: Option<String> = conn
            .query_row(
                "SELECT id FROM orgs WHERE id = 'org_local'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if org_exists.is_none() {
            conn.execute(
                "INSERT INTO orgs (id, name, accent_color, created_at, updated_at)
                 VALUES ('org_local', 'Local', NULL, ?1, ?1)",
                params![now],
            )?;
            conn.execute(
                "INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES ('org_local', '__local__', 'owner', ?1)",
                params![now],
            )?;
        }
        Ok("__local__".into())
    }

}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrgRow {
    pub id: String,
    pub name: String,
    pub accent_color: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberRow {
    pub user_id: String,
    pub email: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteRow {
    pub token: String,
    pub org_id: String,
    pub role: String,
    pub expires_at: String,
    pub used_by: Option<String>,
}

