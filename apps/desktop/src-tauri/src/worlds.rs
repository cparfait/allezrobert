//! Protocole `worlds://` : sert au jeu les zones téléchargées dans le dossier de données
//! (`<données>/worlds/<id>/…`, voir packs.rs), lues sur le disque hors du fil de l'interface.
//!
//! Sous Windows, la page y accède par `http://worlds.localhost/worlds/<id>/tiles/…`. `AR_WORLDS_DIR`
//! (dossier qui contient `worlds/`) remplace la racine, pour jouer hors ligne sur des tuiles construites.

use std::borrow::Cow;
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};

use crate::storage::{safe_join, worlds_root};

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("json") => "application/json",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("ktx2") => "image/ktx2",
        _ => "application/octet-stream",
    }
}

pub fn handle(request: Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let reply = |status: StatusCode, mime: &str, body: Vec<u8>| {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            // Fichiers locaux : rien à garder dans le cache HTTP de WebView2 (ce serait une seconde copie).
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(body))
            .expect("réponse worlds:// invalide")
    };
    let decoded = percent_decode(request.uri().path());
    if !decoded.starts_with("/worlds/") {
        return reply(StatusCode::BAD_REQUEST, "text/plain", b"chemin refuse".to_vec());
    }
    let Some(file) = safe_join(&worlds_root(), &decoded) else {
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
    fn decode_les_pourcents() {
        assert_eq!(percent_decode("/a%20b/c"), "/a b/c");
        assert_eq!(percent_decode("/fin%2"), "/fin%2");
    }

    #[test]
    fn refuse_hors_des_mondes() {
        let req = Request::builder().uri("http://worlds.localhost/stockage.json").body(Vec::new()).unwrap();
        assert_eq!(handle(req).status(), StatusCode::BAD_REQUEST);
        let req = Request::builder().uri("http://worlds.localhost/worlds/%2E%2E/x").body(Vec::new()).unwrap();
        assert_eq!(handle(req).status(), StatusCode::BAD_REQUEST);
    }
}
