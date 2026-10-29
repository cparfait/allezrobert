/**
 * Montées façon ClimbPro (compteurs Garmin Edge) : détection des côtes sur un profil d'altitude,
 * découpage en tronçons réguliers colorés par pente, montée en cours ou à venir. Partagé par le
 * HUD du jeu et l'appli compagnon (testé dans test/climbs.test.ts).
 *
 * Critères (ceux de Garmin) : au moins 500 m, 3 % de moyenne, et longueur (m) × pente (%)
 * ≥ 1 500. Les replats au pied et au sommet sont rognés ; un replat ou une courte descente au
 * milieu ne coupe pas la montée.
 */

export interface ClimbSegment {
  /** Début et fin depuis le pied (m). */
  from: number;
  to: number;
  /** Pente moyenne du tronçon (%). */
  grade: number;
}

export interface Climb {
  /** Pied et sommet, en distance sur la route (m) ; boucle : peut dépasser la longueur. */
  start: number;
  end: number;
  lengthM: number;
  gainM: number;
  avgGrade: number;
  maxGrade: number;
  footM: number;
  topM: number;
  /** Altitudes lissées tous les `step` m, du pied au sommet. */
  step: number;
  elev: number[];
  segments: ClimbSegment[];
  /** Monde ouvert : la montée continue peut-être au-delà de la route connue. */
  openEnd: boolean;
}

/** Couleurs des pentes, comme sur les compteurs : vert, jaune, orange, rouge, bordeaux. */
export function gradeColor(g: number): string {
  return g < 0 ? '#64748b' : g < 3 ? '#4cd964' : g < 6 ? '#facc15' : g < 9 ? '#f97316' : g < 12 ? '#ef4444' : '#9f1239';
}

const STEP = 20;

/** Longueur des tronçons selon celle de la montée (assez pour une pente lisible, pas trop pour le détail). */
export function segmentLength(lengthM: number): number {
  return lengthM <= 1200 ? 100 : lengthM <= 3000 ? 250 : lengthM <= 8000 ? 500 : 1000;
}

/** Montées entre `from` et `to` (m) d'un profil `elevAt` (altitude en fonction de la distance). */
export function detectClimbs(elevAt: (d: number) => number, from: number, to: number, opts: { openEnd?: boolean } = {}): Climb[] {
  const n = Math.floor((to - from) / STEP) + 1;
  if (n < 3) return [];
  const raw = Array.from({ length: n }, (_, i) => elevAt(from + i * STEP));
  // Lissage sur ±60 m : les points envoyés sont décimés et leurs altitudes arrondies au mètre.
  const e = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) {
      s += raw[k]!;
      c++;
    }
    return s / c;
  });
  const flat = Math.round(100 / STEP);
  const climbs: Climb[] = [];
  let i = 0;
  while (i < n - 1) {
    if (e[i + 1]! <= e[i]!) {
      i++;
      continue;
    }
    const s0 = i;
    let top = i;
    for (let j = i + 1; j < n; j++) {
      if (e[j]! > e[top]!) top = j;
      // Fin : redescente nette sous le point haut, ou 400 m sans le dépasser.
      else if (e[top]! - e[j]! > Math.max(8, 0.15 * (e[top]! - e[s0]!)) || (j - top) * STEP > 400) break;
    }
    // Rogne les replats (< 1,5 % sur 100 m) au pied et au sommet.
    let s = s0;
    let t = top;
    while (s + flat <= t && e[s + flat]! - e[s]! < 1.5) s++;
    while (t - flat >= s && e[t]! - e[t - flat]! < 1.5) t--;
    const len = (t - s) * STEP;
    const gain = e[t]! - e[s]!;
    const avg = len > 0 ? (gain / len) * 100 : 0;
    if (len >= 300 && avg >= 3 && len * avg >= 900) {
      climbs.push(makeClimb(e.slice(s, t + 1), from + s * STEP, !!opts.openEnd && top >= n - 4));
      i = top;
    } else i = s0 + 1;
  }
  return climbs;
}

function makeClimb(elev: number[], start: number, openEnd: boolean): Climb {
  const lengthM = (elev.length - 1) * STEP;
  const at = (x: number) => elev[Math.round(x / STEP)]!;
  const segLen = segmentLength(lengthM);
  const segments: ClimbSegment[] = [];
  for (let a = 0; a < lengthM; ) {
    let b = Math.min(a + segLen, lengthM);
    // Un reste trop court rejoint le tronçon précédent.
    if (lengthM - b < 0.4 * segLen) b = lengthM;
    segments.push({ from: a, to: b, grade: ((at(b) - at(a)) / (b - a)) * 100 });
    a = b;
  }
  const footM = elev[0]!;
  const topM = elev[elev.length - 1]!;
  return {
    start,
    end: start + lengthM,
    lengthM,
    gainM: topM - footM,
    avgGrade: ((topM - footM) / lengthM) * 100,
    maxGrade: Math.max(...segments.map((g) => g.grade)),
    footM,
    topM,
    step: STEP,
    elev,
    segments,
    openEnd,
  };
}

/** Altitude d'une montée à `x` m du pied (interpolée). */
export function climbElevation(c: Climb, x: number): number {
  const f = Math.min(Math.max(x / c.step, 0), c.elev.length - 1);
  const i = Math.floor(f);
  const j = Math.min(i + 1, c.elev.length - 1);
  return c.elev[i]! + (c.elev[j]! - c.elev[i]!) * (f - i);
}

