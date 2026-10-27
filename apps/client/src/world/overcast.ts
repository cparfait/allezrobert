import * as THREE from 'three/webgpu';
import { Fn, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, float, max, mix, normalize, positionLocal, smoothstep, uniform, vec4 } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';

/**
 * Ciel couvert : le ciel physique (SkyMesh) reste bleu entre des cumulus blancs même à 100 % de nuages.
 * Un voile gris (plus clair vers l'horizon) se pose dessus selon la couverture : ciel de pluie plombé,
 * et, posé aussi dans la capture du ciel (SkyLight), lumière d'ambiance et reflets assombris d'eux-mêmes.
 * Uniformes partagés par les deux dômes (scène et capture).
 */
export const overcast = {
  /** Opacité du voile (0 : ciel physique seul). */
  amount: uniform(0),
  /** Gris du zénith et de l'horizon (déjà éclairés selon l'heure). */
  zenith: colorUniform('#7d838b'),
  horizon: colorUniform('#aeb4ba'),
};

/** Profondeur des dômes du ciel : derrière tout, relief lointain compris (horizon.ts, 1 − 1e-6), devant le fond. */
const DOME_DEPTH = 1 - 5e-7;

/**
 * Sommets d'un dôme centré sur la caméra (sphère unité), à la profondeur DOME_DEPTH : jamais découpé par le
 * plan lointain (une sphère de plusieurs centaines de kilomètres l'était, et restait invisible).
 */
export function domeVertex(): THREE.Node {
  return Fn(() => {
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(cameraPosition.add(positionLocal.mul(500)), 1)).toVar();
    clip.z.assign(clip.w.mul(DOME_DEPTH));
    return clip;
  })() as unknown as THREE.Node;
}

/** Dôme du voile couvert, dessiné après le ciel et avant la voûte nocturne. */
export function overcastDome(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false, fog: false });
  m.vertexNode = domeVertex();
  const up = max(normalize(positionLocal).y, float(0));
  m.colorNode = mix(overcast.horizon.node, overcast.zenith.node, smoothstep(0, 0.6, up));
  m.opacityNode = overcast.amount;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m);
  mesh.renderOrder = -1.5;
  mesh.frustumCulled = false;
  mesh.name = 'overcast';
  return mesh;
}

/** Règle le voile : couverture (0–1, pluie comprise) et éclairement du jour (0 la nuit, 1 en plein jour). */
export function setOvercast(clouds: number, daylight: number): void {
  overcast.amount.value = smoothstep01((clouds - 0.6) / 0.35) * 0.92;
  const k = 0.12 + 0.88 * daylight;
  overcast.zenith.value.setRGB(0.42 * k, 0.45 * k, 0.49 * k);
  overcast.horizon.value.setRGB(0.66 * k, 0.69 * k, 0.72 * k);
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
