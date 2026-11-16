use std::{borrow::Cow, sync::Mutex, time::Duration};

use reqwest::{Client, Url};
use tauri::http::{header, Request, Response, StatusCode};

pub struct V3Session {
    client: Client,
    origin: Url,
    cookie: Mutex<Option<String>>,
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
    let request = if let Some(code) = code {
        state.client.post(url).header("X-AR-V3-Code", code)
    } else {
        let cookie = state.cookie.lock().map_err(|e| e.to_string())?.clone();
        let Some(cookie) = cookie else { return Ok(403) };
        state.client.get(url).header(header::COOKIE, cookie)
    };
    let response = request.send().await.map_err(|e| e.to_string())?;
    if let Some(cookie) = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("ar_v3_access="))
    {
        *state.cookie.lock().map_err(|e| e.to_string())? = Some(cookie.to_owned());
    }
    Ok(response.status().as_u16())
}
