/**
 * Carte complète du monde ouvert, ouverte d'un clic sur la mini-carte : tout le réseau, les lieux, le
 * coureur et le chemin prévu. On y choisit une destination (clic sur une route ou sur un lieu de la
 * liste) : « Y aller à vélo » guide jusque-là au fil des carrefours, « Repartir d'ici » relance une
 * sortie sur place. Molette : zoom, glisser : se déplacer, Échap : fermer.
 */
import type { RoadGraphData, WorldPlace } from '@allezrobert/shared';
import './worldMap.css';

type Box = { minX: number; minZ: number; maxX: number; maxZ: number };

export interface WorldMapPick {
  x: number;
  z: number;
  /** Nom affiché (lieu proche, route). */
  name: string;
}

export interface WorldMapOptions {
  graph: RoadGraphData;
  places: readonly WorldPlace[];
  bounds: Box;
  /** Image de la carte couvrant `bounds` (mondes générés) ; sinon le réseau seul sur fond sombre. */
  image?: string;
  fr: boolean;
  /** Point de route roulable le plus proche (null : trop loin d'une route). */
  snap: (x: number, z: number) => WorldMapPick | null;
  onGo: (p: WorldMapPick) => void;
  onRestart: (p: WorldMapPick) => void;
  onClear: () => void;
}

export interface WorldMapState {
  me: { x: number; z: number };
  /** Chemin prévu devant le coureur, [x0, z0, x1, z1, …]. */
  ahead: number[];
  destination: { x: number; z: number; name: string } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
const PAVED = /^(asphalt|paved|concrete|chipseal)/;
const PLACE_RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3, locality: 4 };

export class WorldMap {
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private img: HTMLImageElement | null = null;
  private view = { cx: 0, cz: 0, mPerPx: 20 };
  private state: WorldMapState | null = null;
  private pick: WorldMapPick | null = null;
  private keys = (e: KeyboardEvent) => this.onKey(e);
  private resize = () => this.draw();
  /** Ouverte : le jeu ne prend pas les touches. */
  get isOpen(): boolean {
    return !!this.root;
  }

  constructor(private readonly o: WorldMapOptions) {
    if (o.image) {
      this.img = new Image();
      this.img.onload = () => this.draw();
      this.img.src = o.image;
    }
  }

