import * as THREE from 'three/webgpu';
import type { RoadGraphData } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';
import { box, part, prism, template, type Template } from './lowPolyKit.ts';
import type { Site, SiteContext } from './polySites.ts';
import { GAY, RING, meshOf, strollPath } from './polySites.ts';

/**
 * Lieux de plein air de l'île (mode Poly) : cyclo-cross de Bois-Joli, bike park des Bois, écluse de la Robe,
 * belvédère des falaises de Kerbrou, régates au large de Robertville, petit train de la fête de l'Anneau et cerfs
 * des Bois. Décor original en primitives, posé d'après le graphe routier (sentiers) ou le relief (rivière, côte).
 */

let graphOf: () => RoadGraphData | undefined = () => undefined;
/** Graphe routier de l'île (world.ts) : tracé des sentiers du cyclo-cross et du bike park. */
export function setIslandGraph(of: () => RoadGraphData | undefined): void {
  graphOf = of;
}

const WHITE = new THREE.Color(0xffffff);
const C = (c: string) => new THREE.Color(c);

function kit() {
  const tri = (pts: number[], colour: string) => part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), colour);
  return {
    /** Piquet de rubalise. */
    stake: template([part(box(0.06, 1.1, 0.06, 0, 0.55), '#e9e6dc')]),
    /** Ruban rouge et blanc de 1 m (étiré selon l'écart des piquets). */
    tape: template([part(box(1, 0.07, 0.015, 0.5, 0.95), '#e2443a'), part(box(1, 0.07, 0.016, 0.5, 0.82), '#ffffff')]),
    bale: template([part(box(1.2, 0.55, 0.55, 0, 0.28), '#e3c46a'), part(box(1.22, 0.05, 0.57, 0, 0.2), '#b58f3c')]),
    /** Arche de départ gonflable, 6 m. */
    arch: template([
      ...[-3, 3].map((x) => part(prism(0.45, 0.45, 0, 4, 8, x, 0), '#ffffff', 1)),
      part(box(6.9, 0.9, 0.9, 0, 4.1), '#ffffff', 1),
      part(box(4.4, 0.6, 0.05, 0, 4.1, 0.47), '#17181b'),
    ]),
    /** Barnum, tente d'équipe. */
    tent: template([
      ...[-1.5, 1.5].flatMap((x) => [-1.5, 1.5].map((z) => part(prism(0.05, 0.05, 0, 2.2, 5, x, z), '#d8d4c8'))),
      part(new THREE.CylinderGeometry(0.05, 2.3, 0.9, 4, 1).rotateY(Math.PI / 4).translate(0, 2.65, 0), '#ffffff', 1),
    ]),
    /** Tremplin de bois (lancer vers +z). */
    kicker: template([tri([-0.8, 0, -1.2, 0.8, 0, -1.2, 0.8, 0.9, 1.2, -0.8, 0, -1.2, 0.8, 0.9, 1.2, -0.8, 0.9, 1.2], '#b48a5a'), part(box(1.6, 0.9, 0.08, 0, 0.45, 1.2), '#8a6a45'), ...[-0.78, 0.78].map((x) => tri([x, 0, -1.2, x, 0, 1.2, x, 0.9, 1.2], '#8a6a45'))]),
    /** Virage relevé : muret de terre incliné, 4 m. */
    berm: template([part(box(4, 1.1, 0.9, 0, 0.35).rotateX(-0.5), '#7a5233')]),
    /** Tour de départ du bike park. */
    tower: template([
      ...[-1.4, 1.4].flatMap((x) => [-1.4, 1.4].map((z) => part(box(0.2, 3.2, 0.2, x, 1.6, z), '#8a6a45'))),
      part(box(3.2, 0.2, 3.2, 0, 3.2), '#b48a5a'),
      part(box(3.2, 0.9, 0.08, 0, 3.75, -1.55), '#b48a5a'),
      ...[-1.55, 1.55].map((x) => part(box(0.08, 0.9, 3.2, x, 3.75, 0), '#b48a5a')),
      part(box(1.2, 0.15, 4, 0, 1.6, 2.9).rotateX(0.75), '#b48a5a'),
    ]),
    /** Porte d'écluse : deux vantaux sombres, passerelle et balanciers. */
    lockGate: template([part(box(1, 3.2, 0.35, 0.5, 1.2), '#3b2f25'), part(box(1, 0.12, 0.9, 0.5, 2.9), '#6b5a48'), part(box(1, 0.08, 0.06, 0.5, 3.6, 0.45), '#e9e6dc'), part(box(3.2, 0.25, 0.25, 0.5, 3.2, -1.6), '#5b4632')]),
    /** Bajoyer : mur de pierre de 1 m (étiré). */
    wall: template([part(box(1, 3.4, 1.2, 0.5, 1.2), '#b7ad9a')]),
    /** Maison éclusière : blanche, volets verts, toit d'ardoise. */
    house: template([
      part(box(7, 5, 5.5, 0, 2.5), '#f2efe6'),
      tri([-3.8, 5, -3, 3.8, 5, -3, 0, 7.4, -3, -3.8, 5, 3, 0, 7.4, 3, 3.8, 5, 3], '#5a6673'),
      tri([-3.8, 5, -3, 0, 7.4, -3, 0, 7.4, 3, -3.8, 5, -3, 0, 7.4, 3, -3.8, 5, 3, 3.8, 5, -3, 3.8, 5, 3, 0, 7.4, 3, 3.8, 5, -3, 0, 7.4, 3, 0, 7.4, -3], '#4b5561'),
      ...[-2, 2].flatMap((x) => [1.5, 3.7].map((y) => part(box(1, 1.1, 0.08, x, y, 2.78), '#3e6b52'))),
      part(box(1, 2, 0.08, 0, 1, 2.79), '#7a4a2a'),
    ]),
    /** Belvédère : plate-forme de bois, garde-corps, longue-vue. */
    deck: template([
      part(box(6, 0.25, 4, 0, 0.6), '#b48a5a'),
      ...[-2.8, 2.8].flatMap((x) => [-1.8, 1.8].map((z) => part(box(0.18, 0.7, 0.18, x, 0.3, z), '#8a6a45'))),
      part(box(6, 0.08, 0.08, 0, 1.75, 1.95), '#8a6a45'),
      ...[-2.95, 2.95].map((x) => part(box(0.08, 0.08, 4, x, 1.75, 0), '#8a6a45')),
      ...[-2.7, -1.35, 0, 1.35, 2.7].map((x) => part(box(0.08, 1.1, 0.08, x, 1.25, 1.95), '#8a6a45')),
      part(prism(0.06, 0.06, 0.7, 1.9, 6, 1.6, 1.3), '#3a3f44'),
      part(box(0.12, 0.12, 0.5, 1.6, 2.0, 1.45).rotateX(-0.2), '#2b4f7a'),
    ]),
    bench: template([part(box(1.8, 0.09, 0.45, 0, 0.45), '#a87850'), part(box(1.8, 0.3, 0.07, 0, 0.72, 0.22), '#a87850'), ...[-0.7, 0.7].map((x) => part(box(0.1, 0.75, 0.32, x, 0.36, 0.1), '#43555d'))]),
    /** Panneau d'information du lieu. */
    board: template([...[-0.6, 0.6].map((x) => part(box(0.1, 1.6, 0.1, x, 0.8), '#8a6a45')), part(box(1.5, 0.9, 0.08, 0, 1.4), '#2f5d4a'), part(box(1.3, 0.7, 0.09, 0, 1.4), '#f2efe6')]),
    flower: template([part(box(0.9, 0.4, 0.5, 0, 0.2), '#8a6a45'), ...[-0.3, 0, 0.3].map((x, i) => part(new THREE.IcosahedronGeometry(0.17, 0).translate(x, 0.5, 0), ['#e2604f', '#f4d35e', '#ef8fb0'][i]!))]),
  };
}
type Kit = ReturnType<typeof kit>;
let kitCache: Kit | null = null;
const K = () => (kitCache ??= kit());

