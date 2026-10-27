import * as THREE from 'three/webgpu';
import { positionLocal, normalize, mix, vec3, float, uniform, hash, floor, smoothstep, pow, max } from 'three/tsl';
import { domeVertex } from './overcast.ts';

/**
 * Voûte nocturne : dégradé bleu nuit (horizon plus clair, pollution lumineuse d'Île-de-France
 * vers le nord-est) et champ d'étoiles procédural. Se superpose au ciel physique selon la nuit.
 */
export class NightSky {
  readonly mesh: THREE.Mesh;
  readonly night = uniform(0);

  constructor() {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
    // Collée à la caméra et derrière tout : une sphère de 400 km était découpée par le plan lointain (pas d'étoiles).
    m.vertexNode = domeVertex();
    const dir = normalize(positionLocal);
    const up = max(dir.y, float(0));
    const zenith = vec3(0.01, 0.018, 0.045);
    const horizon = vec3(0.06, 0.08, 0.14);
    // Halo de Paris : lueur orangée à l'horizon nord-est (z négatif = nord, x positif = est).
    const glowDir = normalize(vec3(0.6, 0, -0.8));
    const glow = pow(max(dir.dot(glowDir), float(0)), float(6)).mul(float(1).sub(smoothstep(0.0, 0.25, up))).mul(0.25);
    let col = mix(horizon, zenith, smoothstep(0.0, 0.5, up)).add(vec3(0.9, 0.55, 0.3).mul(glow));
    // Étoiles : une cellule sur ~400 brille, intensité et scintillement aléatoires.
    const cell = floor(dir.mul(420));
    const h = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)));
    const star = smoothstep(0.9975, 1.0, h).mul(smoothstep(0.05, 0.25, up)).mul(hash(h.mul(91)).mul(1.5).add(0.5));
    col = col.add(vec3(star, star, star.mul(1.1)));
    m.colorNode = col;
    m.opacityNode = this.night;
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'nightsky';
  }
}
