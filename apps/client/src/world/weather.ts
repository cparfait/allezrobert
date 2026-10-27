import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { instanceIndex, hash, time, vec3, float, uniform, positionLocal, mod, mix, color, cameraPosition } from 'three/tsl';

const BOX = 60; // côté du volume de pluie centré sur la caméra (m)
const COUNT = 24000;

/**
 * Pluie : gouttes étirées animées entièrement sur le GPU (TSL), dans un volume qui suit la
 * caméra ; densité et inclinaison selon l'intensité et le vent. Aucune allocation par image.
 */
export class Rain {
  readonly mesh: THREE.InstancedMesh;
  readonly intensity = uniform(0);
  readonly wind = uniform(new THREE.Vector2(0, 0));

  constructor() {
    // Deux quads croisés : la goutte reste visible sous tous les angles.
    const a = new THREE.PlaneGeometry(0.012, 0.55);
    const b = new THREE.PlaneGeometry(0.012, 0.55).rotateY(Math.PI / 2);
    const geo = mergeGeometries([a, b]) as THREE.BufferGeometry;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const id = instanceIndex.toFloat();
    const hx = hash(id);
    const hy = hash(id.add(13.1));
    const hz = hash(id.add(71.7));
    const speed = float(9).add(hash(id.add(3.3)).mul(3));
    // Gouttes fixes dans le monde, repliées (mod) dans un volume centré sur la caméra : elles
    // défilent quand on avance, et tombent en boucle infinie.
    const cam = cameraPosition;
    const wrap = (v: THREE.Node<'float'>, c: THREE.Node<'float'>) => c.add(mod(v.sub(c), BOX)).sub(BOX / 2);
    const fall = mod(hy.mul(BOX).sub(time.mul(speed)).sub(cam.y), BOX);
    const world = vec3(wrap(hx.mul(1000), cam.x), cam.y.add(fall).sub(BOX / 3), wrap(hz.mul(1000), cam.z));
    const tilt = vec3(this.wind.x.mul(positionLocal.y).mul(0.08), 0, this.wind.y.mul(positionLocal.y).mul(0.08));
    m.positionNode = positionLocal.add(tilt).add(world);
    m.colorNode = mix(color('#c9d6e3'), color('#ffffff'), hx);
    m.opacityNode = float(0.32);
    this.mesh = new THREE.InstancedMesh(geo, m, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'rain';
    this.mesh.visible = false;
  }

  update(rain: number, windMs: number, windFrom: number): void {
    this.intensity.value = rain;
    this.mesh.visible = rain > 0.02;
    // Seules les gouttes de l'intensité courante sont dessinées (avant : toutes, les autres repliées hors champ).
    this.mesh.count = Math.ceil(COUNT * Math.min(1, Math.max(0, rain)));
    (this.wind.value as THREE.Vector2).set(-Math.sin(windFrom) * windMs, Math.cos(windFrom) * windMs);
  }
}