  open(state: WorldMapState, host: HTMLElement = document.body): void {
    this.close();
    this.state = state;
    this.pick = null;
    const L = this.o.fr;
    const root = document.createElement('div');
    root.className = 'wm-overlay';
    const places = [...this.o.places].sort((a, b) => (PLACE_RANK[a.kind] ?? 5) - (PLACE_RANK[b.kind] ?? 5) || a.name.localeCompare(b.name));
    root.innerHTML = `<div class="wm-panel">
      <header><h2>${L ? 'Carte' : 'Map'}</h2><button class="wm-x" data-wm-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
      <p class="wm-hint">${L ? 'Clique sur une route pour choisir où aller. Molette : zoom, glisser : se déplacer.' : 'Click a road to choose where to go. Scroll to zoom, drag to move.'}</p>
      <div class="wm-dest"></div>
      <h3>${L ? 'Lieux' : 'Places'}</h3>
      <div class="wm-places">${places.map((p, i) => `<button data-wm-place="${i}"><b>${esc(p.name)}</b><span>${esc(kindLabel(p.kind, L))}</span></button>`).join('')}</div>
    </div>
    <div class="wm-stage"><canvas></canvas><div class="wm-card" hidden></div>
      <div class="wm-tools"><button data-wm-zoom="1" aria-label="+">+</button><button data-wm-zoom="-1" aria-label="−">−</button><button data-wm-me>${L ? 'Moi' : 'Me'}</button><button data-wm-all>${L ? 'Tout' : 'All'}</button></div>
    </div>`;
    host.appendChild(root);
    this.root = root;
    this.canvas = root.querySelector('canvas');
    this.fitAll();
    this.renderDest();
    root.querySelectorAll('[data-wm-close]').forEach((b) => b.addEventListener('click', () => this.close()));
    root.addEventListener('pointerdown', (e) => e.target === root && this.close());
    root.querySelectorAll<HTMLElement>('[data-wm-place]').forEach((b) =>
      b.addEventListener('click', () => {
        const p = places[Number(b.dataset.wmPlace)];
        if (!p) return;
        const s = this.o.snap(p.x, p.z);
        if (!s) return;
        this.choose({ ...s, name: p.name });
        this.view.cx = s.x;
        this.view.cz = s.z;
        this.view.mPerPx = Math.min(this.view.mPerPx, 12);
        this.draw();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-wm-zoom]').forEach((b) => b.addEventListener('click', () => this.zoom(Number(b.dataset.wmZoom) > 0 ? 0.6 : 1 / 0.6)));
    root.querySelector('[data-wm-me]')?.addEventListener('click', () => {
      this.view.cx = state.me.x;
      this.view.cz = state.me.z;
      this.view.mPerPx = Math.min(this.view.mPerPx, 6);
      this.draw();
    });
    root.querySelector('[data-wm-all]')?.addEventListener('click', () => {
      this.fitAll();
      this.draw();
    });
    this.bindStage();
    window.addEventListener('keydown', this.keys, true);
    window.addEventListener('resize', this.resize);
    requestAnimationFrame(() => this.draw());
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.canvas = null;
    window.removeEventListener('keydown', this.keys, true);
    window.removeEventListener('resize', this.resize);
  }

  /** Nouvelle position du coureur et nouveau chemin pendant que la carte est ouverte. */
  update(state: WorldMapState): void {
    this.state = state;
    if (this.root) this.draw();
  }

  private onKey(e: KeyboardEvent): void {
    // Carte ouverte : les touches ne vont pas au jeu (Échap ferme la carte au lieu de mettre en pause).
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      this.close();
    }
  }

  private fitAll(): void {
    const b = this.o.bounds;
    const c = this.canvas;
    const w = c?.clientWidth || 1000;
    const h = c?.clientHeight || 700;
    this.view = { cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, mPerPx: Math.max((b.maxX - b.minX) / w, (b.maxZ - b.minZ) / h) * 1.04 };
  }

  private zoom(f: number, at?: { x: number; y: number }): void {
    const c = this.canvas;
    if (!c) return;
    const b = this.o.bounds;
    const max = Math.max((b.maxX - b.minX) / c.clientWidth, (b.maxZ - b.minZ) / c.clientHeight) * 1.6;
    const m = Math.min(max, Math.max(0.6, this.view.mPerPx * f));
    if (at) {
      // Le point sous le pointeur reste en place.
      const wx = this.view.cx + (at.x - c.clientWidth / 2) * this.view.mPerPx;
      const wz = this.view.cz + (at.y - c.clientHeight / 2) * this.view.mPerPx;
      this.view.cx = wx - (at.x - c.clientWidth / 2) * m;
      this.view.cz = wz - (at.y - c.clientHeight / 2) * m;
    }
    this.view.mPerPx = m;
    this.draw();
  }

  private bindStage(): void {
    const c = this.canvas;
    if (!c) return;
    let drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      this.zoom(Math.exp(e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false };
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      c.classList.add('wm-dragging');
      this.view.cx = drag.cx - dx * this.view.mPerPx;
      this.view.cz = drag.cz - dy * this.view.mPerPx;
      this.draw();
    });
    c.addEventListener('pointerup', (e) => {
      const d = drag;
      drag = null;
      c.classList.remove('wm-dragging');
      if (!d || d.moved) return;
      const r = c.getBoundingClientRect();
      const x = this.view.cx + (e.clientX - r.left - c.clientWidth / 2) * this.view.mPerPx;
      const z = this.view.cz + (e.clientY - r.top - c.clientHeight / 2) * this.view.mPerPx;
      // Rattachement à la route la plus proche, à 25 px près à l'écran (au moins 40 m).
      const s = this.o.snap(x, z);
      if (s && Math.hypot(s.x - x, s.z - z) <= Math.max(40, 25 * this.view.mPerPx)) this.choose(s);
      else this.choose(null);
    });
  }

  private choose(p: WorldMapPick | null): void {
    this.pick = p;
    this.draw();
  }

  /** Bandeau « destination en cours » du panneau. */
  private renderDest(): void {
    const el = this.root?.querySelector<HTMLElement>('.wm-dest');
    const d = this.state?.destination;
    if (!el) return;
    const L = this.o.fr;
    el.innerHTML = d ? `<span>${L ? 'Destination' : 'Destination'}</span><b>${esc(d.name)}</b><button data-wm-clear>${L ? 'Annuler le guidage' : 'Cancel guidance'}</button>` : `<span>${L ? 'Parcours libre : tout droit à chaque carrefour, ← / → pour tourner.' : 'Free ride: straight on at each junction, ← / → to turn.'}</span>`;
    el.querySelector('[data-wm-clear]')?.addEventListener('click', () => {
      this.o.onClear();
      if (this.state) this.state = { ...this.state, destination: null };
      this.renderDest();
      this.draw();
    });
  }

