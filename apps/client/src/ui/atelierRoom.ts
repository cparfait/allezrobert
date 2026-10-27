import * as THREE from 'three/webgpu';

/**
 * Pièce de l'atelier (repère : sol y = 0, vélo au centre, mur du fond en x = −3,2). Inspirée d'un
 * vrai atelier de vélo : parquet en lames, murs gris à lames verticales, mur de bois côté étagères,
 * plafond en bois avec spots encastrés, panneau perforé garni d'outils bleus et acier, établi,
 * vélos suspendus au mur (route, gravel, VTT), roues haut de gamme, affiches, pneus en rouleau, fût, paillasson.
 * Les décors plats (parquet, murs, panneau d'outils) sont des textures canevas : peu de géométrie.
 */

export const mat = (c: string, rough = 0.7, metal = 0): THREE.MeshStandardNodeMaterial => new THREE.MeshStandardNodeMaterial({ color: c, roughness: rough, metalness: metal });

export function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export function cyl(r: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 16): THREE.Mesh {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** Tube de rayon r entre deux points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), m);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  o.castShadow = true;
  return o;
}

/** Générateur pseudo-aléatoire déterministe (le décor est identique à chaque ouverture). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Texture canevas répétable ou non. */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d') as CanvasRenderingContext2D);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

const tex = (map: THREE.Texture, rough = 0.8, metal = 0) => new THREE.MeshStandardNodeMaterial({ map, roughness: rough, metalness: metal });

/** Parquet : lames de 14 cm de large dans le sens du fond de la pièce (axe x), teintes et joints variés. */
function floorTexture(): THREE.CanvasTexture {
  return canvasTex(
    1024,
    1024,
    (g) => {
      const r = rng(11);
      const rows = 8;
      const rh = 1024 / rows;
      for (let i = 0; i < rows; i++) {
        let x = -r() * 500;
        while (x < 1024) {
          const len = 380 + r() * 520;
          const l = 62 + r() * 8;
          g.fillStyle = `hsl(${33 + r() * 5} ${26 + r() * 10}% ${l}%)`;
          g.fillRect(x, i * rh, len, rh);
          // Veines du bois.
          g.strokeStyle = 'rgba(80,55,30,0.16)';
          g.lineWidth = 1;
          for (let k = 0; k < 7; k++) {
            const y = i * rh + r() * rh;
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + len, y + (r() - 0.5) * 6);
            g.stroke();
          }
          g.fillStyle = 'rgba(60,40,20,0.55)';
          g.fillRect(x, i * rh, 2.5, rh);
          x += len;
        }
        g.fillStyle = 'rgba(60,40,20,0.5)';
        g.fillRect(0, i * rh, 1024, 2.5);
      }
    },
    [6.25, 6.25],
  );
}

/**
 * Roues haut de gamme accrochées aux murs (un crochet chacune) : paire de roues de l'atelier,
 * roue arrière de la paire (lenticulaire), centre x, y, z, rotation y.
 * Mur du fond (x = −3,2) au-dessus du vélo de la lisse ; mur de bois (z = −3) au-dessus du vélo appuyé.
 */
export const WALL_WHEELS: ReadonlyArray<readonly [string, boolean, number, number, number, number]> = [
  ['tune-wh-dt-arc50', false, -3.1, 2.78, 0.8, 0],
  ['tune-wh-zipp-808', false, -3.1, 2.78, 1.52, 0],
  ['tune-wh-hed-tri', false, -3.1, 2.78, 2.24, 0],
  ['tune-wh-zipp-super9', true, -3.1, 2.78, 2.96, 0],
  ['tune-wh-enve-34', false, -1.75, 2.5, -2.9, Math.PI / 2],
  ['tune-wh-campa-bora', false, -1.03, 2.5, -2.9, Math.PI / 2],
  ['tune-wh-roval-rapide', false, -0.31, 2.5, -2.9, Math.PI / 2],
];

