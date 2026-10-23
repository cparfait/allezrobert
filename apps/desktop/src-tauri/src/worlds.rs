//! Protocole `worlds://` : sert les tuiles des mondes depuis le disque, pour une application
//! hors ligne (les tuiles, ≈ 2 Go, ne sont pas embarquées dans l'exécutable).
//!
//! Sous Windows, la page y accède par `http://worlds.localhost/worlds/<id>/tiles/…` : il suffit de
//! construire le client avec `VITE_WORLDS_URL=http://worlds.localhost`. Les fichiers sont lus dans
//! `AR_WORLDS_DIR` (dossier qui contient `worlds/`) si défini, sinon à côté de l'exécutable.

use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};

use tauri::http::{header, Request, Response, StatusCode};

fn root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AR_WORLDS_DIR") {
        return Some(PathBuf::from(dir));
    }
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("json") => "application/json",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Résout le chemin de la requête sous la racine, en refusant toute sortie (`..`, chemin absolu).
fn resolve(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let rel = Path::new(uri_path.trim_start_matches('/'));
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(root.join(rel))
}

pub fn handle(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let reply = |status: StatusCode, mime: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(body))
            .expect("réponse worlds:// invalide")
    };
    let path = request.uri().path();
    let decoded = percent_decode(path);
    let Some(file) = root().and_then(|r| resolve(&r, &decoded)) else {
        return reply(StatusCode::BAD_REQUEST, "text/plain", b"chemin refuse".to_vec());
    };
    match std::fs::read(&file) {
        Ok(bytes) => reply(StatusCode::OK, content_type(&file), bytes),
        Err(_) => reply(StatusCode::NOT_FOUND, "text/plain", Vec::new()),
    }
}

/// Décodage `%XX` minimal (noms de mondes et de tuiles : ASCII, mais on reste prudent).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuse_les_sorties_de_racine() {
        let r = Path::new("C:/jeu");
        assert!(resolve(r, "/worlds/../secret.txt").is_none());
        assert!(resolve(r, "/worlds/vincennes/tiles/0_0.json").is_some());
    }

    #[test]
    fn decode_les_pourcents() {
        assert_eq!(percent_decode("/a%20b/c"), "/a b/c");
        assert_eq!(percent_decode("/fin%2"), "/fin%2");
    }
}
