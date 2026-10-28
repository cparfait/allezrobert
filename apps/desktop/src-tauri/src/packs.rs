//! Packs téléchargés dans le dossier de données, par Rust plutôt que par la page :
//!
//! - **zones** : `worlds/<id>/` (tuiles, graphe routier), d'après `worlds/<id>/tiles/pack.json` du serveur ;
//! - **ressources du jeu** : `media/` (vidéos du menu, modèles, musique, voix, mondes), d'après le manifeste
//!   embarqué dans l'exe (`media-manifest.json`), fichiers servis par empreinte sur `/telechargement/media/<h>`.
//!
//! 16 fichiers à la fois (HTTP/2 : une seule connexion), taille et empreinte SHA-256 vérifiées, reprise
//! après coupure (fichiers déjà complets gardés), mise à jour par différence (fichiers inchangés repris de
//! la version installée par lien physique, sans copie). La nouvelle version est montée dans `.<id>.part/`
//! puis échangée d'un coup avec l'ancienne : une zone n'est jamais à moitié installée.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::error::{io_error, AppError, AppResult};
use crate::storage::{self, safe_join};

/// Téléchargements simultanés (fichiers).
const PARALLEL: usize = 16;
const ATTEMPTS: usize = 3;
const MEDIA_ID: &str = "media";

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct PackFile {
    pub p: String,
    /// Taille (octets, non compressée) ; 0 = inconnue.
    pub b: u64,
    /// Début de l'empreinte SHA-256 en hexadécimal (au moins 16 caractères), si le serveur la donne.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub h: Option<String>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gz_bytes: Option<u64>,
    pub files: Vec<PackFile>,
    /// Version annoncée par le catalogue à l'installation (le jeu ne redemande pas une mise à jour que le serveur n'a pas encore).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalogue: Option<String>,
    /// Graphe routier (`graph.json`) présent dans le pack.
    #[serde(default)]
    pub graph: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPack {
    id: String,
    version: String,
    bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalogue: Option<String>,
}

impl From<&Manifest> for InstalledPack {
    fn from(m: &Manifest) -> Self {
        Self { id: m.id.clone(), version: m.version.clone(), bytes: m.bytes, catalogue: m.catalogue.clone() }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    id: &'a str,
    done: u64,
    total: u64,
}

// ——————————————————————————————————————————————— Téléchargements en cours

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Un téléchargement est en cours (déplacement du dossier interdit).
pub fn busy() -> bool {
    running().lock().map(|r| !r.is_empty()).unwrap_or(false)
}

/// Inscription d'un téléchargement (un seul à la fois par pack), retirée à la fin.
struct Running {
    id: String,
    cancel: Arc<AtomicBool>,
}

impl Running {
    fn start(id: &str) -> AppResult<Self> {
        let mut map = running().lock().map_err(|_| AppError::new("verrou des téléchargements"))?;
        if map.contains_key(id) {
            return Err("ce téléchargement est déjà en cours".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        map.insert(id.to_owned(), cancel.clone());
        Ok(Self { id: id.to_owned(), cancel })
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Ok(mut map) = running().lock() {
            map.remove(&self.id);
        }
    }
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("AllezRobert/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .http2_adaptive_window(true)
            .build()
            .expect("client HTTP")
    })
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') {
        return Err("identifiant de zone invalide".into());
    }
    Ok(())
}

/// Serveur des fichiers : https, ou http sur la machine elle-même (essais).
fn validate_base(url: &str) -> AppResult<String> {
    let url = url.trim_end_matches('/');
    let local = ["http://localhost", "http://127.0.0.1"].iter().any(|p| url.starts_with(p));
    if !(url.starts_with("https://") || local) || url.len() > 512 || url.chars().any(|c| c.is_whitespace() || c == '"') {
        return Err("adresse du serveur refusée".into());
    }
    Ok(url.to_owned())
}

fn read_manifest(path: &Path) -> Option<Manifest> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn same_hash(a: &str, b: &str) -> bool {
    let n = a.len().min(b.len());
    n >= 16 && a[..n].eq_ignore_ascii_case(&b[..n])
}

/// Fichier partiel d'un téléchargement (renommé une fois complet et vérifié).
fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".dl");
    PathBuf::from(s)
}

