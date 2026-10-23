import { describe, expect, it } from 'vitest';
import { BIKES, DEFAULT_BIKE, TUNE_ITEMS, TUNE_KITS, TUNE_SLOTS, bikeSetupFor, tuneItem, type TuneItem } from '@allezrobert/shared';
import { TUNE_BONUS_CAP, TUNE_REFERENCE, bikeStats, paramsFromBike, powerForSpeed, steadyStateSpeed, tuneGains, tunedBikeSetup } from '../src/index.ts';

/** Écart toléré entre le gain annoncé au catalogue et la physique (points de %). */
const TOL = 0.35;
const pct = (v: number) => v * 100;

describe('calibration des pièces de l’atelier', () => {
  it('conditions de référence : 40 km/h à plat, 8 % à 3,5 W/kg (75 kg)', () => {
    const p = paramsFromBike(TUNE_REFERENCE.riderKg, DEFAULT_BIKE);
    // Plat : ≈ 320 W pour 40 km/h ; côte : ≈ 12,8 km/h à 262,5 W.
    expect(powerForSpeed(40 / 3.6, 0, p)).toBeGreaterThan(300);
    expect(powerForSpeed(40 / 3.6, 0, p)).toBeLessThan(340);
    expect(steadyStateSpeed(3.5 * 75, 8, p) * 3.6).toBeGreaterThan(12);
    expect(steadyStateSpeed(3.5 * 75, 8, p) * 3.6).toBeLessThan(13.5);
  });

  it('chaque gain annoncé correspond à la physique', () => {
    for (const it of TUNE_ITEMS) {
      if (!it.perf) continue;
      const g = tunedBikeSetup(DEFAULT_BIKE, [it.id]).raw;
      const b = it.bonus ?? {};
      expect(Math.abs(pct(g.flat) - (b.flat ?? 0)), `${it.id} plat ${pct(g.flat).toFixed(2)} %`).toBeLessThan(b.flat ? TOL : 1);
      expect(Math.abs(pct(g.climb) - (b.climb ?? 0)), `${it.id} côte ${pct(g.climb).toFixed(2)} %`).toBeLessThan(b.climb ? TOL : 1);
    }
  });

  it('valeurs cibles : roues aéro +3 % à plat, roues légères réalistes en côte (300 à 500 g, +0,5 à 1 %), pneus +1 %, cockpit +1 %, transmission +1 %', () => {
    const g = (id: string) => tunedBikeSetup(DEFAULT_BIKE, [id]).raw;
    expect(pct(g('tune-wh-enve-67').flat)).toBeCloseTo(3, 0);
    expect(pct(g('tune-wh-enve-34').climb)).toBeGreaterThan(0.5);
    expect(pct(g('tune-wh-enve-34').climb)).toBeLessThan(1);
    for (const id of ['tune-wh-enve-34', 'tune-wh-zipp-303']) {
      const kg = tuneItem(id)?.perf?.massKg ?? 0;
      expect(kg, id).toBeGreaterThanOrEqual(-0.5);
      expect(kg, id).toBeLessThanOrEqual(-0.3);
    }
    expect(pct(g('tune-ty-gp5000').flat)).toBeCloseTo(1, 0);
    expect(pct(g('tune-ck-aero').flat)).toBeCloseTo(1, 0);
    expect(pct(g('tune-gs-duraace').flat)).toBeCloseTo(1, 0);
    expect(pct(g('tune-gs-duraace').climb)).toBeCloseTo(1, 0);
    // Cockpit aéro : utile à haute vitesse, quasi nul en côte.
    expect(pct(g('tune-ck-aero').climb)).toBeLessThan(0.1);
  });

  it('selles, accessoires et décors : style uniquement, aucun effet physique', () => {
    const styleSlots = new Set([...TUNE_SLOTS.paint, ...TUNE_SLOTS.wheelfx, ...TUNE_SLOTS.accessory, 'saddle', 'seatpost', 'rotors']);
    for (const it of TUNE_ITEMS) {
      if (!it.slot || !styleSlots.has(it.slot)) continue;
      expect(it.perf, it.id).toBeUndefined();
      expect(it.effect.fr, it.id).toBe('Style uniquement');
      const t = tunedBikeSetup(DEFAULT_BIKE, [it.id]);
      expect(t.bike).toEqual(DEFAULT_BIKE);
    }
  });
});

