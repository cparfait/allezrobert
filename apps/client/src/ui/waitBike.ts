/**
 * Robert, le guide du tutoriel, qui pédale sur son home trainer au-dessus des barres d'attente : SVG
 * animé à chaque image, jambes en cinématique inverse (hanche fixe, pied sur la pédale, genou vers
 * l'avant), roue arrière entraînée par le braquet sur le rouleau, roue avant immobile sur sa cale,
 * léger balancement du buste. Tête : celle du personnage du tutoriel (public/robert-head.png).
 * L'animation s'arrête d'elle-même quand le dessin quitte la page. Le bas du dessin (pieds du home
 * trainer) se pose sur la barre.
 */

const NS = 'http://www.w3.org/2000/svg';
type P = [number, number];

// Géométrie (viewBox 0 0 120 78, y vers le bas).
const REAR: P = [24, 57];
const FRONT: P = [96, 57];
const WHEEL_R = 18;
const BB: P = [55, 59];
const CRANK = 7.5;
const HIP: P = [50, 27];
const THIGH = 20;
const SHIN = 20;
/** Cadence (tr/min) et braquet (tours de roue par tour de pédalier). */
const CADENCE = 88;
const GEAR = 2.6;

const fmt = (v: number) => v.toFixed(2);

/** Genou par cinématique inverse à deux segments, plié vers l'avant (x croissant). */
function knee(h: P, f: P): P {
  const dx = f[0] - h[0];
  const dy = f[1] - h[1];
  const d = Math.min(Math.hypot(dx, dy), THIGH + SHIN - 0.01);
  const a = Math.atan2(dy, dx);
  const b = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))));
  const k1: P = [h[0] + THIGH * Math.cos(a - b), h[1] + THIGH * Math.sin(a - b)];
  const k2: P = [h[0] + THIGH * Math.cos(a + b), h[1] + THIGH * Math.sin(a + b)];
  return k1[0] > k2[0] ? k1 : k2;
}

function spokes(c: P): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 6;
    d += `M${fmt(c[0] - Math.cos(a) * WHEEL_R)} ${fmt(c[1] - Math.sin(a) * WHEEL_R)}L${fmt(c[0] + Math.cos(a) * WHEEL_R)} ${fmt(c[1] + Math.sin(a) * WHEEL_R)}`;
  }
  return d;
}

/** Sol (pieds du home trainer et cale de la roue avant). */
const FLOOR = REAR[1] + WHEEL_R + 3;
/** Haut du dessin : la tête dépasse au-dessus du cadre. */
const TOP = -14;

const MARKUP = `
  <path class="wb-trainer" d="M${REAR[0]} ${REAR[1]}L${REAR[0] - 12} ${FLOOR}M${REAR[0]} ${REAR[1]}L${REAR[0] + 12} ${FLOOR}M${REAR[0] - 17} ${FLOOR}L${REAR[0] + 17} ${FLOOR}"/>
  <circle class="wb-roller" cx="${REAR[0] - 11}" cy="${REAR[1] + 13}" r="4.2"/>
  <rect class="wb-riser" x="${FRONT[0] - 11}" y="${FRONT[1] + WHEEL_R}" width="22" height="3" rx="1"/>
  <g class="wb-far"><path class="wb-thigh" data-thigh="far"/><path data-leg="far"/><path class="wb-shoe" data-shoe="far"/><path data-crank="far"/></g>
  <g class="wb-wheel" data-wheel="r"><circle cx="${REAR[0]}" cy="${REAR[1]}" r="${WHEEL_R}"/><path class="wb-spokes" d="${spokes(REAR)}"/></g>
  <g class="wb-wheel"><circle cx="${FRONT[0]}" cy="${FRONT[1]}" r="${WHEEL_R}"/><path class="wb-spokes" d="${spokes(FRONT)}"/></g>
  <path class="wb-frame" d="M${REAR[0]} ${REAR[1]}L${BB[0]} ${BB[1]}L47 31L${REAR[0]} ${REAR[1]}M47 31L85 33L${BB[0]} ${BB[1]}M85 33L${FRONT[0]} ${FRONT[1]}M85 33L87 27"/>
  <path class="wb-bar" d="M85 27.5L92 27.5Q96 28 94.5 32.5L92 33"/>
  <path class="wb-saddle" d="M42 28.5L53 28.5"/>
  <circle class="wb-ring" cx="${BB[0]}" cy="${BB[1]}" r="4.5"/>
  <g data-body>
    <path class="wb-torso" d="M${HIP[0]} ${HIP[1]}Q63 12 77 17"/>
    <path class="wb-forearm" d="M80 20L87 25L91.5 28"/>
    <path class="wb-sleeve" d="M76 17.5L81 21"/>
    <circle class="wb-glove" cx="92" cy="28.3" r="1.9"/>
    <image href="/robert-head.png" x="68" y="-13" width="30" height="34.5" preserveAspectRatio="xMidYMid meet"/>
  </g>
  <g class="wb-near"><path class="wb-thigh" data-thigh="near"/><path data-leg="near"/><path class="wb-shoe" data-shoe="near"/><path data-crank="near"/></g>`;