fn link_or_copy(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _ = std::fs::remove_file(to);
    std::fs::hard_link(from, to).or_else(|_| std::fs::copy(from, to).map(|_| ()))
}

/// Réessaie une opération de fichiers quelques fois (Windows : fichier encore ouvert un instant par la page).
fn retry(mut op: impl FnMut() -> std::io::Result<()>) -> std::io::Result<()> {
    let mut last = Ok(());
    for i in 0..10 {
        last = op();
        if last.is_ok() {
            return last;
        }
        std::thread::sleep(Duration::from_millis(100 * (i + 1)));
    }
    last
}

/// Échange `part` (nouvelle version complète) et `dir` (installée).
fn swap(dir: &Path, part: &Path) -> std::io::Result<()> {
    let mut old = dir.as_os_str().to_owned();
    old.push(".old");
    let old = PathBuf::from(old);
    if old.exists() {
        retry(|| std::fs::remove_dir_all(&old))?;
    }
    if dir.exists() {
        retry(|| std::fs::rename(dir, &old))?;
    }
    if let Err(e) = retry(|| std::fs::rename(part, dir)) {
        if old.exists() {
            let _ = std::fs::rename(&old, dir);
        }
        return Err(e);
    }
    if old.exists() {
        let _ = std::fs::remove_dir_all(&old);
    }
    Ok(())
}

