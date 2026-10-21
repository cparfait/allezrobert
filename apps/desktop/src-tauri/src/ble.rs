//! Bluetooth Low Energy natif (btleplug / WinRT sous Windows).
//!
//! Contrat : `packages/shared/src/native-bridge.ts`.
//! - `ble_list_adapters`, `ble_select_adapter`, `ble_start_scan`, `ble_stop_scan`,
//!   `ble_connect`, `ble_disconnect`, `ble_read`, `ble_write`, `ble_subscribe`, `ble_unsubscribe`.
//! - Événements : `ble://discovered`, `ble://notification`, `ble://disconnected`.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use std::time::{Duration, Instant};

use btleplug::api::{
    Central, CentralEvent, CharPropFlags, Characteristic, Manager as _, Peripheral as _,
    PeripheralProperties, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral, PeripheralId};
use futures::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::error::{ble_error, AppError, AppResult};

pub const EVENT_DISCOVERED: &str = "ble://discovered";
pub const EVENT_NOTIFICATION: &str = "ble://notification";
pub const EVENT_DISCONNECTED: &str = "ble://disconnected";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DISCOVER_TIMEOUT: Duration = Duration::from_secs(20);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(10);
/// Intervalle minimal entre deux `ble://discovered` pour un même appareil (mise à jour RSSI).
const DISCOVERY_THROTTLE: Duration = Duration::from_millis(1000);
/// Vérification périodique de la connexion (appareil éteint sans événement système).
const WATCHDOG_PERIOD: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// Types échangés avec le TypeScript (camelCase).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAdapter {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDiscovered {
    pub device_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rssi: Option<i16>,
    pub services: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer_data: Option<HashMap<String, Vec<u8>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCharacteristic {
    pub uuid: String,
    pub properties: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeGattService {
    pub uuid: String,
    pub characteristics: Vec<NativeCharacteristic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeNotification {
    pub device_id: String,
    pub service: String,
    pub characteristic: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectedPayload {
    pub device_id: String,
}

// ---------------------------------------------------------------------------
// État partagé.
// ---------------------------------------------------------------------------

struct SelectedAdapter {
    id: String,
    adapter: Adapter,
    events_task: JoinHandle<()>,
}

struct ConnectedDevice {
    peripheral: Peripheral,
    tasks: Vec<JoinHandle<()>>,
}

impl ConnectedDevice {
    fn abort_tasks(&self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

#[derive(Clone, PartialEq)]
struct SeenDevice {
    name: String,
    services: BTreeSet<String>,
    manufacturer_keys: BTreeSet<u16>,
}

#[derive(Default)]
struct Inner {
    manager: Mutex<Option<Manager>>,
    selected: Mutex<Option<SelectedAdapter>>,
    /// Appareils vus pendant les recherches (clé : deviceId).
    peripherals: RwLock<HashMap<String, Peripheral>>,
    connected: RwLock<HashMap<String, ConnectedDevice>>,
    /// Déduplication des annonces : dernier contenu émis et date d'émission.
    seen: Mutex<HashMap<String, (SeenDevice, Instant)>>,
    scanning: std::sync::atomic::AtomicBool,
}

/// État Tauri (`app.manage(BleState::default())`).
#[derive(Default, Clone)]
pub struct BleState(Arc<Inner>);

impl BleState {
    async fn manager(&self) -> AppResult<Manager> {
        let mut guard = self.0.manager.lock().await;
        if let Some(manager) = guard.as_ref() {
            return Ok(manager.clone());
        }
        let manager = Manager::new()
            .await
            .map_err(|e| ble_error("Initialisation du Bluetooth", e))?;
        *guard = Some(manager.clone());
        Ok(manager)
    }

    /// Adaptateur sélectionné, ou adaptateur par défaut (sélectionné automatiquement).
    async fn adapter(&self, app: &AppHandle) -> AppResult<Adapter> {
        if let Some(selected) = self.0.selected.lock().await.as_ref() {
            return Ok(selected.adapter.clone());
        }
        let adapters = list_adapters_inner(self).await?;
        let default = adapters
            .iter()
            .find(|(info, _)| info.is_default)
            .or_else(|| adapters.first())
            .ok_or_else(|| AppError::new("Aucun adaptateur Bluetooth détecté"))?;
        let (info, adapter) = (default.0.clone(), default.1.clone());
        self.install_adapter(app, info.id, adapter.clone()).await?;
        Ok(adapter)
    }

    async fn install_adapter(&self, app: &AppHandle, id: String, adapter: Adapter) -> AppResult<()> {
        let mut selected = self.0.selected.lock().await;
        if let Some(previous) = selected.take() {
            if previous.id == id {
                *selected = Some(previous);
                return Ok(());
            }
            let _ = previous.adapter.stop_scan().await;
            previous.events_task.abort();
            self.0.scanning.store(false, std::sync::atomic::Ordering::SeqCst);
        }
        let events = adapter
            .events()
            .await
            .map_err(|e| ble_error("Écoute des événements Bluetooth", e))?;
        let events_task = tokio::spawn(run_adapter_events(
            self.clone(),
            app.clone(),
            adapter.clone(),
            events,
        ));
        log::info!("Adaptateur Bluetooth sélectionné : {id}");
        *selected = Some(SelectedAdapter {
            id,
            adapter,
            events_task,
        });
        Ok(())
    }

    async fn find_peripheral(&self, app: &AppHandle, device_id: &str) -> AppResult<Peripheral> {
        if let Some(p) = self.0.connected.read().await.get(device_id) {
            return Ok(p.peripheral.clone());
        }
        if let Some(p) = self.0.peripherals.read().await.get(device_id) {
            return Ok(p.clone());
        }
        let adapter = self.adapter(app).await?;
        let peripherals = adapter
            .peripherals()
            .await
            .map_err(|e| ble_error("Recherche de l'appareil", e))?;
        peripherals
            .into_iter()
            .find(|p| peripheral_key(&p.id()) == device_id)
            .ok_or_else(|| {
                AppError(format!(
                    "Appareil Bluetooth introuvable : {device_id} (relancez une recherche)"
                ))
            })
    }

    async fn connected_peripheral(&self, device_id: &str) -> AppResult<Peripheral> {
        self.0
            .connected
            .read()
            .await
            .get(device_id)
            .map(|d| d.peripheral.clone())
            .ok_or_else(|| AppError(format!("Appareil Bluetooth non connecté : {device_id}")))
    }

    /// Retire l'appareil de la table des connexions et émet `ble://disconnected` (une seule fois).
    async fn mark_disconnected(&self, app: &AppHandle, device_id: &str) -> bool {
        let removed = self.0.connected.write().await.remove(device_id);
        match removed {
            Some(device) => {
                device.abort_tasks();
                log::info!("Appareil Bluetooth déconnecté : {device_id}");
                let _ = app.emit(
                    EVENT_DISCONNECTED,
                    DisconnectedPayload {
                        device_id: device_id.to_owned(),
                    },
                );
                true
            }
            None => false,
        }
    }

    /// Après une erreur d'opération : si l'appareil a disparu, nettoie et prévient le front.
    async fn check_still_connected(&self, app: &AppHandle, device_id: &str, peripheral: &Peripheral) {
        let connected = tokio::time::timeout(Duration::from_secs(2), peripheral.is_connected())
            .await
            .ok()
            .and_then(|r| r.ok())
            .unwrap_or(false);
        if !connected {
            self.mark_disconnected(app, device_id).await;
        }
    }
}

fn peripheral_key(id: &PeripheralId) -> String {
    id.to_string()
}

// ---------------------------------------------------------------------------
// Utilitaires UUID / propriétés.
// ---------------------------------------------------------------------------

/// Normalise un UUID reçu du TypeScript : 128 bits (casse indifférente), ou 16/32 bits
/// (`"180d"`, `"0x180D"`, `"0000180d"`) étendus avec la base Bluetooth SIG.
pub fn parse_uuid(raw: &str) -> AppResult<Uuid> {
    let trimmed = raw.trim();
    let hex = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    if (hex.len() == 4 || hex.len() == 8) && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        let short = u32::from_str_radix(hex, 16).map_err(|_| invalid_uuid(raw))?;
        return Ok(Uuid::from_u128(
            ((short as u128) << 96) | 0x0000_0000_0000_1000_8000_0080_5f9b_34fb_u128,
        ));
    }
    Uuid::parse_str(trimmed).map_err(|_| invalid_uuid(raw))
}

fn invalid_uuid(raw: &str) -> AppError {
    AppError(format!("UUID Bluetooth invalide : « {raw} »"))
}

fn uuid_string(uuid: &Uuid) -> String {
    uuid.hyphenated().to_string().to_ascii_lowercase()
}

/// Noms de propriétés alignés sur Web Bluetooth (`BluetoothCharacteristicProperties`).
pub fn property_names(flags: CharPropFlags) -> Vec<String> {
    const NAMES: [(CharPropFlags, &str); 8] = [
        (CharPropFlags::BROADCAST, "broadcast"),
        (CharPropFlags::READ, "read"),
        (CharPropFlags::WRITE_WITHOUT_RESPONSE, "writeWithoutResponse"),
        (CharPropFlags::WRITE, "write"),
        (CharPropFlags::NOTIFY, "notify"),
        (CharPropFlags::INDICATE, "indicate"),
        (CharPropFlags::AUTHENTICATED_SIGNED_WRITES, "authenticatedSignedWrites"),
        (CharPropFlags::EXTENDED_PROPERTIES, "reliableWrite"),
    ];
    NAMES
        .iter()
        .filter(|(flag, _)| flags.contains(*flag))
        .map(|(_, name)| (*name).to_owned())
        .collect()
}

fn find_characteristic(
    peripheral: &Peripheral,
    service: &str,
    characteristic: &str,
) -> AppResult<Characteristic> {
    let service_uuid = parse_uuid(service)?;
    let char_uuid = parse_uuid(characteristic)?;
    peripheral
        .characteristics()
        .into_iter()
        .find(|c| c.uuid == char_uuid && c.service_uuid == service_uuid)
        .ok_or_else(|| {
            AppError(format!(
                "Caractéristique {} introuvable dans le service {}",
                uuid_string(&char_uuid),
                uuid_string(&service_uuid)
            ))
        })
}

fn describe_services(peripheral: &Peripheral) -> Vec<NativeGattService> {
    peripheral
        .services()
        .into_iter()
        .map(|service| NativeGattService {
            uuid: uuid_string(&service.uuid),
            characteristics: service
                .characteristics
                .iter()
                .map(|c| NativeCharacteristic {
                    uuid: uuid_string(&c.uuid),
                    properties: property_names(c.properties),
                })
                .collect(),
        })
        .collect()
}

fn discovered_payload(device_id: &str, props: &PeripheralProperties) -> NativeDiscovered {
    let name = props
        .local_name
        .clone()
        .or_else(|| props.advertisement_name.clone())
        .unwrap_or_default();
    let mut services: Vec<String> = props.services.iter().map(uuid_string).collect();
    // Les UUID présents uniquement dans les « service data » sont aussi des services annoncés.
    for uuid in props.service_data.keys() {
        let s = uuid_string(uuid);
        if !services.contains(&s) {
            services.push(s);
        }
    }
    let manufacturer_data = if props.manufacturer_data.is_empty() {
        None
    } else {
        Some(
            props
                .manufacturer_data
                .iter()
                .map(|(company, data)| (company.to_string(), data.clone()))
                .collect(),
        )
    };
    NativeDiscovered {
        device_id: device_id.to_owned(),
        name,
        rssi: props.rssi,
        services,
        manufacturer_data,
    }
}

// ---------------------------------------------------------------------------
// Boucle d'événements de l'adaptateur.
// ---------------------------------------------------------------------------

async fn run_adapter_events(
    state: BleState,
    app: AppHandle,
    adapter: Adapter,
    mut events: std::pin::Pin<Box<dyn futures::Stream<Item = CentralEvent> + Send>>,
) {
    while let Some(event) = events.next().await {
        match event {
            CentralEvent::DeviceDiscovered(id)
            | CentralEvent::DeviceUpdated(id)
            | CentralEvent::RssiUpdate { id, .. }
            | CentralEvent::ServicesAdvertisement { id, .. }
            | CentralEvent::ServiceDataAdvertisement { id, .. }
            | CentralEvent::ManufacturerDataAdvertisement { id, .. } => {
                handle_advertisement(&state, &app, &adapter, &id).await;
            }
            CentralEvent::DeviceDisconnected(id) => {
                state.mark_disconnected(&app, &peripheral_key(&id)).await;
            }
            CentralEvent::StateUpdate(s) => log::info!("État de l'adaptateur Bluetooth : {s:?}"),
            _ => {}
        }
    }
    log::warn!("Flux d'événements de l'adaptateur Bluetooth terminé");
}

async fn handle_advertisement(state: &BleState, app: &AppHandle, adapter: &Adapter, id: &PeripheralId) {
    if !state.0.scanning.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let Ok(peripheral) = adapter.peripheral(id).await else {
        return;
    };
    let Ok(Some(props)) = peripheral.properties().await else {
        return;
    };
    let device_id = peripheral_key(id);
    state
        .0
        .peripherals
        .write()
        .await
        .insert(device_id.clone(), peripheral);

    let payload = discovered_payload(&device_id, &props);
    let summary = SeenDevice {
        name: payload.name.clone(),
        services: payload.services.iter().cloned().collect(),
        manufacturer_keys: props.manufacturer_data.keys().copied().collect(),
    };
    let now = Instant::now();
    {
        let mut seen = state.0.seen.lock().await;
        if let Some((previous, last)) = seen.get(&device_id) {
            if *previous == summary && now.duration_since(*last) < DISCOVERY_THROTTLE {
                return;
            }
        }
        seen.insert(device_id, (summary, now));
    }
    if let Err(e) = app.emit(EVENT_DISCOVERED, payload) {
        log::warn!("Émission de {EVENT_DISCOVERED} impossible : {e}");
    }
}

// ---------------------------------------------------------------------------
// Commandes.
// ---------------------------------------------------------------------------

async fn list_adapters_inner(state: &BleState) -> AppResult<Vec<(NativeAdapter, Adapter)>> {
    let manager = state.manager().await?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|e| ble_error("Liste des adaptateurs Bluetooth", e))?;

    #[cfg(windows)]
    let system = crate::ble_windows::system_adapters().await;

    let mut result = Vec::with_capacity(adapters.len());
    for (index, adapter) in adapters.into_iter().enumerate() {
        let address = adapter.adapter_address().await.ok().flatten().map(|a| a.to_string());
        let id = address.clone().unwrap_or_else(|| format!("adapter-{index}"));
        #[allow(unused_mut)]
        let mut name = match &address {
            Some(addr) => format!("Adaptateur Bluetooth {} ({addr})", index + 1),
            None => format!("Adaptateur Bluetooth {}", index + 1),
        };
        #[allow(unused_mut)]
        let mut is_default = index == 0;
        #[cfg(windows)]
        if let Some(addr) = &address {
            if let Some(info) = system
                .adapters
                .iter()
                .find(|a| a.address.eq_ignore_ascii_case(addr))
            {
                name = format!("{} ({addr})", info.name);
            }
            if let Some(default) = &system.default_address {
                is_default = default.eq_ignore_ascii_case(addr);
            }
        }
        result.push((NativeAdapter { id, name, is_default }, adapter));
    }
    // Garantit au plus un adaptateur par défaut, et au moins un s'il y en a.
    if !result.iter().any(|(a, _)| a.is_default) {
        if let Some((first, _)) = result.first_mut() {
            first.is_default = true;
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn ble_list_adapters(state: State<'_, BleState>) -> AppResult<Vec<NativeAdapter>> {
    let adapters = list_adapters_inner(&state).await?;
    Ok(adapters.into_iter().map(|(info, _)| info).collect())
}

#[tauri::command]
pub async fn ble_select_adapter(
    app: AppHandle,
    state: State<'_, BleState>,
    adapter_id: String,
) -> AppResult<()> {
    let adapters = list_adapters_inner(&state).await?;
    let (info, adapter) = adapters
        .into_iter()
        .find(|(info, _)| info.id == adapter_id)
        .ok_or_else(|| AppError(format!("Adaptateur Bluetooth introuvable : {adapter_id}")))?;
    state.install_adapter(&app, info.id, adapter).await
}

#[tauri::command]
pub async fn ble_start_scan(
    app: AppHandle,
    state: State<'_, BleState>,
    services: Option<Vec<String>>,
) -> AppResult<()> {
    let services = services
        .unwrap_or_default()
        .iter()
        .map(|s| parse_uuid(s))
        .collect::<AppResult<Vec<_>>>()?;
    let adapter = state.adapter(&app).await?;
    state.0.seen.lock().await.clear();
    state.0.scanning.store(true, std::sync::atomic::Ordering::SeqCst);
    // Relance propre si une recherche était déjà en cours (nouveau filtre).
    let _ = adapter.stop_scan().await;
    if let Err(e) = adapter.start_scan(ScanFilter { services }).await {
        state.0.scanning.store(false, std::sync::atomic::Ordering::SeqCst);
        return Err(ble_error("Démarrage de la recherche Bluetooth", e));
    }
    log::info!("Recherche Bluetooth démarrée");
    Ok(())
}

#[tauri::command]
pub async fn ble_stop_scan(state: State<'_, BleState>) -> AppResult<()> {
    state.0.scanning.store(false, std::sync::atomic::Ordering::SeqCst);
    let adapter = state.0.selected.lock().await.as_ref().map(|s| s.adapter.clone());
    if let Some(adapter) = adapter {
        adapter
            .stop_scan()
            .await
            .map_err(|e| ble_error("Arrêt de la recherche Bluetooth", e))?;
        log::info!("Recherche Bluetooth arrêtée");
    }
    Ok(())
}

#[tauri::command]
pub async fn ble_connect(
    app: AppHandle,
    state: State<'_, BleState>,
    device_id: String,
) -> AppResult<Vec<NativeGattService>> {
    let peripheral = state.find_peripheral(&app, &device_id).await?;

    let already = peripheral.is_connected().await.unwrap_or(false);
    if !already {
        log::info!("Connexion Bluetooth à {device_id}…");
        match tokio::time::timeout(CONNECT_TIMEOUT, peripheral.connect()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(ble_error("Connexion Bluetooth", e)),
            Err(_) => {
                let _ = peripheral.disconnect().await;
                return Err(AppError(format!(
                    "Connexion Bluetooth : délai dépassé ({} s) pour {device_id}",
                    CONNECT_TIMEOUT.as_secs()
                )));
            }
        }
    }

    match tokio::time::timeout(DISCOVER_TIMEOUT, peripheral.discover_services()).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = peripheral.disconnect().await;
            return Err(ble_error("Découverte des services", e));
        }
        Err(_) => {
            let _ = peripheral.disconnect().await;
            return Err(AppError::new("Découverte des services : délai dépassé"));
        }
    }
    let services = describe_services(&peripheral);

    // (Re)lance les tâches de notification et de surveillance.
    let mut connected = state.0.connected.write().await;
    if let Some(previous) = connected.remove(&device_id) {
        previous.abort_tasks();
    }
    let notifications = peripheral
        .notifications()
        .await
        .map_err(|e| ble_error("Abonnement aux notifications", e))?;
    let notif_task = tokio::spawn(forward_notifications(app.clone(), device_id.clone(), notifications));
    let watchdog = tokio::spawn(watch_connection(
        (*state).clone(),
        app.clone(),
        device_id.clone(),
        peripheral.clone(),
    ));
    connected.insert(
        device_id.clone(),
        ConnectedDevice {
            peripheral,
            tasks: vec![notif_task, watchdog],
        },
    );
    log::info!("Connecté à {device_id} ({} services)", services.len());
    Ok(services)
}

async fn forward_notifications(
    app: AppHandle,
    device_id: String,
    mut stream: std::pin::Pin<Box<dyn futures::Stream<Item = btleplug::api::ValueNotification> + Send>>,
) {
    while let Some(n) = stream.next().await {
        let payload = NativeNotification {
            device_id: device_id.clone(),
            service: uuid_string(&n.service_uuid),
            characteristic: uuid_string(&n.uuid),
            data: n.value,
        };
        if let Err(e) = app.emit(EVENT_NOTIFICATION, payload) {
            log::warn!("Émission de {EVENT_NOTIFICATION} impossible : {e}");
        }
    }
}

async fn watch_connection(state: BleState, app: AppHandle, device_id: String, peripheral: Peripheral) {
    let mut interval = tokio::time::interval(WATCHDOG_PERIOD);
    interval.tick().await;
    loop {
        interval.tick().await;
        let connected = tokio::time::timeout(Duration::from_secs(2), peripheral.is_connected())
            .await
            .ok()
            .and_then(|r| r.ok())
            // En cas de doute (délai), on ne coupe pas.
            .unwrap_or(true);
        if !connected {
            log::warn!("Connexion perdue avec {device_id}");
            // `mark_disconnected` annule cette tâche : rien après.
            state.mark_disconnected(&app, &device_id).await;
            return;
        }
    }
}

#[tauri::command]
pub async fn ble_disconnect(app: AppHandle, state: State<'_, BleState>, device_id: String) -> AppResult<()> {
    let peripheral = match state.connected_peripheral(&device_id).await {
        Ok(p) => Some(p),
        Err(_) => state.0.peripherals.read().await.get(&device_id).cloned(),
    };
    if let Some(peripheral) = peripheral {
        if let Ok(Err(e)) = tokio::time::timeout(OPERATION_TIMEOUT, peripheral.disconnect()).await {
            log::warn!("Déconnexion de {device_id} : {e}");
        }
    }
    state.mark_disconnected(&app, &device_id).await;
    Ok(())
}

#[tauri::command]
pub async fn ble_read(
    app: AppHandle,
    state: State<'_, BleState>,
    device_id: String,
    service: String,
    characteristic: String,
) -> AppResult<Vec<u8>> {
    let peripheral = state.connected_peripheral(&device_id).await?;
    let c = find_characteristic(&peripheral, &service, &characteristic)?;
    match tokio::time::timeout(OPERATION_TIMEOUT, peripheral.read(&c)).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(e)) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(ble_error("Lecture Bluetooth", e))
        }
        Err(_) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(AppError::new("Lecture Bluetooth : délai dépassé"))
        }
    }
}

