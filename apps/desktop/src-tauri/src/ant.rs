//! ANT+ via clé USB Garmin/Dynastream (USB2 0fcf:1008, USB-m 0fcf:1009), en Rust pur avec `nusb`.
//!
//! Sous Windows, la clé doit utiliser le pilote WinUSB (voir README : Zadig).
//! - `ant_list_sticks`, `ant_open`, `ant_open_channel`, `ant_send`, `ant_close`.
//! - Événement : `ant://message` `{ channel, data }` (8 octets, diffusion / acquitté / rafale).
//!
//! La clé réseau ANT+ n'est jamais stockée dans le dépôt : variable d'environnement
//! `ANT_PLUS_NETWORK_KEY`, ou fichier `ant-plus-network-key.txt` dans le dossier de configuration
//! de l'application (`%APPDATA%\fr.cparfait.allezrobert\`).

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use nusb::descriptors::TransferType;
use nusb::transfer::{Bulk, Direction, In, Out};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;

use crate::ant_protocol::{self as proto, AntDecoder, AntMessage};
use crate::error::{io_error, AppError, AppResult};

pub const EVENT_MESSAGE: &str = "ant://message";
pub const NETWORK_KEY_ENV: &str = "ANT_PLUS_NETWORK_KEY";
pub const NETWORK_KEY_FILE: &str = "ant-plus-network-key.txt";

const GARMIN_VENDOR_ID: u16 = 0x0fcf;
const SUPPORTED_PRODUCTS: [(u16, &str); 2] = [
    (0x1008, "Clé ANT USB2 (Garmin/Dynastream)"),
    (0x1009, "Clé ANT USB-m (Garmin/Dynastream)"),
];
const NO_STICK: &str = "Aucune clé ANT+ détectée";
const RESPONSE_TIMEOUT: Duration = Duration::from_millis(1000);
const MAX_CHANNELS: u8 = 15;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAntStick {
    pub id: String,
    pub name: String,
    pub vendor_id: u16,
    pub product_id: u16,
}

#[derive(Debug, Clone, Serialize)]
struct MessagePayload {
    channel: u8,
    data: Vec<u8>,
}

struct OpenStick {
    id: String,
    writer: nusb::io::EndpointWrite<Bulk>,
    reader_task: JoinHandle<()>,
    incoming: broadcast::Sender<AntMessage>,
    open_channels: BTreeSet<u8>,
    _interface: nusb::Interface,
}

impl OpenStick {
    async fn write(&mut self, message: &AntMessage) -> AppResult<()> {
        let frame = message.encode();
        log::trace!("ANT → {:02X?}", frame);
        let result = tokio::time::timeout(RESPONSE_TIMEOUT, async {
            self.writer.write_all(&frame).await?;
            self.writer.flush().await
        })
        .await;
        match result {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(io_error("Écriture vers la clé ANT+", e)),
            Err(_) => Err(AppError::new("Écriture vers la clé ANT+ : délai dépassé")),
        }
    }

