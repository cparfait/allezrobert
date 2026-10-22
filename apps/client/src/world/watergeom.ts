/**
 * Géométrie de l'eau sans dépendance au moteur (testable) : subdivision des plans d'eau pour
 * porter une profondeur par sommet, profil des cours d'eau (surface qui ne remonte jamais vers
 * l'aval), rubans de rivière.
 */

/**
 * Subdivise des triangles plats (x, z) par bissection de la plus longue arête jusqu'à ce que
 * toutes les arêtes mesurent moins de `maxEdge`. Le plan étant horizontal, les sommets en T qui
 * en résultent ne créent aucune fissure. `maxTris` borne le résultat (le pas est alors élargi).
 */
export function subdivideFlat(pts: number[], tris: number[], maxEdge: number, maxTris = 20000): { pts: number[]; tris: number[] } {
  // Pas minimal compatible avec la limite : un triangle de côté e couvre ≈ e²/2.
  let area = 0;
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const [a, b, c] = [tris[i] as number, tris[i + 1] as number, tris[i + 2] as number];
    area += Math.abs(((pts[b * 2] as number) - (pts[a * 2] as number)) * ((pts[c * 2 + 1] as number) - (pts[a * 2 + 1] as number)) - ((pts[c * 2] as number) - (pts[a * 2] as number)) * ((pts[b * 2 + 1] as number) - (pts[a * 2 + 1] as number))) / 2;
  }
  let edge = Math.max(maxEdge, Math.sqrt((3 * area) / maxTris));
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = pts.slice();
    const res: number[] = [];
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      let m = mid.get(key);
      if (m === undefined) {
        m = out.length / 2;
        out.push(((out[a * 2] as number) + (out[b * 2] as number)) / 2, ((out[a * 2 + 1] as number) + (out[b * 2 + 1] as number)) / 2);
        mid.set(key, m);
      }
      return m;
    };
    const len2 = (a: number, b: number) => ((out[a * 2] as number) - (out[b * 2] as number)) ** 2 + ((out[a * 2 + 1] as number) - (out[b * 2 + 1] as number)) ** 2;
    const stack: Array<[number, number, number]> = [];
    for (let i = 0; i + 2 < tris.length; i += 3) stack.push([tris[i] as number, tris[i + 1] as number, tris[i + 2] as number]);
    let overflow = false;
    while (stack.length) {
      const [a, b, c] = stack.pop() as [number, number, number];
      const ab = len2(a, b);
      const bc = len2(b, c);
      const ca = len2(c, a);
      const longest = Math.max(ab, bc, ca);
      if (longest <= edge * edge) {
        res.push(a, b, c);
        if (res.length / 3 > maxTris) {
          overflow = true;
          break;
        }
        continue;
      }
      // Bissection de la plus longue arête : l'orientation des deux moitiés est conservée.
      if (longest === ab) {
        const m = midpoint(a, b);
        stack.push([a, m, c], [m, b, c]);
      } else if (longest === bc) {
        const m = midpoint(b, c);
        stack.push([a, b, m], [a, m, c]);
      } else {
        const m = midpoint(c, a);
        stack.push([a, b, m], [m, b, c]);
      }
    }
    if (!overflow) return { pts: out, tris: res };
    edge *= 1.6;
  }
  return { pts, tris };
}

/**
 * Altitude de la surface d'un cours d'eau le long de sa polyligne (sens OSM = sens du courant) :
 * minimum du sol sur la largeur, abaissé de `drop`, puis minimum cumulé vers l'aval (l'eau ne
 * remonte pas). `ground(x, z)` peut renvoyer NaN (tuile absente) : le point prend alors la valeur
 * précédente.
 */
export function streamProfile(pts: number[], width: number, ground: (x: number, z: number) => number, drop = 0.06): number[] {
  const n = pts.length / 2;
  const ys: number[] = [];
  let prev = Number.NaN;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] as number;
    const z = pts[i * 2 + 1] as number;
    const j = Math.min(i + 1, n - 1);
    const k = Math.max(i - 1, 0);
    let dx = (pts[j * 2] as number) - (pts[k * 2] as number);
    let dz = (pts[j * 2 + 1] as number) - (pts[k * 2 + 1] as number);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const h = width / 2;
    let m = ground(x, z);
    for (const s of [-h, h]) {
      const g = ground(x - dz * s, z + dx * s);
      if (Number.isFinite(g) && !(g >= m)) m = g;
    }
    let y = Number.isFinite(m) ? m - drop : prev;
    if (Number.isFinite(prev) && y > prev) y = prev;
    ys.push(y);
    prev = y;
  }
  // Tête de polyligne sans sol connu : reprend la première valeur valide.
  const first = ys.find((v) => Number.isFinite(v));
  return ys.map((v) => (Number.isFinite(v) ? v : (first ?? 0)));
}

/**
 * Maillage plat d'un cours d'eau : 3 sommets par point (berge gauche, axe, berge droite), faces
 * vers le haut. `depth` = 0 sur les berges, `dmax` sur l'axe ; `flow` = vitesse du courant (m/s)
 * le long du tracé, plus forte au milieu.
 */
export function streamMesh(pts: number[], ys: number[], width: number, dmax: number, speed: number): { pos: number[]; depth: number[]; flow: number[]; index: number[] } {
  const n = pts.length / 2;
  const pos: number[] = [];
  const depth: number[] = [];
  const flow: number[] = [];
  const index: number[] = [];
  const h = width / 2;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] as number;
    const z = pts[i * 2 + 1] as number;
    const j = Math.min(i + 1, n - 1);
    const k = Math.max(i - 1, 0);
    let dx = (pts[j * 2] as number) - (pts[k * 2] as number);
    let dz = (pts[j * 2 + 1] as number) - (pts[k * 2 + 1] as number);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const y = ys[i] as number;
    pos.push(x + dz * h, y, z - dx * h, x, y, z, x - dz * h, y, z + dx * h);
    depth.push(0, dmax, 0);
    flow.push(dx * speed * 0.4, dz * speed * 0.4, dx * speed, dz * speed, dx * speed * 0.4, dz * speed * 0.4);
    if (i > 0) {
      const a = (i - 1) * 3;
      const b = i * 3;
      index.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  return { pos, depth, flow, index };
}

/** Largeur affichée d'un cours d'eau OSM (m) ; 0 = non dessiné (fossés, drains, souterrain). */
export function streamWidth(kind: string | undefined, width: number): number {
  if (kind === 'ditch' || kind === 'drain') return 0;
  const w = Number.isFinite(width) && width > 0 ? width : kind === 'river' ? 6 : kind === 'canal' ? 5 : 1.6;
  return Math.min(Math.max(w, kind === 'stream' ? 1.2 : 2), 30);
}
