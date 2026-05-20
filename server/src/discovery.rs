use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;

const SERVICE_TYPE: &str = "_dbm._tcp.local.";

/// Holds the mDNS daemon so it isn't dropped (which would unregister the service).
pub struct Announcement {
    _daemon: ServiceDaemon,
}

pub fn announce(name: &str, port: u16, accent_color: Option<&str>, providers: &[String]) -> Result<Announcement> {
    let daemon = ServiceDaemon::new()?;
    let instance = sanitize(name).to_string();
    let hostname = local_hostname();
    let ip = local_ip();
    let mut props: HashMap<String, String> = HashMap::new();
    props.insert("name".into(), name.into());
    props.insert("version".into(), env!("CARGO_PKG_VERSION").into());
    if let Some(c) = accent_color {
        props.insert("accent".into(), c.into());
    }
    if !providers.is_empty() {
        props.insert("providers".into(), providers.join(","));
    }
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &hostname,
        &ip,
        port,
        Some(props),
    )?;
    daemon.register(info)?;
    tracing::info!("mDNS announce: {instance}.{SERVICE_TYPE} at {ip}:{port}");
    Ok(Announcement { _daemon: daemon })
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect()
}

fn local_hostname() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "dbm-server".into())
        + ".local."
}

fn local_ip() -> String {
    // Best-effort: ask the OS for the route used to reach a public address.
    use std::net::UdpSocket;
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "0.0.0.0".into()
}
