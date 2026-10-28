import { describe, expect, it } from 'vitest';
import type { RouteSegment } from '@allezrobert/shared';
import {
  BreathModel,
  SURFACES,
  ambienceMix,
  apparentWind,
  breathEnvelope,
  crowdActivity,
  crowdLevel,
  eventChance,
  freewheelClickGain,
  freewheelRate,
  isCoasting,
  panFor,
  surfaceAt,
  surfaceFromOsm,
  tireMix,
  vehicleVoice,
  windMix,
  type AmbienceInput,
  type Surface,
} from '../src/audio/soundscape.ts';
import type { TileRoad } from '../src/world/types.ts';

const tireTotal = (s: Surface, v: number, wet = 0) => {
  const m = tireMix(s, v, wet);
  return m.roar.gain + m.hiss.gain + m.crunch.gain + m.cobble.gain + m.spray;
};

describe('revêtement', () => {
  it('lit les tags OSM', () => {
    expect(surfaceFromOsm('asphalt', 'secondary')).toBe('smooth');
    expect(surfaceFromOsm('asphalt', 'unclassified')).toBe('rough');
    expect(surfaceFromOsm('chipseal', 'tertiary')).toBe('rough');
    expect(surfaceFromOsm('sett', 'residential')).toBe('cobbles');
    expect(surfaceFromOsm('cobblestone')).toBe('cobbles');
    expect(surfaceFromOsm('fine_gravel', 'track')).toBe('gravel');
    expect(surfaceFromOsm('unpaved', 'track')).toBe('gravel');
    expect(surfaceFromOsm('ground', 'path')).toBe('dirt');
    expect(surfaceFromOsm('', 'track')).toBe('gravel');
    expect(surfaceFromOsm('concrete', 'service')).toBe('smooth');
    expect(surfaceFromOsm(undefined, 'primary')).toBe('smooth');
  });

  it('trouve la voie sous le coureur, en préférant l’itinéraire actif', () => {
    const roads: TileRoad[] = [
      { kind: 'tertiary', width: 6, surface: 'asphalt', route: 'boucle', pts: [0, 0, 100, 0] },
      { kind: 'track', width: 3, surface: 'gravel', pts: [50, -50, 50, 50] },
      { kind: 'residential', width: 5, surface: 'sett', pts: [0, 30, 100, 30] },
    ];
    expect(surfaceAt(roads, 20, 1, 'boucle')).toBe('smooth');
    // Au croisement, l'itinéraire actif l'emporte sur le chemin qui le coupe.
    expect(surfaceAt(roads, 50.5, 0.5, 'boucle')).toBe('smooth');
    expect(surfaceAt(roads, 51, 15, 'boucle')).toBe('gravel');
    expect(surfaceAt(roads, 80, 29, 'boucle')).toBe('cobbles');
    expect(surfaceAt(roads, 80, 15, 'boucle')).toBeNull();
  });
});

describe('roulement', () => {
  it('se tait à l’arrêt et croît avec la vitesse', () => {
    for (const s of SURFACES) {
      expect(tireTotal(s, 0)).toBe(0);
      let prev = 0;
      for (const v of [1, 3, 6, 9, 12, 15, 20]) {
        const t = tireTotal(s, v);
        expect(t).toBeGreaterThan(prev);
        prev = t;
      }
    }
  });

  it('est plus présent sur revêtement rugueux, et pavés que sur enrobé lisse ; discret sur les chemins', () => {
    for (const v of [4, 8, 12]) {
      const smooth = tireTotal('smooth', v);
      expect(tireTotal('rough', v)).toBeGreaterThan(smooth * 1.4);
      expect(tireTotal('cobbles', v)).toBeGreaterThan(tireTotal('rough', v));
      // Chemins : roulement discret, sans craquement (trop fort et irréaliste).
      expect(tireTotal('gravel', v)).toBeLessThan(tireTotal('rough', v));
    }
    expect(tireMix('smooth', 10).crunch.gain).toBe(0);
    expect(tireMix('smooth', 10).cobble.gain).toBe(0);
    expect(tireMix('gravel', 10).crunch.gain).toBe(0);
  });

  it('pavés : un impact tous les 16 cm', () => {
    expect(tireMix('cobbles', 8).cobble.rate).toBeCloseTo(50, 5);
  });

  it('route mouillée : projection d’eau', () => {
    expect(tireMix('smooth', 10, 0).spray).toBe(0);
    expect(tireMix('smooth', 10, 1).spray).toBeGreaterThan(0.03);
  });

  it('reste dans son budget et sans NaN', () => {
    for (const s of SURFACES)
      for (const v of [Number.NaN, -3, 0, 5, 25, 40]) {
        const t = tireTotal(s, v, 1);
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeLessThan(0.9);
      }
  });
});

