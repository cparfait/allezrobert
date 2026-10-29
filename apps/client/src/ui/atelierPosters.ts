import * as THREE from 'three/webgpu';
import type { AvatarLook } from '@allezrobert/shared';
import type { RiderPose } from '../rider/gltfAvatar.ts';
import { box, canvasTex, mat, rng } from './atelierRoom.ts';

/**
 * Affiches de l'atelier : grandes courses (Tour de France en bannière et en affiche, Paris–Roubaix, Giro, Milan–San Remo,
 * Liège–Bastogne–Liège, Tour des Flandres, Vuelta) et réclames d'époque, dessinées en canevas.
 * Pour le réalisme : papier jauni, plis de pliage, taches et piqûres, bords usés ; affiches
 * scotchées (ruban adhésif, légère inclinaison) ou encadrées sous verre (reflet des spots).
 */

type G = CanvasRenderingContext2D;
const PW = 600;
const PH = 848;
const BLACK = '"Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

/** Texte centré réduit jusqu'à tenir dans `maxW`. */
function fit(g: G, text: string, x: number, y: number, maxW: number, size: number, font: string, style = ''): void {
  let s = size;
  g.font = `${style} ${s}px ${font}`;
  while (g.measureText(text).width > maxW && s > 8) {
    s -= 2;
    g.font = `${style} ${s}px ${font}`;
  }
  g.fillText(text, x, y);
}

