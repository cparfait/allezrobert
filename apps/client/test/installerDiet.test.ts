import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneDist } from '../scripts/installerDiet.ts';

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
