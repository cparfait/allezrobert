/**
 * Monde ouvert côté jeu : repères après un demi-tour, interpolation à la bascule de sens, volume de la voix
 * selon la distance, libellés du menu, choix de l'appareil audio.
 */
import { describe, expect, it, vi } from 'vitest';

// i18n lit localStorage dès son import : un stockage vide suffit pour ce test.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage ??= { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
});
import type { RiderSnapshot, WorldSnapshotMsg } from '@allezrobert/shared';
import { SnapshotBuffer } from '../src/net/interpolation.ts';
import { frameAfterTurn, gapAlongRoute, toRouteFrame } from '../src/net/frame.ts';
import { proximityGain, riderOfIdentity } from '../src/game/voice.ts';
import { friendsLabel, ridersLabel, zoneOfRoute } from '../src/ui/openWorldLabels.ts';
import { applySink, canChooseOutput, getAudioDevices, onAudioDevices, setAudioDevices } from '../src/audio/devices.ts';

const L = 3581.62;

function rider(patch: Partial<RiderSnapshot> = {}): RiderSnapshot {
  return {
    id: 'r1',
    name: 'Alice',
    distM: 100,
    lateralM: 1.2,
    speedMs: 8,
    watts: 200,
    cadence: 90,
    draftPct: 0,
    isAI: false,
    isGuest: false,
    lap: 0,
    avatar: {} as RiderSnapshot['avatar'],
    pose: 'seated',
    ...patch,
  };
}

const snap = (t: number, tick: number, riders: RiderSnapshot[]): WorldSnapshotMsg => ({ t, tick, riders });

describe('repère de l’itinéraire (demi-tour)', () => {
  const sampleAt = (patch: Partial<RiderSnapshot>, refM = 0) => {
    const buf = new SnapshotBuffer();
    buf.routeLengthM = L;
    buf.loop = true;
    buf.push(snap(1000, 1, [rider(patch)]));
    return toRouteFrame(buf.sample('r1', 1000 + buf.delayMs)!, L, true, refM);
  };

  it('un coureur dans le sens de l’itinéraire est inchangé', () => {
    const r = sampleAt({ distM: 100 });
    expect(r.dir).toBe(1);
    expect(r.distM).toBeCloseTo(100);
    expect(r.lateralM).toBeCloseTo(1.2);
  });

  it('à contresens : L − d, voie de droite = côté gauche de l’itinéraire', () => {
    const r = sampleAt({ distM: 100, dir: -1 });
    expect(r.dir).toBe(-1);
    expect(r.distM).toBeCloseTo(L - 100);
    expect(r.lateralM).toBeCloseTo(-1.2);
  });

  it('choisit le tour le plus proche du joueur', () => {
    const r = sampleAt({ distM: 100, dir: -1 }, 5 * L + 3400);
    expect(r.lap).toBe(5);
    expect(r.unwrappedM).toBeCloseTo(5 * L + (L - 100));
    // Joueur juste après la ligne, coureur juste avant : 20 m d’écart, pas une boucle entière.
    expect(gapAlongRoute(5 * L + 10, 4 * L + L - 10, L, true)).toBeCloseTo(20);
    expect(gapAlongRoute(50, 80, L, false)).toBe(30);
  });

  it('le décalage du repère serveur est recalé sur le premier instantané du nouveau sens', () => {
    // Joueur à d = 1000 m dans l’itinéraire ; le serveur le place à L − 1000 sur l’itinéraire inversé, tour 3.
    const f = frameAfterTurn(-1, 3 * L + (L - 1000), 1000);
    expect(f.sign).toBe(-1);
    // Il avance de 25 m (d diminue) : côté serveur sa distance augmente de 25 m.
    expect(f.sign * 975 + f.offset).toBeCloseTo(3 * L + (L - 1000) + 25);
    // Retour dans le sens initial, sur un autre tour.
    const back = frameAfterTurn(1, 7 * L + 975, 975);
    expect(back.sign * 1000 + back.offset).toBeCloseTo(7 * L + 1000);
  });
});