/** Silhouette de coureur en danseuse ou assis, sol en y, longueur de vélo ≈ 1,2 s. */
function rider(g: G, x: number, y: number, s: number, color: string, flip = false): void {
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const P = (px: number, py: number): [number, number] => [px * s, -py * s];
  const line = (w: number, ...pts: Array<[number, number]>) => {
    g.lineWidth = w * s;
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(...P(px, py)) : g.moveTo(...P(px, py))));
    g.stroke();
  };
  for (const cx of [-0.5, 0.5]) {
    g.lineWidth = 0.035 * s;
    g.beginPath();
    g.arc(cx * s, -0.34 * s, 0.32 * s, 0, Math.PI * 2);
    g.stroke();
  }
  const rear: [number, number] = [-0.5, 0.34];
  const front: [number, number] = [0.5, 0.34];
  const bb: [number, number] = [-0.05, 0.32];
  const seat: [number, number] = [-0.18, 0.85];
  const head: [number, number] = [0.36, 0.82];
  line(0.03, rear, bb, seat, rear);
  line(0.03, seat, head, bb);
  line(0.03, head, front);
  line(0.03, head, [0.42, 0.9], [0.5, 0.86]);
  // Coureur : jambes, buste penché, bras, tête casquée.
  line(0.1, [-0.16, 0.95], [0.12, 0.72], [0.0, 0.25]);
  line(0.085, [-0.16, 0.95], [-0.02, 0.62], [-0.12, 0.4]);
  line(0.14, [-0.16, 0.95], [0.22, 1.24]);
  line(0.07, [0.22, 1.22], [0.4, 1.02], [0.48, 0.9]);
  g.beginPath();
  g.arc(...P(0.36, 1.33), 0.1 * s, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Images des coureurs (rendus 3D détourés), par clé de POSTER_RIDERS. */
export type PosterArt = ReadonlyMap<string, CanvasImageSource>;
const NO_ART: PosterArt = new Map();

/** Affiche redessinable : silhouettes d'abord, puis les vrais coureurs une fois photographiés. */
interface Painted {
  tex: THREE.CanvasTexture;
  repaint(art: PosterArt): void;
}

function painted(w: number, h: number, draw: (g: G, art: PosterArt) => void): Painted {
  const tex = canvasTex(w, h, (g) => draw(g, NO_ART));
  return {
    tex,
    repaint(art) {
      const cv = tex.image as HTMLCanvasElement;
      const g = cv.getContext('2d') as G;
      g.clearRect(0, 0, w, h);
      draw(g, art);
      tex.needsUpdate = true;
    },
  };
}

/**
 * Coureurs des affiches : vraie tenue, vrai vélo du catalogue, position (assis, en danseuse).
 * L'atelier les photographie de profil (3/4 léger) et les détoure ; l'affiche les place au sol.
 */
export interface PosterRider {
  look: Partial<AvatarLook>;
  pose: RiderPose;
  /** Rotation du coureur (rad) : 0 = profil strict. */
  yaw: number;
}
export const POSTER_RIDERS: Record<string, PosterRider> = {
  jaune: { look: { jersey: '#f7d117', jerseyAccent: '#1b1712', helmet: '#f7d117', shoes: '#f2f2f2', socks: '#f2f2f2', bikeModel: 'myth-pinarello-dogma-f12' }, pose: 'seated', yaw: 0.25 },
  pois: { look: { jersey: '#ffffff', jerseyAccent: '#d62828', helmet: '#ffffff', shoes: '#ffffff', socks: '#d62828', bikeModel: 'myth-colnago-v4rs' }, pose: 'standing', yaw: 0.25 },
  roubaix: { look: { jersey: '#2f4f8f', jerseyAccent: '#ffffff', helmet: '#222222', shoes: '#111111', socks: '#ffffff', bikeModel: 'myth-peugeot-px10' }, pose: 'seated', yaw: 0.3 },
  rose: { look: { jersey: '#f06aa0', jerseyAccent: '#ffffff', helmet: '#f06aa0', shoes: '#ffffff', socks: '#ffffff', bikeModel: 'myth-pinarello-dogma-f8' }, pose: 'standing', yaw: 0.3 },
  sanremo: { look: { jersey: '#1f6feb', jerseyAccent: '#ffd23f', helmet: '#f4f4f4', shoes: '#f2f2f2', socks: '#f2f2f2', bikeModel: 'myth-cervelo-soloist' }, pose: 'seated', yaw: 0.2 },
  sanremo2: { look: { jersey: '#c4361d', jerseyAccent: '#ffffff', helmet: '#111111', shoes: '#111111', socks: '#ffffff', bikeModel: 'myth-scott-foil-gen1' }, pose: 'seated', yaw: 0.2 },
  liege: { look: { jersey: '#b8191f', jerseyAccent: '#ffffff', helmet: '#ffffff', shoes: '#ffffff', socks: '#ffffff', bikeModel: 'myth-specialized-tarmac-sl7' }, pose: 'standing', yaw: 0.3 },
  robert: { look: { jersey: '#b22222', jerseyAccent: '#ffffff', helmet: '#222222', shoes: '#111111', socks: '#ffffff', bikeModel: 'myth-colnago-master' }, pose: 'seated', yaw: 0.35 },
  flandres: { look: { jersey: '#f2c919', jerseyAccent: '#1b1a17', helmet: '#1b1a17', shoes: '#111111', socks: '#1b1a17', bikeModel: 'myth-bianchi-oltre-xr4' }, pose: 'standing', yaw: 0.2 },
  flandres2: { look: { jersey: '#1b1a17', jerseyAccent: '#f2c919', helmet: '#f2c919', shoes: '#111111', socks: '#f2c919', bikeModel: 'myth-canyon-aeroad-gen1' }, pose: 'standing', yaw: 0.2 },
  vuelta: { look: { jersey: '#d6001c', jerseyAccent: '#ffd23f', helmet: '#d6001c', shoes: '#ffffff', socks: '#ffffff', bikeModel: 'myth-cervelo-r5-2022' }, pose: 'standing', yaw: 0.3 },
};

/**
 * Cadre des photos des coureurs (m, repère du coureur) : largeur centrée sur l'origine, du sol
 * (un peu en dessous) jusqu'au-dessus du casque. L'atelier rend exactement cette boîte.
 */
export const RIDER_BOX = { halfWidth: 1.2, bottom: -0.05, top: 2.15 };

/**
 * Coureur photographié (s'il l'est déjà) posé au sol en (x, y), `s` pixels par mètre ; sinon la
 * silhouette dessinée de la même taille.
 */
function figure(g: G, art: PosterArt, key: string, x: number, y: number, s: number, color: string, flip = false): void {
  const img = art.get(key);
  if (!img) return rider(g, x, y, s, color, flip);
  const { halfWidth, bottom, top } = RIDER_BOX;
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.drawImage(img, -halfWidth * s, -top * s, 2 * halfWidth * s, (top - bottom) * s);
  g.restore();
}

/** Chaîne de montagnes déchiquetées (bord inférieur en y0). */
function mountains(g: G, y0: number, top: number, color: string, seed: number, w = PW): void {
  const r = rng(seed);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, y0);
  let x = 0;
  while (x < w) {
    g.lineTo(x, top + r() * (y0 - top) * 0.7);
    x += 25 + r() * 60;
  }
  g.lineTo(w, top + r() * (y0 - top) * 0.6);
  g.lineTo(w, y0);
  g.closePath();
  g.fill();
}