/** Points d'un sentier nommé du graphe, tous les `step` m : position, direction et largeur. */
function trailPoints(name: string, step: number): Array<{ x: number; z: number; dx: number; dz: number; half: number; curve: number }> {
  const g = graphOf();
  const out: Array<{ x: number; z: number; dx: number; dz: number; half: number; curve: number }> = [];
  for (const e of g?.edges ?? []) {
    if (e.name !== name) continue;
    const p = e.pts;
    let acc = step / 2;
    for (let i = 3; i < p.length; i += 3) {
      const sx = p[i]! - p[i - 3]!;
      const sz = p[i + 2]! - p[i - 1]!;
      const L = Math.hypot(sx, sz);
      acc += L;
      if (acc < step || L < 1e-6) continue;
      acc = 0;
      const j = Math.min(p.length - 3, i + 9);
      const k = Math.max(0, i - 9);
      const a1 = Math.atan2(p[j + 2]! - p[i + 2]!, p[j]! - p[i]!);
      const a0 = Math.atan2(p[i + 2]! - p[k + 2]!, p[i]! - p[k]!);
      let curve = a1 - a0;
      if (curve > Math.PI) curve -= 2 * Math.PI;
      if (curve < -Math.PI) curve += 2 * Math.PI;
      out.push({ x: p[i]!, z: p[i + 2]!, dx: sx / L, dz: sz / L, half: Math.max(e.width, 1.8) / 2, curve });
    }
  }
  return out;
}

