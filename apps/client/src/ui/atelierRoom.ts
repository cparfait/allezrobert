import * as THREE from 'three/webgpu';

/**
 * Pièce de l'atelier (repère : sol y = 0, vélo au centre, mur du fond en x = −3,2). Inspirée d'un
 * vrai atelier de vélo : parquet en lames, murs gris à lames verticales, mur de bois côté étagères,
 * plafond en bois avec spots encastrés, panneau perforé garni d'outils bleus et acier, établi,
 * vélos suspendus au mur, étagères de cartons, pneus en rouleau, fût, paillasson.
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
function rng(seed: number): () => number {
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
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
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

/** Lames verticales (murs gris) : base de couleur, rainures sombres, léger dégradé par lame. */
function boardsTexture(base: string, groove: string, boards = 8, light = 0.06): THREE.CanvasTexture {
  return canvasTex(
    512,
    512,
    (g) => {
      const r = rng(5 + boards);
      const bw = 512 / boards;
      for (let i = 0; i < boards; i++) {
        g.fillStyle = base;
        g.fillRect(i * bw, 0, bw, 512);
        g.fillStyle = `rgba(255,255,255,${(r() * light).toFixed(3)})`;
        g.fillRect(i * bw, 0, bw, 512);
        g.fillStyle = `rgba(0,0,0,${(r() * light).toFixed(3)})`;
        g.fillRect(i * bw + bw * 0.5, 0, bw * 0.5, 512);
        g.fillStyle = groove;
        g.fillRect(i * bw, 0, 3, 512);
      }
    },
    [1, 1],
  );
}

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