/** Collines douces (bord inférieur en y0). */
function hills(g: G, y0: number, top: number, color: string, phase: number, w = PW): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, y0);
  for (let x = 0; x <= w; x += 10) g.lineTo(x, top + (Math.sin(x / 90 + phase) * 0.5 + 0.5) * (y0 - top) * 0.6);
  g.lineTo(w, y0);
  g.closePath();
  g.fill();
}

/**
 * Vieillissement : papier jauni, vignettage brun, piqûres, plis de pliage en quatre, bords
 * écaillés. `tape` : rubans adhésifs aux coins.
 */
function age(g: G, w: number, h: number, seed: number, amount: number, tape: boolean): void {
  const r = rng(seed);
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgba(236,222,190,${0.55 + amount * 0.45})`;
  g.fillRect(0, 0, w, h);
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(1, `rgba(150,110,60,${0.25 + amount * 0.3})`);
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  // Taches d'humidité.
  for (let i = 0; i < 4 + amount * 6; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 15 + r() * 60;
    const s = g.createRadialGradient(x, y, 0, x, y, rad);
    s.addColorStop(0, 'rgba(170,130,70,0)');
    s.addColorStop(0.8, `rgba(170,130,70,${0.08 + r() * 0.12 * amount})`);
    s.addColorStop(1, 'rgba(170,130,70,0)');
    g.fillStyle = s;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Piqûres.
  for (let i = 0; i < 900 * amount; i++) {
    g.fillStyle = `rgba(110,80,40,${0.05 + r() * 0.2})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  g.restore();
  // Plis : un sillon clair et son ombre.
  g.save();
  for (const [x0, y0, x1, y1] of [[0, h / 2, w, h / 2], [w / 2, 0, w / 2, h]] as const) {
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(255,250,235,0.35)';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(60,40,20,0.18)';
    g.beginPath();
    g.moveTo(x0 + (x0 === x1 ? 2 : 0), y0 + (y0 === y1 ? 2 : 0));
    g.lineTo(x1 + (x0 === x1 ? 2 : 0), y1 + (y0 === y1 ? 2 : 0));
    g.stroke();
  }
  // Encre écaillée le long des plis et des bords.
  g.fillStyle = 'rgba(245,236,214,0.7)';
  for (let i = 0; i < 260 * amount; i++) {
    const t = r();
    const along = r() < 0.5;
    const edge = r() < 0.5;
    const x = edge ? (along ? t * w : r() < 0.5 ? r() * 6 : w - r() * 6) : along ? t * w : w / 2 + (r() - 0.5) * 6;
    const y = edge ? (along ? (r() < 0.5 ? r() * 6 : h - r() * 6) : t * h) : along ? h / 2 + (r() - 0.5) * 6 : t * h;
    g.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
  }
  if (tape) {
    for (const [x, y, a] of [[0, 0, -0.8], [w, 0, 0.8], [0, h, 0.8], [w, h, -0.8]] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(a + (r() - 0.5) * 0.2);
      g.fillStyle = 'rgba(232,220,180,0.72)';
      g.fillRect(-45, -13, 90, 26);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(-45, -13, 90, 5);
      g.restore();
    }
  }
  g.restore();
}

/** Marge blanche d'impression. */
function margin(g: G, w: number, h: number, m: number, paper = '#f3ead6'): void {
  g.fillStyle = paper;
  g.fillRect(0, 0, w, m);
  g.fillRect(0, h - m, w, m);
  g.fillRect(0, 0, m, h);
  g.fillRect(w - m, 0, m, h);
}

function sky(g: G, h: number, top: string, bottom: string, w = PW): void {
  const s = g.createLinearGradient(0, 0, 0, h);
  s.addColorStop(0, top);
  s.addColorStop(1, bottom);
  g.fillStyle = s;
  g.fillRect(0, 0, w, h);
}

