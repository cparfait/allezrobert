/**
 * EXPÉRIMENTAL — désactivé par défaut. Boutons Shimano Di2 « D-Fly » en Bluetooth.
 * D'après BikeControl (OpenBikeControl) — réimplémentation, non documenté par Shimano.
 *   Service 000018ef-5348-494d-414e-4f5f424c4500 (« SHIMANO_BLE »),
 *   caractéristique D-Fly 00002ac2-5348-494d-414e-4f5f424c4500 (indications).
 *   Charge : [en-tête][canal 1][canal 2][canal 3][canal 4] ; chaque octet change à chaque événement :
 *   bit 0x10 = appui court, 0x20 = appui long, 0x40 = double appui, aucun = relâché.
 *   La première trame reçue ne fait qu'initialiser l'état.
 * Les canaux D-Fly s'assignent dans l'appli Shimano E-TUBE (sinon les boutons ne remontent pas) ;
 * un canal non affecté vaut 0xF0. Les indications exigent un appareil appairé (liaison BLE de l'OS).
 *
 * NON IMPLÉMENTÉ (22/10/2026) : le « mode boutons » des Di2 12 v sans fil et le rapport réellement
 * engagé passent par le service de configuration 0x18FF, authentifié par le code E-TUBE ; le protocole
 * n'est publié nulle part (BikeControl le garde dans un paquet privé). Le rapport engagé est aussi
 * diffusé en ANT+ « Shifting », profil réservé aux membres ANT+.
 */
import { toBytes, type ByteSource } from '../bytes.ts';

export const SHIMANO_DFLY = {
  service: '000018ef-5348-494d-414e-4f5f424c4500',
  configService: '000018ff-5348-494d-414e-4f5f424c4500',
  channelCharacteristic: '00002ac2-5348-494d-414e-4f5f424c4500',
} as const;

/** Valeur d'un canal D-Fly non affecté. */
export const DFLY_UNMAPPED = 0xf0;

export type DflyPressKind = 'short' | 'long' | 'double' | 'release';

export interface DflyEvent {
  /** 1 à 4. */
  channel: number;
  kind: DflyPressKind;
}

export class DflyDecoder {
  private last: number[] | undefined;
  private longHeld = new Set<number>();

  push(data: ByteSource): DflyEvent[] {
    const b = toBytes(data);
    const channels = Array.from(b.subarray(1));
    const prev = this.last;
    this.last = channels;
    if (!prev) return [];
    const out: DflyEvent[] = [];
    channels.forEach((value, i) => {
      // 0xF0 = canal non affecté dans E-TUBE (kelvkk/shimano-di2-media-controls) : jamais un appui.
      if (prev[i] === value || value === DFLY_UNMAPPED) return;
      const channel = i + 1;
      if (value & 0x10) {
        // Après un appui long, l'appareil peut renvoyer « court » tant que le bouton reste tenu.
        if (!this.longHeld.has(channel)) out.push({ channel, kind: 'short' });
      } else if (value & 0x20) {
        this.longHeld.add(channel);
        out.push({ channel, kind: 'long' });
      } else if (value & 0x40) {
        out.push({ channel, kind: 'double' });
      } else {
        this.longHeld.delete(channel);
        out.push({ channel, kind: 'release' });
      }
    });
    return out;
  }

  reset(): void {
    this.last = undefined;
    this.longHeld.clear();
  }
}
