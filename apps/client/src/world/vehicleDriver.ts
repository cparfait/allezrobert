import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Occupant d'un véhicule du trafic : personnage assis à facettes (buste, tête, bras tendus vers le volant,
 * jambes), son siège et son volant. Conducteur des voitures et utilitaires, paysan (chapeau de paille, bleu
 * de travail) des tracteurs. Un seul maillage (groupes par matériau), géométrie partagée par allure.
 *
 * Style réaliste : une fois `loadDriverModels` passé, le personnage à facettes est remplacé par un personnage du
 * public assis au volant (tools/blender/crowd/pose_driver.py, public/models/drivers/), le paysan par
 * `paysan.glb` ; siège et volant à facettes restent quand le véhicule n'a pas les siens.
 *
 * Repère : origine au point de hanche (assise du siège), regard vers +z (avant du véhicule), y vers le haut.
 * Le sommet de la tête est à ≈ 0,80 m de l'origine, les mains à ≈ 0,42 m en avant.
 */

export type DriverLook = 'driver' | 'farmer';

const SLOT = { Skin: 0, Top: 1, Legs: 2, Hair: 3, Dark: 4 } as const;

type P = [number, number, number];

/** Prisme à section rectangulaire de `a` à `b` (largeur × épaisseur à chaque bout), faces vers l'extérieur. */
function prism(out: number[], a: P, b: P, w0: number, d0: number, w1 = w0, d1 = d0): void {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const axis = B.clone().sub(A).normalize();
  // Largeur le long de x (ou de y pour un segment couché sur x), épaisseur perpendiculaire.
  const ref = Math.abs(axis.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = ref.sub(axis.clone().multiplyScalar(ref.dot(axis))).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  const corner = (c: THREE.Vector3, w: number, d: number, su: number, sv: number) => c.clone().addScaledVector(u, (su * w) / 2).addScaledVector(v, (sv * d) / 2);
  const ring = (c: THREE.Vector3, w: number, d: number) => [corner(c, w, d, -1, -1), corner(c, w, d, 1, -1), corner(c, w, d, 1, 1), corner(c, w, d, -1, 1)];
  const r0 = ring(A, w0, d0);
  const r1 = ring(B, w1, d1);
  const center = A.clone().add(B).multiplyScalar(0.5);
  const n = new THREE.Vector3();
  const g = new THREE.Vector3();
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    n.crossVectors(q.clone().sub(p), r.clone().sub(p));
    g.copy(p).add(q).add(r).divideScalar(3).sub(center);
    for (const x of n.dot(g) >= 0 ? [p, q, r] : [p, r, q]) out.push(x.x, x.y, x.z);
  };
  const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s: THREE.Vector3) => {
    tri(p, q, r);
    tri(p, r, s);
  };
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    quad(r0[k] as THREE.Vector3, r0[j] as THREE.Vector3, r1[j] as THREE.Vector3, r1[k] as THREE.Vector3);
  }
  quad(r0[0] as THREE.Vector3, r0[1] as THREE.Vector3, r0[2] as THREE.Vector3, r0[3] as THREE.Vector3);
  quad(r1[0] as THREE.Vector3, r1[1] as THREE.Vector3, r1[2] as THREE.Vector3, r1[3] as THREE.Vector3);
}

/** Ce qu'une géométrie contient : tout, le personnage seul, ou le siège et le volant seuls. */
type Part = 'all' | 'body' | 'kit';

