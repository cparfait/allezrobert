/**
 * Tampon d'interpolation des instantanés serveur et estimation d'horloge.
 *
 * - Horloge : décalage local ↔ serveur = min(heure locale de réception − heure serveur) sur
 *   une fenêtre glissante (le minimum correspond au trajet le plus rapide, robuste à la gigue).
 * - Rendu des autres coureurs avec un retard fixe (150 ms par défaut, > 1 tick à 10 Hz) :
 *   interpolation linéaire entre les deux instantanés qui encadrent l'instant de rendu, sur
 *   les distances DÉPLIÉES (tour × longueur + distance) pour traverser la ligne sans saut ;
 *   extrapolation bornée (250 ms) à la vitesse connue si les paquets manquent.
 * Code pur (sans réseau), utilisable dans le jeu comme dans l'appli compagnon.
 */
import type { RiderSnapshot, WorldSnapshotMsg } from '@allezrobert/shared';

export interface InterpolatedRider {
  id: string;
  name: string;
  /** Distance dans le tour [0, longueur). */
  distM: number;
  lap: number;
  /** Distance dépliée : lap × longueur + distM. */
  unwrappedM: number;
  lateralM: number;
  speedMs: number;
  watts: number;
  cadence: number;
  hr?: number;
  draftPct: number;
  pose: RiderSnapshot['pose'];
  isAI: boolean;
  isGuest: boolean;
  avatar: RiderSnapshot['avatar'];
  /** Vrai si la position est extrapolée (instantané manquant). */
  extrapolated: boolean;
}

interface BufferedSnapshot {
  t: number;
  tick: number;
  byId: Map<string, RiderSnapshot>;
}

export class ClockSync {
  private samples: number[] = [];
  private offset = NaN;

  constructor(private readonly window = 60) {}

  /** Échantillon : heure locale de réception (ms, horloge monotone) et heure serveur (epoch ms). */
  add(localMs: number, serverMs: number): void {
    this.samples.push(localMs - serverMs);
    if (this.samples.length > this.window) this.samples.shift();
    let m = Infinity;
    for (const s of this.samples) if (s < m) m = s;
    this.offset = m;
  }

  get ready(): boolean {
    return Number.isFinite(this.offset);
  }

  /** local = serveur + offset. */
  get offsetMs(): number {
    return this.offset;
  }

  toServer(localMs: number): number {
    return localMs - this.offset;
  }

  toLocal(serverMs: number): number {
    return serverMs + this.offset;
  }

  reset(): void {
    this.samples = [];
    this.offset = NaN;
  }
}

export class SnapshotBuffer {
  private readonly snaps: BufferedSnapshot[] = [];
  routeLengthM = 0;
  loop = true;

  constructor(
    private readonly size = 40,
    public delayMs = 150,
    public maxExtrapolationMs = 250,
  ) {}

  push(s: WorldSnapshotMsg): void {
    const last = this.snaps.at(-1);
    if (last && s.t <= last.t) return; // doublon ou paquet en retard
    const byId = new Map<string, RiderSnapshot>();
    for (const r of s.riders) byId.set(r.id, r);
    this.snaps.push({ t: s.t, tick: s.tick, byId });
    if (this.snaps.length > this.size) this.snaps.shift();
  }

  clear(): void {
    this.snaps.length = 0;
  }

  get latest(): { t: number; tick: number; byId: Map<string, RiderSnapshot> } | undefined {
    return this.snaps.at(-1);
  }

  get length(): number {
    return this.snaps.length;
  }

  private unwrap(r: RiderSnapshot): number {
    return this.loop ? r.lap * this.routeLengthM + r.distM : r.distM;
  }

  /** État interpolé d'un coureur à l'heure serveur `serverNow` (le retard est appliqué ici). */
  sample(riderId: string, serverNow: number): InterpolatedRider | null {
    const n = this.snaps.length;
    if (n === 0) return null;
    const target = serverNow - this.delayMs;
    // Instantané le plus récent dont t ≤ target.
    let i = n - 1;
    while (i > 0 && this.snaps[i]!.t > target) i--;
    const a = this.snaps[i]!;
    const ra = a.byId.get(riderId);
    const b = this.snaps[i + 1];
    const rb = b?.byId.get(riderId);
    if (ra && b && rb && target >= a.t) {
      const k = Math.min(Math.max((target - a.t) / Math.max(b.t - a.t, 1), 0), 1);
      return this.mix(ra, rb, k, false);
    }
    // Pas d'encadrement : extrapolation depuis le plus récent qui contient le coureur.
    let j = n - 1;
    while (j >= 0 && !this.snaps[j]!.byId.has(riderId)) j--;
    if (j < 0) return null;
    const s = this.snaps[j]!;
    const r = s.byId.get(riderId)!;
    const ahead = Math.min(Math.max(target - s.t, 0), this.maxExtrapolationMs) / 1000;
    const out = this.mix(r, r, 0, ahead > 0);
    if (ahead > 0) this.setUnwrapped(out, out.unwrappedM + r.speedMs * ahead);
    return out;
  }

