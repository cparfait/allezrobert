/**
 * Itinéraire sur la carte d'une zone ouverte (fenêtre ouverte dès le choix de la zone) : on
 * clique un départ, puis autant de points de passage qu'on veut ; chaque étape est le plus
 * court chemin roulable (routes revêtues de préférence) sur le graphe routier du monde, et le
 * tout devient un parcours comme les autres. « Revenir au départ » ferme la boucle. Un seul
 * point : roulage libre depuis ce départ ; ou depuis le départ par défaut (« Rouler en libre »).
 * Les villes, villages et hameaux (places.json) sont nommés sur la carte.
 */
import { frenchOf, isPavedEdge, itineraryRoute, joinItineraries, planItinerary, RoadNet, snapToRoad, type Itinerary, type RoadGraphData, type RoadSnap, type RouteData, type WorldPlace } from '@allezrobert/shared';
import { BASEMAP_ATTRIBUTION, basemapImage } from './basemap.ts';
import { getLang } from '../i18n/index.ts';
import './routePlanner.css';

/** Préfixe des parcours calculés (un seul à la fois dans la liste des parcours du monde). */
export const ITINERARY_PREFIX = 'itineraire-';

export interface OpenMap {
  graph: RoadGraphData;
  start: { x: number; z: number };
  places?: WorldPlace[];
  /** Origine du repère de la zone en Lambert-93 : fond de carte Plan IGN sous les routes. */
  originL93?: { x: number; y: number };
  /** Emprises roulables (repère monde, m), entourées d'un liseré sur la carte. */
  areas?: Array<{ minX: number; minZ: number; maxX: number; maxZ: number }>;
}

export interface PlannerActions {
  /** Partir sur l'itinéraire calculé. */
  ride(route: RouteData): void;
  /** Roulage libre (mode ouvert) depuis ce point, ou depuis le départ par défaut (null). */
  free(start: { x: number; z: number } | null): void;
}

interface View {
  x: number;
  z: number;
  w: number;
  h: number;
}