describe('plafond des bonus', () => {
  /** Meilleure pièce de chaque emplacement pour un critère. */
  const bestOf = (key: 'flat' | 'climb'): string[] =>
    TUNE_SLOTS.tech.map((slot) => {
      const items = TUNE_ITEMS.filter((t) => t.slot === slot && t.perf);
      items.sort((a, b) => tunedBikeSetup(DEFAULT_BIKE, [b.id]).raw[key] - tunedBikeSetup(DEFAULT_BIKE, [a.id]).raw[key]);
      return items[0]?.id;
    }).filter((x): x is string => !!x);

  it('le meilleur montage plat plafonne à 5 % ; le meilleur montage côte reste en dessous', () => {
    const flat = tunedBikeSetup(DEFAULT_BIKE, bestOf('flat'));
    expect(flat.raw.flat).toBeGreaterThan(TUNE_BONUS_CAP);
    expect(flat.scale).toBeLessThan(1);
    expect(Math.max(flat.gains.flat, flat.gains.climb)).toBeLessThanOrEqual(TUNE_BONUS_CAP + 1e-9);
    expect(Math.max(flat.gains.flat, flat.gains.climb)).toBeGreaterThan(TUNE_BONUS_CAP - 1e-4);
    // Roues légères réalistes : en côte, le gain vient surtout de la transmission et des pneus.
    const climb = tunedBikeSetup(DEFAULT_BIKE, bestOf('climb'));
    expect(climb.gains.climb).toBeLessThanOrEqual(TUNE_BONUS_CAP + 1e-9);
    expect(climb.gains.climb).toBeGreaterThan(0.02);
  });

  it('aucune combinaison d’une pièce par emplacement ne dépasse le plafond (sur tous les vélos du catalogue)', () => {
    // Toutes les combinaisons roues × pneus × cockpit × transmission (+ autres pièces à effet).
    const bySlot = (slot: string) => TUNE_ITEMS.filter((t) => t.slot === slot && t.perf).map((t) => t.id);
    const extra = ['tune-cr-carbon', 'tune-cs-light', 'tune-pu-ospw'];
    const frames = [DEFAULT_BIKE, ...BIKES.filter((_, i) => i % 9 === 0).map((b) => bikeSetupFor({ bike: b.id }))];
    for (const base of frames)
      for (const w of bySlot('wheelset'))
        for (const ty of bySlot('tyres'))
          for (const ck of bySlot('cockpit'))
            for (const gs of bySlot('groupset')) {
              const t = tunedBikeSetup(base, [w, ty, ck, gs, ...extra]);
              expect(Math.max(t.gains.flat, t.gains.climb)).toBeLessThanOrEqual(TUNE_BONUS_CAP + 1e-9);
            }
  });

  it('ensembles : aucune performance en plus de leurs pièces', () => {
    for (const k of TUNE_KITS) {
      const pieces = (k.pieces ?? []).map((id) => tuneItem(id)).filter((p): p is TuneItem => !!p);
      const withKit = tunedBikeSetup(DEFAULT_BIKE, [k.id, ...pieces.map((p) => p.id)]);
      const without = tunedBikeSetup(DEFAULT_BIKE, pieces.map((p) => p.id));
      expect(withKit.bike).toEqual(without.bike);
      expect(k.perf).toBeUndefined();
    }
  });

  it('une seule pièce par emplacement est comptée', () => {
    const a = tunedBikeSetup(DEFAULT_BIKE, ['tune-wh-enve-67', 'tune-wh-enve-34']);
    const b = tunedBikeSetup(DEFAULT_BIKE, ['tune-wh-enve-67']);
    expect(a.bike).toEqual(b.bike);
    expect(tunedBikeSetup(DEFAULT_BIKE, ['inconnu']).bike).toEqual(DEFAULT_BIKE);
  });
});

describe('chiffres de l’atelier', () => {
  it('vitesses à plat et montée de référence', () => {
    const s0 = bikeStats(DEFAULT_BIKE, 75, 250);
    const s1 = bikeStats(tunedBikeSetup(DEFAULT_BIKE, ['tune-wh-enve-67', 'tune-ty-gp5000']).bike, 75, 250);
    expect(s0.flat75Kmh).toBeLessThan(s0.flatFtpKmh);
    expect(s1.flatFtpKmh).toBeGreaterThan(s0.flatFtpKmh);
    // 5 km à 7 % à 250 W / 75 kg : ≈ 22 min.
    expect(s0.climbS / 60).toBeGreaterThan(18);
    expect(s0.climbS / 60).toBeLessThan(26);
    const light = bikeStats(tunedBikeSetup(DEFAULT_BIKE, ['tune-wh-enve-34']).bike, 75, 250);
    expect(light.climbS).toBeLessThan(s0.climbS);
  });
  it('gains nuls entre deux vélos identiques', () => {
    expect(tuneGains(DEFAULT_BIKE, DEFAULT_BIKE)).toEqual({ flat: 0, climb: 0 });
  });
});
