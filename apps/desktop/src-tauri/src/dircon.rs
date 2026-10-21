//! Wahoo Direct Connect (DirCon) : découverte mDNS `_wahoo-fitness-tnp._tcp` et transport TCP brut.
//!
//! Le protocole DirCon lui-même (en-têtes, découverte GATT, notifications) est géré côté
//! TypeScript : ici on se contente de transporter des octets.
//! - `dircon_discover`, `dircon_connect`, `dircon_send`, `dircon_close`.
//! - Événements : `dircon://data`, `dircon://closed`.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::error::{io_error, AppError, AppResult};

pub const SERVICE_TYPE: &str = "_wahoo-fitness-tnp._tcp.local.";
pub const EVENT_DATA: &str = "dircon://data";
pub const EVENT_CLOSED: &str = "dircon://closed";

const DEFAULT_DISCOVERY_MS: u64 = 3000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeDirconDevice {
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    pub services: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac_address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DataPayload {
    connection_id: String,
    data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClosedPayload {
    connection_id: String,
}

/// Informations extraites des enregistrements TXT d'un service DirCon.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct TxtInfo {
    pub serial_number: Option<String>,
    pub mac_address: Option<String>,
    pub services: Vec<String>,
}

/// Étend un UUID 16 bits (`"1826"`, `"0x1826"`) en UUID 128 bits Bluetooth SIG, minuscules.
fn normalize_service_uuid(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if (hex.len() == 4 || hex.len() == 8) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        let short = u32::from_str_radix(hex, 16).ok()?;
        return Some(format!("{short:08x}-0000-1000-8000-00805f9b34fb"));
    }
    let lower = trimmed.to_ascii_lowercase();
    let compact: String = lower.chars().filter(|c| *c != '-').collect();
    if compact.len() == 32 && compact.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(format!(
            "{}-{}-{}-{}-{}",
            &compact[0..8],
            &compact[8..12],
            &compact[12..16],
            &compact[16..20],
            &compact[20..32]
        ));
    }
    None
}

/// Analyse les paires clé/valeur TXT (clés insensibles à la casse) :
/// `serial-number`, `mac-address`, `ble-service-uuids` (liste séparée par des virgules).
pub fn parse_txt<'a>(pairs: impl IntoIterator<Item = (&'a str, &'a str)>) -> TxtInfo {
    let mut info = TxtInfo::default();
    for (key, value) in pairs {
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "serial-number" if !value.is_empty() => info.serial_number = Some(value.to_owned()),
            "mac-address" if !value.is_empty() => {
                info.mac_address = Some(value.to_ascii_uppercase().replace('-', ":"))
            }
            "ble-service-uuids" => {
                for uuid in value.split([',', ' ', ';']).filter_map(normalize_service_uuid) {
                    if !info.services.contains(&uuid) {
                        info.services.push(uuid);
                    }
                }
            }
            _ => {}
        }
    }
    info
}

