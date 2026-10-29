/**
 * Son d'une sortie : rassemble l'état utile au moteur audio (revêtement sous les roues d'après
 * les tags OSM des tuiles, occupation du sol, heure, saison, météo, public, trafic, effort,
 * changements de vitesse, pause) et le transmet à GameAudio à chaque image.
 *
 * Développement : ?surface=smooth|rough|cobbles|gravel|dirt force le revêtement entendu.
 */
import { baseRouteId, type RouteTrack } from '@allezrobert/shared';
import type { World } from '../world/world.ts';
import type { RideSession } from '../game/ride.ts';
import type { Traffic } from '../world/traffic.ts';
import { splatAt } from '../world/splat.ts';
import { GameAudio } from './audio.ts';
import { getMix, onMixChange } from './mix.ts';
import { SURFACES, crowdLevel, surfaceAt, type Surface } from './soundscape.ts';
import type { SoundSource } from './spatial.ts';

export interface RideSoundDeps {
  world: World;
  track: RouteTrack;
  ride: RideSession;
  traffic: Traffic | null;
  ftpWatts: number;
  maxHr?: number;
}

/** Canaux du raster d'occupation du sol (world/types.ts, SPLAT_CHANNELS). */
const FOREST = 0;
const FIELD = 1;
const MEADOW = 2;
const URBAN = 4;

export class RideSound {
  readonly audio: GameAudio;
  private surface: Surface = 'smooth';
  private readonly forced: Surface | null;
  private surfaceAcc = 1;
  private landAcc = 1;
  private land = { forest: 0, urban: 0, open: 0.5 };
  private wet = 0;
  private lastGear: number;
  private lastChainring: number;
  private readonly unsubscribe: () => void;
  private readonly unlock: () => void;

  constructor(private readonly d: RideSoundDeps) {
    this.audio = new GameAudio(getMix());
    this.audio.start();
    this.unsubscribe = onMixChange((m) => this.audio.setMix(m));
    // Contexte audio bloqué par la politique d'autoplay : on le relance au premier geste.
    this.unlock = () => {
      const c = this.audio.context;
      if (c instanceof AudioContext && c.state === 'suspended' && !document.hidden) void c.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', this.unlock);
    window.addEventListener('keydown', this.unlock);
    const q = new URLSearchParams(location.search).get('surface');
    this.forced = SURFACES.includes(q as Surface) ? (q as Surface) : null;
    this.lastGear = d.ride.gearIndex;
    this.lastChainring = d.ride.gear.chainring;
  }

  /** Revêtement entendu en ce moment (HUD de débogage, tests). */
  get currentSurface(): Surface {
    return this.forced ?? this.surface;
  }

  setSources(list: SoundSource[]): void {
    this.audio.setSources(list);
  }

  isMuted(): boolean {
    return this.audio.isMuted();
  }

  toggleMute(): boolean {
    return this.audio.toggleMute();
  }

  update(dt: number, pos: { x: number; z: number }, heading: number): void {
    const { world, track, ride, traffic } = this.d;
    const tile = world.terrain.getTile(...world.terrain.tileCoord(pos.x, pos.z));
    this.surfaceAcc += dt;
    if (tile && this.surfaceAcc > 0.3) {
      this.surfaceAcc = 0;
      this.surface = surfaceAt(tile.features.roads, pos.x, pos.z, baseRouteId(track.route.id)) ?? this.surface;
    }
    this.landAcc += dt;
    if (tile && this.landAcc > 0.5) {
      this.landAcc = 0;
      // Moyenne sur 5 points (rayon 40 m) : ce qu'on entend autour, pas seulement sous les roues.
      const target = { forest: 0, urban: 0, open: 0 };
      for (const [ox, oz] of [
        [0, 0],
        [40, 0],
        [-40, 0],
        [0, 40],
        [0, -40],
      ] as const) {
        target.forest += splatAt(tile, FOREST, pos.x + ox, pos.z + oz) / 5;
        target.urban += splatAt(tile, URBAN, pos.x + ox, pos.z + oz) / 5;
        target.open += Math.min(1, splatAt(tile, FIELD, pos.x + ox, pos.z + oz) + splatAt(tile, MEADOW, pos.x + ox, pos.z + oz)) / 5;
      }
      // Pas de raster (monde sans orthophoto ni occupation) : campagne ouverte par défaut.
      if (!tile.splat) target.open = 0.6;
      const k = 0.5;
      this.land.forest += (target.forest - this.land.forest) * k;
      this.land.urban += (target.urban - this.land.urban) * k;
      this.land.open += (target.open - this.land.open) * k;
    }
    const env = world.env.state;
    const rain = env.weather.rain;
    // La chaussée se mouille en ~20 s de pluie, sèche en ~2 min.
    const wetTarget = Math.min(1, rain * 2);
    this.wet += (wetTarget - this.wet) * Math.min(1, dt / (wetTarget > this.wet ? 20 : 120));

    // Changement de vitesse virtuelle : dérailleur (plateau si le grand pignon avant change).
    if (ride.gearIndex !== this.lastGear) {
      this.audio.shift(ride.gear.chainring !== this.lastChainring);
      this.lastGear = ride.gearIndex;
      this.lastChainring = ride.gear.chainring;
    }

    const route = track.route;
    this.audio.update(
      {
        speedMs: ride.state.speedMs,
        cadence: ride.inputs.cadence,
        watts: ride.watts3s(),
        ftp: this.d.ftpWatts,
        ...(ride.inputs.hr !== undefined ? { hr: ride.inputs.hr } : {}),
        hrMax: this.d.maxHr ?? 190,
        surface: this.currentSurface,
        wet: this.wet,
        windMs: env.weather.windMs,
        windFrom: env.weather.windFrom,
        heading,
        x: pos.x,
        z: pos.z,
        env: { hour: env.hour, season: env.season, night: world.nightFactor(), rain },
        land: this.land,
        crowd: crowdLevel(track.wrap(ride.state.distM), route.segments, track.length, route.loop),
        mountain: (route.maxElevationM ?? 0) > 900,
        vehicles: traffic?.audible() ?? [],
        paused: ride.paused,
      },
      dt,
    );
  }

  dispose(): void {
    this.unsubscribe();
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    this.audio.dispose();
  }
}