describe('vent', () => {
  it('vent de face / de dos (nord = 0, cap 0 = vers le sud)', () => {
    // Vent du nord, on roule vers le sud : vent de dos.
    expect(apparentWind(10, 4, 0, 0)).toBeCloseTo(6, 5);
    // Vers le nord : vent de face.
    expect(apparentWind(10, 4, 0, Math.PI)).toBeCloseTo(14, 5);
    // Vent de travers : composante latérale.
    expect(apparentWind(0, 5, Math.PI / 2, 0)).toBeCloseTo(5, 5);
  });

  it('souffle de l’air croissant et borné', () => {
    expect(windMix(0).gain).toBeLessThan(0.01);
    expect(windMix(10).gain).toBeGreaterThan(windMix(5).gain);
    expect(windMix(100).gain).toBeLessThanOrEqual(0.2);
    expect(windMix(15).freq).toBeGreaterThan(windMix(5).freq);
  });
});

describe('roue libre', () => {
  it('cliquette quand on ne pédale pas', () => {
    expect(isCoasting(0, 0, 10)).toBe(true);
    expect(isCoasting(90, 220, 10)).toBe(false);
    expect(isCoasting(0, 0, 0.2)).toBe(false);
  });

  it('rythme proportionnel à la vitesse de roue (36 cliquets par tour)', () => {
    // 36 km/h = 10 m/s → 4,75 tours/s → 171 cliquets/s.
    expect(freewheelRate(10)).toBeCloseTo(171, 0);
    expect(freewheelRate(20)).toBeCloseTo(2 * freewheelRate(10), 6);
  });

  it('puissance moyenne constante une fois en bourdonnement', () => {
    const power = (r: number) => r * freewheelClickGain(r) ** 2;
    expect(power(320)).toBeCloseTo(power(80), 6);
    expect(freewheelClickGain(10)).toBeGreaterThan(freewheelClickGain(200));
    expect(freewheelClickGain(0)).toBe(0);
  });
});

describe('souffle', () => {
  const settle = (ftpFrac: number, hr?: number, coasting = false) => {
    const b = new BreathModel();
    let p = b.update(0.1, ftpFrac, hr, coasting);
    for (let i = 0; i < 300; i++) p = b.update(0.1, ftpFrac, hr, coasting);
    return p;
  };

  it('inaudible au repos, présent au seuil, fort au-delà', () => {
    expect(settle(0.4).gain).toBe(0);
    const ftp = settle(1);
    const vo2 = settle(1.25);
    expect(ftp.gain).toBeGreaterThan(0.1);
    expect(vo2.gain).toBeGreaterThan(ftp.gain);
    expect(vo2.gain).toBeLessThanOrEqual(0.3);
  });

  it('rythme comme le visage (rider/face.ts) : 12 → 50 cycles/min selon la FC', () => {
    expect(settle(0).rate).toBeCloseTo(12 + 38 * 0.028, 2); // FC déduite 0,55 → smoothstep 0,028
    expect(settle(1.3).rate).toBe(50);
    // FC mesurée prioritaire.
    expect(settle(0.7, 0.98).rate).toBeGreaterThan(49);
    expect(settle(0.7, 0.5).rate).toBe(12);
  });

  it('effort lissé (pas de saut au premier coup de pédale)', () => {
    const b = new BreathModel();
    const p = b.update(0.1, 1.5);
    expect(p.effort).toBeLessThan(0.1);
  });

  it('enveloppe : expiration plus forte que l’inspiration, cycle complet', () => {
    const env = breathEnvelope(30, 0.05);
    const peak = Math.max(...env.map(([, g]) => g));
    expect(peak).toBe(0.05);
    expect(env[1]?.[1]).toBeLessThan(peak);
    expect(env.at(-1)?.[1]).toBe(0);
    expect(env.at(-1)?.[0]).toBeLessThan(2); // période = 2 s à 30 cycles/min
    for (let i = 1; i < env.length; i++) expect((env[i] as [number, number])[0]).toBeGreaterThan((env[i - 1] as [number, number])[0]);
  });
});

