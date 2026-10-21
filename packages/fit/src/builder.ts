/**
 * Construction d'une `Activity` à partir d'échantillons à fréquence quelconque :
 * agrégation à 1 Hz (moyenne des puissances, cadences, FC, balance, TE/PS, pente,
 * température et vitesse sur la seconde ; dernière valeur pour distance, altitude, position)
 * et découpage en tours.
 */
import type { Activity, ActivityLap, ActivityRecord } from '@allezrobert/shared';

export interface ActivityBuilderOptions {
  id: string;
  name: string;
  subSport?: Activity['subSport'];
  deviceName?: string;
  riderMassKg: number;
  ftpWatts?: number;
  skipStrava?: boolean;
  /** Début de la sortie (epoch ms) ; défaut : premier échantillon. */
  startT?: number;
}

type Averaged = 'speedMs' | 'watts' | 'cadence' | 'hr' | 'balanceLeft' | 'teLeft' | 'teRight' | 'psLeft' | 'psRight' | 'gradePercent' | 'temperatureC';
const AVERAGED: readonly Averaged[] = ['speedMs', 'watts', 'cadence', 'hr', 'balanceLeft', 'teLeft', 'teRight', 'psLeft', 'psRight', 'gradePercent', 'temperatureC'];
/** Champs entiers dans le FIT : arrondis à l'agrégation. */
const ROUNDED = new Set<Averaged>(['watts', 'cadence', 'hr']);

export class ActivityBuilder {
  readonly records: ActivityRecord[] = [];
  readonly laps: ActivityLap[] = [];
  private readonly opts: ActivityBuilderOptions;
  private second = -1;
  private last: ActivityRecord | null = null;
  private sums = new Map<Averaged, { s: number; n: number }>();
  private lapStartIndex = 0;
  private lapStartT: number | null = null;
  private startT: number | null;

  constructor(opts: ActivityBuilderOptions) {
    this.opts = opts;
    this.startT = opts.startT ?? null;
  }

  /** Ajoute un échantillon (t en epoch ms, croissant). */
  addSample(sample: ActivityRecord): void {
    const sec = Math.floor(sample.t / 1000);
    if (this.startT === null) this.startT = sample.t;
    if (this.lapStartT === null) this.lapStartT = this.startT;
    if (sec !== this.second && this.last) this.flush();
    this.second = sec;
    this.last = sample;
    for (const k of AVERAGED) {
      const v = sample[k];
      if (v === undefined || !Number.isFinite(v)) continue;
      const acc = this.sums.get(k);
      if (acc) {
        acc.s += v;
        acc.n++;
      } else this.sums.set(k, { s: v, n: 1 });
    }
  }

  private flush(): void {
    const l = this.last;
    if (!l) return;
    const rec: ActivityRecord = {
      t: this.second * 1000,
      distanceM: l.distanceM,
      speedMs: l.speedMs,
      altitudeM: l.altitudeM,
    };
    if (l.lat !== undefined && l.lon !== undefined) {
      rec.lat = l.lat;
      rec.lon = l.lon;
    }
    for (const [k, acc] of this.sums) {
      const m = acc.s / acc.n;
      rec[k] = ROUNDED.has(k) ? Math.round(m) : m;
    }
    this.records.push(rec);
    this.sums = new Map();
    this.last = null;
  }

  /** Ferme le tour courant au dernier point enregistré (s'il contient au moins un point). */
  markLap(trigger: ActivityLap['trigger'] = 'manual'): void {
    this.flush();
    const end = this.records.length - 1;
    if (end < this.lapStartIndex) return;
    const endT = this.records[end]!.t;
    this.laps.push({ startT: this.lapStartT ?? this.records[this.lapStartIndex]!.t, endT, startIndex: this.lapStartIndex, endIndex: end, trigger });
    this.lapStartIndex = end + 1;
    this.lapStartT = endT;
  }

  /** Termine et renvoie la sortie (le dernier tour est fermé en « sessionEnd »). */
  finish(): Activity {
    this.flush();
    if (this.records.length > this.lapStartIndex) this.markLap('sessionEnd');
    const a: Activity = {
      id: this.opts.id,
      name: this.opts.name,
      sport: 'cycling',
      subSport: this.opts.subSport ?? 'virtualActivity',
      startT: this.startT ?? this.records[0]?.t ?? 0,
      records: this.records,
      laps: this.laps,
      riderMassKg: this.opts.riderMassKg,
      deviceName: this.opts.deviceName ?? 'Allez Robert !',
    };
    if (this.opts.ftpWatts !== undefined) a.ftpWatts = this.opts.ftpWatts;
    if (this.opts.skipStrava !== undefined) a.skipStrava = this.opts.skipStrava;
    return a;
  }
}

/** Raccourci : sortie depuis des échantillons et les instants de fin de tour (epoch ms, inclus). */
export function buildActivity(opts: ActivityBuilderOptions, samples: readonly ActivityRecord[], lapEndTimes: readonly number[] = []): Activity {
  const b = new ActivityBuilder(opts);
  let li = 0;
  for (const s of samples) {
    while (li < lapEndTimes.length && s.t > lapEndTimes[li]!) {
      b.markLap('manual');
      li++;
    }
    b.addSample(s);
  }
  return b.finish();
}