function sun(g: G, x: number, y: number, r: number, c: string): void {
  g.fillStyle = c;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Bannière du Tour de France (au-dessus des étagères). */
function tourBanner(): Painted {
  const w = 1400;
  const h = 330;
  return painted(w, h, (g, art) => {
    const s = g.createLinearGradient(0, 0, w, 0);
    s.addColorStop(0, '#f6c81e');
    s.addColorStop(1, '#efb714');
    g.fillStyle = s;
    g.fillRect(0, 0, w, h);
    hills(g, h, h * 0.55, '#d79c10', 1.3, w);
    g.fillStyle = '#1b1712';
    g.textAlign = 'left';
    fit(g, 'TOUR DE FRANCE', 50, 165, 900, 120, BLACK, 'italic 900');
    g.font = `italic 700 40px ${SERIF}`;
    g.fillText('La Grande Boucle  ·  21 étapes  ·  3 500 km', 56, 240);
    g.fillStyle = '#b8191f';
    g.fillRect(50, 262, 620, 10);
    figure(g, art, 'pois', 1120, 312, 118, '#1b1712');
    figure(g, art, 'jaune', 1270, 322, 128, '#1b1712');
    margin(g, w, h, 10);
    age(g, w, h, 301, 0.55, true);
  });
}

function roubaix(): Painted {
  return painted(PW, PH, (g, art) => {
    const hz = 470;
    sky(g, hz, '#6f7873', '#c8c2a8');
    // Champs boueux de part et d'autre du secteur pavé.
    g.fillStyle = '#5d6040';
    g.fillRect(0, hz, PW, PH - hz);
    g.strokeStyle = 'rgba(40,36,20,0.35)';
    g.lineWidth = 2;
    for (let i = -12; i <= 12; i++) {
      g.beginPath();
      g.moveTo(PW / 2, hz);
      g.lineTo(PW / 2 + i * 90, PH);
      g.stroke();
    }
    // Route pavée en perspective : rangées de pavés de plus en plus gros vers le bas.
    const road = (t: number): [number, number, number] => {
      const y = hz + (PH - hz) * t;
      const half = 14 + t * 360;
      return [y, PW / 2 - half, PW / 2 + half];
    };
    g.save();
    g.beginPath();
    const [, l0, r0] = road(0);
    const [, l1, r1] = road(1);
    g.moveTo(l0, hz);
    g.lineTo(r0, hz);
    g.lineTo(r1, PH);
    g.lineTo(l1, PH);
    g.closePath();
    g.fillStyle = '#3f3a31';
    g.fill();
    g.clip();
    const r = rng(7);
    let t = 0.004;
    let row = 0;
    while (t < 1) {
      const [y, l, rr] = road(t);
      const ch = Math.max(1.5, (PH - hz) * t * 0.11);
      const cw = ch * 1.5;
      for (let x = l - cw + (row % 2) * cw * 0.5; x < rr + cw; x += cw) {
        g.fillStyle = `hsl(${28 + r() * 10} ${6 + r() * 10}% ${34 + r() * 22}%)`;
        g.beginPath();
        g.ellipse(x + cw / 2, y + ch / 2, cw * 0.44, ch * 0.42, 0, 0, Math.PI * 2);
        g.fill();
      }
      t += ch / (PH - hz) + 0.0008;
      row++;
    }
    // Boue et flaques sur les pavés.
    g.fillStyle = 'rgba(80,62,35,0.35)';
    g.fillRect(0, hz, PW, PH - hz);
    g.restore();
    figure(g, art, 'roubaix', 300, 760, 300, '#22201c');
    g.fillStyle = '#22201c';
    g.fillRect(0, 40, PW, 150);
    g.fillStyle = '#efe6cf';
    g.textAlign = 'center';
    fit(g, 'PARIS–ROUBAIX', PW / 2, 128, PW - 70, 76, BLACK, '900');
    g.font = `italic 700 30px ${SERIF}`;
    g.fillText("« L'Enfer du Nord »", PW / 2, 172);
    g.fillStyle = '#efe6cf';
    fit(g, 'Arenberg · Mons-en-Pévèle · Carrefour de l’Arbre', PW / 2, 812, PW - 60, 24, SERIF, '700');
    margin(g, PW, PH, 14);
    age(g, PW, PH, 11, 0.8, true);
  });
}

/** Affiche du Tour de France : le maillot jaune dans les lacets d'un col, ciel d'été. */
function tour(): Painted {
  return painted(PW, PH, (g, art) => {
    sky(g, PH, '#ffd84a', '#fff4c2');
    sun(g, 170, 300, 95, '#fffbe6');
    mountains(g, 640, 300, '#c98a16', 5);
    mountains(g, 700, 420, '#8f5c0c', 13);
    // Lacets de la montée, peints à flanc de montagne.
    g.strokeStyle = 'rgba(255,240,200,0.75)';
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(120, 690);
    for (let i = 0; i < 5; i++) g.quadraticCurveTo(i % 2 ? 110 : 500, 650 - i * 52, 300, 625 - i * 52);
    g.stroke();
    g.fillStyle = '#5a3a08';
    g.fillRect(0, 690, PW, 160);
    figure(g, art, 'jaune', 300, 740, 270, '#2a1d05');
    g.fillStyle = '#1b1712';
    g.textAlign = 'center';
    fit(g, 'TOUR DE FRANCE', PW / 2, 130, PW - 60, 82, BLACK, 'italic 900');
    g.fillStyle = '#b8191f';
    g.font = `italic 700 40px ${SERIF}`;
    g.fillText('Le Maillot Jaune', PW / 2, 190);
    g.fillStyle = '#fff4c2';
    g.font = `700 24px ${SERIF}`;
    g.fillText("Alpe d'Huez · Tourmalet · Champs-Élysées", PW / 2, 805);
    margin(g, PW, PH, 16, '#f6eee0');
    age(g, PW, PH, 29, 0.5, false);
  });
}

function giro(): Painted {
  return painted(PW, PH, (g, art) => {
    sky(g, PH, '#f6b9cc', '#fbe4ea');
    sun(g, 430, 300, 90, '#fff3f6');
    mountains(g, 620, 320, '#b55a7d', 3);
    mountains(g, 680, 430, '#8c3a5c', 9);
    g.fillStyle = '#6e2a46';
    g.fillRect(0, 680, PW, 170);
    figure(g, art, 'rose', 280, 730, 270, '#2b1220');
    g.fillStyle = '#2b1220';
    g.textAlign = 'center';
    fit(g, "GIRO D'ITALIA", PW / 2, 130, PW - 70, 86, BLACK, 'italic 900');
    g.fillStyle = '#d6336c';
    g.font = `italic 700 40px ${SERIF}`;
    g.fillText('Maglia Rosa', PW / 2, 190);
    g.fillStyle = '#fbe4ea';
    g.font = `700 24px ${SERIF}`;
    g.fillText('Dolomiti · Stelvio · Mortirolo', PW / 2, 800);
    margin(g, PW, PH, 16, '#f6eee6');
    age(g, PW, PH, 23, 0.45, false);
  });
}

function sanremo(): Painted {
  return painted(PW, PH, (g, art) => {
    sky(g, 520, '#f7d76a', '#f6efd0');
    sun(g, 300, 470, 120, '#f29a2e');
    const sea = g.createLinearGradient(0, 520, 0, PH);
    sea.addColorStop(0, '#2c7fb8');
    sea.addColorStop(1, '#174a75');
    g.fillStyle = sea;
    g.fillRect(0, 520, PW, PH);
    g.strokeStyle = 'rgba(255,240,200,0.5)';
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.moveTo(220 - i * 6, 545 + i * 22);
      g.lineTo(380 + i * 6, 545 + i * 22);
      g.stroke();
    }
    // Corniche côtière et route.
    g.fillStyle = '#5b4a32';
    g.beginPath();
    g.moveTo(0, 640);
    g.quadraticCurveTo(300, 580, PW, 690);
    g.lineTo(PW, PH);
    g.lineTo(0, PH);
    g.fill();
    figure(g, art, 'sanremo', 330, 680, 170, '#1d1a14', true);
    figure(g, art, 'sanremo2', 470, 700, 150, '#1d1a14', true);
    g.fillStyle = '#174a75';
    g.textAlign = 'center';
    fit(g, 'MILANO–SANREMO', PW / 2, 130, PW - 60, 76, BLACK, 'italic 900');
    g.fillStyle = '#c4361d';
    g.font = `italic 700 40px ${SERIF}`;
    g.fillText('La Primavera', PW / 2, 190);
    g.fillStyle = '#f6efd0';
    g.font = `700 24px ${SERIF}`;
    g.fillText('Cipressa · Poggio · Via Roma', PW / 2, 810);
    margin(g, PW, PH, 14);
    age(g, PW, PH, 37, 0.65, true);
  });
}

