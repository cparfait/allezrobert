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

/// Vide le cache HTTP de WebView2 (pas le stockage des zones, qui est dans CacheStorage) à la
/// première ouverture après une nouvelle installation : une page mise en cache par une version
/// précédente ne doit jamais masquer le jeu embarqué.
fn purge_stale_http_cache() {
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) else { return };
    let Ok(exe) = std::env::current_exe() else { return };
    let Ok(modified) = std::fs::metadata(&exe).and_then(|m| m.modified()) else { return };
    let stamp = format!("{:?}", modified);
    let root = local.join("fr.cparfait.allezrobert");
    let marker = root.join("last-exe-stamp");
    if std::fs::read_to_string(&marker).map(|s| s == stamp).unwrap_or(false) {
        return;
    }
    for dir in ["Cache", "Code Cache"] {
        let _ = std::fs::remove_dir_all(root.join("EBWebView").join("Default").join(dir));
    }
    let _ = std::fs::create_dir_all(&root);
    let _ = std::fs::write(marker, stamp);
}

/// Ouvre une adresse https dans le navigateur du PC (connexion au compte). Seules les adresses
/// https sans espace ni guillemet sont acceptées.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>') {
        return Err("adresse refusée".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    Err("non pris en charge".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    purge_stale_http_cache();
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
            open_external,
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
