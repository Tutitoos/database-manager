//! Cross-platform keychain wrapper kept after the passphrase removal.
//!
//! Today the only consumer is `delete()` — wiping any legacy entry from the
//! passphrase-vault era when the user signs out — and the biometry probe that
//! gates the optional Touch ID / Face ID reload flow. Write/read paths were
//! removed alongside the vault.

const SERVICE: &str = "com.gtrave.database-manager";

pub fn delete(account: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

pub fn biometry_supported() -> bool {
    cfg!(target_os = "macos")
}