/** Bois blond en lames verticales (mur des étagères) et plafond. */
function pineTexture(hue = 34, light = 62): THREE.CanvasTexture {
  return canvasTex(
    512,
    512,
    (g) => {
      const r = rng(77);
      const bw = 512 / 5;
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `hsl(${hue + r() * 4} ${42 + r() * 10}% ${light + r() * 8}%)`;
        g.fillRect(i * bw, 0, bw, 512);
        g.strokeStyle = 'rgba(120,80,40,0.22)';
        for (let k = 0; k < 14; k++) {
          const x = i * bw + r() * bw;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x + (r() - 0.5) * 10, 512);
          g.stroke();
        }
        g.fillStyle = 'rgba(70,45,20,0.6)';
        g.fillRect(i * bw, 0, 3, 512);
      }
    },
    [1, 1],
  );
}


/**
 * Mur d'atelier peint, vieilli : peinture inégale, plinthe plus sombre et salie vers le sol,
 * coulures sous le plafond, traces noires de guidons et de pneus, éraflures, fissures fines.
 * Texture unique par mur (pas de répétition visible) : `ratio` = hauteur / largeur du mur.
 */
function wallTexture(seed: number, ratio: number): THREE.CanvasTexture {
  const W = 2048;
  const H = Math.round(W * ratio);
  return canvasTex(W, H, (g) => {
    const r = rng(seed);
    const dado = H * 0.3; // hauteur de la sous-face foncée (≈ 1 m)
    const base = g.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#d2d4d6');
    base.addColorStop(0.7, '#c2c5c8');
    base.addColorStop(1, '#a5a9ad');
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // Peinture inégale : grandes taches très douces claires et sombres.
    for (let i = 0; i < 90; i++) {
      const x = r() * W;
      const y = r() * H;
      const rad = 80 + r() * 260;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = r() < 0.5 ? '255,255,255' : '40,45,52';
      gr.addColorStop(0, `rgba(${c},${(0.035 + r() * 0.05).toFixed(3)})`);
      gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Sous-face foncée (peinture grise plus mate) et son liseré de finition.
    const dg = g.createLinearGradient(0, H - dado, 0, H);
    dg.addColorStop(0, 'rgba(70,78,88,0.34)');
    dg.addColorStop(1, 'rgba(40,44,50,0.5)');
    g.fillStyle = dg;
    g.fillRect(0, H - dado, W, dado);
    g.fillStyle = 'rgba(30,33,38,0.55)';
    g.fillRect(0, H - dado - 2, W, 3);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(0, H - dado - 5, W, 2);
    // Coulures et salissures vers le plafond, poussière dense au pied du mur.
    for (let i = 0; i < 26; i++) {
      const x = r() * W;
      const len = 60 + r() * 220;
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(60,55,48,${(0.08 + r() * 0.1).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(60,55,48,0)');
      g.fillStyle = gr;
      g.fillRect(x, 0, 2 + r() * 5, len);
    }
    const dust = g.createLinearGradient(0, H - 90, 0, H);
    dust.addColorStop(0, 'rgba(50,44,36,0)');
    dust.addColorStop(1, 'rgba(50,44,36,0.4)');
    g.fillStyle = dust;
    g.fillRect(0, H - 90, W, 90);
    // Traces noires de pneus et de guidons (la hauteur d'un vélo appuyé au mur), éraflures claires.
    g.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const x = r() * W;
      const y = H - dado * (0.1 + r() * 1.7);
      const len = 30 + r() * 110;
      const a = -0.5 + r();
      g.strokeStyle = `rgba(14,14,16,${(0.1 + r() * 0.2).toFixed(3)})`;
      g.lineWidth = 3 + r() * 8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.4);
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const y = H - r() * dado * 2;
      g.strokeStyle = `rgba(255,255,255,${(0.12 + r() * 0.2).toFixed(3)})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 70, y + (r() - 0.5) * 24);
      g.stroke();
    }
    // Fissures fines.
    g.strokeStyle = 'rgba(40,40,44,0.28)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      let x = r() * W;
      let y = r() * H * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 14; k++) {
        x += (r() - 0.5) * 22;
        y += 6 + r() * 12;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Grain de la peinture.
    for (let i = 0; i < 24000; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
    }
  });
}

type TireBrand = { name: string; model: string; accent: string };
const TIRE_BRANDS: TireBrand[] = [
  { name: 'CONTINENTAL', model: 'GRAND PRIX 5000 S TR', accent: '#e8c21a' },
  { name: 'SCHWALBE', model: 'PRO ONE TUBELESS', accent: '#d8342c' },
  { name: 'PIRELLI', model: 'P ZERO RACE TLR', accent: '#e8c21a' },
  { name: 'VITTORIA', model: 'CORSA PRO', accent: '#3c8f4a' },
];
const tireTexCache = new Map<number, THREE.CanvasTexture>();

/** Pneu route : caoutchouc noir, bande de roulement fine, flancs avec marque, modèle, taille, liseré. */
function tireTexture(i: number): THREE.CanvasTexture {
  const hit = tireTexCache.get(i);
  if (hit) return hit;
  const b = TIRE_BRANDS[i % TIRE_BRANDS.length] as TireBrand;
  const t = canvasTex(2048, 256, (g) => {
    const r = rng(100 + i);
    g.fillStyle = '#17171a';
    g.fillRect(0, 0, 2048, 256);
    // Bande de roulement (centre du pneu : v = 0), fines nervures en chevrons.
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    for (let x = 0; x < 2048; x += 9) {
      for (const y0 of [0, 224]) {
        g.beginPath();
        g.moveTo(x, y0 + 4);
        g.lineTo(x + 5, y0 + 16);
        g.lineTo(x, y0 + 28);
        g.stroke();
      }
    }
    for (let k = 0; k < 5000; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(180,170,155,0.05)' : 'rgba(0,0,0,0.12)';
      g.fillRect(r() * 2048, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    // Flancs : liseré de couleur, marque en grandes lettres claires, modèle et taille.
    for (const [yc, flip] of [[64, false], [192, true]] as const) {
      g.save();
      g.translate(flip ? 2048 : 0, 0);
      g.scale(flip ? -1 : 1, 1);
      g.fillStyle = b.accent;
      g.fillRect(0, yc - 46, 2048, 3);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, yc - 43, 2048, 2);
      for (const x0 of [40, 1064]) {
        g.fillStyle = '#e4e3dd';
        g.font = '700 34px "Arial Black", Arial, sans-serif';
        g.textBaseline = 'middle';
        g.fillText(b.name, x0, yc - 14);
        g.fillStyle = 'rgba(228,227,221,0.85)';
        g.font = '600 20px Arial, sans-serif';
        g.fillText(`${b.model}  ·  28-622 (700×28C)  ·  MAX 6 BAR`, x0, yc + 20);
      }
      g.restore();
    }
    // Patine de poussière sur les flancs.
    for (let k = 0; k < 260; k++) {
      g.fillStyle = `rgba(190,180,165,${(0.02 + r() * 0.04).toFixed(3)})`;
      g.beginPath();
      g.ellipse(r() * 2048, 30 + r() * 200, 6 + r() * 26, 2 + r() * 5, 0, 0, Math.PI * 2);
      g.fill();
    }
  });
  tireTexCache.set(i, t);
  return t;
}

/** Panneau perforé gris avec ses outils bleus et acier (clés Allen, clés plates, tournevis, pinces, bacs). */
/** Panneau perforé nu (les outils sont en 3D : atelierTools.ts), un peu sali par l'usage. */
function pegboardTexture(): THREE.CanvasTexture {
  return canvasTex(1536, 640, (g) => {
    const W = 1536;
    const H = 640;
    const r = rng(3);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#a9aeb3');
    bg.addColorStop(1, '#8e949a');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(40,44,50,0.55)';
    for (let y = 8; y < H; y += 16) for (let x = 8; x < W; x += 16) g.fillRect(x, y, 3, 3);
    // Usure : traces d'outils et de doigts autour des crochets, coulures de graisse.
    for (let i = 0; i < 60; i++) {
      const x = r() * W;
      const y = H * 0.1 + r() * H * 0.6;
      const rad = 10 + r() * 40;
      const sm = g.createRadialGradient(x, y, 0, x, y, rad);
      sm.addColorStop(0, `rgba(40,38,34,${0.06 + r() * 0.08})`);
      sm.addColorStop(1, 'rgba(40,38,34,0)');
      g.fillStyle = sm;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  });
}

/** Paillasson de l'entrée : fibre de coco, logo du jeu. */
function matTexture(): THREE.CanvasTexture {
  return canvasTex(1024, 512, (g) => {
    const r = rng(9);
    g.fillStyle = '#a98558';
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = 'rgba(70,45,20,0.25)';
    for (let i = 0; i < 1800; i++) {
      const x = r() * 1024;
      const y = r() * 512;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 18, y + (r() - 0.5) * 18);
      g.stroke();
    }
    g.strokeStyle = '#3a2a18';
    g.lineWidth = 10;
    g.strokeRect(22, 22, 980, 468);
    g.fillStyle = '#2b1f12';
    g.textAlign = 'center';
    g.font = 'italic 900 130px "Arial Black", Arial, sans-serif';
    g.fillText('ALLEZ', 512, 200);
    g.fillStyle = '#7a1f14';
    g.fillText('ROBERT !', 512, 340);
    g.fillStyle = '#2b1f12';
    g.font = '700 40px Arial, sans-serif';
    g.fillText('ATELIER', 512, 430);
  });
}

/** Roue suspendue : pneu, jante, rayons, moyeu. */
export function rackWheel(rim: string, deep: number): THREE.Group {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.325, 0.013, 10, 48), mat('#141416', 0.85));
  const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.3 - deep / 2, deep / 2, 8, 48), mat(rim, 0.35, 0.2));
  rimM.scale.set(1, 1, 0.45);
  g.add(tire, rimM);
  const spokeM = mat('#b9bcc2', 0.3, 1);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.27 - deep, 4), spokeM);
    s.position.set(Math.cos(a) * (0.15 - deep / 2), Math.sin(a) * (0.15 - deep / 2), 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12).rotateX(Math.PI / 2), mat('#2a2c30', 0.4, 0.5)));
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

export function buildRoom(): THREE.Group {
  const room = new THREE.Group();
  room.name = 'atelier_room';
  const H = 3.2;

  // Parquet, et tapis en caoutchouc sous le pied d'atelier.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), tex(floorTexture(), 0.55));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);
  // Paillasson « Allez Robert ! » sous le vélo (dans le sens du vélo : le texte se lit depuis le côté caméra).
  const doorMat = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), tex(matTexture(), 0.95));
  doorMat.rotation.set(-Math.PI / 2, 0, Math.PI / 2, 'YXZ');
  doorMat.position.set(0, 0.004, 0.05);
  doorMat.receiveShadow = true;
  room.add(doorMat);

  // Murs : gris à lames verticales (fond, gauche, droite), bois blond au fond (z = −3).
  const pine = tex(pineTexture(), 0.8);
  const walls: Array<[number, number, number, number, THREE.Material | null]> = [
    // largeur, x, z, rotation y, matériau (null : mur peint, texture propre à chaque mur)
    [7, -3.2, 0, Math.PI / 2, null],
    [7, 3.4, 0, -Math.PI / 2, null],
    [6.6, 0.1, -3.0, 0, pine],
    [6.6, 0.1, 3.4, Math.PI, null],
  ];
  let wallSeed = 40;
  for (const [w, x, z, ry, m] of walls) {
    let mm: THREE.MeshStandardNodeMaterial;
    if (m) {
      mm = (m as THREE.MeshStandardNodeMaterial).clone() as THREE.MeshStandardNodeMaterial;
      const t = (m as THREE.MeshStandardNodeMaterial).map?.clone() as THREE.Texture;
      t.needsUpdate = true;
      t.repeat.set(w / 0.96, H / 0.96);
      mm.map = t;
    } else {
      mm = tex(wallTexture(wallSeed++, H / w), 0.9);
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(w, H), mm);
    wall.position.set(x, H / 2, z);
    wall.rotation.y = ry;
    wall.receiveShadow = true;
    room.add(wall);
  }
  // Plafond en lames de bois, spots encastrés (disques émissifs).
  const ceilTex = pineTexture(30, 56);
  ceilTex.repeat.set(7 / 0.96, 7 / 0.96);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), tex(ceilTex, 0.8));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  room.add(ceil);
  const spotM = new THREE.MeshStandardNodeMaterial({ color: '#000000', emissive: '#fff3dc', emissiveIntensity: 2.4 });
  for (const [x, z] of [[-2, -1.8], [-2, 0.6], [-0.4, -1.4], [-0.4, 1.4], [1.6, -1.6], [1.6, 0.6], [2.8, 1.8]] as const) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.012, 20), spotM);
    d.position.set(x, H - 0.008, z);
    room.add(d);
  }
  // Plinthe et corniche.
  room.add(box(0.025, 0.1, 6.6, mat('#7e8286', 0.7), -3.19, 0.05, 0.2));

  // Établi le long du mur du fond : plateau acier sombre, pieds, étagère basse, étau bleu, caisse.
  const top = mat('#4a4d52', 0.6, 0.3);
  const legM = mat('#2f3236', 0.5, 0.7);
  room.add(box(0.75, 0.06, 2.6, top, -2.78, 0.92, -0.9));
  for (const [x, z] of [[-3.05, -2.1], [-3.05, 0.3], [-2.5, -2.1], [-2.5, 0.3]] as const) room.add(box(0.06, 0.9, 0.06, legM, x, 0.45, z));
  room.add(box(0.7, 0.04, 2.5, mat('#3a3d41', 0.6, 0.3), -2.78, 0.25, -0.9));
  room.add(box(0.16, 0.12, 0.22, mat('#2a63c0', 0.45, 0.6), -2.55, 1.01, -1.9));
  room.add(box(0.34, 0.2, 0.55, mat('#2a63c0', 0.4, 0.3), -2.82, 1.05, -0.1));
  room.add(box(0.3, 0.03, 0.5, mat('#1a1b1e', 0.4, 0.6), -2.82, 1.16, -0.1));
  // Bacs de visserie bleus alignés sous le panneau.
  for (let i = 0; i < 7; i++) room.add(box(0.1, 0.05, 0.1, mat('#2a63c0', 0.5), -3.05, 0.98, -2.0 + i * 0.12));
  // Flacons et bidon d'entretien (blancs, verts, bleu).
  [['#f4f4f2', 0.07, 0.2], ['#2f8f4f', 0.07, 0.22], ['#f4f4f2', 0.065, 0.2], ['#c6d83a', 0.07, 0.21]].forEach(([c, r, h], i) => room.add(cyl(r as number, h as number, mat(c as string, 0.4), -2.85, 0.95 + (h as number) / 2, -0.55 + i * 0.13, 14)));
  room.add(box(0.14, 0.26, 0.17, mat('#eef0f2', 0.45), -2.8, 1.08, 0.32));

  // Panneau perforé garni d'outils au-dessus de l'établi, deux réglettes lumineuses, roue de démonstration.
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.33), tex(pegboardTexture(), 0.7, 0.1));
  peg.rotation.y = Math.PI / 2;
  peg.position.set(-3.17, 1.78, -0.9);
  peg.receiveShadow = true;
  room.add(peg);
  const strip = new THREE.MeshStandardNodeMaterial({ color: '#000000', emissive: '#f4f7ff', emissiveIntensity: 2.2 });
  for (const z of [-1.7, -0.1]) room.add(box(0.05, 0.035, 0.9, strip, -3.1, 2.62, z));


  // Fût en acier dans l'angle, pompe à pied contre l'établi.
  const barrel = cyl(0.26, 0.85, mat('#9aa1a8', 0.35, 0.9), -2.6, 0.425, 2.4 - 5.0, 28);
  room.add(barrel);
  for (const y of [0.15, 0.7]) room.add(cyl(0.268, 0.025, mat('#6c7278', 0.4, 0.9), -2.6, y, -2.6, 28));
  room.add(cyl(0.022, 0.62, mat('#2a63c0', 0.4, 0.3), -2.35, 0.31, 0.75, 12));
  room.add(box(0.2, 0.025, 0.08, mat('#1a1b1e', 0.6), -2.35, 0.012, 0.75));

  // Mur de bois : lisse d'acier pour le gravel (le VTT est appuyé au sol dessous ; placés par l'atelier), équerres.
  room.add(box(2.2, 0.035, 0.14, mat('#6d7279', 0.4, 0.8), 1.85, 1.28, -2.9));
  for (const x of [0.9, 1.85, 2.8]) {
    room.add(box(0.05, 0.22, 0.012, mat('#6d7279', 0.4, 0.8), x, 1.18, -2.994));
    room.add(box(0.03, 0.03, 0.12, mat('#6d7279', 0.4, 0.8), x, 1.26, -2.94));
  }
  // Rouleaux de pneus (empilés) au sol, contre le mur de bois, près du fût.
  for (const [x, k] of [[-1.98, 6]] as const) {
    for (let i = 0; i < k; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 20, 64), tex(tireTexture(i + (x > 2 ? 2 : 0)), 0.88));
      t.rotation.z = (i * 1.7 + x) % (Math.PI * 2); // chaque pneu tourné : les inscriptions ne s'alignent pas
      t.position.set(x, 0.38, -2.5 + i * 0.1);
      t.castShadow = true;
      t.receiveShadow = true;
      room.add(t);
    }
  }

  // Rack mural des vélos du jeu (placés par l'atelier) : lisse d'acier sous les roues, équerres et plaques de fixation.
  const rail = mat('#6d7279', 0.4, 0.8);
  room.add(box(5.4, 0.035, 0.14, rail, 0.3, 1.28, 3.3));
  for (const x of [-2.3, -0.9, 0.5, 1.9, 3.0]) {
    room.add(box(0.05, 0.22, 0.012, rail, x, 1.18, 3.394));
    room.add(box(0.03, 0.03, 0.12, rail, x, 1.26, 3.34));
  }

  // Mur du fond, côté coin : lisse pour un vélo et crochets pour trois roues carbone (placés par l'atelier).
  room.add(box(0.14, 0.035, 3.0, rail, -3.13, 1.28, 2.15));
  for (const z of [0.9, 1.7, 2.6, 3.3]) {
    room.add(box(0.12, 0.22, 0.05, rail, -3.16, 1.18, z));
    room.add(box(0.1, 0.03, 0.12, rail, -3.14, 1.26, z));
  }
  for (const [, , x, y, z, ry] of WALL_WHEELS) {
    // Crochet perpendiculaire au mur, juste au-dessus de la jante.
    const hook = ry ? cyl(0.012, 0.09, rail, x, y + 0.31, z - 0.05, 8).rotateX(Math.PI / 2) : cyl(0.012, 0.09, rail, x - 0.05, y + 0.31, z, 8).rotateZ(Math.PI / 2);
    room.add(hook);
  }

  // Home trainer dans le coin : corps, volant, pieds.
  const tr = new THREE.Group();
  tr.add(box(0.3, 0.42, 0.55, mat('#111214', 0.4, 0.2), 0, 0.33, 0));
  const fly = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 32).rotateZ(Math.PI / 2), mat('#2a2c30', 0.35, 0.8));
  fly.position.set(0.17, 0.33, 0);
  tr.add(fly);
  tr.add(box(0.95, 0.04, 0.06, mat('#2a2c30', 0.5, 0.6), 0, 0.03, -0.18));
  tr.add(box(0.95, 0.04, 0.06, mat('#2a2c30', 0.5, 0.6), 0, 0.03, 0.22));
  tr.add(box(0.02, 0.05, 0.3, mat('#2a63c0', 0.5), -0.16, 0.45, 0));
  tr.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  tr.position.set(2.6, 0, 2.6);
  tr.rotation.y = 0.6;
  room.add(tr);
  // Fenêtre lumineuse sur le mur de droite (x = 3,4).
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), new THREE.MeshStandardNodeMaterial({ color: '#000000', emissive: '#dfeaff', emissiveIntensity: 0.6 }));
  win.rotation.y = -Math.PI / 2;
  win.position.set(3.39, 1.8, -0.4);
  room.add(win);
  room.add(box(0.04, 1.06, 0.04, mat('#f4f4f2', 0.6), 3.37, 1.8, -0.4));
  return room;
}
