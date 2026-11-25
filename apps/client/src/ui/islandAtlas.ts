import { routeBike, type RouteBike, type RouteData, type RoutePoint } from '@allezrobert/shared';
import type { WorldRouteRef, WorldRoutes } from '../world/routeStore.ts';
import './islandAtlas.css';

const ISLAND_BOUNDS = { minX: -19000, minZ: -13000, width: 38000, height: 26000 };
const MAP_W = 1520;
const MAP_H = 1040;
const PRIORITY = ['front-de-mer', 'port-de-robertville', 'anneau', 'criterium-saint-robert', 'anneau-piste-verte', 'phare', 'phare-versant-nord', 'chrono-du-plateau', 'kerbrou-et-le-port', 'tour-de-l-ile', 'gravel-des-bois', 'gravel-des-vignes', 'grande-traversee', 'chemin-des-douaniers', 'vtt-des-bois', 'vtt-du-renard', 'descente-du-phare', 'vtt-du-phare'];
/** Lieux de la carte : parcours mis en avant selon le vélo équipé (route, gravel, VTT). */
const PLACES: ReadonlyArray<{ x: number; z: number; label: string; labelEn: string; route: string; gravel?: string; mtb?: string }> = [
  { x: 971, z: 9601, label: 'Robertville', labelEn: 'Robertville', route: 'front-de-mer', mtb: 'vtt-des-coteaux' },
  { x: 300, z: -200, label: 'Saint-Robert', labelEn: 'Saint-Robert', route: 'boucle-de-saint-robert', gravel: 'gravel-du-grand-pre' },
  { x: -4700, z: 900, label: 'L’Anneau', labelEn: 'The Ring', route: 'anneau' },
  { x: 7579, z: -8131, label: 'Col du Phare', labelEn: 'Lighthouse Pass', route: 'phare', mtb: 'vtt-du-phare' },
  { x: -8200, z: -2600, label: 'Bois-Joli', labelEn: 'Bois-Joli', route: 'kerbrou-et-le-port', gravel: 'gravel-des-bois', mtb: 'vtt-des-bois' },
  { x: -1790, z: -9880, label: 'Kerbrou', labelEn: 'Kerbrou', route: 'kerbrou-et-le-port', gravel: 'gravel-de-kerbrou' },
  { x: 6900, z: 2500, label: 'Vallon-sur-Robe', labelEn: 'Vallon-sur-Robe', route: 'voie-verte-de-la-robe', gravel: 'gravel-de-la-vallee' },
  { x: 12300, z: 900, label: 'Les Granges', labelEn: 'Les Granges', route: 'chrono-du-plateau', gravel: 'gravel-du-plateau', mtb: 'vtt-du-plateau' },
  { x: -2300, z: 3900, label: 'Les Vignes', labelEn: 'Les Vignes', route: 'tour-des-coteaux', gravel: 'gravel-des-vignes' },
  { x: -15820, z: 2255, label: 'Saint-Pierre', labelEn: 'Saint-Pierre', route: 'piste-verte', gravel: 'gravel-de-saint-pierre' },
  { x: -7973, z: 8924, label: 'La Pointe', labelEn: 'La Pointe', route: 'velomaritime', gravel: 'gravel-de-la-lagune', mtb: 'vtt-des-buttes' },
];