/// Au démarrage : anciennes versions restées après un échange interrompu (fichiers verrouillés).
pub fn cleanup_leftovers(data: &Path) {
    for dir in [data.join("worlds"), data.to_path_buf()] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().ends_with(".old") && e.path().is_dir() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

// ——————————————————————————————————————————————— Moteur de synchronisation

enum Plan {
    /// Déjà complet dans le dossier de montage (reprise).
    Ready,
    /// Inchangé : repris de la version installée.
    Reuse(PathBuf),
    Download,
}

/// Monte `files` dans `part` : reprise, réemploi de la version installée (`installed`), téléchargement du reste.
async fn sync_files(
    app: &AppHandle,
    job: &Running,
    version: &str,
    files: &[PackFile],
    url_of: &(dyn Fn(&PackFile) -> String + Sync),
    part: &Path,
    installed: Option<(&Path, &Manifest)>,
) -> AppResult<()> {
    // Dossier de montage d'une autre version : on repart de zéro (des fichiers de même taille peuvent différer).
    let marker = part.join(".version");
    if part.exists() && std::fs::read_to_string(&marker).ok().as_deref() != Some(version) {
        std::fs::remove_dir_all(part).map_err(|e| io_error("Nettoyage du téléchargement précédent", e))?;
    }
    std::fs::create_dir_all(part).map_err(|e| io_error("Dossier de téléchargement", e))?;
    std::fs::write(&marker, version).map_err(|e| io_error("Dossier de téléchargement", e))?;

    let previous: HashMap<&str, &PackFile> = installed.map(|(_, m)| m.files.iter().map(|f| (f.p.as_str(), f)).collect()).unwrap_or_default();
    let mut plans = Vec::with_capacity(files.len());
    for f in files {
        let dest = safe_join(part, &f.p).ok_or_else(|| AppError::new(format!("chemin refusé dans le pack : {}", f.p)))?;
        let size_ok = |p: &Path| std::fs::metadata(p).map(|m| f.b == 0 || m.len() == f.b).unwrap_or(false);
        let plan = if size_ok(&dest) {
            Plan::Ready
        } else {
            let reuse = installed.and_then(|(dir, _)| {
                let old = previous.get(f.p.as_str())?;
                let (Some(a), Some(b)) = (&old.h, &f.h) else { return None };
                let src = safe_join(dir, &f.p)?;
                (same_hash(a, b) && old.b == f.b && size_ok(&src)).then_some(src)
            });
            reuse.map(Plan::Reuse).unwrap_or(Plan::Download)
        };
        plans.push((f, dest, plan));
    }

    let total: u64 = files.iter().map(|f| f.b).sum();
    let done = Arc::new(AtomicU64::new(0));
    let mut to_download = Vec::new();
    for (f, dest, plan) in plans {
        match plan {
            Plan::Ready => {
                done.fetch_add(f.b, Ordering::Relaxed);
            }
            Plan::Reuse(src) => {
                link_or_copy(&src, &dest).map_err(|e| io_error("Reprise d'un fichier de la version installée", e))?;
                done.fetch_add(f.b, Ordering::Relaxed);
            }
            Plan::Download => to_download.push((f.clone(), dest, url_of(f))),
        }
    }
    let needed: u64 = to_download.iter().map(|(f, _, _)| f.b).sum();
    if let Some((free, _)) = storage::disk_space(part) {
        if free < needed + 200_000_000 {
            return Err(format!(
                "espace disque insuffisant : {:.1} Go nécessaires, {:.1} Go libres (Réglages › Zones et cartes : changer de dossier)",
                needed as f64 / 1e9,
                free as f64 / 1e9
            )
            .into());
        }
    }

    // Progression : un événement tous les 200 ms au plus.
    let finished = Arc::new(AtomicBool::new(false));
    let ticker = {
        let (app, id, done, finished) = (app.clone(), job.id.clone(), done.clone(), finished.clone());
        tauri::async_runtime::spawn(async move {
            loop {
                let _ = app.emit("pack://progress", Progress { id: &id, done: done.load(Ordering::Relaxed), total });
                if finished.load(Ordering::Relaxed) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        })
    };

    let results: Vec<Result<(), String>> = futures::stream::iter(to_download)
        .map(|(f, dest, url)| {
            let (done, cancel) = (done.clone(), job.cancel.clone());
            async move {
                let mut last = String::new();
                for attempt in 0..ATTEMPTS {
                    if cancel.load(Ordering::Relaxed) {
                        return Err("annulé".to_owned());
                    }
                    match download(&url, &dest, &f, &done, &cancel).await {
                        Ok(()) => return Ok(()),
                        Err(e) if e == "annulé" => return Err(e),
                        Err(e) => last = e,
                    }
                    tokio::time::sleep(Duration::from_millis(500 * (attempt as u64 + 1))).await;
                }
                Err(last)
            }
        })
        .buffer_unordered(PARALLEL)
        .collect()
        .await;
    finished.store(true, Ordering::Relaxed);
    let _ = ticker.await;
    if job.cancel.load(Ordering::Relaxed) {
        return Err("annulé".into());
    }
    if let Some(Err(e)) = results.into_iter().find(|r| r.is_err()) {
        return Err(e.into());
    }
    Ok(())
}

/// Télécharge un fichier dans `dest` (via `<dest>.dl`), taille et empreinte vérifiées.
async fn download(url: &str, dest: &Path, f: &PackFile, done: &AtomicU64, cancel: &AtomicBool) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let tmp = part_path(dest);
    let mut written = 0u64;
    let result = fetch_into(url, &tmp, f, &mut written, done, cancel).await;
    match result {
        Ok(()) => tokio::fs::rename(&tmp, dest).await.map_err(|e| e.to_string()),
        Err(e) => {
            done.fetch_sub(written, Ordering::Relaxed);
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(e)
        }
    }
}

async fn fetch_into(url: &str, tmp: &Path, f: &PackFile, written: &mut u64, done: &AtomicU64, cancel: &AtomicBool) -> Result<(), String> {
    let resp = client().get(url).send().await.map_err(|e| format!("réseau : {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} pour {}", resp.status().as_u16(), f.p));
    }
    let html = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("text/html"));
    if html && !f.p.ends_with(".html") {
        return Err(format!("{} absent du serveur", f.p));
    }
    let mut file = tokio::fs::File::create(tmp).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            return Err("annulé".to_owned());
        }
        let chunk = chunk.map_err(|e| format!("réseau : {e}"))?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("écriture : {e}"))?;
        *written += chunk.len() as u64;
        done.fetch_add(chunk.len() as u64, Ordering::Relaxed);
    }
    file.flush().await.map_err(|e| format!("écriture : {e}"))?;
    drop(file);
    if f.b > 0 && *written != f.b {
        return Err(format!("{} incomplet ({} octets sur {})", f.p, written, f.b));
    }
    if let Some(h) = &f.h {
        let got = format!("{:x}", hasher.finalize());
        if !same_hash(&got, h) {
            return Err(format!("{} corrompu (empreinte)", f.p));
        }
    }
    Ok(())
}

