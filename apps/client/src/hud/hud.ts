import { climbCategory, climbCategoryLabel, countryName, type RoadGraphData, type RouteSegment, type RouteTrack } from '@allezrobert/shared';
import { flagSvg } from '../ui/flagSvg.ts';
import { getLang, t } from '../i18n/index.ts';
import { BASEMAP_ATTRIBUTION, basemapUrl } from '../ui/basemap.ts';
import { GRAPHIC_STYLE, LOW_POLY } from '../engine/style.ts';
import { ClimbPanel } from './climbPanel.ts';

/**
 * Disposition du HUD : « compact » (bandeaux plats et serrés, défaut du style low poly) ou « full »
 * (cockpit du style réaliste : compteur en arc, grandes tuiles). ?hud=compact|full a priorité sur
 * localStorage ar.hudLayout ; sinon, compact en low poly, complet en réaliste.
 */
export type HudLayout = 'compact' | 'full';
export const HUD_LAYOUT_KEY = 'ar.hudLayout';
function readLayout(): HudLayout {
  try {
    const raw = new URLSearchParams(location.search).get('hud') ?? localStorage.getItem(HUD_LAYOUT_KEY);
    if (raw === 'compact' || raw === 'full') return raw;
  } catch {
    // Stockage indisponible : disposition du style.
  }
  return LOW_POLY ? 'compact' : 'full';
}
export const HUD_LAYOUT: HudLayout = typeof location === 'undefined' ? 'full' : readLayout();
// Crochet CSS du style graphique (:root[data-style="lowpoly"]), posé dès le chargement du module.
if (typeof document !== 'undefined') document.documentElement.dataset.style = GRAPHIC_STYLE;

/** HUD compact : panneau de détails ouvert (touche I ou bouton +), liste « À proximité » repliée. */
const DETAILS_KEY = 'ar.hudDetails';
const RIDERS_FOLDED_KEY = 'ar.hudRidersFolded';
function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Stockage indisponible : l'état ne survit pas au rechargement.
  }
}

/** Image du fond de carte et emprise qu'elle couvre (repère du monde, m). */
interface BaseTile {
  img: HTMLImageElement;
  ready: boolean;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface HudRider {
  id: string;
  name: string;
  distM: number;
  x: number;
  z: number;
  me: boolean;
  isAI: boolean;
  isGuest: boolean;
  color: string;
  /** Parle en ce moment dans le chat vocal. */
  speaking?: boolean;
  /** Coureur humain en ligne (peut recevoir un « Ride On »). */
  online?: boolean;
  /** Ami du joueur : pastille dorée dans « À proximité », anneau doré sur la carte. */
  friend?: boolean;
  /** Puissance rapportée au poids (W/kg), si connue. */
  wkg?: number;
  /** Nationalité (code ISO) : drapeau devant le nom. */
  nationality?: string;
  /** Cycliste d'ambiance : niveau, et ce que ça donne pour le joueur (rattrapé, suivable, trop fort). */
  ambient?: { level: string; follow: 'easy' | 'ok' | 'hard' };
  /** Kilomètres roulés pendant la sortie (réels pour les joueurs, simulés pour les cyclistes d'ambiance). */
  km?: number;
  /** Puissance (W) du moment. */
  watts?: number;
}

export interface HudState {
  watts3s: number;
  watts: number;
  hr?: number;
  cadence: number;
  speedKmh: number;
  distM: number;
  lapDistM: number;
  elapsedS: number;
  elevationGainM: number;
  gradePercent: number;
  avgWatts: number;
  np: number;
  ftp: number;
  gearLabel: string;
  gearIndex: number;
  gearCount: number;
  balanceLeft?: number;
  draftPct: number;
  /** Puissance économisée par l'aspiration (W). */
  draftW?: number;
  /** Écart à la roue du coureur juste devant (m), null : personne à portée. */
  wheelGapM?: number | null;
  /** Vent ressenti : vitesse (km/h), d'où il vient par rapport au coureur, et côté de l'abri (vent de côté). */
  wind?: { kmh: number; from: 'face' | 'dos' | 'gauche' | 'droite'; shelter: 'left' | 'right' | null };
  altitudeM?: number;
  lap: number;
  riders: HudRider[];
  segment?: { seg: RouteSegment; progress: number; elapsedS: number; recordS?: number | null; gainLeftM?: number };
  /** Prochain KOM ou sprint (moins de 600 m devant) : distance jusqu'au départ, record. */
  nextSegment?: { seg: RouteSegment; inM: number; recordS: number | null };
  /** Sortie de groupe : allure demandée (part de la FTP, null : libre) et puissance du groupe. */
  groupPace?: { ftpPct: number | null; watts: number };
  devices: Array<{ label: string; state: 'ok' | 'warn' | 'off' }>;
  /** Lieu traversé : commune la plus proche et, si on la connaît, la route. */
  place?: { town: string; road?: string };
  /** Monde ouvert : position du coureur (m) sur le chemin et carrefour à venir. */
  open?: { distM: number; road: string; junction: HudJunction | null };
  /** Prochain virage marqué (RouteTrack.nextTurn) : distance jusqu'à l'entrée, angle (°, positif = à droite). */
  turn?: { inM: number; angleDeg: number } | null;
}

/** Prochain carrefour en monde ouvert : sorties de gauche à droite, celle choisie surlignée. */
export interface HudJunction {
  inM: number;
  choices: Array<{ dir: 'left' | 'straight' | 'right' | 'back'; name: string; unpaved: boolean }>;
  selected: number;
  locked: boolean;
}

/**
 * Blocs du HUD que le coureur peut masquer (Réglages, « Affichage en sortie ») : tout le monde n'a
 * pas de ceinture cardio, de capteur de cadence ou de pédales double face.
 */
export const HUD_BLOCKS = [
  { id: 'hr', fr: 'Fréquence cardiaque', en: 'Heart rate' },
  { id: 'power', fr: 'Puissance', en: 'Power' },
  { id: 'cadence', fr: 'Cadence', en: 'Cadence' },
  { id: 'speed', fr: 'Vitesse', en: 'Speed' },
  { id: 'grade', fr: 'Pente', en: 'Gradient' },
  { id: 'time', fr: 'Temps', en: 'Time' },
  { id: 'dist', fr: 'Distance', en: 'Distance' },
  { id: 'gain', fr: 'Dénivelé', en: 'Elevation gain' },
  { id: 'avg', fr: 'Puissance moyenne', en: 'Average power' },
  { id: 'np', fr: 'NP', en: 'NP' },
  { id: 'draft', fr: 'Aspiration', en: 'Draft' },
  { id: 'wind', fr: 'Vent', en: 'Wind' },
  { id: 'alt', fr: 'Altitude', en: 'Altitude' },
  { id: 'lap', fr: 'Tours', en: 'Laps' },
  { id: 'gear', fr: 'Rapport', en: 'Gear' },
  { id: 'balance', fr: 'Équilibre gauche / droite', en: 'Left / right balance' },
  { id: 'zones', fr: 'Temps par zone (HUD compact)', en: 'Time in zones (compact HUD)' },
  { id: 'map', fr: 'Mini-carte', en: 'Mini-map' },
  { id: 'riders', fr: 'Coureurs à proximité', en: 'Nearby riders' },
  { id: 'profile', fr: 'Profil du parcours', en: 'Route profile' },
] as const;
export type HudBlockId = (typeof HUD_BLOCKS)[number]['id'];

const ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];

/** Compteur de puissance : arc de 270° gradué en zones (0 à 160 % de la FTP). */
const DIAL_R = 66;
const DIAL_C = 2 * Math.PI * DIAL_R;
const DIAL_L = DIAL_C * 0.75;
const DIAL_MAX = 1.6;
const DIAL_ZONES: Array<[number, number]> = [[0, 0.55], [0.55, 0.75], [0.75, 0.9], [0.9, 1.05], [1.05, 1.2], [1.2, 1.5], [1.5, 1.6]];
/** Repère de la FTP (100 %) sur l'arc : angle de l'écran, l'arc partant à 135°. */
const DIAL_FTP_ANGLE = ((135 + (1 / DIAL_MAX) * 270) * Math.PI) / 180;

