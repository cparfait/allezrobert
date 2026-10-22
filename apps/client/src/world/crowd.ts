import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, abs, vec3, float, mix, instanceIndex, hash, color, varying, max } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RouteTrack } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';

/** Spectateur : corps, tête et bras levés (attribut `part` : 0 corps, 1 tête, 2 bras). */
function personGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.getAttribute('position').count;
    g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const body = tag(new THREE.CapsuleGeometry(0.2, 0.9, 3, 8).translate(0, 0.75, 0), 0);
  const head = tag(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.42, 0), 1);
  const armL = tag(new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).rotateZ(0.5).translate(0.28, 1.35, 0), 2);
  const armR = tag(new THREE.CapsuleGeometry(0.05, 0.5, 2, 6).rotateZ(-0.5).translate(-0.28, 1.35, 0), 2);
  return mergeGeometries([body, head, armL, armR]) as THREE.BufferGeometry;
}

/**
 * Public sur les côtes : spectateurs le long des 350 derniers mètres de chaque KOM, des deux
 * côtés, qui sautent et agitent les bras (animation GPU, un seul appel de dessin).
 */
/** Slogans des pancartes (le nom du coureur s'ajoute en tête). */
const SLOGANS = ['ALLEZ !', 'ALLEZ ROBERT !', 'VAS-Y !', 'ON LÂCHE RIEN', 'KOM !'];

/** Texture d'une pancarte : carton clair, lettres peintes à la main. */
function signTexture(text: string, hue: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = hue % 2 ? '#f6f1e3' : '#fff8c2';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 154);
  ctx.fillStyle = ['#d62828', '#1d3557', '#2a9d8f', '#111111'][hue % 4] as string;
  ctx.font = `900 ${text.length > 10 ? 34 : 46}px Impact, Arial Black, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = text.split(' ');
  const lines = text.length > 10 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [text];
  lines.forEach((l, i) => ctx.fillText(l, 128, 80 + (i - (lines.length - 1) / 2) * 44, 236));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Crowd {
  readonly mesh: THREE.InstancedMesh;

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number, riderName = '') {
    const r = rng(2026);
    const mats: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const half = track.route.roadWidthM / 2;
    // Pancartes : un spectateur sur cinq en brandit une (une maille instanciée par slogan).
    const slogans = [riderName ? `ALLEZ ${riderName.toUpperCase().slice(0, 12)} !` : 'ALLEZ !', ...SLOGANS];
    const signMats: THREE.Matrix4[][] = slogans.map(() => []);
    for (const seg of track.route.segments.filter((s) => s.kind === 'kom')) {
      const from = Math.max(seg.startM, seg.endM - 350);
      for (let d = from; d < seg.endM; d += 3.2) {
        for (const side of [-1, 1]) {
          if (r() < 0.35) continue;
          const lateral = side * (half + 1.6 + r() * 3);
          const p = track.positionAt(d + r() * 2, lateral);
          const y = groundAt(p.x, p.z);
          // Face à la route : regard perpendiculaire à la direction de marche.
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.dirX, p.dirZ) + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
          const s = 0.9 + r() * 0.2;
          m.compose(new THREE.Vector3(p.x, (Number.isFinite(y) ? y : p.y) - 0.05, p.z), q, new THREE.Vector3(s, s, s));
          mats.push(m.clone());
          if (r() < 0.2) {
            // Pancarte tenue à bout de bras, au-dessus de la tête, tournée vers la route.
            const k = Math.floor(r() * slogans.length);
            const sm = new THREE.Matrix4().compose(new THREE.Vector3(p.x, (Number.isFinite(y) ? y : p.y) + 1.95 * s, p.z), q, new THREE.Vector3(1, 1, 1));
            (signMats[k] as THREE.Matrix4[]).push(sm);
          }
        }
      }
    }
    const mat = new THREE.MeshStandardNodeMaterial();
    const part = attribute<'float'>('part');
    const h = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(31));
    // Saut et bras agités, déphasés par spectateur.
    const jump = max(sin(time.mul(float(5).add(h.mul(3))).add(h.mul(20))), float(0)).mul(0.12).mul(h2.greaterThan(0.5).select(float(1), float(0.3)));
    const wave = sin(time.mul(9).add(h.mul(10))).mul(0.18).mul(part.equal(2).select(float(1), float(0)));
    // positionLocal inclut déjà la transformation d'instance : le côté du bras vient de l'attribut brut.
    const raw = attribute<'vec3'>('position');
    mat.positionNode = positionLocal.add(vec3(wave.mul(raw.x.sign()), jump.add(abs(wave).mul(0.3)), 0));
    // Maillots et vêtements variés : choix par paliers du hachage de l'instance.
    const step = (e: number) => h.greaterThan(e).select(float(1), float(0));
    const shirt = mix(mix(mix(mix(color('#e63946'), color('#ffd23f'), step(0.2)), color('#2a9d8f'), step(0.4)), color('#f4f4f4'), step(0.6)), color('#1f6feb'), step(0.8));
    const skin = mix(color('#f1c27d'), color('#8d5524'), h2);
    mat.colorNode = varying(mix(shirt, skin, part.equal(1).select(float(1), float(0))));
    mat.roughnessNode = float(0.8);
    this.mesh = new THREE.InstancedMesh(personGeometry(), mat, Math.max(mats.length, 1));
    mats.forEach((mm, i) => this.mesh.setMatrixAt(i, mm));
    this.mesh.count = mats.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'crowd';
    const board = new THREE.PlaneGeometry(0.8, 0.5);
    // Le plan regarde +z ; les spectateurs regardent la route selon leur rotation.
    slogans.forEach((text, k) => {
      const list = signMats[k] as THREE.Matrix4[];
      if (!list.length) return;
      const sm = new THREE.MeshStandardNodeMaterial({ map: signTexture(text, k), roughness: 0.9, side: THREE.DoubleSide });
      // Pancartes agitées : petit balancement vertical, déphasé par instance.
      sm.positionNode = positionLocal.add(vec3(0, sin(time.mul(6).add(hash(instanceIndex).mul(12))).mul(0.06), 0));
      const im = new THREE.InstancedMesh(board, sm, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = 'crowd-signs';
      this.mesh.add(im);
    });
  }
}
