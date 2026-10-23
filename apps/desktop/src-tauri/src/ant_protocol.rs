//! Trames série ANT (protocole « ANT Message Protocol and Usage ») : encodage, décodage, constantes.
//!
//! Format : `[0xA4, longueur, id, charge utile…, somme XOR]`, la somme couvrant tous les octets
//! précédents (synchro comprise).

pub const SYNC: u8 = 0xA4;

// Messages de configuration / contrôle.
pub const MSG_UNASSIGN_CHANNEL: u8 = 0x41;
pub const MSG_ASSIGN_CHANNEL: u8 = 0x42;
pub const MSG_CHANNEL_PERIOD: u8 = 0x43;
pub const MSG_SEARCH_TIMEOUT: u8 = 0x44;
pub const MSG_RF_FREQUENCY: u8 = 0x45;
pub const MSG_NETWORK_KEY: u8 = 0x46;
pub const MSG_RESET_SYSTEM: u8 = 0x4A;
pub const MSG_OPEN_CHANNEL: u8 = 0x4B;
pub const MSG_CLOSE_CHANNEL: u8 = 0x4C;
pub const MSG_CHANNEL_ID: u8 = 0x51;
pub const MSG_LOW_PRIORITY_SEARCH_TIMEOUT: u8 = 0x63;

// Données.
pub const MSG_BROADCAST_DATA: u8 = 0x4E;
pub const MSG_ACKNOWLEDGED_DATA: u8 = 0x4F;
pub const MSG_BURST_DATA: u8 = 0x50;

// Réponses / événements.
pub const MSG_CHANNEL_EVENT: u8 = 0x40;
pub const MSG_STARTUP: u8 = 0x6F;

pub const EVENT_CODE_RESPONSE_NO_ERROR: u8 = 0x00;
pub const EVENT_RX_SEARCH_TIMEOUT: u8 = 0x01;
pub const EVENT_RX_FAIL: u8 = 0x02;
pub const EVENT_TRANSFER_TX_COMPLETED: u8 = 0x05;
pub const EVENT_TRANSFER_TX_FAILED: u8 = 0x06;
pub const EVENT_CHANNEL_CLOSED: u8 = 0x07;
pub const EVENT_RX_FAIL_GO_TO_SEARCH: u8 = 0x08;

/// Type de canal : esclave en réception (bidirectionnel).
pub const CHANNEL_TYPE_SLAVE: u8 = 0x00;
/// Réseau utilisé pour la clé ANT+.
pub const ANT_PLUS_NETWORK: u8 = 0;

/// Message ANT décodé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AntMessage {
    pub id: u8,
    pub payload: Vec<u8>,
}

impl AntMessage {
    pub fn new(id: u8, payload: impl Into<Vec<u8>>) -> Self {
        Self {
            id,
            payload: payload.into(),
        }
    }

    /// Encode la trame complète (synchro, longueur, id, charge utile, somme de contrôle).
    pub fn encode(&self) -> Vec<u8> {
        encode(self.id, &self.payload)
    }

    /// Pour un message de données (diffusion, acquitté, rafale) : numéro de canal et 8 octets utiles.
    /// Les éventuelles données étendues (après les 8 octets) sont ignorées.
    pub fn data_payload(&self) -> Option<(u8, [u8; 8])> {
        match self.id {
            MSG_BROADCAST_DATA | MSG_ACKNOWLEDGED_DATA | MSG_BURST_DATA if self.payload.len() >= 9 => {
                // En rafale, les 3 bits de poids fort portent le numéro de séquence.
                let channel = if self.id == MSG_BURST_DATA {
                    self.payload[0] & 0x1F
                } else {
                    self.payload[0]
                };
                let mut data = [0u8; 8];
                data.copy_from_slice(&self.payload[1..9]);
                Some((channel, data))
            }
            _ => None,
        }
    }