#[tauri::command]
pub async fn ble_write(
    app: AppHandle,
    state: State<'_, BleState>,
    device_id: String,
    service: String,
    characteristic: String,
    data: Vec<u8>,
    with_response: Option<bool>,
) -> AppResult<()> {
    let peripheral = state.connected_peripheral(&device_id).await?;
    let c = find_characteristic(&peripheral, &service, &characteristic)?;
    let write_type = match with_response {
        Some(true) => WriteType::WithResponse,
        Some(false) => WriteType::WithoutResponse,
        // Non précisé : selon ce que la caractéristique autorise.
        None if c.properties.contains(CharPropFlags::WRITE) => WriteType::WithResponse,
        None => WriteType::WithoutResponse,
    };
    match tokio::time::timeout(OPERATION_TIMEOUT, peripheral.write(&c, &data, write_type)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(ble_error("Écriture Bluetooth", e))
        }
        Err(_) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(AppError::new("Écriture Bluetooth : délai dépassé"))
        }
    }
}

#[tauri::command]
pub async fn ble_subscribe(
    app: AppHandle,
    state: State<'_, BleState>,
    device_id: String,
    service: String,
    characteristic: String,
) -> AppResult<()> {
    let peripheral = state.connected_peripheral(&device_id).await?;
    let c = find_characteristic(&peripheral, &service, &characteristic)?;
    if !c
        .properties
        .intersects(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
    {
        return Err(AppError(format!(
            "La caractéristique {} ne permet pas les notifications",
            uuid_string(&c.uuid)
        )));
    }
    match tokio::time::timeout(OPERATION_TIMEOUT, peripheral.subscribe(&c)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(ble_error("Abonnement Bluetooth", e))
        }
        Err(_) => {
            state.check_still_connected(&app, &device_id, &peripheral).await;
            Err(AppError::new("Abonnement Bluetooth : délai dépassé"))
        }
    }
}

