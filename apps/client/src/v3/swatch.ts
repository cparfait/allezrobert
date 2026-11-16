/**
 * Couleur dominante d'un coloris de vélo V3, lue dans sa texture de peinture (servie par le plugin, sans teinte) :
 * pastille des coloris et dégradé du réglage « Couleur principale » (décalage de teinte des coloris réglables).
 */
export type Rgb = [number, number, number];

const swatches = new Map<string, Promise<Rgb | undefined>>();

function hsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max === 0 ? 0 : d / max, max / 255];
}

function rgb(h: number, s: number, v: number): Rgb {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Couleur décalée d'une fraction de tour de teinte (comme le décalage appliqué à la texture par le plugin). */
export function shiftHue(color: Rgb, turn: number): Rgb {
  const [h, s, v] = hsv(color);
  return rgb((h + turn * 360 + 360) % 360, s, v);
}

export const css = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;

/**
 * Teinte dominante des pixels colorés (saturés et assez clairs), par paniers de 10° pondérés par la saturation :
 * le noir, le gris et le blanc (cadre, inscriptions) ne comptent pas. Rien si la peinture est neutre.
 */
export function bikeSwatch(bike: string, color: number): Promise<Rgb | undefined> {
  const key = bike + ':' + color;
  let job = swatches.get(key);
  if (!job) {
    job = (async () => {
      const image = new Image();
      image.src = '/__v3/bikecolor/' + encodeURIComponent(bike) + '.png?color=' + color;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return undefined;
      context.drawImage(image, 0, 0, 64, 64);
      const pixels = context.getImageData(0, 0, 64, 64).data;
      const bins = Array.from({ length: 36 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! < 128) continue;
        const pixel: Rgb = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
        const [h, s, v] = hsv(pixel);
        total++;
        if (s < 0.25 || v < 0.2) continue;
        const bin = bins[Math.floor(h / 10) % 36]!;
        const weight = s * v;
        bin.weight += weight;
        bin.r += pixel[0] * weight; bin.g += pixel[1] * weight; bin.b += pixel[2] * weight;
      }
      const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
      if (!total || best.weight < total * 0.02) return undefined;
      return [Math.round(best.r / best.weight), Math.round(best.g / best.weight), Math.round(best.b / best.weight)] as Rgb;
    })().catch(() => undefined);
    swatches.set(key, job);
  }
  return job;
}
