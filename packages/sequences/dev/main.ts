/**
 * Banc d'essai navigateur : `pnpm --filter @allezrobert/sequences dev` puis http://localhost:5180.
 * Un canvas 2D animé simule le rendu du jeu ; le compteur affiche fps moyen / pire image
 * pendant la lecture d'une séquence.
 */
import { SequencePlayer, type Lang, type SequenceName } from '../src/index.ts';

const app = document.getElementById('app')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const fpsEl = document.getElementById('fps')!;
const langEl = document.getElementById('lang') as HTMLSelectElement;

const player = new SequencePlayer(app, { lang: 'fr' });
(window as unknown as { seq: SequencePlayer }).seq = player;

const samples: Record<SequenceName, Record<string, unknown>> = {
  intro: {
    route_name: 'Les 17 Tournants',
    ride_type: 'race',
    distance_km: 28.6,
    elevation_m: 418,
    riders: 9,
    profile: [88, 93, 104, 131, 160, 147, 120, 110, 134, 171, 194, 176, 140, 121, 139, 177, 203, 205],
  },
  kom: { segment_name: 'Côte des 17 Tournants', time_s: 402.1, rank: 4, rank_total: 12, gap_s: 18.6, pr: true, pr_delta_s: 11 },
  sprint: { segment_name: 'Sprint de Dampierre', time_s: 21.8, rank: 1, rank_total: 12, pr: false },
  podium: {
    route_name: 'Les 17 Tournants',
    podium: [
      { name: 'Robert', time_s: 3412.4, team: 'VC Chevreuse', team_color: '#ef4444' },
      { name: 'Christophe P.', time_s: 3415.9, team: 'Les Pois Chiches', team_color: '#3b82f6' },
      { name: 'Mathilde', time_s: 3460.2, team: 'Saclay Express', team_color: '#22c55e' },
    ],
  },
  tv: { rider_name: 'Christophe P.', team: 'Les Pois Chiches', position: 4, wkg: 4.6, watts: 341 },
  summary: {},
};

// --- Faux rendu 3D + mesure des fps ------------------------------------------------------
let last = performance.now();
let frames = 0;
let worst = 0;
let acc = 0;
function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
}
addEventListener('resize', resize);
resize();
function tick(now: number) {
  const dt = now - last;
  last = now;
  frames++;
  acc += dt;
  worst = Math.max(worst, dt);
  if (acc >= 1000) {
    fpsEl.textContent = `${((frames * 1000) / acc).toFixed(1)} fps · pire image ${worst.toFixed(1)} ms · ${player.current ?? '—'}${player.holding ? ' (maintien)' : ''}`;
    frames = 0;
    acc = 0;
    worst = 0;
  }
  const w = canvas.width;
  const h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#7fb0e6');
  g.addColorStop(0.58, '#e8e0cf');
  g.addColorStop(0.6, '#6b8e3a');
  g.addColorStop(1, '#3c4a22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = now / 1000;
  ctx.fillStyle = '#3c3d40';
  ctx.beginPath();
  ctx.moveTo(w * 0.47 + Math.sin(t) * 20, h * 0.6);
  ctx.lineTo(w * 0.53 + Math.sin(t) * 20, h * 0.6);
  ctx.lineTo(w * 0.8, h);
  ctx.lineTo(w * 0.2, h);
  ctx.fill();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- Commandes -----------------------------------------------------------------------------
// ?nopreload : laisse le préchargement au script de mesure (scripts/bench.ts).
if (!location.search.includes('nopreload')) void player.preload().then(() => console.info('[sequences] préchargé'));

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-play]')) {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.play as SequenceName;
    const t0 = performance.now();
    const res = await player.play(name, samples[name] as never, {
      lang: langEl.value as Lang,
      hold: name === 'tv',
      onCue: (cue, at) => console.info(`[sequences] repère ${cue} @${at}s (+${((performance.now() - t0) / 1000).toFixed(2)} s)`),
    });
    console.info(`[sequences] ${name} terminé`, res, `${((performance.now() - t0) / 1000).toFixed(2)} s`);
  });
}
document.getElementById('release')!.addEventListener('click', () => player.release());
document.getElementById('stop')!.addEventListener('click', () => player.stop());
document.getElementById('update')!.addEventListener('click', () =>
  player.update({
    wkg: 5.1,
    watts: 378,
    position: 3,
    groups: [
      { label: 'tv.breakaway', riders: 4, gap_s: 0, color: '#ffd23f' },
      { label: 'tv.peloton', riders: 11, gap_s: 31 },
    ],
    focus_group: 0,
  })
);
