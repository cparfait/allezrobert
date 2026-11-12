/**
 * Géométries réelles de cadres (audit n° 3, étape E2.1).
 *
 * 1. Les valeurs de BIKE_GEOMETRIES sont comparées à la fiche du fabricant, recopiée en clair ici (indépendante du module).
 * 2. Unités : millimètres et degrés, plages plausibles (pas de mètres ni de radians glissés par erreur).
 * 3. Cohérence géométrique : les cotes publiées se recoupent (empattement, tube horizontal, axe avant, chasse).
 * 4. Identification : modèle du catalogue, millésime, taille ; données figées et sans cible du cycliste.
 */
import { describe, expect, it } from 'vitest';
import {
  BIKE_GEOMETRIES,
  BIKE_REFERENCE,
  bikeById,
  framePointMmToM,
  frontAxleMm,
  groundYMm,
  handlebarClampCenterMm,
  headTubeBottomMm,
  headTubeTopMm,
  mirroredPairMm,
  rearAxleMm,
  seatTubeAxisUp,
  seatTubePointAlongAxisMm,
  seatTubePointAtHeightMm,
  steererPointMm,
  steeringAxisUp,
  type BikeSizeGeometry,
  type FramePointMm,
} from '../src/index.ts';

// Specialized — 2020 Roubaix Sport, tableau « Géométries », colonne 54 (https://www.specialized.com/fr/fr/roubaix-sport/p/170245),
// cotes du cadre identiques dans la documentation de gamme 2020 (page « Roubaix Sport », tableau de géométrie).
const SOURCE_54 = {
  frame: {
    stackMm: 585, // Stack
    reachMm: 376, // Reach
    wheelbaseMm: 988, // Empattement
    chainstayMm: 415, // Longueur bases
    headTubeAngleDeg: 72.75, // Angle de direction
    seatTubeAngleDeg: 74, // Angle de tube de selle
    bbDropMm: 76, // B-B Drop
    bbHeightMm: 266, // Boîte de pédalier - sol
    headTubeLengthMm: 125, // Longueur de douille de direction
    seatTubeLengthMm: 465, // Longueur de tube de selle
    topTubeHorizontalMm: 545, // Longueur tube horizontal
    forkOffsetMm: 44, // Déport de fourche
    forkLengthMm: 370, // Longueur de fourche
    frontCenterMm: 585, // Boîte de pédalier – axe roue avant
  },
  parts: {
    crankLengthMm: 172.5, // Longueur manivelles
    handlebarWidthMm: 420, // Largeur de cintre
    stemLengthMm: 100, // Longueur de potence
  },
};
/** Chasse publiée pour la taille 54 (mm) : non enregistrée, sert au recoupement des angles et du déport. */
const SOURCE_TRAIL_54_MM = 61;

const deg = (a: number): number => (a * Math.PI) / 180;
const roubaix = BIKE_GEOMETRIES.find((m) => m.modelId === 'div-specialized-roubaix-sport-2020');
const size54 = roubaix?.sizes.find((s) => s.size === '54') as BikeSizeGeometry;