/// Fichier facultatif (graphe routier) : vrai s'il est arrivé, faux s'il n'existe pas sur le serveur.
async fn fetch_optional(url: &str, dest: &Path, cancel: &AtomicBool) -> bool {
    let f = PackFile { p: dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), b: 0, h: None };
    let done = AtomicU64::new(0);
    for _ in 0..ATTEMPTS {
        if download(url, dest, &f, &done, cancel).await.is_ok() {
            return true;
        }
    }
    false
}

// ——————————————————————————————————————————————— Zones

fn worlds_dir() -> PathBuf {
    storage::data_dir().join("worlds")
}

/// Télécharge (ou met à jour) la zone `id` depuis `baseUrl` (`<base>/worlds/<id>/…`). Progression sur `pack://progress`.
#[tauri::command]
pub async fn pack_install(app: AppHandle, id: String, base_url: String, catalogue: Option<String>) -> AppResult<InstalledPack> {
    validate_id(&id)?;
    let base = validate_base(&base_url)?;
    let job = Running::start(&id)?;
    let resp = client()
        .get(format!("{base}/worlds/{id}/tiles/pack.json"))
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()
        .await
        .map_err(|e| io_error("Serveur des zones injoignable", e))?;
    if !resp.status().is_success() {
        return Err(format!("pack introuvable sur le serveur (HTTP {})", resp.status().as_u16()).into());
    }
    let mut manifest: Manifest = resp.json().await.map_err(|e| io_error("Description du pack illisible", e))?;
    manifest.id = id.clone();
    let root = worlds_dir();
    let dir = root.join(&id);
    let part = root.join(format!(".{id}.part"));
    let installed = read_manifest(&dir.join("pack.json"));
    let url_of = |f: &PackFile| format!("{base}/worlds/{id}/{}", f.p);
    sync_files(&app, &job, &manifest.version, &manifest.files, &url_of, &part, installed.as_ref().map(|m| (dir.as_path(), m))).await?;

    // Graphe routier : avec la zone ; absent du serveur, on garde celui de la version installée.
    let graph = part.join("graph.json");
    manifest.graph = fetch_optional(&format!("{base}/worlds/{id}/graph.json"), &graph, &job.cancel).await
        || (dir.join("graph.json").exists() && link_or_copy(&dir.join("graph.json"), &graph).is_ok());
    if job.cancel.load(Ordering::Relaxed) {
        return Err("annulé".into());
    }
    manifest.catalogue = catalogue;
    let _ = std::fs::remove_file(part.join(".version"));
    let json = serde_json::to_vec(&manifest).map_err(|e| io_error("Description du pack", e))?;
    std::fs::write(part.join("pack.json"), json).map_err(|e| io_error("Description du pack", e))?;
    let (d, p) = (dir.clone(), part.clone());
    tauri::async_runtime::spawn_blocking(move || swap(&d, &p))
        .await
        .map_err(|e| io_error("Installation de la zone", e))?
        .map_err(|e| io_error("Installation de la zone (fichiers verrouillés ?)", e))?;
    log::info!("zone {id} installée (version {}, {} fichiers)", manifest.version, manifest.files.len());
    Ok(InstalledPack::from(&manifest))
}