const ico = (d: string) => `<svg class="ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  heart: ico('<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.600-9 9-9 9Z"/>'),
  cadence: ico('<path d="M21 12a9 9 0 1 1-3-6.700L21 8"/><path d="M21 3v5h-5"/>'),
  speed: ico('<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 14 4-5"/>'),
  grade: ico('<path d="m3 19 6-11 4 6 3-4 5 9Z"/>'),
  pin: ico('<path d="M12 21s7-6.200 7-11a7 7 0 0 0-14 0c0 4.800 7 11 7 11Z"/><circle cx="12" cy="10" r="2.500"/>'),
};
/** Noms des zones de puissance (Coggan). */
const ZONE_NAMES: Array<[string, string]> = [
  ['Récup', 'Recovery'],
  ['Endurance', 'Endurance'],
  ['Tempo', 'Tempo'],
  ['Seuil', 'Threshold'],
  ['VO2max', 'VO2max'],
  ['Anaérobie', 'Anaerobic'],
  ['Sprint', 'Sprint'],
];
/** Indice (0 à 6) de la zone de puissance. */
function zoneIndex(watts: number, ftp: number): number {
  const idx = ZONES.findIndex((z) => watts / Math.max(ftp, 1) < z);
  return idx === -1 ? 6 : idx;
}
function zoneLabel(watts: number, ftp: number, fr: boolean): string {
  const i = zoneIndex(watts, ftp);
  return `Z${i + 1} ${(ZONE_NAMES[i] as [string, string])[fr ? 0 : 1]}`;
}
function zoneColor(watts: number, ftp: number): string {
  const r = watts / Math.max(ftp, 1);
  const idx = ZONES.findIndex((z) => r < z);
  return `var(--z${idx === -1 ? 7 : idx + 1})`;
}

const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
function zoneColorHex(watts: number, ftp: number): string {
  const r = watts / Math.max(ftp, 1);
  const idx = ZONES.findIndex((z) => r < z);
  return ZONE_HEX[idx === -1 ? 6 : idx] as string;
}

const lastHtml = new WeakMap<HTMLElement, string>();
/** Remplace le contenu de `el` seulement s'il a changé (pas de reconstruction ni de mise en page inutiles). */
function setHtml(el: HTMLElement, html: string): void {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  el.innerHTML = html;
}
/** Canevas à la taille affichée (netteté, pas de déformation d'un bandeau très allongé) ; rien s'il est masqué. */
function fitCanvas(c: HTMLCanvasElement): void {
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(w * dpr);
  const H = Math.round(h * dpr);
  if (c.width !== W || c.height !== H) {
    c.width = W;
    c.height = H;
  }
}
/** Remplace le texte de `el` seulement s'il a changé. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Flèche de virage : tige vers le haut puis arc qui tourne de `angleDeg` (jusqu'à 180° pour une épingle),
 * pointe dans la direction de sortie. Coordonnées écran (y vers le bas) : tourner à droite fait croître le cap.
 */
export function turnArrowSvg(angleDeg: number, right: boolean): string {
  let x = 0;
  let y = -14;
  let h = -Math.PI / 2;
  const pts: Array<[number, number]> = [
    [0, 0],
    [x, y],
  ];
  const total = ((angleDeg * Math.PI) / 180) * (right ? 1 : -1);
  const n = 18;
  const arc = 20 + angleDeg * 0.05;
  for (let i = 0; i < n; i++) {
    h += total / n;
    x += (Math.cos(h) * arc) / n;
    y += (Math.sin(h) * arc) / n;
    pts.push([x, y]);
  }
  x += Math.cos(h) * 5;
  y += Math.sin(h) * 5;
  pts.push([x, y]);
  const tip: [number, number] = [x + Math.cos(h) * 8, y + Math.sin(h) * 8];
  const wing = (s: number): [number, number] => [tip[0] - Math.cos(h + s * 0.6) * 13, tip[1] - Math.sin(h + s * 0.6) * 13];
  const head = [wing(1), tip, wing(-1)];
  const all = [...pts, ...head];
  const pad = 7;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - minX;
  const hgt = Math.max(...ys) + pad - minY;
  const size = Math.max(w, hgt);
  const vb = `${(minX - (size - w) / 2).toFixed(1)} ${(minY - (size - hgt) / 2).toFixed(1)} ${size.toFixed(1)} ${size.toFixed(1)}`;
  const f = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  return `<svg class="tw-arrow" viewBox="${vb}" aria-hidden="true"><polyline points="${pts.map(f).join(' ')}" /><polygon points="${head.map(f).join(' ')}" /></svg>`;
}

/**
 * HUD compact (style low poly) : moitié moins de place que le cockpit complet. En haut à gauche, la
 * puissance et quatre petites tuiles ; en haut au centre, un seul bandeau (vitesse, distance, cardio, temps)
 * sous lequel ne s'empilent que les annonces du moment ; en haut à droite, mini-carte ronde, pente,
 * altitude et vent, coureurs proches ; en bas, un profil fin. Mêmes clés data-k que le cockpit complet
 * pour les valeurs partagées : `update` remplit l'un ou l'autre.
 */
function compactLayout(track: RouteTrack, attribution: string[]): string {
  const fr = getLang() === 'fr';
  const cell = (hud: string, k: string, label: string, value: string, unit: string, cls = '', avg = '') =>
    `<div class="cx-cell ${cls}" data-hud="${hud}"><span class="cx-l">${label}</span><span class="cx-v num"><b data-k="${k}">${value}</b>${unit ? `<small>${unit}</small>` : ''}</span>${avg ? `<span class="cx-avg num">${fr ? 'moy.' : 'avg'} <b data-k="${avg}">–</b></span>` : ''}</div>`;
  const mini = (hud: string, k: string, label: string, value: string, unit: string, cls = '') =>
    `<div class="cx-mini ${cls}" data-hud="${hud}"><span class="cx-l">${label}</span><span class="cx-v num"><b data-k="${k}">${value}</b>${unit ? `<small>${unit}</small>` : ''}</span></div>`;
  const zoneBars = ZONE_HEX.map((c) => `<i style="background:${c}"></i>`).join('');
  const zoneLabels = ZONE_HEX.map((_, i) => `<span>Z${i + 1}</span>`).join('');
  return `
      <div class="hud-center">
        <div class="panel cx-strip">
          ${cell('speed', 'speed', t('speed'), '0,0', 'km/h', 'cx-speed', 'avgSpeed')}
          ${cell('dist', 'dist', t('distance'), '0,00', 'km')}
          ${cell('hr', 'hr', fr ? 'Cardio' : 'HR', '--', 'bpm', 'hr', 'avgHr')}
          ${cell('time', 'time', t('time'), '0:00', '')}
        </div>
        <div class="panel junction hidden" data-k="junction"></div>
        <div class="panel turnwarn hidden" data-k="turn"></div>
        <div class="panel challenge hidden" data-k="challenge"></div>
        <div class="panel segment cx-seg hidden" data-k="segment">
          <div class="cx-seg-head"><b data-k="segBadge">KOM</b><span data-k="segWhen"></span><span class="cx-seg-name" data-k="segName"></span></div>
          <div class="cx-seg-cells" data-k="segCells">${[1, 2, 3, 4].map((i) => `<div><b class="num" data-k="segV${i}">–</b><small data-k="segL${i}"></small></div>`).join('')}</div>
          <div class="cx-seg-info" data-k="segInfo"></div>
          <div class="bar"><span data-k="segBar" style="width:0%"></span></div>
        </div>
        <div class="panel cx-draft hidden" data-k="draftBox" data-hud="draft"><span class="cx-l">${t('draft')}</span><div class="cx-bar"><span data-k="draftBar"></span></div><b class="num" data-k="draft">0 %</b><small class="cx-note" data-k="draftNote"></small></div>
        <div class="panel cx-pace hidden" data-k="paceBox"></div>
        <div class="toasts"></div>
      </div>
      <div class="hud-col hud-col-left">
        <div class="cx-pwr">
          <div class="panel cx-power" data-k="powerBox">
            <div class="cx-head"><span class="cx-l" data-hud="power">${t('power')} 3 s</span><button class="cx-more" data-k="moreBtn" tabindex="-1" aria-expanded="false" title="${fr ? 'Détails (I)' : 'Details (I)'}">+</button></div>
            <div class="cx-watts num" data-hud="power"><b data-k="watts">0</b><small>W</small></div>
            <div class="cx-zone" data-k="zone" data-hud="power">Z1</div>
            <div class="cx-grid">
              ${mini('power', 'wkg', 'W/kg', '0,0', '')}
              ${mini('avg', 'avg', fr ? 'Moyenne' : 'Average', '0', 'W')}
              ${mini('gain', 'gain', fr ? 'D+' : 'Gain', '0', 'm')}
              ${mini('cadence', 'cad', `${ICONS.cadence}${fr ? 'Cadence' : 'Cadence'}`, '0', fr ? 'tr/min' : 'rpm', 'cad')}
            </div>
          </div>
          <div class="panel gearbox cx-gear" data-hud="gear"><span class="cx-l">${t('gear')}</span><div class="value num" data-k="gear">34×17</div><div class="bars" data-k="gearbars"></div></div>
        </div>
        <div class="panel hud-left cx-details">
          <span class="k">${fr ? 'Instantanée' : 'Instant'}</span><span class="v num" data-k="wattsNow">0 W</span>
          <span class="k" data-hud="np">${t('np')}</span><span class="v num" data-k="np" data-hud="np">0 W</span>
          ${track.route.loop ? `<span class="k" data-hud="lap">${t('lap')}</span><span class="v num" data-k="lap" data-hud="lap">1</span>` : ''}
          <span class="k" data-hud="draft">${t('draft')}</span><span class="v num" data-k="draftAll" data-hud="draft">0 %</span>
        </div>
        <div class="panel balance hidden" data-k="balanceBox" data-hud="balance"><span class="cx-l">${t('balance')}</span><div class="num cx-bal" data-k="balance">50 / 50</div><div class="bar"><span data-k="balanceBar" style="width:50%"></span></div></div>
        <div class="hud-bl">
          <div class="voice-chip panel hidden" data-k="voice"></div>
          <div class="devices-chip" data-k="devices"></div>
          <div class="panel cx-zones" data-hud="zones"><div class="cx-zhead"><span class="cx-l">${fr ? 'Temps par zone' : 'Time in zones'}</span><b class="num" data-k="zoneTime"></b></div><div class="cx-zbars" data-k="zoneBars">${zoneBars}</div><div class="cx-zlab">${zoneLabels}</div></div>
        </div>
      </div>
      <div class="hud-col hud-col-right">
        <div class="panel minimap" data-hud="map"><canvas width="460" height="460"></canvas></div>
        <div class="panel hud-loc cx-loc hidden" data-k="loc"></div>
        <div class="panel cx-env">
          <div class="cx-grade" data-hud="grade"><span class="cx-l">${ICONS.grade}${fr ? 'Pente' : 'Grade'}</span><b class="num" data-k="grade">0,0 %</b></div>
          <div class="cx-envline"><span data-hud="alt">▲ <b class="num" data-k="alt">–</b></span><span data-hud="wind">${fr ? 'Vent' : 'Wind'} <b class="num" data-k="wind">–</b></span></div>
        </div>
        <div class="panel riders" data-k="riders" data-hud="riders"></div>
        <div class="chat" data-k="chat"><div class="chat-log" data-k="chatLog"></div><input class="chat-input hidden" data-k="chatInput" maxlength="200" /></div>
      </div>
      <div class="panel workout hidden" data-k="workout"><div class="row" style="justify-content:space-between"><b data-k="wName"></b><span class="num" data-k="wRemain"></span></div><div class="num" data-k="wTarget" style="font-size:30px;font-weight:800"></div><div class="num" data-k="wStep" style="color:var(--ar-muted);font-size:13px"></div><canvas width="900" height="90" data-k="wChart"></canvas></div>
      <div class="panel profile" data-hud="profile"><canvas width="1800" height="60"></canvas><span class="cx-togo num" data-k="togo"></span></div>
      <div class="panel climbpro hidden" data-k="climbpro"></div>
      <div class="attribution">${attribution.join(' · ')}</div>
    `;
}

/** HUD clair et lisible : puissance au centre, profil en bas, mini-carte et coureurs à droite. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly el: Record<string, HTMLElement> = {};
  private readonly profileCanvas: HTMLCanvasElement;
  private readonly mapCanvas: HTMLCanvasElement;
  /** Cardio moyen du bandeau compact : somme pondérée par le temps, temps compté, dernier temps vu. */
  private hrSum = 0;
  private hrTime = 0;
  private avgPrevT = 0;
  private places: readonly { name: string; kind: string; x: number; z: number }[] = [];
  /** Origine Lambert-93 du monde : active le fond de carte (Plan IGN) de la mini-carte. */
  private basemapOrigin: { x: number; y: number } | null = null;
  /** Fond de carte affiché (image chargée, emprise en repère du monde) et celui en cours de chargement. */
  private base: BaseTile | null = null;
  /** Calques fixes des canevas (profil, mini-carte), avec la clé qui les a produits. */
  private readonly layers = new Map<string, { canvas: HTMLCanvasElement; key: string }>();
  /** Altitudes extrêmes du profil (marges comprises), calculées une fois. */
  private profileRange: { min: number; max: number } | null = null;
  private baseLoading: BaseTile | null = null;
  private readonly track: RouteTrack;
  private readonly profile: Array<{ d: number; y: number }>;
  private readonly mapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly toasts: HTMLElement;
  /** Monde ouvert : réseau routier pour la mini-carte (profil et carte suivent le coureur). */
  private openGraph: RoadGraphData | null = null;
  /** Panneau « À proximité » : coureurs réels seulement (multijoueur) ou tous (IA comprises). */
  riderFilter: 'real' | 'all' = 'all';
  private lastJunction = '';
  /** Flèche de virage affichée (côté, angle arrondi) : le dessin n'est refait que s'il change. */
  private lastTurn = '';
  /** Montée en cours ou proche, façon ClimbPro. */
  private readonly climb: ClimbPanel;
  /** Disposition compacte (voir HUD_LAYOUT). */
  private readonly compact = HUD_LAYOUT === 'compact';
  /** HUD compact : panneau de détails ouvert, liste « À proximité » repliée. */
  private detailsOpen = false;
  private ridersFolded = false;
  /** HUD compact : puce du rapport affichée quelques secondes après un changement de vitesse. */
  private lastGearKey = '';
  private gearUntil = 0;
  /** HUD compact : puces des capteurs affichées au départ et à chaque changement, puis estompées. */
  private devicesKey = '';
  private devicesUntil = 0;
  /** HUD compact : jauge d'aspiration affichée (hystérésis pour ne pas clignoter). */
  private draftOn = false;
  /** Temps passé dans chaque zone de puissance (s), mis à jour d'après le chrono de la sortie. */
  private readonly zoneS = [0, 0, 0, 0, 0, 0, 0];
  private lastElapsed = -1;
  private zonesTick = -1;

  /** Passe le HUD en monde ouvert (profil glissant, carte locale avec les routes alentour). */
  setOpen(graph: RoadGraphData): void {
    this.openGraph = graph;
  }

  /** Clic sur la mini-carte (monde ouvert : ouvre la carte complète). */
  set onMapClick(fn: (() => void) | null) {
    const m = this.root.querySelector<HTMLElement>('.minimap');
    if (!m) return;
    m.classList.toggle('map-click', !!fn);
    m.title = fn ? (getLang() === 'fr' ? 'Carte complète : choisir où aller' : 'Full map: choose where to go') : '';
    m.onclick = fn ? () => fn() : null;
  }

  /** Destination du guidage (drapeau sur la mini-carte). */
  destination: { x: number; z: number } | null = null;

  /**
   * Fond de la mini-carte : image de tout le monde (mondes générés, `bounds` en repère du monde) à la
   * place du Plan IGN.
   */
  setMapImage(url: string, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const tile: BaseTile = { img: new Image(), ready: false, ...bounds };
    tile.img.onload = () => (tile.ready = true);
    tile.img.src = url;
    this.base = tile;
    this.fixedBase = true;
  }
  private fixedBase = false;

  constructor(root: HTMLElement, track: RouteTrack, attribution: string[]) {
    this.root = root;
    this.track = track;
    root.classList.toggle('compact', this.compact);
    root.classList.remove('cx-open');
    // Trois colonnes empilées en flex (centre, gauche, droite) : aucun panneau ne dépend de la
    // hauteur d'un autre, rien ne se chevauche quelle que soit la taille de la fenêtre.
    root.innerHTML = this.compact
      ? compactLayout(track, attribution)
      : `
      <div class="hud-center">
        <div class="hud-top">
          <div class="tile-col">
            <div class="tile hr" data-hud="hr"><div class="label">${ICONS.heart}${t('heartRate')}</div><div class="value num"><span data-k="hr">--</span><span class="unit">bpm</span></div></div>
            <div class="tile cad" data-hud="cadence"><div class="label">${ICONS.cadence}${t('cadence')}</div><div class="value num"><span data-k="cad">0</span><span class="unit">${getLang() === 'fr' ? 'tr/min' : 'rpm'}</span></div></div>
          </div>
          <div class="dial" data-k="powerBox" data-hud="power">
            <svg class="dial-svg" viewBox="0 0 160 160" aria-hidden="true">
              <g transform="rotate(135 80 80)">
                <circle class="dial-back" cx="80" cy="80" r="${DIAL_R}" stroke-dasharray="${DIAL_L.toFixed(1)} ${DIAL_C.toFixed(1)}"/>
                ${DIAL_ZONES.map(([lo, hi], i) => `<circle class="dial-zone" cx="80" cy="80" r="${DIAL_R}" stroke="${ZONE_HEX[i]}" stroke-dasharray="${(((hi - lo) / DIAL_MAX) * DIAL_L - 1.5).toFixed(1)} ${DIAL_C.toFixed(1)}" stroke-dashoffset="${((-lo / DIAL_MAX) * DIAL_L).toFixed(1)}"/>`).join('')}
                <circle class="dial-fill" data-k="dialFill" cx="80" cy="80" r="${DIAL_R}" stroke-dasharray="0.01 ${DIAL_C.toFixed(1)}"/>
              </g>
              <line class="dial-ftp" x1="${(80 + 58 * Math.cos(DIAL_FTP_ANGLE)).toFixed(1)}" y1="${(80 + 58 * Math.sin(DIAL_FTP_ANGLE)).toFixed(1)}" x2="${(80 + 77 * Math.cos(DIAL_FTP_ANGLE)).toFixed(1)}" y2="${(80 + 77 * Math.sin(DIAL_FTP_ANGLE)).toFixed(1)}"/>
            </svg>
            <div class="dial-in">
              <div class="label">${t('power')} 3 s</div>
              <div class="value num" data-k="watts">0</div>
              <div class="unit">W</div>
              <div class="sub num" data-k="wkg">0,0 W/kg</div>
            </div>
          </div>
          <div class="tile-col">
            <div class="tile spd" data-hud="speed"><div class="label">${ICONS.speed}${t('speed')}</div><div class="value num"><span data-k="speed">0,0</span><span class="unit">km/h</span></div></div>
            <div class="tile grade" data-hud="grade"><div class="label">${ICONS.grade}${getLang() === 'fr' ? 'Pente' : 'Grade'}</div><div class="value num" data-k="grade">0,0 %</div></div>
          </div>
        </div>
        <div class="panel hud-loc hidden" data-k="loc"></div>
        <div class="panel junction hidden" data-k="junction"></div>
        <div class="panel turnwarn hidden" data-k="turn"></div>
        <div class="panel challenge hidden" data-k="challenge"></div>
        <div class="panel segment hidden" data-k="segment"><div class="name" data-k="segName"></div><div class="num" data-k="segInfo"></div><div class="bar"><span data-k="segBar" style="width:0%"></span></div></div>
        <div class="toasts"></div>
      </div>
      <div class="hud-col hud-col-left">
        <div class="panel hud-left">
          <span class="k" data-hud="time">${t('time')}</span><span class="v num" data-k="time" data-hud="time">0:00</span>
          <span class="k" data-hud="dist">${t('distance')}</span><span class="v num" data-k="dist" data-hud="dist">0,00 km</span>
          <span class="k" data-hud="gain">${t('elevation')}</span><span class="v num" data-k="gain" data-hud="gain">0 m</span>
          <span class="k" data-hud="avg">${t('avgPower')}</span><span class="v num" data-k="avg" data-hud="avg">0 W</span>
          <span class="k" data-hud="np">${t('np')}</span><span class="v num" data-k="np" data-hud="np">0 W</span>
          <span class="k" data-hud="draft">${t('draft')}</span><span class="v num" data-k="draft" data-hud="draft">0 %</span>
          <span data-hud="draft"></span><span data-hud="draft"><div style="height:6px;width:110px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;margin-left:auto"><div data-k="draftBar" style="height:100%;width:0%;background:linear-gradient(90deg,#60a5fa,#22c55e)"></div></div></span>
          <span class="hud-note" data-k="draftNote" data-hud="draft"></span>
          <span class="k" data-hud="wind">${getLang() === 'fr' ? 'Vent' : 'Wind'}</span><span class="v num" data-k="wind" data-hud="wind">–</span>
          <span class="k" data-hud="alt">${getLang() === 'fr' ? 'Altitude' : 'Altitude'}</span><span class="v num" data-k="alt" data-hud="alt">–</span>
          ${track.route.loop ? `<span class="k" data-hud="lap">${t('lap')}</span><span class="v num" data-k="lap" data-hud="lap">1</span>` : ''}
        </div>
        <div class="hud-bl">
          <div class="voice-chip panel hidden" data-k="voice"></div>
          <div class="devices-chip" data-k="devices"></div>
          <div class="hud-drive">
            <div class="panel gearbox" data-hud="gear"><div class="label metric-label" style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('gear')}</div><div class="value num" data-k="gear">34×17</div><div class="bars" data-k="gearbars"></div></div>
            <div class="panel balance hidden" data-k="balanceBox" data-hud="balance"><div style="font-size:11px;color:var(--ar-muted);text-transform:uppercase;letter-spacing:.08em">${t('balance')}</div><div class="num" data-k="balance" style="font-size:20px;font-weight:700">50 / 50</div><div class="bar"><span data-k="balanceBar" style="width:50%"></span></div></div>
          </div>
        </div>
      </div>
      <div class="hud-col hud-col-right">
        <div class="panel minimap" data-hud="map"><canvas width="460" height="460"></canvas></div>
        <div class="panel riders" data-k="riders" data-hud="riders"></div>
        <div class="chat" data-k="chat"><div class="chat-log" data-k="chatLog"></div><input class="chat-input hidden" data-k="chatInput" maxlength="200" /></div>
      </div>
      <div class="panel workout hidden" data-k="workout"><div class="row" style="justify-content:space-between"><b data-k="wName"></b><span class="num" data-k="wRemain"></span></div><div class="num" data-k="wTarget" style="font-size:30px;font-weight:800"></div><div class="num" data-k="wStep" style="color:var(--ar-muted);font-size:13px"></div><canvas width="900" height="90" data-k="wChart"></canvas></div>
      <div class="panel profile" data-hud="profile"><canvas width="1800" height="160"></canvas></div>
      <div class="panel climbpro hidden" data-k="climbpro"></div>
      <div class="attribution">${attribution.join(' · ')}</div>
    `;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => (this.el[e.dataset.k as string] = e));
    (this.el.riders as HTMLElement).addEventListener('click', (ev) => {
      // Bouton cliqué : il rend le focus, sinon Espace ou Entrée (commandes du jeu) le réactiveraient.
      (ev.target as HTMLElement).closest<HTMLElement>('button')?.blur();
      if ((ev.target as HTMLElement).closest('[data-rfilter]')) {
        this.riderFilter = this.riderFilter === 'real' ? 'all' : 'real';
        return;
      }
      const id = (ev.target as HTMLElement).closest<HTMLElement>('[data-rideon]')?.dataset.rideon;
      if (id) {
        this.onRideOn?.(id);
        return;
      }
      if (this.compact && (ev.target as HTMLElement).closest('[data-rfold]')) {
        this.ridersFolded = !this.ridersFolded;
        writeFlag(RIDERS_FOLDED_KEY, this.ridersFolded);
        (this.el.riders as HTMLElement).classList.toggle('cx-folded', this.ridersFolded);
      }
    });
    if (this.compact) {
      this.ridersFolded = readFlag(RIDERS_FOLDED_KEY);
      (this.el.riders as HTMLElement).classList.toggle('cx-folded', this.ridersFolded);
      this.toggleDetails(readFlag(DETAILS_KEY));
      (this.el.moreBtn as HTMLElement).addEventListener('click', (ev) => {
        (ev.currentTarget as HTMLElement).blur();
        this.toggleDetails();
      });
      // Touche I : détails de la sortie. L'écouteur se retire quand un autre HUD a remplacé celui-ci.
      const watts = this.el.watts as HTMLElement;
      const onKey = (ev: KeyboardEvent) => {
        if (!root.contains(watts)) {
          window.removeEventListener('keydown', onKey);
          return;
        }
        const tgt = ev.target as HTMLElement | null;
        if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
        if ((ev.key === 'i' || ev.key === 'I') && !ev.ctrlKey && !ev.metaKey && !ev.altKey && this.visible) this.toggleDetails();
      };
      window.addEventListener('keydown', onKey);
    }
    this.profileCanvas = root.querySelector('.profile canvas') as HTMLCanvasElement;
    this.mapCanvas = root.querySelector('.minimap canvas') as HTMLCanvasElement;
    this.toasts = root.querySelector('.toasts') as HTMLElement;
    this.profile = track.profile(600);
    this.climb = new ClimbPanel(this.el.climbpro as HTMLElement, track, () => !!this.openGraph);
    // L'appli compagnon affiche son propre bilan au sommet : pas de relais.
    this.climb.onSummit = (text) => this.toast(text, false, false);
    const pts = track.route.points;
    this.mapBounds = {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minZ: Math.min(...pts.map((p) => p.z)),
      maxZ: Math.max(...pts.map((p) => p.z)),
    };
  }

  /** Panneau du défi KOM : élan, puis chrono et écart avec le fantôme du record (null = masqué). */
  setChallenge(c: null | { name: string; phase: 'runup' | 'climbing' | 'done'; toGoM: number; elapsedS: number; recordS: number | null; deltaS: number | null; progress: number }): void {
    const box = this.el.challenge as HTMLElement;
    if (!c) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    const fr = getLang() === 'fr';
    const rec = c.recordS === null ? (fr ? 'pas de record' : 'no record') : `${fr ? 'record' : 'best'} ${fmtTime(c.recordS)}`;
    const delta =
      c.deltaS === null ? '' : `<span class="num" style="color:${c.deltaS <= 0 ? '#22c55e' : '#ef4444'}">${c.deltaS <= 0 ? '−' : '+'}${Math.abs(c.deltaS).toFixed(1).replace('.', fr ? ',' : '.')} s</span>`;
    const main =
      c.phase === 'runup'
        ? `${fr ? 'Pied de la côte dans' : 'Climb starts in'} <b class="num">${Math.round(c.toGoM)} m</b>`
        : `<b class="num">${fmtTime(c.elapsedS)}</b> ${delta} <span class="num" style="color:var(--ar-muted)">· ${Math.round(c.toGoM)} m</span>`;
    setHtml(box, `<div class="ch-head"><b>${fr ? 'Défi' : 'Challenge'}</b><span>${c.name.replace(/[<>&]/g, '')} · ${rec}</span></div><div class="ch-main">${main}</div><div class="bar"><span style="width:${(c.progress * 100).toFixed(1)}%"></span></div>`);
  }

  /** Panneau de séance structurée (null = masqué). */
  setWorkout(
    w: null | {
      name: string;
      targetWatts: number | null;
      watts3s: number;
      stepIndex: number;
      stepCount: number;
      stepRemainingS: number;
      remainingS: number;
      next?: string;
      profile: Array<[number, number, number, number]>;
      elapsedS: number;
      totalS: number;
    },
  ): void {
    const box = this.el.workout as HTMLElement;
    if (!w) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    (this.el.wName as HTMLElement).textContent = w.name;
    (this.el.wRemain as HTMLElement).textContent = fmtTime(w.remainingS);
    const delta = w.targetWatts ? w.watts3s - w.targetWatts : 0;
    const tgt = this.el.wTarget as HTMLElement;
    tgt.textContent = w.targetWatts ? `${Math.round(w.targetWatts)} W` : 'Libre';
    tgt.style.color = !w.targetWatts ? '#f5f7fa' : Math.abs(delta) < w.targetWatts * 0.05 ? '#22c55e' : delta > 0 ? '#f97316' : '#60a5fa';
    (this.el.wStep as HTMLElement).textContent = `Étape ${Math.min(w.stepIndex + 1, w.stepCount)}/${w.stepCount} · ${fmtTime(w.stepRemainingS)}${w.next ? ` · ensuite ${w.next}` : ''}`;
    const c = this.el.wChart as HTMLCanvasElement;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, c.width, c.height);
    const maxW = Math.max(...w.profile.map((p) => Math.max(p[2], p[3]))) * 1.1;
    const X = (t: number) => (t / w.totalS) * c.width;
    const Y = (p: number) => c.height - (p / maxW) * c.height;
    for (const [t0, d, a, b] of w.profile) {
      ctx.fillStyle = zoneColorHex((a + b) / 2, this.ftp);
      ctx.globalAlpha = t0 + d < w.elapsedS ? 0.45 : 0.9;
      ctx.beginPath();
      ctx.moveTo(X(t0), c.height);
      ctx.lineTo(X(t0), Y(a));
      ctx.lineTo(X(t0 + d), Y(b));
      ctx.lineTo(X(t0 + d), c.height);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(X(w.elapsedS) - 2, 0, 4, c.height);
  }

  /** Message de chat (les 6 derniers restent affichés, puis s'estompent). */
  addChat(name: string, text: string): void {
    this.onChat?.(name, text);
    const log = this.el.chatLog as HTMLElement;
    const line = document.createElement('div');
    line.className = 'chat-line';
    const b = document.createElement('b');
    b.textContent = `${name} : `;
    line.append(b, document.createTextNode(text));
    log.appendChild(line);
    while (log.childElementCount > 6) log.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), 20000);
  }

  /** Ouvre la saisie du chat (touche T) ; Entrée envoie, Échap annule. */
  openChat(onSend: (text: string) => void): void {
    const input = this.el.chatInput as HTMLInputElement;
    input.classList.remove('hidden');
    input.value = '';
    input.focus();
    const close = () => {
      input.classList.add('hidden');
      input.onkeydown = null;
      input.blur();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) onSend(v);
        close();
      } else if (e.key === 'Escape') close();
    };
  }

  /**
   * État du micro du chat vocal (null = pas de voix). `discordUrl` : salon Discord de repli,
   * proposé quand la voix intégrée (LiveKit) est indisponible.
   */
  setVoice(state: null | { connected: boolean; micOn: boolean; detail?: string; discordUrl?: string | null }): void {
    const chip = this.el.voice as HTMLElement;
    if (!state) {
      chip.classList.add('hidden');
      return;
    }
    chip.classList.remove('hidden');
    chip.textContent = !state.connected ? `🎙 ${state.detail ?? 'voix indisponible'}` : state.micOn ? '🎙 micro ouvert (V)' : '🔇 micro coupé (V)';
    if (!state.connected && state.discordUrl) {
      const a = document.createElement('a');
      a.className = 'discord-link';
      a.href = state.discordUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'Rejoindre le salon Discord';
      chip.append(' · ', a);
    }
  }

  /** Clic sur 👍 dans la liste des coureurs. */
  onRideOn?: (riderId: string) => void;

  /** Annonces et messages de chat, relayés vers l'appli compagnon. */
  onToast?: (text: string) => void;
  onChat?: (name: string, text: string) => void;

  /** FTP courante (couleurs des zones). */
  ftp = 250;

  /** Blocs masqués par le coureur (voir HUD_BLOCKS). */
  setHidden(ids: readonly string[]): void {
    const off = new Set(ids);
    this.root.querySelectorAll<HTMLElement>('[data-hud]').forEach((e) => e.classList.toggle('hud-off', off.has(e.dataset.hud as string)));
  }

  /**
   * HUD compact : ouvre ou ferme les détails (NP, tours, puissance instantanée, rapport, équilibre G/D),
   * repliés par défaut. Touche I ou bouton + du bloc puissance ; l'état est mémorisé.
   */
  toggleDetails(open = !this.detailsOpen): void {
    if (!this.compact) return;
    this.detailsOpen = open;
    this.root.classList.toggle('cx-open', open);
    const b = this.el.moreBtn;
    if (b) {
      b.textContent = open ? '−' : '+';
      b.setAttribute('aria-expanded', String(open));
    }
    writeFlag(DETAILS_KEY, open);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Annonce temporaire au centre ; `small` : discrète (passage d'un lacet) ; `relay` : aussi sur l'appli compagnon. */
  toast(text: string, small = false, relay = !small): void {
    if (relay) this.onToast?.(text);
    const d = document.createElement('div');
    d.className = small ? 'panel toast small' : 'panel toast';
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  update(s: HudState, massKg: number): void {
    const e = this.el;
    const nf1 = (v: number) => v.toFixed(1).replace('.', ',');
    const cx = this.compact;
    (e.watts as HTMLElement).textContent = String(Math.round(s.watts3s));
    const zc = zoneColorHex(s.watts3s, s.ftp);
    // Arc du compteur (cockpit complet) : proportion de la FTP, couleur de la zone en cours.
    const dial = e.dialFill as unknown as SVGElement | undefined;
    if (dial) {
      const dialFrac = Math.min(DIAL_MAX, Math.max(0, s.watts3s / Math.max(s.ftp, 1))) / DIAL_MAX;
      dial.setAttribute('stroke-dasharray', `${Math.max(0.01, dialFrac * DIAL_L).toFixed(1)} ${DIAL_C.toFixed(1)}`);
      dial.setAttribute('stroke', zc);
    }
    (e.powerBox as HTMLElement).style.setProperty('--zone', zc);
    const fr = getLang() === 'fr';
    if (cx) {
      (e.wkg as HTMLElement).textContent = nf1(s.watts3s / massKg);
      setText(e.zone as HTMLElement, zoneLabel(s.watts3s, s.ftp, fr));
      (e.wattsNow as HTMLElement).textContent = `${Math.round(s.watts)} W`;
    } else (e.wkg as HTMLElement).textContent = `${nf1(s.watts3s / massKg)} W/kg · ${zoneLabel(s.watts3s, s.ftp, fr)}`;
    (e.hr as HTMLElement).textContent = s.hr ? String(Math.round(s.hr)) : cx ? '--' : 'N/A';
    (e.cad as HTMLElement).textContent = String(Math.round(s.cadence));
    (e.speed as HTMLElement).textContent = nf1(s.speedKmh);
    const g = s.gradePercent;
    (e.grade as HTMLElement).textContent = `${g >= 0 ? '' : '−'}${nf1(Math.abs(g))} %`;
    (e.grade as HTMLElement).style.color = g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#eab308' : g < -1 ? '#60a5fa' : '#f5f7fa';
    (e.time as HTMLElement).textContent = fmtTime(s.elapsedS);
    // Moyennes du bandeau compact : vitesse (distance / temps) et cardio (moyenné dans le temps, capteur présent).
    if (cx) {
      const dtS = Math.max(0, s.elapsedS - this.avgPrevT);
      this.avgPrevT = s.elapsedS;
      if (s.hr && dtS < 5) {
        this.hrSum += s.hr * dtS;
        this.hrTime += dtS;
      }
      const avgSpeed = s.elapsedS > 5 ? (s.distM / s.elapsedS) * 3.6 : s.speedKmh;
      setText(e.avgSpeed as HTMLElement, nf1(avgSpeed));
      setText(e.avgHr as HTMLElement, this.hrTime > 3 ? String(Math.round(this.hrSum / this.hrTime)) : '–');
    }
    // Bandeau compact : unités à part, en petit.
    const km = (s.distM / 1000).toFixed(2).replace('.', ',');
    (e.dist as HTMLElement).textContent = cx ? km : `${km} km`;
    (e.gain as HTMLElement).textContent = cx ? String(Math.round(s.elevationGainM)) : `${Math.round(s.elevationGainM)} m`;
    (e.avg as HTMLElement).textContent = cx ? String(Math.round(s.avgWatts)) : `${Math.round(s.avgWatts)} W`;
    (e.np as HTMLElement).textContent = `${Math.round(s.np)} W`;
    // Aspiration : watts économisés et part de la résistance de l'air en moins, roue de devant, abri par vent de côté.
    const draftTxt = s.draftW !== undefined && s.draftPct >= 1 ? `−${Math.round(s.draftW)} W · ${Math.round(s.draftPct)} %` : `${Math.round(s.draftPct)} %`;
    (e.draft as HTMLElement).textContent = draftTxt;
    (e.draftBar as HTMLElement).style.width = `${Math.min(100, (s.draftPct / 50) * 100).toFixed(0)}%`;
    if (cx) {
      (e.draftAll as HTMLElement).textContent = draftTxt;
      // Jauge sous le bandeau seulement quand on profite vraiment d'une roue.
      this.draftOn = this.draftOn ? s.draftPct >= 1.5 : s.draftPct >= 4;
      (e.draftBox as HTMLElement).classList.toggle('hidden', !this.draftOn);
    }
    if (s.wheelGapM !== undefined) {
      const w = s.wind;
      const side = w?.shelter ? (fr ? ` · abri à ${w.shelter === 'left' ? 'gauche' : 'droite'} de la roue` : ` · shelter on the ${w.shelter} of the wheel`) : '';
      (e.draftNote as HTMLElement).textContent =
        s.wheelGapM === null ? (fr ? 'Personne devant' : 'Nobody ahead') + side : `${fr ? 'Roue devant à' : 'Wheel ahead at'} ${nf1(s.wheelGapM)} m${side}`;
    }
    if (s.wind) {
      const from = cx
        ? fr
          ? { face: 'de face', dos: 'de dos', gauche: 'côté g.', droite: 'côté d.' }[s.wind.from]
          : { face: 'head', dos: 'tail', gauche: 'left', droite: 'right' }[s.wind.from]
        : fr
          ? { face: 'de face', dos: 'de dos', gauche: 'de gauche', droite: 'de droite' }[s.wind.from]
          : { face: 'head', dos: 'tail', gauche: 'from left', droite: 'from right' }[s.wind.from];
      (e.wind as HTMLElement).textContent = s.wind.kmh < 2 ? (fr ? 'calme' : 'calm') : `${Math.round(s.wind.kmh)} km/h ${from}`;
    }
    if (s.altitudeM !== undefined) (e.alt as HTMLElement).textContent = `${Math.round(s.altitudeM)} m`;
    // pas de compteur de tours sur un itinéraire aller simple
    if (e.lap) e.lap.textContent = String(s.lap);
    (e.gear as HTMLElement).textContent = s.gearLabel;
    const bars = e.gearbars as HTMLElement;
    if (bars.childElementCount !== s.gearCount) bars.innerHTML = '<i></i>'.repeat(s.gearCount);
    Array.from(bars.children).forEach((c, i) => c.classList.toggle('on', i <= s.gearIndex));
    if (cx) {
      // Puce du rapport : 3 s après chaque changement (pas au départ), en permanence avec les détails.
      const now = performance.now();
      const gearKey = `${s.gearIndex}|${s.gearLabel}`;
      if (this.lastGearKey && gearKey !== this.lastGearKey) this.gearUntil = now + 3000;
      this.lastGearKey = gearKey;
      (bars.parentElement as HTMLElement).classList.toggle('cx-show', now < this.gearUntil);
    }
    const bb = e.balanceBox as HTMLElement;
    if (s.balanceLeft !== undefined) {
      bb.classList.remove('hidden');
      (e.balance as HTMLElement).textContent = `${Math.round(s.balanceLeft)} / ${Math.round(100 - s.balanceLeft)}`;
      (e.balanceBar as HTMLElement).style.width = `${s.balanceLeft}%`;
    } else bb.classList.add('hidden');

    const segEl = e.segment as HTMLElement;
    const mmss = (v: number) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
    const recordTxt = (r: number | null | undefined) => (r ? `${fr ? 'record' : 'best'} ${mmss(r)}` : fr ? 'premier passage : ton temps deviendra ton fantôme' : 'first attempt: your time becomes your ghost');
    const segLabel = (seg: RouteSegment) => (seg.kind === 'kom' ? `${t('kom')} ${climbCategoryLabel(climbCategory(seg), fr)}` : t('sprint'));
    if (cx && (s.segment || s.nextSegment)) {
      // Façon NCT : bandeau rouge (KOM) ou vert (sprint) ; à l'approche « dans 98 m » et la fiche du segment,
      // en cours chrono, restant, D+ restant (ou vitesse) et temps estimé à l'arrivée.
      const live = s.segment;
      const seg = (live?.seg ?? s.nextSegment?.seg) as RouteSegment;
      const len = seg.endM - seg.startM;
      segEl.classList.remove('hidden');
      segEl.classList.toggle('sprint', seg.kind === 'sprint');
      segEl.classList.toggle('live', !!live);
      setText(e.segBadge as HTMLElement, segLabel(seg));
      setText(e.segName as HTMLElement, seg.name);
      (e.segCells as HTMLElement).classList.toggle('hidden', !live);
      (e.segBar as HTMLElement).parentElement?.classList.toggle('hidden', !live);
      if (live) {
        setText(e.segWhen as HTMLElement, fr ? 'en cours' : 'live');
        const remain = len * (1 - live.progress);
        const eta = live.elapsedS + remain / Math.max(s.speedKmh / 3.6, 1);
        const cells: Array<[string, string]> = [
          [fmtTime(live.elapsedS), fr ? 'chrono' : 'time'],
          [remain >= 1000 ? `${(remain / 1000).toFixed(2).replace('.', ',')} km` : `${Math.round(remain)} m`, fr ? 'restant' : 'to go'],
          seg.kind === 'kom' ? [`${Math.round(Math.max(0, live.gainLeftM ?? 0))} m`, fr ? 'D+ restant' : 'climb left'] : [`${nf1(s.speedKmh)}`, 'km/h'],
          [fmtTime(eta), fr ? 'estimé' : 'estimate'],
        ];
        cells.forEach(([v, l], i) => {
          setText(e[`segV${i + 1}`] as HTMLElement, v);
          setText(e[`segL${i + 1}`] as HTMLElement, l);
        });
        setText(e.segInfo as HTMLElement, recordTxt(live.recordS));
        (e.segBar as HTMLElement).style.width = `${(live.progress * 100).toFixed(1)}%`;
      } else if (s.nextSegment) {
        setText(e.segWhen as HTMLElement, `${fr ? 'dans' : 'in'} ${Math.max(0, Math.round(s.nextSegment.inM))} m`);
        const lenTxt = len >= 1000 ? `${(len / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(len)} m`;
        const grade = seg.kind === 'kom' ? ` · ${nf1(seg.avgGrade)} %` : '';
        const rec = s.nextSegment.recordS ? recordTxt(s.nextSegment.recordS) : fr ? 'premier passage' : 'first attempt';
        setText(e.segInfo as HTMLElement, `${lenTxt}${grade} · ${rec}`);
      }
    } else if (s.segment) {
      segEl.classList.remove('hidden');
      segEl.classList.toggle('sprint', s.segment.seg.kind === 'sprint');
      (e.segName as HTMLElement).textContent = `${s.segment.seg.kind === 'kom' ? `${t('kom')} (${climbCategoryLabel(climbCategory(s.segment.seg), fr)})` : t('sprint')} · ${s.segment.seg.name}`;
      const remain = (s.segment.seg.endM - s.segment.seg.startM) * (1 - s.segment.progress);
      (e.segInfo as HTMLElement).textContent = `${fmtTime(s.segment.elapsedS)} · ${Math.round(remain)} m`;
      (e.segBar as HTMLElement).style.width = `${(s.segment.progress * 100).toFixed(1)}%`;
    } else segEl.classList.add('hidden');
    const paceBox = e.paceBox as HTMLElement | undefined;
    if (paceBox) {
      paceBox.classList.toggle('hidden', !s.groupPace);
      if (s.groupPace)
        setText(paceBox, s.groupPace.ftpPct !== null ? `${fr ? 'Allure du groupe' : 'Group pace'} : ${Math.round(s.groupPace.ftpPct * 100)} % ${fr ? 'de ta FTP' : 'of your FTP'} · ${Math.round(s.groupPace.watts)} W` : `${fr ? 'Allure du groupe' : 'Group pace'} : ${fr ? 'libre' : 'free'} · ${Math.round(s.groupPace.watts)} W`);
    }

    const loc = e.loc as HTMLElement;
    const placeKey = s.place ? `${s.place.town}|${s.place.road ?? ''}` : '';
    if (loc.dataset.k2 !== placeKey) {
      loc.dataset.k2 = placeKey;
      loc.classList.toggle('hidden', !s.place);
      if (s.place) loc.innerHTML = `${ICONS.pin}<b>${s.place.town.replace(/[<>&]/g, '')}</b>${s.place.road ? `<span>${s.place.road.replace(/[<>&]/g, '')}</span>` : ''}`;
    }

    // Reconstruits seulement s'ils ont changé (10 fois par seconde sinon, boutons compris).
    const devHtml = s.devices.map((d) => `<div class="${d.state}">${d.label}</div>`).join('');
    setHtml(e.devices as HTMLElement, devHtml);
    if (cx) {
      // Capteurs : affichés au départ et à chaque changement (connexion, consigne du simulateur) pendant
      // 8 s, en permanence tant qu'un capteur est coupé ; estompés sinon.
      const now = performance.now();
      if (devHtml !== this.devicesKey) {
        this.devicesKey = devHtml;
        this.devicesUntil = now + 8000;
      }
      (e.devices as HTMLElement).classList.toggle('cx-faded', now >= this.devicesUntil && !s.devices.some((d) => d.state === 'off'));
    }

    setHtml(e.riders as HTMLElement, cx ? this.nearbyCompactHtml(s) : this.nearbyHtml(s));
    if (cx) {
      this.updateZones(s);
      this.updateToGo(s, fr);
      fitCanvas(this.profileCanvas);
    }

    this.drawJunction(s);
    this.drawTurn(s);
    // Montée en cours ou proche : le panneau ClimbPro prend la place du profil du parcours.
    const climbing = this.climb.update(this.openGraph && s.open ? s.open.distM : s.lapDistM, s.elapsedS);
    this.root.classList.toggle('climbing', climbing);
    if (this.openGraph && s.open) {
      this.drawOpenProfile(s, s.open.distM);
      this.drawOpenMap(s, s.open.distM);
    } else {
      this.drawProfile(s);
      this.drawMap(s);
    }
  }

  /** HUD compact : temps cumulé par zone de puissance (barres rafraîchies chaque seconde), zone en cours. */
  private updateZones(s: HudState): void {
    const z = zoneIndex(s.watts3s, s.ftp);
    const dt = s.elapsedS - this.lastElapsed;
    if (this.lastElapsed >= 0 && dt > 0 && dt < 5) this.zoneS[z] = (this.zoneS[z] as number) + dt;
    this.lastElapsed = s.elapsedS;
    const tick = Math.floor(s.elapsedS);
    if (tick === this.zonesTick) return;
    this.zonesTick = tick;
    const max = Math.max(...this.zoneS, 1);
    const bars = this.el.zoneBars as HTMLElement;
    Array.from(bars.children).forEach((b, i) => {
      const sec = this.zoneS[i] as number;
      (b as HTMLElement).style.height = `${Math.max(6, (sec / max) * 100).toFixed(0)}%`;
      b.classList.toggle('on', i === z);
      (b as HTMLElement).title = `Z${i + 1} · ${fmtTime(sec)}`;
    });
    setText(this.el.zoneTime as HTMLElement, `Z${z + 1} · ${fmtTime(this.zoneS[z] as number)}`);
  }

  /** HUD compact : distance restante sur le profil (arrivée, ou fin du tour sur une boucle ; rien en monde ouvert). */
  private updateToGo(s: HudState, fr: boolean): void {
    let txt = '';
    if (!this.openGraph) {
      const left = Math.max(0, this.track.length - s.lapDistM);
      const d = left < 1000 ? `${Math.round(left / 10) * 10} m` : `${(left / 1000).toFixed(1).replace('.', fr ? ',' : '.')} km`;
      txt = this.track.route.loop ? `${fr ? 'Fin du tour' : 'Lap ends in'} ${d}` : `${fr ? 'Arrivée' : 'Finish'} ${d}`;
    }
    setText(this.el.togo as HTMLElement, txt);
  }

  /** Calque fixe `name` de taille w × h, redessiné par `draw` seulement quand sa clé ou sa taille change. */
  private cached(name: string, w: number, h: number, key: string, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    let l = this.layers.get(name);
    if (!l || l.key !== key || l.canvas.width !== w || l.canvas.height !== h) {
      const canvas = l?.canvas ?? document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      g.clearRect(0, 0, w, h);
      draw(g);
      l = { canvas, key };
      this.layers.set(name, l);
    }
    return l.canvas;
  }

  private drawProfile(s: HudState): void {
    const c = this.profileCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    this.profileRange ??= (() => {
      const ys = this.profile.map((p) => p.y);
      return { min: Math.min(...ys) - 5, max: Math.max(...ys) + 5 };
    })();
    const { min: minY, max: maxY } = this.profileRange;
    const L = this.track.length;
    const X = (d: number) => (d / L) * w;
    const m = this.profileMetrics(h);
    const Y = (y: number) => h - m.pb - ((y - minY) / (maxY - minY)) * (h - m.pb - m.pt);
    // Fond fixe (segments, profil coloré, tracé) dessiné une fois : seuls les coureurs changent.
    const still = this.cached('profile', w, h, '', (g) => {
      // Segments KOM / sprint en arrière-plan.
      for (const seg of this.track.route.segments) {
        g.fillStyle = seg.kind === 'kom' ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)';
        g.fillRect(X(seg.startM), 0, X(seg.endM) - X(seg.startM), h);
      }
      // Profil coloré selon la pente.
      for (let i = 1; i < this.profile.length; i++) {
        const a = this.profile[i - 1] as { d: number; y: number };
        const b = this.profile[i] as { d: number; y: number };
        const grade = ((b.y - a.y) / Math.max(b.d - a.d, 1)) * 100;
        g.fillStyle = grade > 6 ? '#ef4444' : grade > 3 ? '#f97316' : grade > 1 ? '#eab308' : grade < -1 ? '#3b82f6' : '#64748b';
        g.beginPath();
        g.moveTo(X(a.d), h);
        g.lineTo(X(a.d), Y(a.y));
        g.lineTo(X(b.d), Y(b.y));
        g.lineTo(X(b.d), h);
        g.closePath();
        g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = m.line;
      g.beginPath();
      this.profile.forEach((p, i) => (i ? g.lineTo(X(p.d), Y(p.y)) : g.moveTo(X(p.d), Y(p.y))));
      g.stroke();
    });
    ctx.drawImage(still, 0, 0);
    // Coureurs (le mien en dernier, par-dessus, avec un trait vertical sur le profil compact).
    const me = this.compact ? s.riders.find((r) => r.me) : undefined;
    for (const r of me ? [...s.riders.filter((o) => !o.me), me] : s.riders) {
      const d = this.track.wrap(r.distM);
      const y = this.track.sample(d).y;
      if (r.me && this.compact) {
        ctx.fillStyle = 'rgba(255,210,63,0.55)';
        ctx.fillRect(X(d) - m.line / 2, 0, m.line, h);
      }
      ctx.fillStyle = r.me ? '#ffd23f' : r.color;
      ctx.beginPath();
      ctx.arc(X(d), Y(y), r.me ? m.rMe : m.r, 0, Math.PI * 2);
      ctx.fill();
      if (r.me) {
        ctx.strokeStyle = '#0a0e16';
        ctx.lineWidth = m.ring;
        ctx.stroke();
      }
    }
  }

  /**
   * Marges et tailles du profil : celles du cockpit complet (canevas 1800 × 160), ou proportionnelles à
   * la hauteur pour le bandeau fin du HUD compact (canevas à la taille affichée).
   */
  private profileMetrics(h: number): { pb: number; pt: number; line: number; rMe: number; r: number; ring: number } {
    if (!this.compact) return { pb: 8, pt: 16, line: 2, rMe: 9, r: 6, ring: 3 };
    return { pb: h * 0.1, pt: h * 0.22, line: Math.max(1.5, h * 0.035), rMe: Math.max(4, h * 0.15), r: Math.max(3, h * 0.1), ring: Math.max(1.5, h * 0.045) };
  }

  /** Active le fond de carte (Plan IGN, Lambert-93) de la mini-carte ; son attribution rejoint celle du bas d'écran. */
  setBasemap(origin: { x: number; y: number }): void {
    this.basemapOrigin = origin;
    const attr = this.root.querySelector('.attribution');
    if (attr && !attr.textContent?.includes(BASEMAP_ATTRIBUTION)) attr.textContent = `${attr.textContent ? `${attr.textContent} · ` : ''}${BASEMAP_ATTRIBUTION}`;
  }

  /** Charge (une fois) le fond couvrant l'emprise demandée, tant que le courant ne la couvre pas assez. */
  private ensureBase(area: { minX: number; minZ: number; maxX: number; maxZ: number }, need: { minX: number; minZ: number; maxX: number; maxZ: number }, px: number): void {
    const o = this.basemapOrigin;
    if (!o || this.fixedBase) return;
    const covers = (t: BaseTile | null) => !!t && t.minX <= need.minX && t.maxX >= need.maxX && t.minZ <= need.minZ && t.maxZ >= need.maxZ;
    if (covers(this.base) || (this.baseLoading && covers(this.baseLoading))) return;
    const tile: BaseTile = { img: new Image(), ready: false, ...area };
    // Plan IGN : E = origine.x + x, N = origine.y − z (z croît vers le sud).
    tile.img.onload = () => {
      tile.ready = true;
      if (this.baseLoading === tile) {
        this.base = tile;
        this.baseLoading = null;
      }
    };
    tile.img.onerror = () => {
      if (this.baseLoading === tile) this.baseLoading = null;
    };
    this.baseLoading = tile;
    tile.img.src = basemapUrl({ minE: o.x + area.minX, minN: o.y - area.maxZ, maxE: o.x + area.maxX, maxN: o.y - area.minZ }, px);
  }

  /** Dessine le fond de carte sous les tracés (assombri), si chargé. */
  private drawBase(ctx: CanvasRenderingContext2D, P: (x: number, z: number) => [number, number]): void {
    const t = this.base;
    if (!t?.ready) return;
    const [x0, y0] = P(t.minX, t.minZ);
    const [x1, y1] = P(t.maxX, t.maxZ);
    const hasFilter = (ctx as unknown as { filter?: string }).filter !== undefined;
    ctx.save();
    // HUD compact : plan IGN en couleurs (forêts, champs, villages), à peine ravivé ; sinon assombri.
    ctx.globalAlpha = this.compact ? 1 : 0.8;
    if (hasFilter) ctx.filter = this.compact ? 'saturate(1.25) contrast(1.1) brightness(0.82)' : 'invert(0.9) hue-rotate(180deg) grayscale(0.9) brightness(1.05) contrast(0.85)';
    ctx.drawImage(t.img, x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
    if (!hasFilter && !this.compact) {
      ctx.fillStyle = 'rgba(10, 14, 22, 0.55)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  /** Points cardinaux au bord de la mini-carte ronde (nord en haut, en rouge). */
  private drawCompass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const fr = getLang() === 'fr';
    const r = Math.min(w, h) / 2 - 24;
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 26px Inter, system-ui, sans-serif';
    for (const [label, a] of [['N', 0], ['E', 90], ['S', 180], [fr ? 'O' : 'W', 270]] as const) {
      const t = (a * Math.PI) / 180;
      const x = cx + Math.sin(t) * r;
      const y = cy - Math.cos(t) * r;
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = label === 'N' ? '#e5322d' : 'rgba(10,14,22,0.78)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y + 1);
    }
    ctx.restore();
  }

  /** Communes affichées sur la mini-carte. */
  setPlaces(places: readonly { name: string; kind: string; x: number; z: number }[] | undefined): void {
    this.places = places ?? [];
  }

  /** Noms de communes sur la mini-carte : les plus grandes d'abord, sans chevauchement. */
  private drawPlaceNames(ctx: CanvasRenderingContext2D, w: number, h: number, view: { minX: number; maxX: number; minZ: number; maxZ: number }, P: (x: number, z: number) => [number, number]): void {
    const rank: Record<string, number> = { city: 0, town: 1, village: 2, suburb: 2, hamlet: 3 };
    // Mini-carte ronde du HUD compact, affichée plus petite : noms plus gros, moins nombreux, dans le disque.
    const k = this.compact ? 1.5 : 1;
    const size = [24, 21, 18, 16].map((v) => v * k);
    const inView = this.places.filter((p) => p.x >= view.minX && p.x <= view.maxX && p.z >= view.minZ && p.z <= view.maxZ);
    inView.sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
    const boxes: Array<[number, number, number, number]> = [];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of inView) {
      const r = Math.min(rank[p.kind] ?? 3, 3);
      if (r === 3 && boxes.length >= (this.compact ? 4 : 14)) continue;
      ctx.font = `600 ${size[r]}px Inter, system-ui, sans-serif`;
      const [x, y] = P(p.x, p.z);
      const tw = ctx.measureText(p.name).width;
      const bx: [number, number, number, number] = [x - tw / 2 - 3, y - (size[r] as number) / 2 - 2, x + tw / 2 + 3, y + (size[r] as number) / 2 + 2];
      if (bx[0] < 2 || bx[2] > w - 2 || bx[1] < 2 || bx[3] > h - 2) continue;
      if (this.compact && [bx[0], bx[2]].some((cx) => [bx[1], bx[3]].some((cy) => Math.hypot(cx - w / 2, cy - h / 2) > w / 2 - 6))) continue;
      if (boxes.some((o) => bx[0] < o[2] && bx[2] > o[0] && bx[1] < o[3] && bx[3] > o[1])) continue;
      boxes.push(bx);
      // Carte en couleurs (HUD compact) : texte sombre sur halo blanc ; sinon texte clair sur halo sombre.
      ctx.strokeStyle = this.compact ? 'rgba(255,255,255,0.92)' : 'rgba(8,12,20,0.85)';
      ctx.lineWidth = (this.compact ? 6 : 5) * k;
      ctx.strokeText(p.name, x, y);
      ctx.fillStyle = this.compact ? (r <= 1 ? '#0f172a' : '#334155') : r === 0 ? '#ffffff' : r === 1 ? '#f1f5f9' : '#cbd5e1';
      ctx.fillText(p.name, x, y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private drawMap(s: HudState): void {
    const c = this.mapCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const b = this.mapBounds;
    // Carte ronde (HUD compact) : la diagonale de l'emprise tient dans le disque.
    const scale = this.compact ? (Math.min(w, h) - 36) / Math.max(Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ), 1) : Math.min((w - 40) / (b.maxX - b.minX), (h - 40) / (b.maxZ - b.minZ));
    const mk = this.compact ? 1.5 : 1;
    const ox = (w - (b.maxX - b.minX) * scale) / 2;
    const oz = (h - (b.maxZ - b.minZ) * scale) / 2;
    const P = (x: number, z: number): [number, number] => [ox + (x - b.minX) * scale, oz + (z - b.minZ) * scale];
    // Fond de carte : emprise visible de la mini-carte, chargée une seule fois.
    const view = { minX: b.minX - ox / scale, maxX: b.maxX + ox / scale, minZ: b.minZ - oz / scale, maxZ: b.maxZ + oz / scale };
    this.ensureBase(view, view, 1024);
    // Fond de carte filtré, tracé et noms de communes : dessinés une fois (le filtre du fond coûte cher),
    // refaits seulement quand le fond arrive ou que les communes changent.
    const key = `${this.base?.ready ? this.base.img.src : ''}|${this.places.length}|${document.fonts.status}`;
    const still = this.cached('map', w, h, key, (g) => {
      this.drawBase(g, P);
      g.lineJoin = 'round';
      // Contour sombre plus épais sur le fond en couleurs.
      g.strokeStyle = this.compact ? 'rgba(10,14,22,0.85)' : 'rgba(0,0,0,0.5)';
      g.lineWidth = (this.compact ? 11 : 9) * mk;
      const pts = this.track.route.points;
      const path = () => {
        g.beginPath();
        for (let i = 0; i < pts.length; i += 4) {
          const p = pts[i] as { x: number; z: number };
          const [x, y] = P(p.x, p.z);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        if (this.track.route.loop) g.closePath();
      };
      path();
      g.stroke();
      // Tracé orange vif sur la carte en couleurs (le blanc s'y perdait).
      g.strokeStyle = this.compact ? '#ff6a13' : '#e2e8f0';
      g.lineWidth = (this.compact ? 6 : 5) * mk;
      path();
      g.stroke();
      this.drawPlaceNames(g, w, h, view, P);
      if (this.compact) this.drawCompass(g, w, h);
    });
    ctx.drawImage(still, 0, 0);
    for (const r of s.riders) {
      const [x, y] = P(r.x, r.z);
      ctx.fillStyle = r.me ? '#ffd23f' : r.color;
      ctx.beginPath();
      ctx.arc(x, y, (r.me ? 10 : r.friend ? 8 : 7) * mk, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = r.friend ? '#ffd23f' : '#0a0e16';
      ctx.lineWidth = (r.friend ? 4 : 3) * mk;
      ctx.stroke();
    }
  }

  /**
   * « À proximité » (façon Zwift) : jusqu'à 4 coureurs devant et 4 derrière, écart en temps à ma
   * vitesse (et en distance), W/kg. Filtre « réels » : seulement les joueurs en ligne.
   */
  private nearbyHtml(s: HudState): string {
    const fr = getLang() === 'fr';
    const me = s.riders.find((r) => r.me);
    if (!me) return '';
    const pool = s.riders.filter((r) => r.me || this.riderFilter === 'all' || (!r.isAI && !r.isGuest) || r.online).sort((a, b) => b.distM - a.distM);
    const i = pool.indexOf(me);
    const shown = pool.slice(Math.max(0, i - 4), i + 5);
    const speed = Math.max(s.speedKmh / 3.6, 2);
    const real = s.riders.filter((r) => !r.me && !r.isAI).length;
    const head = `<div class="rd-head"><b>${fr ? 'À proximité' : 'Nearby'}</b><button class="rd-filter" data-rfilter title="${fr ? 'Coureurs réels ou tous' : 'Real riders or all'}">${
      this.riderFilter === 'real' ? (fr ? `Réels (${real})` : `Real (${real})`) : fr ? 'Tous' : 'All'
    }</button></div>`;
    const rows = shown
      .map((r) => {
        const gap = r.distM - me.distM;
        const sub = r.ambient ? r.ambient.level : r.me ? t('you') : r.isAI ? t('ai') : r.isGuest ? t('guest') : r.friend ? (fr ? 'Ami' : 'Friend') : '';
        const verdict = r.ambient
          ? r.ambient.follow === 'ok'
            ? `<em class="rd-badge ok">${fr ? 'À suivre' : 'Can follow'}</em>`
            : r.ambient.follow === 'hard'
              ? `<em class="rd-badge hard">${fr ? 'Trop fort' : 'Too strong'}</em>`
              : `<em class="rd-badge easy">${fr ? 'Plus lent' : 'Slower'}</em>`
          : '';
        const rideOn = r.online && !r.me ? `<button class="rideon" data-rideon="${r.id}" title="Ride On">👍</button>` : '';
        const sec = gap / speed;
        const time = Math.abs(sec) >= 60 ? `${sec > 0 ? '+' : '−'}${Math.floor(Math.abs(sec) / 60)}:${String(Math.round(Math.abs(sec) % 60)).padStart(2, '0')}` : `${sec > 0 ? '+' : sec < 0 ? '−' : ''}${Math.round(Math.abs(sec))} s`;
        const dist = Math.abs(gap) >= 1000 ? `${(Math.abs(gap) / 1000).toFixed(1).replace('.', fr ? ',' : '.')} km` : `${Math.round(Math.abs(gap))} m`;
        const kmTxt = r.km !== undefined ? `${r.km.toFixed(1).replace('.', fr ? ',' : '.')} km` : '';
        return `<div class="row ${r.me ? 'me' : ''}"><i class="rd-dot" style="background:${r.color}"></i><span class="rd-name"><b class="rd-n">${r.friend ? `<em class="rd-friend" title="${fr ? 'Ami' : 'Friend'}">★</em>` : ''}${flagSvg(r.nationality, 13) ? `<span class="rd-flag" title="${countryName(r.nationality, fr ? 'fr' : 'en')}">${flagSvg(r.nationality, 13)}</span>` : ''}${r.name.replace(/[<>&]/g, '')}${r.speaking ? ' 🔊' : ''} ${rideOn}</b><small class="rd-sub">${sub}${verdict}</small></span><span class="num rd-wkg"><b>${r.watts !== undefined ? Math.round(r.watts) : '—'}<u>W</u></b><small>${kmTxt}</small></span><span class="num rd-gap">${r.me ? '' : `<b>${time}</b><small>${dist}</small>`}</span></div>`;
      })
      .join('');
    return head + rows;
  }

  /**
   * « À proximité » du HUD compact : les trois coureurs les plus proches et moi, une ligne chacun (nom,
   * watts, écart en temps). Repliable d'un clic sur l'en-tête (il garde le nombre de coureurs).
   */
  private nearbyCompactHtml(s: HudState): string {
    const fr = getLang() === 'fr';
    const me = s.riders.find((r) => r.me);
    if (!me) return '';
    const others = s.riders.filter((r) => !r.me && (this.riderFilter === 'all' || (!r.isAI && !r.isGuest) || r.online));
    const real = s.riders.filter((r) => !r.me && !r.isAI).length;
    const head = `<div class="rd-head" data-rfold title="${fr ? 'Replier / déplier' : 'Fold / unfold'}"><i class="rd-caret">▾</i><b>${fr ? 'À proximité' : 'Nearby'}</b><span class="rd-count num">${others.length}</span><button class="rd-filter" data-rfilter tabindex="-1" title="${fr ? 'Coureurs réels ou tous' : 'Real riders or all'}">${
      this.riderFilter === 'real' ? (fr ? `Réels (${real})` : `Real (${real})`) : fr ? 'Tous' : 'All'
    }</button></div>`;
    if (this.ridersFolded) return head;
    const near = others.sort((a, b) => Math.abs(a.distM - me.distM) - Math.abs(b.distM - me.distM)).slice(0, 3);
    const speed = Math.max(s.speedKmh / 3.6, 2);
    const rows = [...near, me]
      .sort((a, b) => b.distM - a.distM)
      .map((r) => {
        const sec = (r.distM - me.distM) / speed;
        const time = Math.abs(sec) >= 60 ? `${sec > 0 ? '+' : '−'}${Math.floor(Math.abs(sec) / 60)}:${String(Math.round(Math.abs(sec) % 60)).padStart(2, '0')}` : `${sec > 0 ? '+' : sec < 0 ? '−' : ''}${Math.round(Math.abs(sec))} s`;
        const flag = flagSvg(r.nationality, 11);
        const rideOn = r.online && !r.me ? `<button class="rideon" data-rideon="${r.id}" tabindex="-1" title="Ride On">👍</button>` : '';
        const friend = r.friend ? `<em class="rd-friend" title="${fr ? 'Ami' : 'Friend'}">★</em>` : '';
        // Sous le nom : niveau (cyclistes croisés) ou type, kilomètres parcourus ; à droite W et W/kg, écart.
        const sub = r.ambient ? r.ambient.level : r.me ? t('you') : r.isAI ? t('ai') : r.isGuest ? t('guest') : r.friend ? (fr ? 'Ami' : 'Friend') : '';
        const kmTxt = r.km !== undefined ? `${r.km.toFixed(1).replace('.', fr ? ',' : '.')} km` : '';
        const subLine = [sub, kmTxt].filter(Boolean).join(' · ');
        const wkg = r.wkg !== undefined ? `${r.wkg.toFixed(1).replace('.', fr ? ',' : '.')} W/kg` : '';
        return `<div class="row ${r.me ? 'me' : ''}"><i class="rd-dot" style="background:${r.color}"></i><span class="rd-name"><b class="rd-n">${friend}${flag ? `<span class="rd-flag">${flag}</span>` : ''}${r.name.replace(/[<>&]/g, '')}${r.speaking ? ' 🔊' : ''}${rideOn}</b>${subLine ? `<small class="rd-sub">${subLine}</small>` : ''}</span><span class="num rd-w">${r.watts !== undefined ? Math.round(r.watts) : '—'}<u>W</u>${wkg ? `<small>${wkg}</small>` : ''}</span><span class="num rd-gap">${r.me ? '' : time}</span></div>`;
      })
      .join('');
    return head + rows;
  }

  /**
   * Annonce du prochain virage : flèche dessinée selon l'angle (léger, serré, épingle), côté et distance,
   * couleur de plus en plus chaude avec la difficulté, pulsation dans les 40 derniers mètres. Masquée quand
   * le panneau de bifurcation du monde ouvert annonce déjà ce carrefour.
   */
  private drawTurn(s: HudState): void {
    const box = this.el.turn as HTMLElement;
    const tn = s.turn;
    const j = s.open?.junction;
    if (!tn || (j && j.inM <= 350 && Math.abs(j.inM - tn.inM) < 30)) {
      if (this.lastTurn) box.classList.add('hidden');
      this.lastTurn = '';
      return;
    }
    const fr = getLang() === 'fr';
    const a = Math.abs(tn.angleDeg);
    const right = tn.angleDeg > 0;
    const level = a >= 130 ? 'hairpin' : a >= 100 ? 'hard' : a >= 55 ? 'sharp' : 'easy';
    const name = fr
      ? { hairpin: 'Épingle', hard: 'Virage très serré', sharp: 'Virage serré', easy: 'Virage' }[level]
      : { hairpin: 'Hairpin', hard: 'Very sharp bend', sharp: 'Sharp bend', easy: 'Bend' }[level];
    const side = fr ? (right ? 'à droite' : 'à gauche') : right ? 'right' : 'left';
    const dist = tn.inM < 10 ? (fr ? 'maintenant' : 'now') : `${fr ? 'dans' : 'in'} ${Math.round(tn.inM / 10) * 10} m`;
    const key = `${level}|${right}|${Math.round(a / 10)}`;
    if (key !== this.lastTurn) {
      this.lastTurn = key;
      box.className = `panel turnwarn ${level}`;
      box.innerHTML = `${turnArrowSvg(Math.min(a, 180), right)}<div class="tw-text"><b>${name} ${side}</b><span class="num"></span></div>`;
    }
    box.classList.toggle('soon', tn.inM < 40);
    const span = box.querySelector('.tw-text span');
    if (span && span.textContent !== dist) span.textContent = dist;
  }

  /** Panneau « Bifurcation dans X m » : ← / → pour choisir, sortie retenue surlignée. */
  private drawJunction(s: HudState): void {
    const box = this.el.junction as HTMLElement;
    const j = s.open?.junction;
    if (!j || j.inM > 350) {
      box.classList.add('hidden');
      this.lastJunction = '';
      return;
    }
    box.classList.remove('hidden');
    const fr = getLang() === 'fr';
    const arrow = { left: '↰', straight: '↑', right: '↱', back: '↶' } as const;
    const label = (d: keyof typeof arrow) =>
      fr ? { left: 'À gauche', straight: 'Tout droit', right: 'À droite', back: 'Demi-tour' }[d] : { left: 'Left', straight: 'Straight on', right: 'Right', back: 'Turn back' }[d];
    const key = `${j.selected}|${j.locked}|${j.choices.map((c) => c.dir + c.name).join(',')}`;
    const head = `<div class="jn-head"><b>${fr ? 'Bifurcation' : 'Junction'}</b><span class="num">${fr ? 'dans' : 'in'} ${Math.max(0, Math.round(j.inM / 10) * 10)} m</span></div>`;
    if (key === this.lastJunction) {
      const h = box.querySelector('.jn-head span');
      if (h) h.textContent = `${fr ? 'dans' : 'in'} ${Math.max(0, Math.round(j.inM / 10) * 10)} m`;
      return;
    }
    this.lastJunction = key;
    box.innerHTML = `${head}<div class="jn-choices">${j.choices
      .map(
        (c, i) =>
          `<div class="jn-choice ${i === j.selected ? 'on' : ''} ${j.locked && i !== j.selected ? 'off' : ''}"><i>${arrow[c.dir]}</i><b>${label(c.dir)}</b><span>${c.name ? c.name.replace(/[<>&]/g, '') : ''}${c.unpaved ? ' · 🌾' : ''}</span>${i === j.selected ? `<em>${fr ? 'je continue' : 'my way'}</em>` : ''}</div>`,
      )
      .join('')}</div><div class="jn-keys">${j.locked ? (fr ? 'choix retenu' : 'locked in') : fr ? '← → pour choisir · U demi-tour' : '← → to choose · U turn back'}</div>`;
  }

  /** Profil des 2 km autour du coureur (200 m derrière, 1,8 km devant). */
  private drawOpenProfile(s: HudState, d: number): void {
    const c = this.profileCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const d0 = Math.max(0, d - 200);
    const d1 = Math.min(this.track.length, d0 + 2000);
    const pts: Array<{ d: number; y: number }> = [];
    for (let x = d0; x <= d1; x += 10) pts.push({ d: x, y: this.track.sample(x).y });
    if (pts.length < 2) return;
    const ys = pts.map((p) => p.y);
    const minY = Math.min(...ys) - 5;
    const maxY = Math.max(Math.max(...ys) + 5, minY + 30);
    const X = (x: number) => ((x - d0) / 2000) * w;
    const m = this.profileMetrics(h);
    const Y = (y: number) => h - m.pb - ((y - minY) / (maxY - minY)) * (h - m.pb - m.pt);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { d: number; y: number };
      const b = pts[i] as { d: number; y: number };
      const grade = ((b.y - a.y) / Math.max(b.d - a.d, 1)) * 100;
      ctx.fillStyle = grade > 6 ? '#ef4444' : grade > 3 ? '#f97316' : grade > 1 ? '#eab308' : grade < -1 ? '#3b82f6' : '#64748b';
      ctx.beginPath();
      ctx.moveTo(X(a.d), h);
      ctx.lineTo(X(a.d), Y(a.y));
      ctx.lineTo(X(b.d), Y(b.y));
      ctx.lineTo(X(b.d), h);
      ctx.closePath();
      ctx.fill();
    }
    const j = s.open?.junction;
    if (j) {
      ctx.strokeStyle = 'rgba(255,210,63,0.9)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(X(d + j.inM), 0);
      ctx.lineTo(X(d + j.inM), h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const y = this.track.sample(d).y;
    if (this.compact) {
      ctx.fillStyle = 'rgba(255,210,63,0.55)';
      ctx.fillRect(X(d) - m.line / 2, 0, m.line, h);
    }
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(X(d), Y(y), m.rMe, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0a0e16';
    ctx.lineWidth = m.ring;
    ctx.stroke();
  }

  /** Carte locale (1,6 km de côté, nord en haut) : routes alentour, chemin prévu, coureurs. */
  private drawOpenMap(s: HudState, d: number): void {
    const g = this.openGraph as RoadGraphData;
    const c = this.mapCanvas;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const me = this.track.sample(d);
    const half = 800;
    const k = w / (2 * half);
    const mk = this.compact ? 1.4 : 1;
    const P = (x: number, z: number): [number, number] => [w / 2 + (x - me.x) * k, h / 2 + (z - me.z) * k];
    // Fond de carte : fenêtre de 3,6 km autour du coureur, renouvelée quand il s'approche du bord de ce que montre la carte.
    const win = 1800;
    const cx = Math.round(me.x / 300) * 300;
    const cz = Math.round(me.z / 300) * 300;
    this.ensureBase({ minX: cx - win, maxX: cx + win, minZ: cz - win, maxZ: cz + win }, { minX: me.x - half * 1.1, maxX: me.x + half * 1.1, minZ: me.z - half * 1.1, maxZ: me.z + half * 1.1 }, 1024);
    this.drawBase(ctx, P);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const e of g.edges) {
      const p = e.pts;
      // Rejet grossier : extrémités et milieu loin du cadre.
      const mid = 3 * Math.floor(p.length / 6);
      const near = [0, mid, p.length - 3].some((i) => Math.abs((p[i] as number) - me.x) < half * 1.5 && Math.abs((p[i + 2] as number) - me.z) < half * 1.5);
      if (!near) continue;
      ctx.strokeStyle = /^(asphalt|paved|concrete|chipseal)/.test(e.surface) ? 'rgba(226,232,240,0.45)' : 'rgba(202,170,110,0.45)';
      ctx.lineWidth = (e.kind.startsWith('primary') || e.kind.startsWith('secondary') ? 6 : 3.5) * mk;
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 3) {
        const [x, y] = P(p[i] as number, p[i + 2] as number);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // Chemin prévu devant (jusqu'à 1,2 km).
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 6 * mk;
    ctx.beginPath();
    let first = true;
    for (let x = d; x <= Math.min(this.track.length, d + 1200); x += 8) {
      const q = this.track.sample(x);
      const [px, py] = P(q.x, q.z);
      if (first) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      first = false;
    }
    ctx.stroke();
    // Destination du guidage : drapeau vert (au bord de la carte s'il est plus loin).
    if (this.destination) {
      let [fx, fy] = P(this.destination.x, this.destination.z);
      const rr = Math.hypot(fx - w / 2, fy - h / 2);
      const rmax = w / 2 - 30;
      if (rr > rmax) [fx, fy] = [w / 2 + ((fx - w / 2) * rmax) / rr, h / 2 + ((fy - h / 2) * rmax) / rr];
      ctx.strokeStyle = '#0a0e16';
      ctx.lineWidth = 3 * mk;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy - 34 * mk);
      ctx.stroke();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 34 * mk);
      ctx.lineTo(fx + 22 * mk, fy - 26 * mk);
      ctx.lineTo(fx, fy - 18 * mk);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    for (const r of s.riders) {
      const [x, y] = P(r.x, r.z);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      ctx.fillStyle = r.me ? '#ffd23f' : r.color;
      ctx.beginPath();
      ctx.arc(x, y, (r.me ? 10 : r.friend ? 8 : 7) * mk, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = r.friend ? '#ffd23f' : '#0a0e16';
      ctx.lineWidth = (r.friend ? 4 : 3) * mk;
      ctx.stroke();
    }
    if (this.compact) this.drawCompass(ctx, w, h);
  }
}
