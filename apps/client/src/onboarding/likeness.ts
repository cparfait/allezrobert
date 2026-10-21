/**
 * Ressemblance à partir d'une photo, V1 : estimation du teint et de la couleur des cheveux.
 * Traitement 100 % local (canvas du navigateur) : la photo n'est ni envoyée ni conservée.
 * Réservé à une photo de soi, avec consentement explicite (donnée personnelle).
 * Hypothèse de cadrage : visage centré, de face (photo d'identité ou selfie).
 */
export interface Likeness {
  skin: string;
  hair: string;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Médiane par canal d'une zone (robuste aux reflets et aux ombres). */
function medianColor(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): [number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = Math.floor(y0); y < y1; y += 2)
    for (let x = Math.floor(x0); x < x1; x += 2) {
      const i = (y * w + x) * 4;
      rs.push(data[i] as number);
      gs.push(data[i + 1] as number);
      bs.push(data[i + 2] as number);
    }
  const med = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0;
  return [med(rs), med(gs), med(bs)];
}

export async function likenessFromPhoto(file: File): Promise<Likeness> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  // Recadrage carré centré.
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, size, size);
  // Joues (sous les yeux, de part et d'autre du nez) pour le teint ; haut du crâne pour les cheveux.
  const left = medianColor(data, size, size * 0.3, size * 0.5, size * 0.42, size * 0.62);
  const right = medianColor(data, size, size * 0.58, size * 0.5, size * 0.7, size * 0.62);
  const hair = medianColor(data, size, size * 0.35, size * 0.04, size * 0.65, size * 0.16);
  const skin: [number, number, number] = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
  // Les données de pixels ne quittent pas cette fonction.
  data.fill(0);
  return { skin: toHex(...skin), hair: toHex(...hair) };
}
