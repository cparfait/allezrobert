import { describe, expect, it } from 'vitest';
import {
  ALL_TUNE_SLOTS,
  COSMETICS,
  DEFAULT_LOOK,
  MAX_CREDITS_PER_RIDE,
  RARITY_LABEL,
  TUNE_EVENTS,
  TUNE_FAMILIES,
  TUNE_ITEMS,
  TUNE_KITS,
  TUNE_RARITIES,
  TUNE_SLOTS,
  applyTuneLook,
  bikeById,
  bikeOfLook,
  creditsForRide,
  equippedTuneIds,
  eventRewards,
  kitPrice,
  kitProgress,
  nextStreak,
  purchase,
  rideEvents,
  tuneItem,
  validateTuneEquipped,
} from '../src/index.ts';

const HEX = /^#[0-9a-f]{6}$/i;

describe('catalogue de l’atelier', () => {
  it('107 pièces réparties 32 / 25 / 15 / 15 / 10 / 10', () => {
    expect(TUNE_ITEMS).toHaveLength(107);
    const count = (f: string) => TUNE_ITEMS.filter((t) => t.family === f).length;
    expect(TUNE_FAMILIES.map(count)).toEqual([32, 25, 15, 15, 10, 10]);
  });

  it('identifiants uniques, sans collision avec les cosmétiques', () => {
    const ids = TUNE_ITEMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]{1,48}$/);
      expect(COSMETICS.some((c) => c.id === id), id).toBe(false);
    }
  });

  it('raretés, prix, déblocages, textes et emplacements valides', () => {
    for (const t of TUNE_ITEMS) {
      expect(TUNE_RARITIES, t.id).toContain(t.rarity);
      expect(RARITY_LABEL[t.rarity].fr.length).toBeGreaterThan(0);
      expect(t.name.fr && t.name.en && t.desc.fr && t.desc.en && t.effect.fr && t.effect.en, t.id).toBeTruthy();
      expect(Number.isInteger(t.price) && t.price >= 0, t.id).toBe(true);
      const u = t.unlock;
      if ('level' in u) expect(u.level >= 1 && u.level <= 50, t.id).toBe(true);
      if ('event' in u) {
        expect(TUNE_EVENTS).toContain(u.event);
        expect(t.price, `${t.id} : une récompense ne s’achète pas`).toBe(0);
        expect(t.family).toBe('event');
      }
      if ('kit' in u) expect(tuneItem(u.kit)?.family, t.id).toBe('kit');
      if (t.family === 'kit') {
        expect(t.slot).toBeUndefined();
        expect('level' in u).toBe(true);
      } else {
        expect(ALL_TUNE_SLOTS, t.id).toContain(t.slot);
        if (t.family !== 'event') expect(TUNE_SLOTS[t.family as keyof typeof TUNE_SLOTS], t.id).toContain(t.slot);
        if (t.family !== 'event' && !('kit' in u)) expect(t.price, t.id).toBeGreaterThan(0);
      }
    }
    // Chaque événement récompense au moins une pièce.
    for (const e of TUNE_EVENTS) expect(eventRewards([e]).length, e).toBeGreaterThan(0);
  });

  it('les ensembles référencent des pièces existantes (pas d’ensemble dans un ensemble), 4 à 6 pièces', () => {
    expect(TUNE_KITS.length).toBeGreaterThanOrEqual(10);
    for (const k of TUNE_KITS) {
      const pieces = k.pieces ?? [];
      expect(pieces.length, k.id).toBeGreaterThanOrEqual(4);
      expect(pieces.length, k.id).toBeLessThanOrEqual(6);
      expect(new Set(pieces).size).toBe(pieces.length);
      const slots = new Set<string>();
      for (const id of pieces) {
        const p = tuneItem(id);
        expect(p, `${k.id} → ${id}`).toBeDefined();
        expect(p?.family).not.toBe('kit');
        // Une pièce par emplacement : l’ensemble s’équipe d’un coup.
        expect(slots.has(p?.slot as string), `${k.id} : deux pièces ${p?.slot}`).toBe(false);
        slots.add(p?.slot as string);
      }
      expect(k.title?.fr && k.badge && HEX.test(k.badge), k.id).toBeTruthy();
      expect(kitPrice(k)).toBeGreaterThan(0);
    }
    // Les pièces réservées à un ensemble y figurent bien.
    for (const t of TUNE_ITEMS) if ('kit' in t.unlock) expect(tuneItem(t.unlock.kit)?.pieces, t.id).toContain(t.id);
  });

  it('chaque pièce visible change le vélo assemblé', () => {
    const base = bikeById('s26-01-uae-y1rs');
    expect(base).toBeDefined();
    for (const t of TUNE_ITEMS) {
      if (t.family === 'kit' || !t.look) continue;
      const tuned = applyTuneLook(base!, [t.id]);
      expect(JSON.stringify(tuned), t.id).not.toBe(JSON.stringify(base));
      for (const c of Object.values(t.look.parts ?? {})) expect(c, t.id).toMatch(HEX);
    }
    // Pièces sans rendu possible : la tige de selle (fondue dans le cadre) seulement.
    expect(TUNE_ITEMS.filter((t) => t.family !== 'kit' && !t.look).map((t) => t.id)).toEqual([]);
  });
});

