import { describe, expect, it } from 'vitest';
import { av1Args, checkPoints, DEFAULT_ENCODE, inputArgs, loopFilter, loopFrames, mp4Args, webmPasses, type Manifest } from '../src/encode.ts';

const m: Manifest = { season: 'autumn', fps: 30, width: 1920, height: 1080, format: 'png', frames: 1845, loopS: 60, xfadeS: 1.5, routeId: 'chevreuse-boucle', d0: 5825, hour: 9.2 };

describe('film d’accueil : encodage', () => {
  it('borne la boucle et le fondu de raccord', () => {
    expect(loopFrames(m)).toEqual({ L: 1800, F: 45 });
    expect(() => loopFrames({ ...m, frames: 1800 })).toThrow();
  });

  it('lit les PNG (et les JPEG des anciennes captures)', () => {
    expect(inputArgs(m, 'out/x').at(-1)).toBe('out/x/frame-%05d.png');
    expect(inputArgs({ ...m, format: undefined }, 'out/x').at(-1)).toBe('out/x/frame-%05d.jpg');
  });

  it('referme la boucle et sort du yuv420p BT.709 plage vidéo', () => {
    const f = loopFilter(m, DEFAULT_ENCODE);
    expect(f).toContain('trim=start_frame=45:end_frame=1800');
    expect(f).toContain('trim=start_frame=1800:end_frame=1845');
    expect(f).toContain('out_color_matrix=bt709:out_range=tv,format=yuv420p');
  });

  it('MP4 : H.264 High, CRF, image clé toutes les 2 s, faststart', () => {
    const a = mp4Args(m, 'f', 'o.mp4', DEFAULT_ENCODE);
    const v = (k: string) => a[a.indexOf(k) + 1];
    expect(v('-c:v')).toBe('libx264');
    expect(v('-profile:v')).toBe('high');
    expect(v('-pix_fmt')).toBe('yuv420p');
    expect(v('-crf')).toBe('19');
    expect(v('-g')).toBe('60');
    expect(v('-movflags')).toBe('+faststart');
    expect(v('-maxrate')).toBe('3800k');
    expect(mp4Args(m, 'f', 'o.mp4', { ...DEFAULT_ENCODE, mp4MaxKbps: undefined })).not.toContain('-maxrate');
  });

  it('MP4 AV1 : SVT-AV1 à qualité constante, même boucle, faststart', () => {
    const a = av1Args(m, 'f', 'o.av1.mp4', DEFAULT_ENCODE);
    const v = (k: string) => a[a.indexOf(k) + 1];
    expect(v('-c:v')).toBe('libsvtav1');
    expect(v('-crf')).toBe('50');
    expect(v('-pix_fmt')).toBe('yuv420p');
    expect(v('-filter_complex')).toBe(loopFilter(m, DEFAULT_ENCODE));
    expect(v('-movflags')).toBe('+faststart');
    expect(a.at(-1)).toBe('o.av1.mp4');
  });

  it('WebM : VP9 à qualité constante (-b:v 0), deux passes', () => {
    const [p1, p2] = webmPasses(m, 'f', 'o.webm', 'log', DEFAULT_ENCODE, 'NUL');
    for (const a of [p1, p2]) {
      expect(a?.[a.indexOf('-crf') + 1]).toBe('40');
      expect(a?.[a.indexOf('-b:v') + 1]).toBe('0');
      expect(a).toContain('-row-mt');
    }
    expect(p2?.at(-1)).toBe('o.webm');
  });

  it('images de contrôle dans la vidéo, raccord compris', () => {
    const c = checkPoints(m);
    expect(c.find((p) => p.name === 'g-seam-last')?.frame).toBe(1799);
    expect(c.every((p) => p.frame >= 0 && p.frame < 1800)).toBe(true);
  });
});
