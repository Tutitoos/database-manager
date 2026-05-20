//! Self-signed TLS material for LAN binds.
//!
//! When the server binds to `0.0.0.0` (toggle "Share on LAN") we need TLS so
//! credentials aren't sent in clear over the wire. Real CA-signed certs are
//! impractical for ad-hoc LAN servers, so we auto-generate a self-signed
//! Ed25519/RSA cert on first launch and persist it next to `dbm.sqlite`.
//! Clients pin the leaf SHA256 via TOFU on first contact (see
//! `src-tauri/src/tls.rs::PinningVerifier`).

use std::path::{Path, PathBuf};

use anyhow::Result;
use axum_server::tls_rustls::RustlsConfig;

pub struct TlsMaterial {
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
}

/// Ensure `cert.pem` + `key.pem` exist in `data_dir`. Generates a fresh
/// self-signed pair if missing. Returns the file paths.
pub fn ensure_self_signed(data_dir: &Path, hosts: &[String]) -> Result<TlsMaterial> {
    let cert_path = data_dir.join("cert.pem");
    let key_path = data_dir.join("key.pem");
    if cert_path.exists() && key_path.exists() {
        return Ok(TlsMaterial { cert_path, key_path });
    }
    let cert = rcgen::generate_simple_self_signed(hosts.to_vec())?;
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(&cert_path, cert.cert.pem())?;
    std::fs::write(&key_path, cert.key_pair.serialize_pem())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("generated self-signed TLS material at {data_dir:?}");
    Ok(TlsMaterial { cert_path, key_path })
}

pub async fn rustls_config_from(tls: &TlsMaterial) -> Result<RustlsConfig> {
    let config = RustlsConfig::from_pem_file(&tls.cert_path, &tls.key_path).await?;
    Ok(config)
}