describe('rendu des pièces', () => {
  it('roues, peinture, vernis et inscriptions de marque conservées', () => {
    const base = bikeById('s26-01-uae-y1rs')!;
    const b = applyTuneLook(base, ['tune-wh-enve-67', 'tune-pa-shadow', 'tune-fi-irise', 'tune-st-robert', 'tune-nu-13', 'tune-gl-magenta']);
    expect(b.params.wheels).toEqual(['c65', 'c65']);
    expect(b.params.rimBrand).toBe('enve');
    expect(b.livery.colors[0]).toBe('#111214');
    expect(b.livery.finish).toBe('iridescent');
    expect(b.livery.marks?.tt?.text).toBe('ALLEZ ROBERT !');
    expect(b.livery.marks?.dt?.color).toBe('#c1121f');
    expect(b.extras?.number?.flip).toBe(true);
    expect(b.extras?.glow).toBe('#ff2bd6');
    // Le modèle du catalogue n’est pas modifié.
    expect(base.params.wheels).not.toEqual(['c65', 'c65']);
  });
  it('bikeOfLook applique look.tune', () => {
    const b = bikeOfLook({ ...DEFAULT_LOOK, tune: ['tune-ty-corsa-gum', 'tune-tp-cuir'] });
    expect(b.livery.tireWall).toBe('#c8a36a');
    expect(b.livery.tape).toBe('#8a5a2b');
    expect(bikeOfLook({ ...DEFAULT_LOOK, tune: ['inconnu'] }).livery).toEqual({ colors: [DEFAULT_LOOK.bike], pattern: 'solid' });
  });
  it('équipement : une pièce par emplacement, dans l’ordre des emplacements', () => {
    expect(equippedTuneIds({ paint: 'tune-pa-chrome', wheelset: 'tune-wh-zipp-303', tyres: 'tune-wh-zipp-303', jersey: 'x' })).toEqual(['tune-wh-zipp-303', 'tune-pa-chrome']);
  });
});

