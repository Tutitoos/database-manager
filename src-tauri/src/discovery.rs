use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const SERVICE_TYPE: &str = "_dbm._tcp.local.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredServer {
    pub instance: String,
    pub host: String,
    pub port: u16,
    pub url: String,
    pub name: Option<String>,
    pub version: Option<String>,
}

struct DiscoveryState {
    daemon: Option<ServiceDaemon>,
    handle: Option<std::thread::JoinHandle<()>>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

fn state() -> &'static Mutex<DiscoveryState> {
    static S: OnceLock<Mutex<DiscoveryState>> = OnceLock::new();
    S.get_or_init(|| {
        Mutex::new(DiscoveryState {
            daemon: None,
            handle: None,
            stop: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    })
}

#[tauri::command]
pub fn start_org_discovery(app: AppHandle) -> Result<(), String> {
    let mut guard = state().lock().map_err(|_| "discovery lock poisoned".to_string())?;
    if guard.daemon.is_some() {
        return Ok(()); // already running
    }
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let receiver = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
    let stop = guard.stop.clone();
    stop.store(false, std::sync::atomic::Ordering::SeqCst);
    let app_handle = app.clone();
    let handle = std::thread::spawn(move || {
        while !stop.load(std::sync::atomic::Ordering::SeqCst) {
            let event = match receiver.recv_timeout(std::time::Duration::from_secs(1)) {
                Ok(e) => e,
                Err(_) => continue,
            };
            if let ServiceEvent::ServiceResolved(info) = event {
                let host = info
                    .get_addresses()
                    .iter()
                    .next()
                    .map(|a| a.to_string())
                    .unwrap_or_default();
                let port = info.get_port();
                let scheme = if port == 443 { "https" } else { "http" };
                let server = DiscoveredServer {
                    instance: info.get_fullname().to_string(),
                    host: host.clone(),
                    port,
                    url: format!("{scheme}://{host}:{port}"),
                    name: info.get_property_val_str("name").map(|s| s.to_string()),
                    version: info.get_property_val_str("version").map(|s| s.to_string()),
                };
                let _ = app_handle.emit("org-discovered", server);
            }
        }
    });
    guard.daemon = Some(daemon);
    guard.handle = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_org_discovery() -> Result<(), String> {
    let mut guard = state().lock().map_err(|_| "discovery lock poisoned".to_string())?;
    guard.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(daemon) = guard.daemon.take() {
        let _ = daemon.shutdown();
    }
    if let Some(h) = guard.handle.take() {
        let _ = h.join();
    }
    Ok(())
}
