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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEnvelope {
    pub entity_type: String,
    pub entity_id: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub ciphertext: String,
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
            CREATE TABLE IF NOT EXISTS sync_envelopes (
                user_id TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                ciphertext TEXT NOT NULL,
                server_updated_at TEXT NOT NULL,
                PRIMARY KEY (user_id, entity_type, entity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_sync_envelopes_user ON sync_envelopes(user_id, server_updated_at);
            "#,
        )?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
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

    pub fn delete_session(&self, token: &str) -> Result<()> {
        self.lock().execute("DELETE FROM sessions WHERE token = ?1", params![token])?;
        Ok(())
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

    pub fn set_master_key(&self, user_id: &str, blob: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE users SET master_key_enc_blob = ?1, updated_at = ?2 WHERE id = ?3",
            params![blob, Utc::now().to_rfc3339(), user_id],
        )?;
        Ok(())
    }

    pub fn get_master_key(&self, user_id: &str) -> Result<Option<String>> {
        self.lock()
            .query_row(
                "SELECT master_key_enc_blob FROM users WHERE id = ?1",
                params![user_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn sync_push(&self, user_id: &str, envelopes: &[SyncEnvelope]) -> Result<String> {
        let now = Utc::now().to_rfc3339();
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO sync_envelopes (user_id, entity_type, entity_id, updated_at, deleted_at, ciphertext, server_updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    ciphertext = excluded.ciphertext,
                    server_updated_at = excluded.server_updated_at
                 WHERE excluded.updated_at >= sync_envelopes.updated_at",
            )?;
            for env in envelopes {
                stmt.execute(params![
                    user_id,
                    env.entity_type,
                    env.entity_id,
                    env.updated_at,
                    env.deleted_at,
                    env.ciphertext,
                    now
                ])?;
            }
        }
        tx.commit()?;
        Ok(now)
    }

    pub fn sync_pull(
        &self,
        user_id: &str,
        since: Option<&str>,
    ) -> Result<(Vec<SyncEnvelope>, String)> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock();
        let mut envelopes = Vec::new();
        if let Some(since) = since {
            let mut stmt = conn.prepare(
                "SELECT entity_type, entity_id, updated_at, deleted_at, ciphertext FROM sync_envelopes WHERE user_id = ?1 AND server_updated_at > ?2 ORDER BY server_updated_at ASC",
            )?;
            let rows = stmt.query_map(params![user_id, since], map_envelope)?;
            for row in rows {
                envelopes.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT entity_type, entity_id, updated_at, deleted_at, ciphertext FROM sync_envelopes WHERE user_id = ?1 ORDER BY server_updated_at ASC",
            )?;
            let rows = stmt.query_map(params![user_id], map_envelope)?;
            for row in rows {
                envelopes.push(row?);
            }
        }
        Ok((envelopes, now))
    }
}

fn map_envelope(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncEnvelope> {
    Ok(SyncEnvelope {
        entity_type: row.get(0)?,
        entity_id: row.get(1)?,
        updated_at: row.get(2)?,
        deleted_at: row.get(3)?,
        ciphertext: row.get(4)?,
    })
}
