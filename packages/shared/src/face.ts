/**
 * Curseurs de forme des avatars (docs/AVATARS.md § 4) : 34 pour le visage, 8 pour le corps,
 * chacun de −1 à +1 (0 = tête de base). Le modèle (tools/blender/avatars/build_avatar.py) porte
 * une cible « nom+ » et / ou « nom− » par curseur ; le client les applique une fois, sur le
 * processeur. En réseau et en base, la forme tient dans `AvatarLook.face` : un octet par curseur,
 * dans l'ordre de FACE_SLIDERS, encodé en base64url (56 caractères). Aucune géométrie ni image.
 */

export type FaceGroup = 'head' | 'eyes' | 'nose' | 'mouth' | 'body';

export const FACE_SLIDERS = [
  // Tête, mâchoire, joues
  { id: 'jawWidth', group: 'head' },
  { id: 'jawHeight', group: 'head' },
  { id: 'jawAngle', group: 'head' },
  { id: 'chinProtrusion', group: 'head' },
  { id: 'chinHeight', group: 'head' },
  { id: 'chinWidth', group: 'head' },
  { id: 'chinCleft', group: 'head' },
  { id: 'cheekbones', group: 'head' },
  { id: 'cheekVolume', group: 'head' },
  { id: 'cheekHeight', group: 'head' },
  { id: 'faceFat', group: 'head' },
  { id: 'headWidth', group: 'head' },
  { id: 'headLength', group: 'head' },
  { id: 'headDepth', group: 'head' },
  { id: 'foreheadSlope', group: 'head' },
  { id: 'earSize', group: 'head' },
  { id: 'earAngle', group: 'head' },
  { id: 'neckWidth', group: 'head' },
  // Yeux et sourcils
  { id: 'browRidge', group: 'eyes' },
  { id: 'browHeight', group: 'eyes' },
  { id: 'browAngle', group: 'eyes' },
  { id: 'eyeSize', group: 'eyes' },
  { id: 'eyeSpacing', group: 'eyes' },
  { id: 'eyeHeight', group: 'eyes' },
  { id: 'eyeTilt', group: 'eyes' },
  { id: 'eyelidFold', group: 'eyes' },
  // Nez
  { id: 'noseLength', group: 'nose' },
  { id: 'noseWidth', group: 'nose' },
  { id: 'noseBridge', group: 'nose' },
  { id: 'noseTip', group: 'nose' },
  { id: 'nostrilFlare', group: 'nose' },
  // Bouche
  { id: 'lipFullness', group: 'mouth' },
  { id: 'mouthWidth', group: 'mouth' },
  { id: 'mouthCorners', group: 'mouth' },
  // Corps (sexe : −1 = morphologie féminine ; origine : trois poids d'« air d'origine »)
  { id: 'sex', group: 'body' },
  { id: 'age', group: 'body' },
  { id: 'weight', group: 'body' },
  { id: 'muscle', group: 'body' },
  { id: 'shoulders', group: 'body' },
  { id: 'originAfrican', group: 'body' },
  { id: 'originAsian', group: 'body' },
  { id: 'originEuropean', group: 'body' },
] as const satisfies ReadonlyArray<{ id: string; group: FaceGroup }>;

export type FaceSlider = (typeof FACE_SLIDERS)[number]['id'];
export type FaceShape = Partial<Record<FaceSlider, number>>;

/** Longueur de `AvatarLook.face` (base64url sans remplissage). */
export const FACE_CODE_LENGTH = Math.ceil((FACE_SLIDERS.length * 4) / 3);
export const FACE_CODE_RE = new RegExp(`^[A-Za-z0-9_-]{${FACE_CODE_LENGTH}}$`);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** −1 → 1 sur un octet : 0 ↔ 127, pas de 1/127. */
function toByte(v: number): number {
  return Math.round((Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)) + 1) * 127);
}

export function encodeFace(shape: FaceShape): string {
  const bytes = FACE_SLIDERS.map((s) => toByte(shape[s.id] ?? 0));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    const k = Math.min(3, bytes.length - i);
    for (let j = 0; j <= k; j++) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/** Forme décodée (curseurs non nuls seulement) ; code invalide : forme de base. */
export function decodeFace(code: string | undefined): FaceShape {
  if (!code || !FACE_CODE_RE.test(code)) return {};
  const bytes: number[] = [];
  for (let i = 0; i < code.length; i += 4) {
    const chunk = code.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 6) | (j < chunk.length ? B64.indexOf(chunk[j] as string) : 0);
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const shape: FaceShape = {};
  FACE_SLIDERS.forEach((s, i) => {
    const v = Math.min(254, bytes[i] ?? 127) / 127 - 1;
    if (Math.abs(v) > 1e-6) shape[s.id] = v;
  });
  return shape;
}
