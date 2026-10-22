import { SequencePlayer } from '@allezrobert/sequences';
import type { RouteTrack } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import type { SegmentResult } from './ride.ts';
import type { Season } from '../world/environment.ts';

const PR_KEY = (routeId: string, segId: string) => `ar.pr.${routeId}.${segId}`;

/**
 * Mise en scène HyperFrames pendant la sortie : intro + compte à rebours, KOM / sprint franchis,
 * podium, habillage de la caméra TV. Les séquences se superposent au canvas sans masquer
 * les données vitales (zones protégées du HUD respectées par les compositions).
 */
export class RideSequences {
  private readonly player: SequencePlayer;
  private readonly track: RouteTrack;
  private tvActive = false;
  enabled = localStorage.getItem('ar.sequences') !== 'off';

  constructor(container: HTMLElement, track: RouteTrack) {
    this.track = track;
    this.player = new SequencePlayer(container, { lang: getLang(), insets: { top: 250, bottom: 130 } });
    void this.player.preload(['intro', 'kom', 'sprint', 'podium', 'tv']).catch(() => undefined);
  }

  /** Intro et compte à rebours ; la promesse se résout au « go » (ou tout de suite en cas d'échec). */
  async intro(opts: { season: Season; riders: number; rideType: 'free' | 'group' | 'race' | 'workout' | 'ftpTest' | 'open' }): Promise<void> {
    if (!this.enabled) return;
    const profile = this.track.profile(80).map((p) => Math.round(p.y * 10) / 10);
    const r = this.track.route;
    await new Promise<void>((resolve) => {
      let done = false;
      const go = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      void this.player
        .play(
          'intro',
          {
            route_name: getLang() === 'en' && r.nameEn ? r.nameEn : r.name,
            distance_km: Math.round(r.lengthM / 100) / 10,
            elevation_m: Math.round(r.elevationGainM),
            riders: opts.riders,
            season: ({ spring: 'printemps', summer: 'ete', autumn: 'automne', winter: 'hiver' } as const)[opts.season],
            ride_type: opts.rideType,
            profile,
          },
          { onCue: (cue) => cue === 'go' && go() },
        )
        .then(go, go);
      // Filet de sécurité : jamais plus de 8 s d'attente au départ.
      setTimeout(go, 8000);
    });
  }

  /** Segment terminé : temps, record personnel (stockage local). */
  segment(res: SegmentResult, riderName: string, routeId: string, rank: number, total: number): void {
    const key = PR_KEY(routeId, res.seg.id);
    const prev = Number(localStorage.getItem(key) ?? 'NaN');
    const pr = !Number.isFinite(prev) || res.timeS < prev;
    if (pr) localStorage.setItem(key, String(res.timeS));
    if (!this.enabled || this.tvActive) return;
    void this.player.play(res.seg.kind === 'sprint' ? 'sprint' : 'kom', {
      segment_name: res.seg.name,
      rider_name: riderName,
      time_s: Math.round(res.timeS * 10) / 10,
      rank,
      rank_total: total,
      pr,
      ...(pr && Number.isFinite(prev) ? { pr_delta_s: Math.round((prev - res.timeS) * 10) / 10 } : {}),
    });
  }

  podium(entries: Array<{ name: string; timeS: number; color: string }>): Promise<unknown> {
    if (!this.enabled || !entries.length) return Promise.resolve();
    return this.player.play('podium', {
      route_name: this.track.route.name,
      podium: entries.slice(0, 3).map((e) => ({ name: e.name, time_s: Math.round(e.timeS), team: '', team_color: e.color })),
    });
  }

  /** Habillage TV : lancé avec la caméra « réalisation TV », mis à jour en direct, relâché ensuite. */
  tv(active: boolean, data?: { riderName: string; color: string; position: number; wkg: number; watts: number }): void {
    if (!this.enabled) return;
    if (active && !this.tvActive && data) {
      this.tvActive = true;
      void this.player.play('tv', { rider_name: data.riderName, team_color: data.color, position: data.position, wkg: Math.round(data.wkg * 10) / 10, watts: Math.round(data.watts), show_banner: true, show_gaps: false }, { hold: true });
    } else if (!active && this.tvActive) {
      this.tvActive = false;
      this.player.release();
    } else if (active && data) {
      this.player.update({ position: data.position, wkg: Math.round(data.wkg * 10) / 10, watts: Math.round(data.watts) });
    }
  }

  dispose(): void {
    this.player.dispose();
  }
}
