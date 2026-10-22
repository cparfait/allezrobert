import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Type de vélo affiché : route (modèle Blender), gravel (pneus larges à flancs beiges), VTT. */
export type BikeType = 'road' | 'gravel' | 'mtb';

/**
 * Repères du vélo route (bike.glb), en mètres, repère du modèle : x à gauche, y en haut,
 * z vers l'avant. Le pédalier et les pédales restent ceux du modèle ; les mains du coureur
 * (au repos, x = ±0,20, y = 0,958, z = 0,54) tiennent le cintre du VTT au même endroit.
 */
const BB = new THREE.Vector3(0, 0.27, 0);
const WHEEL_R = 0.335;

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Tube droit de rayon r entre deux points. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, r2 = r, seg = 10): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r2, r, d.length(), seg, 1);
  g.translate(0, d.length() / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return clean(g);
}

/** Ne garde que position, normale (et index) : fusion possible entre géométries de types différents. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  return out;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(list.map(clean)) as THREE.BufferGeometry;
}

/** Maillage avec un matériau nommé : l'avatar le remplace par sa version (couleurs du coureur). */
function named(geo: THREE.BufferGeometry, material: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: material }));
  m.castShadow = true;
  return m;
}

/**
 * Roue (centrée sur l'axe, plan y-z) : pneu, jante, rayons, moyeu, disque de frein ; crampons
 * en option (VTT, gravel). `wall` : flancs beiges (gravel).
 */
function wheel(opts: { tireR: number; tireW: number; knobs: number; knobSize: number; wall: boolean; side: 1 | -1 }): THREE.Group {
  const g = new THREE.Group();
  const R = WHEEL_R - opts.tireW;
  const tire = new THREE.TorusGeometry(R, opts.tireW, 10, 48).rotateY(Math.PI / 2);
  const parts: Record<string, THREE.BufferGeometry[]> = { tire: [tire], rim: [], chrome: [], components: [], tire_wall: [] };
  if (opts.knobs) {
    for (let i = 0; i < opts.knobs; i++) {
      const a = (i / opts.knobs) * Math.PI * 2;
      for (const x of [-1, 0, 1]) {
        if (x !== 0 && i % 2) continue;
        const k = new THREE.BoxGeometry(opts.knobSize * 1.4, opts.knobSize, opts.knobSize * 1.2);
        k.translate(x * opts.tireW * 0.55, WHEEL_R - opts.knobSize * 0.35, 0);
        k.rotateX(a);
        parts.tire?.push(k);
      }
    }
  }
  // Flancs beiges : anneau un peu plus large que le pneu, côté jante, visible de profil.
  if (opts.wall) parts.tire_wall?.push(new THREE.TorusGeometry(R - opts.tireW * 0.62, opts.tireW * 0.5, 8, 48).rotateY(Math.PI / 2).scale(1.35, 1, 1));
  parts.rim?.push(new THREE.TorusGeometry(R - opts.tireW - 0.006, 0.013, 6, 48).rotateY(Math.PI / 2));
  const hub = v(0, 0, 0);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const side = i % 2 ? 0.03 : -0.03;
    const rimP = v(0, Math.sin(a) * (R - opts.tireW - 0.015), Math.cos(a) * (R - opts.tireW - 0.015));
    parts.chrome?.push(tube(hub.clone().setX(side), rimP, 0.0012, 0.0012, 4));
  }
  parts.components?.push(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 12).rotateZ(Math.PI / 2));
  // Disque de frein, côté gauche.
  parts.chrome?.push(new THREE.CylinderGeometry(0.08, 0.08, 0.002, 24).rotateZ(Math.PI / 2).translate(0.045 * opts.side, 0, 0));
  for (const [mat, list] of Object.entries(parts)) if (list.length) g.add(named(merge(list), mat));
  return g;
}

/**
 * Remplace le cadre et les roues du vélo route d'un niveau de détail par le kit demandé :
 * - gravel : cadre route conservé (cintre de route), pneus larges crantés à flancs beiges,
 *   sacoche de cadre ;
 * - VTT : semi-rigide complet (cadre surdimensionné, fourche suspendue, cintre plat et poignées,
 *   tige de selle, gros pneus crantés, freins à disque).
 * Les nœuds `wheel_front` / `wheel_rear` du kit tournent comme ceux du modèle d'origine.
 * Renvoie le groupe du kit (null pour la route).
 */
export function buildBikeKit(level: THREE.Object3D, type: BikeType): THREE.Group | null {
  if (type === 'road') return null;
  // Géométries construites une fois par type, partagées par tous les coureurs (clones).
  let tpl = KIT_TEMPLATES.get(type);
  if (!tpl) KIT_TEMPLATES.set(type, (tpl = makeKit(type)));
  const kit = tpl.clone(true);
  level.add(kit);
  return kit;
}

const KIT_TEMPLATES = new Map<BikeType, THREE.Group>();