const fr = () => getLang() === 'fr';
/** « à » devant un nom de lieu : au Roussel, aux Vigiers, à la Pireyre, à Glaine. */
const frenchTo = (name: string) =>
  /^Le /.test(name) ? `au ${name.slice(3)}` : /^Les /.test(name) ? `aux ${name.slice(4)}` : /^La /.test(name) ? `à la ${name.slice(3)}` : /^L['’]/.test(name) ? `à l’${name.slice(2)}` : `à ${name}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** Largeur de vue (fraction de la zone) en dessous de laquelle les hameaux sont nommés. */
const HAMLET_ZOOM = 0.55;

export class RoutePlanner {
  private open: OpenMap | null = null;
  private net: RoadNet | null = null;
  /** Tracé des routes (chemins SVG par classe), calculé une fois par graphe. */
  private roads = '';
  private bounds: View = { x: 0, z: 0, w: 1, h: 1 };
  private view: View = { x: 0, z: 0, w: 1, h: 1 };
  /** Départ puis points de passage ; `legs[i]` va de `points[i]` à `points[i + 1]`. */
  private points: RoadSnap[] = [];
  private legs: Itinerary[] = [];
  private result: RouteData | null = null;
  private error = '';

  /** Graphe de la zone affichée (null : zone sans monde ouvert). Tout est remis à zéro s'il change. */
  setOpen(open: OpenMap | null): void {
    if (open?.graph === this.open?.graph) return;
    this.open = open;
    this.net = open ? new RoadNet(open.graph) : null;
    this.clear();
    if (!open) return;
    const n = open.graph.nodes;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n.length; i += 3) {
      minX = Math.min(minX, n[i] as number);
      maxX = Math.max(maxX, n[i] as number);
      minZ = Math.min(minZ, n[i + 2] as number);
      maxZ = Math.max(maxZ, n[i + 2] as number);
    }
    // toute la zone roulable, même sans route (la mer d'une zone côtière, une forêt au bord)
    for (const a of open.areas ?? []) {
      minX = Math.min(minX, a.minX);
      maxX = Math.max(maxX, a.maxX);
      minZ = Math.min(minZ, a.minZ);
      maxZ = Math.max(maxZ, a.maxZ);
    }
    const m = Math.max(maxX - minX, maxZ - minZ) * 0.03;
    this.bounds = { x: minX - m, z: minZ - m, w: maxX - minX + 2 * m, h: maxZ - minZ + 2 * m };
    this.view = { ...this.bounds };
    this.roads = this.roadPaths(open.graph);
  }

  /**
   * Contour de ce qu'on peut parcourir : réunion des emprises (kilomètres entiers), seuls les
   * bords extérieurs sont tracés (pas de trait entre deux zones voisines).
   */
  private areaOutline(): string {
    const areas = this.open?.areas;
    if (!areas?.length) return '';
    const T = 1000;
    const cells = new Set<string>();
    for (const a of areas)
      for (let tx = Math.round(a.minX / T); tx < Math.round(a.maxX / T); tx++)
        for (let tz = Math.round(a.minZ / T); tz < Math.round(a.maxZ / T); tz++) cells.add(`${tx}_${tz}`);
    const has = (tx: number, tz: number) => cells.has(`${tx}_${tz}`);
    let d = '';
    for (const c of cells) {
      const [tx, tz] = c.split('_').map(Number) as [number, number];
      const x0 = tx * T;
      const z0 = tz * T;
      if (!has(tx, tz - 1)) d += `M${x0} ${z0}H${x0 + T}`;
      if (!has(tx, tz + 1)) d += `M${x0} ${z0 + T}H${x0 + T}`;
      if (!has(tx - 1, tz)) d += `M${x0} ${z0}V${z0 + T}`;
      if (!has(tx + 1, tz)) d += `M${x0 + T} ${z0}V${z0 + T}`;
    }
    return `<path class="rp-area" d="${d}"/>`;
  }

  /** Fond Plan IGN sous toute l'emprise (avec marge : la boîte peut être plus large que la carte). */
  private basemap(px: number): string {
    const o = this.open?.originL93;
    if (!o) return '';
    const b = this.bounds;
    const m = Math.max(b.w, b.h) * 0.25;
    const at = { x: b.x - m, y: b.z - m, w: b.w + 2 * m, h: b.h + 2 * m };
    return basemapImage({ minE: o.x + at.x, minN: o.y - (at.y + at.h), maxE: o.x + at.x + at.w, maxN: o.y - at.y }, at, px);
  }

  /**
   * Parcours libre : la carte ne sert qu'à choisir le point de départ (un seul point, qu'un nouveau
   * clic déplace), puis « Partir d'ici ».
   */
  get startOnly(): boolean {
    return this.onlyStart;
  }

  set startOnly(on: boolean) {
    if (on === this.onlyStart) return;
    this.onlyStart = on;
    // On garde au plus le départ déjà choisi.
    if (on && this.points.length > 1) {
      const first = this.points[0] as RoadSnap;
      this.clear();
      this.points.push(first);
    }
  }

  private onlyStart = false;

  /** Parcours calculé, s'il y en a un. */
  get route(): RouteData | null {
    return this.result;
  }

  private clear(): void {
    this.points = [];
    this.legs = [];
    this.result = null;
    this.error = '';
  }

  /** Boucle fermée : le dernier point est revenu sur le départ. */
  private get closed(): boolean {
    const a = this.points[0];
    const b = this.points[this.points.length - 1];
    return this.points.length > 2 && !!a && !!b && a.edge === b.edge && Math.abs(a.along - b.along) < 1;
  }

  /** Routes en trois classes (grandes, petites, chemins), points espacés d'au moins ~1 px. */
  private roadPaths(g: RoadGraphData): string {
    const tol = this.bounds.w / 1600;
    const d = { major: '', minor: '', track: '' };
    for (const e of g.edges) {
      const cls = !isPavedEdge(e) ? 'track' : /^(primary|secondary|tertiary)/.test(e.kind) ? 'major' : 'minor';
      const p = e.pts;
      let s = `M${Math.round(p[0] as number)} ${Math.round(p[2] as number)}`;
      let lx = p[0] as number;
      let lz = p[2] as number;
      for (let k = 3; k < p.length; k += 3) {
        const x = p[k] as number;
        const z = p[k + 2] as number;
        if (k + 3 < p.length && Math.hypot(x - lx, z - lz) < tol) continue;
        s += `L${Math.round(x)} ${Math.round(z)}`;
        lx = x;
        lz = z;
      }
      d[cls] += s;
    }
    return `<path class="rp-track" d="${d.track}"/><path class="rp-minor" d="${d.minor}"/><path class="rp-major" d="${d.major}"/>`;
  }

  /** Lieu habité le plus proche (moins de `maxM`), villes et villages d'abord. */
  private nearPlace(x: number, z: number, maxM = 1200): WorldPlace | null {
    let best: WorldPlace | null = null;
    let bd = Infinity;
    for (const p of this.open?.places ?? []) {
      // un village compte « plus près » qu'un hameau à distance égale
      const d = Math.hypot(p.x - x, p.z - z) * (p.kind === 'hamlet' ? 1.6 : 1);
      if (d < bd && d < maxM) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Où est ce point : route (nom ou numéro) et lieu le plus proche. */
  private where(s: RoadSnap): string {
    const L = fr();
    const e = this.net?.edge(s.edge);
    const road = e?.name || e?.ref || '';
    const place = this.nearPlace(s.x, s.z)?.name;
    const near = place ? (L ? `près ${frenchOf(place)}` : `near ${place}`) : '';
    if (road && near) return `${road}, ${near}`;
    if (near) return near;
    return road || (L ? 'route sans nom' : 'unnamed road');
  }

  private scaleK(): string {
    return (this.view.w / 600).toFixed(3);
  }

  /** Repère (taille constante à l'écran : mis à l'échelle de la vue). */
  private marker(x: number, z: number, cls: string, label: string): string {
    return `<g class="rp-mk ${cls}" data-mk transform="translate(${x.toFixed(1)} ${z.toFixed(1)}) scale(${this.scaleK()})"><circle r="9"/><text y="4">${label}</text></g>`;
  }

  /** Noms des lieux : villes et villages toujours, hameaux une fois zoomé. */
  private placeLabels(): string {
    const order = (k: string) => (k === 'hamlet' ? 0 : 1);
    return (this.open?.places ?? [])
      .slice()
      .sort((a, b) => order(a.kind) - order(b.kind))
      .map(
        (p) =>
          `<g class="rp-place rp-${p.kind === 'hamlet' ? 'hamlet' : 'village'}" data-mk transform="translate(${p.x.toFixed(0)} ${p.z.toFixed(0)}) scale(${this.scaleK()})"><circle r="${p.kind === 'hamlet' ? 2 : 3.2}"/><text x="6" y="4">${esc(p.name)}</text></g>`,
      )
      .join('');
  }

  /**
   * Aperçu fixe de la zone (page principale du menu) : routes, lieux, et le tracé choisi ou le
   * départ du roulage libre. '' sans monde ouvert.
   */
  preview(route: RouteData | null, start: { x: number; z: number } | null): string {
    if (!this.open) return '';
    const b = this.bounds;
    // repères lisibles sur un aperçu d'environ 360 px (le plus grand côté de la zone)
    const k = (Math.max(b.w, b.h) / 340).toFixed(3);
    // pas de tracé du parcours sur l'aperçu : la zone, son fond et le départ seulement
    const line = '';
    const at = route?.points[0] ?? start ?? this.open.start;
    const mk = `<g class="rp-mk rp-from" transform="translate(${at.x.toFixed(1)} ${at.z.toFixed(1)}) scale(${k})"><circle r="9"/><text y="4">D</text></g>`;
    // Aperçu de ≈ 200 px : villes et bourgs seulement (les villages, s'il n'y en a presque pas).
    const all = this.open.places ?? [];
    const big = all.filter((p) => p.kind === 'city' || p.kind === 'town');
    const towns = (big.length >= 3 ? big : all.filter((p) => p.kind !== 'hamlet'))
      .slice(0, 10)
      .map((p) => `<g class="rp-place rp-village" transform="translate(${p.x.toFixed(0)} ${p.z.toFixed(0)}) scale(${k})"><circle r="3.2"/><text x="6" y="4">${esc(p.name)}</text></g>`)
      .join('');
    return `<svg class="rp-map rp-preview" viewBox="${b.x.toFixed(1)} ${b.z.toFixed(1)} ${b.w.toFixed(1)} ${b.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${this.basemap(700)}${this.areaOutline()}<g class="rp-roads">${this.roads}</g>${line}<g class="rp-places">${towns}</g>${mk}</svg>`;
  }

  /** Bloc complet : carte cliquable et panneau (consignes, chiffres, boutons). */
  html(routeCard: (r: RouteData) => string): string {
    if (!this.open) return '';
    const L = fr();
    const v = this.view;
    const r = this.result;
    const pts = this.points;
    const n = pts.length;
    let line = '';
    if (r) {
      const step = Math.max(1, Math.floor(r.points.length / 2000));
      line = `<path class="rp-route" d="${r.points
        .filter((_, i) => i % step === 0 || i === r.points.length - 1)
        .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)} ${p.z.toFixed(0)}`)
        .join('')}"/>`;
    }
    let marks = '';
    // Parcours libre : le départ par défaut est affiché comme le départ (D) ; un clic le déplace.
    if (!n && this.onlyStart) marks = this.marker(this.open.start.x, this.open.start.z, 'rp-from', 'D');
    else if (!n) marks = this.marker(this.open.start.x, this.open.start.z, 'rp-home', '');
    else {
      // points de passage numérotés, puis arrivée (sauf boucle fermée), puis départ par-dessus
      for (let i = 1; i < n - 1; i++) marks += this.marker((pts[i] as RoadSnap).x, (pts[i] as RoadSnap).z, 'rp-via', String(i));
      if (n > 1 && !this.closed) marks += this.marker((pts[n - 1] as RoadSnap).x, (pts[n - 1] as RoadSnap).z, 'rp-to', 'A');
      marks += this.marker((pts[0] as RoadSnap).x, (pts[0] as RoadSnap).z, 'rp-from', 'D');
    }
    const only = this.onlyStart;
    const hint = this.error
      ? `<p class="rp-err">${esc(this.error)}</p>`
      : only
        ? `<p class="mm-hint">${
            !n
              ? L
                ? 'Ton départ (D) est celui de la zone. Clique ailleurs sur la carte pour le déplacer (molette : zoom, glisser : déplacer).'
                : 'Your start (D) is the area’s default. Click elsewhere on the map to move it (wheel: zoom, drag: pan).'
              : L
                ? 'Clique ailleurs pour déplacer ton départ. Ensuite, choisis ta route à chaque carrefour (← / →, U pour faire demi-tour).'
                : 'Click elsewhere to move your start. Then pick your road at each junction (← / →, U to turn around).'
          }</p>`
        : `<p class="mm-hint">${
          !n
            ? L
              ? 'Clique sur la carte pour choisir ton départ, puis tes points de passage (molette : zoom, glisser : déplacer).'
              : 'Click the map to pick your start, then your waypoints (wheel: zoom, drag: pan).'
            : n === 1
              ? L
                ? 'Clique ton prochain point (le parcours suit les routes), ou pars d’ici en roulage libre.'
                : 'Click your next point (the route follows the roads), or ride freely from here.'
              : this.closed
                ? L
                  ? 'Boucle fermée : tu reviens à ton départ.'
                  : 'Loop closed: you finish where you started.'
                : L
                  ? 'Clique pour ajouter des points de passage, ou reviens au départ pour faire une boucle.'
                  : 'Click to add waypoints, or go back to the start to make a loop.'
        }</p>`;
    const list = n
      ? `<ol class="rp-pts"><li><i class="rp-dot rp-from"></i>${L ? 'Départ' : 'Start'} · <b>${esc(this.where(pts[0] as RoadSnap))}</b></li>${
          n > 2 ? `<li><i class="rp-dot rp-via"></i>${n - 2} ${L ? `point${n - 2 > 1 ? 's' : ''} de passage` : `waypoint${n - 2 > 1 ? 's' : ''}`}</li>` : ''
        }${n > 1 ? (this.closed ? `<li><i class="rp-dot rp-from"></i>${L ? 'Retour au départ' : 'Back to the start'}</li>` : `<li><i class="rp-dot rp-to"></i>${L ? 'Arrivée' : 'Finish'} · <b>${esc(this.where(pts[n - 1] as RoadSnap))}</b></li>`) : ''}</ol>`
      : '';
    const go = (id: string, label: string, cls = '') => `<button class="rp-btn ${cls}" data-plan="${id}">${label}</button>`;
    const actions = only
      ? [
          n ? go('here', `${L ? 'Partir d’ici' : 'Start here'} →`, 'rp-go') : go('free', `${L ? 'Partir d’ici' : 'Start here'} →`, 'rp-go'),
          n ? go('clear', L ? 'Revenir au départ par défaut' : 'Back to the default start') : '',
        ].join('')
      : [
      r ? go('ride', `${L ? (this.closed ? 'Rouler cette boucle' : 'Rouler cet itinéraire') : this.closed ? 'Ride this loop' : 'Ride this route'} →`, 'rp-go') : '',
      n === 1 ? go('here', `${L ? 'Partir d’ici en libre' : 'Ride freely from here'} →`, 'rp-go') : '',
      n > 1 && !this.closed ? go('loop', `↺ ${L ? 'Revenir au départ' : 'Back to the start'}`) : '',
      n ? go('undo', `↶ ${L ? 'Annuler le dernier point' : 'Undo last point'}`) : '',
      n ? go('clear', L ? 'Effacer' : 'Clear') : '',
      go('free', L ? 'Rouler en libre' : 'Free ride', n ? '' : 'rp-go'),
    ].join('');
    const zoomed = v.w < this.bounds.w * HAMLET_ZOOM;
    return `<section class="rp" aria-label="${L ? 'Itinéraire sur la carte' : 'Route on the map'}">
      <div class="rp-mapbox">
        <svg class="rp-map${zoomed ? ' rp-zoomed' : ''}" viewBox="${v.x.toFixed(1)} ${v.z.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet">
          ${this.basemap(1800)}${this.areaOutline()}<g class="rp-roads">${this.roads}</g>${line}<g class="rp-places">${this.placeLabels()}</g>${marks}
        </svg>
        <div class="rp-legend">${this.open?.originL93 ? `<span class="rp-attr">${BASEMAP_ATTRIBUTION}</span>` : ''}<span><i class="rp-l-major"></i>${L ? 'route' : 'road'}</span><span><i class="rp-l-track"></i>${L ? 'chemin' : 'track'}</span>${n ? '' : `<span><i class="rp-dot rp-home"></i>${L ? 'départ par défaut' : 'default start'}</span>`}</div>
      </div>
      <div class="rp-side">
        <h3>${only ? (L ? 'Ton point de départ' : 'Your start') : L ? 'Ton itinéraire' : 'Your route'}</h3>
        ${hint}${list}
        ${r ? `<div class="rp-card">${routeCard(r)}</div>` : ''}
        <div class="rp-actions">${actions}</div>
      </div>
    </section>`;
  }

  /** Événements du bloc (`scope` le contient) ; le bloc se redessine sur place. */
  bind(scope: ParentNode, routeCard: (r: RouteData) => string, act: PlannerActions): void {
    const box = scope.querySelector<HTMLElement>('.rp');
    const svg = box?.querySelector<SVGSVGElement>('.rp-map');
    if (!box || !svg) return;
    const redraw = () => {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.html(routeCard);
      const fresh = tmp.firstElementChild;
      if (!fresh) return;
      box.replaceWith(fresh);
      this.bind(fresh.parentNode ?? scope, routeCard, act);
    };
    box.querySelectorAll<HTMLElement>('[data-plan]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.plan;
        const first = this.points[0];
        if (id === 'ride' && this.result) return act.ride(this.result);
        if (id === 'here' && first) return act.free({ x: first.x, z: first.z });
        if (id === 'free') return act.free(null);
        if (id === 'clear') this.clear();
        else if (id === 'undo') this.undo();
        else if (id === 'loop' && first) this.addPoint({ ...first });
        redraw();
      }),
    );
    const toWorld = (cx: number, cy: number) => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
      return { x: p.x, z: p.y };
    };
    const applyView = () => {
      const v = this.view;
      svg.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.z.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
      svg.classList.toggle('rp-zoomed', v.w < this.bounds.w * HAMLET_ZOOM);
      const k = this.scaleK();
      svg.querySelectorAll<SVGGElement>('[data-mk]').forEach((g) => g.setAttribute('transform', (g.getAttribute('transform') ?? '').replace(/scale\([^)]*\)/, `scale(${k})`)));
    };
    // Molette : zoom autour du pointeur, entre la zone entière et ~600 m de large.
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = toWorld(e.clientX, e.clientY);
        if (!p) return;
        const b = this.bounds;
        const f = Math.exp(Math.sign(e.deltaY) * 0.18);
        const w = Math.min(b.w, Math.max(600, this.view.w * f));
        const s = w / this.view.w;
        this.view = { x: p.x - (p.x - this.view.x) * s, z: p.z - (p.z - this.view.z) * s, w, h: this.view.h * s };
        this.clampView();
        applyView();
      },
      { passive: false },
    );
    // Glisser : déplacer la carte ; clic sans glisser : nouveau point.
    let drag: { x: number; y: number; vx: number; vz: number; moved: boolean } | null = null;
    svg.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      const k = this.view.w / svg.getBoundingClientRect().width;
      this.view.x = drag.vx - dx * k;
      this.view.z = drag.vz - dy * k;
      this.clampView();
      applyView();
    });
    svg.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const p = toWorld(e.clientX, e.clientY);
      if (!p) return;
      this.pick(p.x, p.z, (this.view.w / svg.getBoundingClientRect().width) * 25);
      redraw();
    });
    svg.addEventListener('pointercancel', () => (drag = null));
  }

  private clampView(): void {
    const b = this.bounds;
    const v = this.view;
    v.x = Math.min(Math.max(v.x, b.x - v.w * 0.25), b.x + b.w - v.w * 0.75);
    v.z = Math.min(Math.max(v.z, b.z - v.h * 0.25), b.z + b.h - v.h * 0.75);
  }

  /** Clic sur la carte : rattaché à la route la plus proche, puis ajouté au parcours. */
  private pick(x: number, z: number, tolM: number): void {
    if (!this.net) return;
    const snap = snapToRoad(this.net, x, z, Math.max(60, tolM));
    if (!snap) {
      this.error = fr() ? 'Clique plus près d’une route.' : 'Click closer to a road.';
      return;
    }
    // Départ seulement (parcours libre) : un nouveau clic déplace le départ.
    if (this.startOnly) {
      this.clear();
      this.points.push(snap);
      return;
    }
    // Boucle déjà fermée : un nouveau clic repart de zéro.
    if (this.closed) this.clear();
    this.addPoint(snap);
  }

  /** Ajoute un point : étape calculée depuis le point précédent (refusé si impossible). */
  private addPoint(snap: RoadSnap): void {
    if (!this.net) return;
    const L = fr();
    this.error = '';
    const prev = this.points[this.points.length - 1];
    if (!prev) {
      this.points.push(snap);
      return;
    }
    if (Math.hypot(snap.x - prev.x, snap.z - prev.z) < 30) {
      this.error = L ? 'Point trop près du précédent.' : 'Point too close to the previous one.';
      return;
    }
    const leg = planItinerary(this.net, prev, snap);
    if (!leg) {
      this.error = L ? 'Aucune route praticable jusqu’à ce point.' : 'No rideable road to this point.';
      return;
    }
    this.points.push(snap);
    this.legs.push(leg);
    this.rebuild();
  }

  private undo(): void {
    this.points.pop();
    this.legs.length = Math.max(0, this.points.length - 1);
    this.error = '';
    this.rebuild();
  }

  /** Parcours complet à partir des étapes ; nommé d'après les lieux de départ et d'arrivée. */
  private rebuild(): void {
    this.result = null;
    if (!this.net || !this.legs.length) return;
    const a = this.points[0] as RoadSnap;
    const b = this.points[this.points.length - 1] as RoadSnap;
    const pa = this.nearPlace(a.x, a.z, 2500)?.name;
    const pb = this.nearPlace(b.x, b.z, 2500)?.name;
    const name = this.closed ? (pa ? [`Boucle au départ ${frenchOf(pa)}`, `Loop from ${pa}`] : ['Ma boucle', 'My loop']) : pa && pb && pa !== pb ? [`${frenchOf(pa).replace(/^./, (c) => c.toUpperCase())} ${frenchTo(pb)}`, `From ${pa} to ${pb}`] : ['Mon itinéraire', 'My route'];
    this.result = itineraryRoute(this.net, joinItineraries(this.legs), {
      id: `${ITINERARY_PREFIX}${Date.now().toString(36)}`,
      name: name[0] as string,
      nameEn: name[1] as string,
      ...(this.open?.places ? { places: this.open.places } : {}),
    });
  }
}
