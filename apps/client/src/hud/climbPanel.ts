import { climbAhead, climbElevation, detectClimbs, drawClimbProfile, gradeColor, type Climb, type ClimbAhead, type RouteTrack } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';

/** Le panneau apparaît 500 m avant le pied de la montée. */
const APPROACH_M = 500;

function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Panneau de montée du HUD, façon ClimbPro (Garmin Edge), comme sur l'appli compagnon : à
 * l'approche d'une côte, à la place du profil du parcours en bas de l'écran, profil découpé en tronçons colorés par pente avec leur pourcentage,
 * distance et dénivelé restants ; bilan (temps, VAM) au sommet. Montées détectées sur
 * l'itinéraire (monde ouvert : sur le chemin connu devant le coureur, revu au fil de la sortie).
 */
export class ClimbPanel {
  private climbs: Climb[] = [];
  private detectedAt = -Infinity;
  private detectedLen = -1;
  private current: ClimbAhead | null = null;
  /** Sommet de la montée suivie (m sur la route) et position au premier passage dans la pente. */
  private end: number | null = null;
  private t0: { elapsedS: number; pos: number } | null = null;
  private lastRouteM: number | null = null;
  private backwards = false;
  private key = '';
  private readonly canvas: HTMLCanvasElement;

  /** Bilan au sommet. */
  onSummit?: (text: string) => void;

  constructor(
    private readonly box: HTMLElement,
    private readonly track: RouteTrack,
    private readonly open: () => boolean,
  ) {
    box.innerHTML = `<div class="cp-info">
        <div class="cp-head"><b data-c="title"></b><span data-c="status"></span></div>
        <div class="cp-stats"><div><span data-c="lLeft"></span><b class="num" data-c="left"></b></div><div><span data-c="lGain"></span><b class="num" data-c="gain"></b></div><div><span data-c="lAvg"></span><b class="num" data-c="avg"></b></div></div>
        <div class="cp-seg num"><i data-c="segDot"></i><span data-c="seg"></span></div>
        <div class="cp-sum num" data-c="sum"></div>
      </div>
      <canvas></canvas>`;
    this.canvas = box.querySelector('canvas') as HTMLCanvasElement;
  }

  private q(k: string): HTMLElement {
    return this.box.querySelector(`[data-c="${k}"]`) as HTMLElement;
  }

  /** Détection : une fois pour un itinéraire, régulièrement en monde ouvert (le chemin s'allonge). */
  private detect(routeM: number, elapsedS: number): void {
    const pts = this.track.route.points;
    const elevAt = (d: number) => this.track.sample(d).y;
    if (this.open()) {
      if (this.detectedLen === pts.length && elapsedS - this.detectedAt < 5) return;
      const from = Math.max(pts[0]?.d ?? 0, routeM - 1500);
      this.climbs = detectClimbs(elevAt, from, this.track.length, { openEnd: true });
    } else {
      if (this.detectedLen >= 0) return;
      if (this.track.route.loop) {
        // Boucle parcourue depuis son point le plus bas : aucune montée n'y est coupée.
        let lo = 0;
        pts.forEach((p, i) => p.y < (pts[lo]?.y ?? Infinity) && (lo = i));
        const from = pts[lo]?.d ?? 0;
        this.climbs = detectClimbs(elevAt, from, from + this.track.length);
      } else this.climbs = detectClimbs(elevAt, 0, this.track.length);
    }
    this.detectedLen = pts.length;
    this.detectedAt = elapsedS;
  }

