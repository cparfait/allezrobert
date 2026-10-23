/**
 * Carte de France du menu (fenêtre « Zones ») : contour du pays sur fond transparent, un point
 * par zone à sa vraie place (Lambert-93), nom au survol. Les zones trop proches à l'échelle de
 * la France (Paris, Puy-de-Dôme) sont réunies en un point numéroté ; un clic zoome dessus et les
 * sépare. Zone pas encore publiée : point grisé, « bientôt ».
 */
import { wgs84ToL93 } from '@allezrobert/shared';
import { FRANCE_OUTLINE } from '../world/franceOutline.ts';
import { BASEMAP_ATTRIBUTION, basemapImage } from './basemap.ts';
import { getLang } from '../i18n/index.ts';
import './franceMap.css';

export interface MapZone {
  id: string;
  name: string;
  region: string;
  /** Lambert-93 (m). */
  x: number;
  y: number;
  /** Publiée (dans le catalogue des zones) : cliquable. */
  available: boolean;
  current: boolean;
  /** Ligne d'information sous le nom (parcours, monde ouvert…). */
  info: string;
  /** Emprise des tuiles, Lambert-93 (m) : rectangle dessiné sur la carte zoomée. */
  rect?: { minE: number; minN: number; maxE: number; maxN: number };
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const fr = () => getLang() === 'fr';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** Repère SVG en km : x vers l'est, y vers le sud (Lambert-93 retourné). */
const sx = (x: number) => x / 1000;
const sy = (y: number) => -y / 1000;
/** Largeur d'affichage visée (px) : taille des points et distance de regroupement. */
const PX_W = 620;
/** Deux zones à moins de ce nombre de pixels l'une de l'autre sont réunies. */
const MERGE_PX = 26;

const FULL: View = { x: 80, y: -7140, w: 1190, h: 1120 };
/** Largeur de vue la plus petite (km) en zoomant à la molette, la plus grande en dézoomant. */
const MIN_W = 12;
const MAX_W = FULL.w * 1.3;

/** Marge du fond de carte autour de la vue (fraction) : la boîte peut être plus large que le viewBox. */
const BASEMAP_PAD = 0.25;

/** Fond Plan IGN de la vue zoomée (repère SVG en km, y = −N). */
function basemap(v: View): string {
  const px = v.w * BASEMAP_PAD;
  const py = v.h * BASEMAP_PAD;
  const at = { x: v.x - px, y: v.y - py, w: v.w + 2 * px, h: v.h + 2 * py };
  return basemapImage({ minE: at.x * 1000, minN: -(at.y + at.h) * 1000, maxE: (at.x + at.w) * 1000, maxN: -at.y * 1000 }, at, 1400);
}

export class FranceMap {
  private view: View = { ...FULL };
  private outline = '';
  private anim = 0;
  /** Fond de carte de la vue précédente, gardé dessous le temps que le nouveau se charge. */
  private lastBase = '';
  /** Le dernier geste était un glissement (pas un clic sur un point). */
  private dragged = false;

  /** Retour à la France entière (nouvelle ouverture de la fenêtre). */
  reset(): void {
    this.view = { ...FULL };
  }

  private get zoomed(): boolean {
    return this.view.w < FULL.w * 0.6;
  }

  /** Vue déplacée ou zoomée (bouton « France entière »). */
  private get moved(): boolean {
    const v = this.view;
    return Math.abs(v.w - FULL.w) > 1 || Math.abs(v.x - FULL.x) > 1 || Math.abs(v.y - FULL.y) > 1;
  }

