/**
 * Itinéraire sur la carte d'une zone ouverte (fenêtre « Parcours » du menu) : on clique un
 * départ, puis éventuellement une arrivée ; le plus court chemin roulable (routes revêtues de
 * préférence) est calculé sur le graphe routier du monde et devient un parcours comme les
 * autres (aller simple). Sans arrivée : roulage libre depuis ce départ ; ou depuis le départ
 * par défaut de la zone (« Rouler en libre »).
 */
import { isPavedEdge, itineraryRoute, planItinerary, RoadNet, snapToRoad, type RoadGraphData, type RoadSnap, type RouteData } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import './routePlanner.css';

/** Préfixe des parcours calculés (un seul à la fois dans la liste des parcours du monde). */
export const ITINERARY_PREFIX = 'itineraire-';

export interface OpenMap {
  graph: RoadGraphData;
  start: { x: number; z: number };
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
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class RoutePlanner {
  private open: OpenMap | null = null;
  private net: RoadNet | null = null;
  /** Tracé des routes (chemins SVG par classe), calculé une fois par graphe. */
  private roads = '';
  private bounds: View = { x: 0, z: 0, w: 1, h: 1 };
  private view: View = { x: 0, z: 0, w: 1, h: 1 };
  private from: RoadSnap | null = null;
  private to: RoadSnap | null = null;
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
    const m = Math.max(maxX - minX, maxZ - minZ) * 0.03;
    this.bounds = { x: minX - m, z: minZ - m, w: maxX - minX + 2 * m, h: maxZ - minZ + 2 * m };
    this.view = { ...this.bounds };
    this.roads = this.roadPaths(open.graph);
  }

  /** Parcours calculé, s'il y en a un. */
  get route(): RouteData | null {
    return this.result;
  }

  private clear(): void {
    this.from = null;
    this.to = null;
    this.result = null;
    this.error = '';
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

  private roadName(s: RoadSnap): string {
    const e = this.net?.edge(s.edge);
    return e?.name || e?.ref || (fr() ? 'route sans nom' : 'unnamed road');
  }

  private km(m: number): string {
    return (m / 1000).toFixed(1).replace('.', fr() ? ',' : '.');
  }

  /** Repère (taille constante à l'écran : mis à l'échelle de la vue). */
  private marker(x: number, z: number, cls: string, label: string): string {
    return `<g class="rp-mk ${cls}" data-mk transform="translate(${x.toFixed(1)} ${z.toFixed(1)}) scale(${(this.view.w / 600).toFixed(3)})"><circle r="9"/><text y="4">${label}</text></g>`;
  }

  /** Bloc complet : carte cliquable et panneau (consignes, chiffres, boutons). */
  html(routeCard: (r: RouteData) => string): string {
    if (!this.open) return '';
    const L = fr();
    const v = this.view;
    const r = this.result;
    let line = '';
    if (r) {
      const step = Math.max(1, Math.floor(r.points.length / 1500));
      line = `<path class="rp-route" d="${r.points
        .filter((_, i) => i % step === 0 || i === r.points.length - 1)
        .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)} ${p.z.toFixed(0)}`)
        .join('')}"/>`;
    }
    const marks =
      (this.from ? this.marker(this.from.x, this.from.z, 'rp-from', 'D') : this.marker(this.open.start.x, this.open.start.z, 'rp-home', '')) + (this.to ? this.marker(this.to.x, this.to.z, 'rp-to', 'A') : '');
    const hint = this.error
      ? `<p class="rp-err">${esc(this.error)}</p>`
      : `<p class="mm-hint">${
          !this.from
            ? L
              ? 'Clique sur la carte pour choisir ton départ (molette : zoom, glisser : déplacer).'
              : 'Click the map to pick your start (wheel: zoom, drag: pan).'
            : !this.to
              ? L
                ? 'Clique ton arrivée, ou pars d’ici en roulage libre.'
                : 'Click your finish, or ride freely from here.'
              : L
                ? 'Un nouveau clic choisit un autre départ.'
                : 'Click again to pick another start.'
        }</p>`;
    const pts = this.from
      ? `<ol class="rp-pts"><li><i class="rp-dot rp-from"></i>${L ? 'Départ' : 'Start'} · <b>${esc(this.roadName(this.from))}</b></li>${this.to ? `<li><i class="rp-dot rp-to"></i>${L ? 'Arrivée' : 'Finish'} · <b>${esc(this.roadName(this.to))}</b></li>` : ''}</ol>`
      : '';
    const go = (id: string, label: string, cls = '') => `<button class="rp-btn ${cls}" data-plan="${id}">${label}</button>`;
    const actions = [
      r ? go('ride', `${L ? 'Rouler cet itinéraire' : 'Ride this route'} →`, 'rp-go') : '',
      this.from && !this.to ? go('here', `${L ? 'Partir d’ici en libre' : 'Ride freely from here'} →`, 'rp-go') : '',
      go('free', L ? 'Rouler en libre' : 'Free ride', this.from ? '' : 'rp-go'),
      this.from ? go('clear', L ? 'Effacer' : 'Clear') : '',
    ].join('');
    return `<section class="rp" aria-label="${L ? 'Itinéraire sur la carte' : 'Route on the map'}">
      <div class="rp-mapbox">
        <svg class="rp-map" viewBox="${v.x.toFixed(1)} ${v.z.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet">
          <g class="rp-roads">${this.roads}</g>${line}${marks}
        </svg>
        <div class="rp-legend"><span><i class="rp-l-major"></i>${L ? 'route' : 'road'}</span><span><i class="rp-l-track"></i>${L ? 'chemin' : 'track'}</span>${this.from ? '' : `<span><i class="rp-dot rp-home"></i>${L ? 'départ par défaut' : 'default start'}</span>`}</div>
      </div>
      <div class="rp-side">
        <h3>${L ? 'Ton itinéraire' : 'Your route'}</h3>
        ${hint}${pts}
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
        if (id === 'clear') {
          this.clear();
          redraw();
        } else if (id === 'ride' && this.result) act.ride(this.result);
        else if (id === 'here' && this.from) act.free({ x: this.from.x, z: this.from.z });
        else if (id === 'free') act.free(null);
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
      const k = (v.w / 600).toFixed(3);
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
    // Glisser : déplacer la carte ; clic sans glisser : départ ou arrivée.
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

  /** Clic sur la carte : départ, puis arrivée (itinéraire calculé), puis nouveau départ. */
  private pick(x: number, z: number, tolM: number): void {
    if (!this.net) return;
    const L = fr();
    const snap = snapToRoad(this.net, x, z, Math.max(60, tolM));
    if (!snap) {
      this.error = L ? 'Clique plus près d’une route.' : 'Click closer to a road.';
      return;
    }
    this.error = '';
    if (!this.from || this.to) {
      this.from = snap;
      this.to = null;
      this.result = null;
      return;
    }
    this.to = snap;
    this.result = null;
    const it = planItinerary(this.net, this.from, snap);
    const route = it
      ? itineraryRoute(this.net, it, {
          id: `${ITINERARY_PREFIX}${Date.now().toString(36)}`,
          name: 'Mon itinéraire',
          nameEn: 'My route',
        })
      : null;
    if (!route) {
      this.error = it ? (L ? 'Arrivée trop près du départ.' : 'Finish too close to the start.') : L ? 'Aucune route praticable entre ces deux points.' : 'No rideable road between these two points.';
      this.to = null;
      return;
    }
    this.result = route;
  }
}