describe('public', () => {
  const segs: RouteSegment[] = [
    { id: 'c', kind: 'kom', name: 'Côte', startM: 1000, endM: 2000, avgGrade: 6 },
    { id: 's', kind: 'sprint', name: 'Sprint', startM: 5000, endM: 5300, avgGrade: 0 },
  ];
  it('plein au sommet, entendu en approche, éteint après', () => {
    expect(crowdLevel(1800, segs, 8000, true)).toBe(1);
    expect(crowdLevel(1600, segs, 8000, true)).toBeGreaterThan(0);
    expect(crowdLevel(1600, segs, 8000, true)).toBeLessThan(crowdLevel(1630, segs, 8000, true));
    expect(crowdLevel(1200, segs, 8000, true)).toBe(0);
    expect(crowdLevel(2050, segs, 8000, true)).toBeGreaterThan(0);
    expect(crowdLevel(2200, segs, 8000, true)).toBe(0);
    // Sprint : public plus clairsemé.
    expect(crowdLevel(5250, segs, 8000, true)).toBeCloseTo(0.45, 5);
  });

  it('boucle : la zone d’arrivée est entendue avant le tour suivant', () => {
    const s: RouteSegment[] = [{ id: 'c', kind: 'kom', name: 'C', startM: 0, endM: 300, avgGrade: 5 }];
    expect(crowdLevel(7950, s, 8000, true)).toBeGreaterThan(0.5);
    // sans boucle, la zone du sommet n'est pas repliée (l'arche d'arrivée a sa foule à moins de 60 m de la fin)
    expect(crowdLevel(7500, s, 8000, false)).toBe(0);
  });

  it('foule autour des arches : départ de KOM, départ de sprint, arrivée', () => {
    const s: RouteSegment[] = [
      { id: 'c', kind: 'kom', name: 'C', startM: 2000, endM: 3000, avgGrade: 5 },
      { id: 'p', kind: 'sprint', name: 'P', startM: 5000, endM: 5300, avgGrade: 0 },
    ];
    expect(crowdLevel(2000, s, 8000, false)).toBeGreaterThan(0.5);
    expect(crowdLevel(5010, s, 8000, false)).toBeGreaterThan(0.5);
    expect(crowdLevel(7980, s, 8000, false)).toBeGreaterThan(0.5);
    expect(crowdLevel(1000, s, 8000, false)).toBe(0);
  });

  it('pousse plus quand le coureur souffre', () => {
    const easy = crowdActivity(1, 0.7);
    const hard = crowdActivity(1, 1.3);
    expect(hard.shouts).toBeGreaterThan(easy.shouts);
    expect(hard.claps).toBeGreaterThan(easy.claps);
    expect(crowdActivity(0, 1.3).bed).toBe(0);
    expect(crowdActivity(1, 1, false).cowbells).toBe(0);
    expect(crowdActivity(1, 1, true).cowbells).toBeGreaterThan(0);
  });
});

describe('trafic', () => {
  const listener = { x: 0, z: 0, vx: 0, vz: 8, heading: 0 }; // roule vers le sud à 8 m/s

  it('panoramique : en roulant vers le sud, l’ouest est à droite', () => {
    expect(panFor(-10, 0, 0)).toBeCloseTo(1, 5);
    expect(panFor(10, 0, 0)).toBeCloseTo(-1, 5);
    // Vers l'est (cap π/2) : le sud est à droite.
    expect(panFor(0, 10, Math.PI / 2)).toBeCloseTo(1, 5);
    expect(panFor(0, 10, 0)).toBeCloseTo(0, 5);
  });

  it('voiture qui double : plus aiguë en arrivant, plus grave en s’éloignant, forte au passage', () => {
    const behind = vehicleVoice({ id: 1, kind: 'car', x: 1.5, z: -30, vx: 0, vz: 17 }, listener);
    const beside = vehicleVoice({ id: 1, kind: 'car', x: 1.5, z: 0, vx: 0, vz: 17 }, listener);
    const ahead = vehicleVoice({ id: 1, kind: 'car', x: 1.5, z: 30, vx: 0, vz: 17 }, listener);
    expect(behind.doppler).toBeGreaterThan(1);
    expect(ahead.doppler).toBeLessThan(1);
    expect(beside.gain).toBeGreaterThan(behind.gain * 3);
    expect(beside.gain).toBeLessThanOrEqual(1);
    expect(beside.lowpass).toBeGreaterThan(behind.lowpass);
  });

  it('inaudible hors de portée', () => {
    expect(vehicleVoice({ id: 2, kind: 'tractor', x: 0, z: 400, vx: 0, vz: -7 }, listener).gain).toBe(0);
  });
});

