use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::Duration,
};

use futures::{stream, StreamExt, TryStreamExt};
use reqwest::{Client, Url};
use sha2::{Digest, Sha256};
use tauri::http::{header, Request, Response, StatusCode};

use crate::storage::{data_dir, write_atomic};

pub struct V3Session {
    client: Client,
    origin: Url,
    cookie: Mutex<Option<String>>,
    offline: AtomicBool,
    prepare: tokio::sync::Mutex<()>,
}

impl Default for V3Session {
    fn default() -> Self {
        let origin = option_env!("VITE_SERVER_URL")
            .and_then(|value| Url::parse(value).ok())
            .filter(|value| value.scheme() == "https");
        Self {
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(150))
                .build()
                .expect("client HTTP V3"),
            origin: origin.unwrap_or_else(|| {
                Url::parse("https://allezrobert.cparfait.ovh").expect("adresse du service V3")
            }),
            cookie: Mutex::default(),
            offline: AtomicBool::new(false),
            prepare: Default::default(),
        }
    }
}

impl V3Session {
    fn url(&self, path: &str, query: Option<&str>) -> Url {
        let mut url = self.origin.clone();
        url.set_path(path);
        url.set_query(query);
        url.set_fragment(None);
        url
    }

    pub async fn resource(&self, request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
        let method = request.method().clone();
        let path = request.uri().path();
        if !path.starts_with("/__v3/") || path == "/__v3/access" || path.contains("..") {
            return reply(StatusCode::NOT_FOUND);
        }
        if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
            return reply(StatusCode::METHOD_NOT_ALLOWED);
        }
        if self.offline.load(Ordering::Acquire) {
            let key = request.uri().path_and_query().map(|part| part.as_str()).unwrap_or(path);
            return disk_resource(&request, key).await;
        }
        let cookie = self.cookie.lock().ok().and_then(|state| state.clone());
        let Some(cookie) = cookie else {
            return reply(StatusCode::FORBIDDEN);
        };
        let mut query = self
            .client
            .request(method, self.url(path, request.uri().query()))
            .header(header::COOKIE, cookie);
        if let Some(range) = request.headers().get(header::RANGE) {
            query = query.header(header::RANGE, range);
        }
        let Ok(response) = query.send().await else {
            return reply(StatusCode::BAD_GATEWAY);
        };
        let mut response_out = response_builder(response.status());
        for header in [
            header::CONTENT_TYPE,
            header::CONTENT_LENGTH,
            header::CONTENT_RANGE,
            header::ACCEPT_RANGES,
        ] {
            if let Some(value) = response.headers().get(&header) {
                response_out = response_out.header(header, value.clone());
            }
        }
        match response.bytes().await {
            Ok(bytes) => response_out
                .body(Cow::Owned(bytes.to_vec()))
                .expect("réponse V3"),
            Err(_) => reply(StatusCode::BAD_GATEWAY),
        }
    }
}

fn offline_dir() -> PathBuf {
    data_dir().join("v3-offline")
}

fn valid_path(path: &str) -> bool {
    path.starts_with("/__v3/") && path.len() <= 240 && !path.contains("..") && !path.contains('\\')
        && path.split(['?', '#']).next() != Some("/__v3/access")
}

fn cache_file(path: &str) -> PathBuf {
    let name = if path.starts_with("/__v3/menu/") {
        path.split('?').next().unwrap_or(path)
    } else {
        path
    };
    offline_dir().join(format!("{:x}", Sha256::digest(name.as_bytes())))
}

async fn offline_ready() -> bool {
    let Ok(bytes) = tokio::fs::read(offline_dir().join("ready.json")).await else { return false };
    let Ok(paths) = serde_json::from_slice::<Vec<String>>(&bytes) else { return false };
    !paths.is_empty() && paths.iter().all(|path| valid_path(path) && cache_file(path).is_file())
}

async fn disk_resource(request: &Request<Vec<u8>>, key: &str) -> Response<Cow<'static, [u8]>> {
    let Ok(bytes) = tokio::fs::read(cache_file(key)).await else { return reply(StatusCode::NOT_FOUND) };
    let mime = match request.uri().path().rsplit('.').next() {
        Some("glb") => "model/gltf-binary",
        Some("png") => "image/png",
        Some("jpg") => "image/jpeg",
        _ => "application/json",
    };
    let response = response_builder(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, bytes.len());
    let body = if request.method() == reqwest::Method::HEAD { Cow::Borrowed(&[] as &[u8]) } else { Cow::Owned(bytes) };
    response.body(body).expect("réponse V3 hors ligne")
}

#[tauri::command]
pub fn v3_offline(state: tauri::State<'_, V3Session>) -> bool {
    state.offline.load(Ordering::Acquire)
}