function geometryOf(look: DriverLook, part: Part): THREE.BufferGeometry {
  const parts: number[][] = [[], [], [], [], []];
  // Siège et volant : les pièces sombres, sauf les chaussures (`shoe`), qui vont avec le personnage.
  const add = (slot: number, a: P, b: P, w0: number, d0: number, w1?: number, d1?: number, shoe = false) => {
    const kit = slot === SLOT.Dark && !shoe;
    if (part === 'all' || (part === 'kit') === kit) prism(parts[slot] as number[], a, b, w0, d0, w1, d1);
  };
  const farmer = look === 'farmer';
  // Buste légèrement incliné vers le dossier ; le paysan se tient plus droit.
  const lean = farmer ? -0.05 : -0.1;
  const sh = 0.5;
  // Bleu de travail : buste aux couleurs du pantalon, chemise aux manches.
  add(farmer ? SLOT.Legs : SLOT.Top, [0, -0.02, 0], [0, sh, lean], 0.34, 0.2, 0.42, 0.2);
  add(SLOT.Skin, [0, sh, lean], [0, sh + 0.07, lean + 0.01], 0.1, 0.1);
  add(SLOT.Skin, [0, sh + 0.06, lean + 0.02], [0, sh + 0.28, lean + 0.02], 0.16, 0.19, 0.17, 0.2);
  if (farmer) {
    // Chapeau de paille : bord large, calotte.
    add(SLOT.Hair, [0, sh + 0.26, lean + 0.02], [0, sh + 0.285, lean + 0.02], 0.42, 0.44);
    add(SLOT.Hair, [0, sh + 0.285, lean + 0.02], [0, sh + 0.37, lean + 0.02], 0.2, 0.22, 0.17, 0.19);
  } else {
    // Cheveux : calotte et nuque.
    add(SLOT.Hair, [0, sh + 0.26, lean + 0.01], [0, sh + 0.31, lean + 0.01], 0.18, 0.21, 0.15, 0.18);
    add(SLOT.Hair, [0, sh + 0.12, lean - 0.085], [0, sh + 0.28, lean - 0.085], 0.17, 0.03);
  }
  // Volant incliné (octogone de 0,36 m), moyeu et colonne.
  const wy = 0.36;
  const wz = 0.47;
  const tilt = farmer ? 0.9 : 0.45;
  const rim: P[] = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.cos(a) * 0.18;
    const r = Math.sin(a) * 0.18;
    return [x, wy + r * Math.cos(tilt), wz - r * Math.sin(tilt)] as P;
  });
  rim.forEach((p, k) => add(SLOT.Dark, p, rim[(k + 1) % 8] as P, 0.03, 0.03));
  add(SLOT.Dark, [-0.17, wy, wz], [0.17, wy, wz], 0.03, 0.03);
  add(SLOT.Dark, [0, wy, wz], [0, wy - 0.3 * Math.sin(tilt), wz + 0.3 * Math.cos(tilt)], 0.06, 0.06);
  for (const s of [-1, 1]) {
    const shoulder: P = [s * 0.22, sh - 0.04, lean];
    const elbow: P = [s * 0.27, 0.24, 0.17];
    const hand: P = [s * 0.175, wy, wz - 0.03];
    add(SLOT.Top, shoulder, elbow, 0.1, 0.1, 0.085, 0.085);
    add(SLOT.Top, elbow, [s * 0.2, 0.33, 0.38], 0.085, 0.085, 0.07, 0.07);
    add(SLOT.Skin, [s * 0.2, 0.33, 0.38], hand, 0.07, 0.07, 0.075, 0.08);
    // Cuisses puis jambes (cachées par la caisse dans une voiture, visibles dans une cabine de tracteur).
    const knee: P = [s * 0.13, 0.1, 0.44];
    add(SLOT.Legs, [s * 0.1, 0.03, 0.02], knee, 0.15, 0.14, 0.12, 0.12);
    if (farmer) {
      add(SLOT.Legs, knee, [s * 0.13, -0.32, 0.56], 0.11, 0.11, 0.1, 0.1);
      add(SLOT.Dark, [s * 0.13, -0.36, 0.5], [s * 0.13, -0.36, 0.72], 0.11, 0.09, 0.11, 0.09, true);
    }
  }
  // Siège : assise, dossier et appuie-tête (dossier bas sur un tracteur).
  add(SLOT.Dark, [0, -0.1, -0.08], [0, -0.1, 0.36], 0.46, 0.1);
  add(SLOT.Dark, [0, -0.12, -0.13], [0, farmer ? 0.36 : 0.56, lean - 0.13], 0.46, 0.08, 0.42, 0.07);
  if (!farmer) add(SLOT.Dark, [0, 0.58, lean - 0.13], [0, 0.76, lean - 0.12], 0.24, 0.07);

  const g = new THREE.BufferGeometry();
  const all: number[] = [];
  parts.forEach((p, slot) => {
    if (!p.length) return;
    g.addGroup(all.length / 3, p.length / 3, slot);
    for (const x of p) all.push(x);
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const geometries = new Map<string, THREE.BufferGeometry>();

function sharedGeometry(look: DriverLook, part: Part): THREE.BufferGeometry {
  const key = `${look}|${part}`;
  let g = geometries.get(key);
  if (!g) geometries.set(key, (g = geometryOf(look, part)));
  return g;
}

const materials = new Map<string, THREE.Material>();

function flat(color: string, roughness = 0.8): THREE.Material {
  let m = materials.get(color);
  if (!m) {
    const made = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness: 0 });
    made.flatShading = true;
    materials.set(color, (m = made));
  }
  return m;
}

