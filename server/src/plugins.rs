use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine as _;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(list_plugins))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifestRef {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub checksum_sha256: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    /// Base64-encoded Ed25519 signature over the canonical manifest JSON.
    #[serde(default)]
    pub signature_b64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    platforms: Vec<String>,
    #[serde(default)]
    binary: Option<String>,
}

fn plugins_dir() -> PathBuf {
    std::env::var("PLUGINS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./plugins"))
}

/// Get or lazily create the signing key. Reads `PLUGINS_SIGNING_KEY` env (base64
/// 32 bytes) if present; otherwise generates an ephemeral key per server run.
fn signing_key() -> &'static SigningKey {
    static KEY: OnceLock<SigningKey> = OnceLock::new();
    KEY.get_or_init(|| {
        if let Ok(s) = std::env::var("PLUGINS_SIGNING_KEY") {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(s.trim()) {
                if bytes.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&bytes);
                    return SigningKey::from_bytes(&arr);
                }
            }
        }
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        SigningKey::from_bytes(&seed)
    })
}

pub fn signing_pubkey_b64() -> String {
    base64::engine::general_purpose::STANDARD.encode(signing_key().verifying_key().as_bytes())
}

fn read_manifests() -> Vec<PluginManifestRef> {
    let dir = plugins_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let key = signing_key();
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let Ok(raw) = std::fs::read(&manifest_path) else { continue };
        let Ok(m) = serde_json::from_slice::<ManifestFile>(&raw) else { continue };
        let checksum = m.binary.as_ref().and_then(|b| {
            std::fs::read(path.join(b)).ok().map(|bytes| format!("{:x}", Sha256::digest(&bytes)))
        });
        let mut canonical = serde_json::json!({
            "id": m.id,
            "name": m.name,
            "version": m.version,
            "checksum_sha256": checksum,
            "download_url": m.download_url,
            "platforms": m.platforms,
        });
        canonical.sort_all_objects();
        let canonical_bytes = canonical.to_string();
        let signature = key.sign(canonical_bytes.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());
        out.push(PluginManifestRef {
            id: m.id,
            name: m.name,
            version: m.version,
            checksum_sha256: checksum,
            download_url: m.download_url,
            platforms: m.platforms,
            signature_b64: Some(sig_b64),
        });
    }
    out
}

async fn list_plugins(State(_state): State<Arc<AppState>>) -> Json<Vec<PluginManifestRef>> {
    Json(read_manifests())
}