#[tauri::command]
pub async fn ble_unsubscribe(
    state: State<'_, BleState>,
    device_id: String,
    service: String,
    characteristic: String,
) -> AppResult<()> {
    // Se désabonner d'un appareil déjà parti n'est pas une erreur.
    let Ok(peripheral) = state.connected_peripheral(&device_id).await else {
        return Ok(());
    };
    let c = find_characteristic(&peripheral, &service, &characteristic)?;
    match tokio::time::timeout(OPERATION_TIMEOUT, peripheral.unsubscribe(&c)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(ble_error("Désabonnement Bluetooth", e)),
        Err(_) => Err(AppError::new("Désabonnement Bluetooth : délai dépassé")),
    }
}

/// Déconnecte tout à la fermeture de l'application.
pub async fn shutdown(state: &BleState) {
    state.0.scanning.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Some(selected) = state.0.selected.lock().await.as_ref() {
        let _ = selected.adapter.stop_scan().await;
    }
    let devices: Vec<_> = state.0.connected.write().await.drain().collect();
    for (_, device) in devices {
        device.abort_tasks();
        let _ = tokio::time::timeout(Duration::from_secs(2), device.peripheral.disconnect()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_normalisation() {
        let hr = "0000180d-0000-1000-8000-00805f9b34fb";
        assert_eq!(uuid_string(&parse_uuid("180d").unwrap()), hr);
        assert_eq!(uuid_string(&parse_uuid("0x180D").unwrap()), hr);
        assert_eq!(uuid_string(&parse_uuid("0000180D").unwrap()), hr);
        assert_eq!(uuid_string(&parse_uuid("0000180D-0000-1000-8000-00805F9B34FB").unwrap()), hr);
        assert!(parse_uuid("pas-un-uuid").is_err());
    }

    #[test]
    fn noms_de_proprietes() {
        let names = property_names(CharPropFlags::READ | CharPropFlags::NOTIFY | CharPropFlags::WRITE);
        assert_eq!(names, vec!["read", "write", "notify"]);
    }
}