const SKINS = ['#e8b89a', '#d9a27e', '#f0c8ac', '#b97f5c', '#8a5a3c'];
const HAIRS = ['#2a211c', '#4a3524', '#6e4f2e', '#b08a52', '#8c8c8c', '#1a1a1c'];
const TOPS = ['#2f4f7a', '#8a2f2a', '#3b6b4a', '#d8d4c8', '#2b2d31', '#c98a2e', '#5d4a7a', '#7a8894', '#1f6f78'];
const TROUSERS = ['#2b3142', '#3a3a3c', '#4b5a72', '#5a4a3a'];
/** Paysan : chemise à carreaux (rouge, vert, écru), bleu de travail, chapeau de paille. */
const FARMER_SHIRTS = ['#a8372c', '#3f6b3a', '#d9cfb4', '#8a5a2c'];
const FARMER_BLUE = '#2f55a0';
const STRAW = '#dcc073';
const SEAT = '#24262a';

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length] as T;

/** Personnages du public assis (adultes), dans l'ordre de public/models/drivers. */
const PEOPLE = ['spectateur', 'homme_fort', 'femme', 'jeune_homme', 'femme_agee', 'fan_pois', 'fan_pois_femme', 'fan_jaune'];
const people: THREE.Object3D[] = [];
let farmerModel: THREE.Object3D | null = null;
let loadingPeople: Promise<boolean> | null = null;

/**
 * Charge une fois les occupants du style réaliste (facultatif : sans eux, personnages à facettes).
 * Même repère que le personnage à facettes : origine sur l'assise, regard vers +z.
 */
export function loadDriverModels(base = '/models/drivers/'): Promise<boolean> {
  loadingPeople ??= (async () => {
    const loader = new GLTFLoader();
    const load = async (name: string): Promise<THREE.Object3D | null> => {
      try {
        // La scène entière : le paysan a deux maillages (corps texturé, chapeau de paille).
        const scene = (await loader.loadAsync(`${base}${name}.glb`)).scene;
        scene.name = 'driver';
        scene.traverse((o) => {
          o.castShadow = false;
          o.receiveShadow = false;
        });
        return scene;
      } catch {
        return null;
      }
    };
    const [farmer, ...rest] = await Promise.all([load('paysan'), ...PEOPLE.map(load)]);
    farmerModel = farmer ?? null;
    for (const m of rest) if (m) people.push(m);
    return people.length > 0;
  })();
  return loadingPeople;
}

/** Triangles d'un occupant (contrôle du budget). */
export function driverTriangles(look: DriverLook): number {
  return (sharedGeometry(look, 'all').getAttribute('position').count / 3) | 0;
}

/**
 * Occupant prêt à poser dans un véhicule : `position` = point de hanche dans le repère du véhicule.
 * Couleurs (peau, cheveux, haut) tirées avec `rand`. `bare` : sans siège ni volant (modèle qui a les siens).
 * Sans ombre portée : il est le plus souvent sous un toit.
 */
export function buildDriver(look: DriverLook, rand: () => number = Math.random, bare = false): THREE.Object3D {
  const farmer = look === 'farmer';
  const model = farmer ? farmerModel : people.length ? pick(people, rand) : null;
  if (model) {
    // Personnage du public assis au volant ; siège et volant à facettes si le véhicule n'a pas les siens.
    const person = model.clone();
    if (bare) return person;
    const kit = new THREE.Mesh(sharedGeometry(look, 'kit'), [flat(SEAT), flat(SEAT), flat(SEAT), flat(SEAT), flat(SEAT)]);
    const group = new THREE.Group();
    group.name = 'driver';
    group.add(person, kit);
    return group;
  }
  const mesh = new THREE.Mesh(sharedGeometry(look, bare ? 'body' : 'all'), [
    flat(pick(SKINS, rand)),
    flat(pick(farmer ? FARMER_SHIRTS : TOPS, rand)),
    flat(farmer ? FARMER_BLUE : pick(TROUSERS, rand)),
    flat(farmer ? STRAW : pick(HAIRS, rand)),
    flat(SEAT),
  ]);
  mesh.name = 'driver';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}