    /// Pour un message 0x40 : (canal, id du message concerné, code).
    /// `id == 0x01` signifie un événement radio, sinon une réponse à la commande `id`.
    pub fn channel_event(&self) -> Option<(u8, u8, u8)> {
        if self.id == MSG_CHANNEL_EVENT && self.payload.len() >= 3 {
            Some((self.payload[0], self.payload[1], self.payload[2]))
        } else {
            None
        }
    }
}

pub fn checksum(bytes: &[u8]) -> u8 {
    bytes.iter().fold(0u8, |acc, b| acc ^ b)
}

pub fn encode(id: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.push(SYNC);
    frame.push(payload.len() as u8);
    frame.push(id);
    frame.extend_from_slice(payload);
    frame.push(checksum(&frame));
    frame
}

/// Décodeur incrémental : accepte des octets arbitrairement découpés (transferts USB) et se
/// resynchronise sur 0xA4 en cas de corruption.
#[derive(Debug, Default)]
pub struct AntDecoder {
    buffer: Vec<u8>,
}

impl AntDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<AntMessage> {
        self.buffer.extend_from_slice(bytes);
        let mut messages = Vec::new();
        loop {
            // Aligne sur l'octet de synchro.
            match self.buffer.iter().position(|b| *b == SYNC) {
                Some(0) => {}
                Some(n) => {
                    self.buffer.drain(..n);
                }
                None => {
                    self.buffer.clear();
                    break;
                }
            }
            if self.buffer.len() < 2 {
                break;
            }
            let len = self.buffer[1] as usize;
            let total = len + 4;
            if self.buffer.len() < total {
                break;
            }
            let frame = &self.buffer[..total];
            if checksum(&frame[..total - 1]) == frame[total - 1] {
                messages.push(AntMessage::new(frame[2], &frame[3..3 + len]));
                self.buffer.drain(..total);
            } else {
                // Faux départ : on saute cet octet de synchro.
                self.buffer.drain(..1);
            }
        }
        // Protection contre une accumulation sans fin.
        if self.buffer.len() > 4096 {
            self.buffer.clear();
        }
        messages
    }
}

/// Analyse une clé réseau ANT+ (8 octets) écrite en hexadécimal : `B9A521FBBD72C345`,
/// `B9 A5 21 …`, `0xB9,0xA5,…` sont acceptés.
/// Clé réseau passée par le TypeScript (`ant_open({ networkKey })`) : exactement 8 octets.
pub fn network_key_from_bytes(bytes: &[u8]) -> Option<[u8; 8]> {
    bytes.try_into().ok()
}

pub fn parse_network_key(raw: &str) -> Option<[u8; 8]> {
    let cleaned: String = raw
        .replace("0x", "")
        .replace("0X", "")
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    let has_only_valid = raw
        .replace("0x", "")
        .replace("0X", "")
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c.is_whitespace() || matches!(c, ',' | ':' | '-' | ';' | '[' | ']'));
    if cleaned.len() != 16 || !has_only_valid {
        return None;
    }
    let mut key = [0u8; 8];
    for (i, chunk) in cleaned.as_bytes().chunks(2).enumerate() {
        key[i] = u8::from_str_radix(std::str::from_utf8(chunk).ok()?, 16).ok()?;
    }
    Some(key)
}

