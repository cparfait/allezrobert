/*
 * Robert en low poly (écran d'attente du style jeu vidéo) : détourage et calques d'animation.
 * À coller dans la console du client en développement (`pnpm dev:client`) : lit les images source par /@fs/,
 * écrit le résultat dans out/robert-lowpoly/ par /__save (vite.config.ts), à copier ensuite dans
 * apps/client/public/robert-lowpoly/ (velo-base, velo-leg, velo-upper, velo-arm, attente, attente-velo).
 *
 * Images source (1024 × 1024, fond blanc, ombre portée bleutée à gauche) : SRC ci-dessous.
 * Détourage : fond modélisé par une surface quadratique (bords haut, gauche, droit et bas droit), remplissage
 * depuis les bords à travers les pixels proches du fond ET lisses (les arêtes des facettes arrêtent le
 * remplissage : casque et chaussettes blancs gardés), ombre et sol retirés dans le bas de l'image (zones
 * PROTECT autour des chaussures : seuls l'ombre bleutée et le sol très lisse y sont retirés), trous du fond
 * enfermés (cadre, rayons) retirés, îlots isolés supprimés, bords adoucis et décontaminés.
 * Calques (comme layers.py pour l'ancien Robert) : bras levé, buste et tête, vélo (avec bassin, mains et home
 * trainer), jambe visible (laissée aussi dans le vélo : en bougeant elle ne découvre rien).
 */