describe('ambiances', () => {
  const base: AmbienceInput = { hour: 10, season: 'spring', night: 0, rain: 0, windMs: 3, forest: 0.2, urban: 0, open: 0.8 };

  it('oiseaux chanteurs : printemps oui, hiver non ; chœur de l’aube', () => {
    expect(ambienceMix(base).songbirds).toBeGreaterThan(5);
    expect(ambienceMix({ ...base, season: 'winter' }).songbirds).toBe(0);
    expect(ambienceMix({ ...base, season: 'winter' }).crows).toBeGreaterThan(ambienceMix(base).crows);
    expect(ambienceMix({ ...base, hour: 7.4 }).songbirds).toBeGreaterThan(ambienceMix({ ...base, hour: 13 }).songbirds * 1.8);
    expect(ambienceMix({ ...base, rain: 0.8 }).songbirds).toBe(0);
    expect(ambienceMix({ ...base, season: 'summer' }).skylark).toBeGreaterThan(0);
  });

  it('grillons le soir et la nuit en été, jamais l’hiver ni sous la pluie', () => {
    const summerNight = ambienceMix({ ...base, season: 'summer', hour: 22, night: 1 });
    const summerDay = ambienceMix({ ...base, season: 'summer' });
    expect(summerNight.crickets).toBeGreaterThan(summerDay.crickets * 3);
    expect(summerNight.songbirds).toBe(0);
    expect(ambienceMix({ ...base, season: 'winter', night: 1 }).crickets).toBe(0);
    expect(ambienceMix({ ...base, season: 'summer', night: 1, rain: 1 }).crickets).toBe(0);
  });

  it('forêt : feuillage dans le vent (moins l’hiver), hulotte la nuit', () => {
    const forest = { ...base, forest: 1, open: 0, windMs: 7 };
    expect(ambienceMix(forest).foliage).toBeGreaterThan(0.025);
    expect(ambienceMix({ ...forest, windMs: 0 }).foliage).toBe(0);
    expect(ambienceMix({ ...forest, season: 'winter' }).foliage).toBeLessThan(ambienceMix(forest).foliage * 0.5);
    expect(ambienceMix({ ...forest, night: 1, season: 'autumn' }).owl).toBeGreaterThan(0.3);
    expect(ambienceMix(forest).owl).toBe(0);
    expect(ambienceMix(forest).woodpecker).toBeGreaterThan(0);
  });

  it('village : rumeur plus forte le jour ; cloches pas la nuit ; vaches pas l’hiver', () => {
    const v = { ...base, urban: 1, open: 0 };
    expect(ambienceMix(v).village).toBeGreaterThan(ambienceMix({ ...v, night: 1 }).village);
    expect(ambienceMix({ ...base }).village).toBe(0);
    expect(ambienceMix({ ...base, hour: 23 }).bells).toBe(false);
    expect(ambienceMix(base).bells).toBe(true);
    expect(ambienceMix({ ...base, season: 'winter' }).cows).toBe(false);
  });

  it('pluie et vent liés à la météo', () => {
    expect(ambienceMix(base).rainHiss).toBe(0);
    expect(ambienceMix({ ...base, rain: 1 }).rainHiss).toBeGreaterThan(0.05);
    expect(ambienceMix({ ...base, rain: 1, forest: 1 }).rainLeaves).toBeGreaterThan(0);
    expect(ambienceMix({ ...base, windMs: 12 }).wind).toBeGreaterThan(ambienceMix({ ...base, windMs: 2 }).wind);
  });

  it('pas de NaN, gains bornés', () => {
    const m = ambienceMix({ hour: Number.NaN, season: 'summer', night: 2, rain: 3, windMs: 40, forest: 5, urban: 5, open: 5 });
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    const continuous = m.crickets + m.foliage + m.wind + m.village + m.rainHiss + m.rainDrops + m.rainLeaves;
    expect(continuous).toBeLessThan(0.5);
  });

  it('probabilité d’événement (Poisson)', () => {
    expect(eventChance(0, 1)).toBe(0);
    expect(eventChance(60, 1)).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(eventChance(6, 0.016)).toBeLessThan(0.002);
  });
});