const COPY = {
  fr: { title: 'L’Île de Robert', mode: 'MODE POLY', coast: 'Front de mer', ring: 'Circuit vélo', climb: 'Montée', loop: 'Boucle', oneWay: 'Point à point', free: 'Roulage libre', draw: 'Tracer un parcours', pick: 'Choisir ce parcours', details: 'Voir la fiche', unavailable: 'Aucun parcours disponible pour ce vélo.', previewError: 'Aperçu indisponible.', close: 'Fermer', island: 'Vue d’ensemble', zoom: 'Zoom parcours', map: 'Carte topographique de l’Île de Robert', north: 'Nord', start: 'Départ', trace: 'Parcours sélectionné', about: 'environ', paved: 'bitume', boards: 'planches', offroad: 'chemins', bikes: { road: 'Parcours route', gravel: 'Parcours gravel', mtb: 'Parcours VTT' }, withBike: 'Autre vélo au garage :', other: { road: '# parcours route', gravel: '# gravel', mtb: '# VTT' }, climbs: 'côte', sprints: 'sprint' },
  en: { title: 'Robert’s Island', mode: 'POLY MODE', coast: 'Seafront', ring: 'Circuit', climb: 'Climb', loop: 'Loop', oneWay: 'Point to point', free: 'Free ride', draw: 'Draw a route', pick: 'Choose this route', details: 'View route details', unavailable: 'No routes are available for this bike.', previewError: 'Preview unavailable.', close: 'Close', island: 'Overview', zoom: 'Zoom to route', map: 'Topographic map of Robert’s Island', north: 'North', start: 'Start', trace: 'Selected route', about: 'about', paved: 'tarmac', boards: 'boardwalk', offroad: 'off-road', bikes: { road: 'Road routes', gravel: 'Gravel routes', mtb: 'MTB trails' }, withBike: 'With another garage bike:', other: { road: '# road', gravel: '# gravel', mtb: '# MTB' }, climbs: 'climb', sprints: 'sprint' },
} as const;

interface AtlasOptions {
  lang: keyof typeof COPY;
  /** Parcours proposés au vélo équipé, et tous ceux de l'île. */
  routes: readonly WorldRouteRef[];
  all: readonly WorldRouteRef[];
  bike: RouteBike;
  allowFree: boolean;
  allowDraw: boolean;
  packAction: string;
}

const esc = (value: string): string => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const mapX = (x: number) => (x - ISLAND_BOUNDS.minX) / ISLAND_BOUNDS.width;
const mapZ = (z: number) => (z - ISLAND_BOUNDS.minZ) / ISLAND_BOUNDS.height;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function routeLabel(id: string, lang: AtlasOptions['lang']): string | undefined {
  if (lang === 'fr') return undefined;
  const names: Record<string, string> = {
    'front-de-mer': 'Robertville Seafront', 'anneau': 'The Ring', 'phare': 'Lighthouse Climb',
    'tour-de-l-ile': 'Island Tour', 'boucle-de-saint-robert': 'Saint-Robert Loop',
    'robertville-plage': 'Robertville via the Hills', 'col-du-phare': 'Lighthouse Pass Traverse',
    'piste-verte': 'The Greenway', 'gravel-des-bois': 'Woodland Gravel', 'vtt-des-bois': 'Woodland MTB',
    'criterium-saint-robert': 'Saint-Robert Criterium', 'anneau-piste-verte': 'The Ring by the Greenway', 'port-de-robertville': 'Boardwalk and Harbour',
    'chrono-du-plateau': 'Plateau Time Trial', 'voie-verte-de-la-robe': 'Robe Greenway', 'velomaritime': 'Coast Greenway',
    'phare-versant-nord': 'Lighthouse from the North', 'kerbrou-et-le-port': 'Kerbrou and Bois-Joli', 'tour-des-coteaux': 'Hills Loop',
    'gravel-du-plateau': 'Plateau Gravel', 'gravel-des-vignes': 'Vineyard Gravel', 'gravel-de-la-lagune': 'Lagoon Gravel',
    'gravel-de-la-vallee': 'Valley Gravel', 'gravel-de-kerbrou': 'Kerbrou Gravel', 'gravel-du-levant': 'Levant Gravel', 'gravel-de-saint-pierre': 'Saint-Pierre Gravel', 'gravel-du-grand-pre': 'Great Meadow Gravel',
    'chemin-des-douaniers': 'Coast Guard Path', 'chemin-du-littoral': 'East Coast Path', 'grande-traversee': 'Great Gravel Traverse',
    'vtt-du-renard': 'Fox Trail', 'vtt-des-biches': 'Deer Trail', 'vtt-grand-tour-des-bois': 'Woods MTB Grand Tour', 'vtt-du-phare': 'Lighthouse MTB Loop', 'descente-du-phare': 'Lighthouse Downhill',
    'vtt-des-coteaux': 'Hills MTB Trail', 'vtt-des-buttes': 'Mounds MTB Trail', 'vtt-du-plateau': 'Plateau MTB Trail',
  };
  return names[id];
}

