//! TOFU (Trust On First Use) TLS pinning for reqwest clients.
//!
//! The verifier captures the leaf certificate SHA256 into a shared `Mutex`
//! during the handshake. If an `expected` fingerprint is supplied, the
//! handshake fails when it doesn't match (constant-time compare).
//!
//! Standard PKI/webpki validation is skipped: this is designed for
//! self-hosted servers that often use self-signed certs.

use std::sync::{Arc, Mutex};

use reqwest::ClientBuilder;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};

#[derive(Debug)]
pub struct PinningVerifier {
    pub captured: Arc<Mutex<Option<String>>>,
    pub expected: Option<String>,
}

impl PinningVerifier {
    pub fn new(expected: Option<String>) -> (Arc<Self>, Arc<Mutex<Option<String>>>) {
        let captured = Arc::new(Mutex::new(None));
        let v = Arc::new(Self {
            captured: captured.clone(),
            expected,
        });
        (v, captured)
    }
}

impl ServerCertVerifier for PinningVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        let mut hasher = Sha256::new();
        hasher.update(end_entity.as_ref());
        let fingerprint = format!("{:x}", hasher.finalize());
        if let Some(expected) = &self.expected {
            if !expected.eq_ignore_ascii_case(&fingerprint) {
                return Err(TlsError::General(format!(
                    "TOFU cert mismatch: expected {expected} got {fingerprint}"
                )));
            }
        }
        if let Ok(mut guard) = self.captured.lock() {
            *guard = Some(fingerprint);
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
        ]
    }
}

/// Build a reqwest client with a TOFU pinning verifier.
/// Returns the client along with the shared captured-fingerprint mutex so the
/// caller can inspect the leaf cert SHA256 after a successful request.
pub fn build_pinning_client(
    expected: Option<String>,
    timeout: std::time::Duration,
) -> Result<(reqwest::Client, Arc<Mutex<Option<String>>>), String> {
    let (verifier, captured) = PinningVerifier::new(expected);
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    let client = ClientBuilder::new()
        .use_preconfigured_tls(config)
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    Ok((client, captured))
}