  private outlinePath(): string {
    if (this.outline) return this.outline;
    this.outline = FRANCE_OUTLINE.map(
      (ring) =>
        ring
          .map(([lon, lat], i) => {
            const p = wgs84ToL93(lon, lat);
            return `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
          })
          .join('') + 'Z',
    ).join('');
    return this.outline;
  }

  /** Regroupement des zones proches à l'échelle de la vue. */
  private clusters(zones: MapZone[]): MapZone[][] {
    const lim = (MERGE_PX * this.view.w) / PX_W;
    const groups: Array<{ cx: number; cy: number; z: MapZone[] }> = [];
    for (const z of zones) {
      const g = groups.find((c) => Math.hypot(c.cx - sx(z.x), c.cy - sy(z.y)) < lim);
      if (!g) groups.push({ cx: sx(z.x), cy: sy(z.y), z: [z] });
      else {
        g.z.push(z);
        g.cx = g.z.reduce((s, q) => s + sx(q.x), 0) / g.z.length;
        g.cy = g.z.reduce((s, q) => s + sy(q.y), 0) / g.z.length;
      }
    }
    return groups.map((g) => g.z);
  }

  private k(): string {
    return (this.view.w / PX_W).toFixed(4);
  }

  html(zones: MapZone[]): string {
    const L = fr();
    const v = this.view;
    const k = this.k();
    const pts = this.clusters(zones)
      .map((g, gi) => {
        if (g.length === 1) {
          const z = g[0] as MapZone;
          const tip = `${z.name}${z.current ? (L ? ' · zone actuelle' : ' · current area') : ''}\n${z.available ? z.info : L ? 'Bientôt disponible' : 'Coming soon'}`;
          return `<g class="fm-pt${z.available ? '' : ' fm-off'}${z.current ? ' fm-cur' : ''}" data-zone="${esc(z.id)}" data-tip="${esc(tip)}" transform="translate(${sx(z.x).toFixed(1)} ${sy(z.y).toFixed(1)}) scale(${k})" tabindex="0" role="button" aria-label="${esc(z.name)}">
            ${z.available ? '<circle class="fm-pulse" r="7"/>' : ''}<circle class="fm-hit" r="16"/><circle class="fm-dot" r="7"/>${this.zoomed ? `<text x="12" y="4.5">${esc(z.name)}</text>` : ''}</g>`;
        }
        const cx = g.reduce((s, q) => s + sx(q.x), 0) / g.length;
        const cy = g.reduce((s, q) => s + sy(q.y), 0) / g.length;
        const regions = [...new Set(g.map((q) => q.region))];
        const n = g.filter((q) => q.available).length;
        const tip = `${regions.length === 1 ? regions[0] : L ? 'Plusieurs zones' : 'Several areas'} · ${g.length} ${L ? 'zones' : 'areas'}\n${g.map((q) => q.name).join(', ')}\n${L ? 'Clique pour zoomer' : 'Click to zoom in'}`;
        return `<g class="fm-cl${n ? '' : ' fm-off'}${g.some((q) => q.current) ? ' fm-cur' : ''}" data-cluster="${gi}" data-ids="${esc(g.map((q) => q.id).join(','))}" data-tip="${esc(tip)}" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${k})" tabindex="0" role="button">
          <circle class="fm-hit" r="20"/><circle class="fm-dot" r="12"/><text y="4.5">${g.length}</text></g>`;
      })
      .join('');
    return `<div class="fm-box${this.zoomed ? ' fm-zoomed' : ''}">
      <svg class="fm-map" viewBox="${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}" preserveAspectRatio="xMidYMid meet">
        ${this.baseLayers(v)}
        <path class="fm-land" d="${this.outlinePath()}"/>
        ${this.zoomed ? `<g class="fm-rects">${zones
          .filter((z) => z.rect && z.available)
          .map((z) => {
            const r = z.rect!;
            return `<rect class="fm-rect${z.current ? ' fm-cur' : ''}" x="${sx(r.minE).toFixed(2)}" y="${sy(r.maxN).toFixed(2)}" width="${((r.maxE - r.minE) / 1000).toFixed(2)}" height="${((r.maxN - r.minN) / 1000).toFixed(2)}"/>`;
          })
          .join('')}</g>` : ''}
        <g class="fm-pts">${pts}</g>
      </svg>
      <div class="fm-tip" hidden></div>
      <button class="fm-back" data-fm-back ${this.moved ? '' : 'hidden'}>← ${L ? 'France entière' : 'Whole France'}</button>
      <div class="fm-attr">${BASEMAP_ATTRIBUTION}</div>
      <div class="fm-legend"><span><i class="fm-l-on"></i>${L ? 'disponible' : 'available'}</span><span><i class="fm-l-off"></i>${L ? 'bientôt' : 'coming soon'}</span></div>
    </div>`;
  }

  /** Fond Plan IGN de la vue, par-dessus celui de la vue précédente (déjà chargé : pas de trou). */
  private baseLayers(v: View): string {
    const base = basemap(v);
    const prev = this.lastBase && this.lastBase !== base ? this.lastBase : '';
    this.lastBase = base;
    return prev + base;
  }

  /** Événements (survol, zoom sur un groupe, choix d'une zone, glisser, molette) ; la carte se redessine sur place. */
  bind(scope: ParentNode, zones: MapZone[], onPick: (id: string) => void): void {
    const box = scope.querySelector<HTMLElement>('.fm-box');
    const svg = box?.querySelector<SVGSVGElement>('.fm-map');
    const tip = box?.querySelector<HTMLElement>('.fm-tip');
    if (!box || !svg || !tip) return;
    const redraw = () => {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.html(zones);
      const fresh = tmp.firstElementChild;
      if (!fresh) return;
      box.replaceWith(fresh);
      this.bind(fresh.parentNode ?? scope, zones, onPick);
    };
    /** Vue courante appliquée sans tout redessiner (glisser, molette, animation). */
    const apply = () => {
      const v = this.view;
      svg.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
      const k = this.k();
      svg.querySelectorAll<SVGGElement>('.fm-pts > g').forEach((g) => g.setAttribute('transform', (g.getAttribute('transform') ?? '').replace(/scale\([^)]*\)/, `scale(${k})`)));
    };
    const zoomTo = (target: View) => {
      cancelAnimationFrame(this.anim);
      tip.hidden = true;
      const from = { ...this.view };
      const t0 = performance.now();
      let done = false;
      // Animation suspendue (onglet en arrière-plan) : on saute directement à la vue visée.
      setTimeout(() => {
        if (done) return;
        cancelAnimationFrame(this.anim);
        done = true;
        this.view = { ...target };
        redraw();
      }, 600);
      const step = (now: number) => {
        if (done) return;
        const t = Math.min(1, (now - t0) / 380);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        this.view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
        apply();
        if (t < 1) this.anim = requestAnimationFrame(step);
        else {
          done = true;
          redraw();
        }
      };
      this.anim = requestAnimationFrame(step);
    };
    const show = (el: Element, e: PointerEvent | FocusEvent) => {
      const lines = (el.getAttribute('data-tip') ?? '').split('\n');
      tip.innerHTML = `<b>${esc(lines[0] ?? '')}</b>${lines
        .slice(1)
        .map((l) => `<span>${esc(l)}</span>`)
        .join('')}`;
      tip.hidden = false;
      const r = box.getBoundingClientRect();
      const p = 'clientX' in e ? { x: e.clientX, y: e.clientY } : (() => {
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y };
      })();
      tip.style.left = `${Math.min(p.x - r.left + 14, r.width - tip.offsetWidth - 8)}px`;
      tip.style.top = `${Math.max(8, p.y - r.top - tip.offsetHeight - 10)}px`;
    };
    svg.querySelectorAll<SVGGElement>('[data-tip]').forEach((el) => {
      el.addEventListener('pointermove', (e) => show(el, e));
      el.addEventListener('focus', (e) => show(el, e));
      el.addEventListener('pointerleave', () => (tip.hidden = true));
      el.addEventListener('blur', () => (tip.hidden = true));
      const act = () => {
        // fin d'un glissement commencé sur un point : pas un clic
        if (this.dragged) {
          this.dragged = false;
          return;
        }
        const ids = el.getAttribute('data-ids');
        if (ids) {
          // Groupe : zoom sur l'emprise de ses zones, assez près pour les séparer (≥ 30 km de large).
          const g = zones.filter((z) => ids.split(',').includes(z.id));
          const xs = g.map((z) => sx(z.x));
          const ys = g.map((z) => sy(z.y));
          const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
          const w = Math.min(FULL.w, Math.max(30, spread * 3));
          const h = (w * FULL.h) / FULL.w;
          zoomTo({ x: (Math.min(...xs) + Math.max(...xs)) / 2 - w / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - h / 2, w, h });
          return;
        }
        const z = zones.find((q) => q.id === el.getAttribute('data-zone'));
        if (z?.available) onPick(z.id);
      };
      el.addEventListener('click', act);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          act();
        }
      });
    });
    box.querySelector('[data-fm-back]')?.addEventListener('click', () => zoomTo({ ...FULL }));

    // Navigation libre : glisser pour se déplacer, molette pour zoomer (autour du pointeur) ; la
    // carte (regroupements, noms, fond IGN) se redessine quand le geste s'arrête.
    let settle = 0;
    const settleRedraw = () => {
      clearTimeout(settle);
      settle = window.setTimeout(redraw, 280);
    };
    /** Unités SVG (km) par pixel écran (viewBox « meet » : l'axe le plus contraint). */
    const kmPerPx = () => {
      const r = svg.getBoundingClientRect();
      return Math.max(this.view.w / Math.max(1, r.width), this.view.h / Math.max(1, r.height));
    };
    /** Le centre de la vue reste sur la France. */
    const clampView = (v: View): View => {
      const cx = Math.min(FULL.x + FULL.w, Math.max(FULL.x, v.x + v.w / 2));
      const cy = Math.min(FULL.y + FULL.h, Math.max(FULL.y, v.y + v.h / 2));
      return { x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h };
    };
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        cancelAnimationFrame(this.anim);
        tip.hidden = true;
        const v = this.view;
        const r = svg.getBoundingClientRect();
        const s = kmPerPx();
        const px = v.x + v.w / 2 + (e.clientX - (r.left + r.width / 2)) * s;
        const py = v.y + v.h / 2 + (e.clientY - (r.top + r.height / 2)) * s;
        const w = Math.min(MAX_W, Math.max(MIN_W, v.w * Math.exp(e.deltaY * 0.0015)));
        const f = w / v.w;
        this.view = clampView({ x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: v.h * f });
        apply();
        settleRedraw();
      },
      { passive: false },
    );
    let drag: { x: number; y: number; vx: number; vy: number } | null = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      this.dragged = false;
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!this.dragged) {
        if (Math.hypot(dx, dy) < 5) return;
        this.dragged = true;
        cancelAnimationFrame(this.anim);
        tip.hidden = true;
        svg.classList.add('fm-dragging');
        svg.setPointerCapture(e.pointerId);
      }
      const s = kmPerPx();
      this.view = clampView({ ...this.view, x: drag.vx - dx * s, y: drag.vy - dy * s });
      apply();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      svg.classList.remove('fm-dragging');
      if (this.dragged) settleRedraw();
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }
}
