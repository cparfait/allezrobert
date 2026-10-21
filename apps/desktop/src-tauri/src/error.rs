//! Erreurs renvoyées au TypeScript : toujours des chaînes lisibles, en français.

use std::fmt;

/// Erreur applicative sérialisée en simple chaîne côté JavaScript (`invoke` rejette avec ce texte).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppError(pub String);

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for AppError {}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        Self(value.to_owned())
    }
}

/// Traduit une erreur btleplug en message français, avec un contexte (« Connexion », « Lecture »…).
pub fn ble_error(context: &str, error: btleplug::Error) -> AppError {
    use btleplug::Error as E;
    let detail = match &error {
        E::PermissionDenied => {
            "accès Bluetooth refusé par le système (vérifiez Paramètres > Confidentialité > Bluetooth)".to_owned()
        }
        E::DeviceNotFound => "appareil introuvable (hors de portée ou éteint ?)".to_owned(),
        E::NotConnected => "appareil non connecté".to_owned(),
        E::NoSuchCharacteristic => "caractéristique inexistante sur cet appareil".to_owned(),
        E::NoAdapterAvailable => "aucun adaptateur Bluetooth disponible".to_owned(),
        E::NotSupported(what) => format!("opération non prise en charge ({what})"),
        E::TimedOut(duration) => format!("délai dépassé ({} ms)", duration.as_millis()),
        E::Uuid(e) => format!("UUID invalide ({e})"),
        E::InvalidBDAddr(e) => format!("adresse Bluetooth invalide ({e})"),
        other => other.to_string(),
    };
    AppError(format!("{context} : {detail}"))
}

/// Erreur d'entrée/sortie générique (TCP, USB) avec contexte.
pub fn io_error(context: &str, error: impl fmt::Display) -> AppError {
    AppError(format!("{context} : {error}"))
}