function liege(): Painted {
  return painted(PW, PH, (g, art) => {
    sky(g, PH, '#d8dccb', '#eef0e2');
    hills(g, 560, 330, '#7d9a5a', 0.5);
    hills(g, 680, 440, '#56743a', 2.4);
    g.fillStyle = '#3f5a2a';
    g.fillRect(0, 670, PW, 180);
    // Route en lacets.
    g.strokeStyle = '#d9cfb3';
    g.lineWidth = 16;
    g.beginPath();
    g.moveTo(80, 850);
    g.bezierCurveTo(500, 760, 120, 640, 420, 560);
    g.stroke();
    figure(g, art, 'liege', 300, 770, 230, '#1e2416');
    g.fillStyle = '#b8191f';
    g.fillRect(0, 50, PW, 170);
    g.fillStyle = '#f3ead6';
    g.textAlign = 'center';
    fit(g, 'LIÈGE–BASTOGNE', PW / 2, 120, PW - 60, 64, BLACK, '900');
    fit(g, '–LIÈGE', PW / 2, 180, PW - 60, 52, BLACK, '900');
    g.fillStyle = '#1e2416';
    g.font = `italic 700 38px ${SERIF}`;
    g.fillText('La Doyenne', PW / 2, 280);
    g.font = `700 24px ${SERIF}`;
    g.fillStyle = '#eef0e2';
    g.fillText('Redoute · Roche-aux-Faucons', PW / 2, 810);
    margin(g, PW, PH, 16, '#f6eee6');
    age(g, PW, PH, 41, 0.5, false);
  });
}