function routeTag(route: WorldRouteRef, lang: AtlasOptions['lang']): string {
  const copy = COPY[lang];
  if (route.bike) return route.bike === 'mtb' ? (lang === 'fr' ? 'VTT' : 'MTB') : 'Gravel';
  if (route.id === 'front-de-mer') return copy.coast;
  if (route.id === 'anneau') return copy.ring;
  if (route.id === 'phare') return copy.climb;
  return route.loop ? copy.loop : copy.oneWay;
}

function paintRoute(canvas: HTMLCanvasElement, route: RouteData): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !route.points.length) return;
  const point = (p: RoutePoint) => [mapX(p.x) * MAP_W, mapZ(p.z) * MAP_H] as const;
  ctx.beginPath();
  ctx.moveTo(...point(route.points[0]!));
  const stride = Math.max(1, Math.floor(route.points.length / 1800));
  for (let i = stride; i < route.points.length; i += stride) ctx.lineTo(...point(route.points[i]!));
  ctx.lineTo(...point(route.points.at(-1)!));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#263a37';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = '#ffd76d';
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(...point(route.points[0]!), 6, 0, Math.PI * 2);
  ctx.fillStyle = '#edf2dd';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#223834';
  ctx.stroke();
}

function paintProfile(canvas: HTMLCanvasElement, route: RouteData): void {
  const ctx = canvas.getContext('2d');
  const points = route.points;
  if (!ctx || points.length < 2 || route.lengthM <= 0) return;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    min = Math.min(min, p.y);
    max = Math.max(max, p.y);
  }
  const { width, height } = canvas;
  ctx.beginPath();
  const stride = Math.max(1, Math.floor(points.length / width));
  const altitude = (p: RoutePoint) => height - 4 - (p.y - min) / Math.max(20, max - min) * (height - 9);
  ctx.moveTo(0, altitude(points[0]!));
  for (let i = stride; i < points.length; i += stride) ctx.lineTo(clamp(points[i]!.d / route.lengthM, 0, 1) * width, altitude(points[i]!));
  ctx.lineTo(width, altitude(points.at(-1)!));
  ctx.strokeStyle = '#ffd76d';
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = '#ffd76d2b';
  ctx.fill();
}

/** Durée estimée (27 km/h sur le plat, un peu plus lent en montée et hors bitume), revêtements, segments chronométrés. */
function routeFacts(route: RouteData, lang: AtlasOptions['lang']): string {
  const copy = COPY[lang];
  const share = { asphalt: 0, wood: 0, dirt: 0 };
  for (const s of route.surfaces ?? []) share[s.surface === 'asphalt' ? 'asphalt' : s.surface === 'wood' ? 'wood' : 'dirt'] += s.endM - s.startM;
  const total = share.asphalt + share.wood + share.dirt || 1;
  const min = Math.max(1, Math.round((route.lengthM / 7.5 + route.elevationGainM * 3.2 + share.dirt * 0.07) / 60));
  const time = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  const ground = ([['asphalt', copy.paved], ['wood', copy.boards], ['dirt', copy.offroad]] as const).filter(([k]) => share[k] / total > 0.02).map(([k, name]) => `${name} ${Math.round((share[k] / total) * 100)} %`);
  const count = (kind: string, name: string) => {
    const n = route.segments.filter((s) => s.kind === kind).length;
    return n ? `${n} ${name}${n > 1 ? 's' : ''}` : '';
  };
  return [`${copy.about} ${time}`, ...ground, count('kom', copy.climbs), count('sprint', copy.sprints)].filter(Boolean).join(' · ');
}

function mapFocus(route: RouteData | undefined): { scale: number; x: number; z: number } {
  if (!route?.points.length) return { scale: 1, x: 0, z: 0 };
  let lx = 1, lz = 1, hx = 0, hz = 0;
  for (const p of route.points) {
    const x = mapX(p.x), z = mapZ(p.z);
    lx = Math.min(lx, x); hx = Math.max(hx, x);
    lz = Math.min(lz, z); hz = Math.max(hz, z);
  }
  const scale = clamp(0.75 / Math.max(0.01, hx - lx, hz - lz), 1, 3.6);
  return { scale, x: clamp(0.5 - (lx + hx) / 2 * scale, 1 - scale, 0), z: clamp(0.5 - (lz + hz) / 2 * scale, 1 - scale, 0) };
}

export class IslandAtlas {
  private activeId = '';

