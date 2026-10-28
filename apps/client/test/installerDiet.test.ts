import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractMedia, pruneDist } from '../scripts/installerDiet.ts';

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function dist(): string {
  dir = mkdtempSync(join(tmpdir(), 'ar-dist-'));
  mkdirSync(join(dir, '__pose'));
  writeFileSync(join(dir, '__pose', 'photo-1.jpg'), 'x');
  for (const z of ['chevreuse', 'limagne']) {
    mkdirSync(join(dir, 'worlds', z), { recursive: true });
    for (const f of ['graph.json', 'world.json', 'places.json']) writeFileSync(join(dir, 'worlds', z, f), 'x');
  }
  writeFileSync(join(dir, 'worlds', 'index.json'), 'x');
  mkdirSync(join(dir, 'menu'));
  for (const f of ['loop-summer.webm', 'loop-summer.mp4', 'loop-summer.av1.mp4', 'still-summer.jpg']) writeFileSync(join(dir, 'menu', f), 'x');
  return dir;
}

describe('pruneDist', () => {
  it('web : retire seulement les photos de pose, garde les trois formats vidéo', () => {
    const d = dist();
    const removed = pruneDist(d, false);
    expect(removed).toEqual([join(d, '__pose')]);
    expect(readdirSync(join(d, 'worlds', 'chevreuse')).sort()).toEqual(['graph.json', 'places.json', 'world.json']);
    expect(readdirSync(join(d, 'menu')).sort()).toEqual(['loop-summer.av1.mp4', 'loop-summer.mp4', 'loop-summer.webm', 'still-summer.jpg']);
  });

  it('installateur : retire aussi les .webm, garde H.264, AV1 et les images fixes', () => {
    const d = dist();
    pruneDist(d, true);
    expect(readdirSync(join(d, 'menu')).sort()).toEqual(['loop-summer.av1.mp4', 'loop-summer.mp4', 'still-summer.jpg']);
    expect(readdirSync(d).sort()).toEqual(['menu', 'worlds']);
    // graphes retirés, le reste des zones et le catalogue restent
    expect(readdirSync(join(d, 'worlds', 'chevreuse')).sort()).toEqual(['places.json', 'world.json']);
    expect(readdirSync(join(d, 'worlds')).sort()).toEqual(['chevreuse', 'index.json', 'limagne']);
  });

  it('sans dossiers à retirer, ne fait rien', () => {
    dir = mkdtempSync(join(tmpdir(), 'ar-dist-'));
    expect(pruneDist(dir, true)).toEqual([]);
  });
});

describe('extractMedia', () => {
  it('sort les ressources lourdes de dist/, garde le code, le catalogue et les polices, écrit le manifeste', () => {
    const d = dist();
    pruneDist(d, true);
    mkdirSync(join(d, 'assets', 'textures'), { recursive: true });
    writeFileSync(join(d, 'assets', 'index-abc.js'), 'code');
    writeFileSync(join(d, 'assets', 'index-abc.js.map'), 'map');
    writeFileSync(join(d, 'assets', 'textures', 'asphalt.ktx2'), 'tex');
    mkdirSync(join(d, 'fonts'));
    writeFileSync(join(d, 'fonts', 'inter.woff2'), 'f');
    writeFileSync(join(d, 'index.html'), '<html>');
    const out = `${d}-media`;
    try {
      const m = extractMedia(d, out);
      expect(m.files.map((f) => f.p)).toEqual([
        'assets/textures/asphalt.ktx2',
        'menu/loop-summer.av1.mp4',
        'menu/loop-summer.mp4',
        'menu/still-summer.jpg',
        'worlds/chevreuse/places.json',
        'worlds/chevreuse/world.json',
        'worlds/limagne/places.json',
        'worlds/limagne/world.json',
      ]);
      expect(m.files.every((f) => /^[0-9a-f]{32}$/.test(f.h) && f.b > 0)).toBe(true);
      // restent dans l'exe : code (sans carte de sources), catalogue, polices, page, manifeste
      expect(readdirSync(join(d, 'assets'))).toEqual(['index-abc.js']);
      expect(readdirSync(join(d, 'worlds'))).toEqual(['index.json']);
      expect(readdirSync(d).sort()).toEqual(['assets', 'fonts', 'index.html', 'media-manifest.json', 'worlds']);
      expect(readdirSync(join(out, 'menu')).sort()).toEqual(['loop-summer.av1.mp4', 'loop-summer.mp4', 'still-summer.jpg']);
      // même contenu, même version
      const again = dist();
      pruneDist(again, true);
      mkdirSync(join(again, 'assets', 'textures'), { recursive: true });
      writeFileSync(join(again, 'assets', 'textures', 'asphalt.ktx2'), 'tex');
      const out2 = `${out}-2`;
      expect(extractMedia(again, out2).version).toBe(m.version);
      rmSync(again, { recursive: true, force: true });
      rmSync(out2, { recursive: true, force: true });
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(d, { recursive: true, force: true });
    }
  });
});
