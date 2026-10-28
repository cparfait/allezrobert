//! Intégration à Windows : écran gardé allumé pendant une sortie, plein écran natif, mises à jour de
//! l'application (tauri-plugin-updater, installateur signé publié par deploy/publish-desktop.sh).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{io_error, AppResult};

/// Garde l'écran et le PC éveillés (sortie en cours) ou rend la main à Windows. Commande synchrone :
/// elle s'exécute sur le fil principal, qui porte l'état (`SetThreadExecutionState` est propre au fil).
#[tauri::command]
pub fn keep_awake(on: bool) {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};
        let flags = if on { ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
        unsafe { SetThreadExecutionState(flags) };
    }
    #[cfg(not(windows))]
    let _ = on;
}

/// Plein écran de la fenêtre (F11) ; renvoie l'état obtenu.
#[tauri::command]
pub fn set_fullscreen(window: WebviewWindow, on: bool) -> AppResult<bool> {
    window.set_fullscreen(on).map_err(|e| io_error("Plein écran", e))?;
    window.is_fullscreen().map_err(|e| io_error("Plein écran", e))
}

/// Mise à jour trouvée par `update_check`, installée par `update_install`.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Cherche une nouvelle version publiée (`latest.json` sur le serveur) ; rien si à jour.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> AppResult<Option<UpdateInfo>> {
    let update = app
        .updater()
        .map_err(|e| io_error("Mises à jour", e))?
        .check()
        .await
        .map_err(|e| io_error("Recherche de mise à jour", e))?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone() });
    *pending.0.lock().map_err(|_| io_error("Mises à jour", "verrou"))? = update;
    Ok(info)
}

#[derive(Clone, Serialize)]
struct UpdateProgress {
    done: u64,
    total: Option<u64>,
}

/// Télécharge la mise à jour (progression sur `update://progress`), vérifie sa signature, lance
/// l'installateur et redémarre l'application.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, PendingUpdate>) -> AppResult<()> {
    let update = pending.0.lock().map_err(|_| io_error("Mises à jour", "verrou"))?.take().ok_or_else(|| io_error("Mises à jour", "aucune mise à jour en attente"))?;
    let mut done = 0u64;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit("update://progress", UpdateProgress { done, total });
            },
            || {},
        )
        .await
        .map_err(|e| io_error("Installation de la mise à jour", e))?;
    app.restart();
}