/** Pose un gabarit sur le sol (yaw : l'avant +z regarde (sin yaw, cos yaw)). */
function putOn(c: SiteContext, t: Template, x: number, z: number, yaw = 0, colour = WHITE, s = 1, dy = 0): boolean {
  const y = c.probe.heightAt(x, z);
  if (!Number.isFinite(y) || c.probe.buildingNear(x, z, 0.8)) return false;
  c.mesh.put(t, x, y + dy, z, yaw, s, s, s, colour);
  return true;
}

/** Cap du gabarit qui regarde dans la direction (dx, dz). */
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

// ───────────────────────────── Cyclo-cross et bike park

function cycloCross(): Site {
  const x = -7600;
  const z = -1450;
  return {
    id: 'cyclo-cross',
    x,
    z,
    reach: 650,
    needs: [[x, z], [x + 340, z], [x - 340, z]],
    *build(c) {
      const t = K();
      const pts = trailPoints('Circuit de cyclo-cross', 7);
      yield;
      const r = rng(4411);
      pts.forEach((p, i) => {
        for (const s of [-1, 1]) {
          const off = p.half + 1.1;
          const ax = p.x - p.dz * off * s;
          const az = p.z + p.dx * off * s;
          if (!putOn(c, t.stake, ax, az)) continue;
          const y = c.probe.heightAt(ax, az);
          // Ruban jusqu'au piquet suivant (même côté).
          const q = pts[i + 1];
          if (q && Math.hypot(q.x - p.x, q.z - p.z) < 12) {
            const bx = q.x - q.dz * (q.half + 1.1) * s;
            const bz = q.z + q.dx * (q.half + 1.1) * s;
            const L = Math.hypot(bx - ax, bz - az);
            c.mesh.put(t.tape, ax, y, az, Math.atan2(bz - az, bx - ax) * -1 + Math.PI / 2 - Math.PI / 2, L, 1, 1, WHITE);
          }
        }
        // Bottes de paille aux virages serrés, à l'extérieur.
        if (Math.abs(p.curve) > 0.35 && i % 2 === 0) {
          const s = p.curve > 0 ? -1 : 1;
          putOn(c, t.bale, p.x - p.dz * (p.half + 2.2) * s, p.z + p.dx * (p.half + 2.2) * s, yawOf(p.dx, p.dz) + Math.PI / 2);
        }
        if (i % 4 === 0) {
          const s = r() < 0.5 ? -1 : 1;
          const kx = p.x - p.dz * (p.half + 3.5) * s;
          const kz = p.z + p.dx * (p.half + 3.5) * s;
          const ky = c.probe.heightAt(kx, kz);
          if (Number.isFinite(ky) && r() < 0.6) c.spots.push({ kind: r() < 0.3 ? 'child' : 'villager', x: kx, y: ky, z: kz, yaw: yawOf(p.dz * s, -p.dx * s), seed: r() });
        }
        if (i % 25 === 24) c.flush();
      });
      yield;
      const p0 = pts[0];
      if (p0) {
        putOn(c, t.arch, p0.x, p0.z, yawOf(p0.dx, p0.dz), C('#8a3fc8'));
        for (let i = 0; i < 5; i++) putOn(c, t.tent, p0.x - p0.dz * (p0.half + 9) + p0.dx * (i * 5 - 10), p0.z + p0.dx * (p0.half + 9) + p0.dz * (i * 5 - 10), yawOf(p0.dx, p0.dz), GAY[i]!);
        putOn(c, t.board, p0.x + p0.dz * (p0.half + 2.5), p0.z - p0.dx * (p0.half + 2.5), yawOf(-p0.dx, -p0.dz));
      }
      c.flush();
    },
  };
}

