//! Allez Robert ! — application desktop Tauri 2.
//!
//! Enveloppe le client web (`apps/client`) et expose au TypeScript les capteurs natifs :
//! Bluetooth LE (btleplug), Wahoo Direct Connect (mDNS + TCP) et ANT+ USB (nusb), ainsi que ce qu'un
//! navigateur ne fait pas : zones et ressources du jeu dans un dossier de données (storage.rs, packs.rs,
//! worlds.rs, assets.rs), historique des sorties en SQLite (localdb.rs), mises à jour signées,
//! écran gardé allumé, plein écran (system.rs).
//! Contrat : `packages/shared/src/native-bridge.ts`.

pub mod ant;
pub mod ant_protocol;
mod assets;
pub mod ble;
#[cfg(windows)]
mod ble_windows;
pub mod dircon;
pub mod error;
pub mod localdb;
pub mod packs;
pub mod storage;
pub mod system;
pub mod worlds;

use tauri::{Manager, RunEvent};

/// Vide le cache HTTP de WebView2 (ni les zones ni les shaders compilés, ailleurs) à la
/// première ouverture après une nouvelle installation : une page mise en cache par une version
/// précédente ne doit jamais masquer le jeu embarqué.
fn purge_stale_http_cache() {
    let Some(root) = storage::app_local_dir() else { return };
    let Ok(exe) = std::env::current_exe() else { return };
    let Ok(modified) = std::fs::metadata(&exe).and_then(|m| m.modified()) else { return };
    let stamp = format!("{:?}", modified);
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
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    Err("non pris en charge".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    purge_stale_http_cache();
    storage::init();
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    // Ressources lourdes hors de l'exe : lues dans le dossier de données quand l'exe ne les a pas (assets.rs).
    let mut context = tauri::generate_context!();
    let embedded = context.set_assets(Box::new(assets::NoAssets));
    context.set_assets(Box::new(assets::DiskBackedAssets { embedded }));
    // Profil du joueur restauré depuis le dossier de données si WebView2 l'a perdu (storage.rs).
    let profile = tauri::plugin::Builder::<tauri::Wry, ()>::new("ar-profile").js_init_script(storage::profile_restore_script()).build();

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("allezrobert_desktop_lib", log_level)
                .level_for("mdns_sd", log::LevelFilter::Warn)
                .level_for("btleplug", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(profile)
        .register_asynchronous_uri_scheme_protocol("worlds", |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || responder.respond(worlds::handle(request)));
        })
        .manage(system::PendingUpdate::default())
        .manage(ble::BleState::default())
        .manage(dircon::DirconState::default())
        .manage(ant::AntState::default())
        .invoke_handler(tauri::generate_handler![
            open_external,
            storage::storage_info,
            storage::storage_open_dir,
            storage::storage_pick_dir,
            storage::storage_move,
            storage::reveal_path,
            storage::profile_save,
            storage::save_export,
            localdb::localdb_execute,
            localdb::localdb_query,
            localdb::localdb_batch,
            localdb::localdb_path,
            packs::pack_install,
            packs::pack_cancel,
            packs::pack_remove,
            packs::packs_list,
            packs::media_status,
            packs::media_sync,
            system::keep_awake,
            system::set_fullscreen,
            system::update_check,
            system::update_install,
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
        .build(context)
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