describe('géométrie réelle : Specialized Roubaix Sport 2020, taille 54', () => {
  it('modèle du catalogue, millésime 2020, une seule taille enregistrée (54)', () => {
    expect(BIKE_GEOMETRIES).toHaveLength(1);
    expect(roubaix).toBeDefined();
    const m = bikeById(roubaix?.modelId);
    expect(m?.name).toBe('Specialized Roubaix Sport 2020');
    expect(m?.year).toBe(2020);
    expect(m?.family).toBe('climb');
    expect(roubaix?.name).toBe(m?.name);
    expect(roubaix?.year).toBe(2020);
    expect(roubaix?.sizes.map((s) => s.size)).toEqual(['54']);
    expect(roubaix?.sources.some((s) => s.startsWith('https://www.specialized.com/') && s.includes('roubaix-sport'))).toBe(true);
  });

  it('valeurs exactes de la fiche du fabricant', () => {
    expect(size54.frame).toEqual(SOURCE_54.frame);
    expect(size54.parts).toEqual(SOURCE_54.parts);
  });

  it('seuls les champs prévus : cotes du cadre et pièces de série, sans cible du cycliste ni réglage', () => {
    expect(Object.keys(size54).sort()).toEqual(['frame', 'parts', 'size']);
    expect(Object.keys(size54.frame).sort()).toEqual(Object.keys(SOURCE_54.frame).sort());
    expect(Object.keys(size54.parts).sort()).toEqual(Object.keys(SOURCE_54.parts).sort());
    expect(Object.keys(roubaix ?? {}).sort()).toEqual(['modelId', 'name', 'sizes', 'sources', 'year']);
  });

  it('unités : millimètres (…Mm) et degrés (…Deg), plages plausibles', () => {
    for (const [k, v] of Object.entries({ ...size54.frame, ...size54.parts })) {
      expect(k, k).toMatch(/(Mm|Deg)$/);
      expect(Number.isFinite(v), k).toBe(true);
      if (k.endsWith('Deg')) {
        expect(v, `${k} (degrés, pas radians)`).toBeGreaterThan(60);
        expect(v, k).toBeLessThan(80);
      } else {
        expect(v, `${k} (millimètres, pas mètres)`).toBeGreaterThan(40);
        expect(v, k).toBeLessThan(1200);
      }
    }
  });

  it('cohérence : hauteur du boîtier + chute = rayon de roue avec les pneus de série (700 × 28)', () => {
    // La chute se mesure sous la ligne des axes : axes = boîtier + chute = rayon de la roue.
    const r = size54.frame.bbHeightMm + size54.frame.bbDropMm;
    expect(r).toBe(342);
    expect(r).toBeGreaterThan(335);
    expect(r).toBeLessThan(350);
  });

  it('cohérence : empattement = projections horizontales des bases et de l\'avant (± 1 mm)', () => {
    const f = size54.frame;
    const rear = Math.sqrt(f.chainstayMm ** 2 - f.bbDropMm ** 2);
    const front = Math.sqrt(f.frontCenterMm ** 2 - f.bbDropMm ** 2);
    expect(Math.abs(rear + front - f.wheelbaseMm)).toBeLessThan(1);
  });

  it('cohérence : tube horizontal ≈ reach + stack / tan(angle du tube de selle) (± 2 mm)', () => {
    const f = size54.frame;
    expect(Math.abs(f.reachMm + f.stackMm / Math.tan(deg(f.seatTubeAngleDeg)) - f.topTubeHorizontalMm)).toBeLessThan(2);
  });

  it('cohérence : axe avant retrouvé par la direction (reach, stack, angle, déport) ≈ avant publié (± 2 mm)', () => {
    const f = size54.frame;
    const a = deg(f.headTubeAngleDeg);
    // Axe de direction suivi depuis le haut de la douille jusqu'à la hauteur des axes, puis déport perpendiculaire.
    const viaSteering = f.reachMm + (f.stackMm - f.bbDropMm) / Math.tan(a) + f.forkOffsetMm / Math.sin(a);
    const published = Math.sqrt(f.frontCenterMm ** 2 - f.bbDropMm ** 2);
    expect(Math.abs(viaSteering - published)).toBeLessThan(2);
  });

  it('cohérence : chasse calculée (angle, déport, rayon de roue) ≈ chasse publiée (± 2 mm)', () => {
    const f = size54.frame;
    const a = deg(f.headTubeAngleDeg);
    const trail = ((f.bbHeightMm + f.bbDropMm) * Math.cos(a) - f.forkOffsetMm) / Math.sin(a);
    expect(Math.abs(trail - SOURCE_TRAIL_54_MM)).toBeLessThan(2);
  });

  it('cohérence : la fourche et la douille tiennent entre l\'axe avant et le haut de la douille (jeu de direction de 0 à 30 mm)', () => {
    const f = size54.frame;
    const a = deg(f.headTubeAngleDeg);
    const headTubeBottom = f.stackMm - f.headTubeLengthMm * Math.sin(a); // au-dessus du boîtier
    const forkHeight = f.forkLengthMm * Math.sin(a) + f.forkOffsetMm * Math.cos(a); // axe → couronne
    const headset = headTubeBottom - f.bbDropMm - forkHeight;
    expect(headset).toBeGreaterThan(0);
    expect(headset).toBeLessThan(30);
  });

  it('manivelle de série = manivelle du vélo de référence (constat, pas un couplage)', () => {
    expect(size54.parts.crankLengthMm / 1000).toBeCloseTo(BIKE_REFERENCE.crankLengthM, 12);
  });

  it('données figées (non modifiables à l\'exécution)', () => {
    expect(Object.isFrozen(BIKE_GEOMETRIES)).toBe(true);
    expect(Object.isFrozen(roubaix)).toBe(true);
    expect(Object.isFrozen(roubaix?.sources)).toBe(true);
    expect(Object.isFrozen(roubaix?.sizes)).toBe(true);
    expect(Object.isFrozen(size54)).toBe(true);
    expect(Object.isFrozen(size54.frame)).toBe(true);
    expect(Object.isFrozen(size54.parts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Points de référence du cadre (E2.2) : repère du cadre, origine au centre du boîtier, +x gauche, +y haut, +z avant, mm.
// ---------------------------------------------------------------------------------------------

const near = (a: FramePointMm | readonly number[], b: readonly number[], tol: number, msg = ''): void => {
  expect(a.length, msg).toBe(b.length);
  a.forEach((v, i) => expect(Math.abs(v - (b[i] as number)), `${msg} [${i}] ${v} ≠ ${b[i]}`).toBeLessThanOrEqual(tol));
};
const len = (p: readonly number[]): number => Math.hypot(...p);
type V3 = readonly [number, number, number];
const diff = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('points de référence du cadre : Roubaix Sport 2020, taille 54', () => {
  const f = size54.frame;

  it('haut de la douille = (0, stack, reach) = (0, 585, 376) mm', () => {
    expect(headTubeTopMm(f)).toEqual([0, 585, 376]);
  });

  it('bas de la douille : à 125 mm du haut le long de l\'axe de direction (72,75°), en dessous et devant', () => {
    const top = headTubeTopMm(f), bot = headTubeBottomMm(f);
    expect(len(diff(top, bot))).toBeCloseTo(125, 9);
    const d = diff(top, bot);
    expect((Math.atan2(d[1] as number, -(d[2] as number)) * 180) / Math.PI).toBeCloseTo(72.75, 9);
    expect(bot[1]).toBeLessThan(top[1]);
    expect(bot[2]).toBeGreaterThan(top[2]);
    near(bot, [0, 585 - 125 * Math.sin(deg(72.75)), 376 + 125 * Math.cos(deg(72.75))], 1e-9, 'bas de douille');
    near(bot, [0, 465.62, 413.07], 0.01, 'bas de douille (valeurs arrondies)');
  });

  it('axe de direction : unitaire, montant vers l\'arrière', () => {
    const u = steeringAxisUp(f);
    expect(len(u)).toBeCloseTo(1, 12);
    expect(u[0]).toBe(0);
    expect(u[1]).toBeGreaterThan(0);
    expect(u[2]).toBeLessThan(0);
  });

  it('axes des roues : à la hauteur de la chute, empattement retrouvé (± 1 mm), sol à −266 mm', () => {
    const fa = frontAxleMm(f), ra = rearAxleMm(f);
    near(fa, [0, 76, 580.04], 0.01, 'axe avant');
    near(ra, [0, 76, -407.98], 0.01, 'axe arrière');
    expect(len(fa)).toBeCloseTo(585, 9);
    expect(len(ra)).toBeCloseTo(415, 9);
    expect(Math.abs((fa[2] - ra[2]) - f.wheelbaseMm)).toBeLessThan(1);
    expect(groundYMm(f)).toBe(-266);
    expect(fa[1] - groundYMm(f)).toBe(342); // rayon de roue : axes au-dessus du sol
  });

  it('axe du tube de selle : unitaire, monte vers l\'arrière (74°)', () => {
    const u = seatTubeAxisUp(f);
    expect(len(u)).toBeCloseTo(1, 12);
    expect(u[1]).toBeGreaterThan(0);
    expect(u[2]).toBeLessThan(0);
    expect((Math.atan2(u[1], -u[2]) * 180) / Math.PI).toBeCloseTo(74, 9);
  });

  it('point de l\'axe de selle à une distance donnée le long de l\'axe (hauteurs d\'essai fournies en paramètres)', () => {
    expect(seatTubePointAlongAxisMm(f, 0)).toEqual([0, 0, 0]);
    let prev: FramePointMm = [0, 0, 0];
    for (const along of [600, 650, 700, 750, 800]) {
      const p = seatTubePointAlongAxisMm(f, along);
      expect(len(p), `${along}`).toBeCloseTo(along, 9);
      near(p, [0, along * Math.sin(deg(74)), -along * Math.cos(deg(74))], 1e-9, `${along}`);
      expect(p[1]).toBeGreaterThan(prev[1]); // plus haut…
      expect(p[2]).toBeLessThan(prev[2]); // …et plus en arrière
      prev = p;
    }
  });

  it('point de l\'axe de selle à une hauteur verticale donnée : y exact, cohérent avec la mesure le long de l\'axe', () => {
    for (const h of [600, 690, 720]) {
      const p = seatTubePointAtHeightMm(f, h);
      expect(p[1]).toBeCloseTo(h, 9);
      expect(p[2]).toBeCloseTo(-h / Math.tan(deg(74)), 9);
      near(p, seatTubePointAlongAxisMm(f, h / Math.sin(deg(74))), 1e-9, `${h}`);
    }
  });

  it('pivot : au haut de la douille à 0 mm, puis le long de l\'axe de direction', () => {
    expect(steererPointMm(f, 0)).toEqual(headTubeTopMm(f));
    const p = steererPointMm(f, 30);
    expect(len(diff(p, headTubeTopMm(f)))).toBeCloseTo(30, 9);
    near(diff(p, headTubeTopMm(f)), steeringAxisUp(f).map((v) => v * 30), 1e-9, 'direction');
  });

  it('collier de cintre (paramètres d\'essai explicites) : potence perpendiculaire au pivot sans montée, montée vers le haut sinon', () => {
    // Valeurs d'essai fournies au calcul, pas des cotes du vélo : aucune n'est enregistrée dans les données.
    const base = { steererOffsetMm: 20, stemLengthMm: 100 };
    const s = steererPointMm(f, 20);
    const flat = handlebarClampCenterMm(f, { ...base, stemRiseDeg: 0 });
    const d0 = diff(flat, s);
    expect(len(d0)).toBeCloseTo(100, 9);
    const u = steeringAxisUp(f);
    expect(d0[0] * u[0] + d0[1] * u[1] + d0[2] * u[2]).toBeCloseTo(0, 9); // perpendiculaire au pivot
    expect(d0[2]).toBeGreaterThan(0); // vers l'avant
    const up = handlebarClampCenterMm(f, { ...base, stemRiseDeg: 7 });
    const down = handlebarClampCenterMm(f, { ...base, stemRiseDeg: -7 });
    expect(up[1]).toBeGreaterThan(flat[1]);
    expect(down[1]).toBeLessThan(flat[1]);
    expect(len(diff(up, s))).toBeCloseTo(100, 9);
    // Angle entre les potences montée et descendue = 14°.
    const a = diff(up, s), b = diff(down, s);
    expect((Math.acos((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b))) * 180) / Math.PI).toBeCloseTo(14, 9);
  });

  it('points latéraux symétriques (écartement fourni) : gauche à +x, droite à −x', () => {
    const c = handlebarClampCenterMm(f, { steererOffsetMm: 20, stemLengthMm: 100, stemRiseDeg: 7 });
    const { L, R } = mirroredPairMm(c, 210);
    expect(L[0]).toBe(210);
    expect(R[0]).toBe(-210);
    expect([L[1], L[2]]).toEqual([R[1], R[2]]);
    expect([L[1], L[2]]).toEqual([c[1], c[2]]);
  });

  it('points du cadre dans le plan médian (x = 0)', () => {
    for (const p of [headTubeTopMm(f), headTubeBottomMm(f), frontAxleMm(f), rearAxleMm(f), seatTubePointAlongAxisMm(f, 700), steererPointMm(f, 25)]) expect(p[0]).toBe(0);
  });

  it('conversion explicite millimètres → mètres', () => {
    near(framePointMmToM(headTubeTopMm(f)), [0, 0.585, 0.376], 1e-12, 'haut de douille (m)');
    near(framePointMmToM(frontAxleMm(f)), [0, 0.076, 0.58004], 1e-5, 'axe avant (m)');
    const p = seatTubePointAlongAxisMm(f, 720);
    near(framePointMmToM(p), p.map((v) => v / 1000), 1e-15, 'axe de selle (m)');
    // Dans le repère du jeu (origine au sol à l'aplomb du boîtier), il faut AJOUTER la hauteur du boîtier : non fait ici.
    expect(framePointMmToM(headTubeTopMm(f))[1]).not.toBeCloseTo(0.585 + BIKE_REFERENCE.bottomBracket[1], 6);
  });

  it('paramètres invalides : erreurs explicites', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => seatTubePointAlongAxisMm(f, bad), `along ${bad}`).toThrow(RangeError);
      expect(() => seatTubePointAtHeightMm(f, bad), `height ${bad}`).toThrow(RangeError);
      expect(() => steererPointMm(f, bad), `steerer ${bad}`).toThrow(RangeError);
      expect(() => mirroredPairMm([0, 0, 0], bad), `pair ${bad}`).toThrow(RangeError);
    }
    expect(() => handlebarClampCenterMm(f, undefined as never)).toThrow(RangeError);
    expect(() => handlebarClampCenterMm(f, {} as never)).toThrow(RangeError);
    expect(() => handlebarClampCenterMm(f, { steererOffsetMm: 20, stemLengthMm: 100 } as never)).toThrow(RangeError);
    expect(() => handlebarClampCenterMm(f, { steererOffsetMm: 20, stemLengthMm: 0, stemRiseDeg: 7 })).toThrow(RangeError);
    expect(() => handlebarClampCenterMm(f, { steererOffsetMm: 20, stemLengthMm: 100, stemRiseDeg: 60 })).toThrow(RangeError);
    expect(() => handlebarClampCenterMm(f, { steererOffsetMm: -5, stemLengthMm: 100, stemRiseDeg: 7 })).toThrow(RangeError);
  });

  it('aucune coordonnée inventée : les données n\'enregistrent ni selle, ni cocottes, ni mains, ni potence montée', () => {
    // Toutes les clés des données, à tous les niveaux : uniquement les champs prévus (aucun point ni composant non documenté).
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); }
    };
    walk(BIKE_GEOMETRIES);
    const allowed = ['modelId', 'name', 'year', 'sources', 'sizes', 'size', 'frame', 'parts', ...Object.keys(SOURCE_54.frame), ...Object.keys(SOURCE_54.parts)];
    expect([...keys].sort()).toEqual([...new Set(allowed)].sort());
    expect(roubaix?.sizes).toHaveLength(1);
    // Les 17 valeurs officielles d'E2.1 sont inchangées.
    expect(size54.frame).toEqual(SOURCE_54.frame);
    expect(size54.parts).toEqual(SOURCE_54.parts);
  });

  it('calculs déterministes, résultats figés et données d\'entrée non modifiées', () => {
    const before = JSON.stringify(size54);
    const run = (): unknown => [headTubeTopMm(f), headTubeBottomMm(f), frontAxleMm(f), rearAxleMm(f), seatTubePointAlongAxisMm(f, 712.5), seatTubePointAtHeightMm(f, 690), steererPointMm(f, 22), handlebarClampCenterMm(f, { steererOffsetMm: 22, stemLengthMm: 100, stemRiseDeg: 7 })];
    expect(run()).toEqual(run());
    for (const p of run() as FramePointMm[]) expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(mirroredPairMm([0, 1, 2], 3))).toBe(true);
    expect(JSON.stringify(size54)).toBe(before);
  });
});