function bikePark(): Site {
  const x = -9050;
  const z = -3250;
  return {
    id: 'bike-park',
    x,
    z,
    reach: 650,
    needs: [[x, z], [x + 380, z], [x - 380, z]],
    *build(c) {
      const t = K();
      const pts = trailPoints('Bike park des Bois', 9);
      yield;
      const r = rng(9091);
      pts.forEach((p, i) => {
        // Virages relevés à l'extérieur des courbes ; tremplins sur le côté des lignes droites.
        if (Math.abs(p.curve) > 0.25) {
          const s = p.curve > 0 ? -1 : 1;
          putOn(c, t.berm, p.x - p.dz * (p.half + 0.4) * s, p.z + p.dx * (p.half + 0.4) * s, yawOf(-p.dz * s, p.dx * s) + Math.PI, WHITE, 1, -0.15);
        } else if (i % 5 === 2) {
          const s = i % 2 ? 1 : -1;
          putOn(c, t.kicker, p.x - p.dz * (p.half + 2.2) * s, p.z + p.dx * (p.half + 2.2) * s, yawOf(p.dx, p.dz));
        }
        if (i % 6 === 0) putOn(c, t.stake, p.x - p.dz * (p.half + 0.8), p.z + p.dx * (p.half + 0.8), 0, WHITE, 1);
        if (i % 7 === 3 && r() < 0.7) {
          const kx = p.x + p.dz * (p.half + 4);
          const kz = p.z - p.dx * (p.half + 4);
          const ky = c.probe.heightAt(kx, kz);
          if (Number.isFinite(ky)) c.spots.push({ kind: 'villager', x: kx, y: ky, z: kz, yaw: yawOf(-p.dz, p.dx), seed: r() });
        }
        if (i % 20 === 19) c.flush();
      });
      const p0 = pts[0];
      if (p0) {
        putOn(c, t.tower, p0.x - p0.dz * (p0.half + 5), p0.z + p0.dx * (p0.half + 5), yawOf(p0.dx, p0.dz));
        putOn(c, t.board, p0.x + p0.dz * (p0.half + 2.5), p0.z - p0.dx * (p0.half + 2.5), yawOf(-p0.dx, -p0.dz));
      }
      c.flush();
    },
  };
}

// ───────────────────────────── Écluse et belvédère