  html({ routes, all, bike, lang, allowDraw, allowFree, packAction }: AtlasOptions): string {
    const copy = COPY[lang];
    const available = new Set(routes.map(({ id }) => id));
    const order = (id: string) => PRIORITY.includes(id) ? PRIORITY.indexOf(id) : PRIORITY.length;
    const sorted = [...routes].sort((a, b) => order(a.id) - order(b.id));
    if (!available.has(this.activeId)) this.activeId = sorted[0]?.id ?? '';
    const km = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 });
    const marker = PLACES.map((p) => {
      const name = lang === 'fr' ? p.label : p.labelEn;
      const at = `left:${(mapX(p.x) * 100).toFixed(2)}%;top:${(mapZ(p.z) * 100).toFixed(2)}%`;
      const id = bike === 'road' ? p.route : p[bike];
      if (id && available.has(id)) return `<button type="button" class="ia-marker" style="${at}" data-ia-choice="${id}" aria-pressed="false"><span>${name}</span></button>`;
      return `<span class="ia-marker ia-marker-static" style="${at}"><span>${name}</span></span>`;
    }).join('');
    const rows = sorted.map((r) => `<button type="button" class="ia-route" data-ia-choice="${esc(r.id)}" data-ia-row aria-pressed="${r.id === this.activeId}">
      <span class="ia-route-mark" aria-hidden="true"></span><span class="ia-route-main"><b>${esc(routeLabel(r.id, lang) ?? r.name)}</b><small>${routeTag(r, lang)}</small></span>
      <span class="ia-route-metric"><b>${km.format(r.lengthM / 1000)} km</b><small>+${Math.round(r.elevationGainM)} m</small></span>
    </button>`).join('');
    // Parcours des autres vélos : ils s'affichent dès qu'un vélo de ce type est équipé au garage.
    const counts = (['road', 'gravel', 'mtb'] as const).filter((b) => b !== bike).map((b) => [b, all.filter((r) => routeBike(r) === b).length] as const).filter(([, n]) => n > 0);
    const others = counts.length ? `${copy.withBike} ${counts.map(([b, n]) => copy.other[b].replace('#', String(n))).join(' · ')}` : '';
    return `<div class="mm-modal mm-picker-modal ia-overlay" data-picker-close>
      <div class="mm-dialog mm-picker ia-dialog" role="dialog" aria-modal="true" aria-labelledby="ia-title" data-island-atlas>
        <div class="ia-map-panel">
          <header class="ia-heading"><div><span class="ia-mode">${copy.mode}</span><h2 id="ia-title">${copy.title}</h2></div></header>
          <div class="ia-view" role="region" aria-label="${copy.map}">
            <div class="ia-plane"><img src="/worlds/ile-de-robert/carte.png" alt="" width="${MAP_W}" height="${MAP_H}"><canvas class="ia-trace" width="${MAP_W}" height="${MAP_H}" aria-hidden="true"></canvas>${marker}</div>
            <div class="ia-compass" title="${copy.north}" aria-label="${copy.north}">N<span aria-hidden="true">▲</span></div>
            <div class="ia-map-tools"><button type="button" data-ia-zoom aria-pressed="false" disabled>${copy.zoom}</button></div>
            <span class="ia-scale" aria-hidden="true">5 km</span>
          </div>
          <div class="ia-legend"><span class="ia-line-key">${copy.trace}</span><span class="ia-start-key">${copy.start}</span><span class="ia-load" data-ia-status role="status"></span></div>
        </div>
        <div class="ia-side">
          <header class="ia-side-head"><h3>${copy.bikes[bike]} <small>${routes.length}</small></h3><button type="button" class="mm-x" data-picker-close aria-label="${copy.close}">×</button></header>
          ${others ? `<p class="ia-others">${others}</p>` : ''}
          <div class="ia-routes">${rows || `<p class="ia-empty">${copy.unavailable}</p>`}</div>
          ${rows ? `<div class="ia-selection"><canvas class="ia-profile" width="480" height="42" aria-hidden="true"></canvas><p class="ia-facts" data-ia-facts></p><button type="button" class="ia-pick" data-routepick="${esc(this.activeId)}">${copy.pick}<span aria-hidden="true"> →</span></button><button type="button" class="ia-detail" data-route="${esc(this.activeId)}">${copy.details}</button></div>` : ''}
          <footer class="ia-actions">${allowFree ? `<button type="button" data-zc="free">${copy.free}</button>` : ''}${allowDraw ? `<button type="button" data-zc="draw">${copy.draw}</button>` : ''}${packAction}</footer>
        </div>
      </div>
    </div>`;
  }

  bind(root: HTMLElement, store: WorldRoutes, lang: AtlasOptions['lang']): void {
    const atlas = root.querySelector<HTMLElement>('[data-island-atlas]');
    if (!atlas || !this.activeId) return;
    const canvas = atlas.querySelector<HTMLCanvasElement>('.ia-trace')!;
    const profile = atlas.querySelector<HTMLCanvasElement>('.ia-profile')!;
    const plane = atlas.querySelector<HTMLElement>('.ia-plane')!;
    const zoom = atlas.querySelector<HTMLButtonElement>('[data-ia-zoom]')!;
    const scaleBar = atlas.querySelector<HTMLElement>('.ia-scale')!;
    const status = atlas.querySelector<HTMLElement>('[data-ia-status]')!;
    const facts = atlas.querySelector<HTMLElement>('[data-ia-facts]')!;
    const pick = atlas.querySelector<HTMLButtonElement>('[data-routepick]')!;
    const details = atlas.querySelector<HTMLButtonElement>('[data-route]')!;
    const choices = atlas.querySelectorAll<HTMLButtonElement>('[data-ia-choice]');
    let current: RouteData | undefined;
    let zoomed = false;
    let request = 0;
    const scopeMap = () => {
      const view = mapFocus(zoomed ? current : undefined);
      plane.style.transform = `translate(${view.x * 100}%,${view.z * 100}%) scale(${view.scale})`;
      plane.style.setProperty('--ia-inverse-scale', String(1 / view.scale));
      const scaleKm = view.scale > 2.5 ? 2 : 5;
      scaleBar.textContent = `${scaleKm} km`;
      scaleBar.style.width = `${scaleKm * 1000 / ISLAND_BOUNDS.width * view.scale * 100}%`;
      zoom.setAttribute('aria-pressed', String(zoomed));
      zoom.textContent = zoomed ? COPY[lang].island : COPY[lang].zoom;
      for (const marker of atlas.querySelectorAll<HTMLButtonElement>('button.ia-marker')) {
        const x = Number.parseFloat(marker.style.left) / 100 * view.scale + view.x;
        const z = Number.parseFloat(marker.style.top) / 100 * view.scale + view.z;
        marker.tabIndex = x >= 0 && x < 1 && z >= 0 && z < 1 ? 0 : -1;
      }
    };
    const choose = (id: string) => {
      if (!store.index.some((route) => route.id === id)) return;
      this.activeId = id;
      pick.dataset.routepick = id;
      details.dataset.route = id;
      choices.forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.iaChoice === id)));
      const row = Array.from(choices).find((el) => el.hasAttribute('data-ia-row') && el.dataset.iaChoice === id);
      if (row && !row.matches(':focus')) {
        const list = row.parentElement!;
        if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
          list.scrollTop = Math.max(0, row.offsetTop - 6);
        }
      }
      current = undefined;
      zoom.disabled = true;
      status.textContent = '';
      facts.textContent = '';
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      profile.getContext('2d')?.clearRect(0, 0, profile.width, profile.height);
      const token = ++request;
      const show = (route: RouteData) => {
        if (token !== request || !atlas.isConnected) return;
        current = route;
        zoom.disabled = false;
        paintRoute(canvas, route);
        paintProfile(profile, route);
        facts.textContent = routeFacts(route, lang);
        scopeMap();
      };
      const loaded = store.get(id);
      if (loaded) show(loaded);
      else void store.load(id).then(show, () => {
        if (token !== request || !atlas.isConnected) return;
        status.textContent = COPY[lang].previewError;
        zoomed = false;
        scopeMap();
      });
    };
    atlas.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-ia-choice]');
      if (button) choose(button.dataset.iaChoice!);
    });
    zoom.addEventListener('click', () => {
      zoomed = !zoomed;
      scopeMap();
    });
    choose(this.activeId);
  }
}