/// Arrête le téléchargement en cours de `id` (zone ou `media`).
#[tauri::command]
pub fn pack_cancel(id: String) {
    if let Ok(map) = running().lock() {
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

/// Supprime la zone `id` du disque (et un téléchargement inachevé).
#[tauri::command]
pub async fn pack_remove(id: String) -> AppResult<()> {
    validate_id(&id)?;
    if running().lock().map(|m| m.contains_key(&id)).unwrap_or(false) {
        return Err("téléchargement en cours".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = worlds_dir();
        for dir in [root.join(&id), root.join(format!(".{id}.part"))] {
            if dir.exists() {
                retry(|| std::fs::remove_dir_all(&dir))?;
            }
        }
        Ok::<_, std::io::Error>(())
    })
    .await
    .map_err(|e| io_error("Suppression de la zone", e))?
    .map_err(|e| io_error("Suppression de la zone", e))
}

/// Zones installées sur le disque.
#[tauri::command]
pub async fn packs_list() -> AppResult<Vec<InstalledPack>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(entries) = std::fs::read_dir(worlds_dir()) else { return Vec::new() };
        let mut list: Vec<InstalledPack> = entries
            .flatten()
            .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|e| {
                let mut m = read_manifest(&e.path().join("pack.json"))?;
                m.id = e.file_name().to_string_lossy().into_owned();
                Some(InstalledPack::from(&m))
            })
            .collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    })
    .await
    .map_err(|e| io_error("Liste des zones", e))
}

// ——————————————————————————————————————————————— Ressources du jeu

pub fn media_dir() -> PathBuf {
    storage::data_dir().join(MEDIA_ID)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaManifest {
    version: String,
    #[serde(default)]
    bytes: u64,
    files: Vec<PackFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStatus {
    /// Ressources présentes et de la version attendue.
    ready: bool,
    /// Des ressources (peut-être d'une autre version) sont présentes : le jeu peut démarrer hors ligne.
    present: bool,
    /// Octets à télécharger pour être à jour.
    missing_bytes: u64,
}

/// Nom publié d'une ressource (deploy/publish-desktop.sh) : empreinte + extension d'origine en minuscules.
fn media_object(f: &PackFile) -> String {
    let ext = Path::new(&f.p)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default();
    format!("{}{ext}", f.h.as_deref().unwrap_or_default().to_ascii_lowercase())
}

/// État des ressources par rapport au manifeste embarqué (sans rien télécharger).
#[tauri::command]
pub async fn media_status(manifest: MediaManifest) -> AppResult<MediaStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = media_dir();
        let installed = read_manifest(&dir.join(".manifest.json"));
        let present = installed.is_some();
        if installed.as_ref().is_some_and(|m| m.version == manifest.version) {
            return MediaStatus { ready: true, present, missing_bytes: 0 };
        }
        let have: HashMap<&str, &PackFile> = installed.as_ref().map(|m| m.files.iter().map(|f| (f.p.as_str(), f)).collect()).unwrap_or_default();
        let missing_bytes = manifest
            .files
            .iter()
            .filter(|f| !have.get(f.p.as_str()).is_some_and(|o| o.h.as_deref().zip(f.h.as_deref()).is_some_and(|(a, b)| same_hash(a, b))))
            .map(|f| f.b)
            .sum();
        MediaStatus { ready: false, present, missing_bytes }
    })
    .await
    .map_err(|e| io_error("Ressources du jeu", e))
}