/** Écluse sur la Robe, près de la voie verte : point de la rivière le plus proche de (tx, tz). */
function lock(tx: number, tz: number): Site {
  return {
    id: 'ecluse-de-la-robe',
    x: tx,
    z: tz,
    reach: 700,
    needs: [[tx, tz]],
    *build(c) {
      const t = K();
      yield;
      let best: { x: number; z: number; dx: number; dz: number; w: number } | null = null;
      let bd = 600;
      const seen = new Set<string>();
      for (let ox = -600; ox <= 600; ox += 300)
        for (let oz = -600; oz <= 600; oz += 300) {
          const tile = c.probe.tileAt(tx + ox, tz + oz);
          if (!tile || seen.has(tile.id)) continue;
          seen.add(tile.id);
          for (const w of tile?.features.waterways ?? []) {
            const p = w.pts;
            for (let i = 2; i + 1 < p.length; i += 2) {
              const d = Math.hypot(p[i]! - tx, p[i + 1]! - tz);
              if (d >= bd) continue;
              const L = Math.hypot(p[i]! - p[i - 2]!, p[i + 1]! - p[i - 1]!) || 1;
              bd = d;
              best = { x: p[i]!, z: p[i + 1]!, dx: (p[i]! - p[i - 2]!) / L, dz: (p[i + 1]! - p[i - 1]!) / L, w: Math.max(6, (w as { width?: number }).width ?? 8) };
            }
          }
        }
      if (!best) return;
      // À 60 m en amont du point le plus proche de la voie verte (le pont y passe).
      const { dx, dz } = best;
      const x = best.x - dx * 60;
      const z = best.z - dz * 60;
      const half = best.w / 2 + 0.6;
      const y = Math.min(c.probe.heightAt(x - dz * (half + 1), z + dx * (half + 1)), c.probe.heightAt(x + dz * (half + 1), z - dx * (half + 1)));
      if (!Number.isFinite(y)) return;
      // Deux bajoyers de 24 m, deux paires de portes.
      for (const s of [-1, 1]) {
        const wx = x - dz * (half + 0.6) * s - dx * 12;
        const wz = z + dx * (half + 0.6) * s - dz * 12;
        c.mesh.putBasis(t.wall, wx, y - 1.7, wz, dx * 24, 0, dz * 24, 0, 1, 0, -dz * s, 0, dx * s, 1, 1, 1);
      }
      for (const along of [-11, 11])
        for (const s of [-1, 1]) {
          const gx = x + dx * along - dz * half * s;
          const gz = z + dz * along + dx * half * s;
          c.mesh.putBasis(t.lockGate, gx, y - 1.9, gz, dz * s * half * 0.98, 0, -dx * s * half * 0.98, 0, 1, 0, dx, 0, dz, 1, 1, 1);
        }
      yield;
      const hx = x - dz * (half + 9) + dx * 6;
      const hz = z + dx * (half + 9) + dz * 6;
      putOn(c, t.house, hx, hz, yawOf(dz, -dx));
      for (let i = 0; i < 4; i++) putOn(c, t.flower, hx + dx * (i * 1.5 - 2.2) + dz * 3.4, hz + dz * (i * 1.5 - 2.2) - dx * 3.4, yawOf(dz, -dx));
      putOn(c, t.bench, x - dz * (half + 3) - dx * 6, z + dx * (half + 3) - dz * 6, yawOf(dz, -dx));
      putOn(c, t.board, x - dz * (half + 3) + dx * 16, z + dx * (half + 3) + dz * 16, yawOf(dz, -dx));
      const r = rng(3301);
      for (let i = 0; i < 3; i++) {
        const px = x - dz * (half + 2.2) + dx * (i * 5 - 8);
        const pz = z + dx * (half + 2.2) + dz * (i * 5 - 8);
        const py = c.probe.heightAt(px, pz);
        if (Number.isFinite(py)) c.spots.push({ kind: i ? 'villager' : 'fisher', x: px, y: py, z: pz, yaw: yawOf(dz, -dx) + Math.PI, seed: r() });
      }
      c.flush();
    },
  };
}