(async () => {
  const BASE = '/@fs/C:/tmp/__DEV__/allezrobert-lowpoly/zz/';
  const SRC = { velo: 'image-1793208664379.webp', attente: 'image-1793208688281.png', 'attente-velo': 'image-1793208684206.webp' };
  const PROTECT = { velo: [[395, 770, 485, 900]], attente: [[390, 840, 480, 935], [525, 840, 632, 928]], 'attente-velo': [[235, 850, 310, 945], [370, 850, 480, 935]] };
  const ARM = [[655, 505], [648, 452], [700, 425], [712, 300], [760, 280], [840, 296], [845, 388], [792, 428], [738, 432], [692, 497]];
  const UPPER = [[0, 0], [1024, 0], [1024, 622], [600, 622], [528, 642], [380, 652], [0, 652]];
  const LEG = [[430, 745], [470, 712], [522, 734], [506, 792], [482, 802], [480, 893], [408, 898], [398, 822]];
  const OUT_H = 460;

  const save = async (c, name, type = 'image/webp') => (await fetch(`/__save?name=${name}&dir=robert-lowpoly`, { method: 'POST', body: await c.convertToBlob({ type }) })).text();

  async function cutout(src, protect = []) {
    const T = 9, G = 7, HOLE = 4.5;
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const id = g.getImageData(0, 0, W, H);
    const d = id.data;
    // Fond : surface quadratique par canal (moindres carrés) sur les bords sans ombre.
    const pts = [];
    for (let x = 0; x < W; x += 4) pts.push([x, 2]);
    for (let x = Math.floor(W * 0.8); x < W; x += 4) pts.push([x, H - 3]);
    for (let y = 0; y < H * 0.7; y += 4) pts.push([2, y], [W - 3, y]);
    const basis = (x, y) => { const u = x / W, v = y / H; return [1, u, v, u * u, u * v, v * v]; };
    const fit = [];
    for (let ch = 0; ch < 3; ch++) {
      const A = Array.from({ length: 6 }, () => new Array(7).fill(0));
      for (const [x, y] of pts) { const b = basis(x, y); const val = d[(y * W + x) * 4 + ch]; for (let i = 0; i < 6; i++) { for (let j = 0; j < 6; j++) A[i][j] += b[i] * b[j]; A[i][6] += b[i] * val; } }
      for (let i = 0; i < 6; i++) { let p = i; for (let r = i + 1; r < 6; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; for (let r = 0; r < 6; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let k = i; k < 7; k++) A[r][k] -= f * A[i][k]; } }
      fit.push(A.map((row, i) => row[6] / row[i]));
    }
    const bg = new Float32Array(N * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const b = basis(x, y); for (let ch = 0; ch < 3; ch++) { let s = 0; for (let i = 0; i < 6; i++) s += fit[ch][i] * b[i]; bg[(y * W + x) * 3 + ch] = s; } }
    const dist = (i) => Math.max(Math.abs(d[i * 4] - bg[i * 3]), Math.abs(d[i * 4 + 1] - bg[i * 3 + 1]), Math.abs(d[i * 4 + 2] - bg[i * 3 + 2]));
    const lum = (i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const sat = (i) => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) - Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const grad = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; let m = 0; for (const j of [i - 1, i + 1, i - W, i + W]) for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(d[i * 4 + ch] - d[j * 4 + ch])); grad[i] = m; }
    // Ombre portée et sol (bas de l'image) ; autour des chaussures, seulement l'ombre bleutée et le sol très lisse.
    const floor = (i) => {
      const y = (i / W) | 0, x = i % W;
      if (protect.some(([a, b, c2, e]) => x >= a && x <= c2 && y >= b && y <= e)) return (d[i * 4 + 2] - d[i * 4] >= 7 && lum(i) < 232 && sat(i) < 42 && grad[i] < 6) || (lum(i) > 236 && sat(i) < 12 && grad[i] < 3.5);
      return y > H * 0.72 && ((sat(i) < 42 && d[i * 4 + 2] >= d[i * 4] && lum(i) > 105) || (lum(i) > 205 && sat(i) < 18 && grad[i] < 6));
    };
    const isBg = (i) => { const t = ((i / W) | 0) < H * 0.45 ? T * 0.6 : T; return (dist(i) < t && grad[i] < G) || floor(i); };
    const bgm = new Uint8Array(N);
    const q = [];
    const seed = (i) => { if (!bgm[i] && isBg(i)) { bgm[i] = 1; q.push(i); } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (q.length) { const i = q.pop(); const x = i % W, y = (i / W) | 0; if (x > 0) seed(i - 1); if (x < W - 1) seed(i + 1); if (y > 0) seed(i - W); if (y < H - 1) seed(i + W); }
    // Trous du fond enfermés (cadre du vélo, rayons).
    const seen = new Uint8Array(N);
    const holeLike = (i) => dist(i) < HOLE && grad[i] < 4;
    for (let s = 0; s < N; s++) {
      if (bgm[s] || seen[s] || !holeLike(s)) continue;
      const comp = [s];
      seen[s] = 1;
      for (let k = 0; k < comp.length; k++) { const i = comp[k]; const x = i % W, y = (i / W) | 0; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !seen[j] && !bgm[j] && holeLike(j)) { seen[j] = 1; comp.push(j); } }
      if (comp.length > 150) for (const i of comp) bgm[i] = 1;
    }
    // Alpha, bords adoucis selon l'écart au fond, couleur décontaminée.
    for (let i = 0; i < N; i++) d[i * 4 + 3] = bgm[i] ? 0 : 255;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (bgm[i] || !(bgm[i - 1] || bgm[i + 1] || bgm[i - W] || bgm[i + W])) continue;
      const a = Math.min(1, Math.max(0.15, dist(i) / 40));
      d[i * 4 + 3] = Math.round(a * 255);
      for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = Math.max(0, Math.min(255, (d[i * 4 + ch] - (1 - a) * bg[i * 3 + ch]) / a));
    }
    // Îlots : seules les composantes d'au moins 1,5 % de la plus grande restent.
    const lab = new Int32Array(N).fill(-1);
    const sizes = [];
    for (let s = 0; s < N; s++) {
      if (lab[s] >= 0 || d[s * 4 + 3] < 40) continue;
      const k = sizes.length, st = [s];
      lab[s] = k;
      let n = 0;
      while (st.length) { const i = st.pop(); n++; const x = i % W, y = (i / W) | 0; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && lab[j] < 0 && d[j * 4 + 3] >= 40) { lab[j] = k; st.push(j); } }
      sizes.push(n);
    }
    const big = Math.max(...sizes);
    for (let i = 0; i < N; i++) {
      if (d[i * 4 + 3] >= 40) { if (sizes[lab[i]] < big * 0.015) d[i * 4 + 3] = 0; continue; }
      if (!d[i * 4 + 3]) continue;
      if (![i - 1, i + 1, i - W, i + W].some((j) => j >= 0 && j < N && lab[j] >= 0 && sizes[lab[j]] >= big * 0.015)) d[i * 4 + 3] = 0;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  /** Boîte englobante (pixels opaques) avec 4 px de marge. */
  function bbox(c) {
    const W = c.width, H = c.height, a = c.getContext('2d').getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4);
    return { x0, y0, w: Math.min(W - 1, x1 + 4) - x0 + 1, h: Math.min(H - 1, y1 + 4) - y0 + 1 };
  }
  const resized = (c, b) => { const o = new OffscreenCanvas(Math.round((b.w * OUT_H) / b.h), OUT_H); const og = o.getContext('2d'); og.imageSmoothingQuality = 'high'; og.drawImage(c, b.x0, b.y0, b.w, b.h, 0, 0, o.width, OUT_H); return o; };

  const cuts = {};
  for (const [n, f] of Object.entries(SRC)) cuts[n] = await cutout(BASE + f, PROTECT[n]);
  const out = {};
  for (const n of ['attente', 'attente-velo']) out[n] = await save(resized(cuts[n], bbox(cuts[n])), `${n}.webp`);

  // Calques de Robert à vélo, tous dans la même boîte.
  const S = 1024, src = cuts.velo;
  const poly = (p) => { const path = new Path2D(); path.moveTo(...p[0]); for (const v of p.slice(1)) path.lineTo(...v); path.closePath(); return path; };
  const layer = (keep, remove = []) => {
    const c = new OffscreenCanvas(S, S), g = c.getContext('2d');
    g.save();
    if (remove.length) { const r = new Path2D(); r.rect(0, 0, S, S); for (const p of remove) r.addPath(p); g.clip(r, 'evenodd'); }
    g.clip(keep);
    g.drawImage(src, 0, 0);
    g.restore();
    return c;
  };
  const all = new Path2D();
  all.rect(0, 0, S, S);
  const b = bbox(src);
  const layers = { base: layer(all, [poly(UPPER), poly(ARM)]), leg: layer(poly(LEG)), upper: layer(poly(UPPER), [poly(ARM)]), arm: layer(poly(ARM)) };
  for (const [n, c] of Object.entries(layers)) out[`velo-${n}`] = await save(resized(c, b), `velo-${n}.webp`);
  // Pivots des calques (transform-origin de .rb-lp dans index.html) : roue au sol, genou, bassin, épaule.
  const pct = (x, y) => `${(((x - b.x0) / b.w) * 100).toFixed(1)}% ${(((y - b.y0) / b.h) * 100).toFixed(1)}%`;
  out.origins = { bike: pct(470, 1000), leg: pct(470, 720), upper: pct(455, 645), arm: pct(668, 478), aspect: `${Math.round((b.w * OUT_H) / b.h)} / ${OUT_H}` };
  return out;
})();