describe('interpolation à la bascule de sens', () => {
  it('ne mélange pas deux repères : on prend l’instantané du nouveau sens', () => {
    const buf = new SnapshotBuffer();
    buf.routeLengthM = L;
    buf.loop = true;
    buf.push(snap(1000, 1, [rider({ distM: 1000, lateralM: 1.2 })]));
    // Même endroit physique, mais distance mesurée sur l’itinéraire inversé (L − 1000) et latéral inversé.
    buf.push(snap(1100, 2, [rider({ distM: L - 1000 - 1, lateralM: -1.2, dir: -1 })]));
    const mid = buf.sample('r1', 1050 + buf.delayMs)!;
    expect(mid.dir).toBe(-1);
    expect(mid.distM).toBeCloseTo(L - 1001, 0);
    expect(mid.lateralM).toBeCloseTo(-1.2);
  });
});

describe('voix de proximité', () => {
  it('pleine près, muette loin, progressive entre les deux', () => {
    expect(proximityGain(0, 15, 40)).toBe(1);
    expect(proximityGain(15, 15, 40)).toBe(1);
    expect(proximityGain(40, 15, 40)).toBe(0);
    expect(proximityGain(500, 15, 40)).toBe(0);
    const mid = proximityGain(27.5, 15, 40);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(proximityGain(20, 15, 40)).toBeGreaterThan(proximityGain(30, 15, 40));
  });

  it('un coureur inconnu ne s’entend pas', () => {
    expect(proximityGain(null, 15, 40)).toBe(0);
    expect(proximityGain(Number.NaN, 15, 40)).toBe(0);
  });

  it('l’identité vocale d’une salle publique est l’identifiant du coureur (compagnon compris)', () => {
    expect(riderOfIdentity('r12')).toBe('r12');
    expect(riderOfIdentity('r12:companion')).toBe('r12');
  });
});

describe('menu du monde ouvert', () => {
  const zones = [
    { id: 'chevreuse', name: 'Chevreuse', region: 'Yvelines', routes: [{ id: 'chevreuse-boucle' }] },
    { id: 'longchamp', name: 'Paris — Longchamp', region: 'Paris', routes: [{ id: 'anneau-de-longchamp' }] },
  ] as unknown as Parameters<typeof zoneOfRoute>[0];

  it('relie un itinéraire public à sa zone', () => {
    expect(zoneOfRoute(zones, 'anneau-de-longchamp')?.id).toBe('longchamp');
    expect(zoneOfRoute(zones, 'inconnu')).toBeUndefined();
  });

  it('affluence et amis présents, au singulier et au pluriel', () => {
    expect(ridersLabel(0, true)).toContain('premier');
    expect(ridersLabel(1, true)).toBe('1 coureur en ligne');
    expect(ridersLabel(12, true)).toBe('12 coureurs en ligne');
    expect(ridersLabel(2, false)).toBe('2 riders online');
    expect(friendsLabel([], true)).toBe('');
    expect(friendsLabel(['Léa'], true)).toBe('Léa roule ici');
    expect(friendsLabel(['Léa', 'Paul'], true)).toBe('Léa et Paul roulent ici');
    expect(friendsLabel(['Léa', 'Paul', 'Zoé'], true)).toBe('Léa, Paul et 1 autre roulent ici');
    expect(friendsLabel(['Léa', 'Paul', 'Zoé', 'Max'], false)).toBe('Léa, Paul and 2 others are riding here');
  });
});