/** Réclame d'un fabricant de cycles, style années 1950. */
function cyclesAd(): Painted {
  return painted(PW, PH, (g, art) => {
    g.fillStyle = '#efe3c4';
    g.fillRect(0, 0, PW, PH);
    sun(g, PW / 2, 470, 230, '#c4361d');
    g.fillStyle = '#efe3c4';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.moveTo(PW / 2, 470);
      g.arc(PW / 2, 470, 240, a, a + 0.07);
      g.fill();
    }
    figure(g, art, 'robert', PW / 2, 700, 280, '#1c2a44');
    g.fillStyle = '#1c2a44';
    g.textAlign = 'center';
    fit(g, 'CYCLES ROBERT', PW / 2, 120, PW - 60, 82, BLACK, '900');
    g.font = `italic 700 34px ${SERIF}`;
    g.fillStyle = '#c4361d';
    g.fillText('Le vélo des champions', PW / 2, 175);
    g.fillStyle = '#1c2a44';
    g.font = `700 26px ${SERIF}`;
    g.fillText('Cadres acier · Montés main · Depuis 1952', PW / 2, 760);
    g.font = `700 20px ${SERIF}`;
    g.fillText('En vente chez votre marchand de cycles', PW / 2, 800);
    margin(g, PW, PH, 14);
    age(g, PW, PH, 53, 0.7, false);
  });
}

/** Affiches à l'italienne (paysage) du mur du rack. */
const LW = 848;
const LH = 600;