/// Libellé français d'un code de réponse ANT.
pub fn response_code_label(code: u8) -> &'static str {
    match code {
        0x00 => "aucune erreur",
        0x15 => "canal dans un état incompatible",
        0x16 => "canal non ouvert",
        0x18 => "identifiant de canal non défini",
        0x1F => "transfert en cours",
        0x28 => "message invalide",
        0x29 => "numéro de réseau invalide",
        0x30 => "liste invalide",
        0x31 => "écriture interdite",
        _ => "code inconnu",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_open_channel() {
        // A4 01 4B 00 → XOR = A4^01^4B^00 = EE
        assert_eq!(encode(MSG_OPEN_CHANNEL, &[0x00]), vec![0xA4, 0x01, 0x4B, 0x00, 0xEE]);
    }

    #[test]
    fn encode_channel_id() {
        // Canal 0, appareil 0 (joker), type 0x78 (cardio), transmission 0.
        let frame = encode(MSG_CHANNEL_ID, &[0x00, 0x00, 0x00, 0x78, 0x00]);
        assert_eq!(frame[..8], [0xA4, 0x05, 0x51, 0x00, 0x00, 0x00, 0x78, 0x00]);
        assert_eq!(frame[8], checksum(&frame[..8]));
    }

    #[test]
    fn decode_fragmente_et_resynchronise() {
        let broadcast = encode(MSG_BROADCAST_DATA, &[0x01, 1, 2, 3, 4, 5, 6, 7, 8]);
        let event = encode(MSG_CHANNEL_EVENT, &[0x01, 0x01, EVENT_RX_FAIL]);
        let mut stream = vec![0x00, 0xA4, 0x09]; // bruit + faux départ
        stream.extend_from_slice(&broadcast);
        stream.extend_from_slice(&event);

        let mut decoder = AntDecoder::new();
        let mut messages = Vec::new();
        for chunk in stream.chunks(5) {
            messages.extend(decoder.push(chunk));
        }
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].data_payload(), Some((1, [1, 2, 3, 4, 5, 6, 7, 8])));
        assert_eq!(messages[1].channel_event(), Some((1, 0x01, EVENT_RX_FAIL)));
    }

    #[test]
    fn decode_somme_invalide_ignoree() {
        let mut frame = encode(MSG_BROADCAST_DATA, &[0x00, 9, 9, 9, 9, 9, 9, 9, 9]);
        let last = frame.len() - 1;
        frame[last] ^= 0xFF;
        let mut decoder = AntDecoder::new();
        assert!(decoder.push(&frame).is_empty());
        // Une trame valide après la trame corrompue est toujours décodée.
        let ok = encode(MSG_STARTUP, &[0x00]);
        assert_eq!(decoder.push(&ok), vec![AntMessage::new(MSG_STARTUP, vec![0x00])]);
    }

    #[test]
    fn rafale_et_donnees_etendues() {
        // Rafale : séquence 0b011 dans les bits de poids fort, canal 2.
        let burst = AntMessage::new(MSG_BURST_DATA, vec![0x62, 1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(burst.data_payload(), Some((2, [1, 2, 3, 4, 5, 6, 7, 8])));
        // Données étendues (drapeau 0x80 + id de canal) : seuls les 8 premiers octets comptent.
        let ext = AntMessage::new(
            MSG_BROADCAST_DATA,
            vec![0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0x80, 0x34, 0x12, 0x78, 0x01],
        );
        assert_eq!(ext.data_payload(), Some((0, [1, 2, 3, 4, 5, 6, 7, 8])));
        assert_eq!(AntMessage::new(MSG_STARTUP, vec![0]).data_payload(), None);
    }

    #[test]
    fn cle_reseau() {
        let expected = [0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF];
        assert_eq!(parse_network_key("0123456789ABCDEF"), Some(expected));
        assert_eq!(parse_network_key("01 23 45 67 89 ab cd ef"), Some(expected));
        assert_eq!(parse_network_key("0x01,0x23,0x45,0x67,0x89,0xAB,0xCD,0xEF"), Some(expected));
        assert_eq!(parse_network_key("[0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF]"), Some(expected));
        assert_eq!(parse_network_key("0123"), None);
        assert_eq!(parse_network_key("0123456789ABCDEG"), None);
    }

    #[test]
    fn network_key_bytes() {
        assert_eq!(network_key_from_bytes(&[1, 2, 3, 4, 5, 6, 7, 8]), Some([1, 2, 3, 4, 5, 6, 7, 8]));
        assert_eq!(network_key_from_bytes(&[1, 2, 3]), None);
        assert_eq!(network_key_from_bytes(&[0; 9]), None);
    }
}
