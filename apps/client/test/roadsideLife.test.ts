import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RouteTrack, type RouteData } from '@allezrobert/shared';
import { RoadsideLife } from '../src/world/roadsideLife.ts';
import { RoadsidePeople } from '../src/world/roadsidePeople.ts';
import { SkyLife } from '../src/world/skyLife.ts';
import { LandProbe, MeshBuilder, template, part } from '../src/world/lowPolyKit.ts';
import { SPLAT_CHANNELS, emptyFeatures, type LoadedTile } from '../src/world/types.ts';

/**
 * Abords de la route du style jeu vidéo sur une tuile de synthèse (plate, prés partout) : route droite
 * selon x, chemin perpendiculaire en x = −50, ruisseau en x = 50, maison au bord de la route, bois.
 */
const RES = 256;
const SIZE = 1000;
const X0 = -500;
const ch = (c: (typeof SPLAT_CHANNELS)[number]) => SPLAT_CHANNELS.indexOf(c);

function tile(): LoadedTile {
  const data = new Uint8Array(RES * RES * SPLAT_CHANNELS.length);
  const px = (x: number) => Math.floor(((x - X0) / SIZE) * RES);
  for (let j = 0; j < RES; j++)
    for (let i = 0; i < RES; i++) {
      const o = (j * RES + i) * SPLAT_CHANNELS.length;
      data[o + ch('meadow')] = 255;
      // bois au nord de la route, de x = 100 à 220, au-delà de 30 m
      const x = X0 + ((i + 0.5) / RES) * SIZE;
      const z = X0 + ((j + 0.5) / RES) * SIZE;
      if (x > 100 && x < 220 && z < -30) data[o + ch('forest')] = 255;
      if (i === px(50)) data[o + ch('water')] = 255;
    }
  const features = emptyFeatures();
  features.roads.push({ kind: 'track', width: 3, pts: [-50, -300, -50, 300] });
  features.roads.push({ kind: 'secondary', width: 6, pts: [-480, 0, 480, 0], route: 'test' });
  features.waterways.push({ width: 2, pts: [50, -300, 50, 300] });
  // maison à 10 m du bord de la route, côté sud (z > 0)
  features.buildings.push({ pts: [-160, 13, -150, 13, -150, 23, -160, 23], height: 6, kind: 'house' });
  return { id: 't', tx: -1, tz: -1, x0: X0, z0: X0, size: SIZE, n: 4, heights: new Float32Array(25).fill(100), features, splat: { res: RES, data } };
}

function route(): RouteData {
  const points = [];
  for (let x = -450; x <= 450; x += 10) points.push({ x, y: 100, z: 0, d: x + 450 });
  return { id: 'test', name: 'test', loop: false, lengthM: 900, elevationGainM: 0, points, segments: [], roadWidthM: 6, attribution: [] };
}