#[tauri::command]
pub async fn v3_prepare_offline(
    state: tauri::State<'_, V3Session>,
    mut paths: Vec<String>,
) -> Result<(), String> {
    if paths.is_empty() || paths.len() > 1000 || paths.iter().any(|path| !valid_path(path)) {
        return Err("Liste de ressources V3 invalide".into());
    }
    paths.sort_unstable();
    paths.dedup();
    let _guard = state.prepare.lock().await;
    let cookie = state.cookie.lock().map_err(|e| e.to_string())?.clone().ok_or("Saisis le code V3 avant le téléchargement.")?;
    let root = offline_dir();
    tokio::fs::create_dir_all(&root).await.map_err(|error| error.to_string())?;
    let state = state.inner();
    // Chaque chemin gardé ou absent du service : les fichiers facultatifs (relief, casque, image fixe) peuvent manquer.
    let client = state.client.clone();
    let urls: Vec<(String, Url)> = paths.into_iter().map(|key| {
        let url = {
            let (path, query) = key.split_once('?').map_or((key.as_str(), None), |(path, query)| (path, Some(query)));
            state.url(path, query)
        };
        (key, url)
    }).collect();
    let kept = stream::iter(urls.into_iter().map(|(key, url)| {
        let cookie = cookie.clone();
        let client = client.clone();
        async move {
            let file = cache_file(&key);
            let path = url.path().to_owned();
            // Les catalogues suivent la disponibilité publique quand le joueur est connecté.
            if file.is_file() && !matches!(path.as_str(), "/__v3/catalogue" | "/__v3/gear" | "/__v3/clips") {
                return Ok::<Option<String>, String>(Some(key));
            }
            let response = client.get(url)
                .header(header::COOKIE, cookie)
                .send().await.map_err(|error| error.to_string())?;
            if response.status() == StatusCode::NOT_FOUND {
                return Ok(None);
            }
            if !response.status().is_success() {
                return Err(format!("Ressource V3 indisponible : {path} (HTTP {})", response.status()));
            }
            let bytes = response.bytes().await.map_err(|error| error.to_string())?;
            if bytes.is_empty() { return Err(format!("Ressource V3 vide : {path}")); }
            tauri::async_runtime::spawn_blocking(move || write_atomic(&file, &bytes))
                .await.map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())?;
            Ok(Some(key))
        }
    })).buffer_unordered(4).try_collect::<Vec<_>>().await?;
    let mut kept: Vec<String> = kept.into_iter().flatten().collect();
    kept.sort_unstable();
    if kept.is_empty() {
        return Err("Aucune ressource V3 disponible".into());
    }
    let manifest = serde_json::to_vec(&kept).map_err(|error| error.to_string())?;
    let files: std::collections::HashSet<PathBuf> = kept.iter().map(|key| cache_file(key)).collect();
    tauri::async_runtime::spawn_blocking(move || {
        write_atomic(&root.join("ready.json"), &manifest)?;
        // Ressources d'un ancien équipement : retirées, la copie ne garde que la sortie en cours.
        for entry in std::fs::read_dir(&root)?.flatten() {
            let path = entry.path();
            if path.file_name().is_some_and(|name| name != "ready.json") && !files.contains(&path) {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok::<(), std::io::Error>(())
    })
    .await.map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

fn response_builder(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
}

fn reply(status: StatusCode) -> Response<Cow<'static, [u8]>> {
    response_builder(status)
        .body(Cow::Borrowed(&[] as &[u8]))
        .expect("réponse V3")
}

#[tauri::command]
pub async fn v3_access(
    state: tauri::State<'_, V3Session>,
    code: Option<String>,
) -> Result<u16, String> {
    let url = state.url("/__v3/access", None);
    let checking = code.is_none();
    let request = if let Some(code) = code {
        state.client.post(url).header("X-AR-V3-Code", code)
    } else {
        // Premier contrôle depuis le lancement : session enregistrée sur le disque (code saisi une seule fois).
        let saved = tokio::fs::read_to_string(session_file()).await.ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| value.starts_with("ar_v3_access=") && value.len() < 512);
        let cookie = {
            let mut cookie = state.cookie.lock().map_err(|e| e.to_string())?;
            if cookie.is_none() { *cookie = saved; }
            cookie.clone()
        };
        let request = state.client.get(url);
        if let Some(cookie) = cookie { request.header(header::COOKIE, cookie) } else { request }
    };
    let response = match request.timeout(Duration::from_secs(5)).send().await {
        Ok(response) if !response.status().is_server_error() => response,
        _ => {
            let available = checking && offline_ready().await;
            state.offline.store(available, Ordering::Release);
            return Ok(if available { 204 } else { 503 });
        }
    };
    state.offline.store(false, Ordering::Release);
    if let Some(cookie) = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("ar_v3_access="))
    {
        *state.cookie.lock().map_err(|e| e.to_string())? = Some(cookie.to_owned());
        // Session gardée pour les prochains lancements (le service la prolonge à chaque contrôle).
        let value = cookie.to_owned();
        let _ = tauri::async_runtime::spawn_blocking(move || write_atomic(&session_file(), value.as_bytes())).await;
    }
    Ok(response.status().as_u16())
}

/// Session V3 enregistrée (cookie signé par le service, valable un an et prolongé à chaque lancement).
fn session_file() -> PathBuf {
    data_dir().join("v3-session")
}
