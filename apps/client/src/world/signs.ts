import * as THREE from 'three/webgpu';
import type { RouteHairpin, RouteTrack } from '@allezrobert/shared';
import { hairpinAltitude, hairpinShortName, plaqueLines } from '../game/climb.ts';

/** Texture d'un panneau d'entrée d'agglomération (fond blanc, liseré rouge, nom en capitales). */
function signTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#c8102e';
  ctx.lineWidth = 16;
  ctx.strokeRect(14, 14, 484, 164);
  ctx.fillStyle = '#111';
  const label = name.toUpperCase();
  let size = 64;
  ctx.font = `700 ${size}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  while (ctx.measureText(label).width > 440 && size > 26) {
    size -= 2;
    ctx.font = `700 ${size}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 98);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Plaque d'un lacet numéroté, à la manière de celles de l'Alpe d'Huez : panneau bleu liseré de
 * blanc, numéro du virage en grand, altitude, nom du lieu et vainqueurs d'étape qui lui sont dédiés.
 */
function plaqueTexture(h: RouteHairpin): THREE.CanvasTexture {
  const W = 512;
  const H = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const font = (w: number, px: number, italic = false) => `${italic ? 'italic ' : ''}${w} ${px}px "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
  const fit = (text: string, w: number, px: number, max: number, italic = false) => {
    let size = px;
    ctx.font = font(w, size, italic);
    while (ctx.measureText(text).width > max && size > 14) {
      size -= 2;
      ctx.font = font(w, size, italic);
    }
  };
  ctx.fillStyle = '#1f4f9c';
  ctx.fillRect(0, 0, W, H);
  // léger dégradé émaillé
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#f4f6f8';
  ctx.lineWidth = 12;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.fillStyle = '#f4f6f8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(700, 44);
  ctx.fillText('VIRAGE', W / 2, 80);
  ctx.font = font(800, 250);
  ctx.fillText(String(h.number ?? ''), W / 2, 230);
  const name = hairpinShortName(h);
  if (name) {
    fit(name, 600, 44, W - 90, true);
    ctx.fillText(name, W / 2, 385);
  }
  // filet, puis les vainqueurs
  ctx.fillRect(70, 428, W - 140, 4);
  const lines = plaqueLines(h.inscription);
  lines.slice(0, 2).forEach((l, i) => {
    const m = /^(\d{4})\s+(.*)$/.exec(l);
    const year = m ? (m[1] as string) : '';
    const who = m ? (m[2] as string) : l;
    ctx.font = font(800, 40);
    if (year) ctx.fillText(year, W / 2, 470 + i * 92);
    fit(who, 600, 38, W - 70);
    ctx.fillText(who, W / 2, 470 + i * 92 + (year ? 42 : 0));
  });
  // bandeau d'altitude
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(18, H - 118, W - 36, 100);
  ctx.fillStyle = '#1f4f9c';
  ctx.font = font(800, 58);
  ctx.fillText(`ALT. ${hairpinAltitude(h)} m`, W / 2, H - 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Panneaux d'entrée d'agglomération le long de l'itinéraire, aux lieux traversés fournis
 * par le pipeline terrain (`route.landmarks`), côté droit de la chaussée. Les lacets numérotés
 * (`route.hairpins`) ont leur plaque propre plutôt qu'un panneau de village.
 */
export class TownSigns {
  readonly group = new THREE.Group();

  constructor(track: RouteTrack, groundAt: (x: number, z: number) => number) {
    this.group.name = 'signs';
    const landmarks = track.route.landmarks ?? [];
    const postMat = new THREE.MeshStandardNodeMaterial({ color: '#8a8f96', roughness: 0.5, metalness: 0.6 });
    const backMat = new THREE.MeshStandardNodeMaterial({ color: '#9aa0a6', roughness: 0.6 });
    const half = track.route.roadWidthM / 2;
    const plaques = (track.route.hairpins ?? []).filter((h) => h.number !== undefined);
    for (const h of plaques) this.group.add(this.plaque(track, h, half, groundAt, postMat, backMat));
    for (const lm of landmarks) {
      // lieu déjà signalé par la plaque de son virage
      if (plaques.some((h) => Math.abs(h.d - lm.d) < 30)) continue;
      // Panneau 40 m avant le lieu, face aux coureurs qui arrivent.
      const p = track.positionAt(lm.d - 40, half + 1.4);
      const ground = groundAt(p.x, p.z);
      const y = Number.isFinite(ground) ? ground : p.y;
      const sign = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 8), postMat);
      // Poteau derrière la plaque (rayon 4 cm, dos de la plaque à 2 cm) : il ne doit pas la traverser.
      post.position.set(0, 1.15, -0.03);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), new THREE.MeshStandardNodeMaterial({ map: signTexture(lm.name), roughness: 0.45 }));
      face.position.set(0, 2.05, 0.03);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), backMat);
      back.position.set(0, 2.05, 0.02);
      back.rotation.y = Math.PI;
      for (const m of [post, face, back]) {
        m.castShadow = true;
        sign.add(m);
      }
      sign.position.set(p.x, y, p.z);
      // Face vers les coureurs : la normale du panneau pointe à l'opposé de la direction de marche.
      sign.rotation.y = Math.atan2(-p.dirX, -p.dirZ);
      this.group.add(sign);
    }
  }

  /** Plaque de virage sur deux montants, 25 m avant le sommet du lacet, face aux coureurs. */
  private plaque(track: RouteTrack, h: RouteHairpin, half: number, groundAt: (x: number, z: number) => number, postMat: THREE.Material, backMat: THREE.Material): THREE.Group {
    const p = track.positionAt(Math.max(0, h.d - 25), half + 1.6);
    const ground = groundAt(p.x, p.z);
    const y = Number.isFinite(ground) ? Math.min(ground, p.y + 0.6) : p.y;
    const sign = new THREE.Group();
    sign.name = `plaque-virage-${h.number}`;
    const w = 0.9;
    const ht = 1.35;
    const bottom = 0.85;
    for (const x of [-w * 0.32, w * 0.32]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, bottom + ht - 0.1, 8), postMat);
      post.position.set(x, (bottom + ht - 0.1) / 2, -0.045);
      post.castShadow = true;
      sign.add(post);
    }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshStandardNodeMaterial({ map: plaqueTexture(h), roughness: 0.35, metalness: 0.05 }));
    face.position.set(0, bottom + ht / 2, 0.01);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), backMat);
    back.position.set(0, bottom + ht / 2, 0);
    back.rotation.y = Math.PI;
    for (const m of [face, back]) {
      m.castShadow = true;
      sign.add(m);
    }
    sign.position.set(p.x, y, p.z);
    sign.rotation.y = Math.atan2(-p.dirX, -p.dirZ);
    return sign;
  }
}
