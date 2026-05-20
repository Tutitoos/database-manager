//! Biometric (Touch ID / Face ID) prompt via macOS LocalAuthentication.
//!
//! UX gate only — does NOT bind the keychain item to biometry (that requires
//! a signed app with keychain-access-groups entitlement).

#[cfg(target_os = "macos")]
pub fn evaluate(reason: &str) -> Result<bool, String> {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::{Arc, Condvar, Mutex};

    let ctx = unsafe { LAContext::new() };
    let policy = LAPolicy::DeviceOwnerAuthentication;

    if let Err(err) = unsafe { ctx.canEvaluatePolicy_error(policy) } {
        return Err(format!(
            "biometry not available: {}",
            err.localizedDescription()
        ));
    }

    let reason_ns = NSString::from_str(reason);

    let pair = Arc::new((Mutex::new(None::<Result<bool, String>>), Condvar::new()));
    let pair_cb = pair.clone();

    let block = block2::RcBlock::new(move |success: Bool, error: *mut NSError| {
        let result = if success.as_bool() {
            Ok(true)
        } else if !error.is_null() {
            let err: &NSError = unsafe { &*error };
            Err(format!("biometry failed: {}", err.localizedDescription()))
        } else {
            Ok(false)
        };
        let (lock, cvar) = &*pair_cb;
        *lock.lock().unwrap() = Some(result);
        cvar.notify_all();
    });

    unsafe {
        ctx.evaluatePolicy_localizedReason_reply(policy, &reason_ns, &block);
    }

    let (lock, cvar) = &*pair;
    let guard = lock.lock().unwrap();
    let timeout = std::time::Duration::from_secs(60);
    let (mut guard, wait_res) = cvar
        .wait_timeout_while(guard, timeout, |g| g.is_none())
        .map_err(|e| e.to_string())?;
    if wait_res.timed_out() {
        return Err("biometry timed out".into());
    }
    guard.take().unwrap_or(Ok(false))
}

#[cfg(not(target_os = "macos"))]
pub fn evaluate(_reason: &str) -> Result<bool, String> {
    Err("biometry only available on macOS".into())
}
