//! Dossier de données de l'application : zones téléchargées (`worlds/`), ressources du jeu (`media/`),
//! sauvegarde du profil (`profil/`). Par défaut `%LOCALAPPDATA%\fr.cparfait.allezrobert\donnees`,
//! déplaçable par le joueur (autre disque) : l'emplacement choisi est noté dans `stockage.json`, à côté
//! du dossier WebView2. `AR_WORLDS_DIR` (développement hors ligne) remplace la racine des zones.
//!
//! Aussi : enregistrement des fichiers exportés (sorties FIT/GPX dans Documents, captures dans Images)
//! et ouverture de l'explorateur.

use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{io_error, AppError, AppResult};

const IDENTIFIER: &str = "fr.cparfait.allezrobert";

static DATA_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

/// `%LOCALAPPDATA%\fr.cparfait.allezrobert` (même dossier que WebView2 et les journaux).
pub fn app_local_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|l| PathBuf::from(l).join(IDENTIFIER))
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data_dir: Option<PathBuf>,
}

fn config_path() -> Option<PathBuf> {
    app_local_dir().map(|d| d.join("stockage.json"))
}

fn default_data_dir() -> PathBuf {
    app_local_dir().unwrap_or_else(|| std::env::temp_dir().join(IDENTIFIER)).join("donnees")
}

/// Lit l'emplacement choisi (ou celui par défaut) et nettoie les restes d'une mise à jour interrompue.
pub fn init() {
    let configured = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<StorageConfig>(&s).ok())
        .and_then(|c| c.data_dir);
    let dir = configured.unwrap_or_else(default_data_dir);
    let _ = std::fs::create_dir_all(&dir);
    crate::packs::cleanup_leftovers(&dir);
    *DATA_DIR.write().expect("verrou du dossier de données") = Some(dir);
}

/// Racine des données (zones, ressources, profil).
pub fn data_dir() -> PathBuf {
    DATA_DIR.read().ok().and_then(|d| d.clone()).unwrap_or_else(default_data_dir)
}

/// Dossier qui contient `worlds/` pour le protocole `worlds://` : `AR_WORLDS_DIR` si défini.
pub fn worlds_root() -> PathBuf {
    std::env::var_os("AR_WORLDS_DIR").map(PathBuf::from).unwrap_or_else(data_dir)
}

/// Chemin relatif sûr (venu du réseau ou de la page) : seulement des composants normaux.
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel.trim_start_matches('/'));
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root.join(rel))
}

/// Espace libre et taille du disque qui porte `path` (octets).
#[cfg(windows)]
pub fn disk_space(path: &Path) -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        probe = probe.parent()?.to_path_buf();
    }
    let wide: Vec<u16> = probe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let (mut free, mut total) = (0u64, 0u64);
    unsafe { GetDiskFreeSpaceExW(PCWSTR(wide.as_ptr()), Some(&mut free), Some(&mut total), None) }.ok()?;
    Some((free, total))
}

#[cfg(not(windows))]
pub fn disk_space(_path: &Path) -> Option<(u64, u64)> {
    None
}

/// Taille d'un dossier (octets), sans suivre les liens.
pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    data_dir: String,
    default_dir: bool,
    free_bytes: Option<u64>,
    total_bytes: Option<u64>,
    worlds_bytes: u64,
    media_bytes: u64,
}

#[tauri::command]
pub async fn storage_info() -> AppResult<StorageInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = data_dir();
        let space = disk_space(&dir);
        StorageInfo {
            data_dir: dir.to_string_lossy().into_owned(),
            default_dir: dir == default_data_dir(),
            free_bytes: space.map(|s| s.0),
            total_bytes: space.map(|s| s.1),
            worlds_bytes: dir_size(&dir.join("worlds")),
            media_bytes: dir_size(&dir.join("media")),
        }
    })
    .await
    .map_err(|e| io_error("Lecture du dossier de données", e))
}

/// Ouvre un dossier (données de l'application par défaut) dans l'explorateur.
#[tauri::command]
pub fn storage_open_dir() -> AppResult<()> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| io_error("Dossier de données", e))?;
    explorer(&[dir.as_os_str()])
}