/** Belvédère au bord des falaises, sur la côte au large d'un point (cx, cz) de l'île. */
function lookout(id: string, cx: number, cz: number): Site {
  return {
    id,
    x: cx,
    z: cz,
    reach: 700,
    needs: [[cx, cz]],
    *build(c) {
      const t = K();
      yield;
      const L = Math.hypot(cx, cz) || 1;
      const ux = cx / L;
      const uz = cz / L;
      // Avance vers le large jusqu'à la mer, puis recule de 18 m.
      let d = 0;
      for (; d < 1400; d += 10) if (!(c.probe.heightAt(cx + ux * d, cz + uz * d) > 0.5)) break;
      if (d >= 1400 || d < 30) return;
      const x = cx + ux * (d - 18);
      const z = cz + uz * (d - 18);
      putOn(c, t.deck, x, z, yawOf(ux, uz));
      for (const s of [-1, 1]) putOn(c, t.bench, x - uz * 5 * s - ux * 3, z + ux * 5 * s - uz * 3, yawOf(ux, uz));
      putOn(c, t.board, x - ux * 6, z - uz * 6, yawOf(-ux, -uz));
      const r = rng(2203);
      for (let i = 0; i < 3; i++) {
        const px = x - uz * (i - 1) * 1.6 - ux * 1.5;
        const pz = z + ux * (i - 1) * 1.6 - uz * 1.5;
        const py = c.probe.heightAt(px, pz);
        if (Number.isFinite(py)) c.spots.push({ kind: i === 1 ? 'child' : 'villager', x: px, y: py + 0.7, z: pz, yaw: yawOf(ux, uz), seed: r() });
      }
      c.flush();
    },
  };
}

// ───────────────────────────── Régates, petit train, cerfs

function regatta(cx: number, cz: number): Site {
  const L = Math.hypot(cx, cz) || 1;
  const ux = cx / L;
  const uz = cz / L;
  let ox = cx + ux * 1150;
  let oz = cz + uz * 1150;
  return {
    id: 'regates',
    x: ox,
    z: oz,
    reach: 2600,
    needs: [[cx, cz]],
    *build(c) {
      yield;
      // Bassin des régates : 600 m au-delà du rivage (première altitude sous −1 m vers le large).
      for (let d = 200; d < 4000; d += 25)
        if (c.probe.heightAt(cx + ux * d, cz + uz * d) < -1) {
          ox = cx + ux * (d + 300);
          oz = cz + uz * (d + 300);
          break;
        }
      for (let i = 0; i < 7; i++) {
        const tri = (pts: number[], colour: string) => part(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), colour);
        const sail = (z0: number, colour: string) => [tri([0.04, 0.9, z0, 0.04, 8.5, z0, 0.04, 0.9, z0 - 3.2], colour), tri([-0.04, 0.9, z0, -0.04, 0.9, z0 - 3.2, -0.04, 8.5, z0], colour)];
        const m = meshOf(
          [
            {
              t: template([
                part(box(1.9, 0.7, 6.2, 0, 0.35), '#ffffff', 1),
                part(box(1.2, 0.5, 2, 0, 0.9, -0.6), '#f2efe6'),
                part(prism(0.07, 0.06, 0.7, 9, 6), '#d8d4c8'),
                ...sail(-0.1, '#f7f6f1'),
                ...sail(3.1, '#f7f6f1').map((g) => g.scale(1, 0.75, 0.7)),
              ]),
              x: 0,
              y: 0,
              z: 0,
              c: GAY[i % GAY.length]!,
            },
          ],
          c.mat,
        );
        m.name = 'regate';
        m.scale.setScalar(1.8);
        const R = 120 + (i % 3) * 30;
        const phase = (i / 7) * Math.PI * 2;
        c.moving.push({
          object: m,
          step: (time) => {
            const a = phase + time * (0.012 + (i % 2) * 0.002);
            m.position.set(ox + Math.cos(a) * R * 1.6, 0.05 + Math.sin(time * 1.1 + i) * 0.12, oz + Math.sin(a) * R);
            m.rotation.set(Math.sin(time * 0.9 + i) * 0.04, -a + (Math.PI * 3) / 2 + Math.atan2(R, R * 1.6) * 0, 0.18 + Math.sin(time * 0.7 + i) * 0.05);
            m.rotation.y = Math.atan2(-Math.sin(a) * R * 1.6, Math.cos(a) * R);
          },
        });
      }
    },
  };
}