    /// Envoie une commande et attend la réponse 0x40 correspondante (code 0 = succès).
    async fn command(&mut self, channel: u8, message: AntMessage) -> AppResult<()> {
        let mut rx = self.incoming.subscribe();
        let id = message.id;
        self.write(&message).await?;
        let wait = async {
            loop {
                match rx.recv().await {
                    Ok(msg) => {
                        if let Some((ch, msg_id, code)) = msg.channel_event() {
                            if msg_id == id && ch == channel {
                                return Ok(code);
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => {
                        return Err(AppError::new("Clé ANT+ déconnectée"))
                    }
                }
            }
        };
        let code = tokio::time::timeout(RESPONSE_TIMEOUT, wait)
            .await
            .map_err(|_| AppError(format!("Clé ANT+ : pas de réponse à la commande 0x{id:02X}")))??;
        if code == proto::EVENT_CODE_RESPONSE_NO_ERROR {
            Ok(())
        } else {
            Err(AppError(format!(
                "Clé ANT+ : commande 0x{id:02X} refusée sur le canal {channel} ({}, code 0x{code:02X})",
                proto::response_code_label(code)
            )))
        }
    }

    /// Attend un message précis (ou expiration silencieuse).
    async fn wait_for(
        rx: &mut broadcast::Receiver<AntMessage>,
        timeout: Duration,
        predicate: impl Fn(&AntMessage) -> bool,
    ) -> bool {
        tokio::time::timeout(timeout, async {
            loop {
                match rx.recv().await {
                    Ok(msg) if predicate(&msg) => return true,
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return false,
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    async fn reset(&mut self) -> AppResult<()> {
        let mut rx = self.incoming.subscribe();
        self.write(&AntMessage::new(proto::MSG_RESET_SYSTEM, vec![0x00]))
            .await?;
        // Certaines clés n'envoient pas le message de démarrage : délai toléré.
        Self::wait_for(&mut rx, Duration::from_millis(1000), |m| {
            m.id == proto::MSG_STARTUP
        })
        .await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        Ok(())
    }

    async fn close_channel(&mut self, channel: u8) {
        let mut rx = self.incoming.subscribe();
        if self
            .command(channel, AntMessage::new(proto::MSG_CLOSE_CHANNEL, vec![channel]))
            .await
            .is_ok()
        {
            Self::wait_for(&mut rx, Duration::from_millis(500), |m| {
                m.channel_event() == Some((channel, 0x01, proto::EVENT_CHANNEL_CLOSED))
            })
            .await;
        }
        let _ = self
            .command(channel, AntMessage::new(proto::MSG_UNASSIGN_CHANNEL, vec![channel]))
            .await;
        self.open_channels.remove(&channel);
    }
}

#[derive(Default)]
struct Inner {
    stick: Mutex<Option<OpenStick>>,
}

#[derive(Default, Clone)]
pub struct AntState(Arc<Inner>);

// ---------------------------------------------------------------------------
// Énumération USB.
// ---------------------------------------------------------------------------

fn stick_id(info: &nusb::DeviceInfo) -> String {
    #[cfg(windows)]
    {
        info.instance_id().to_string_lossy().into_owned()
    }
    #[cfg(target_os = "linux")]
    {
        format!("{}-{}", info.busnum(), info.device_address())
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        format!(
            "{:04x}:{:04x}:{}",
            info.vendor_id(),
            info.product_id(),
            info.serial_number().unwrap_or("0")
        )
    }
}

fn product_name(product_id: u16) -> Option<&'static str> {
    SUPPORTED_PRODUCTS
        .iter()
        .find(|(pid, _)| *pid == product_id)
        .map(|(_, name)| *name)
}

async fn find_sticks() -> AppResult<Vec<(NativeAntStick, nusb::DeviceInfo)>> {
    let devices = nusb::list_devices()
        .await
        .map_err(|e| io_error("Énumération USB", e))?;
    Ok(devices
        .filter(|d| d.vendor_id() == GARMIN_VENDOR_ID)
        .filter_map(|d| {
            let base = product_name(d.product_id())?;
            let name = match d.serial_number() {
                Some(serial) if !serial.is_empty() => format!("{base} n° {serial}"),
                _ => base.to_owned(),
            };
            Some((
                NativeAntStick {
                    id: stick_id(&d),
                    name,
                    vendor_id: d.vendor_id(),
                    product_id: d.product_id(),
                },
                d,
            ))
        })
        .collect())
}

/// Clé réseau ANT+ : variable d'environnement, puis fichier de configuration de l'application.
fn load_network_key(app: &AppHandle) -> AppResult<[u8; 8]> {
    let mut sources: Vec<(String, String)> = Vec::new();
    if let Ok(value) = std::env::var(NETWORK_KEY_ENV) {
        sources.push((format!("variable d'environnement {NETWORK_KEY_ENV}"), value));
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().app_config_dir() {
        candidates.push(dir.join(NETWORK_KEY_FILE));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(NETWORK_KEY_FILE));
        }
    }
    for path in &candidates {
        if let Ok(content) = std::fs::read_to_string(path) {
            sources.push((path.display().to_string(), content));
        }
    }
    let Some((origin, raw)) = sources.into_iter().next() else {
        let hint = candidates
            .first()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| NETWORK_KEY_FILE.to_owned());
        return Err(AppError(format!(
            "Clé réseau ANT+ absente : définissez la variable d'environnement {NETWORK_KEY_ENV} \
             (16 caractères hexadécimaux) ou créez le fichier {hint}"
        )));
    };
    proto::parse_network_key(&raw).ok_or_else(|| {
        AppError(format!(
            "Clé réseau ANT+ invalide ({origin}) : 8 octets attendus en hexadécimal, ex. « 0011223344556677 »"
        ))
    })
}

// ---------------------------------------------------------------------------
// Commandes.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn ant_list_sticks() -> AppResult<Vec<NativeAntStick>> {
    Ok(find_sticks().await?.into_iter().map(|(s, _)| s).collect())
}

#[tauri::command]
pub async fn ant_open(app: AppHandle, state: State<'_, AntState>, stick_id: Option<String>) -> AppResult<()> {
    let wanted = stick_id.filter(|s| !s.trim().is_empty());
    let mut guard = state.0.stick.lock().await;
    if let Some(open) = guard.as_ref() {
        if wanted.as_deref().is_none_or(|w| w == open.id) && !open.reader_task.is_finished() {
            return Ok(()); // déjà ouverte
        }
    }
    if let Some(previous) = guard.take() {
        close_stick(previous).await;
    }

    let key = load_network_key(&app)?;
    let sticks = find_sticks().await?;
    if sticks.is_empty() {
        return Err(AppError::new(NO_STICK));
    }
    let (info, device_info) = match &wanted {
        Some(id) => sticks
            .into_iter()
            .find(|(s, _)| &s.id == id)
            .ok_or_else(|| AppError(format!("Clé ANT+ introuvable : {id}")))?,
        None => sticks.into_iter().next().ok_or_else(|| AppError::new(NO_STICK))?,
    };

    let driver_hint = "vérifiez que la clé utilise le pilote WinUSB (Zadig) et qu'aucune autre \
                       application (Garmin Express, Zwift…) ne l'utilise";
    let device = device_info
        .open()
        .await
        .map_err(|e| AppError(format!("Ouverture de la clé ANT+ impossible ({e}) : {driver_hint}")))?;
    let interface = device
        .claim_interface(0)
        .await
        .map_err(|e| AppError(format!("Accès à la clé ANT+ impossible ({e}) : {driver_hint}")))?;

    // Points de terminaison bulk (0x01 / 0x81 sur les clés Garmin).
    let (mut ep_in, mut ep_out) = (0x81u8, 0x01u8);
    if let Some(desc) = interface.descriptor() {
        for ep in desc.endpoints() {
            if ep.transfer_type() == TransferType::Bulk {
                match ep.direction() {
                    Direction::In => ep_in = ep.address(),
                    Direction::Out => ep_out = ep.address(),
                }
            }
        }
    }
    let reader = interface
        .endpoint::<Bulk, In>(ep_in)
        .map_err(|e| io_error("Clé ANT+ : point de terminaison d'entrée", e))?
        .reader(64)
        .with_num_transfers(4);
    let writer = interface
        .endpoint::<Bulk, Out>(ep_out)
        .map_err(|e| io_error("Clé ANT+ : point de terminaison de sortie", e))?
        .writer(64)
        .with_num_transfers(2);

    let (incoming, _) = broadcast::channel(256);
    let reader_task = tokio::spawn(read_loop(app.clone(), reader, incoming.clone()));
    let mut stick = OpenStick {
        id: info.id.clone(),
        writer,
        reader_task,
        incoming,
        open_channels: BTreeSet::new(),
        _interface: interface,
    };

    let setup = async {
        stick.reset().await?;
        let mut payload = vec![proto::ANT_PLUS_NETWORK];
        payload.extend_from_slice(&key);
        stick
            .command(
                proto::ANT_PLUS_NETWORK,
                AntMessage::new(proto::MSG_NETWORK_KEY, payload),
            )
            .await
    };
    if let Err(e) = setup.await {
        stick.reader_task.abort();
        return Err(e);
    }
    log::info!("Clé ANT+ ouverte : {} ({})", info.name, info.id);
    *guard = Some(stick);
    Ok(())
}

async fn read_loop(
    app: AppHandle,
    mut reader: nusb::io::EndpointRead<Bulk>,
    incoming: broadcast::Sender<AntMessage>,
) {
    let mut decoder = AntDecoder::new();
    let mut buf = [0u8; 256];
    loop {
        let n = match reader.read(&mut buf).await {
            Ok(0) => continue,
            Ok(n) => n,
            Err(e) => {
                log::warn!("Clé ANT+ : lecture interrompue ({e}) — clé retirée ?");
                break;
            }
        };
        for message in decoder.push(&buf[..n]) {
            if let Some((channel, data)) = message.data_payload() {
                let _ = app.emit(
                    EVENT_MESSAGE,
                    MessagePayload {
                        channel,
                        data: data.to_vec(),
                    },
                );
            } else if let Some((channel, 0x01, code)) = message.channel_event() {
                match code {
                    proto::EVENT_RX_SEARCH_TIMEOUT => {
                        log::info!("ANT+ canal {channel} : délai de recherche écoulé")
                    }
                    proto::EVENT_CHANNEL_CLOSED => log::info!("ANT+ canal {channel} fermé"),
                    proto::EVENT_RX_FAIL_GO_TO_SEARCH => {
                        log::info!("ANT+ canal {channel} : capteur perdu, nouvelle recherche")
                    }
                    proto::EVENT_RX_FAIL
                    | proto::EVENT_TRANSFER_TX_COMPLETED
                    | proto::EVENT_TRANSFER_TX_FAILED => {}
                    other => log::debug!("ANT+ canal {channel} : événement 0x{other:02X}"),
                }
            }
            let _ = incoming.send(message);
        }
    }
}

async fn close_stick(mut stick: OpenStick) {
    let channels: Vec<u8> = stick.open_channels.iter().copied().collect();
    for channel in channels {
        stick.close_channel(channel).await;
    }
    let _ = stick
        .write(&AntMessage::new(proto::MSG_RESET_SYSTEM, vec![0x00]))
        .await;
    stick.reader_task.abort();
    log::info!("Clé ANT+ fermée : {}", stick.id);
}

async fn with_stick<'a>(
    guard: &'a mut tokio::sync::MutexGuard<'_, Option<OpenStick>>,
) -> AppResult<&'a mut OpenStick> {
    let alive = guard.as_ref().is_some_and(|s| !s.reader_task.is_finished());
    if !alive {
        if let Some(dead) = guard.take() {
            dead.reader_task.abort();
        }
        return Err(AppError(format!("{NO_STICK} (ou clé non ouverte : appelez ant_open)")));
    }
    Ok(guard.as_mut().expect("clé vérifiée ci-dessus"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ant_open_channel(
    state: State<'_, AntState>,
    channel: u8,
    device_type: u8,
    device_number: u16,
    transmission_type: u8,
    period: u16,
    rf_freq: u8,
) -> AppResult<()> {
    if channel > MAX_CHANNELS {
        return Err(AppError(format!("Canal ANT+ invalide : {channel}")));
    }
    let mut guard = state.0.stick.lock().await;
    let stick = with_stick(&mut guard).await?;
    if stick.open_channels.contains(&channel) {
        stick.close_channel(channel).await;
    }
    let [num_lo, num_hi] = device_number.to_le_bytes();
    let [period_lo, period_hi] = period.to_le_bytes();
    stick
        .command(
            channel,
            AntMessage::new(
                proto::MSG_ASSIGN_CHANNEL,
                vec![channel, proto::CHANNEL_TYPE_SLAVE, proto::ANT_PLUS_NETWORK],
            ),
        )
        .await?;
    stick
        .command(
            channel,
            AntMessage::new(
                proto::MSG_CHANNEL_ID,
                vec![channel, num_lo, num_hi, device_type, transmission_type],
            ),
        )
        .await?;
    stick
        .command(
            channel,
            AntMessage::new(proto::MSG_CHANNEL_PERIOD, vec![channel, period_lo, period_hi]),
        )
        .await?;
    stick
        .command(channel, AntMessage::new(proto::MSG_RF_FREQUENCY, vec![channel, rf_freq]))
        .await?;
    // Recherche infinie en basse priorité (ne perturbe pas les autres canaux) ; à défaut,
    // recherche infinie en haute priorité.
    let low_priority = stick
        .command(
            channel,
            AntMessage::new(proto::MSG_LOW_PRIORITY_SEARCH_TIMEOUT, vec![channel, 0xFF]),
        )
        .await;
    let high_priority_timeout = if low_priority.is_ok() { 0x00 } else { 0xFF };
    let _ = stick
        .command(
            channel,
            AntMessage::new(proto::MSG_SEARCH_TIMEOUT, vec![channel, high_priority_timeout]),
        )
        .await;
    stick
        .command(channel, AntMessage::new(proto::MSG_OPEN_CHANNEL, vec![channel]))
        .await?;
    stick.open_channels.insert(channel);
    log::info!(
        "ANT+ canal {channel} ouvert : type 0x{device_type:02X}, n° {device_number}, \
         transmission {transmission_type}, période {period}, fréquence 2400+{rf_freq} MHz"
    );
    Ok(())
}

#[tauri::command]
pub async fn ant_send(
    state: State<'_, AntState>,
    channel: u8,
    data: Vec<u8>,
    acknowledged: Option<bool>,
) -> AppResult<()> {
    if data.len() != 8 {
        return Err(AppError(format!(
            "Message ANT+ : 8 octets attendus, {} reçus",
            data.len()
        )));
    }
    let mut guard = state.0.stick.lock().await;
    let stick = with_stick(&mut guard).await?;
    if !stick.open_channels.contains(&channel) {
        return Err(AppError(format!("Canal ANT+ {channel} non ouvert")));
    }
    let id = if acknowledged.unwrap_or(false) {
        proto::MSG_ACKNOWLEDGED_DATA
    } else {
        proto::MSG_BROADCAST_DATA
    };
    let mut payload = Vec::with_capacity(9);
    payload.push(channel);
    payload.extend_from_slice(&data);
    stick.write(&AntMessage::new(id, payload)).await
}

#[tauri::command]
pub async fn ant_close(state: State<'_, AntState>) -> AppResult<()> {
    let stick = state.0.stick.lock().await.take();
    if let Some(stick) = stick {
        close_stick(stick).await;
    }
    Ok(())
}

pub async fn shutdown(state: &AntState) {
    let stick = state.0.stick.lock().await.take();
    if let Some(stick) = stick {
        close_stick(stick).await;
    }
}
