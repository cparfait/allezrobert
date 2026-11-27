/**
 * Sortie simulée pour travailler l'interface sans jeu ni serveur (développement seulement, jamais livré) :
 * `?demo=solo` (parcours libre, carrefours et montées), `seance`, `equipe` (coéquipiers IA), `groupe` (vrais joueurs, chat),
 * `depart` (course à lancer), `menu`. `&d=1200` : départ à 1 200 m ; `&fige=1` : le vélo n'avance pas (captures).
 */
import type { PairState, PhoneCommand } from '@allezrobert/shared';
import { PAIR_SOUND_BUSES, stepCameraTune } from '@allezrobert/shared';
import type { LinkHandlers } from '../link.ts';
import { link, S } from '../state.ts';

const alt = (d: number): number => 120 + 18 * Math.sin(d / 900) + (d > 1500 ? Math.min(d - 1500, 2600) * 0.066 + 8 * Math.sin(d / 230) : 0) - (d > 4100 ? (d - 4100) * 0.03 : 0);

export function startDemo(kind: string, h: LinkHandlers): void {
  const params = new URLSearchParams(location.search);
  const frozen = params.has('fige');
  let d = Number(params.get('d') ?? 400);
  let t = 2841;
  const team = kind === 'equipe' || kind === 'depart';
  const multi = kind === 'groupe';
  const sounds = Object.fromEntries(PAIR_SOUND_BUSES.map((b) => [b, b !== 'traffic'])) as NonNullable<PairState['sounds']>;
  const st: PairState = {
    phase: kind === 'menu' ? 'menu' : 'ride',
    ...(kind === 'depart' ? { awaitingStart: 'race' as const } : {}),
    routeName: 'Tour de la Madeleine',
    road: 'Route de la Madeleine',
    multiplayer: multi,
    open: kind === 'solo',
    team,
    camera: 'chase',
    cameraTune: { height: 0, tilt: 0 },
    fanPercent: 40,
    fanMode: 'speed',
    roadFeel: { percent: 35, supported: true, surface: 'cobblestonesSoft' },
    hudVisible: true,
    ghost: true,
    mapOpen: false,
    muted: false,
    shifter: params.has('vitesses'),
    sounds,
    lookBack: false,
    groupPacePct: 75,
    music: { source: 'spotify', playing: true, title: 'La Montagne — Jean Ferrat', volume: 0.6 },
    destination: kind === 'solo' ? { name: 'Chevreuse', remainingM: 8400, x: 900, z: -1500 } : null,
    ...(multi ? { voice: { available: true, phoneMic: false } } : {}),
  };
  const names = multi ? ['Luc', 'Marie-Hélène', 'Ahmed'] : ['Bernard', 'Raymond', 'Jacques', 'Lucien', 'Federico'];
  link.demo = (c: PhoneCommand) => {
    console.info('[demo]', JSON.stringify(c));
    if (c.kind === 'pause') st.phase = 'paused';
    else if (c.kind === 'resume') st.phase = 'ride';
    else if (c.kind === 'camera') st.camera = c.camera;
    else if (c.kind === 'cameraTune') st.cameraTune = stepCameraTune(st.cameraTune ?? { height: 0, tilt: 0 }, c);
    else if (c.kind === 'fan') [st.fanPercent, st.fanMode] = [c.percent, 'manual'];
    else if (c.kind === 'fanMode') st.fanMode = c.mode;
    else if (c.kind === 'roadFeel') st.roadFeel!.percent = c.percent;
    else if (c.kind === 'mute') st.muted = !st.muted;
    else if (c.kind === 'sound') sounds[c.bus] = c.on;
    else if (c.kind === 'hud') st.hudVisible = !st.hudVisible;
    else if (c.kind === 'ghost') st.ghost = !!c.on;
    else if (c.kind === 'map') st.mapOpen = !!c.open;
    else if (c.kind === 'lookBack') st.lookBack = c.on;
    else if (c.kind === 'pace') st.groupPacePct = (st.groupPacePct ?? 75) + 5 * c.delta;
    else if (c.kind === 'startRace') delete st.awaitingStart;
    else if (c.kind === 'clearDestination') st.destination = null;
    else if (c.kind === 'goTo') st.destination = { name: c.name, remainingM: 5200, x: c.x, z: c.z };
    else if (c.kind === 'music' && c.action === 'toggle') st.music!.playing = !st.music!.playing;
    else if (c.kind === 'music' && c.action === 'volume') st.music!.volume = c.volume ?? 0.5;
    else if (c.kind === 'turn') selected = c.index ?? 0;
    else if (c.kind === 'chat') h.onEvent({ kind: 'chat', who: 'Moi', text: c.text });
    else if (c.kind === 'placeSearch') h.onEvent({ kind: 'placeResults', query: c.query, items: ['Chevreuse', 'Saint-Rémy-lès-Chevreuse', 'Dampierre-en-Yvelines', 'Cernay-la-Ville', 'Milon-la-Chapelle', 'Choisel', 'Senlisse'].map((name, i) => ({ name, sub: `Village · ${i + 2} km`, x: 100 * i, z: 50 })) });
    else if (c.kind === 'musicSearch') h.onEvent({ kind: 'musicResults', query: c.query, items: ['Sortie longue', 'Fractionné', 'Chanson française', 'Rock à pédaler'].map((name, i) => ({ uri: `spotify:playlist:demo000000${i}`, type: 'playlist' as const, name, sub: `${20 + 7 * i} titres` })) });
  };
  let selected = 1;
  S.pair = 'demo-demo-demo-demo-demo';
  S.conn = 'connected';
  S.presence = { game: true, phones: 1 };
  const points: number[] = [];
  for (let k = 0; k <= 5200; k += 20) points.push(Math.round(700 * Math.sin(k / 800)), Math.round(-k * 0.6), Math.round(alt(k)), k);
  h.onRoute({ name: st.routeName!, loop: false, lengthM: 5200, points, originL93: { x: 630_200, y: 6_846_800 } });
  if (multi) setTimeout(() => h.onEvent({ kind: 'chat', who: 'Luc', text: 'On se regroupe en haut ?' }), 2500);

  const tick = (): void => {
    t += 0.25;
    const grade = ((alt(d + 20) - alt(d - 20)) / 40) * 100;
    if (!frozen && st.phase === 'ride' && !st.awaitingStart) d = (d + 2) % 5000;
    const w = Math.round(215 + 14 * Math.sin(t / 3) + grade * 6);
    const inM = 1300 - d;
    st.junction =
      st.open && inM > 0 && inM < 100
        ? { inM, selected, locked: inM < 20, choices: [{ dir: 'left', name: 'Chemin de la Butte', unpaved: true }, { dir: 'straight', name: 'D 95', unpaved: false }, { dir: 'right', name: 'Rue de Paris', unpaved: false }] }
        : null;
    if (kind === 'seance') st.workout = { name: 'Seuil 3 × 10', targetWatts: 230, stepRemainingS: Math.max(0, 600 - (t % 600)), remainingS: 1800, next: '140 W' };
    if (kind === 'segment') st.segment = { name: 'Mur de la Madeleine', kind: 'kom', progress: (d % 800) / 800, elapsedS: t % 200 };
    const k = (d / 800) % (2 * Math.PI);
    st.pos = { x: 700 * Math.sin(d / 800), z: -d * 0.6, heading: Math.atan2(0.875 * Math.cos(k), -0.6) };
    st.metrics = { speedKmh: 31.4 - grade, watts: w, watts3s: w, avgWatts: 198, np: 214, cadence: 88, hr: 148, distM: 21_400 + d, elapsedS: t, elevationGainM: 312, gradePercent: grade, altitudeM: alt(d), routeM: d, lap: 1, draftPct: 12, ftp: 250, wkg: w / 72, kcal: 512, gearLabel: '50 × 19', gearIndex: 13, gearCount: 24 };
    st.riders = [
      { id: 'me', name: 'Moi', gapM: 0, wkg: 3, color: '#ffd23f', me: true },
      ...(team || multi ? names : []).map((name, i) => ({ id: name, name, gapM: 22 - 11 * i + 2 * Math.sin(t / 4 + i), wkg: 3.1, color: ['#e5484d', '#3b82f6', '#22c55e', '#a855f7', '#f97316'][i]!, ...(multi ? { online: true } : { ai: true, energy: 92 - 17 * i, ...(i === 0 ? { effort: 'attack' as const } : i === 4 ? { effort: 'cracked' as const } : {}) }) })),
    ];
    h.onState(structuredClone(st));
  };
  tick();
  setInterval(tick, 250);
}