/// Nom d'instance lisible à partir du nom complet mDNS (« KICKR BIKE 1234._wahoo-fitness-tnp._tcp.local. »).
pub fn instance_name(fullname: &str) -> String {
    let name = fullname
        .strip_suffix(SERVICE_TYPE)
        .map(|n| n.trim_end_matches('.'))
        .unwrap_or(fullname);
    // Les caractères spéciaux peuvent être échappés (`\032` pour l'espace, `\.`).
    let mut out = String::with_capacity(name.len());
    let bytes = name.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            if i + 3 < bytes.len() && bytes[i + 1..i + 4].iter().all(u8::is_ascii_digit) {
                if let Ok(code) = name[i + 1..i + 4].parse::<u8>() {
                    out.push(code as char);
                    i += 4;
                    continue;
                }
            }
            if i + 1 < bytes.len() {
                i += 1;
            }
        }
        let ch = name[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn pick_host(addresses: impl IntoIterator<Item = IpAddr>) -> Option<String> {
    let mut v6 = None;
    for addr in addresses {
        match addr {
            IpAddr::V4(v4) => return Some(v4.to_string()),
            IpAddr::V6(v6addr) if v6.is_none() => v6 = Some(v6addr.to_string()),
            _ => {}
        }
    }
    v6
}

fn discover_blocking(timeout: Duration) -> AppResult<Vec<NativeDirconDevice>> {
    let daemon = ServiceDaemon::new().map_err(|e| io_error("Démarrage de la recherche mDNS", e))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| io_error("Recherche mDNS Direct Connect", e))?;
    let deadline = Instant::now() + timeout;
    let mut found: HashMap<String, NativeDirconDevice> = HashMap::new();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match receiver.recv_timeout(deadline - now) {
            Ok(ServiceEvent::ServiceResolved(service)) => {
                let Some(host) = pick_host(service.get_addresses().iter().map(|a| a.to_ip_addr()))
                else {
                    continue;
                };
                let txt = parse_txt(
                    service
                        .get_properties()
                        .iter()
                        .map(|p| (p.key(), p.val_str())),
                );
                let device = NativeDirconDevice {
                    name: instance_name(service.get_fullname()),
                    host,
                    port: service.get_port(),
                    serial_number: txt.serial_number,
                    services: txt.services,
                    mac_address: txt.mac_address,
                };
                log::info!(
                    "Direct Connect : {} sur {}:{}",
                    device.name,
                    device.host,
                    device.port
                );
                found.insert(service.get_fullname().to_owned(), device);
            }
            Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
                found.remove(&fullname);
            }
            Ok(_) => {}
            Err(_) => break, // délai écoulé ou canal fermé
        }
    }
    let _ = daemon.stop_browse(SERVICE_TYPE);
    let _ = daemon.shutdown();
    let mut devices: Vec<_> = found.into_values().collect();
    devices.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(devices)
}

// ---------------------------------------------------------------------------
// Connexions TCP.
// ---------------------------------------------------------------------------

struct Connection {
    writer: Arc<Mutex<OwnedWriteHalf>>,
    reader_task: JoinHandle<()>,
}

#[derive(Default)]
struct Inner {
    next_id: AtomicU64,
    connections: Mutex<HashMap<String, Connection>>,
}

#[derive(Default, Clone)]
pub struct DirconState(Arc<Inner>);

impl DirconState {
    /// Retire la connexion et émet `dircon://closed` une seule fois.
    async fn remove(&self, app: &AppHandle, connection_id: &str, abort_reader: bool) -> bool {
        let removed = self.0.connections.lock().await.remove(connection_id);
        let Some(conn) = removed else { return false };
        if abort_reader {
            conn.reader_task.abort();
        }
        if let Ok(mut writer) = conn.writer.try_lock() {
            let _ = tokio::time::timeout(Duration::from_millis(500), writer.shutdown()).await;
        }
        log::info!("Direct Connect fermé : {connection_id}");
        let _ = app.emit(
            EVENT_CLOSED,
            ClosedPayload {
                connection_id: connection_id.to_owned(),
            },
        );
        true
    }
}

#[tauri::command]
pub async fn dircon_discover(timeout_ms: Option<u64>) -> AppResult<Vec<NativeDirconDevice>> {
    let ms = timeout_ms.unwrap_or(DEFAULT_DISCOVERY_MS).clamp(250, 60_000);
    tokio::task::spawn_blocking(move || discover_blocking(Duration::from_millis(ms)))
        .await
        .map_err(|e| io_error("Recherche Direct Connect interrompue", e))?
}

#[tauri::command]
pub async fn dircon_connect(
    app: AppHandle,
    state: State<'_, DirconState>,
    host: String,
    port: u16,
) -> AppResult<String> {
    let target = host.trim().trim_start_matches('[').trim_end_matches(']').to_owned();
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((target.as_str(), port)))
        .await
        .map_err(|_| AppError(format!("Connexion Direct Connect à {host}:{port} : délai dépassé")))?
        .map_err(|e| io_error(&format!("Connexion Direct Connect à {host}:{port}"), e))?;
    let _ = stream.set_nodelay(true);
    let (mut reader, writer) = stream.into_split();

    let id = format!("dircon-{}", state.0.next_id.fetch_add(1, Ordering::SeqCst) + 1);
    let task_state = (*state).clone();
    let task_app = app.clone();
    let task_id = id.clone();
    // Le lecteur attend que la connexion soit enregistrée avant de lire.
    let mut connections = state.0.connections.lock().await;
    let reader_task = tokio::spawn(async move {
        let mut buf = vec![0u8; 4096];
        loop {
            match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let payload = DataPayload {
                        connection_id: task_id.clone(),
                        data: buf[..n].to_vec(),
                    };
                    if let Err(e) = task_app.emit(EVENT_DATA, payload) {
                        log::warn!("Émission de {EVENT_DATA} impossible : {e}");
                    }
                }
                Err(e) => {
                    log::warn!("Direct Connect {task_id} : lecture interrompue ({e})");
                    break;
                }
            }
        }
        task_state.remove(&task_app, &task_id, false).await;
    });
    connections.insert(
        id.clone(),
        Connection {
            writer: Arc::new(Mutex::new(writer)),
            reader_task,
        },
    );
    log::info!("Direct Connect ouvert : {id} → {host}:{port}");
    Ok(id)
}