describe('économie', () => {
  it('achat : niveau, crédits manquants, récompenses et pièces d’ensemble non achetables', () => {
    expect(purchase('tune-wh-zipp-303', { level: 10, credits: 1000, owned: [] })).toMatchObject({ ok: true, price: 900, granted: ['tune-wh-zipp-303'] });
    expect(purchase('tune-wh-zipp-303', { level: 10, credits: 500, owned: [] })).toMatchObject({ ok: false, error: 'credits', missing: 400 });
    expect(purchase('tune-wh-zipp-303', { level: 3, credits: 5000, owned: [] }).error).toBe('level');
    expect(purchase('tune-wh-zipp-303', { level: 10, credits: 5000, owned: ['tune-wh-zipp-303'] }).error).toBe('owned');
    expect(purchase('tune-ev-win', { level: 50, credits: 99999, owned: [] }).error).toBe('event');
    expect(purchase('tune-pa-shadow', { level: 50, credits: 99999, owned: [] }).error).toBe('kit');
    expect(purchase('nimporte-quoi', { level: 50, credits: 99999, owned: [] }).error).toBe('unknown');
  });
  it('ensemble : prix des pièces manquantes, pièces accordées, avancement', () => {
    const kit = tuneItem('kit-shadow-pro')!;
    const full = kitPrice(kit);
    const part = kitPrice(kit, ['tune-wh-enve-67']);
    expect(part).toBeLessThan(full);
    const r = purchase(kit.id, { level: 20, credits: 99999, owned: ['tune-wh-enve-67'] });
    expect(r.ok).toBe(true);
    expect(r.price).toBe(part);
    expect(r.granted).not.toContain('tune-wh-enve-67');
    expect(kitProgress(kit, ['tune-wh-enve-67', ...r.granted])).toEqual({ have: 6, total: 6, complete: true });
    // L’ensemble Champion contient une récompense : on ne l’achète pas, on la gagne.
    const champ = tuneItem('kit-champion')!;
    const c = purchase(champ.id, { level: 50, credits: 99999, owned: [] });
    expect(c.granted).not.toContain('tune-ev-win');
    expect(kitProgress(champ, c.granted)).toMatchObject({ have: 4, total: 5, complete: false });
  });
  it('équipement validé : possédé et au bon emplacement', () => {
    expect(validateTuneEquipped({ wheelset: 'tune-wh-zipp-303' }, ['tune-wh-zipp-303'])).toBeNull();
    expect(validateTuneEquipped({ wheelset: 'tune-wh-zipp-303' }, [])).toMatch(/atelier/);
    expect(validateTuneEquipped({ tyres: 'tune-wh-zipp-303' }, ['tune-wh-zipp-303'])).toMatch(/emplacement/);
    expect(validateTuneEquipped({ jersey: 'jersey-pois' }, [])).toBeNull();
  });
  it('crédits par sortie (distance, D+, segments, série) et plafond', () => {
    expect(creditsForRide({ distanceM: 30000, elevationM: 300, segments: 2 })).toBe(30 + 15 + 20);
    expect(creditsForRide({ distanceM: 30000, elevationM: 300, segments: 2, streakDays: 3, firstOfDay: true })).toBe(80);
    expect(creditsForRide({ distanceM: 30000, elevationM: 0, streakDays: 30, firstOfDay: true })).toBe(30 + 35);
    expect(creditsForRide({ distanceM: 30000, elevationM: 0, streakDays: 3, firstOfDay: false })).toBe(30);
    expect(creditsForRide({ distanceM: 1e6, elevationM: 1e5, segments: 50 })).toBe(MAX_CREDITS_PER_RIDE);
  });
  it('série de jours et événements', () => {
    expect(nextStreak(undefined, '2026-10-22')).toEqual({ last: '2026-10-22', days: 1, firstOfDay: true });
    expect(nextStreak({ last: '2026-10-21', days: 6 }, '2026-10-22')).toMatchObject({ days: 7, firstOfDay: true });
    expect(nextStreak({ last: '2026-10-22', days: 6 }, '2026-10-22')).toMatchObject({ days: 6, firstOfDay: false });
    expect(nextStreak({ last: '2026-10-19', days: 6 }, '2026-10-22')).toMatchObject({ days: 1 });
    expect(rideEvents({ distanceM: 101000, routeFinished: true, koms: 1, raceRank: 1, streakDays: 7 }).sort()).toEqual(['century', 'kom', 'podium', 'route-finish', 'streak-3', 'streak-7', 'win']);
  });
});