/** Petit train touristique autour de la fête de l'Anneau (stade de 640 × 320 m, dans l'enceinte). */
function touristTrain(): Site {
  const { x: CX, z: CZ } = RING;
  const S = 160;
  const R = 160;
  const len = 4 * S + 2 * Math.PI * R;
  const at = (s: number): [number, number, number] => {
    let u = ((s % len) + len) % len;
    if (u < 2 * S) return [CX - S + u, CZ + R, 0];
    u -= 2 * S;
    if (u < Math.PI * R) {
      const a = u / R;
      return [CX + S + Math.sin(a) * R, CZ + Math.cos(a) * R, -a];
    }
    u -= Math.PI * R;
    if (u < 2 * S) return [CX + S - u, CZ - R, -Math.PI];
    u -= 2 * S;
    const a = u / R;
    return [CX - S - Math.sin(a) * R, CZ - Math.cos(a) * R, -Math.PI - a];
  };
  return {
    id: 'petit-train',
    x: CX,
    z: CZ,
    reach: 1000,
    needs: [[CX, CZ], [CX - 320, CZ], [CX + 320, CZ]],
    *build(c) {
      yield;
      const loco = template([
        part(box(1.7, 1.3, 3, 0, 1.05), '#e2443a'),
        part(box(1.5, 1.2, 1.3, 0, 2.2, -0.7), '#e2443a'),
        part(box(1.8, 0.12, 1.6, 0, 2.85, -0.7), '#f4d35e'),
        part(prism(0.22, 0.28, 1.6, 2.9, 8, 0, 0.8), '#2b2f33'),
        ...[-0.75, 0.75].flatMap((x) => [-0.9, 0.9].map((z) => part(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 10).rotateZ(Math.PI / 2).translate(x, 0.42, z), '#2b2f33'))),
      ]);
      const car = template([
        part(box(1.7, 0.5, 3, 0, 0.75), '#ffffff', 1),
        ...[-0.75, 0.75].flatMap((x) => [-1.4, 1.4].map((z) => part(box(0.08, 1.4, 0.08, x, 1.5, z), '#f2efe6'))),
        part(box(1.9, 0.12, 3.3, 0, 2.25), '#f7f3e8'),
        part(box(1.5, 0.5, 0.4, 0, 1.2, -0.6), '#8b6a4a'),
        part(box(1.5, 0.5, 0.4, 0, 1.2, 0.7), '#8b6a4a'),
        ...[-0.75, 0.75].flatMap((x) => [-1, 1].map((z) => part(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 10).rotateZ(Math.PI / 2).translate(x, 0.3, z), '#2b2f33'))),
      ]);
      const g = new THREE.Group();
      g.name = 'petit-train';
      const pieces = [meshOf([{ t: loco, x: 0, y: 0, z: 0 }], c.mat), ...[0, 1, 2].map((i) => meshOf([{ t: car, x: 0, y: 0, z: 0, c: GAY[(i * 2 + 1) % GAY.length]! }], c.mat))];
      for (const p of pieces) g.add(p);
      c.moving.push({
        object: g,
        step: (time) => {
          pieces.forEach((p, i) => {
            const [x, z] = at(time * 3.2 - i * 3.6);
            const [x2, z2] = at(time * 3.2 - i * 3.6 + 0.5);
            const y = c.probe.heightAt(x, z);
            p.position.set(x, Number.isFinite(y) ? y : 0, z);
            p.rotation.y = Math.atan2(x2 - x, z2 - z);
          });
        },
      });
    },
  };
}