#[tauri::command]
pub async fn dircon_send(
    app: AppHandle,
    state: State<'_, DirconState>,
    connection_id: String,
    data: Vec<u8>,
) -> AppResult<()> {
    let writer = state
        .0
        .connections
        .lock()
        .await
        .get(&connection_id)
        .map(|c| c.writer.clone())
        .ok_or_else(|| AppError(format!("Connexion Direct Connect inconnue ou fermée : {connection_id}")))?;
    let result = tokio::time::timeout(WRITE_TIMEOUT, async {
        let mut w = writer.lock().await;
        w.write_all(&data).await?;
        w.flush().await
    })
    .await;
    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => {
            state.remove(&app, &connection_id, true).await;
            Err(io_error("Envoi Direct Connect", e))
        }
        Err(_) => {
            state.remove(&app, &connection_id, true).await;
            Err(AppError::new("Envoi Direct Connect : délai dépassé"))
        }
    }
}

#[tauri::command]
pub async fn dircon_close(
    app: AppHandle,
    state: State<'_, DirconState>,
    connection_id: String,
) -> AppResult<()> {
    state.remove(&app, &connection_id, true).await;
    Ok(())
}

pub async fn shutdown(state: &DirconState) {
    let connections: Vec<_> = state.0.connections.lock().await.drain().collect();
    for (_, conn) in connections {
        conn.reader_task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn txt_kickr() {
        let info = parse_txt([
            ("serial-number", "120123456789"),
            ("MAC-Address", "aa-bb-cc-dd-ee-ff"),
            ("ble-service-uuids", "0x1818,0x1826, A026EE0B-0A7D-4AB3-97FA-F1500F9FEB8B,1818"),
            ("other", "x"),
        ]);
        assert_eq!(info.serial_number.as_deref(), Some("120123456789"));
        assert_eq!(info.mac_address.as_deref(), Some("AA:BB:CC:DD:EE:FF"));
        assert_eq!(
            info.services,
            vec![
                "00001818-0000-1000-8000-00805f9b34fb",
                "00001826-0000-1000-8000-00805f9b34fb",
                "a026ee0b-0a7d-4ab3-97fa-f1500f9feb8b",
            ]
        );
    }

    #[test]
    fn txt_vide_ou_invalide() {
        let info = parse_txt([("ble-service-uuids", ""), ("serial-number", " ")]);
        assert_eq!(info, TxtInfo::default());
        let info = parse_txt([("ble-service-uuids", "zz,12345")]);
        assert!(info.services.is_empty());
    }

    #[test]
    fn nom_d_instance() {
        assert_eq!(
            instance_name("KICKR BIKE 1A2B._wahoo-fitness-tnp._tcp.local."),
            "KICKR BIKE 1A2B"
        );
        assert_eq!(
            instance_name("KICKR\\032CORE._wahoo-fitness-tnp._tcp.local."),
            "KICKR CORE"
        );
    }

    #[test]
    fn choix_hote_ipv4() {
        let v6: IpAddr = "fe80::1".parse().unwrap();
        let v4: IpAddr = "192.168.1.20".parse().unwrap();
        assert_eq!(pick_host([v6, v4]).as_deref(), Some("192.168.1.20"));
        assert_eq!(pick_host([v6]).as_deref(), Some("fe80::1"));
    }
}
