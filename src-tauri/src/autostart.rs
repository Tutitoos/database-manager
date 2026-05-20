//! Persistent-daemon autostart. Writes a per-user OS unit file pointing at
//! the bundled `dbm-server` binary so it survives app quits and OS reboots.
//!
//! Initial scope: **macOS LaunchAgent** only. Linux (systemd-user) and
//! Windows (Task Scheduler) live behind the same command surface but return
//! a "not yet implemented" error.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
pub struct AutostartOptions {
    pub port: u16,
    /// Argon2id-hashed admin token to inject via env (same value the desktop
    /// app passes when it spawns the server itself).
    pub admin_token_hash: String,
}

#[tauri::command]
pub fn enable_autostart(app: AppHandle, options: AutostartOptions) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    { return macos::install(&app, &options); }
    #[cfg(target_os = "linux")]
    { return linux::install(&app, &options); }
    #[cfg(target_os = "windows")]
    { return windows::install(&app, &options); }
    #[allow(unreachable_code)]
    { let _ = (app, options); Err("unsupported platform".into()) }
}

#[tauri::command]
pub fn disable_autostart() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { return macos::uninstall(); }
    #[cfg(target_os = "linux")]
    { return linux::uninstall(); }
    #[cfg(target_os = "windows")]
    { return windows::uninstall(); }
    #[allow(unreachable_code)]
    { Err("unsupported platform".into()) }
}

#[tauri::command]
pub fn autostart_status() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    { return Ok(macos::plist_path().exists()); }
    #[cfg(target_os = "linux")]
    { return Ok(linux::unit_path().exists()); }
    #[cfg(target_os = "windows")]
    { return Ok(windows::is_registered()); }
    #[allow(unreachable_code)]
    { Ok(false) }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use tauri::Manager;

    const UNIT_NAME: &str = "dbm-server.service";

    pub(super) fn unit_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join(".config")
            .join("systemd")
            .join("user")
            .join(UNIT_NAME)
    }

    pub(super) fn install(app: &AppHandle, options: &AutostartOptions) -> Result<String, String> {
        let bin = crate::local_server::resolve_binary_for_autostart(app)?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("local-server");
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let db = data_dir.join("dbm.sqlite");
        let unit = format!(
            r#"[Unit]
Description=Database Manager local sync server
After=default.target

[Service]
ExecStart={bin}
Environment=PORT={port}
Environment=BIND_ADDR=127.0.0.1
Environment=DATABASE_URL={db}
Environment=SERVER_NAME=Local
Environment=DBM_LOCAL_ADMIN_HASH={hash}
Environment=RUST_LOG=info
Restart=on-failure

[Install]
WantedBy=default.target
"#,
            bin = bin.to_string_lossy(),
            port = options.port,
            db = db.to_string_lossy(),
            hash = options.admin_token_hash,
        );
        let path = unit_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, unit).map_err(|e| e.to_string())?;
        // daemon-reload + enable --now. Failures non-fatal (will activate on
        // next login).
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "daemon-reload"])
            .output();
        let _ = std::process::Command::new("systemctl")
            .args(["--user", "enable", "--now", UNIT_NAME])
            .output();
        Ok(path.to_string_lossy().to_string())
    }

    pub(super) fn uninstall() -> Result<(), String> {
        let path = unit_path();
        if path.exists() {
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "disable", "--now", UNIT_NAME])
                .output();
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "daemon-reload"])
                .output();
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::process::Command;
    use tauri::Manager;

    const TASK_NAME: &str = "DBM-Server";

    pub(super) fn is_registered() -> bool {
        Command::new("schtasks")
            .args(["/Query", "/TN", TASK_NAME])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub(super) fn install(app: &AppHandle, options: &AutostartOptions) -> Result<String, String> {
        let bin = crate::local_server::resolve_binary_for_autostart(app)?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("local-server");
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let db = data_dir.join("dbm.sqlite");
        // We bake the env vars into a wrapper .cmd file, then register a task
        // that launches the wrapper at logon. schtasks /Create can't carry
        // multi-var env, so the wrapper is the simplest path.
        let wrapper = data_dir.join("autostart.cmd");
        let script = format!(
            "@echo off\r\nset PORT={port}\r\nset BIND_ADDR=127.0.0.1\r\nset DATABASE_URL={db}\r\nset SERVER_NAME=Local\r\nset DBM_LOCAL_ADMIN_HASH={hash}\r\nset RUST_LOG=info\r\n\"{bin}\"\r\n",
            port = options.port,
            db = db.to_string_lossy(),
            hash = options.admin_token_hash.replace('"', "\\\""),
            bin = bin.to_string_lossy(),
        );
        std::fs::write(&wrapper, script).map_err(|e| e.to_string())?;
        let out = Command::new("schtasks")
            .args([
                "/Create", "/F",
                "/SC", "ONLOGON",
                "/RL", "LIMITED",
                "/TN", TASK_NAME,
                "/TR", &format!("\"{}\"", wrapper.to_string_lossy()),
            ])
            .output()
            .map_err(|e| format!("schtasks: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "schtasks failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        Ok(wrapper.to_string_lossy().to_string())
    }

    pub(super) fn uninstall() -> Result<(), String> {
        let _ = Command::new("schtasks")
            .args(["/Delete", "/F", "/TN", TASK_NAME])
            .output();
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use tauri::Manager;

    const LABEL: &str = "com.gtrave.dbm-server";

    pub(super) fn plist_path() -> PathBuf {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{LABEL}.plist"))
    }

    pub(super) fn install(app: &AppHandle, options: &AutostartOptions) -> Result<String, String> {
        let bin = crate::local_server::resolve_binary_for_autostart(app)?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("local-server");
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let log = data_dir.join("server.log");
        let db = data_dir.join("dbm.sqlite");
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>{bin}</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>{port}</string>
    <key>BIND_ADDR</key><string>127.0.0.1</string>
    <key>DATABASE_URL</key><string>{db}</string>
    <key>SERVER_NAME</key><string>Local</string>
    <key>DBM_LOCAL_ADMIN_HASH</key><string>{hash}</string>
    <key>RUST_LOG</key><string>info</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict>
</plist>"#,
            LABEL = LABEL,
            bin = bin.to_string_lossy(),
            port = options.port,
            db = db.to_string_lossy(),
            hash = xml_escape(&options.admin_token_hash),
            log = log.to_string_lossy(),
        );
        let path = plist_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, plist).map_err(|e| e.to_string())?;
        // Load the agent immediately. Failure here is non-fatal — the agent
        // will load on next login.
        let _ = std::process::Command::new("launchctl")
            .args(["load", "-w", path.to_str().unwrap_or("")])
            .output();
        Ok(path.to_string_lossy().to_string())
    }

    pub(super) fn uninstall() -> Result<(), String> {
        let path = plist_path();
        if path.exists() {
            let _ = std::process::Command::new("launchctl")
                .args(["unload", path.to_str().unwrap_or("")])
                .output();
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn xml_escape(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
}
