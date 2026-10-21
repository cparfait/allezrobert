/**
 * EXPÉRIMENTAL — désactivé par défaut. Ventilateur Wahoo KICKR HEADWIND en Bluetooth.
 * Commandes non documentées par Wahoo, telles que publiées par BikeControl (OpenBikeControl, support « bêta »).
 *   Service a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b, caractéristique a026e038-… (write + notify).
 *   [0x04, mode] : 0x01 arrêt, 0x02 suivi FC, 0x03 suivi vitesse (capteur appairé), 0x04 manuel.
 *   [0x02, vitesse] : vitesse en mode manuel, 0–100 %. BikeControl se limite à 0/25/50/75/100 : les valeurs
 *   intermédiaires n'ont pas été vérifiées sur matériel → `quantize` les arrondit au pas de 25 % par défaut.
 *   Notification d'état : [0xFD, 0x01, vitesse %, mode].
 */
import { clamp, toBytes, type ByteSource } from '../bytes.ts';

export const HEADWIND = {
  service: 'a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b',
  characteristic: 'a026e038-0a7d-4ab3-97fa-f1500f9feb8b',
} as const;

export const HEADWIND_MODE = { off: 0x01, heartRate: 0x02, speed: 0x03, manual: 0x04 } as const;
export type HeadwindMode = keyof typeof HEADWIND_MODE;

export function encodeHeadwindMode(mode: HeadwindMode): Uint8Array {
  return Uint8Array.of(0x04, HEADWIND_MODE[mode]);
}

/** Vitesse manuelle (à envoyer après encodeHeadwindMode('manual')). */
export function encodeHeadwindSpeed(percent: number, quantize = true): Uint8Array {
  let p = clamp(Math.round(percent), 0, 100);
  if (quantize) p = Math.round(p / 25) * 25;
  return Uint8Array.of(0x02, p);
}

export interface HeadwindStatus {
  speedPercent: number;
  mode: HeadwindMode | 'unknown';
}

export function decodeHeadwindStatus(data: ByteSource): HeadwindStatus | undefined {
  const b = toBytes(data);
  if (b.length < 4 || b[0] !== 0xfd || b[1] !== 0x01) return undefined;
  const m = b[3] ?? 0;
  const mode = (Object.entries(HEADWIND_MODE).find(([, v]) => v === m)?.[0] as HeadwindMode | undefined) ?? 'unknown';
  return { speedPercent: b[2] ?? 0, mode };
}