/** Cerfs et biches dans une clairière des Bois : ils broutent, relèvent la tête, se déplacent un peu. */
function deer(): Site {
  // Clairière au bord du sentier des Biches.
  const x = -7490;
  const z = -5975;
  return {
    id: 'cerfs-des-bois',
    x,
    z,
    reach: 600,
    needs: [[x, z]],
    *build(c) {
      yield;
      const body = (antlers: boolean) =>
        template([
          part(box(0.5, 0.55, 1.25, 0, 1.05), '#9a6a3f'),
          ...[-0.17, 0.17].flatMap((dx) => [-0.45, 0.45].map((dz) => part(box(0.1, 0.8, 0.1, dx, 0.4, dz), '#7a5233'))),
          part(box(0.3, 0.12, 0.2, 0, 1.0, -0.66), '#f2efe6'),
          ...(antlers ? [-1, 1].flatMap((s) => [part(box(0.05, 0.55, 0.05, 0.12 * s, 0.3, 0).rotateZ(-0.35 * s), '#d9c7a8'), part(box(0.04, 0.3, 0.04, 0.2 * s, 0.45, 0.1).rotateX(0.5), '#d9c7a8')]) : []),
        ]);
      const head = template([part(box(0.2, 0.55, 0.2, 0, 0.25, 0).rotateX(-0.5), '#9a6a3f'), part(box(0.22, 0.22, 0.42, 0, 0.55, 0.22), '#8a5a32'), part(box(0.08, 0.18, 0.04, -0.1, 0.72, 0.1), '#7a5233'), part(box(0.08, 0.18, 0.04, 0.1, 0.72, 0.1), '#7a5233')]);
      const r = rng(1212);
      for (let i = 0; i < 6; i++) {
        const g = new THREE.Group();
        g.name = 'cerf';
        const b = meshOf([{ t: body(i === 0), x: 0, y: 0, z: 0 }], c.mat);
        const h = meshOf([{ t: head, x: 0, y: 0, z: 0 }], c.mat);
        h.position.set(0, 1.2, 0.55);
        const antl = i === 0 ? meshOf([{ t: body(true), x: 0, y: 0, z: 0 }], c.mat) : null;
        g.add(b, h);
        if (antl) {
          antl.visible = false;
        }
        const hx = x + 25 + r() * 30;
        const hz = z + 20 + r() * 30;
        const seed = r() * 10;
        let yaw = r() * 6.28;
        c.moving.push({
          object: g,
          step: (time, dt) => {
            const wander = Math.sin(time * 0.05 + seed);
            yaw += dt * 0.15 * Math.sin(time * 0.09 + seed * 3);
            const px = hx + Math.cos(seed + time * 0.02) * 9 * wander;
            const pz = hz + Math.sin(seed + time * 0.02) * 9 * wander;
            const y = c.probe.heightAt(px, pz);
            g.position.set(px, Number.isFinite(y) ? y : 0, pz);
            g.rotation.y = yaw;
            // Tête baissée pour brouter, relevée de temps en temps.
            const graze = Math.sin(time * 0.4 + seed) > -0.3;
            h.rotation.x = graze ? 1.1 : -0.1;
          },
        });
      }
      // Promeneurs qui les observent de loin.
      strollPath(c, [[x - 70, z - 40], [x - 60, z + 30], [x - 75, z + 60]], r());
    },
  };
}

/** Lieux de plein air de l'île, ajoutés à IslandSites. */
export function outdoorSites(): Site[] {
  return [cycloCross(), bikePark(), lock(7102, 3452), lookout('belvedere-de-kerbrou', -1790, -9879), regatta(983, 9720), touristTrain(), deer()];
}