  private mix(a: RiderSnapshot, b: RiderSnapshot, k: number, extrapolated: boolean): InterpolatedRider {
    const lerp = (x: number, y: number): number => x + (y - x) * k;
    const out: InterpolatedRider = {
      id: a.id,
      name: b.name,
      distM: 0,
      lap: 0,
      unwrappedM: 0,
      lateralM: lerp(a.lateralM, b.lateralM),
      speedMs: lerp(a.speedMs, b.speedMs),
      watts: k < 0.5 ? a.watts : b.watts,
      cadence: lerp(a.cadence, b.cadence),
      draftPct: lerp(a.draftPct, b.draftPct),
      pose: k < 0.5 ? a.pose : b.pose,
      isAI: a.isAI,
      isGuest: a.isGuest,
      avatar: b.avatar,
      extrapolated,
    };
    const hr = k < 0.5 ? a.hr : b.hr;
    if (hr !== undefined) out.hr = hr;
    let ua = this.unwrap(a);
    const ub = this.unwrap(b);
    // Garde-fou : un saut énorme (repositionnement serveur) n'est pas interpolé.
    if (Math.abs(ub - ua) > 200) ua = ub;
    this.setUnwrapped(out, ua + (ub - ua) * k);
    return out;
  }

  private setUnwrapped(out: InterpolatedRider, u: number): void {
    out.unwrappedM = u;
    if (this.loop && this.routeLengthM > 0) {
      out.lap = Math.floor(u / this.routeLengthM);
      out.distM = u - out.lap * this.routeLengthM;
    } else {
      out.lap = 0;
      out.distM = this.routeLengthM > 0 ? Math.min(Math.max(u, 0), this.routeLengthM) : u;
    }
  }
}

/**
 * Réconciliation douce de son propre coureur : le jeu prédit localement (physique à 60 Hz),
 * le serveur fait autorité. On compare la position serveur à l'historique local au même
 * instant, puis on résorbe l'écart en douceur (constante de temps `tauS`) ; au-delà de
 * `snapM` on recale d'un coup (téléportation par le groupe soudé, reprise après coupure).
 */
export class SelfReconciler {
  private readonly hist: Array<{ t: number; u: number }> = [];
  private error = 0;

  constructor(
    public tauS = 0.6,
    public snapM = 25,
  ) {}

  /** Position locale prédite (dépliée) à l'heure locale `localMs`. */
  record(localMs: number, unwrappedM: number): void {
    this.hist.push({ t: localMs, u: unwrappedM });
    while (this.hist.length > 0 && localMs - this.hist[0]!.t > 3000) this.hist.shift();
  }

  /** Position serveur (dépliée) valable à l'heure locale `localAtMs`. */
  authoritative(localAtMs: number, serverUnwrappedM: number): void {
    const h = this.hist;
    if (h.length === 0) return;
    let local = h.at(-1)!.u;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1]!;
      const b = h[i]!;
      if (a.t <= localAtMs && localAtMs <= b.t) {
        local = a.u + ((b.u - a.u) * (localAtMs - a.t)) / Math.max(b.t - a.t, 1e-6);
        break;
      }
      if (i === 1 && localAtMs < a.t) local = a.u;
    }
    this.error = serverUnwrappedM - local;
  }

  /** Correction à ajouter à la position locale pour ce pas `dtS` (puis oubliée). */
  correction(dtS: number): number {
    if (Math.abs(this.error) > this.snapM) {
      const e = this.error;
      this.error = 0;
      this.shiftHistory(e);
      return e;
    }
    const c = this.error * (1 - Math.exp(-dtS / this.tauS));
    this.error -= c;
    this.shiftHistory(c);
    return c;
  }

  private shiftHistory(d: number): void {
    for (const p of this.hist) p.u += d;
  }

  get pendingErrorM(): number {
    return this.error;
  }

  reset(): void {
    this.hist.length = 0;
    this.error = 0;
  }
}