describe('roadside life (style jeu vidéo)', () => {
  const t = tile();
  const tileAt = (x: number, z: number) => (x >= X0 && x < X0 + SIZE && z >= X0 && z < X0 + SIZE ? t : undefined);
  const heightAt = (x: number, z: number) => (tileAt(x, z) ? 100 : Number.NaN);

  it('sonde : bâtiments, bois avec marge, routes', () => {
    const p = new LandProbe(tileAt, heightAt);
    expect(p.buildingNear(-155, 18, 0)).toBe(true);
    expect(p.buildingNear(-155, 10, 2)).toBe(false);
    expect(p.buildingNear(-155, 11.5, 2)).toBe(true);
    expect(p.clear(150, -10, 3)).toBe(true);
    expect(p.clear(150, -28, 4)).toBe(false);
    expect(p.open(0, 40)).toBe(true);
  });

  it('fusion : gabarit tourné, mis à l’échelle et teinté', () => {
    const g = template([part(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0, 0), '#ffffff', 1)]);
    const b = new MeshBuilder(4);
    b.put(g, 10, 0, 0, Math.PI / 2, 2, 1, 1, new THREE.Color(1, 0, 0));
    const geo = b.geometry() as THREE.BufferGeometry;
    const pos = geo.getAttribute('position');
    let minZ = Infinity;
    for (let i = 0; i < pos.count; i++) minZ = Math.min(minZ, pos.getZ(i));
    // l'axe x local (0 → 1, × 2) part vers −z après un quart de tour
    expect(minZ).toBeCloseTo(-2, 5);
    expect(geo.getAttribute('color').getY(0)).toBe(0);
  });

  it('peuple les tronçons proches sans clôture sur le chemin ni animal dans le bois', () => {
    const track = new RouteTrack(route());
    const life = new RoadsideLife(track, heightAt, tileAt, { props: 1, people: 1 });
    const focus = new THREE.Vector3(-300, 100, 0);
    for (let i = 0; i < 20; i++) life.update(1 / 60, focus);
    expect(life.chunkList.length).toBeGreaterThan(3);
    let fenceNearTrack = 0;
    let fenceElsewhere = 0;
    let headwall = 0;
    const concrete = new THREE.Color('#b9b6ae');
    for (const o of life.group.children) {
      // Groupe des animaux animés (farmAnimals.ts) : pas de géométrie propre.
      if (!(o as THREE.Mesh).isMesh) continue;
      const g = (o as THREE.Mesh).geometry;
      const pos = g.getAttribute('position');
      if (o.name.startsWith('life-static')) {
        const col = g.getAttribute('color');
        for (let i = 0; i < pos.count; i++) {
          if (Math.abs(col.getX(i) - concrete.r) < 0.01 && Math.abs(pos.getX(i) - 50) < 2 && Math.abs(Math.abs(pos.getZ(i)) - 4.5) < 0.5) headwall++;
          const y = pos.getY(i) - 100;
          const z = Math.abs(pos.getZ(i));
          // poteaux et lisses (blancs ou bois) sur la ligne de clôture, au-dessus des fleurs
          const white = col.getX(i) > 0.8 && col.getY(i) > 0.8;
          const wood = Math.abs(col.getX(i) - new THREE.Color('#7a5434').r) < 0.02;
          if (y < 0.7 || y > 1.2 || z < 5.1 || z > 5.5 || !(white || wood)) continue;
          if (Math.abs(pos.getX(i) + 50) < 3.3) fenceNearTrack++;
          else fenceElsewhere++;
        }
      }
      if (o.name.startsWith('life-animals')) {
        const a = g.getAttribute('anim');
        for (let i = 0; i < a.count; i++) {
          const x = a.getZ(i);
          const z = a.getW(i);
          expect(x > 96 && x < 224 && z < -26).toBe(false);
          expect(Math.abs(x + 50) < 3 && Math.abs(z) < 300).toBe(false);
        }
      }
    }
    expect(fenceNearTrack).toBe(0);
    expect(fenceElsewhere).toBeGreaterThan(0);
    // ruisseau de 2 m sous la route : têtes de buse des deux côtés
    expect(headwall).toBeGreaterThan(0);
    // les tronçons lointains sont oubliés, les sources sonores suivent
    life.update(1 / 60, new THREE.Vector3(5000, 100, 0));
    expect(life.chunkList.length).toBe(0);
    expect(life.sources.length).toBe(0);
    life.dispose();
  });

  it('itinéraire ouvert prolongé : tronçons revus, personnages et oiseaux sans erreur', () => {
    const data = route();
    data.points = data.points.filter((p) => p.d <= 400);
    data.lengthM = 400;
    const track = new RouteTrack(data);
    const life = new RoadsideLife(track, heightAt, tileAt, { props: 1, people: 1 });
    const people = new RoadsidePeople(life, heightAt, 1);
    const sky = new SkyLife(life);
    const focus = new THREE.Vector3(-300, 100, 0);
    for (let i = 0; i < 10; i++) {
      life.update(1 / 60, focus);
      people.update(1 / 60, focus);
      sky.update(1 / 60, focus);
    }
    const before = life.chunkList.length;
    expect(before).toBeGreaterThan(0);
    // prolongé vers le sud depuis 300 m : le tronçon qui contenait 300 m est refait
    track.extend(
      [300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 450, 500].map((d) => ({ x: d < 350 ? d - 450 : -100, y: 100, z: d < 350 ? 0 : d - 350, d })),
      300,
    );
    for (let i = 0; i < 30; i++) {
      focus.x = -300 + i * 5;
      life.update(1 / 60, focus);
      people.update(1 / 60, focus);
      sky.update(1 / 60, focus);
    }
    expect(life.chunkList.length).toBeGreaterThan(0);
    people.dispose();
    sky.dispose();
    life.dispose();
  });
});