/// Montre un fichier enregistré par l'application (sortie, capture) dans l'explorateur.
#[tauri::command]
pub fn reveal_path(path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() || !p.exists() {
        return Err("fichier introuvable".into());
    }
    let arg = format!("/select,{}", p.display());
    explorer(&[std::ffi::OsStr::new(&arg)])
}

fn explorer(args: &[&std::ffi::OsStr]) -> AppResult<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").args(args).spawn().map_err(|e| io_error("Explorateur", e))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = args;
        Err("non pris en charge".into())
    }
}

/// Fenêtre de choix d'un dossier ; renvoie le chemin choisi (sans rien déplacer).
#[tauri::command]
pub async fn storage_pick_dir(app: AppHandle) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Dossier des données d'Allez Robert !")
        .set_directory(data_dir())
        .pick_folder(move |p| {
            let _ = tx.send(p);
        });
    let picked = rx.await.ok().flatten();
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveProgress {
    done: u64,
    total: u64,
}

/// Déplace les données (zones, ressources, profil) dans `target`, puis l'adopte. Un sous-dossier
/// « Allez Robert » est créé si le dossier choisi n'est pas vide. Progression sur `storage://progress`.
#[tauri::command]
pub async fn storage_move(app: AppHandle, target: String) -> AppResult<String> {
    if crate::packs::busy() {
        return Err("un téléchargement est en cours : attendez qu'il se termine".into());
    }
    let mut target = PathBuf::from(target);
    if !target.is_absolute() {
        return Err("dossier invalide".into());
    }
    let from = data_dir();
    let non_empty = std::fs::read_dir(&target).map(|mut d| d.next().is_some()).unwrap_or(false);
    if non_empty && target != from && !target.join("worlds").exists() && !target.join("media").exists() {
        target = target.join("Allez Robert");
    }
    if target == from {
        return Ok(target.to_string_lossy().into_owned());
    }
    if target.starts_with(&from) || from.starts_with(&target) {
        return Err("le nouveau dossier ne peut pas être dans l'ancien (ni l'inverse)".into());
    }
    let progress_app = app.clone();
    let dest = target.clone();
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        std::fs::create_dir_all(&dest).map_err(|e| io_error("Création du dossier", e))?;
        let parts = ["worlds", "media", "profil"];
        let total: u64 = parts.iter().map(|p| dir_size(&from.join(p))).sum();
        if let Some((free, _)) = disk_space(&dest) {
            if free < total {
                return Err(format!("espace insuffisant sur le disque choisi ({} Go nécessaires)", total.div_ceil(1_000_000_000)).into());
            }
        }
        let mut done = 0u64;
        let emit = |done: u64| {
            let _ = progress_app.emit("storage://progress", MoveProgress { done, total });
        };
        for part in parts {
            let src = from.join(part);
            if !src.exists() {
                continue;
            }
            let dst = dest.join(part);
            if dst.exists() {
                std::fs::remove_dir_all(&dst).map_err(|e| io_error("Nettoyage du dossier choisi", e))?;
            }
            // Même disque : simple renommage ; sinon copie puis suppression.
            if std::fs::rename(&src, &dst).is_ok() {
                done += dir_size(&dst);
                emit(done);
                continue;
            }
            copy_tree(&src, &dst, &mut done, &emit).map_err(|e| io_error("Copie des données", e))?;
            let _ = std::fs::remove_dir_all(&src);
        }
        emit(total);
        Ok(())
    })
    .await
    .map_err(|e| io_error("Déplacement des données", e))??;
    set_data_dir(&target)?;
    Ok(target.to_string_lossy().into_owned())
}

fn copy_tree(src: &Path, dst: &Path, done: &mut u64, emit: &dyn Fn(u64)) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &to, done, emit)?;
        } else {
            *done += std::fs::copy(entry.path(), &to)?;
            emit(*done);
        }
    }
    Ok(())
}

fn set_data_dir(dir: &Path) -> AppResult<()> {
    let config = StorageConfig { data_dir: if dir == default_data_dir() { None } else { Some(dir.to_path_buf()) } };
    if let Some(path) = config_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(&config).map_err(|e| io_error("Configuration", e))?;
        write_atomic(&path, json.as_bytes()).map_err(|e| io_error("Configuration", e))?;
    }
    *DATA_DIR.write().map_err(|_| AppError::new("verrou du dossier de données"))? = Some(dir.to_path_buf());
    Ok(())
}

