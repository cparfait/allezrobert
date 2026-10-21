/**
 * Contrat entre l'app desktop Tauri (Rust : btleplug, mDNS, TCP Direct Connect, ANT+ USB)
 * et le paquet `devices` (TypeScript). Les octets transitent en tableaux de nombres (0–255).
 *
 * Commandes Tauri (invoke) — noms exacts côté Rust (#[tauri::command]) :
 *   ble_list_adapters()                         -> NativeAdapter[]
 *   ble_select_adapter({ adapterId })           -> void
 *   ble_start_scan({ services: string[] })      -> void   (UUID 128 bits en minuscules)
 *   ble_stop_scan()                             -> void
 *   ble_connect({ deviceId })                   -> NativeGattService[]
 *   ble_disconnect({ deviceId })                -> void
 *   ble_read({ deviceId, service, characteristic })              -> number[]
 *   ble_write({ deviceId, service, characteristic, data, withResponse }) -> void
 *   ble_subscribe({ deviceId, service, characteristic })         -> void
 *   ble_unsubscribe({ deviceId, service, characteristic })       -> void
 *   dircon_discover({ timeoutMs })              -> NativeDirconDevice[]   (mDNS _wahoo-fitness-tnp._tcp)
 *   dircon_connect({ host, port })              -> string (connectionId)
 *   dircon_send({ connectionId, data })         -> void   (trame DirCon complète)
 *   dircon_close({ connectionId })              -> void
 *   ant_list_sticks()                           -> NativeAntStick[]
 *   ant_open({ stickId, networkKey? })          -> void   (networkKey : 8 octets, optionnel, issu de la configuration —
 *                                                        jamais codé en dur : licence ANT+ ; absent → config de l'app desktop)
 *   ant_open_channel({ channel, deviceType, deviceNumber, transmissionType, period, rfFreq }) -> void
 *   ant_send({ channel, data, acknowledged })   -> void   (8 octets de charge utile)
 *   ant_close()                                 -> void
 *   ant_close_channel({ channel })              -> void   (OPTIONNEL, proposé par `devices` : libère un canal de
 *                                                        recherche ; appelé dans un try/catch, peut ne pas exister)
 *
 * Événements Tauri (listen) :
 *   "ble://discovered"   NativeDiscovered
 *   "ble://notification" NativeNotification
 *   "ble://disconnected" { deviceId: string }
 *   "dircon://data"      { connectionId: string; data: number[] }
 *   "dircon://closed"    { connectionId: string }
 *   "ant://message"      { channel: number; data: number[] }  (charge utile de 8 octets, message de diffusion/ack)
 */

export interface NativeAdapter {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NativeDiscovered {
  deviceId: string;
  name: string;
  rssi?: number;
  services: string[];
  manufacturerData?: Record<string, number[]>;
}

export interface NativeGattService {
  uuid: string;
  characteristics: Array<{ uuid: string; properties: string[] }>;
}

export interface NativeNotification {
  deviceId: string;
  service: string;
  characteristic: string;
  data: number[];
}

export interface NativeDirconDevice {
  name: string;
  host: string;
  port: number;
  serialNumber?: string;
  services: string[];
  macAddress?: string;
}

export interface NativeAntStick {
  id: string;
  name: string;
  vendorId: number;
  productId: number;
}

/** UUID 128 bits d'un service/caractéristique Bluetooth SIG à partir de son identifiant 16 bits. */
export function bleUuid(short16: number): string {
  return `0000${short16.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}