/// Met les ressources du jeu à la version du manifeste embarqué : seuls les fichiers nouveaux ou changés
/// sont téléchargés (`<base>/telechargement/media/<h>`). Progression sur `pack://progress` (id `media`).
#[tauri::command]
pub async fn media_sync(app: AppHandle, manifest: MediaManifest, base_url: String) -> AppResult<()> {
    let base = validate_base(&base_url)?;
    if manifest.files.iter().any(|f| f.h.as_deref().is_none_or(|h| h.len() < 16 || !h.chars().all(|c| c.is_ascii_hexdigit()))) {
        return Err("manifeste des ressources invalide".into());
    }
    let job = Running::start(MEDIA_ID)?;
    let dir = media_dir();
    let installed = read_manifest(&dir.join(".manifest.json"));
    if installed.as_ref().is_some_and(|m| m.version == manifest.version) {
        return Ok(());
    }
    let part = storage::data_dir().join(".media.part");
    let url_of = |f: &PackFile| format!("{base}/telechargement/media/{}", media_object(f));
    sync_files(&app, &job, &manifest.version, &manifest.files, &url_of, &part, installed.as_ref().map(|m| (dir.as_path(), m))).await?;
    let stored = Manifest {
        id: MEDIA_ID.to_owned(),
        version: manifest.version.clone(),
        bytes: manifest.bytes,
        gz_bytes: None,
        files: manifest.files,
        catalogue: None,
        graph: false,
    };
    let _ = std::fs::remove_file(part.join(".version"));
    std::fs::write(part.join(".manifest.json"), serde_json::to_vec(&stored).map_err(|e| io_error("Ressources", e))?)
        .map_err(|e| io_error("Ressources", e))?;
    let (d, p) = (dir.clone(), part.clone());
    tauri::async_runtime::spawn_blocking(move || swap(&d, &p))
        .await
        .map_err(|e| io_error("Installation des ressources", e))?
        .map_err(|e| io_error("Installation des ressources", e))?;
    log::info!("ressources du jeu à jour (version {})", stored.version);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empreintes() {
        assert!(same_hash("0123456789abcdef0011", "0123456789ABCDEF"));
        assert!(!same_hash("0123456789abcdef", "0123456789abcdee"));
        assert!(!same_hash("0123", "0123"), "trop court pour conclure");
    }

    #[test]
    fn adresses_et_identifiants() {
        assert!(validate_base("https://allezrobert.cparfait.ovh/").is_ok());
        assert!(validate_base("http://localhost:8080").is_ok());
        assert!(validate_base("http://exemple.fr").is_err());
        assert!(validate_base("file:///C:/").is_err());
        assert!(validate_id("cote-de-nuits").is_ok());
        assert!(validate_id("../x").is_err());
        assert!(validate_id("").is_err());
    }

    #[test]
    fn manifeste_du_serveur() {
        let m: Manifest = serde_json::from_str(r#"{"formatVersion":1,"id":"sancy","version":"bbd779d5e187","bytes":12,"gzBytes":8,"files":[{"p":"tiles/0_0.json","b":12,"h":"0123456789abcdef"}]}"#).unwrap();
        assert_eq!(m.files[0].h.as_deref(), Some("0123456789abcdef"));
        assert_eq!(m.gz_bytes, Some(8));
        assert!(!m.graph);
    }

    #[test]
    fn noms_des_ressources() {
        let f = |p: &str| PackFile { p: p.into(), b: 1, h: Some("ABCDEF0123456789abcdef0123456789".into()) };
        assert_eq!(media_object(&f("menu/loop-winter.MP4")), "abcdef0123456789abcdef0123456789.mp4");
        assert_eq!(media_object(&f("worlds/sancy/world.json")), "abcdef0123456789abcdef0123456789.json");
        assert_eq!(media_object(&f("voice/sans-extension")), "abcdef0123456789abcdef0123456789");
    }

    #[test]
    fn echange_atomique() {
        let root = std::env::temp_dir().join(format!("ar-swap-{}", std::process::id()));
        let (dir, part) = (root.join("z"), root.join(".z.part"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&part).unwrap();
        std::fs::write(dir.join("a"), "ancien").unwrap();
        std::fs::write(part.join("a"), "nouveau").unwrap();
        swap(&dir, &part).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a")).unwrap(), "nouveau");
        assert!(!part.exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
