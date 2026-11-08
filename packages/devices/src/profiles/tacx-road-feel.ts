/**
 * Ressenti route des Tacx NEO sur un trainer piloté en FTMS : le FTMS ne prévoit pas de revêtement,
 * on écrit donc la page propriétaire 0xFC (« NEO modes ») sur le canal FE-C over BLE de Tacx
 * (6e40fec3), à côté du FTMS qui garde la pente, l'ERG et les mesures.
 *
 * Écriture seule : pas d'abonnement aux notifications FE-C (le profil FTMS fournit déjà les données).
 * Une seule écriture en vol ; un réglage arrivé entre-temps remplace celui qui attend. Le réglage
 * identique au dernier envoyé n'est pas renvoyé. Le profil étant conservé entre deux reconnexions,
 * le dernier réglage est renvoyé à la reconnexion (le NEO l'oublie quand il s'éteint).
 */
import { TACX_FEC, antAcknowledgedData, encodeTacxNeoModes } from '@allezrobert/protocols';
import type { DeviceLink, GattConnection, Profile, ProfileContext, RoadFeelControl, RoadFeelSetting } from '../types.ts';

/** Canal ANT utilisé par convention sur le FE-C over BLE de Tacx (comme FecTrainer). */
const TACX_BLE_CHANNEL = 5;

const keyOf = (s: RoadFeelSetting): string => (s.surface === 'off' ? 'off' : `${s.surface}:${Math.round(s.intensityPercent)}`);

export class TacxRoadFeel implements Profile, RoadFeelControl {
  readonly name = 'tacx-road-feel';
  readonly streaming = false;
  private link: GattConnection | undefined;
  private ctx: ProfileContext | undefined;
  private wanted: RoadFeelSetting | undefined;
  /** Clé du réglage déjà accepté par le trainer sur la liaison en cours. */
  private sentKey: string | undefined;
  private writing = false;

  get roadFeel(): RoadFeelSetting | undefined {
    return this.wanted;
  }

  async attach(link: DeviceLink, ctx: ProfileContext): Promise<void> {
    if (link.type !== 'gatt') throw new Error('Ressenti route Tacx : liaison GATT attendue');
    this.link = link;
    this.ctx = ctx;
    this.sentKey = undefined;
    // Rien à renvoyer tant que le jeu n'a jamais demandé de revêtement : on n'écrit pas « coupé » pour rien.
    if (this.wanted && this.wanted.surface !== 'off') {
      ctx.log('Tacx : renvoi du ressenti route après (re)connexion');
      await this.flush();
    }
  }

  detach(): void {
    this.link = undefined;
    this.sentKey = undefined;
  }

  async setRoadFeel(setting: RoadFeelSetting): Promise<void> {
    this.wanted = { ...setting };
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.writing) return; // l'écriture en vol relira `wanted` en finissant
    this.writing = true;
    try {
      for (;;) {
        const link = this.link;
        const want = this.wanted;
        if (!link || !want) return;
        const key = keyOf(want);
        if (key === this.sentKey) return;
        const page = encodeTacxNeoModes({ roadSurface: want.surface, intensityPercent: want.intensityPercent });
        try {
          await link.write(TACX_FEC.service, TACX_FEC.tx, antAcknowledgedData(TACX_BLE_CHANNEL, page), false);
          if (link === this.link) this.sentKey = key;
          this.ctx?.log(`Tacx : ressenti route ${want.surface}${want.surface === 'off' ? '' : ` ${page[6]} %`}`);
        } catch (e) {
          this.ctx?.log(`Tacx : ressenti route non envoyé (${(e as Error).message})`);
          return; // le prochain réglage retentera
        }
      }
    } finally {
      this.writing = false;
    }
  }
}