/** Élément SVG animé (à insérer dans la page). */
export function waitBike(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'world-wait-bike');
  // Bas du cadre = bas des pneus : le vélo roule sur la barre d'attente posée juste dessous.
  svg.setAttribute('viewBox', `0 ${TOP} 120 ${FLOOR + 1 - TOP}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = MARKUP;
  const q = (sel: string) => svg.querySelector(sel) as SVGElement;
  const leg = { near: q('[data-leg="near"]'), far: q('[data-leg="far"]') };
  const thigh = { near: q('[data-thigh="near"]'), far: q('[data-thigh="far"]') };
  const shoe = { near: q('[data-shoe="near"]'), far: q('[data-shoe="far"]') };
  const crank = { near: q('[data-crank="near"]'), far: q('[data-crank="far"]') };
  const wheelR = q('[data-wheel="r"]');
  const body = q('[data-body]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let theta = 0.4;
  let last = performance.now();
  let started = false;
  const frame = (now: number) => {
    // Pas encore dans la page : on attend ; sortie de la page : fin de l'animation.
    if (!svg.isConnected) {
      if (started) return;
    } else started = true;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!reduced) theta += ((CADENCE / 60) * 2 * Math.PI) * dt;
    const bob = Math.sin(theta * 2) * 0.6;
    const hip: P = [HIP[0], HIP[1] + bob];
    for (const [side, off] of [['near', 0], ['far', Math.PI]] as const) {
      const a = theta + off;
      const pedal: P = [BB[0] + Math.cos(a) * CRANK, BB[1] + Math.sin(a) * CRANK];
      const k = knee(hip, pedal);
      // Pied : de la cheville vers l'avant, à peu près à plat sur la pédale.
      const toe: P = [pedal[0] + 5.5, pedal[1] + 0.8];
      // Cuissard noir jusqu'au-dessus du genou, mollet nu, socquette blanche (trait du mollet), chaussure sombre.
      const mid: P = [hip[0] + (k[0] - hip[0]) * 0.8, hip[1] + (k[1] - hip[1]) * 0.8];
      thigh[side].setAttribute('d', `M${fmt(hip[0])} ${fmt(hip[1])}L${fmt(mid[0])} ${fmt(mid[1])}`);
      leg[side].setAttribute('d', `M${fmt(mid[0])} ${fmt(mid[1])}L${fmt(k[0])} ${fmt(k[1])}L${fmt(pedal[0] - 1)} ${fmt(pedal[1] - 1.5)}`);
      shoe[side].setAttribute('d', `M${fmt(pedal[0] - 1.5)} ${fmt(pedal[1] - 1.2)}L${fmt(toe[0])} ${fmt(toe[1])}`);
      crank[side].setAttribute('d', `M${BB[0]} ${BB[1]}L${fmt(pedal[0])} ${fmt(pedal[1])}M${fmt(pedal[0] - 2.5)} ${fmt(pedal[1])}L${fmt(pedal[0] + 2.5)} ${fmt(pedal[1])}`);
    }
    const wheelDeg = ((theta * GEAR * 180) / Math.PI) % 360;
    wheelR.setAttribute('transform', `rotate(${fmt(wheelDeg)} ${REAR[0]} ${REAR[1]})`);
    body.setAttribute('transform', `translate(0 ${fmt(bob)})`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return svg;
}
