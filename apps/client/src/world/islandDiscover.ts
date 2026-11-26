/**
 * Lieux à découvrir des mondes du mode Poly : passer à moins de `r` mètres d'un lieu le marque découvert, une médaille
 * s'affiche, la liste est gardée dans le navigateur (ar.islandFound pour l'île, une clé par monde : polyWorlds.ts).
 * L'écran du monde en montre le compte.
 */
export interface IslandPlace {
  id: string;
  name: { fr: string; en: string };
  x: number;
  z: number;
  r: number;
}

export const ISLAND_PLACES: readonly IslandPlace[] = [
  { id: 'phare', name: { fr: 'Le Phare de Robert', en: 'Robert Lighthouse' }, x: 8855, z: -8760, r: 160 },
  { id: 'col', name: { fr: 'Le Col du Phare', en: 'Lighthouse Pass' }, x: 7580, z: -8130, r: 160 },
  { id: 'lac-du-phare', name: { fr: 'Le Lac du Phare', en: 'Lighthouse Lake' }, x: 8480, z: -7430, r: 380 },
  { id: 'chapelle', name: { fr: 'La Chapelle en ruine', en: 'The ruined chapel' }, x: -10600, z: -5600, r: 140 },
  { id: 'etang-des-bois', name: { fr: "L'Étang des Bois", en: 'Woods Pond' }, x: -9400, z: -4600, r: 300 },
  { id: 'cerfs', name: { fr: 'La Clairière des cerfs', en: 'Deer glade' }, x: -7450, z: -5940, r: 160 },
  { id: 'bike-park', name: { fr: 'Le Bike park des Bois', en: 'Woods bike park' }, x: -9050, z: -3250, r: 420 },
  { id: 'cyclo-cross', name: { fr: 'Le Cyclo-cross de Bois-Joli', en: 'Bois-Joli cyclocross' }, x: -7600, z: -1450, r: 380 },
  { id: 'anneau', name: { fr: "L'Anneau", en: 'The Ring' }, x: -4700, z: 900, r: 420 },
  { id: 'moulin', name: { fr: 'Le Moulin des Coteaux', en: 'Hills windmill' }, x: -3600, z: 5000, r: 200 },
  { id: 'planches', name: { fr: 'Les Planches de Robertville', en: 'Robertville boardwalk' }, x: 983, z: 9720, r: 500 },
  { id: 'port-kerbrou', name: { fr: 'Le Port de Kerbrou', en: 'Kerbrou harbour' }, x: -1790, z: -9879, r: 400 },
  { id: 'ecluse', name: { fr: "L'Écluse de la Robe", en: 'Robe lock' }, x: 7102, z: 3452, r: 300 },
  { id: 'lagune', name: { fr: 'La Lagune', en: 'The Lagoon' }, x: -10400, z: 7400, r: 900 },
  { id: 'saint-robert', name: { fr: 'La place de Saint-Robert', en: 'Saint-Robert square' }, x: 300, z: -200, r: 120 },
  { id: 'granges', name: { fr: 'Le Plateau des Granges', en: 'Granges plateau' }, x: 12300, z: 900, r: 400 },
];

const KEY = 'ar.islandFound';

/** Lieux déjà découverts (identifiants). */
export function foundPlaces(key = KEY): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Lieu atteint à (x, z) et pas encore découvert ; null sinon. */
export function newlyFound(x: number, z: number, found: ReadonlySet<string>, places: readonly IslandPlace[] = ISLAND_PLACES): IslandPlace | null {
  for (const p of places) if (!found.has(p.id) && Math.hypot(p.x - x, p.z - z) < p.r) return p;
  return null;
}

export class IslandDiscovery {
  private readonly found: Set<string>;
  private next = 0;

  constructor(
    private readonly lang: 'fr' | 'en' = 'fr',
    private readonly places: readonly IslandPlace[] = ISLAND_PLACES,
    private readonly key = KEY,
  ) {
    this.found = foundPlaces(key);
  }

  /** Appelé à chaque image : au plus une vérification par seconde. */
  check(x: number, z: number, now = performance.now()): IslandPlace | null {
    if (now < this.next) return null;
    this.next = now + 1000;
    const p = newlyFound(x, z, this.found, this.places);
    if (!p) return null;
    this.found.add(p.id);
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.found]));
    } catch {
      /* stockage indisponible : découverte gardée pour la sortie */
    }
    this.show(p);
    return p;
  }

  private show(p: IslandPlace): void {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'island-medal';
    const fr = this.lang === 'fr';
    el.innerHTML = `<span class="island-medal-badge" aria-hidden="true">★</span><span><small>${fr ? 'Lieu découvert' : 'Place discovered'} · ${this.found.size}/${this.places.length}</small><b>${p.name[this.lang]}</b></span>`;
    el.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:60;display:flex;gap:12px;align-items:center;padding:12px 20px 12px 14px;border-radius:14px;background:rgba(16,32,35,.92);color:#f0f2e6;font:600 15px/1.25 Inter,Segoe UI,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35);pointer-events:none;transition:opacity .6s';
    const badge = el.querySelector<HTMLElement>('.island-medal-badge');
    if (badge) badge.style.cssText = 'display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#ffd76d;color:#3a2a10;font-size:22px';
    const small = el.querySelector<HTMLElement>('small');
    if (small) small.style.cssText = 'display:block;color:#a7b9af;font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase';
    const b = el.querySelector<HTMLElement>('b');
    if (b) b.style.cssText = 'display:block;font-size:18px;font-weight:740';
    document.body.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 4200);
    setTimeout(() => el.remove(), 5000);
  }
}
