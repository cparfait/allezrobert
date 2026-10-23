//! Allez Robert ! — application desktop Tauri 2.
//!
//! Enveloppe le client web (`apps/client`) et expose au TypeScript les capteurs natifs :
//! Bluetooth LE (btleplug), Wahoo Direct Connect (mDNS + TCP) et ANT+ USB (nusb).
//! Contrat : `packages/shared/src/native-bridge.ts`.

pub mod ant;
pub mod ant_protocol;
pub mod ble;
#[cfg(windows)]
mod ble_windows;
pub mod dircon;
pub mod error;
pub mod worlds;

use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("allezrobert_desktop_lib", log_level)
                .level_for("mdns_sd", log::LevelFilter::Warn)
                .level_for("btleplug", log::LevelFilter::Warn)
                .build(),
        )
        .register_uri_scheme_protocol("worlds", |_ctx, request| worlds::handle(request))
        .manage(ble::BleState::default())
        .manage(dircon::DirconState::default())
        .manage(ant::AntState::default())
        .invoke_handler(tauri::generate_handler![
            ble::ble_list_adapters,
            ble::ble_select_adapter,
            ble::ble_start_scan,
            ble::ble_stop_scan,
            ble::ble_connect,
            ble::ble_disconnect,
            ble::ble_read,
            ble::ble_write,
            ble::ble_subscribe,
            ble::ble_unsubscribe,
            dircon::dircon_discover,
            dircon::dircon_connect,
            dircon::dircon_send,
            dircon::dircon_close,
            ant::ant_list_sticks,
            ant::ant_open,
            ant::ant_open_channel,
            ant::ant_send,
            ant::ant_close_channel,
            ant::ant_close,
        ])
        .build(tauri::generate_context!())
        .expect("échec du démarrage de l'application Tauri");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Libère proprement capteurs, sockets et clé USB avant de quitter.
            let ble = handle.state::<ble::BleState>().inner().clone();
            let dircon = handle.state::<dircon::DirconState>().inner().clone();
            let ant = handle.state::<ant::AntState>().inner().clone();
            tauri::async_runtime::block_on(async move {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                    ble::shutdown(&ble).await;
                    dircon::shutdown(&dircon).await;
                    ant::shutdown(&ant).await;
                })
                .await;
            });
        }
    });
}
