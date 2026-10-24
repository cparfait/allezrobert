/**
 * Grilles d'altitude des tuiles (`.hi.u16` / `.lo.u16`) codées en différences : chaque valeur est
 * l'écart (modulo 2¹⁶) à sa voisine de gauche, ou à celle du dessus en début de ligne. Le relief
 * varie peu d'un point au suivant : les fichiers se compressent ≈ 1,5 × mieux (téléchargement et
 * packs gardés compressés sur l'appareil). Grille (n+1)², ligne 0 = nord.
 */

/** Valeurs brutes → différences (sur place). */
export function deltaEncodeU16(q: Uint16Array, n: number): Uint16Array {
  const N = n + 1;
  for (let j = N - 1; j >= 0; j--)
    for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i;
      const pred = i > 0 ? q[k - 1]! : j > 0 ? q[k - N]! : 0;
      q[k] = (q[k]! - pred) & 0xffff;
    }
  return q;
}

/** Différences → valeurs brutes (sur place). */
export function deltaDecodeU16(d: Uint16Array, n: number): Uint16Array {
  const N = n + 1;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const pred = i > 0 ? d[k - 1]! : j > 0 ? d[k - N]! : 0;
      d[k] = (d[k]! + pred) & 0xffff;
    }
  return d;
}
