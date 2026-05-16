use std::sync::{Arc, Mutex};

use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;

pub const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Clone)]
pub struct MasterKey(pub [u8; MASTER_KEY_LEN]);

#[derive(Clone, Default)]
pub struct KeyVault {
    inner: Arc<Mutex<Option<MasterKey>>>,
}

impl KeyVault {
    pub fn set(&self, mk: MasterKey) {
        if let Ok(mut g) = self.inner.lock() {
            *g = Some(mk);
        }
    }
    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            *g = None;
        }
    }
    pub fn get(&self) -> Option<MasterKey> {
        self.inner.lock().ok().and_then(|g| g.clone())
    }
    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().map(|g| g.is_some()).unwrap_or(false)
    }
}

pub fn random_master_key() -> MasterKey {
    let mut k = [0u8; MASTER_KEY_LEN];
    OsRng.fill_bytes(&mut k);
    MasterKey(k)
}

pub fn derive_key_from_passphrase(
    passphrase: &str,
    salt: &[u8],
) -> Result<[u8; MASTER_KEY_LEN], String> {
    let params = Params::new(19456, 2, 1, Some(MASTER_KEY_LEN)).map_err(|e| e.to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; MASTER_KEY_LEN];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn nonce_random() -> [u8; NONCE_LEN] {
    let mut n = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut n);
    n
}

fn cipher_for(mk: &MasterKey, context: &str) -> Result<ChaCha20Poly1305, String> {
    let hk = Hkdf::<Sha256>::new(None, &mk.0);
    let mut sub = [0u8; 32];
    hk.expand(context.as_bytes(), &mut sub).map_err(|e| e.to_string())?;
    Ok(ChaCha20Poly1305::new(Key::from_slice(&sub)))
}

pub fn encrypt_b64(mk: &MasterKey, context: &str, plaintext: &[u8]) -> Result<String, String> {
    let cipher = cipher_for(mk, context)?;
    let nonce_bytes = nonce_random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

pub fn decrypt_b64(mk: &MasterKey, context: &str, blob: &str) -> Result<Vec<u8>, String> {
    let raw = B64.decode(blob).map_err(|e| e.to_string())?;
    if raw.len() < NONCE_LEN {
        return Err("ciphertext too short".to_string());
    }
    let (nonce_bytes, ct) = raw.split_at(NONCE_LEN);
    let cipher = cipher_for(mk, context)?;
    cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| e.to_string())
}

pub fn wrap_master_key(mk: &MasterKey, recovery_key: &[u8]) -> Result<String, String> {
    let key_bytes: [u8; 32] = recovery_key
        .try_into()
        .map_err(|_| "recovery key must be 32 bytes".to_string())?;
    let cipher = ChaCha20Poly1305::new(&key_bytes.into());
    let nonce_bytes = nonce_random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, mk.0.as_slice()).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

pub fn unwrap_master_key(blob: &str, recovery_key: &[u8]) -> Result<MasterKey, String> {
    let key_bytes: [u8; 32] = recovery_key
        .try_into()
        .map_err(|_| "recovery key must be 32 bytes".to_string())?;
    let raw = B64.decode(blob).map_err(|e| e.to_string())?;
    if raw.len() < NONCE_LEN {
        return Err("wrapped key too short".to_string());
    }
    let (nonce_bytes, ct) = raw.split_at(NONCE_LEN);
    let cipher = ChaCha20Poly1305::new(&key_bytes.into());
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .map_err(|e| e.to_string())?;
    if pt.len() != MASTER_KEY_LEN {
        return Err("unexpected master key length".to_string());
    }
    let mut mk = [0u8; MASTER_KEY_LEN];
    mk.copy_from_slice(&pt);
    Ok(MasterKey(mk))
}

pub fn random_salt() -> String {
    let mut s = [0u8; 16];
    OsRng.fill_bytes(&mut s);
    B64.encode(s)
}

pub fn salt_from_b64(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let mk = random_master_key();
        let blob = encrypt_b64(&mk, "credential.v1.42", b"hunter2").unwrap();
        let pt = decrypt_b64(&mk, "credential.v1.42", &blob).unwrap();
        assert_eq!(pt, b"hunter2");
    }

    #[test]
    fn wrap_unwrap_master_key() {
        let mk = random_master_key();
        let rk = {
            let mut k = [0u8; 32];
            OsRng.fill_bytes(&mut k);
            k
        };
        let wrapped = wrap_master_key(&mk, &rk).unwrap();
        let mk2 = unwrap_master_key(&wrapped, &rk).unwrap();
        assert_eq!(mk.0, mk2.0);
    }

    #[test]
    fn passphrase_derivation_is_stable() {
        let salt = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f";
        let a = derive_key_from_passphrase("correct horse battery staple", salt).unwrap();
        let b = derive_key_from_passphrase("correct horse battery staple", salt).unwrap();
        assert_eq!(a, b);
    }
}