function makeKit(type: Exclude<BikeType, 'road'>): THREE.Group {
  const kit = new THREE.Group();
  kit.name = `kit_${type}`;
  const frontZ = type === 'mtb' ? 0.66 : 0.59;
  const rearZ = type === 'mtb' ? -0.43 : -0.41;
  const opts =
    type === 'mtb'
      ? { tireR: WHEEL_R, tireW: 0.034, knobs: 44, knobSize: 0.012, wall: false }
      : { tireR: WHEEL_R, tireW: 0.021, knobs: 64, knobSize: 0.006, wall: true };
  const front = wheel({ ...opts, side: 1 });
  front.name = 'wheel_front';
  front.position.set(0, WHEEL_R, frontZ);
  const rear = wheel({ ...opts, side: 1 });
  rear.name = 'wheel_rear';
  rear.position.set(0, WHEEL_R, rearZ);
  kit.add(front, rear);

  if (type === 'gravel') {
    // Sacoche de cadre sous le tube horizontal (couleur d'accent du maillot).
    const bag = new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(0, 0.7, 0.18);
    bag.rotateX(-0.08);
    kit.add(named(bag, 'bottle'));
  } else {
    // Cadre semi-rigide : points clés.
    const seatTop = v(0, 0.72, -0.16);
    const headTop = v(0, 0.84, 0.47);
    const headBot = v(0, 0.7, 0.52);
    const frame: THREE.BufferGeometry[] = [
      tube(BB.clone().add(v(0, 0.02, 0.02)), headBot, 0.03, 0.027, 14), // tube oblique
      tube(BB, seatTop, 0.017),
      tube(v(0, 0.7, -0.15), headTop.clone().add(v(0, -0.03, -0.01)), 0.02, 0.021),
      tube(headBot.clone().add(v(0, -0.02, 0.01)), headTop.clone().add(v(0, 0.02, -0.005)), 0.026, 0.026, 14), // douille
    ];
    for (const s of [-1, 1]) {
      frame.push(tube(v(0.025 * s, 0.27, -0.02), v(0.065 * s, WHEEL_R, rearZ), 0.012, 0.009));
      frame.push(tube(v(0.02 * s, 0.69, -0.15), v(0.065 * s, WHEEL_R + 0.01, rearZ + 0.01), 0.009, 0.008));
    }
    kit.add(named(merge(frame), 'frame'));
    // Fourche suspendue : té, plongeurs dorés, fourreaux noirs avec arceau.
    const crown = v(0, 0.665, 0.535);
    const fork: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.15, 0.03, 0.05).translate(crown.x, crown.y, crown.z)];
    const legEnd = v(0, WHEEL_R, frontZ);
    const lower: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const top = v(0.058 * s, crown.y, crown.z);
      const mid = v(0.058 * s, 0.5, crown.z + ((0.665 - 0.5) / (0.665 - WHEEL_R)) * (legEnd.z - crown.z));
      fork.push(tube(top, mid, 0.016));
      lower.push(tube(mid.clone().add(v(0, 0.03, -0.012)), v(0.058 * s, WHEEL_R - 0.01, frontZ + 0.005), 0.021, 0.019));
    }
    lower.push(tube(v(-0.058, 0.47, crown.z + 0.075), v(0.058, 0.47, crown.z + 0.075), 0.012));
    kit.add(named(merge(fork), 'chrome'));
    // Poste de pilotage : potence courte, cintre plat relevé, poignées, leviers.
    const clamp = v(0, 0.935, 0.535);
    const cockpit: THREE.BufferGeometry[] = [
      tube(headTop, clamp, 0.017),
      tube(v(-0.31, 0.958, 0.54), v(0.31, 0.958, 0.54), 0.011),
      tube(BB.clone().add(v(0, 0.45, -0.16)), v(0, 0.885, -0.205), 0.0135), // tige de selle
    ];
    for (const s of [-1, 1]) cockpit.push(tube(v(0.135 * s, 0.958, 0.54), v(0.115 * s, 0.945, 0.6), 0.004));
    kit.add(named(merge([...lower, ...cockpit]), 'components'));
    const grips: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) grips.push(tube(v(0.165 * s, 0.958, 0.54), v(0.3 * s, 0.958, 0.54), 0.016));
    // Selle VTT.
    grips.push(new THREE.BoxGeometry(0.13, 0.04, 0.27).translate(0, 0.905, -0.205));
    kit.add(named(merge(grips), 'saddle_grip'));
  }
  return kit;
}

/** Nœuds du vélo route remplacés par un kit (cachés quand le kit est visible). */
export function roadPartsReplaced(type: BikeType): string[] {
  return type === 'mtb' ? ['frame', 'wheel_front', 'wheel_rear'] : type === 'gravel' ? ['wheel_front', 'wheel_rear'] : [];
}

export { BB as BIKE_BB };
