//! Informations Windows sur les adaptateurs Bluetooth (nom convivial, adaptateur par défaut).
//!
//! btleplug ne fournit ni le nom de l'adaptateur ni l'adaptateur par défaut ; on les lit via
//! WinRT (`Windows.Devices.Bluetooth`). Toute erreur est silencieuse : on retombe sur des noms
//! génériques.

use windows::Devices::Bluetooth::BluetoothAdapter;
use windows::Devices::Enumeration::DeviceInformation;

pub struct SystemAdapter {
    /// Adresse au format btleplug (`AA:BB:CC:DD:EE:FF`).
    pub address: String,
    pub name: String,
}

#[derive(Default)]
pub struct SystemAdapters {
    pub adapters: Vec<SystemAdapter>,
    pub default_address: Option<String>,
}

fn format_address(raw: u64) -> String {
    let bytes = raw.to_be_bytes();
    bytes[2..]
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn query() -> windows::core::Result<SystemAdapters> {
    let mut result = SystemAdapters::default();
    if let Ok(default) = BluetoothAdapter::GetDefaultAsync().and_then(|op| op.join()) {
        if let Ok(address) = default.BluetoothAddress() {
            result.default_address = Some(format_address(address));
        }
    }
    let selector = BluetoothAdapter::GetDeviceSelector()?;
    let infos = DeviceInformation::FindAllAsyncAqsFilter(&selector)?.join()?;
    for info in infos {
        let Ok(id) = info.Id() else { continue };
        let Ok(adapter) = BluetoothAdapter::FromIdAsync(&id).and_then(|op| op.join()) else {
            continue;
        };
        let Ok(address) = adapter.BluetoothAddress() else { continue };
        let mut name = info.Name().map(|n| n.to_string()).unwrap_or_default();
        if name.trim().is_empty() {
            name = "Adaptateur Bluetooth".to_owned();
        }
        if !adapter.IsLowEnergySupported().unwrap_or(true) {
            name.push_str(" — sans Bluetooth LE");
        }
        result.adapters.push(SystemAdapter {
            address: format_address(address),
            name,
        });
    }
    Ok(result)
}

pub async fn system_adapters() -> SystemAdapters {
    match tokio::task::spawn_blocking(query).await {
        Ok(Ok(adapters)) => adapters,
        Ok(Err(e)) => {
            log::warn!("Lecture des adaptateurs Bluetooth Windows impossible : {e}");
            SystemAdapters::default()
        }
        Err(e) => {
            log::warn!("Lecture des adaptateurs Bluetooth Windows impossible : {e}");
            SystemAdapters::default()
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn format_adresse() {
        assert_eq!(super::format_address(0x0011_2233_4455_66AA & 0xFFFF_FFFF_FFFF), "22:33:44:55:66:AA");
    }
}