/// Écrit un fichier d'un coup (fichier temporaire puis renommage) : jamais à moitié écrit.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp-ecriture");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

// ——————————————————————————————————————————————— Profil (stockage local de la page)

fn profile_file() -> PathBuf {
    data_dir().join("profil").join("stockage-local.json")
}

/// Script exécuté avant la page : si le stockage local de WebView2 a perdu les données du jeu
/// (aucune clé `ar.`), il les restaure depuis la sauvegarde du dossier de données.
pub fn profile_restore_script() -> String {
    let saved = std::fs::read_to_string(profile_file())
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&s).ok())
        .filter(|m| !m.is_empty());
    let Some(saved) = saved else { return String::new() };
    let json = serde_json::Value::Object(saved).to_string();
    format!(
        "(function(){{try{{if(!/^(tauri\\.localhost|localhost|127\\.0\\.0\\.1)$/.test(location.hostname))return;\
for(var i=0;i<localStorage.length;i++){{var k=localStorage.key(i);if(k&&k.indexOf('ar.')===0)return;}}\
var d={json};for(var key in d){{if(typeof d[key]==='string')localStorage.setItem(key,d[key]);}}\
console.info('[allez-robert] profil restauré depuis le dossier de données');}}catch(e){{}}}})();"
    )
}

/// Sauvegarde du stockage local de la page (objet JSON clé → chaîne), appelée par le jeu après chaque changement.
#[tauri::command]
pub async fn profile_save(json: String) -> AppResult<()> {
    let parsed: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&json).map_err(|e| io_error("Profil", e))?;
    if parsed.values().any(|v| !v.is_string()) {
        return Err("profil invalide".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let path = profile_file();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomic(&path, json.as_bytes())
    })
    .await
    .map_err(|e| io_error("Profil", e))?
    .map_err(|e| io_error("Sauvegarde du profil", e))
}

// ——————————————————————————————————————————————— Fichiers exportés

/// Enregistre un fichier exporté par le jeu : `kind` = `ride` (Documents\Allez Robert\Sorties) ou
/// `screenshot` (Images\Allez Robert). `base64` : contenu. Renvoie le chemin complet.
#[tauri::command]
pub async fn save_export(app: AppHandle, kind: String, name: String, base64: String) -> AppResult<String> {
    use base64::Engine;
    let base = match kind.as_str() {
        "ride" => app.path().document_dir().map(|d| d.join("Allez Robert").join("Sorties")),
        "screenshot" => app.path().picture_dir().map(|d| d.join("Allez Robert")),
        _ => return Err("type de fichier inconnu".into()),
    }
    .map_err(|e| io_error("Dossier personnel", e))?;
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .collect();
    let clean = clean.trim_matches(['.', ' ']).to_owned();
    if clean.is_empty() || clean.len() > 180 {
        return Err("nom de fichier invalide".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.as_bytes()).map_err(|e| io_error("Fichier", e))?;
    tauri::async_runtime::spawn_blocking(move || -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(&base)?;
        let path = base.join(&clean);
        std::fs::write(&path, bytes)?;
        Ok(path)
    })
    .await
    .map_err(|e| io_error("Enregistrement", e))?
    .map(|p| p.to_string_lossy().into_owned())
    .map_err(|e| io_error("Enregistrement du fichier", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chemins_surs() {
        let r = Path::new("C:/jeu");
        assert!(safe_join(r, "/worlds/../secret.txt").is_none());
        assert!(safe_join(r, "worlds/a/../../b").is_none());
        assert!(safe_join(r, "C:/Windows/x").is_none());
        assert!(safe_join(r, "").is_none());
        assert_eq!(safe_join(r, "/worlds/sancy/tiles/0_0.json"), Some(r.join("worlds/sancy/tiles/0_0.json")));
    }

    #[test]
    fn script_vide_sans_sauvegarde() {
        *DATA_DIR.write().unwrap() = Some(std::env::temp_dir().join("ar-test-sans-profil"));
        assert_eq!(profile_restore_script(), "");
    }
}