/** Panneau perforé gris avec ses outils bleus et acier (clés Allen, clés plates, tournevis, pinces, bacs). */
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
    const steel = '#c9ced4';
    const blue = '#2a63c0';
    const dark = '#26282c';
    const shape = (draw: (ox: number, oy: number, col: string) => void, x: number, y: number, col: string, fill?: string) => {
      draw(x + 4, y + 6, 'rgba(0,0,0,0.28)');
      draw(x, y, fill ?? col);
    };
    const line = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    };
    // Clés Allen en L, bleues, deux séries de tailles croissantes (à gauche).
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < 9; i++) {
        const x = 40 + s * 150 + i * 14;
        const len = 80 + i * 7;
        shape((ox, oy, c) => {
          line(ox, oy, ox, oy + len, 6, c);
          line(ox, oy + len, ox + 30 + i, oy + len, 6, c);
        }, x, 50, i % 2 ? steel : blue);
      }
    }
    // Clés mixtes : rangées de clés plates bleues et acier, du plus petit au plus grand.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 10; i++) {
        const x = 380 + i * 44;
        const len = 120 + i * 9 + row * 18;
        const y = 40 + row * 190 - (row === 2 ? 20 : 0);
        shape((ox, oy, c) => {
          line(ox, oy + 12, ox, oy + len - 12, 9, c);
          g.strokeStyle = c;
          g.lineWidth = 7;
          g.beginPath();
          g.arc(ox, oy + 12, 13, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.arc(ox, oy + len - 12, 13, 0, Math.PI * 2);
          g.stroke();
        }, x, y, row === 1 ? blue : steel);
      }
    }
    // Tournevis (manches colorés, tiges acier) et mèches.
    const handles = [blue, dark, '#e8741c', blue, dark, '#d3d6da', blue, dark];
    for (let i = 0; i < 8; i++) {
      const x = 830 + i * 26;
      shape((ox, oy, c) => {
        line(ox, oy + 60, ox, oy + 105, 3, steel);
        line(ox, oy, ox, oy + 60, 14, c);
      }, x, 50, handles[i] as string);
    }
    // Pinces : poignées bleues.
    for (let i = 0; i < 4; i++) {
      const x = 1090 + i * 52;
      shape((ox, oy, c) => {
        line(ox, oy, ox - 8, oy + 70, 12, c);
        line(ox + 14, oy, ox + 22, oy + 70, 12, c);
        line(ox + 7, oy - 36, ox + 7, oy + 4, 10, steel);
      }, x, 80, blue);
    }
    // Jauge, clé à molette et rayonneur : grands outils à droite.
    shape((ox, oy, c) => {
      line(ox, oy, ox + 90, oy + 230, 22, c);
      g.fillStyle = c;
      g.beginPath();
      g.arc(ox - 6, oy - 12, 38, 0, Math.PI * 2);
      g.fill();
    }, 1300, 90, steel);
    shape((ox, oy, c) => {
      line(ox, oy, ox, oy + 190, 16, c);
      g.fillStyle = c;
      g.fillRect(ox - 22, oy - 12, 44, 30);
    }, 1440, 120, blue);
    // Marteau.
    shape((ox, oy, c) => {
      line(ox, oy + 20, ox, oy + 190, 12, '#8a5a2b');
      g.fillStyle = c;
      g.fillRect(ox - 34, oy - 6, 68, 28);
    }, 1230, 330, '#3a3c40');
    // Bidon, pots : petites cases bleues sur la tablette basse.
    for (let i = 0; i < 12; i++) {
      const x = 380 + i * 48;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(x + 3, 566, 38, 38);
      g.fillStyle = r() > 0.25 ? blue : '#d3d6da';
      g.fillRect(x, 560, 38, 38);
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
  const rubber = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), mat('#202224', 0.95));
  rubber.rotation.x = -Math.PI / 2;
  rubber.position.set(0, 0.003, 0);
  rubber.receiveShadow = true;
  room.add(rubber);
  // Paillasson devant l'établi, lisible depuis la caméra d'ensemble.
  const doorMat = new THREE.Group();
  const dm = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), tex(matTexture(), 0.95));
  dm.rotation.x = -Math.PI / 2;
  dm.receiveShadow = true;
  doorMat.add(dm);
  doorMat.position.set(1.7, 0.005, 0.95);
  doorMat.rotation.y = 0.9;
  room.add(doorMat);

  // Murs : gris à lames verticales (fond, gauche, droite), bois blond côté étagères (z = −3).
  const grey = tex(boardsTexture('#c4c7ca', 'rgba(60,66,72,0.5)'), 0.85);
  const pine = tex(pineTexture(), 0.8);
  const walls: Array<[number, number, number, number, THREE.Material, number]> = [
    // largeur, x, z, rotation y, matériau, répétition (m par motif = 0,96)
    [7, -3.2, 0, Math.PI / 2, grey, 0],
    [7, 3.4, 0, -Math.PI / 2, grey, 0],
    [6.6, 0.1, -3.0, 0, pine, 0],
    [6.6, 0.1, 3.4, Math.PI, grey, 0],
  ];
  for (const [w, x, z, ry, m] of walls) {
    const mm = (m as THREE.MeshStandardNodeMaterial).clone() as THREE.MeshStandardNodeMaterial;
    const t = (m as THREE.MeshStandardNodeMaterial).map?.clone() as THREE.Texture;
    t.needsUpdate = true;
    t.repeat.set(w / 0.96, H / 0.96);
    mm.map = t;
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
  const showWheel = rackWheel('#1b1c1f', 0.05);
  showWheel.rotation.y = Math.PI / 2;
  showWheel.scale.setScalar(0.85);
  showWheel.position.set(-3.1, 2.04, -0.9);
  room.add(showWheel);

  // Fût en acier dans l'angle, pompe à pied contre l'établi.
  const barrel = cyl(0.26, 0.85, mat('#9aa1a8', 0.35, 0.9), -2.6, 0.425, 2.4 - 5.0, 28);
  room.add(barrel);
  for (const y of [0.15, 0.7]) room.add(cyl(0.268, 0.025, mat('#6c7278', 0.4, 0.9), -2.6, y, -2.6, 28));
  room.add(cyl(0.022, 0.62, mat('#2a63c0', 0.4, 0.3), -2.35, 0.31, 0.75, 12));
  room.add(box(0.2, 0.025, 0.08, mat('#1a1b1e', 0.6), -2.35, 0.012, 0.75));

  // Étagères de bois sur le mur de bois : cartons bruns, boîtes bleues et blanches, huiles.
  const shelfM = mat('#c79a62', 0.75);
  const r = rng(21);
  for (const [y, n] of [[1.05, 7], [1.55, 7], [2.05, 6]] as const) {
    room.add(box(2.7, 0.035, 0.34, shelfM, 1.9, y, -2.82));
    let x = 0.65;
    for (let i = 0; i < n; i++) {
      const w = 0.2 + r() * 0.16;
      const h = 0.14 + r() * 0.14;
      const c = r() < 0.4 ? '#b58d58' : r() < 0.6 ? '#2a63c0' : r() < 0.8 ? '#e6e8ea' : '#6d4f30';
      room.add(box(w, h, 0.26, mat(c, 0.7), x + w / 2, y + 0.018 + h / 2, -2.8));
      x += w + 0.03;
    }
  }
  // Rouleaux de pneus (empilés) au sol, contre le mur de bois.
  for (const [x, k] of [[1.2, 5], [2.15, 4]] as const) {
    for (let i = 0; i < k; i++) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.05, 10, 36), mat('#141416', 0.9));
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