function flandres(): Painted {
  return painted(LW, LH, (g, art) => {
    g.fillStyle = '#f2c919';
    g.fillRect(0, 0, LW, LH);
    // Mur pavé (Kapelmuur) et sa chapelle.
    g.fillStyle = '#1b1a17';
    g.beginPath();
    g.moveTo(0, LH);
    g.lineTo(0, 470);
    g.quadraticCurveTo(480, 450, LW, 230);
    g.lineTo(LW, LH);
    g.fill();
    g.fillRect(700, 150, 70, 90);
    g.beginPath();
    g.moveTo(690, 150);
    g.lineTo(735, 95);
    g.lineTo(780, 150);
    g.fill();
    figure(g, art, 'flandres', 615, 345, 120, '#1b1a17');
    figure(g, art, 'flandres2', 455, 402, 120, '#1b1a17');
    g.fillStyle = '#1b1a17';
    g.textAlign = 'left';
    fit(g, 'RONDE VAN', 40, 110, 520, 80, BLACK, '900');
    fit(g, 'VLAANDEREN', 40, 190, 520, 80, BLACK, '900');
    g.font = `italic 700 34px ${SERIF}`;
    g.fillText('Tour des Flandres', 44, 245);
    g.fillStyle = '#f2c919';
    g.font = `700 24px ${SERIF}`;
    g.fillText('Oude Kwaremont · Paterberg · Muur', 40, 560);
    margin(g, LW, LH, 14);
    age(g, LW, LH, 61, 0.6, true);
  });
}

function vuelta(): Painted {
  return painted(LW, LH, (g, art) => {
    sky(g, LH, '#f7b733', '#fbe7a1', LW);
    sun(g, 620, 260, 150, '#d9381e');
    mountains(g, 460, 260, '#a8461f', 17, LW);
    g.fillStyle = '#7a2e12';
    g.fillRect(0, 450, LW, 150);
    figure(g, art, 'vuelta', 520, 505, 170, '#2a120a');
    g.fillStyle = '#b3141b';
    g.textAlign = 'left';
    fit(g, 'LA VUELTA', 40, 130, 420, 104, BLACK, 'italic 900');
    g.fillStyle = '#2a120a';
    g.font = `italic 700 36px ${SERIF}`;
    g.fillText('Vuelta a España', 46, 190);
    g.fillStyle = '#fbe7a1';
    g.font = `700 24px ${SERIF}`;
    g.fillText('Angliru · Lagos de Covadonga', 40, 560);
    margin(g, LW, LH, 14);
    age(g, LW, LH, 67, 0.5, true);
  });
}

