/**
 * Banc de mesure d'une sortie (étude de rendu du 17/11/2026, piste 6) : à coller dans la console du jeu en
 * sortie (dev ou version compilée, `window.__ar` présent), de préférence avec ?perf=1 pour le temps GPU.
 *
 *   await rideBench({ distM: 1200, seconds: 15 })
 *
 * Replace le coureur au même point du parcours, attend que la scène se stabilise, puis mesure pendant
 * `seconds` : cadence, temps d'image (moyenne, 95e centile, pire), temps processeur passé dans le rendu
 * (préparation et soumission), temps GPU, appels de dessin et triangles, temps du reste (jeu, attente).
 * Renvoie un objet à copier tel quel dans le message de commit ou le rapport.
 */
window.rideBench = async function rideBench({ distM = 1200, seconds = 15, warm = 4, regroup = true } = {}) {
  const ar = window.__ar;
  if (!ar) throw new Error('pas en sortie : window.__ar absent');
  const { engine, ride } = ar;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (distM !== null) {
    // Le groupe suit le joueur (mêmes écarts) : sinon il reste loin derrière, hors de vue, et la scène change.
    const delta = distM - ride.state.distM;
    ride.state.distM = distM;
    for (const r of ar.peloton?.riders ?? []) r.state.distM += delta;
  }
  // Groupe resserré autour du joueur (scène comparable d'une mesure à l'autre).
  if (regroup) (ar.peloton?.riders ?? []).forEach((r, i) => (r.state.distM = ride.state.distM + 6 - i * 2.5));
  await sleep(warm * 1000);
  const r = engine.renderer;
  const info = r.info;
  let renderMs = 0;
  let depth = 0;
  // Seul l'appel le plus extérieur compte : render() appelle parfois renderAsync() (ou l'inverse).
  const wrap = (name) => {
    const orig = r[name];
    if (typeof orig !== 'function') return () => {};
    r[name] = function (...a) {
      if (depth > 0) return orig.apply(this, a);
      depth++;
      const t = performance.now();
      try {
        return orig.apply(this, a);
      } finally {
        renderMs += performance.now() - t;
        depth--;
      }
    };
    return () => {
      r[name] = orig;
    };
  };
  const undo = [wrap('render'), wrap('renderAsync')];
  const dts = [];
  const cpu = [];
  const gpu = [];
  const calls = [];
  const tris = [];
  let last = performance.now();
  const end = last + seconds * 1000;
  try {
    while (performance.now() < end) {
      await new Promise((res) => requestAnimationFrame(res));
      const now = performance.now();
      dts.push(now - last);
      last = now;
      cpu.push(renderMs);
      renderMs = 0;
      if (info.render.timestamp > 0) gpu.push(info.render.timestamp);
      calls.push(info.render.drawCalls);
      tris.push(info.render.triangles);
    }
  } finally {
    undo.forEach((u) => u());
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pct = (xs, p) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
  };
  const f2 = (x) => Math.round(x * 100) / 100;
  const frameMs = mean(dts);
  return {
    quality: engine.quality.level,
    frames: dts.length,
    fps: f2(1000 / frameMs),
    frameMs: f2(frameMs),
    p95Ms: f2(pct(dts, 0.95)),
    maxMs: f2(Math.max(...dts)),
    renderCpuMs: f2(mean(cpu)),
    otherCpuMs: f2(frameMs - mean(cpu)),
    gpuMs: gpu.length ? f2(mean(gpu)) : null,
    drawCalls: Math.round(mean(calls)),
    trianglesM: f2(mean(tris) / 1e6),
  };
};