  /** Renvoie vrai quand le panneau est affiché. */
  update(routeM: number, elapsedS: number): boolean {
    this.detect(routeM, elapsedS);
    if (this.lastRouteM !== null) {
      // Sens de marche (demi-tour : pas de montées) ; les sauts de tour de boucle sont ignorés.
      const dm = routeM - this.lastRouteM;
      if (dm < -1 && dm > -500) this.backwards = true;
      else if (dm > 1 && dm < 500) this.backwards = false;
    }
    this.lastRouteM = routeM;
    const open = this.open();
    const a = this.backwards ? null : climbAhead(this.climbs, routeM, { loop: !open && this.track.route.loop, lengthM: this.track.length });
    const cur = a && a.pos >= -APPROACH_M ? a : null;
    const start = cur ? routeM - cur.pos : null;
    const fr = getLang() === 'fr';
    const nf = (v: number, d = 0) => v.toLocaleString(fr ? 'fr' : 'en', { minimumFractionDigits: d, maximumFractionDigits: d });
    // Changement de montée (ou plus de montée) : la précédente a-t-elle été gravie ?
    if (this.end !== null && (start === null || start > this.end - 1)) {
      const prev = this.current;
      if (prev && this.t0 && routeM >= this.end - 30) {
        const dt = elapsedS - this.t0.elapsedS;
        const gain = Math.max(0, prev.climb.topM - climbElevation(prev.climb, Math.max(this.t0.pos, 0)));
        const vam = dt > 0 ? Math.round((gain * 3600) / dt) : 0;
        this.onSummit?.(`⛰ ${fr ? 'Sommet !' : 'Summit!'} ${fmtTime(dt)} · +${nf(gain)} m · VAM ${nf(vam)} m/h`);
      }
      this.t0 = null;
    }
    if (cur && cur.pos >= 0 && !this.t0) this.t0 = { elapsedS, pos: cur.pos };
    this.end = start !== null && cur ? start + cur.climb.lengthM : null;
    this.current = cur;
    this.box.classList.toggle('hidden', !cur);
    if (cur) this.render(cur, fr, nf);
    return !!cur;
  }

  private render(a: ClimbAhead, fr: boolean, nf: (v: number, d?: number) => string): void {
    const c = a.climb;
    const p = Math.min(Math.max(a.pos, 0), c.lengthM);
    const leftM = c.lengthM - p;
    const gainLeft = Math.max(0, c.topM - climbElevation(c, p));
    const ge = c.openEnd ? '≥ ' : '';
    const dist = (m: number, d = 2) => (m < 1000 ? `${Math.round(Math.max(0, m) / 10) * 10} m` : `${nf(m / 1000, d)} km`);
    const key = `${fr}|${c.segments.map((s) => s.grade.toFixed(1)).join(',')}`;
    if (key !== this.key) {
      this.key = key;
      const n = this.open() ? 1 : this.climbs.length;
      this.q('title').textContent = `⛰ ${fr ? 'Montée' : 'Climb'}${n > 1 ? ` ${a.index + 1}/${n}` : ''}`;
      this.q('lLeft').textContent = fr ? 'Reste' : 'To go';
      this.q('lGain').textContent = fr ? 'D+ restant' : 'Ascent left';
      this.q('lAvg').textContent = fr ? 'Moy. restante' : 'Avg to go';
      this.q('sum').textContent = `${ge}${nf(c.lengthM / 1000, 1)} km · ${nf(c.avgGrade, 1)} % · max ${nf(c.maxGrade, 1)} % · ${ge}+${nf(c.gainM)} m`;
    }
    this.q('status').textContent = a.pos < 0 ? `${fr ? 'pied dans' : 'starts in'} ${dist(-a.pos)}` : `${fr ? 'en montée' : 'climbing'} · ${Math.round((p / c.lengthM) * 100)} %`;
    this.q('left').textContent = ge + dist(leftM);
    this.q('gain').textContent = `${ge}${nf(gainLeft)} m`;
    this.q('avg').textContent = leftM > 50 ? `${nf((gainLeft / leftM) * 100, 1)} %` : '–';
    // Tronçon en cours : pente, distance jusqu'au suivant.
    const seg = c.segments.find((s) => p < s.to) ?? (c.segments[c.segments.length - 1] as Climb['segments'][number]);
    this.q('segDot').style.background = gradeColor(seg.grade);
    this.q('seg').textContent = `${fr ? 'Tronçon' : 'Section'} ${nf(seg.grade, 1)} % · ${dist(seg.to - p)}`;
    // Canvas à la taille affichée (netteté sur écran haute densité).
    const cv = this.canvas;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawClimbProfile(ctx, w, h, c, a.pos, nf);
  }
}