  private draw(): void {
    const c = this.canvas;
    const st = this.state;
    if (!c || !st) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = this.view;
    const P = (x: number, z: number): [number, number] => [W / 2 + (x - v.cx) / v.mPerPx, H / 2 + (z - v.cz) / v.mPerPx];
    ctx.fillStyle = 'rgb(40, 90, 150)';
    ctx.fillRect(0, 0, W, H);
    const b = this.o.bounds;
    const img = this.img;
    if (img?.complete && img.naturalWidth) {
      const [x0, y0] = P(b.minX, b.minZ);
      const [x1, y1] = P(b.maxX, b.maxZ);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.fillStyle = '#141a24';
      ctx.fillRect(0, 0, W, H);
    }
    // Réseau : toujours sans image ; avec l'image, seulement de près (l'image le montre déjà de loin).
    const showNet = !img || v.mPerPx < 12;
    const view = { minX: v.cx - (W / 2) * v.mPerPx, maxX: v.cx + (W / 2) * v.mPerPx, minZ: v.cz - (H / 2) * v.mPerPx, maxZ: v.cz + (H / 2) * v.mPerPx };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (showNet)
      for (const e of this.o.graph.edges) {
        const p = e.pts;
        let inside = false;
        for (let i = 0; i < p.length && !inside; i += 3 * Math.max(1, Math.floor(p.length / 30)))
          inside = (p[i] as number) > view.minX - 200 && (p[i] as number) < view.maxX + 200 && (p[i + 2] as number) > view.minZ - 200 && (p[i + 2] as number) < view.maxZ + 200;
        if (!inside) continue;
        const paved = PAVED.test(e.surface) && e.kind !== 'track';
        const big = /^(primary|secondary|trunk)/.test(e.kind);
        ctx.strokeStyle = !paved ? 'rgba(150,95,45,0.95)' : e.kind === 'cycleway' ? 'rgba(40,150,70,0.95)' : big ? 'rgba(210,70,50,0.95)' : 'rgba(250,250,250,0.95)';
        ctx.lineWidth = Math.max(1.2, Math.min(7, (big ? 9 : 6) / v.mPerPx));
        ctx.setLineDash(paved ? [] : [5, 4]);
        ctx.beginPath();
        for (let i = 0; i < p.length; i += 3) {
          const [x, y] = P(p[i] as number, p[i + 2] as number);
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    ctx.setLineDash([]);
    // Chemin prévu devant le coureur.
    if (st.ahead.length >= 4) {
      ctx.beginPath();
      for (let i = 0; i < st.ahead.length; i += 2) {
        const [x, y] = P(st.ahead[i] as number, st.ahead[i + 1] as number);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = 'rgba(10,14,22,0.8)';
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    // Lieux.
    ctx.textAlign = 'center';
    for (const p of this.o.places) {
      const rank = PLACE_RANK[p.kind] ?? 5;
      if (rank >= 3 && v.mPerPx > 15) continue;
      const [x, y] = P(p.x, p.z);
      if (x < -100 || y < -30 || x > W + 100 || y > H + 30) continue;
      ctx.font = `${rank <= 1 ? 800 : 700} ${rank <= 1 ? 15 : rank === 2 ? 13 : 11.5}px system-ui, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(10,14,22,0.85)';
      ctx.strokeText(p.name, x, y - 7);
      ctx.fillStyle = '#fff';
      ctx.fillText(p.name, x, y - 7);
      ctx.beginPath();
      ctx.arc(x, y, rank <= 1 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Destination en cours et point choisi.
    const flag = (x: number, z: number, color: string) => {
      const [px, py] = P(x, z);
      ctx.strokeStyle = '#0a0e16';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 26);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px, py - 26);
      ctx.lineTo(px + 16, py - 20);
      ctx.lineTo(px, py - 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    if (st.destination) flag(st.destination.x, st.destination.z, '#22c55e');
    if (this.pick) flag(this.pick.x, this.pick.z, '#ffd23f');
    // Coureur.
    const [mx, my] = P(st.me.x, st.me.z);
    ctx.beginPath();
    ctx.arc(mx, my, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0a0e16';
    ctx.stroke();
    this.renderCard(P);
  }

  /** Carte du point choisi, posée à côté de lui. */
  private renderCard(P: (x: number, z: number) => [number, number]): void {
    const card = this.root?.querySelector<HTMLElement>('.wm-card');
    if (!card) return;
    const p = this.pick;
    if (!p) {
      card.hidden = true;
      return;
    }
    const L = this.o.fr;
    const me = this.state?.me;
    const km = me ? Math.hypot(p.x - me.x, p.z - me.z) / 1000 : 0;
    const key = `${p.x},${p.z}`;
    if (card.dataset.key !== key) {
      card.dataset.key = key;
      card.innerHTML = `<b>${esc(p.name)}</b><span>${L ? 'à' : ''} ${km.toFixed(1).replace('.', L ? ',' : '.')} km ${L ? "à vol d'oiseau" : 'as the crow flies'}</span>
        <button class="wm-go" data-wm-go>${L ? 'Y aller à vélo' : 'Ride there'}</button>
        <button data-wm-restart>${L ? 'Repartir d’ici (nouvelle sortie)' : 'Start a new ride here'}</button>`;
      card.querySelector('[data-wm-go]')?.addEventListener('click', () => {
        this.o.onGo(p);
        this.close();
      });
      card.querySelector('[data-wm-restart]')?.addEventListener('click', () => this.o.onRestart(p));
    }
    card.hidden = false;
    const [x, y] = P(p.x, p.z);
    const W = this.canvas?.clientWidth ?? 0;
    card.style.left = `${Math.max(8, Math.min(W - 250, x + 22))}px`;
    card.style.top = `${Math.max(8, y - 40)}px`;
  }
}

function kindLabel(kind: string, fr: boolean): string {
  const m: Record<string, [string, string]> = { city: ['ville', 'city'], town: ['ville', 'town'], village: ['village', 'village'], hamlet: ['hameau', 'hamlet'], locality: ['lieu-dit', 'locality'] };
  const v = m[kind];
  return v ? v[fr ? 0 : 1] : kind;
}