/** Réclame d'huile pour chaînes, émaillée. */
function oilAd(): Painted {
  return painted(LW, LH, (g) => {
    g.fillStyle = '#1f5f3a';
    g.fillRect(0, 0, LW, LH);
    g.fillStyle = '#efe3c4';
    g.fillRect(30, 30, LW - 60, LH - 60);
    g.fillStyle = '#1f5f3a';
    g.fillRect(44, 44, LW - 88, LH - 88);
    // Bidon d'huile.
    g.fillStyle = '#e8b51c';
    g.beginPath();
    g.roundRect(560, 170, 190, 300, 18);
    g.fill();
    g.fillStyle = '#c4361d';
    g.fillRect(560, 260, 190, 110);
    g.fillStyle = '#e8b51c';
    g.fillRect(630, 130, 50, 45);
    g.fillStyle = '#efe3c4';
    g.textAlign = 'center';
    g.font = `900 34px ${BLACK}`;
    g.fillText('HUILE', 655, 328);
    g.textAlign = 'left';
    fit(g, 'HUILE ALLEZ', 80, 170, 450, 84, BLACK, '900');
    g.fillStyle = '#e8b51c';
    g.font = `italic 700 38px ${SERIF}`;
    g.fillText('Pour chaînes et moyeux', 84, 235);
    g.fillStyle = '#efe3c4';
    g.font = `700 28px ${SERIF}`;
    g.fillText('Extra-fluide · Ne colle pas', 84, 330);
    g.fillText('Le choix des coureurs', 84, 375);
    // Émail : pas de plis, mais des éclats et de la rouille aux bords.
    const r = rng(71);
    for (let i = 0; i < 70; i++) {
      const x = r() < 0.5 ? r() * 40 : LW - r() * 40;
      const y = r() * LH;
      g.fillStyle = `rgba(${90 + r() * 60},${50 + r() * 20},20,${0.5 + r() * 0.4})`;
      g.beginPath();
      g.arc(x, y, 2 + r() * 7, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Position d'un mur : point du plan du mur et orientation (normale vers la pièce). */
type Wall = 'wood' | 'right' | 'front';
function onWall(o: THREE.Object3D, wall: Wall, u: number, y: number): void {
  if (wall === 'wood') o.position.set(u, y, -3);
  else if (wall === 'right') {
    o.position.set(3.4, y, u);
    o.rotation.y = -Math.PI / 2;
  } else {
    o.position.set(u, y, 3.4);
    o.rotation.y = Math.PI;
  }
}

interface PosterOpts {
  /** Cadre (couleur) sous verre : papier plus brillant (reflet du verre). */
  frame?: string;
  /** Inclinaison (rad) des affiches scotchées. */
  tilt?: number;
  /** Plaque émaillée : légèrement métallique et brillante. */
  enamel?: boolean;
}

function poster(map: THREE.Texture, w: number, h: number, wall: Wall, u: number, y: number, o: PosterOpts = {}): THREE.Object3D {
  const g = new THREE.Group();
  onWall(g, wall, u, y);
  const inner = new THREE.Group();
  inner.rotation.z = o.tilt ?? 0;
  g.add(inner);
  const rough = o.frame ? 0.22 : o.enamel ? 0.3 : 0.85;
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardNodeMaterial({ map, roughness: rough, metalness: o.enamel ? 0.15 : 0 }));
  paper.receiveShadow = true;
  if (o.frame) {
    const d = 0.03;
    const f = mat(o.frame, 0.45, 0.2);
    const b = 0.03;
    inner.add(box(w + 2 * b, b, d, f, 0, h / 2 + b / 2, d / 2));
    inner.add(box(w + 2 * b, b, d, f, 0, -h / 2 - b / 2, d / 2));
    inner.add(box(b, h, d, f, -w / 2 - b / 2, 0, d / 2));
    inner.add(box(b, h, d, f, w / 2 + b / 2, 0, d / 2));
    inner.add(box(w, h, 0.004, mat('#d8d2c4', 0.9), 0, 0, 0.002));
    paper.position.z = d * 0.6;
  } else if (o.enamel) {
    inner.add(box(w, h, 0.008, mat('#2a2c30', 0.5, 0.6), 0, 0, 0.004));
    paper.position.z = 0.0085;
    // Vis aux quatre coins.
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10).rotateX(Math.PI / 2), mat('#9aa1a8', 0.3, 0.9));
      s.position.set(sx * (w / 2 - 0.025), sy * (h / 2 - 0.025), 0.011);
      inner.add(s);
    }
  } else {
    paper.position.z = 0.004;
  }
  inner.add(paper);
  return g;
}

/** Affiches de l'atelier ; `setArt` les redessine avec les coureurs photographiés. */
export function buildPosters(): { group: THREE.Group; setArt(art: PosterArt): void } {
  const room = new THREE.Group();
  room.name = 'atelier_posters';
  const all: Painted[] = [];
  const add = (p: Painted, w: number, h: number, wall: Wall, u: number, y: number, o?: PosterOpts) => {
    all.push(p);
    room.add(poster(p.tex, w, h, wall, u, y, o));
  };
  // Mur de bois : bannière du Tour au-dessus des étagères, Paris–Roubaix dans le coin.
  add(tourBanner(), 2.3, 0.54, 'wood', 1.9, 2.76, { tilt: 0.006 });
  add(roubaix(), 0.6, 0.848, 'wood', -2.62, 1.78, { tilt: -0.02 });
  // Mur de droite : une rangée d'affiches au-dessus des vélos appuyés.
  add(giro(), 0.52, 0.735, 'right', -2.3, 1.85, { frame: '#1c1c1e' });
  add(tour(), 0.52, 0.735, 'right', -0.72, 1.85, { frame: '#3a2a1c' });
  add(sanremo(), 0.5, 0.707, 'right', 0.85, 1.85, { tilt: 0.015 });
  add(cyclesAd(), 0.52, 0.735, 'right', 1.75, 1.85, { frame: '#6b4a2b' });
  add(liege(), 0.52, 0.735, 'right', 2.7, 1.85, { frame: '#1c1c1e' });
  // Mur du rack : affiches à l'italienne au-dessus des vélos, plaque émaillée.
  add(flandres(), 0.92, 0.65, 'front', 1.85, 2.76, { tilt: -0.012 });
  add(vuelta(), 0.92, 0.65, 'front', 0.15, 2.76, { tilt: 0.01 });
  add(oilAd(), 0.8, 0.566, 'front', -1.6, 2.76, { enamel: true });
  return { group: room, setArt: (art) => all.forEach((p) => p.repaint(art)) };
}