describe('choix du micro et de la sortie audio', () => {
  it('mémorise le choix, prévient les abonnés et retombe sur le défaut', () => {
    const store = new Map<string, string>();
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      expect(getAudioDevices()).toEqual({ micId: '', speakerId: '' });
      const seen: string[] = [];
      const off = onAudioDevices((c) => seen.push(`${c.micId}|${c.speakerId}`));
      setAudioDevices({ micId: 'mic-usb' });
      setAudioDevices({ speakerId: 'casque' });
      expect(getAudioDevices()).toEqual({ micId: 'mic-usb', speakerId: 'casque' });
      expect(seen).toEqual(['mic-usb|', 'mic-usb|casque']);
      off();
      setAudioDevices({ micId: '' });
      expect(seen).toHaveLength(2);
      store.set('ar.audioDevices', 'pas du json');
      expect(getAudioDevices()).toEqual({ micId: '', speakerId: '' });
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  });

  it('envoie le son vers la sortie choisie quand le navigateur sait le faire', async () => {
    const calls: string[] = [];
    applySink({ setSinkId: async (id: string) => void calls.push(id) }, 'casque');
    applySink({ setSinkId: async (id: string) => void calls.push(id) }, '');
    applySink({}, 'casque'); // pas de setSinkId : sans effet
    applySink({ setSinkId: () => Promise.reject(new Error('appareil disparu')) }, 'fantôme'); // erreur avalée
    await Promise.resolve();
    expect(calls).toEqual(['casque', '']);
    expect(canChooseOutput()).toBe(false); // pas de HTMLMediaElement en environnement node
  });
});

describe('carte du monde ouvert', () => {
  // Carré de 1 km de côté, un point tous les 250 m : x, z, y.
  const square = [0, 0, 5, 250, 0, 5, 500, 0, 5, 500, 250, 5, 500, 500, 5, 250, 500, 5, 0, 500, 5, 0, 250, 5, 0, 0, 5];
  const len = 2000;

  it('place un coureur sur le tracé selon sa distance (boucle repliée, aller simple borné)', async () => {
    const { pointAtDistance } = await import('../src/ui/openWorldMap.ts');
    expect(pointAtDistance(square, 0, len, true)).toEqual({ x: 0, z: 0 });
    const p = pointAtDistance(square, 500, len, true); // quart de tour : coin est-nord
    expect(p.x).toBeCloseTo(500, 0);
    expect(p.z).toBeCloseTo(0, 0);
    const q = pointAtDistance(square, 2000 + 500, len, true);
    expect(q.x).toBeCloseTo(p.x, 0);
    // −500 m sur une boucle de 2 km = 1 500 m : coin sud-ouest.
    const back = pointAtDistance(square, -500, len, true);
    expect(back.x).toBeCloseTo(0, 0);
    expect(back.z).toBeCloseTo(500, 0);
    expect(pointAtDistance(square, 99_999, len, false)).toEqual({ x: 0, z: 0 });
    expect(pointAtDistance([], 10, len, true)).toEqual({ x: 0, z: 0 });
  });

  it('emprise du tracé avec marge, jamais plus petite que le minimum', async () => {
    const { routeBounds } = await import('../src/ui/openWorldMap.ts');
    const b = routeBounds(square, 100, 400);
    expect(b.minX).toBeCloseTo(-100);
    expect(b.maxX).toBeCloseTo(600);
    const tiny = routeBounds([10, 10, 0, 12, 11, 0], 5, 600);
    expect(tiny.maxX - tiny.minX).toBeGreaterThanOrEqual(600);
    expect(routeBounds([]).maxX).toBeGreaterThan(0);
  });

  it('dessine les inconnus anonymement et les amis avec leur nom (échappé), amis par-dessus', async () => {
    const { dotsSvg, mapSvg, routeBounds } = await import('../src/ui/openWorldMap.ts');
    const input = { polyline: square, lengthM: len, loop: true };
    const b = routeBounds(square);
    const svg = dotsSvg(input, [{ d: 100, dir: 1, friend: true, name: 'Léa <b>' }, { d: 900, dir: -1 }], b, true);
    expect(svg).toContain('Léa &#60;b&#62;');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('à contresens');
    // Un inconnu n'a jamais de nom ; l'ami est dessiné après (au-dessus).
    expect(svg.indexOf('class="ow-dot"')).toBeLessThan(svg.indexOf('class="ow-dot friend"'));
    const full = mapSvg({ ...input, origin: { x: 644000, y: 6862000 } }, [], true);
    expect(full.svg).toContain('id="ow-dots"');
    expect(full.svg).toContain('data.geopf.fr');
    expect(mapSvg(input, [], true).svg).not.toContain('<image');
  });
});
