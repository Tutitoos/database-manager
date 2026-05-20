//! At-rest encryption of sensitive payloads (DB passwords, credential secrets).
//!
//! KEK lifecycle: read from `DBM_SERVER_KEY` env (b64-encoded 32 bytes) or
//! lazy-generate one and persist to `<data_dir>/dbm.key` with 0600 perms.
//! Same key reused across restarts so existing ciphertexts decrypt cleanly.
//!
//! Algorithm: AES-256-GCM. Nonce: random 12 bytes, prepended to ciphertext.
//! Stored format (base64): `nonce || ciphertext || tag`. Plain text never
//! leaves the server — client receives decrypted values over TLS only.

use std::path::Path;
use std::sync::OnceLock;

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Context, Result};
use base64::Engine as _;

static KEK: OnceLock<[u8; 32]> = OnceLock::new();

/// Initialize the KEK at startup. Idempotent. Pass the server's data dir so
/// the key file lives next to `dbm.sqlite`.
pub fn init(data_dir: &Path) -> Result<()> {
    let key = load_or_generate(data_dir)?;
    let _ = KEK.set(key);
    Ok(())
}

fn load_or_generate(data_dir: &Path) -> Result<[u8; 32]> {
    if let Ok(b64) = std::env::var("DBM_SERVER_KEY") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .context("DBM_SERVER_KEY is not valid base64")?;
        if bytes.len() != 32 {
            return Err(anyhow!("DBM_SERVER_KEY must decode to 32 bytes"));
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }
    let path = data_dir.join("dbm.key");
    if path.exists() {
        let raw = std::fs::read(&path)
            .with_context(|| format!("read {:?}", path))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(raw.trim_ascii())
            .context("dbm.key is not valid base64")?;
        if bytes.len() != 32 {
            return Err(anyhow!("dbm.key must decode to 32 bytes"));
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }
    // Generate fresh.
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    std::fs::create_dir_all(data_dir).ok();
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    std::fs::write(&path, encoded).with_context(|| format!("write {:?}", path))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("generated new server KEK at {:?}", path);
    Ok(bytes)
}

fn kek() -> Result<&'static [u8; 32]> {
    KEK.get().ok_or_else(|| anyhow!("crypto::init was not called"))
}

/// Encrypt plaintext → base64(nonce || ciphertext+tag).
pub fn encrypt(plain: &str) -> Result<String> {
    let key = Key::<Aes256Gcm>::from_slice(kek()?);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plain.as_bytes())
        .map_err(|e| anyhow!("encrypt: {e}"))?;
    let mut out = Vec::with_capacity(nonce.len() + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(base64::engine::general_purpose::STANDARD.encode(out))
}

/// Decrypt base64-encoded blob produced by `encrypt`.
pub fn decrypt(blob: &str) -> Result<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(blob)
        .context("decrypt: blob not base64")?;
    if bytes.len() < 12 + 16 {
        return Err(anyhow!("decrypt: blob too short"));
    }
    let (nonce_bytes, ct) = bytes.split_at(12);
    let key = Key::<Aes256Gcm>::from_slice(kek()?);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plain = cipher
        .decrypt(nonce, ct)
        .map_err(|e| anyhow!("decrypt: {e}"))?;
    String::from_utf8(plain).context("decrypt: utf8")
}

/// Hash a passphrase-derived admin token for storage (Argon2id).
/// Used for the local-server bearer token (passphrase coupling).
#[allow(dead_code)]
pub fn hash_admin_token(token: &str) -> Result<String> {
    use argon2::password_hash::{rand_core::OsRng as ArgonRng, PasswordHasher, SaltString};
    use argon2::Argon2;
    let salt = SaltString::generate(&mut ArgonRng);
    let hash = Argon2::default()
        .hash_password(token.as_bytes(), &salt)
        .map_err(|e| anyhow!("argon2 hash: {e}"))?
        .to_string();
    Ok(hash)
}

#[allow(dead_code)]
pub fn verify_admin_token(token: &str, stored_hash: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    use argon2::Argon2;
    let parsed = match PasswordHash::new(stored_hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(token.as_bytes(), &parsed)
        .is_ok()
}
