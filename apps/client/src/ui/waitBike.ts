/**
 * Petit coureur qui pédale au-dessus des barres d'attente : SVG animé à chaque image, jambes en
 * cinématique inverse (hanche fixe, pied sur la pédale, genou vers l'avant), roues entraînées
 * par le braquet, léger balancement du buste. L'animation s'arrête d'elle-même quand le
 * dessin quitte la page. Le bas du dessin est le bas des pneus : il se pose sur la barre.
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

const MARKUP = `
  <g class="wb-far"><path data-leg="far"/><path data-crank="far"/></g>
  <g class="wb-wheel" data-wheel="r"><circle cx="${REAR[0]}" cy="${REAR[1]}" r="${WHEEL_R}"/><path class="wb-spokes" d="${spokes(REAR)}"/></g>
  <g class="wb-wheel" data-wheel="f"><circle cx="${FRONT[0]}" cy="${FRONT[1]}" r="${WHEEL_R}"/><path class="wb-spokes" d="${spokes(FRONT)}"/></g>
  <path class="wb-frame" d="M${REAR[0]} ${REAR[1]}L${BB[0]} ${BB[1]}L47 31L${REAR[0]} ${REAR[1]}M47 31L85 33L${BB[0]} ${BB[1]}M85 33L${FRONT[0]} ${FRONT[1]}M85 33L87 27"/>
  <path class="wb-bar" d="M85 27.5L92 27.5Q96 28 94.5 32.5L92 33"/>
  <path class="wb-saddle" d="M42 28.5L53 28.5"/>
  <circle class="wb-ring" cx="${BB[0]}" cy="${BB[1]}" r="4.5"/>
  <g data-body>
    <path class="wb-torso" d="M${HIP[0]} ${HIP[1]}Q63 12 79 17"/>
    <path class="wb-arm" d="M78 18L86 24L92 28"/>
    <circle class="wb-head" cx="85" cy="11" r="5"/>
    <path class="wb-helmet" d="M79.5 10.5Q81 3.5 87 4.5Q91.5 5.5 91 10Z"/>
  </g>
  <g class="wb-near"><path data-leg="near"/><path data-crank="near"/></g>`;

/** Élément SVG animé (à insérer dans la page). */
export function waitBike(): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'world-wait-bike');
  // Bas du cadre = bas des pneus : le vélo roule sur la barre d'attente posée juste dessous.
  svg.setAttribute('viewBox', `0 0 120 ${REAR[1] + WHEEL_R + 1.3}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = MARKUP;
  const q = (sel: string) => svg.querySelector(sel) as SVGElement;
  const leg = { near: q('[data-leg="near"]'), far: q('[data-leg="far"]') };
  const crank = { near: q('[data-crank="near"]'), far: q('[data-crank="far"]') };
  const wheelR = q('[data-wheel="r"]');
  const wheelF = q('[data-wheel="f"]');
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
      leg[side].setAttribute('d', `M${fmt(hip[0])} ${fmt(hip[1])}L${fmt(k[0])} ${fmt(k[1])}L${fmt(pedal[0] - 1)} ${fmt(pedal[1] - 1.5)}L${fmt(toe[0])} ${fmt(toe[1])}`);
      crank[side].setAttribute('d', `M${BB[0]} ${BB[1]}L${fmt(pedal[0])} ${fmt(pedal[1])}M${fmt(pedal[0] - 2.5)} ${fmt(pedal[1])}L${fmt(pedal[0] + 2.5)} ${fmt(pedal[1])}`);
    }
    const wheelDeg = ((theta * GEAR * 180) / Math.PI) % 360;
    wheelR.setAttribute('transform', `rotate(${fmt(wheelDeg)} ${REAR[0]} ${REAR[1]})`);
    wheelF.setAttribute('transform', `rotate(${fmt(wheelDeg)} ${FRONT[0]} ${FRONT[1]})`);
    body.setAttribute('transform', `translate(0 ${fmt(bob)})`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return svg;
}