export interface ClimbAhead {
  climb: Climb;
  /** Rang dans la liste des montées (0…). */
  index: number;
  /** Position du coureur depuis le pied (m) : négative avant la montée. */
  pos: number;
}

/**
 * Prochaine montée pas encore terminée (boucle : en tenant compte du tour suivant), avec la
 * position du coureur par rapport à son pied. `null` s'il n'y en a plus.
 */
export function climbAhead(climbs: Climb[], routeM: number, opts: { loop: boolean; lengthM: number }): ClimbAhead | null {
  const shifts = opts.loop && opts.lengthM > 0 ? [-opts.lengthM, 0, opts.lengthM] : [0];
  let best: ClimbAhead | null = null;
  climbs.forEach((climb, index) => {
    for (const k of shifts) {
      const pos = routeM - (climb.start + k);
      // Encore 20 m de grâce après le sommet.
      if (pos > climb.lengthM + 20) continue;
      if (!best || pos > best.pos) best = { climb, index, pos };
    }
  });
  return best;
}

/**
 * Dessine le profil d'une montée façon ClimbPro sur un canvas de `w` × `h` (px CSS, déjà effacé) :
 * tronçons colorés par pente avec leur pourcentage, partie déjà grimpée assombrie, position du
 * coureur (`pos`, m depuis le pied ; négative avant). `nf` : nombre formaté (langue).
 */
export function drawClimbProfile(ctx: CanvasRenderingContext2D, w: number, h: number, c: Climb, pos: number, nf: (v: number, d?: number) => string): void {
  if (c.elev.length < 2) return;
  const L = c.lengthM;
  // Marges proportionnelles (panneau bas du HUD compact) : altitudes en haut, distances en bas.
  const top = Math.max(14, Math.min(22, h * 0.17));
  const base = h - Math.max(12, Math.min(18, h * 0.14));
  // Bande sous le pied pour écrire les pourcentages même là où le profil est bas.
  const band = Math.min(22, Math.max(13, (base - top) * 0.24));
  const lo = Math.min(...c.elev);
  const hi = Math.max(...c.elev);
  const range = Math.max(hi - lo, 10);
  const X = (x: number) => 4 + (x / L) * (w - 8);
  const Y = (y: number) => base - band - ((y - lo) / range) * (base - band - top);
  for (const s of c.segments) {
    ctx.beginPath();
    ctx.moveTo(X(s.from), base);
    for (let x = s.from; x < s.to; x += c.step) ctx.lineTo(X(x), Y(climbElevation(c, x)));
    ctx.lineTo(X(s.to), Y(climbElevation(c, s.to)));
    ctx.lineTo(X(s.to), base);
    ctx.closePath();
    ctx.fillStyle = gradeColor(s.grade);
    ctx.fill();
  }
  // Déjà grimpé : assombri sous le profil seulement (le ciel au-dessus reste transparent).
  if (pos > 0) {
    const end = Math.min(pos, L);
    ctx.beginPath();
    ctx.moveTo(X(0), base);
    for (let x = 0; x < end; x += c.step) ctx.lineTo(X(x), Y(climbElevation(c, x)));
    ctx.lineTo(X(end), Y(climbElevation(c, end)));
    ctx.lineTo(X(end), base);
    ctx.closePath();
    ctx.fillStyle = 'rgba(7, 9, 12, 0.5)';
    ctx.fill();
  }
  // Séparations des tronçons et ligne du profil.
  ctx.strokeStyle = 'rgba(7, 9, 12, 0.85)';
  ctx.lineWidth = 1.5;
  for (const s of c.segments.slice(1)) {
    ctx.beginPath();
    ctx.moveTo(X(s.from), base);
    ctx.lineTo(X(s.from), Y(climbElevation(c, s.from)));
    ctx.stroke();
  }
  ctx.beginPath();
  c.elev.forEach((y, i) => (i ? ctx.lineTo(X(i * c.step), Y(y)) : ctx.moveTo(X(0), Y(y))));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Pourcentage de chaque tronçon, s'il a la place.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const s of c.segments) {
    const wpx = X(s.to) - X(s.from);
    if (wpx < 22) continue;
    ctx.font = `800 ${wpx >= 40 ? 14 : 12}px system-ui, sans-serif`;
    ctx.fillStyle = s.grade >= 12 || s.grade < 0 ? '#fff' : '#111';
    ctx.globalAlpha = s.to <= pos ? 0.6 : 1;
    ctx.fillText(nf(s.grade, wpx >= 40 ? 1 : 0), (X(s.from) + X(s.to)) / 2, base - 7);
    ctx.globalAlpha = 1;
  }
  // Coureur.
  if (pos >= 0 && pos <= L) {
    const x = X(pos);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(x - 1.5, top - 8, 3, base - top + 8);
    ctx.beginPath();
    ctx.arc(x, Y(climbElevation(c, pos)), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#10151c';
    ctx.stroke();
  }
  // Axe : distances, altitudes du pied et du sommet.
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('0', 4, h - 2);
  ctx.fillText(`${Math.round(c.footM)} m`, 4, 14);
  ctx.textAlign = 'right';
  ctx.fillText(`${c.openEnd ? '≥ ' : ''}${nf(L / 1000, 1)} km`, w - 4, h - 2);
  ctx.fillText(`${Math.round(c.topM)} m`, w - 4, 14);
  ctx.textAlign = 'center';
  if (L >= 2000) ctx.fillText(`${nf(L / 2000, 1)}`, X(L / 2), h - 2);
}
