import type { AvatarLook, CosmeticItem, RouteData, RouteSegment, WorldCatalogue } from '@allezrobert/shared';
import { GRAPHIC_STYLE, setGraphicStyle, type GraphicStyle } from '../engine/style.ts';
import { readKomRecord } from '../game/challenge.ts';
import { COUNTRIES, BIKE_BRANDS, BIKE_GROUPS, BIKE_TEAMS, COSMETICS, DEFAULT_BIKE, bikeById, routesForBike, mirrorStartM, rankRouteId, lookSex, tuneItem, withSex, bottleCapacity, bikeSetupFor, jerseyLookOf, helmetLookOf, glassesLookOf, levelProgress, SHOE_MARKS, equippedTuneIds, trainerOf, type BikeCollection, type BikeType, type CapLook, type CosmeticSlot } from '@allezrobert/shared';
import { shoeAccentOf } from '../rider/shoeLook.ts';
import { WORKOUT_LIBRARY, WORKOUT_TYPES, WORKOUT_TYPE_LABELS, parseWorkoutFile, tunedBikeSetup, type LibraryWorkout, type WorkoutStep, type WorkoutType } from '@allezrobert/physics';
import { rideHistory } from '../data/history/instance.ts';
import type { LocalWorkout } from '../data/history/index.ts';
import { HistoryPanel } from './historyPanel.ts';
import { formatBytes, inTauri, installPack, installedPacks, loadCatalogue, packState, removePack } from '../world/packs.ts';
import { fillStoragePanel, storagePanelHtml } from './desktopUi.ts';
import { compositeId, neighbourZones } from '../world/composite.ts';
import { t, setLang, getLang, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { saveSettings } from './settings.ts';
import { music } from '../audio/music.ts';
import { spotify, redirectUri } from '../audio/spotify.ts';
import { musicSource, setMusicSource } from '../audio/musicSource.ts';
import { renderStravaLink } from './stravaLink.ts';
import { flagSvg } from './flagSvg.ts';
import { enhanceSelects } from './dropdown.ts';
import { renderSoundSettings } from './soundSettings.ts';
import { bikeThumbHtml, paintPlainThumbs, plainThumbHtml, swapMissingThumbs } from './bikeThumb.ts';
import { OpenWorldPanel } from './openWorld.ts';
import { renderCompanionSettings } from './companionQr.ts';
import { HUD_BLOCKS } from '../hud/hud.ts';
import { renderExpertSettings } from './expertZones.ts';
import { loadProgress, equipItem, equipPlainBike, SLOT_LABEL } from './garage.ts';
import { roadEffectHtml } from './roadEffect.ts';
import { AtelierPanel, COIN } from './atelierPanel.ts';
import type { AtelierState } from './atelier.ts';
import { WORLD_LIST } from '../world/worlds.ts';
import { OUTFITS } from './outfits.ts';
import type { GarageView } from './poster.ts';
import { FriendsPanel } from './friends.ts';
import { ProgressPage } from './progressPage.ts';
import { faceEditorHtml, withBaseHead, withLikeness, withProfile, withRandomFace, withSlider, type FaceTab } from './faceEditor.ts';
import type { FaceSlider } from '@allezrobert/shared';
import { joinSettings } from './friendsLogic.ts';
import { RoutePlanner } from './routePlanner.ts';
import { companionQr } from './companionQr.ts';
import { FranceMap, type MapZone } from './franceMap.ts';
import { bindStartPicker, loadRouteBoards, routeDetailHtml } from './routeDetail.ts';
import { canMoveStart, canReverse, reversedOf, routeKey, snapStartM, startedOf } from '../game/direction.ts';
import { ZONE_SPOTS } from '../world/zoneMap.ts';

// Vignettes des mondes imaginaires (à côté de la carte de France) : chargées dès le menu, prêtes à l'ouverture.
if (typeof Image !== 'undefined') for (const z of ZONE_SPOTS) if (z.image) new Image().src = z.image;
import { getAspectCap, getResolutionCap, getUiAspectCap, setAspectCap, setResolutionCap, setUiAspectCap, type AspectCap, type ResolutionCap } from '../engine/display.ts';
import './menu.css';

/** Ce que l'écran d'appairage sait faire, quel que soit le transport (implémenté avec @allezrobert/devices). */
export interface DevicePanel {
  /** Appareils connus avec leur état lisible. */
  list(): Array<{ id: string; name: string; role: string; roleIds?: string[]; kinds?: string[]; simulated?: boolean; state: string; detail?: string; ok: boolean }>;
  /** Transports disponibles sur cette plateforme. */
  transports(): Array<{ id: string; label: string }>;
  /** Lance l'appairage d'un rôle (Web Bluetooth ouvre le sélecteur du navigateur). */
  pair(role: 'trainer' | 'power' | 'heartRate' | 'cadence' | 'shifter' | 'fan', transport: string): Promise<void>;
  forget(id: string): void;
  /** Relance tout de suite la connexion d'un appareil appairé (salle d'attente, onglet Capteurs). */
  reconnect?(id: string): void;
  useSimulator(on: boolean): void;
  simulatorOn(): boolean;
  warnings(): string[];
  /** Commandes Di2 activées (adaptateur D-Fly) ou appairées. */
  di2Active?(): boolean;
  /** Adaptateurs Bluetooth (app Windows) : intégré ou dongle. */
  adapters?(): Promise<Array<{ id: string; name: string; isDefault: boolean }>>;
  selectAdapter?(id: string): Promise<void>;
  onChange(cb: () => void): void;
  /** Réglages avancés du matériel (calibration, ventilateur, adaptateurs, journal) : ui/hardware-panel.ts. */
  renderExtras?(el: HTMLElement): void;
}

export interface MenuCallbacks {
  /** `inviteFriends` : amis (identifiants de relation) à inviter une fois la sortie créée. */
  onStart(settings: Settings, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; inviteFriends?: string[]; customRoute?: RouteData; openStart?: { x: number; z: number }; publicRoom?: boolean; nearFriend?: string }): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

type Tab = 'home' | 'ride' | 'friends' | 'garage' | 'progress' | 'devices' | 'profile' | 'settings';
type Role = Parameters<DevicePanel['pair']>[0];

const fr = () => getLang() === 'fr';

/** Pictogrammes (traits, couleur héritée). */
const svg = (d: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Couleur et accroche de chaque mode (cartes « Que veux-tu faire ? »). */
const MODE_COLORS: Partial<Record<Settings['mode'], string>> = {
  free: '#ffd23f',
  group: '#4ade80',
  race: '#f87171',
  workout: '#60a5fa',
  ftpTest: '#c084fc',
  challenge: '#fb923c',
};
const MODE_TAGS: Record<'fr' | 'en', Partial<Record<Settings['mode'], string>>> = {
  fr: { free: 'En solo', group: 'Avec tes amis', race: 'Classement', workout: 'Séances ERG', ftpTest: 'Test rampe', challenge: 'Records en côte' },
  en: { free: 'On your own', group: 'With friends', race: 'Results', workout: 'ERG sessions', ftpTest: 'Ramp test', challenge: 'Climb records' },
};

const ICON = {
  free: svg('<path d="M4 20 10 4M20 20 14 4M12 6v2M12 11v2M12 16v2"/>'),
  group: svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M2.5 20c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M13.5 15.2c.8-.5 1.6-.7 2.5-.7 2.4 0 4.3 1.4 4.8 4.5"/>'),
  race: svg('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  workout: svg('<path d="M4 20v-6M9 20V8M14 20v-9M19 20V5"/>'),
  ftpTest: svg('<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-6"/><circle cx="12" cy="16" r="1.2"/>'),
  open: svg('<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>'),
  challenge: svg('<path d="M3 20 10 8l4 6 3-4 4 10z"/><path d="M14 4h4v3h-4z"/>'),
  trainer: svg('<circle cx="7" cy="15" r="4"/><path d="M7 15h7l3-7h2M13 8l1 7M3 21h18"/>'),
  power: svg('<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'),
  heartRate: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/><path d="M7 12h3l1-2 2 4 1-2h3"/>'),
  shifter: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>'),
  fan: svg('<circle cx="12" cy="12" r="1.5"/><path d="M12 10.5C11 6 13 3 16 4s1 5-2.5 7M13.5 12.5c4.4 1 6.5 3.5 5 6s-5 .5-6.5-3M10.5 12c-4.5.2-7.3-1.7-6.6-4.5s4.6-1.6 6.4 1.9"/>'),
  music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', 16),
  musicOff: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>', 16),
  next: svg('<path d="m5 4 10 8-10 8zM19 5v14"/>', 14),
  prev: svg('<path d="M19 20 9 12l10-8zM5 19V5"/>', 14),
  play: svg('<path d="m7 4 13 8-13 8z"/>', 14),
  pause: svg('<path d="M7 4v16M17 4v16"/>', 14),
  list: svg('<path d="M4 6h12M4 12h12M4 18h8M18 15v6l4-3z"/>', 16),
  rotate: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>', 16),
  gTenue: svg('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3Z"/>', 18),
  gBike: svg('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8 8 5H6M12 16l-2-8"/>', 18),
  gFace: svg('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>', 18),
  gWrench: svg('<path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-8 8a2.1 2.1 0 0 1-3-3l8-8Z"/><path d="M16 3.5 13 6.5 17.5 11l3-3"/>', 16),
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>', 20),
};

/** Catégorie ouverte dans le garage. */
type GarageSlot = CosmeticSlot | 'colors' | 'face' | 'atelier';

/** Seuils des zones de puissance (× FTP) et leurs couleurs (Z1 à Z7). */
const ZONE_LIMITS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5];
const ZONE_COLORS = ['#c3cbd5', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const zoneColorOf = (ftp: number) => ZONE_COLORS[ZONE_LIMITS.findIndex((z) => ftp < z) === -1 ? 6 : ZONE_LIMITS.findIndex((z) => ftp < z)] as string;

/** Couleur d'un type de séance : la zone où se joue l'essentiel (mêmes teintes que le graphe). */
const TYPE_COLORS: Record<WorkoutType, string> = {
  recovery: ZONE_COLORS[0]!,
  endurance: ZONE_COLORS[1]!,
  tempo: ZONE_COLORS[2]!,
  sweetspot: '#a3c726',
  threshold: ZONE_COLORS[3]!,
  vo2max: ZONE_COLORS[4]!,
  anaerobic: ZONE_COLORS[5]!,
};

/** Durée lisible : « 45 min », « 1 h 05 ». */
const fmtWkDur = (s: number) => {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
};

/**
 * Carte d'une séance : nom et durée, type (couleur de sa zone), TSS et IF estimés (puissance normalisée
 * calculée sur les paliers), description, puis profil des paliers (hauteur = % de FTP, couleur = zone,
 * ligne FTP repérée). L'échelle est la même pour toutes les cartes (0 à 160 % de FTP) : on compare d'un coup d'œil.
 */
function workoutCard(w: (typeof WORKOUT_LIBRARY)[number], on: boolean, opens?: string, fav?: boolean): string {
  const lang = getLang();
  const steps = w.build().steps;
  const total = steps.reduce((a, st) => a + st.durationS, 0) || 1;
  const H = 56;
  const W = 300;
  const PMAX = 1.6;
  const y = (p: number) => (H - (Math.min(p, PMAX) / PMAX) * (H - 2)).toFixed(1);
  // Effort « à fond » (sprint) : dessiné et compté à 150 % de FTP, faute de cible.
  const powerOf = (st: WorkoutStep, p: number) => (st.mode === 'max' ? 1.5 : p);
  let t = 0;
  let p4 = 0;
  // Paliers voisins de la même zone : une seule forme (pas de couture ton sur ton) ; 1 px d'écart
  // entre deux zones différentes, pour que chaque bloc se lise.
  const runs: Array<{ color: string; pts: Array<[number, number]> }> = [];
  for (const st of steps) {
    const x0 = (t / total) * W;
    const x1 = ((t + st.durationS) / total) * W;
    t += st.durationS;
    const a = powerOf(st, st.powerStart);
    const b = powerOf(st, st.powerEnd);
    const mid = (a + b) / 2;
    p4 += mid ** 4 * st.durationS;
    const color = zoneColorOf(mid);
    const last = runs.at(-1);
    if (last && last.color === color) last.pts.push([x0, a], [x1, b]);
    else runs.push({ color, pts: [[x0, a], [x1, b]] });
  }
  const GAP = 1;
  // Effort très court (sprint de 15 s sur 45 min) : 3 unités de large au moins, dessiné par-dessus ses voisins.
  const MIN_W = 3;
  const wide: string[] = [];
  const narrow: string[] = [];
  runs.forEach((r, i) => {
    const pts = r.pts.map(([x, p]) => [x, p] as [number, number]);
    if (i > 0) pts[0]![0] += GAP;
    if (i < runs.length - 1) pts[pts.length - 1]![0] -= GAP;
    const x0 = pts[0]![0];
    const x1 = pts[pts.length - 1]![0];
    const thin = x1 - x0 < MIN_W;
    if (thin) {
      const c = (x0 + x1) / 2;
      pts[0]![0] = c - MIN_W / 2;
      pts[pts.length - 1]![0] = c + MIN_W / 2;
    }
    const top = pts.map(([x, p]) => `${x.toFixed(1)},${y(p)}`).join(' ');
    (thin ? narrow : wide).push(`<polygon points="${pts[0]![0].toFixed(1)},${H} ${top} ${pts[pts.length - 1]![0].toFixed(1)},${H}" fill="${r.color}"/>`);
  });
  const shapes = wide.join('') + narrow.join('');
  const ifv = (p4 / total) ** 0.25;
  const tss = Math.round((total / 3600) * ifv * ifv * 100);
  const dur = fmtWkDur(total);
  const ftpPct = (((1 / PMAX) * (H - 2)) / H) * 100;
  const L = lang === 'fr';
  const favHtml =
    fav === undefined
      ? ''
      : `<span class="mm-wk-fav${fav ? ' on' : ''}" data-fav="${w.id}" role="button" tabindex="0" aria-pressed="${fav}" title="${L ? (fav ? 'Retirer des favoris' : 'Ajouter aux favoris') : fav ? 'Remove from favourites' : 'Add to favourites'}">${fav ? '★' : '☆'}</span>`;
  return `<button class="mm-wk${on ? ' on' : ''}" ${opens ? `data-picker="${opens}"` : `data-preset="${w.id}"`} style="--wk:${TYPE_COLORS[w.type]}">
    <span class="mm-wk-head"><b>${esc(w.name[lang])}</b><em>${dur}</em>${favHtml}</span>
    <span class="mm-wk-meta"><span class="mm-wk-type">${WORKOUT_TYPE_LABELS[w.type][lang]}</span><span class="mm-wk-stat"><small>TSS</small>${tss}</span><span class="mm-wk-stat"><small>IF</small>${ifv.toFixed(2).replace('.', L ? ',' : '.')}</span>${on && !opens ? `<span class="mm-wk-chosen">✓ ${L ? 'Choisie' : 'Selected'}</span>` : ''}</span>
    <span class="mm-wk-desc">${esc(w.description[lang])}</span>
    <span class="mm-wk-graph" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${shapes}</svg><i class="mm-wk-ftp" style="bottom:${ftpPct.toFixed(1)}%"><span>FTP</span></i></span>
  </button>`;
}

/** Séances favorites (stockage local ; l'appli de bureau le sauvegarde avec le profil). */
const FAV_KEY = 'ar.workoutFavorites';

/** Séance perso vue comme une séance de la bibliothèque (même carte). */
function storedAsLibrary(w: LocalWorkout): LibraryWorkout {
  const desc = w.description ?? (w.source === 'custom' ? 'Séance créée' : `Fichier .${w.source}`);
  return {
    id: `mine:${w.id}`,
    type: (WORKOUT_TYPES as readonly string[]).includes(w.type ?? '') ? (w.type as WorkoutType) : 'endurance',
    source: 'allezrobert',
    name: { fr: w.name, en: w.name },
    description: { fr: desc, en: desc },
    build: () => ({ name: w.name, steps: w.steps as WorkoutStep[] }),
  };
}

/** Empreinte courte d'un fichier (même fichier réimporté = même séance). */
function contentId(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Ciels proposés au départ d'une sortie (nuages, pluie, brouillard de 0 à 1). */
const WEATHER_PRESETS: Array<[string, { clouds: number; rain: number; fog: number }]> = [
  ['sun', { clouds: 0.1, rain: 0, fog: 0 }],
  ['cloudy', { clouds: 0.65, rain: 0, fog: 0.05 }],
  ['rain', { clouds: 0.9, rain: 0.7, fog: 0.1 }],
  ['fog', { clouds: 0.5, rain: 0, fog: 0.7 }],
];
/** Forces de vent proposées (m/s) : calme, léger (≈ 11 km/h), moyen (≈ 22 km/h), fort (≈ 36 km/h). */
const WIND_STEPS = [0, 3, 6, 10];

/** Gros plan du garage selon la catégorie choisie. */
const SLOT_VIEW: Record<CosmeticSlot, GarageView> = { jersey: '3q', helmet: 'front', bike: 'side', socks: 'bike', glasses: 'front', trainer: 'trainer' };

/** Filtres de la liste des vélos du garage. */
type BikeFilter = BikeCollection | 'unlocked';
const BIKE_FILTERS: Array<[BikeFilter, string, string]> = [
  ['saison-2026', 'Saison 2026', '2026 season'],
  ['mythiques', 'Mythiques', 'Legends'],
  ['divers', 'Divers', 'Misc.'],
  ['unlocked', 'Débloqués', 'Unlocked'],
];
const BIKE_TYPE: Record<BikeType, [string, string]> = {
  aero: ['Aéro', 'Aero'],
  climbing: ['Grimpeur', 'Climbing'],
  tt: ['Chrono', 'Time trial'],
  classic: ['Classique', 'Classic'],
  track: ['Piste', 'Track'],
};

const BIKE_TYPE_ORDER: BikeType[] = ['aero', 'climbing', 'classic', 'tt', 'track'];

/** Équipe (saison 2026 : plusieurs équipes roulent le même modèle) ou collection d'un vélo. */
function bikeFrom(group: string, lang: 'fr' | 'en'): string | undefined {
  return BIKE_TEAMS.find((t) => t.id === group)?.name ?? BIKE_GROUPS.find((g) => g.id === group)?.name[lang];
}

/** Marque d'un vélo (nom affiché), pour classer la liste. */
function brandName(id: string): string {
  const brand = bikeById(id)?.brand;
  return BIKE_BRANDS.find((b) => b.id === brand)?.name ?? brand ?? '';
}

/**
 * Dessin de repli (photo manquante, voir bikeThumb.ts) : silhouette de vélo aux couleurs de la livrée (cadre : 1re couleur, haubans et fourche : 2e,
 * guidon : 3e), cernée de sombre pour rester lisible quelle que soit la couleur.
 */
function bikeIcon(colors: readonly string[], big = false): string {
  const main = colors[0] ?? '#7a8594';
  const acc = colors[1] ?? main;
  const third = colors[2] ?? acc;
  const tubes = (d: string, c: string) => `<path d="${d}" stroke="#141820" stroke-width="5.2"/><path d="${d}" stroke="${c}" stroke-width="3"/>`;
  return `<svg class="mm-bikeicon${big ? ' big' : ''}" viewBox="0 0 64 40" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="14" cy="27" r="10" stroke="#20252e" stroke-width="2.6"/><circle cx="50" cy="27" r="10" stroke="#20252e" stroke-width="2.6"/>
    ${tubes('M14 27 25 10M14 27h16M44 11l6 16', acc)}${tubes('M30 27 25 10h19L30 27', main)}${tubes('M44 11l1.5-4h5', third)}
    <path d="M21 8.5h7" stroke="#141820" stroke-width="2.6"/></svg>`;
}

/** Vignette d'un maillot à motif (pois, manches, moitié, dégradé, chevrons), aux couleurs du shader de l'avatar. */
function patternSwatch(c: CosmeticItem): string | null {
  const base = c.color ?? '#ffffff';
  const acc = c.jersey?.accent ?? base;
  switch (c.jersey?.style) {
    case 'pois':
      return `radial-gradient(circle at 25% 25%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, radial-gradient(circle at 75% 75%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, ${base}`;
    case 'manches':
      return `linear-gradient(90deg, ${acc} 0 24%, ${base} 24% 76%, ${acc} 76% 100%)`;
    case 'moitie':
      return `linear-gradient(180deg, ${base} 0 50%, ${acc} 50% 100%)`;
    case 'degrade':
      return `linear-gradient(180deg, ${base} 10%, ${acc} 95%)`;
    case 'chevrons':
      return `linear-gradient(180deg, ${base} 0 32%, ${acc} 32% 50%, ${base} 50% 100%)`;
    default:
      return null;
  }
}

/** Vignette d'une casquette à motif (pois, losanges, quartiers) ; une casquette unie garde sa couleur. */
function capSwatch(cap: CapLook): string | null {
  const cols = cap.colors?.length ? cap.colors : [cap.color];
  switch (cap.style) {
    case 'pois': {
      const acc = cap.accent ?? '#e8501d';
      return `radial-gradient(circle at 25% 25%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, radial-gradient(circle at 75% 75%, ${acc} 0 21%, transparent 23%) 0 0 / 17px 17px, ${cap.color}`;
    }
    case 'losanges':
      return `linear-gradient(135deg, ${cols.map((x, i) => `${x} ${((i * 100) / cols.length).toFixed(0)}% ${(((i + 1) * 100) / cols.length).toFixed(0)}%`).join(', ')})`;
    case 'panneaux':
      return `linear-gradient(90deg, ${cols.map((x, i) => `${x} ${((i * 100) / cols.length).toFixed(0)}% ${(((i + 1) * 100) / cols.length).toFixed(0)}%`).join(', ')})`;
    default:
      return null;
  }
}

/** Vignette d'un équipement : couleur unie, ou bandes de la livrée pour un vélo. */
function swatch(c: CosmeticItem): string {
  // « Sans casque » / « Sans lunettes » : pastille barrée.
  if (c.bare) return 'linear-gradient(135deg, transparent 44%, #e05a4f 44% 56%, transparent 56%), #3a3f47';
  const cap = c.cap ? capSwatch(c.cap) : null;
  if (cap) return cap;
  const pattern = patternSwatch(c);
  if (pattern) return pattern;
  // Maillot à bandes de champion : le maillot, traversé de ses bandes de poitrine.
  const bands = c.jersey?.style === 'bandes' ? (c.jersey.bands ?? []) : [];
  if (bands.length) {
    const h = Math.min(16, 48 / bands.length);
    const top = 50 - (h * bands.length) / 2;
    const stops = bands.map((x, i) => `${x} ${(top + i * h).toFixed(1)}% ${(top + (i + 1) * h).toFixed(1)}%`);
    return `linear-gradient(180deg, ${c.color ?? '#ffffff'} 0 ${top.toFixed(1)}%, ${stops.join(', ')}, ${c.color ?? '#ffffff'} ${(top + h * bands.length).toFixed(1)}% 100%)`;
  }
  const cols = c.colors ?? [];
  if (cols.length < 2) return c.color ?? '#7a8594';
  const n = cols.length;
  return `linear-gradient(135deg, ${cols.map((x, i) => `${x} ${((i * 100) / n).toFixed(0)}% ${(((i + 1) * 100) / n).toFixed(0)}%`).join(', ')})`;
}

/** Packs de maillots du garage, dans l'ordre d'affichage ; les maillots sans pack viennent en premier. */
const JERSEY_PACKS: ReadonlyArray<{ id: string; name: { fr: string; en: string } }> = [
  { id: '', name: { fr: 'Maillots', en: 'Jerseys' } },
  { id: 'tour', name: { fr: 'Tour de France', en: 'Tour de France' } },
  { id: 'pays', name: { fr: 'Champions nationaux', en: 'National champions' } },
  { id: 'distinctifs', name: { fr: 'Maillots distinctifs', en: 'Distinctive jerseys' } },
  { id: 'equipes', name: { fr: 'Couleurs d’équipes', en: 'Team colours' } },
  { id: 'pro', name: { fr: 'Équipes pro', en: 'Pro teams' } },
];

/**
 * Menu principal façon jeu : barre d'onglets en haut (Rouler, Garage, Capteurs, Profil,
 * Réglages), lecteur de musique et compte à droite ; panneaux posés sur la scène 3D fixe.
 * Onglet Rouler : modes en tuiles, carte et profil de l'itinéraire, départ. Garage : aperçu 3D
 * du coureur (vues prédéfinies, rotation à la souris) piloté par onScene.
 */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private allRoutes: RouteData[];
  /** Parcours proposés : ceux du vélo équipé (route, gravel ou VTT). */
  private get routes(): RouteData[] {
    return routesForBike(this.allRoutes, bikeSetupFor(loadProgress().equipped).tyre);
  }
  private readonly devices: DevicePanel;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  /** Filtre de la fenêtre des séances : un type, « mes séances » (importées), ou tout. */
  private wkFilter: WorkoutType | 'mine' | '' = '';
  /** Filtre de la fenêtre des séances au dernier rendu (null : fenêtre fermée), pour garder son défilement. */
  private wkScrollKey: string | null = null;
  /** Séances importées, gardées dans l'historique (rechargées à l'ouverture de la fenêtre). */
  private myWorkouts: LocalWorkout[] = [];
  /** Séances favorites (identifiants de la bibliothèque ou `mine:…`), listées dans « Mes séances ». */
  private favWorkouts = new Set<string>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[];
      } catch {
        return [];
      }
    })(),
  );
  /** Historique (sous-onglet du Profil). */
  private readonly historyPanel = new HistoryPanel();
  /** Sous-onglet du Profil : réglages du coureur ou historique des sorties. */
  private profileView: 'profile' | 'history' = 'profile';
  /** Compteur de km du profil : redessiné quand l'historique change (nouvelle sortie, synchronisation). */
  private readonly historyWatch = rideHistory.subscribe(() => {
    if (this.tab === 'profile' && this.profileView === 'profile' && this.root.querySelector('.mm-bigstats')) this.render();
    // Trophées : meilleure sortie et nombre de sorties viennent de l'historique.
    if (this.tab === 'progress') this.render();
  });
  private tab: Tab = 'ride';
  private garageSlot: GarageSlot = 'jersey';
  /** Le garage est déjà ouvert (animation d'arrivée jouée). */
  private garageEntered = false;
  /** Atelier (pièces du vélo, ensembles, crédits) : panneau et état de la scène 3D. */
  private readonly atelier: AtelierPanel;
  /** Onglet Progression : niveaux, récompenses, trophées et défis. */
  private readonly progress: ProgressPage;
  /** Atelier 3D (pièce procédurale, vélo sur pied) : état demandé, null pour le fermer. */
  onAtelier?: (st: AtelierState | null) => void;
  /** Pièce du vélo 3D sous le pointeur (coordonnées écran) : emplacement d'atelier, null si aucune. */
  onAtelierPick?: (x: number, y: number) => import('@allezrobert/shared').TuneSlot | null;
  /** Éditeur de visage : groupe de curseurs, tête nue dans l'aperçu, tenues précédentes (annulation). */
  private faceTab: FaceTab = 'head';
  private bareHead = true;
  private readonly faceUndo: AvatarLook[] = [];
  private photoOpen = false;
  private bikeFilter: BikeFilter = 'saison-2026';
  private bikeType: BikeType | 'all' = 'all';
  /** Panneau affiché (onglet, catégorie, filtre) : sa position de défilement survit à un nouveau rendu. */
  private panelKey = '';
  private view: GarageView = '3q';
  private yaw = 0;
  private readonly onKey = (e: KeyboardEvent) => {
    if (this.picker && e.key === 'Escape') {
      e.preventDefault();
      this.closePicker();
      return;
    }
    if (!this.root.querySelector('.mm') || this.root.querySelector('.mm-modal')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    // Échap : d'un onglet vers Rouler, de Rouler vers l'accueil.
    if (e.key === 'Escape' && this.tab !== 'home') this.go(this.tab === 'ride' ? 'home' : 'ride');
  };
  onSettingsChange?: (s: Settings) => void;
  /** Relance le tutoriel (onboarding) depuis le menu. */
  onTutorial?: () => void;
  /**
   * Clic sur « Rouler » de l'accueil : vrai si le jeu a pris la suite lui-même (premier lancement : le tutoriel),
   * faux pour ouvrir l'onglet Rouler. Le clic autorise déjà le son (musique, voix du tutoriel).
   */
  onHomeRide?: () => boolean;
  /** Garage prêt en mémoire (pièce, coureur, shaders) : jusqu'ici l'accueil n'offre pas « Rouler ». */
  private garageReady = false;
  private garageProgress = 0;

  /** Le garage est chargé : « Rouler » remplace la barre d'attente de l'accueil. */
  setGarageReady(): void {
    if (this.garageReady) return;
    this.garageReady = true;
    if (this.tab === 'home' && this.root.querySelector('.mm-tab-home')) this.render();
  }

  /** Avancement de la préparation du garage (0–1), affiché sur l'accueil. */
  setGarageProgress(fraction: number): void {
    this.garageProgress = fraction;
    const pct = this.root.querySelector('.mm-home-wait-pct');
    if (pct) pct.textContent = fraction > 0 ? `${Math.round(fraction * 100)} %` : '';
  }
  /** « Explorer la carte » : survol libre du monde chargé, sans rouler (Échap pour revenir). */
  onExplore?: () => void;
  /** Aperçu immédiat d'une tenue (éditeur de visage) sur le coureur du garage, sans reconstruire la scène. */
  onLookLive?: (look: AvatarLook, bareHead: boolean) => void;
  /** Éditeur de visage ouvert avec tête nue : l'aperçu garde casque et lunettes masqués. */
  get bareHeadPreview(): boolean {
    return this.tab === 'garage' && this.garageSlot === 'face' && this.bareHead;
  }
  /** Cadrage 3D demandé par le menu : photo du groupe ou vue du garage (rotation en radians). */
  onScene?: (view: 'poster' | GarageView, yaw: number, bikeOnly?: boolean) => void;
  /** Aperçu d'un équipement (même verrouillé) sur le coureur du garage ; null : tenue équipée. */
  onPreviewLook?: (look: AvatarLook | null) => void;
  /** Carte du choix (sous « Choisir ma sortie ») : seulement après un choix fait dans ce menu. */
  private selMap = false;
  private mq: MediaQueryList | null = null;


  /** Essais en cours au garage, un par emplacement (vélo, maillot…) : ils restent en place pendant qu'on en essaie d'autres. */
  private readonly previews = new Map<CosmeticSlot, string>();
  /** Compte connecté (affiché dans le menu), connexion / déconnexion, synchro du profil. */
  account: { name: string; level: number; credits?: number } | null = null;
  onLogin?: () => void;
  onLogout?: () => void;
  /** Monde affiché et changement de monde (rechargement de la page). */
  worldId = 'longchamp';
  /** Zones chargées ensemble : la zone `worldId` puis les voisines ajoutées (parcours libre et à dessiner). */
  loadedZones: string[] = [];

  /** Montées chronométrées connues par zone (mémorisées à chaque zone chargée) : le tableau des records les liste toutes. */
  private komIndex(): Record<string, Array<{ routeId: string; routeName: string; segId: string; name: string; lengthM: number; grade: number }>> {
    try {
      return JSON.parse(localStorage.getItem('ar.komIndex') ?? '{}') as ReturnType<MainMenu['komIndex']>;
    } catch {
      return {};
    }
  }

  private indexClimbs(): void {
    const seen = new Set<string>();
    const list: ReturnType<MainMenu['komIndex']>[string] = [];
    for (const route of this.routes)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          list.push({ routeId: route.id, routeName: this.routeName(route), segId: k.id, name: k.name, lengthM: k.endM - k.startM, grade: k.avgGrade });
        }
    if (!list.length || !this.worldId) return;
    const all = this.komIndex();
    all[this.worldId] = list;
    try {
      localStorage.setItem('ar.komIndex', JSON.stringify(all));
    } catch {
      // Stockage indisponible : le tableau ne montrera que la zone affichée.
    }
  }

  /** Nom d'une zone (catalogue du jeu, sinon carte de France). */
  private zoneLabel(id: string): string {
    const lang = getLang();
    return WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
  }

  /** Nouveau monde chargé sur place : parcours, identifiant, monde ouvert ; l'écran est refait. */
  setWorld(routes: RouteData[], worldId: string, open: boolean): void {
    this.allRoutes = routes;
    routes = this.routes;
    this.worldId = worldId;
    this.openWorld = open;
    this.indexClimbs();
    // Montée choisie dans une autre zone : sélectionnée dès que sa zone est chargée.
    if (this.pendingKom && routes.some((r) => r.id === this.pendingKom?.routeId)) {
      this.s.mode = 'challenge';
      this.s.routeId = this.pendingKom.routeId;
      this.s.reverse = false;
      this.s.challengeSeg = this.pendingKom.segId;
      saveSettings(this.s);
      this.pendingKom = null;
    }
    if (!routes.some((r) => r.id === this.s.routeId)) this.s.routeId = routes[0]?.id ?? '';
    if (this.routesAfterWorld && this.picker === 'zones') this.picker = 'zone';
    // Autre zone : le parcours dessiné et le départ du libre de l'ancienne ne valent plus.
    if (worldId !== this.drawnWorld) {
      this.drawn = null;
      this.freeStart = null;
    }
    this.routesAfterWorld = false;
    this.loadingZone = '';
    if (this.root.querySelector('.mm')) this.render();
    // Monde ouvert choisi dans une autre zone : on y va dès qu'elle est chargée.
    const pendingOpen = this.pendingOpen;
    this.pendingOpen = null;
    if (pendingOpen && routes.some((r) => r.id === pendingOpen.routeId)) this.joinOpenWorld(pendingOpen.routeId, worldId, pendingOpen.friendId);
  }

  /** Rejoint le monde ouvert d'un itinéraire public, en chargeant d'abord sa zone si ce n'est pas la zone affichée. */
  private joinOpenWorld(routeId: string, worldId: string, friendId?: string): void {
    if (this.worldId !== worldId && this.onWorld) {
      this.pendingOpen = { routeId, ...(friendId ? { friendId } : {}) };
      this.loadingZone = this.zoneLabel(worldId);
      this.onWorld(worldId);
      return;
    }
    this.s.mode = 'free';
    this.s.routeId = routeId;
    this.s.reverse = false;
    saveSettings(this.s);
    this.launch(this.s, { publicRoom: true, ...(friendId ? { nearFriend: friendId } : {}) });
  }
  openWorld = false;
  /** Zone choisie dans la fenêtre « Zones » : ses parcours s'ouvrent dès qu'elle est chargée. */
  private routesAfterWorld = false;
  /** Nom de la zone en cours de chargement (affiché sur la carte de France). */
  private loadingZone = '';
  /** Carte de France de la fenêtre « Zones ». */
  private readonly franceMap = new FranceMap();
  /** Itinéraire sur la carte d'une zone ouverte (fenêtre « Parcours ») : graphe donné par `planner.setOpen`. */
  readonly planner = new RoutePlanner();
  onWorld?: (id: string) => void;
  onSettingsSaved?: (s: Settings) => void;
  /** Fenêtre de choix ouverte au milieu de l'écran (bouton « Choisir ma sortie »). */
  private picker: 'zones' | 'zone' | 'routes' | 'map' | 'route' | 'workouts' | 'koms' | null = null;
  /** Fenêtre « Défi KOM » : zone filtrée ('' = toutes) et montée d'une autre zone à choisir une fois cette zone chargée. */
  private komZone = '';
  private pendingKom: { routeId: string; segId: string } | null = null;
  /** Parcours ouvert dans sa fiche (fenêtre « route »). */
  private detailId = '';
  /** Sens montré dans la fiche du parcours (choisi au départ). */
  private detailReverse = false;
  /** Départ choisi dans la fiche (boucles) : m sur le tracé d'origine dans le sens montré, 0 = d'origine. */
  private detailStartM = 0;
  /** Fenêtre déjà affichée (l'animation d'ouverture ne se joue qu'au changement). */
  private shownPicker: string | null = null;
  /** Carte de parcours cliquée : la fiche s'ouvre en grandissant depuis elle. */
  private fromRect: DOMRect | null = null;
  /** Parcours dessiné sur la carte (zone ouverte), roulé au départ s'il est le parcours choisi. */
  private drawn: RouteData | null = null;
  /** Départ choisi sur la carte pour le roulage libre (null : départ de la zone). */
  private freeStart: { x: number; z: number } | null = null;
  /** Zone du parcours dessiné et du départ du libre. */
  private drawnWorld = '';
  /** Catalogue des zones (packs de cartes). */
  private zones: WorldCatalogue['zones'] = [];
  /** Téléchargements en cours : octets reçus / total, ou message d'erreur. */
  private readonly downloads = new Map<string, { done: number; total: number; error?: string }>();
  /** « Tout télécharger » : zones en attente, téléchargées une à une dans l'ordre. */
  private readonly queued = new Set<string>();
  private queueRunning = false;
  private lastProgressRender = 0;
  /** Onglet Amis : présence, demandes, invitations (interrogation tant que le menu est affiché). */
  private readonly friends: FriendsPanel;
  /** Monde ouvert : salles publiques par zone (affluence, amis présents). */
  private readonly openWorldPanel: OpenWorldPanel;
  /** Zone ouverte choisie dans un autre monde : rejointe dès que ce monde est chargé. */
  private pendingOpen: { routeId: string; friendId?: string } | null = null;

  constructor(root: HTMLElement, settings: Settings, routes: RouteData[], devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.allRoutes = routes;
    this.devices = devices;
    this.cb = cb;
    {
      const mine = this.routes;
      if (!this.s.routeId || !mine.some((r) => r.id === this.s.routeId)) this.s.routeId = mine[0]?.id ?? '';
    }
    this.indexClimbs();
    void loadCatalogue().then((cat) => {
      this.zones = cat?.zones ?? [];
      if (this.tab === 'ride' && this.root.querySelector('.mm')) this.render();
    });
    this.openWorldPanel = new OpenWorldPanel({
      loggedIn: () => !!this.account,
      login: () => this.onLogin?.(),
      zones: () => this.zones,
      join: (routeId, worldId, friendId) => this.joinOpenWorld(routeId, worldId, friendId),
    });
    this.friends = new FriendsPanel({
      loggedIn: () => !!this.account,
      login: () => this.onLogin?.(),
      routes,
      currentRouteId: () => routeKey(this.s),
      join: (info) => {
        // Rejoindre un ami : son mode et son itinéraire (s'il existe dans ce monde), code fourni par le serveur.
        const j = joinSettings(info, this.routes.map((r) => r.id), this.s);
        this.s.mode = j.mode;
        this.s.routeId = j.routeId;
        this.s.reverse = j.reverse;
        this.s.startM = j.startM;
        saveSettings(this.s);
        this.launch(this.s, { inviteCode: info.inviteCode });
      },
      rideWith: (ids) => {
        if (this.s.mode !== 'group' && this.s.mode !== 'race') this.s.mode = 'group';
        saveSettings(this.s);
        this.launch(this.s, { inviteFriends: ids });
      },
    });
    devices.onChange(() => {
      if (this.tab === 'devices') this.renderDevices();
      this.renderStatus();
    });
    this.atelier = new AtelierPanel(settings, {
      account: () => this.account,
      scene: (st) => this.onAtelier?.(st),
      changed: () => {
        saveSettings(this.s);
        this.onSettingsChange?.(this.s);
        this.onSettingsSaved?.(this.s);
      },
      rerender: () => this.render(),
    });
    this.progress = new ProgressPage(this.root, {
      level: () => this.account?.level ?? levelProgress(loadProgress().xp).level,
      credits: () => this.account?.credits ?? loadProgress().credits,
      look: () => this.s.look,
      cosmeticSwatch: swatch,
      bikeIcon: (colors) => bikeIcon(colors),
      openCosmetic: (item) => this.openInGarage(item),
      openTune: (id) => {
        if (this.garageSlot !== 'atelier') this.garageSlot = 'atelier';
        this.atelier.openItem(id);
        this.go('garage');
      },
      rerender: () => this.render(),
    });
  }

  /**
   * Récompense choisie dans l'onglet Progression : le garage s'ouvre sur sa catégorie, l'équipement
   * essayé sur le coureur s'il est encore verrouillé, la liste des vélos sur sa collection.
   */
  private openInGarage(item: CosmeticItem): void {
    this.garageSlot = item.slot;
    this.view = SLOT_VIEW[item.slot];
    this.yaw = 0;
    if (item.slot === 'bike') {
      const bike = bikeById(item.id);
      this.bikeFilter = bike ? bike.collection : 'divers';
      this.bikeType = 'all';
    }
    this.go('garage');
    if (item.level > levelProgress(loadProgress().xp).level) {
      this.previews.set(item.slot, item.id);
      this.sendPreview();
      this.render();
    }
    this.root.querySelector(`[data-item="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: 'center' });
  }

  /** Ouvre une rubrique des Réglages (retour de Strava : la rubrique d'envoi des sorties). */
  openSettingsSection(id: string): void {
    this.settingsOpen.add(id);
  }

  show(tab: Tab = 'home'): void {
    document.addEventListener('keydown', this.onKey);
    if (!this.mq) {
      this.mq = matchMedia('(max-width: 900px)');
      this.mq.addEventListener('change', () => this.root.querySelector('.mm') && this.tab === 'ride' && this.render());
    }
    // Au lancement du jeu et après une sortie : pas de carte du choix tant qu'on n'a rien choisi.
    this.selMap = false;
    this.friends.start();
    this.openWorldPanel.start();
    // Lien /?ami=CODE : l'onglet Amis propose la demande.
    this.go((tab === 'home' || tab === 'ride') && this.friends.hasPendingCode() ? 'friends' : tab);
  }

  hide(): void {
    if (this.garageSlot === 'atelier') this.atelier.leave();
    document.removeEventListener('keydown', this.onKey);
    this.friends.stop();
    this.openWorldPanel.stop();
    this.root.innerHTML = '';
  }

  private go(tab: Tab): void {
    this.picker = null;
    if (tab !== 'progress') this.progress.reset();
    if (tab !== 'garage' && this.previews.size) {
      this.previews.clear();
      this.onPreviewLook?.(null);
    }
    this.tab = tab;
    this.render();
    // Garage resté sur l'atelier : sa pièce 3D ; sinon la photo ou le coureur du garage.
    if (tab === 'garage' && this.garageSlot === 'atelier') return this.atelier.emit();
    if (this.garageSlot === 'atelier') this.atelier.leave();
    this.onScene?.(tab === 'garage' ? this.view : 'poster', tab === 'garage' ? this.yaw : 0, tab === 'garage' && this.garageSlot === 'bike');
  }

  /** Croix de fermeture d'un panneau (retour à l'onglet Rouler, comme Échap). */
  private closeBtn(): string {
    return `<button class="mm-close" data-tab="ride" aria-label="${fr() ? 'Fermer' : 'Close'}" title="${fr() ? 'Fermer (Échap)' : 'Close (Esc)'}">×</button>`;
  }

  /** Champ numérique avec − et + aux couleurs de l'appli (remplace les flèches du navigateur). */
  private stepper(id: string, min: number, max: number, value: number, step = 1): string {
    return `<div class="mm-stepper" data-stepper><button type="button" data-step="-1" aria-label="−" tabindex="-1">−</button><input id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value}" /><button type="button" data-step="1" aria-label="+" tabindex="-1">+</button></div>`;
  }

  /** Branche les − / + : la valeur reste dans [min, max] et le champ émet « change » comme s'il avait été saisi. */
  private bindSteppers(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('[data-stepper]').forEach((box) => {
      const input = box.querySelector('input') as HTMLInputElement;
      box.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          const step = Number(input.step) || 1;
          const min = Number(input.min);
          const max = Number(input.max);
          const v = Math.min(max, Math.max(min, Math.round(((Number(input.value) || min) + Number(b.dataset.step) * step) / step) * step));
          input.value = String(Number(v.toFixed(2)));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }),
      );
    });
  }

  /** Choix en boutons segmentés (remplace les listes déroulantes du système). */
  /**
   * Heure et météo de la sortie (onglet Rouler, tous les modes) : heure de départ, ciel, vent, météo
   * fixe ou qui évolue. En groupe, celles du créateur s'appliquent à tous.
   */
  private weatherHtml(): string {
    const s = this.s;
    const L = fr();
    // Préréglage le plus proche des curseurs (Réglages), s'il y en a un.
    const near = WEATHER_PRESETS.map(([id, w]) => [id, Math.abs(w.clouds - s.clouds) + Math.abs(w.rain - s.rain) + Math.abs(w.fog - s.fog)] as const).sort((a, b) => a[1] - b[1])[0];
    const sky = near && near[1] < 0.35 ? near[0] : '';
    const wind = String(WIND_STEPS.reduce((best, v) => (Math.abs(v - s.windMs) < Math.abs(best - s.windMs) ? v : best), WIND_STEPS[0] as number));
    // Replié par défaut : le titre rappelle l'heure choisie ; l'état ouvert / fermé est mémorisé comme dans les Réglages.
    return `<details class="set-sec" data-sec="weather" ${this.settingsOpen.has('weather') ? 'open' : ''}><summary>${L ? 'Heure et météo de la sortie' : 'Ride time and weather'} <span style="text-transform:none;letter-spacing:0;font-weight:500;opacity:.8;margin-left:auto">${this.hourLabel(s.hour)}</span></summary><div class="set-body"><div class="mm-weather">
      <label class="field">${L ? 'Heure de départ' : 'Start time'} <span id="m-hourv">${this.hourLabel(s.hour)}</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
      <div class="field">${L ? 'Conditions' : 'Conditions'}${this.seg('m-realwx', s.realWeather ? '1' : '0', [
        ['0', L ? 'Réglées' : 'Custom'],
        ['1', L ? 'Du jour (réelles)' : 'Today (real)'],
      ])}</div>
      ${
        s.realWeather
          ? `<p class="hw-hint">${L ? 'Ciel, pluie, brouillard et vent réels autour du départ, à l’heure choisie (prévision du jour <a href="https://open-meteo.com" target="_blank" rel="noopener" style="color:inherit">Open-Meteo</a>). Sans réseau : conditions réglées.' : 'Real sky, rain, fog and wind around the start, at the chosen time (today’s <a href="https://open-meteo.com" target="_blank" rel="noopener" style="color:inherit">Open-Meteo</a> forecast). Offline: custom conditions.'}</p>`
          : `<div class="field">${L ? 'Ciel' : 'Sky'}${this.seg('m-wx', sky, [
        ['sun', L ? '☀ Soleil' : '☀ Sunny'],
        ['cloudy', L ? '☁ Nuageux' : '☁ Cloudy'],
        ['rain', L ? '🌧 Pluie' : '🌧 Rain'],
        ['fog', L ? '🌫 Brouillard' : '🌫 Fog'],
      ])}</div>
      <div class="field">${L ? 'Vent' : 'Wind'}${this.seg('m-wind', wind, [
        ['0', L ? 'Calme' : 'Calm'],
        ['3', L ? 'Léger' : 'Light'],
        ['6', L ? 'Moyen' : 'Moderate'],
        ['10', L ? 'Fort' : 'Strong'],
      ])}</div>
      <div class="field">${L ? 'Météo' : 'Weather'}${this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [
        ['0', L ? 'Fixe' : 'Fixed'],
        ['1', L ? 'Qui évolue' : 'Changing'],
      ])}</div>`
      }
    </div></div></details>`;
  }

  /** Niveau des coureurs IA, en part de la FTP du joueur (chacun varie ensuite autour, forme du jour comprise). */
  private aiLevelSeg(): string {
    const L = fr();
    const levels: Array<[number, string, string]> = [
      [0.7, 'Facile', 'Easy'],
      [0.85, 'Modéré', 'Moderate'],
      [1, 'À ton niveau', 'Your level'],
      [1.15, 'Fort', 'Strong'],
      [1.3, 'Pro', 'Pro'],
    ];
    const cur = levels.reduce((b, l) => (Math.abs(l[0] - this.s.aiLevel) < Math.abs(b[0] - this.s.aiLevel) ? l : b), levels[2] as [number, string, string]);
    return this.seg(
      'm-ailevel',
      String(cur[0]),
      levels.map(([v, f, e]) => [String(v), `${L ? f : e} · ${Math.round(v * 100)} %`]),
    );
  }

  private seg(id: string, current: string, opts: Array<[string, string]>): string {
    return `<div class="mm-seg" id="${id}" data-value="${esc(current)}" role="radiogroup">${opts
      .map(([v, label]) => `<button type="button" role="radio" aria-checked="${v === current}" class="${v === current ? 'on' : ''}" data-v="${esc(v)}">${esc(label)}</button>`)
      .join('')}</div>`;
  }

  /** Branche les boutons segmentés : valeur lue comme un <select> (propriété value + événement change). */
  private bindSegs(scope: ParentNode): void {
    scope.querySelectorAll<HTMLElement>('.mm-seg').forEach((box) => {
      Object.defineProperty(box, 'value', { configurable: true, get: () => box.dataset.value ?? '' });
      box.querySelectorAll<HTMLButtonElement>('[data-v]').forEach((b) =>
        b.addEventListener('click', () => {
          box.dataset.value = b.dataset.v ?? '';
          box.querySelectorAll('[data-v]').forEach((x) => {
            x.classList.toggle('on', x === b);
            x.setAttribute('aria-checked', String(x === b));
          });
          box.dispatchEvent(new Event('change'));
        }),
      );
    });
  }

  /** Tenue du coureur avec un équipement à couleur appliqué (aperçu). */
  /** Tenue affichée au garage : celle équipée, avec les essais en cours par-dessus. */
  currentLook(): AvatarLook {
    let look = this.s.look;
    for (const id of this.previews.values()) {
      const item = COSMETICS.find((c) => c.id === id);
      if (item) look = this.lookWith(item, look);
    }
    return look;
  }

  private sendPreview(): void {
    this.onPreviewLook?.(this.previews.size ? this.currentLook() : null);
  }

  private lookWith(item: CosmeticItem, base: AvatarLook = this.s.look): AvatarLook {
    const look = { ...base };
    if (item.slot === 'helmet') return helmetLookOf(item, look);
    if (item.slot === 'glasses') return glassesLookOf(item, look);
    if (item.color) {
      if (item.slot === 'jersey') Object.assign(look, jerseyLookOf(item));
      if (item.slot === 'bike') look.bike = item.color;
      if (item.slot === 'socks') look.socks = item.color;
    }
    if (item.slot === 'bike') {
      // Modèle du catalogue (cadre, livrée) ou VTT / gravel : le type de pneus suit l'équipement.
      look.bikeType = item.physics?.tyre ?? 'road';
      if (bikeById(item.id)) look.bikeModel = item.id;
      else delete look.bikeModel;
      // Vélo essayé : avec sa propre livrée, sans la peinture de l'atelier.
      if (look.tune?.length) look.tune = look.tune.filter((id) => tuneItem(id)?.slot !== 'paint');
    }
    return look;
  }

  private opt<T extends string>(value: T, current: string, label: string): string {
    return `<option value="${value}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  }

  private routeName(r: RouteData): string {
    return getLang() === 'en' && r.nameEn ? r.nameEn : r.name;
  }

  /** 9,25 → « 9 h 15 ». */
  private hourLabel(h: number): string {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${hh} h ${String(mm).padStart(2, '0')}`;
  }

  private km(m: number): string {
    return (m / 1000).toFixed(1).replace('.', fr() ? ',' : '.');
  }

  /** Durée indicative à allure d'endurance (≈ 26 km/h à plat, plus 1 h par 700 m de D+). */
  private eta(r: RouteData): string {
    const h = r.lengthM / 26000 + r.elevationGainM / 700;
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
  }

  private modes(): Array<[Settings['mode'], I18nKey, string]> {
    return fr()
      ? [
          ['free', 'free', 'Rouler seul, à son rythme.'],
          ['group', 'group', 'Rouler à plusieurs : le groupe reste ensemble.'],
          ['race', 'race', 'Course en ligne, classement à l’arrivée.'],
          ['workout', 'workout', 'Séance structurée en mode ERG : séances intégrées ou fichier .zwo, .erg, .mrc.'],
          ['ftpTest', 'ftpTest', 'Test rampe : paliers d’une minute jusqu’à épuisement, pour estimer ta FTP.'],
          ['challenge', 'challenge', 'Bats ton record sur une montée : départ lancé, fantôme de ton meilleur temps, écart en direct.'],
        ]
      : [
          ['free', 'free', 'Ride on your own, at your own pace.'],
          ['group', 'group', 'Ride together: the group stays as one.'],
          ['race', 'race', 'Online race, results at the finish.'],
          ['workout', 'workout', 'Structured session in ERG mode: built-in workouts or a .zwo, .erg, .mrc file.'],
          ['ftpTest', 'ftpTest', 'Ramp test: one-minute steps to exhaustion, to estimate your FTP.'],
          ['challenge', 'challenge', 'Beat your record on a climb: flying start, ghost of your best time, live gap.'],
        ];
  }

  // ————————————————————————————————————————————— Cadre commun

  private render(): void {
    const L = fr();
    const tabs: Array<[Tab, string]> = [
      ['ride', t('ride')],
      ['garage', 'Garage'],
      ['progress', L ? 'Progression' : 'Progress'],
      ['profile', t('profile')],
      ['friends', L ? 'Amis' : 'Friends'],
      ['devices', t('devices')],
      ['settings', t('settings')],
    ];
    const p = loadProgress();
    // Vélo changé au garage : le parcours choisi doit être de son type
    if (this.s.mode !== 'free' && this.allRoutes.length && !this.routes.some((r) => r.id === this.s.routeId)) this.s.routeId = this.routes[0]?.id ?? '';
    const lp = levelProgress(p.xp);
    const level = this.account?.level ?? lp.level;
    const name = this.account?.name ?? this.s.name;
    const initials = name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    // Accueil : rien que la vidéo, le titre et le bouton Rouler, qui ouvre le menu. Le bouton n'apparaît qu'une fois le
    // garage chargé en mémoire (barre d'attente à sa place) : le garage et le tutoriel s'ouvrent alors sans attente.
    if (this.tab === 'home') {
      const wait = `<div class="mm-home-wait" role="status"><div class="world-wait-bar"><i></i></div><span>${L ? 'Chargement du garage…' : 'Loading the garage…'} <b class="mm-home-wait-pct">${this.garageProgress > 0 ? `${Math.round(this.garageProgress * 100)} %` : ''}</b></span></div>`;
      this.root.innerHTML = `<div class="mm mm-tab-home">
        <div class="mm-hero mm-hero-home"><h1>Allez <em>Robert</em> !</h1><p>${L ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>
        ${this.garageReady ? `<button class="mm-go mm-home-go" data-tab="ride">${t('ride')}</button>` : wait}
      </div>`;
      this.bind();
      return;
    }
    const body: Record<Tab, () => string> = {
      home: () => '',
      ride: () => this.rideHtml(),
      friends: () => this.friends.html(),
      garage: () => this.garageHtml(),
      devices: () =>
        `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}<header class="mm-head"><h2>${t('devices')}</h2><p>${L ? 'Associe ton home trainer et tes capteurs. Une seule appli à la fois par capteur Bluetooth.' : 'Pair your trainer and sensors. One app at a time per Bluetooth sensor.'}</p></header><div id="m-devices"></div></section>`,
      progress: () => this.progress.html(this.closeBtn()),
      profile: () => this.profileHtml(),
      settings: () => this.settingsHtml(),
    };
    // Liste longue (vélos) : même panneau, même position de défilement après un nouveau rendu.
    const key = `${this.tab}/${this.garageSlot}/${this.bikeFilter}/${this.bikeType}`;
    const scroll = key === this.panelKey ? ((this.root.querySelector('.gr-body') ?? this.root.querySelector('.mm-side'))?.scrollTop ?? 0) : 0;
    this.panelKey = key;
    // Fenêtre des séances : même défilement après une étoile ; à l'ouverture, la séance choisie en vue.
    const wkKey = this.picker === 'workouts' ? this.wkFilter : null;
    const wkScroll = wkKey !== null && wkKey === this.wkScrollKey ? (this.root.querySelector('.mm-wks-grid')?.scrollTop ?? 0) : null;
    this.wkScrollKey = wkKey;
    // Arrivée dans le garage : le panneau glisse en place une seule fois (pas à chaque nouveau rendu).
    const enter = this.tab === 'garage' && !this.garageEntered;
    this.garageEntered = this.tab === 'garage';
    this.root.innerHTML = `<div class="mm mm-tab-${this.tab}${enter ? ' mm-enter' : ''}">
      <header class="mm-top">
        <button class="mm-brand" data-tab="home" title="${L ? 'Accueil' : 'Home'}">Allez <em>Robert</em> !</button>
        <nav class="mm-tabs">${tabs.map(([id, label]) => `<button class="mm-tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}${id === 'friends' ? this.friends.badgeHtml() : ''}</button>`).join('')}
          <button class="mm-tab subtle" id="m-tuto">${L ? 'Tutoriel' : 'Tutorial'}</button></nav>
        <div class="mm-right">
          ${this.musicInHero() ? '' : '<div class="mm-music" id="m-music"></div>'}
          <div class="mm-account">
            <div class="mm-avatar mm-me" data-tab="profile" role="button" title="${L ? 'Mon profil' : 'My profile'}" style="background:${this.s.look.jersey}">${esc(initials || 'R')}</div>
            <div class="mm-who mm-me" data-tab="profile" role="button" title="${L ? 'Mon profil' : 'My profile'}"><b>${esc(name)}</b>
              <span>${L ? 'Niveau' : 'Level'} ${level}<i class="mm-xp"><i style="width:${(lp.progress * 100).toFixed(0)}%"></i></i><em class="mm-credits" title="${L ? 'Crédits (atelier)' : 'Credits (workshop)'}">${COIN} ${(this.account?.credits ?? p.credits).toLocaleString(L ? 'fr-FR' : 'en-GB')}</em></span></div>
            ${this.account ? `<button class="mm-link" id="m-logout">${L ? 'Déconnexion' : 'Sign out'}</button>` : `<button class="mm-link" id="m-login">${L ? 'Se connecter' : 'Sign in'}</button>`}
          </div>
        </div>
      </header>
      ${body[this.tab]()}
      <div id="m-friendbar"></div>
      <footer class="mm-foot">
        <div class="mm-status" id="m-status"></div>
        ${this.tab === 'ride' ? `<button id="m-start" class="mm-go">${t('ride')}</button>` : `<button class="mm-go ghost" data-tab="ride">← ${t('ride')}</button>`}
      </footer>
    </div>`;
    if (this.tab === 'devices') this.renderDevices();
    const side = this.root.querySelector('.gr-body') ?? this.root.querySelector('.mm-side');
    if (side) side.scrollTop = scroll;
    const wks = this.root.querySelector<HTMLElement>('.mm-wks-grid');
    const wkOn = wks?.querySelector<HTMLElement>('.mm-wk.on');
    if (wks) wks.scrollTop = wkScroll ?? (wkOn ? wkOn.offsetTop - (wks.clientHeight - wkOn.offsetHeight) / 2 : 0);
    this.renderStatus();
    this.renderMusic();
    renderSoundSettings(this.root.querySelector('#m-sound-settings'));
    renderCompanionSettings(this.root.querySelector('#m-companion-settings'));
    renderStravaLink(this.root.querySelector('#m-strava-link'), !!this.account);
    this.renderZonesSettings();
    renderExpertSettings(this.root.querySelector('#m-expert-settings'));
    // Rubriques repliables des Réglages : on retient celles qui sont ouvertes (l'écran est redessiné à chaque changement).
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('details.set-sec')) {
      d.addEventListener('toggle', () => {
        const id = d.dataset.sec ?? '';
        if (d.open) this.settingsOpen.add(id);
        else this.settingsOpen.delete(id);
        localStorage.setItem('ar.settingsOpen2', JSON.stringify([...this.settingsOpen]));
      });
    }
    this.bind();
    if (this.tab === 'progress') this.progress.bind();
    enhanceSelects(this.root);
    // Miniatures de vélos : le dessin d'avant remplace une photo manquante ; le vélo sans marque prend sa couleur.
    swapMissingThumbs(this.root, (colors, big) => bikeIcon(colors, big));
    void paintPlainThumbs(this.root, (cv) => (cv.outerHTML = bikeIcon([cv.dataset.plainthumb ?? '#7a8594'], cv.classList.contains('big'))));
    this.friends.mount(this.root, this.tab === 'friends');
    this.historyPanel.mount(this.tab === 'profile' && this.profileView === 'history' ? this.root.querySelector<HTMLElement>('#m-history') : null, { massKg: this.s.massKg, loggedIn: !!this.account });
    this.openWorldPanel.mount(this.root);
  }

  /** Pied de page : état des capteurs (cliquable vers l'onglet Capteurs). Les raccourcis sont dans le menu pause. */
  private renderStatus(): void {
    const box = this.root.querySelector('#m-status');
    if (!box) return;
    const real = this.devices.list().filter((d) => d.ok && !d.simulated);
    const sim = this.devices.simulatorOn() && !real.length;
    const chips = real.length
      ? real.map((d) => `<span class="mm-chip ok">${esc(d.name)}</span>`).join('')
      : sim
        ? `<span class="mm-chip sim">${fr() ? 'Simulateur (sans matériel)' : 'Simulator (no hardware)'}</span>`
        : `<span class="mm-chip warn">${fr() ? 'Aucun capteur' : 'No sensor'}</span>`;
    box.innerHTML = `<button class="mm-chips" title="${t('devices')}">${chips}</button>`;
    box.querySelector('.mm-chips')?.addEventListener('click', () => this.go('devices'));
  }

  // ————————————————————————————————————————————— Rouler

  private rideHtml(): string {
    const s = this.s;
    const L = fr();
    const r = this.routes.find((x) => x.id === s.routeId) ?? this.routes[0];
    // Roulage libre (choisi dans la fenêtre de la zone) : une sortie libre.
    const shown = s.mode === 'open' ? 'free' : s.mode;
    const mode = this.modes().find(([m]) => m === shown);
    const tag = MODE_TAGS[L ? 'fr' : 'en'];
    return `<section class="mm-panel mm-left">
      <header class="mm-head"><h2>${L ? 'Que veux-tu faire ?' : 'What do you want to do?'}</h2></header>
      <div id="m-openworld" class="ow" hidden></div>
      <div class="mm-modes">${this.modes()
        .map(
          ([v, k]) =>
            `<button class="mm-mode ${v === shown ? 'on' : ''}" data-mode="${v}" style="--c:${MODE_COLORS[v] ?? '#ffd23f'}"><span class="mm-mode-ico">${ICON[v]}</span><b>${esc(t(k))}</b></button>`,
        )
        .join('')}</div>
      <p class="mm-hint">${s.mode === 'open' ? (L ? 'Parcours libre : ← / → pour choisir ta direction à chaque carrefour, U pour faire demi-tour.' : 'Free ride: ← / → to pick your way at each junction, U to turn around.') : mode ? esc(mode[2]) : ''}</p>
      ${this.weatherHtml()}
      ${
        s.mode === 'group' || s.mode === 'race'
          ? `<input id="m-invite" class="mm-input" placeholder="${L ? 'Code d’invitation (facultatif)' : 'Invite code (optional)'}" />${
              // Course sur une boucle : nombre de tours (créateur de la course).
              s.mode === 'race' && r?.loop ? `<div class="mm-steprow"><span>${L ? 'Tours de la course' : 'Race laps'}</span>${this.stepper('m-laps', 1, 20, s.raceLaps)}</div>` : ''
            }
            <div class="mm-groupopts">
              ${
                s.mode === 'race'
                  ? `<div class="mm-steprow"><span>${L ? 'Coureurs IA' : 'AI riders'}</span>${this.stepper('m-ai', 0, 19, s.aiRiders)}</div>
              <div class="field">${L ? 'Niveau des IA (part de ta FTP)' : 'AI level (share of your FTP)'}${this.aiLevelSeg()}</div>
              <p class="mm-hint">${L ? 'Chaque IA a sa tactique (baroudeur, attentiste, grimpeur, équipier) et sa forme du jour ; une échappée reprise à bout de forces se paie.' : 'Each AI has its own tactic (breakaway artist, wheelsucker, climber, domestique) and form of the day; a spent breakaway pays for it.'}</p>`
                  : ''
              }
              ${
                s.mode === 'group'
                  ? `<div class="mm-steprow"><span>${L ? 'Coureurs IA' : 'AI riders'}</span>${this.stepper('m-ai', 0, 19, s.aiRiders)}</div>
              <div class="field">${L ? 'Vitesse moyenne visée (IA)' : 'Target average speed (AI)'}${this.seg('m-target', String(s.groupTargetKmh), [
                      ['0', L ? 'Libre' : 'Free'],
                      ...[22, 25, 28, 30, 32, 35].map((v): [string, string] => [String(v), `${v} km/h`]),
                    ])}</div>
              <p class="mm-hint">${L ? 'Les IA règlent leur effort pour tenir cette moyenne sur la sortie ; l’organisateur peut l’augmenter en route.' : 'AI riders pace themselves to hold this average over the ride; the host can raise it on the road.'}</p>`
                  : ''
              }
              <div class="field">${L ? 'Équipement égalisé' : 'Equal equipment'}${this.seg('m-equal', (s.equalEquipment ?? s.mode === 'race') ? '1' : '0', [
                ['1', L ? 'Oui : même vélo pour tous' : 'Yes: same bike for all'],
                ['0', L ? 'Non : pièces de l’atelier' : 'No: workshop parts'],
              ])}</div>
              <p class="mm-hint">${L ? 'Si tu crées la sortie, ton heure, ta météo et l’égalisation s’appliquent à tout le groupe.' : 'If you create the ride, your time, weather and equipment rule apply to the whole group.'}</p>
            </div>`
          : s.mode === 'challenge'
            ? this.challengeChoiceHtml(r)
          : s.mode === 'workout'
            ? this.workoutChoiceHtml()
            : ''
      }
      ${
        s.mode === 'ftpTest'
          ? this.ftpTestHtml()
          : s.mode === 'workout' || s.mode === 'challenge'
            ? ''
            : `<h3 class="mm-where">${L ? 'Où rouler ?' : 'Where to ride?'}</h3>${this.pickersHtml(r)}`
      }
    </section>
    <div class="mm-hero">${this.musicInHero() ? '<div class="mm-music mm-hero-music" id="m-music"></div>' : ''}<h1>Allez <em>Robert</em> !</h1><p>${L ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>
    ${this.pickerHtml()}`;
  }

  /** Liste déroulante des nationalités, drapeau devant chaque pays (le <select> du navigateur n'affiche pas d'images). */
  private nationHtml(): string {
    const L = fr();
    const cur = COUNTRIES.find((c) => c.code === this.s.look.nationality);
    const item = (code: string, label: string) => `<button type="button" role="option" class="mm-dd-opt${code === (cur?.code ?? '') ? ' on' : ''}" data-nation="${code}">${code ? flagSvg(code, 15) : '<i class="mm-dd-none"></i>'}<span>${esc(label)}</span></button>`;
    return `<div class="mm-dd" id="m-nation"><button type="button" class="mm-dd-btn" aria-haspopup="listbox">${cur ? flagSvg(cur.code, 15) : '<i class="mm-dd-none"></i>'}<span>${esc(cur ? cur[L ? 'fr' : 'en'] : L ? 'Choisir mon pays' : 'Choose my country')}</span><em>▾</em></button><div class="mm-dd-list" role="listbox" hidden>${item('', L ? 'Aucune' : 'None')}${COUNTRIES.map((c) => item(c.code, c[L ? 'fr' : 'en'])).join('')}</div></div>`;
  }

  /** Lecteur au-dessus du titre (onglet Rouler, écran large) ; sinon dans la barre du haut (petits écrans, autres onglets). */
  private musicInHero(): boolean {
    // Le lecteur reste dans la barre du haut (jamais au-dessus du titre) ; seul l'accueil, sans barre, le pose en coin.
    return false;
  }

  /** Séance choisie (carte seule, un clic rouvre la liste au milieu de l'écran) ou fichier importé. */
  private workoutChoiceHtml(): string {
    const L = fr();
    const w = WORKOUT_LIBRARY.find((x) => x.id === this.s.workoutPreset) ?? WORKOUT_LIBRARY[0];
    const current = this.workoutFile
      ? `<button class="mm-wk on" data-picker="workouts" style="--wk:#9aa5b1"><span class="mm-wk-head"><b>${esc(this.workoutFile.name.replace(/\.json$/i, ''))}</b></span><span class="mm-wk-desc">${L ? 'Ma séance' : 'My workout'}</span></button>`
      : w
        ? workoutCard(w, true, 'workouts')
        : '';
    return `<div class="mm-wks">${current}</div>
      <button class="mm-link" data-picker="workouts">${L ? 'Changer de séance' : 'Change workout'}</button>`;
  }

  /** Fenêtre « Séances » au milieu de l'écran, comme la carte de France : séances intégrées et import de fichier. */
  private workoutsHtml(): string {
    const L = fr();
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker wk-dialog" role="dialog" aria-modal="true">
        <header><h2>${L ? 'Choisis ta séance' : 'Choose your workout'}</h2><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        <div class="wk-filter">${(['', ...WORKOUT_TYPES, 'mine'] as Array<WorkoutType | 'mine' | ''>)
          .map((f) => {
            const n = f === '' ? WORKOUT_LIBRARY.length : f === 'mine' ? this.favWorkouts.size + this.myWorkouts.length : WORKOUT_LIBRARY.filter((w) => w.type === f).length;
            const label = f === '' ? (L ? 'Toutes' : 'All') : f === 'mine' ? `★ ${L ? 'Mes séances' : 'My workouts'}` : WORKOUT_TYPE_LABELS[f][L ? 'fr' : 'en'];
            const dot = f && f !== 'mine' ? `<i style="background:${TYPE_COLORS[f]}"></i>` : '';
            return `<button class="wk-chip${f === this.wkFilter ? ' on' : ''}" data-wkfilter="${f}">${dot}${label}${n ? ` <small>${n}</small>` : ''}</button>`;
          })
          .join('')}</div>
        <div class="mm-wks mm-wks-grid">${
          this.wkFilter === 'mine'
            ? (() => {
                const favs = WORKOUT_LIBRARY.filter((w) => this.favWorkouts.has(w.id));
                const mine = this.myWorkouts.map((w) => storedAsLibrary(w));
                if (!favs.length && !mine.length) return `<p class="mm-hint">${L ? 'Ajoute des séances à tes favoris avec l’étoile ☆ ; les séances que tu importes (.zwo, .erg, .mrc) sont aussi gardées ici.' : 'Star ☆ workouts to add them to your favourites; workouts you import (.zwo, .erg, .mrc) are kept here too.'}</p>`;
                return [
                  ...favs.map((w) => workoutCard(w, !this.workoutFile && w.id === this.s.workoutPreset, undefined, true)),
                  ...mine.map((w) => workoutCard(w, this.workoutFile?.name === `${w.name.fr}.json`, undefined, this.favWorkouts.has(w.id))),
                ].join('');
              })()
            : // Toutes : rangées par type, de la plus facile à la plus dure, chaque type sous son titre.
              (this.wkFilter ? [this.wkFilter] : WORKOUT_TYPES)
                .map((type) => {
                  const list = WORKOUT_LIBRARY.filter((w) => w.type === type);
                  if (!list.length) return '';
                  const head = this.wkFilter ? '' : `<h3 class="wk-sec" style="--wk:${TYPE_COLORS[type]}">${WORKOUT_TYPE_LABELS[type][L ? 'fr' : 'en']}<small>${list.length}</small></h3>`;
                  return head + list.map((w) => workoutCard(w, !this.workoutFile && w.id === this.s.workoutPreset, undefined, this.favWorkouts.has(w.id))).join('');
                })
                .join('')
        }</div>
        <label class="mm-file">${L ? 'Ou importer une séance' : 'Or import a workout'} (.zwo / .erg / .mrc)<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /><span id="m-wname">${this.workoutFile ? esc(this.workoutFile.name) : ''}</span></label>
      </div></div>`;
  }

  /** Test FTP : déroulé du test rampe (pas de choix de zone ni de parcours). */
  private ftpTestHtml(): string {
    const L = fr();
    const steps = L
      ? [
          ['Échauffement', '5 min à 100 W, mode ERG : le home trainer impose la puissance.'],
          ['Paliers', '+20 W chaque minute. Garde une cadence régulière, autour de 85–95 tr/min.'],
          ['Jusqu’au bout', 'Arrête-toi quand tu ne tiens plus le palier : c’est la fin du test (souvent 15 à 25 min).'],
          ['Résultat', 'FTP = 75 % de ta meilleure minute. Elle est proposée à la fin et règle tes zones et tes séances.'],
        ]
      : [
          ['Warm-up', '5 min at 100 W in ERG mode: the trainer sets the power.'],
          ['Steps', '+20 W every minute. Keep a steady cadence, around 85–95 rpm.'],
          ['To the end', 'Stop when you can no longer hold the step: that ends the test (often 15–25 min).'],
          ['Result', 'FTP = 75% of your best minute. It is offered at the end and sets your zones and workouts.'],
        ];
    return `<div class="mm-ftptest">
      <h3>${L ? 'Comment se passe le test' : 'How the test works'}</h3>
      <ol>${steps.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
      <p class="mm-hint">${L ? `FTP actuelle : ${Math.round(this.s.ftpWatts)} W. Bien reposé, ventilateur allumé, bidon à portée de main.` : `Current FTP: ${Math.round(this.s.ftpWatts)} W. Be rested, fan on, bottle within reach.`}</p>
    </div>`;
  }

  /** Parcours dessiné, s'il est le parcours choisi (et pas en roulage libre). */
  private get drawnChoice(): RouteData | null {
    return this.s.mode !== 'open' && this.drawn && this.drawn.id === this.s.routeId ? this.drawn : null;
  }

  /**
   * Un bouton (carte de France → zone → parcours, libre ou à dessiner), puis la carte de ce qui est
   * choisi : tracé du parcours (sur les routes de la zone si elle est ouverte) ou départ du libre.
   */
  private pickersHtml(r: RouteData | undefined): string {
    const L = fr();
    const lang = getLang();
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const zone = w ? w.name[lang] : (ZONE_SPOTS.find((x) => x.id === this.worldId)?.name[lang] ?? this.worldId);
    const free = this.s.mode === 'open';
    const drawn = this.drawnChoice;
    const route = free ? null : (drawn ?? r ?? null);
    const what = free ? (L ? 'Parcours libre' : 'Free ride') : drawn ? (L ? 'Parcours dessiné' : 'Drawn route') : route ? this.routeName(route) : '';
    const stats = route
      ? `${this.km(route.lengthM)} km · ${Math.round(route.elevationGainM)} m D+${route.loop ? (L ? ' · boucle' : ' · loop') : ''}`
      : free
        ? L
          ? 'Choisis ta route à chaque carrefour'
          : 'Pick your road at each junction'
        : '';
    // Entraînement : pas de carte (la séance compte, pas le paysage) ; sinon seulement après un choix.
    const map = this.openWorld && this.selMap && this.s.mode !== 'workout' ? this.planner.preview(route, free ? this.freeStart : null) : '';
    const body = map ? `<div class="mm-selmap">${map}</div>` : route ? this.routeCard(route) : '';
    const pickers = `<div class="mm-pickers mm-pickers-one">
      <button class="mm-pick mm-pick-big" data-picker="zones"><b>${L ? 'CHOISIR MA SORTIE' : 'CHOOSE MY RIDE'}</b></button>
    </div>`;
    // Sans carte de la zone, la fiche du parcours porte déjà son nom et ses chiffres.
    const head = map || !route ? `<b>${esc(what)}</b><span>${esc(stats)}</span>` : '';
    return `${pickers}
    ${what ? `<button class="mm-sel" data-picker="zone" title="${L ? 'Changer de parcours' : 'Change route'}"><span class="mm-sel-head"><small>${esc(zone)}</small>${head}</span>${body}</button>` : ''}`;
  }

  /** Fenêtre centrée : liste des zones (avec leurs packs) ou des parcours de la zone. */
  private pickerHtml(): string {
    if (!this.picker) return '';
    const L = fr();
    // Zone ouverte choisie : sa carte, où l'on trace son itinéraire (ou roulage libre).
    if (this.picker === 'map') {
      const w = WORLD_LIST.find((x) => x.id === this.worldId);
      return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker" role="dialog" aria-modal="true">
        <header><h2>${esc(w ? w.name[getLang()] : this.worldId)}</h2><span class="rp-head-links"><button class="mm-link" data-picker="zone">← ${L ? 'Choix de la zone' : 'Area choices'}</button></span><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        ${this.planner.html((r) => this.routeCard(r))}
      </div></div>`;
    }
    if (this.picker === 'zones') return this.franceHtml();
    if (this.picker === 'workouts') return this.workoutsHtml();
    if (this.picker === 'koms') return this.komsHtml();
    if (this.picker === 'route') return this.routeDetailWindow();
    if (this.picker === 'zone') return this.zoneHtml();
    // Parcours fixés de la zone (cartes), avec retour aux choix de la zone ou à la carte de France.
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const list = `<div class="mm-cardgrid">${this.routes
      .map(
        (x) => `<button class="mm-routepick ${x.id === this.s.routeId ? 'on' : ''}" data-route="${esc(x.id)}">
            ${this.routeCard(x)}
            <span class="mm-routetag">${x.loop ? (L ? 'Boucle' : 'Loop') : L ? 'Aller simple' : 'One way'}${x.id === this.s.routeId ? ` · ${L ? 'choisi' : 'selected'}${this.s.reverse ? (L ? ', sens inverse' : ', reversed') : ''}${this.s.startM > 0 ? (L ? ', départ déplacé' : ', moved start') : ''}` : ''}</span></button>`,
      )
      .join('')}</div>
        ${this.onExplore ? `<button id="m-explore" class="mm-explore">${ICON.explore}<span><b>${L ? 'Explorer la carte' : 'Explore the map'}</b><small>${L ? 'Caméra libre, sans rouler · Échap pour revenir' : 'Free camera, no riding · Esc to come back'}</small></span></button>` : ''}`;
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker" role="dialog" aria-modal="true">
        <header><h2>${L ? 'Parcours' : 'Routes'}${w ? ` — ${esc(w.name[getLang()])}` : ''}</h2><span class="rp-head-links"><button class="mm-link" data-picker="zone">← ${L ? 'Choix de la zone' : 'Area choices'}</button></span><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        ${list}
      </div></div>`;
  }

  /** Fiche d'un parcours : carte, profil, montées, records (les temps du serveur arrivent ensuite). */
  private routeDetailWindow(): string {
    const L = fr();
    const base = this.routes.find((x) => x.id === this.detailId);
    if (!base) return '';
    const r = this.detailRoute(base);
    const chosen = base.id === this.s.routeId && this.s.reverse === this.detailReverse && (this.s.startM || 0) === this.detailStartM;
    const dir = canReverse(base)
      ? this.seg('rd-dir', this.detailReverse ? '1' : '0', [
          ['0', L ? 'Sens normal' : 'Normal'],
          ['1', L ? 'Sens inverse' : 'Reversed'],
        ])
      : '';
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker rd-dialog" role="dialog" aria-modal="true">
        <header><h2>${esc(this.routeName(base))}</h2><span class="rd-head-tag">${r.loop ? (L ? 'Boucle' : 'Loop') : L ? 'Aller simple' : 'One way'}</span>${dir}<span class="rp-head-links"><button class="mm-link" data-picker="routes">← ${L ? 'Parcours' : 'Routes'}</button>${chosen ? '' : `<button class="mm-link" data-rd="pick">${L ? 'Choisir sans partir' : 'Select without riding'}</button>`}</span><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        ${routeDetailHtml(r, this.routeName(r), { loggedIn: !!this.account, start: { movable: canMoveStart(this.detailDir(base)), startM: this.detailStartM } })}
      </div></div>`;
  }

  /** Parcours de la fiche dans le sens choisi (records et montées de ce sens). */
  private detailDir(base: RouteData): RouteData {
    return this.detailReverse && canReverse(base) ? reversedOf(base) : base;
  }

  /** Parcours de la fiche dans le sens choisi, depuis le départ choisi (distances, profil, villages, montées). */
  private detailRoute(base: RouteData): RouteData {
    return startedOf(this.detailDir(base), this.detailStartM);
  }

  /**
   * Ouverture d'une fenêtre : la fiche d'un parcours grandit depuis la carte cliquée, les autres
   * fenêtres apparaissent en fondu ; rien ne bouge quand la même fenêtre est seulement redessinée.
   */
  private animatePicker(): void {
    const key = this.picker ? `${this.picker}:${this.picker === 'route' ? this.detailId : ''}` : null;
    if (key === this.shownPicker) return;
    this.shownPicker = key;
    const dlg = this.root.querySelector<HTMLElement>('.mm-picker');
    if (!dlg) return;
    const from = this.fromRect;
    this.fromRect = null;
    if (this.picker === 'route' && from && dlg.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const to = dlg.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top + from.height / 2 - (to.top + to.height / 2);
      dlg.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.4, borderRadius: '24px' },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
      return;
    }
    dlg.classList.add('mm-anim-in');
  }

  private closePicker(): void {
    this.picker = null;
    this.render();
  }

  /** Montées chronométrées de la zone affichée (toutes ses routes, une fois chacune, celle du parcours choisi d'abord). */
  private zoneClimbs(r: RouteData | undefined): Array<{ route: RouteData; k: RouteSegment }> {
    const ordered = r ? [r, ...this.routes.filter((x) => x.id !== r.id)] : this.routes;
    const seen = new Set<string>();
    const koms: Array<{ route: RouteData; k: RouteSegment }> = [];
    for (const route of ordered)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          koms.push({ route, k });
        }
    return koms;
  }

  /** Panneau de gauche du mode Défi KOM : la montée choisie et son record, un clic rouvre le tableau. */
  private challengeChoiceHtml(r: RouteData | undefined): string {
    const L = fr();
    const koms = this.zoneClimbs(r);
    if (!koms.length) return `<p class="mm-hint">${L ? 'Pas de montée chronométrée dans cette zone : choisis-en une autre.' : 'No timed climb in this area: pick another one.'}</p><button class="mm-link" data-picker="koms">${L ? 'Voir toutes les montées' : 'See all climbs'}</button>`;
    const cur = koms.find((c) => c.k.id === this.s.challengeSeg && c.route.id === this.s.routeId) ?? (koms[0] as (typeof koms)[number]);
    this.s.challengeSeg = cur.k.id;
    const rec = readKomRecord(cur.route.id, cur.k.id);
    const t = rec ? `${Math.floor(rec.timeS / 60)}:${String(Math.round(rec.timeS % 60)).padStart(2, '0')}` : L ? 'pas encore de record' : 'no record yet';
    return `<div class="mm-routes mm-presets"><button class="mm-route on" data-picker="koms"><b>${esc(cur.k.name)}</b><span>${this.km(cur.k.endM - cur.k.startM)} km · ${cur.k.avgGrade.toFixed(1).replace('.', L ? ',' : '.')} % · ${L ? 'record' : 'best'} ${t}</span></button></div>
      <button class="mm-link" data-picker="koms">${L ? 'Changer de montée · voir les records' : 'Change climb · see records'}</button>`;
  }

  /** Fenêtre centrale « Défi KOM » : tableau des montées et de tes records, filtre par zone. */
  private komsHtml(): string {
    const L = fr();
    const lang = getLang();
    // Zones connues : celle affichée (toujours à jour) et celles déjà visitées.
    this.indexClimbs();
    const index = this.komIndex();
    const zoneIds = Object.keys(index).sort((a, b) => (a === this.worldId ? -1 : b === this.worldId ? 1 : this.zoneLabel(a).localeCompare(this.zoneLabel(b), lang)));
    const filter = this.komZone && index[this.komZone] ? this.komZone : '';
    const rows = zoneIds
      .filter((z) => !filter || z === filter)
      .flatMap((z) => (index[z] ?? []).map((c) => ({ zone: z, ...c, rec: readKomRecord(c.routeId, c.segId) })));
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    const chips = [['', L ? 'Toutes les zones' : 'All areas'] as const, ...zoneIds.map((z) => [z, this.zoneLabel(z)] as const)]
      .map(([z, label]) => `<button class="kom-chip${z === filter ? ' on' : ''}" data-komzone="${esc(z)}">${esc(label)}</button>`)
      .join('');
    const body = rows.length
      ? rows
          .map((c) => {
            const on = c.routeId === this.s.routeId && c.segId === this.s.challengeSeg && this.s.mode === 'challenge';
            const date = c.rec ? new Date(c.rec.date).toLocaleDateString(L ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            return `<tr class="${on ? 'on' : ''}" tabindex="0" data-kom="${esc(c.segId)}" data-kom-route="${esc(c.routeId)}" data-kom-zone="${esc(c.zone)}">
              <td class="kom-name"><b>${esc(c.name)}</b><small>${esc(c.routeName)}</small></td>
              <td class="kom-zone">${esc(this.zoneLabel(c.zone))}</td>
              <td class="num">${this.km(c.lengthM)} km</td>
              <td class="num">${c.grade.toFixed(1).replace('.', L ? ',' : '.')} %</td>
              <td class="num kom-rec">${c.rec ? `<b>${fmt(c.rec.timeS)}</b>` : `<span class="kom-none">—</span>`}</td>
              <td class="kom-date">${date}</td>
              <td class="kom-go">${on ? (L ? 'Choisie' : 'Selected') : L ? 'Défier ›' : 'Challenge ›'}</td>
            </tr>`;
          })
          .join('')
      : `<tr><td colspan="7" class="kom-empty">${L ? 'Aucune montée chronométrée connue pour le moment.' : 'No timed climb known yet.'}</td></tr>`;
    const records = rows.filter((c) => c.rec).length;
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker kom-dialog" role="dialog" aria-modal="true">
        <header><h2>${L ? 'Défi KOM' : 'KOM challenge'}</h2><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        <p class="mm-hint">${L ? 'Choisis une montée : départ lancé, fantôme de ton meilleur temps et écart en direct. Clique sur une ligne pour la défier.' : 'Pick a climb: flying start, ghost of your best time and live gap. Click a row to take it on.'}</p>
        <div class="kom-filter" role="group" aria-label="${L ? 'Filtrer par zone' : 'Filter by area'}">${chips}</div>
        <div class="kom-wrap"><table class="kom-table"><thead><tr><th>${L ? 'Montée' : 'Climb'}</th><th>${L ? 'Zone' : 'Area'}</th><th class="num">${L ? 'Longueur' : 'Length'}</th><th class="num">${L ? 'Pente moy.' : 'Avg grade'}</th><th class="num">${L ? 'Mon record' : 'My best'}</th><th>${L ? 'Date' : 'Date'}</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="kom-foot"><span>${rows.length} ${L ? (rows.length > 1 ? 'montées' : 'montée') : rows.length > 1 ? 'climbs' : 'climb'} · ${records} ${L ? (records > 1 ? 'records' : 'record') : records > 1 ? 'records' : 'record'}</span><span>${L ? 'Les montées d’une zone apparaissent après sa première visite.' : 'A zone’s climbs appear after you first visit it.'}</span></div>
      </div></div>`;
  }

  /**
   * Mode défi : toutes les montées chronométrées de la zone (tous ses parcours, une fois chacune,
   * celles du parcours choisi d'abord), avec le record de chacune ; en choisir une prend son parcours.
   */
  private challengeHtml(r: RouteData | undefined, onlySelected = false): string {
    const L = fr();
    const ordered = r ? [r, ...this.routes.filter((x) => x.id !== r.id)] : this.routes;
    const seen = new Set<string>();
    const koms: Array<{ route: RouteData; k: RouteSegment }> = [];
    for (const route of ordered)
      for (const k of route.segments)
        if (k.kind === 'kom' && !seen.has(k.name)) {
          seen.add(k.name);
          koms.push({ route, k });
        }
    if (!koms.length) return `<p class="mm-hint">${L ? 'Pas de montée chronométrée dans cette zone : choisis-en une autre.' : 'No timed climb in this area: pick another one.'}</p>`;
    const cur = r?.id;
    if (!koms.some((c) => c.route.id === cur && c.k.id === this.s.challengeSeg)) this.s.challengeSeg = (koms[0] as (typeof koms)[number]).k.id;
    // panneau de gauche : la côte choisie seulement (la liste complète est dans la fenêtre de la zone)
    const shown = onlySelected ? koms.filter((c) => c.route.id === cur && c.k.id === this.s.challengeSeg) : koms;
    return `<div class="mm-routes mm-presets">${shown
      .map(({ route, k }) => {
        const rec = readKomRecord(route.id, k.id);
        const t = rec ? `${Math.floor(rec.timeS / 60)}:${String(Math.round(rec.timeS % 60)).padStart(2, '0')}` : L ? 'pas encore de record' : 'no record yet';
        const on = route.id === cur && k.id === this.s.challengeSeg;
        return `<button class="mm-route ${on ? 'on' : ''}" data-kom="${esc(k.id)}" data-kom-route="${esc(route.id)}"><b>${esc(k.name)}</b><span>${this.km(k.endM - k.startM)} km · ${k.avgGrade.toFixed(1).replace('.', L ? ',' : '.')} % · ${L ? 'record' : 'best'} ${t}</span></button>`;
      })
      .join('')}</div>`;
  }

  /**
   * Zones de la carte de France : une par point de ZONE_SPOTS (mondes du menu et mondes à venir).
   * Publiée = présente dans le catalogue `worlds/index.json` (sans catalogue : celles de WORLD_LIST).
   */
  private mapZones(): MapZone[] {
    const L = fr();
    const lang = getLang();
    return ZONE_SPOTS.map((spot) => {
      const w = WORLD_LIST.find((x) => x.id === spot.id);
      const z = this.zones.find((c) => c.id === spot.id);
      const available = this.zones.length ? !!z : !!w;
      const n = z ? routesForBike(z.routes, bikeSetupFor(loadProgress().equipped).tyre).length : 0;
      const info = [n ? `${n} ${L ? 'parcours' : n > 1 ? 'routes' : 'route'}` : '', spot.open ? (L ? 'monde ouvert' : 'open world') : '', w ? w.hint[lang] : ''].filter(Boolean).join(' · ');
            return { id: spot.id, name: w ? w.name[lang] : spot.name[lang], region: spot.region[lang], x: spot.x, y: spot.y, available, current: spot.id === this.worldId, info, ...(z?.l93 ? { rect: z.l93 } : {}), ...(spot.image ? { image: spot.image } : {}) };
    });
  }

  /**
   * Pack de cartes d'une zone (catalogue `worlds/index.json`) : télécharger (taille), progression,
   * téléchargée / supprimer, mettre à jour. Sans pack, la zone se charge quand même depuis le
   * serveur, au fil de la sortie.
   */
  private packAction(id: string): string {
    const L = fr();
    const z = this.zones.find((c) => c.id === id);
    const st = packState(id, z?.pack?.version);
    const dl = this.downloads.get(id);
    if (dl && !dl.error) {
      const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
      return `<span class="mm-pack busy"><i class="mm-pack-bar"><i style="width:${pct}%"></i></i>${pct} %</span>`;
    }
    if (dl?.error) return `<button class="mm-pack err" data-pack="${esc(id)}" title="${esc(dl.error)}">${L ? 'Réessayer' : 'Retry'}</button>`;
    if (st.kind === 'installed' && st.upToDate) return `<span class="mm-pack ok">${L ? 'Téléchargée' : 'Downloaded'} ✓</span>`;
    if (st.kind === 'installed') return `<button class="mm-pack" data-pack="${esc(id)}">${L ? 'Mettre à jour' : 'Update'}${z?.pack ? ` · ${formatBytes(z.pack.gzBytes ?? z.pack.bytes, L)}` : ''}</button>`;
    if (st.kind === 'absent' && z?.pack) return `<button class="mm-pack" data-pack="${esc(id)}">↓ ${formatBytes(z.pack.gzBytes ?? z.pack.bytes, L)}</button>`;
    return '';
  }

  /** Fenêtre « Zones » : carte de France, un point par zone. */
  private franceHtml(): string {
    const L = fr();
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker fm-dialog" role="dialog" aria-modal="true">
        <header><h2>${L ? 'Où veux-tu rouler ?' : 'Where do you want to ride?'}</h2><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        <p class="mm-hint">${this.loadingZone ? `${L ? 'Chargement de' : 'Loading'} ${esc(this.loadingZone)}…` : L ? 'Clique sur un point pour ouvrir la zone ; un point numéroté réunit plusieurs zones proches. Glisse pour te déplacer, molette pour zoomer.' : 'Click a point to open the area; a numbered point groups several nearby areas. Drag to move, scroll to zoom.'}</p>
        ${this.franceMap.html(this.mapZones())}
      </div></div>`;
  }

  /** Fenêtre d'une zone : parcours fixés, parcours libre, parcours à dessiner (ces deux-là : zones ouvertes). */
  private zoneHtml(): string {
    const L = fr();
    const lang = getLang();
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const spot = ZONE_SPOTS.find((x) => x.id === this.worldId);
    const n = this.routes.length;
    const openOnly = L ? 'Seulement dans les zones ouvertes (toutes les routes roulables).' : 'Only in open areas (every road rideable).';
    const fixedOnly = L ? 'Pas en course : le parcours est fixe (tu peux le dessiner).' : 'Not in a race: the course is fixed (you can draw it).';
    const card = (id: string, icon: string, title: string, text: string) =>
      id === 'free' && this.s.mode === 'race'
        ? `<button class="zc-choice zc-off" disabled>${icon}<b>${title}</b><span>${fixedOnly}</span></button>`
        : id !== 'routes' && !this.openWorld
        ? `<button class="zc-choice zc-off" disabled>${icon}<b>${title}</b><span>${openOnly}</span></button>`
        : `<button class="zc-choice" data-zc="${id}">${icon}<b>${title}</b><span>${text}</span></button>`;
    const pack = this.packAction(this.worldId);
    // Région, puis la description de la zone (sans répéter la région si elle y figure déjà).
    const hint = w?.hint[lang] ?? '';
    const region = spot?.region[lang] ?? '';
    const zoneSub = [hint.includes(region) ? '' : region, hint].filter(Boolean).join(' · ');
    // zones voisines (qui touchent ou chevauchent celle-ci) : chargées avec elle pour le libre et le dessin
    const near = this.openWorld ? neighbourZones({ formatVersion: 1, zones: this.zones }, this.worldId) : [];
    const zoneName = (id: string) => WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
    const nearHtml = near.length
      ? `<div class="zc-near"><div><b>${L ? 'Zones voisines' : 'Neighbouring areas'}</b><span>${
          this.loadingZone ? `${L ? 'Chargement…' : 'Loading…'}` : L ? 'Ajoute-les pour rouler ou dessiner d’une zone à l’autre (parcours libre et à dessiner).' : 'Add them to ride or draw from one area to the next (free ride and drawn routes).'
        }</span></div><div class="zc-near-list">${near
          .map((id) => {
            const on = this.loadedZones.includes(id);
            return `<button class="zc-near-chip${on ? ' on' : ''}" data-near="${esc(id)}" aria-pressed="${on}"${this.loadingZone ? ' disabled' : ''}>${on ? '✓ ' : '+ '}${esc(zoneName(id))}</button>`;
          })
          .join('')}</div></div>`
      : '';
    const kom = this.s.mode === 'challenge';
    const choices = `<div class="zc-choices">
          ${n ? card('routes', ICON.free, L ? 'Parcours' : 'Routes', L ? `${n} parcours déjà tracé${n > 1 ? 's' : ''} : boucles et itinéraires de la zone.` : `${n} ready-made route${n > 1 ? 's' : ''}: loops and rides of the area.`) : ''}
          ${card('free', ICON.open, L ? 'Parcours libre' : 'Free ride', L ? 'Pars du départ de la zone et choisis ta route à chaque carrefour (← / →, U pour faire demi-tour).' : 'Start from the area’s start and pick your road at each junction (← / →, U to turn around).')}
          ${card('draw', svg('<path d="M4 19c3-.5 3.5-6 7-6s3 5.5 6 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="m15.5 3.5 3 3L12 13H9v-3z"/>'), L ? 'Parcours à dessiner' : 'Draw a route', L ? 'Sur la carte : ton départ, tes points de passage, ton arrivée ou une boucle.' : 'On the map: your start, waypoints, finish or a loop.')}
        </div>`;
    // Défi KOM : les côtes de la zone tout de suite (en choisir une prend son parcours)
    const koms = kom ? `<p class="mm-hint">${L ? 'Choisis la côte à battre :' : 'Pick the climb to beat:'}</p>${this.challengeHtml(this.routes.find((x) => x.id === this.s.routeId))}` : '';
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker" role="dialog" aria-modal="true">
        <header class="zc-head"><div><h2>${esc(w ? w.name[lang] : (spot?.name[lang] ?? this.worldId))}</h2><small>${esc(zoneSub)}</small></div><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        ${kom ? koms : choices}
        ${kom ? '' : nearHtml}
        <div class="zc-pack"><button class="mm-link zc-back" data-picker="zones">← ${L ? 'Carte de France' : 'Map of France'}</button>${pack ? `${L ? 'Cartes hors ligne' : 'Offline maps'} ${pack}` : ''}</div>
      </div></div>`;
  }

  private async downloadZone(id: string): Promise<void> {
    if (this.downloads.has(id) && !this.downloads.get(id)?.error) return;
    this.downloads.set(id, { done: 0, total: 1 });
    this.render();
    try {
      await installPack(id, (done, total) => {
        this.downloads.set(id, { done, total });
        // rafraîchissement limité (un rendu complet du panneau par quart de seconde au plus)
        const now = performance.now();
        if (now - this.lastProgressRender > 250) {
          this.lastProgressRender = now;
          if (this.tab === 'ride') this.render();
          else this.renderZonesSettings();
        }
      });
      this.downloads.delete(id);
    } catch (err) {
      this.downloads.set(id, { done: 0, total: 1, error: String((err as Error).message ?? err) });
    }
    if (this.tab === 'ride') this.render();
    else this.renderZonesSettings();
  }

  /** Ajoute des zones à la file « Tout télécharger » et la vide une zone à la fois (un échec n'arrête pas la suite). */
  private async downloadAll(ids: string[]): Promise<void> {
    for (const id of ids) this.queued.add(id);
    this.renderZonesSettings();
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      for (let id = this.queued.values().next().value; id !== undefined; id = this.queued.values().next().value) {
        this.queued.delete(id);
        await this.downloadZone(id);
      }
    } finally {
      this.queueRunning = false;
      this.renderZonesSettings();
    }
  }

  /**
   * Réglages › « Zones et cartes » : seul endroit où l'on gère les téléchargements (état, taille, télécharger,
   * mettre à jour, supprimer, espace utilisé). La fenêtre de choix d'une zone ne fait que télécharger.
   */
  private renderZonesSettings(): void {
    const box = this.root.querySelector<HTMLElement>('#m-zones-settings');
    if (!box) return;
    const L = fr();
    const lang = getLang();
    const zones = this.zones.filter((z) => z.pack);
    if (!zones.length) {
      box.innerHTML = `<p class="mm-hint">${L ? 'Catalogue des zones indisponible (hors ligne ?).' : 'Zone catalogue unavailable (offline?).'}</p>`;
      return;
    }
    const nameOf = (id: string) => WORLD_LIST.find((x) => x.id === id)?.name[lang] ?? ZONE_SPOTS.find((x) => x.id === id)?.name[lang] ?? id;
    const sizeOf = (z: (typeof zones)[number]) => formatBytes(z.pack?.gzBytes ?? z.pack?.bytes ?? 0, L);
    const rows = zones
      .map((z) => {
        const st = packState(z.id, z.pack?.version);
        const dl = this.downloads.get(z.id);
        const have = st.kind === 'installed';
        let state: string;
        let actions = '';
        if (dl && !dl.error) {
          const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
          state = `<span class="zs-state busy">${L ? 'Téléchargement' : 'Downloading'} ${pct} %</span><i class="zs-bar"><i style="width:${pct}%"></i></i>`;
        } else if (this.queued.has(z.id)) {
          state = `<span class="zs-state busy">${L ? 'En attente' : 'Queued'}</span>`;
        } else if (dl?.error) {
          state = `<span class="zs-state err" title="${esc(dl.error)}">${L ? 'Échec du téléchargement' : 'Download failed'}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${L ? 'Réessayer' : 'Retry'}</button>`;
        } else if (st.kind === 'installed' && st.upToDate) {
          state = `<span class="zs-state ok">${L ? 'Téléchargée' : 'Downloaded'} ✓</span>`;
          actions = `<button class="btn small" data-zunpack="${esc(z.id)}">${L ? 'Supprimer' : 'Remove'}</button>`;
        } else if (st.kind === 'installed') {
          state = `<span class="zs-state warn">${L ? 'Mise à jour disponible' : 'Update available'}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${L ? 'Mettre à jour' : 'Update'}</button><button class="btn small" data-zunpack="${esc(z.id)}">${L ? 'Supprimer' : 'Remove'}</button>`;
        } else {
          state = `<span class="zs-state">${L ? 'Non téléchargée' : 'Not downloaded'}</span>`;
          actions = `<button class="btn small primary" data-zpack="${esc(z.id)}">${L ? 'Télécharger' : 'Download'}</button>`;
        }
        return { have, html: `<div class="zs-row${z.id === this.worldId ? ' cur' : ''}"><div class="zs-name"><b>${esc(nameOf(z.id))}</b><small>${sizeOf(z)}${z.id === this.worldId ? ` · ${L ? 'zone affichée' : 'current area'}` : ''}</small></div><div class="zs-mid">${state}</div><div class="zs-act">${actions}</div></div>` };
      })
      .sort((a, b) => Number(b.have) - Number(a.have));
    const mine = installedPacks();
    // Application Windows : place réelle sur le disque (fichiers décompressés) ; navigateur : fichiers gardés compressés.
    const total = mine.reduce((sum, p) => sum + (inTauri ? p.bytes : (zones.find((z) => z.id === p.id)?.pack?.gzBytes ?? p.bytes)), 0);
    const used = mine.length ? `${L ? 'Espace utilisé' : 'Space used'} : <b>${formatBytes(total, L)}</b> · ${mine.length} ${L ? (mine.length > 1 ? 'zones' : 'zone') : mine.length > 1 ? 'areas' : 'area'}` : L ? 'Aucune zone téléchargée' : 'No area downloaded';
    // Zones à télécharger ou à mettre à jour, hors celles en cours ou déjà en file.
    const missing = zones.filter((z) => {
      const st = packState(z.id, z.pack?.version);
      const dl = this.downloads.get(z.id);
      return !(st.kind === 'installed' && st.upToDate) && st.kind !== 'unavailable' && (!dl || dl.error) && !this.queued.has(z.id);
    });
    const missingBytes = missing.reduce((s, z) => s + (z.pack?.gzBytes ?? z.pack?.bytes ?? 0), 0);
    const allBtn = this.queued.size
      ? `<button class="btn small" data-zqueue-stop>${L ? `Arrêter (${this.queued.size} en attente)` : `Stop (${this.queued.size} queued)`}</button>`
      : '';
    const getAll = missing.length ? `<button class="btn small primary" data-zpack-all>${L ? 'Tout télécharger' : 'Download all'} · ${formatBytes(missingBytes, L)}</button>` : '';
    const where = inTauri ? (L ? 'Les cartes sont dans le dossier des données ci-dessous.' : 'Maps are kept in the data folder below.') : L ? 'Les cartes sont stockées sur cet appareil.' : 'Maps are stored on this device.';
    box.innerHTML = `<p class="mm-hint">${L ? 'Une zone téléchargée se charge tout de suite et fonctionne sans connexion ; sinon elle se charge pendant la sortie.' : 'A downloaded area loads instantly and works offline; otherwise it streams in during the ride.'} ${where}</p>
      ${storagePanelHtml()}
      <div class="zs-list">${rows.map((r) => r.html).join('')}</div>
      <div class="zs-foot"><span>${used}</span>${getAll}${allBtn}${mine.length ? `<button class="btn small" data-zunpack-all>${L ? 'Tout supprimer' : 'Remove all'}</button>` : ''}</div>`;
    void fillStoragePanel(box, () => this.renderZonesSettings());
    box.querySelector('[data-zpack-all]')?.addEventListener('click', () => {
      const n = missing.length;
      const what = L ? `${n} zone${n > 1 ? 's' : ''} (${formatBytes(missingBytes, L)})` : `${n} area${n > 1 ? 's' : ''} (${formatBytes(missingBytes, L)})`;
      if (!confirm(L ? `Télécharger ${what} ? Elles arrivent une par une ; tu peux continuer à utiliser le jeu.` : `Download ${what}? They arrive one at a time; you can keep using the game.`)) return;
      void this.downloadAll(missing.map((z) => z.id));
    });
    box.querySelector('[data-zqueue-stop]')?.addEventListener('click', () => {
      this.queued.clear();
      this.renderZonesSettings();
    });
    box.querySelectorAll<HTMLElement>('[data-zpack]').forEach((el) => el.addEventListener('click', () => void this.downloadZone(el.dataset.zpack as string)));
    box.querySelectorAll<HTMLElement>('[data-zunpack]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = el.dataset.zunpack as string;
        if (!confirm(L ? `Supprimer la zone « ${nameOf(id)} » de cet appareil ? Tu pourras la télécharger de nouveau.` : `Remove “${nameOf(id)}” from this device? You can download it again.`)) return;
        void removePack(id).then(() => this.renderZonesSettings());
      }),
    );
    box.querySelector('[data-zunpack-all]')?.addEventListener('click', () => {
      if (!confirm(L ? 'Supprimer toutes les zones téléchargées de cet appareil ?' : 'Remove every downloaded area from this device?')) return;
      void Promise.all(installedPacks().map((p) => removePack(p.id))).then(() => this.renderZonesSettings());
    });
  }

  /** Carte de l'itinéraire (tracé coloré selon la pente) et profil d'altitude. */
  private routeCard(r: RouteData): string {
    const step = Math.max(1, Math.floor(r.points.length / 260));
    const sel = r.points.filter((_, i) => i % step === 0);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of sel) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const W = 360;
    const H = 170;
    const k = Math.min((W - 24) / (maxX - minX || 1), (H - 24) / (maxZ - minZ || 1));
    const ox = (W - (maxX - minX) * k) / 2;
    const oz = (H - (maxZ - minZ) * k) / 2;
    const X = (x: number) => (ox + (x - minX) * k).toFixed(1);
    const Z = (z: number) => (oz + (z - minZ) * k).toFixed(1);
    const gradeColor = (g: number) => (g > 6 ? '#ef4444' : g > 3 ? '#f97316' : g > 1 ? '#facc15' : g < -2 ? '#60a5fa' : '#e5e7eb');
    let lines = '';
    for (let i = 1; i < sel.length; i++) {
      const a = sel[i - 1] as (typeof sel)[number];
      const b = sel[i] as (typeof sel)[number];
      const g = ((b.y - a.y) / Math.max(1, b.d - a.d)) * 100;
      lines += `<line x1="${X(a.x)}" y1="${Z(a.z)}" x2="${X(b.x)}" y2="${Z(b.z)}" stroke="${gradeColor(g)}"/>`;
    }
    const first = sel[0];
    const PW = 360;
    const PH = 56;
    const ys = sel.map((p) => p.y);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const len = r.lengthM || 1;
    const px = (d: number) => (d / len) * PW;
    const py = (y: number) => (PH - 4 - ((y - lo) / (hi - lo || 1)) * (PH - 10)).toFixed(1);
    const area = `M0,${PH} ${sel.map((p) => `L${px(p.d).toFixed(1)},${py(p.y)}`).join(' ')} L${PW},${PH} Z`;
    return `<div class="mm-routecard">
      <div class="mm-rc-title">${esc(this.routeName(r))}</div>
      <svg class="mm-map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g stroke-width="3.2" stroke-linecap="round">${lines}</g>
        ${first ? `<circle cx="${X(first.x)}" cy="${Z(first.z)}" r="6" fill="var(--ar-accent)" stroke="#0a0e16" stroke-width="2.5"/>` : ''}
      </svg>
      <div class="mm-stats">
        <div><b>${this.km(r.lengthM)}</b><span>km</span></div>
        <div><b>${Math.round(r.elevationGainM)}</b><span>m D+</span></div>
        <div><b>${r.maxGradePct !== undefined ? Math.round(r.maxGradePct) : '—'}</b><span>% max</span></div>
        <div><b>${this.eta(r)}</b><span>${fr() ? 'durée env.' : 'est. time'}</span></div>
      </div>
      <svg class="mm-profile" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="mm-prof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd23f" stop-opacity=".55"/><stop offset="1" stop-color="#ffd23f" stop-opacity=".04"/></linearGradient></defs>
        ${r.segments.map((g) => `<rect x="${px(g.startM).toFixed(1)}" y="0" width="${Math.max(1, px(g.endM) - px(g.startM)).toFixed(1)}" height="${PH}" fill="${g.kind === 'kom' ? '#ef4444' : '#22c55e'}" opacity=".14"/>`).join('')}
        <path d="${area}" fill="url(#mm-prof)" stroke="#ffd23f" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
      </svg>
    </div>`;
  }

  // ————————————————————————————————————————————— Garage

  private garageHtml(): string {
    if (this.garageSlot === 'atelier') {
      const xp = loadProgress().xp;
      return this.atelier.html(this.garageHeader(levelProgress(xp), xp), this.garageNav());
    }
    const L = fr();
    const lang = getLang();
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const slots = [...new Set(COSMETICS.map((c) => c.slot))];
    const views: Array<[GarageView, string]> = [
      ['3q', '3/4'],
      ['side', L ? 'Profil' : 'Side'],
      ['front', L ? 'Face' : 'Front'],
      ['back', L ? 'Dos' : 'Back'],
      ['bike', L ? 'Vélo' : 'Bike'],
      ['cockpit', 'Cockpit'],
    ];
    const items =
      this.garageSlot === 'face'
        ? faceEditorHtml(this.s.look, this.faceTab, this.bareHead, this.faceUndo.length > 0, this.photoOpen)
        : this.garageSlot === 'colors'
        ? `<div class="mm-colors">
            <label class="field">${L ? 'Maillot' : 'Jersey'}<input id="m-jersey" type="color" value="${this.s.look.jersey}" /></label>
            <label class="field">${L ? 'Bande du maillot' : 'Jersey stripe'}<input id="m-accent" type="color" value="${this.s.look.jerseyAccent}" /></label>
            <label class="field">${L ? 'Casque' : 'Helmet'}<input id="m-helmet" type="color" value="${this.s.look.helmet}" /></label>
            <label class="field">${L ? 'Vélo sans marque' : 'Unbranded bike'}<input id="m-bike" type="color" value="${this.s.look.bike}" /></label>
            <label class="field">${L ? 'Peau' : 'Skin'}<input id="m-skin" type="color" value="${this.s.look.skin}" /></label>
            <label class="field">${L ? 'Cheveux' : 'Hair'}<input id="m-hair" type="color" value="${this.s.look.hair}" /></label>
            <label class="field">${L ? 'Chaussures' : 'Shoes'}<input id="m-shoes" type="color" value="${this.s.look.shoes ?? '#f2f2f2'}" /></label>
            <label class="field">${L ? 'Marquage des chaussures' : 'Shoe logo'}<select id="m-shoe-mark"><option value="">${L ? 'Aucun' : 'None'}</option>${SHOE_MARKS.map((m) => `<option value="${m.id}" ${this.s.look.shoeMark === m.id ? 'selected' : ''}>${m.text}</option>`).join('')}</select></label>
            <label class="field">${L ? 'Accent des chaussures' : 'Shoe accent'}<input id="m-shoe-accent" type="color" value="${this.s.look.shoeAccent ?? shoeAccentOf(this.s.look)}" /></label>
            <label class="field">${L ? 'Chaussettes' : 'Socks'}<input id="m-socks" type="color" value="${this.s.look.socks ?? '#f2f2f2'}" /></label>
            ${this.sockHeightToggle()}
            ${this.legsToggle()}
            ${this.glovesToggle()}
            ${this.gloveColorField()}
          </div>
          <h3 class="mm-presets-title">${L ? 'Tenues préréglées' : 'Kit presets'}</h3>
          <div class="mm-items mm-kits">${OUTFITS.map(
            (o) =>
              `<button class="mm-item" data-outfit="${o.id}"><i style="background:linear-gradient(90deg, ${o.look.jersey} 0 50%, ${o.look.jerseyAccent} 50% 100%)"></i><b>${esc(o.name[lang])}</b><span>${esc(o.hint[lang])}</span></button>`,
          ).join('')}
          </div>`
        : this.garageSlot === 'bike'
        ? this.bikeListHtml(lp.level, p.equipped.bike)
        : this.garageSlot === 'jersey'
        ? `${this.sleevesToggle()}${this.legsToggle()}${this.glovesToggle()}${this.gloveColorField()}${this.jerseyPacksHtml(lp.level, p.equipped.jersey)}`
        : `${this.garageSlot === 'socks' ? this.sockHeightToggle() : ''}<div class="mm-items">${this.garageItems(lp.level)
            .map((c) => this.itemHtml(c, lp.level, c.slot === 'trainer' ? trainerOf(p.equipped) : p.equipped[c.slot]))
            .join('')}</div>`;
    return `<div class="mm-dragzone" id="m-dragzone"></div>
      <div class="mm-views">${views.map(([v, label]) => `<button class="mm-view ${v === this.view ? 'on' : ''}" data-view="${v}">${label}</button>`).join('')}
        <span class="mm-drag">${ICON.rotate} ${L ? 'Glisser pour tourner' : 'Drag to rotate'}</span></div>
      ${this.garageSlot === 'face' ? '' : this.roadEffect()}
      <section class="mm-panel mm-side gr-panel">
        <div class="gr-top">${this.garageHeader(lp, p.xp)}${this.garageNav()}</div>
        <div class="gr-body">${items}</div>
        <div class="gr-foot">${this.bikeSummary()}<p>${L ? 'Les équipements se débloquent en roulant. Clique un équipement verrouillé pour l’essayer.' : 'Gear unlocks as you ride. Click locked gear to try it on.'}</p></div>
      </section>`;
  }

  /** En-tête du garage : niveau et progression, crédits, fermeture. */
  private garageHeader(lp: ReturnType<typeof levelProgress>, xp: number): string {
    const L = fr();
    return `<div class="gr-head">
        <div class="gr-lvl"><b>${L ? 'Niveau' : 'Level'} ${lp.level}</b><i class="mm-xp big"><i style="width:${(lp.progress * 100).toFixed(1)}%"></i></i><span>${xp}${lp.nextLevelXp ? ` / ${lp.nextLevelXp}` : ''} XP</span></div>
        <span class="gr-coins" title="${L ? 'Crédits de l’atelier' : 'Workshop credits'}">${COIN} <b>${(this.account?.credits ?? loadProgress().credits).toLocaleString(L ? 'fr-FR' : 'en-GB')}</b></span>
        <button class="gr-x" data-tab="ride" aria-label="${L ? 'Fermer' : 'Close'}" title="${L ? 'Fermer (Échap)' : 'Close (Esc)'}">×</button>
      </div>`;
  }

  /** Navigation du garage à deux niveaux : trois rubriques (Tenue, Vélo, Personnage), puis leurs catégories. */
  private garageNav(): string {
    const L = fr();
    const lang = getLang();
    const cur = this.garageSlot;
    const slotLabel = (sl: CosmeticSlot) => SLOT_LABEL[sl][lang];
    const groups: Array<{ label: string; icon: string; first: GarageSlot; subs: Array<[GarageSlot, string]> }> = [
      { label: L ? 'Tenue' : 'Outfit', icon: ICON.gTenue, first: 'jersey', subs: [['jersey', slotLabel('jersey')], ['helmet', slotLabel('helmet')], ['glasses', slotLabel('glasses')], ['socks', slotLabel('socks')]] },
      { label: L ? 'Vélo' : 'Bike', icon: ICON.gBike, first: 'bike', subs: [['bike', L ? 'Choisir mon vélo' : 'Pick my bike'], ['atelier', `${ICON.gWrench} ${L ? 'Atelier de pièces' : 'Parts workshop'}`], ['trainer', L ? 'Home trainer' : 'Home trainer']] },
      { label: L ? 'Personnage' : 'Character', icon: ICON.gFace, first: 'face', subs: [['face', L ? 'Visage' : 'Face'], ['colors', L ? 'Couleurs' : 'Colours']] },
    ];
    const active = groups.find((g) => g.subs.some(([id]) => id === cur)) ?? groups[0]!;
    return `<nav class="gr-groups" aria-label="${L ? 'Rubriques du garage' : 'Garage sections'}">${groups
      .map((g) => `<button class="gr-group ${g === active ? 'on' : ''}" data-slot="${g === active ? cur : g.first}" aria-pressed="${g === active}">${g.icon}<span>${g.label}</span></button>`)
      .join('')}</nav>
      <div class="gr-subs">${active.subs.map(([id, label]) => `<button class="gr-sub ${id === cur ? 'on' : ''}" data-slot="${id}">${label}</button>`).join('')}</div>`;
  }

  /** Vignette d'un équipement du garage (équipé, verrouillé, en aperçu). */
  private itemHtml(c: CosmeticItem, level: number, equipped: string | undefined): string {
    const L = fr();
    const lang = L ? 'fr' : 'en';
    const locked = c.level > level;
    const on = equipped === c.id;
    const prev = [...this.previews.values()].includes(c.id);
    return `<button class="mm-item ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${locked ? (L ? 'Cliquer pour l’essayer' : 'Click to try it on') : ''}">
                <i style="background:${swatch(c)}"></i>
                <span class="mm-it-txt"><b>${esc(c.name[lang])}</b>${c.effect ? `<em class="mm-effect">${esc(c.effect[lang])}</em>` : ''}
                <span class="mm-it-state">${prev ? `👁 ${L ? 'Aperçu' : 'Preview'} · 🔒 ${L ? 'niv.' : 'lvl'} ${c.level}` : locked ? `🔒 ${L ? 'niveau' : 'level'} ${c.level}` : on ? (L ? '✓ Équipé' : '✓ Equipped') : L ? 'Disponible' : 'Available'}</span></span></button>`;
  }

  /** Cuissard court ou long (look.legs) ; aperçu immédiat. */
  private legsToggle(): string {
    const L = fr();
    return `<div class="field mm-sleeves">${L ? 'Cuissard' : 'Shorts'}${this.seg('m-legs', this.s.look.legs ?? 'short', [
      ['short', L ? 'Courts' : 'Short'],
      ['long', L ? 'Longs' : 'Long'],
    ])}</div>`;
  }

  /** Couleur des gants (mitaines ou gants longs), à côté du choix des gants. */
  private gloveColorField(): string {
    const L = fr();
    return `<label class="field">${L ? 'Couleur des gants' : 'Glove colour'}<input id="m-glove-color" type="color" value="${this.s.look.gloveColor ?? '#16161a'}" /></label>`;
  }

  /** Gants : aucun, mitaines (doigts nus) ou gants complets (look.gloves) ; aperçu immédiat. */
  private glovesToggle(): string {
    const L = fr();
    return `<div class="field mm-sleeves">${L ? 'Gants' : 'Gloves'}${this.seg('m-gloves', this.s.look.gloves ?? 'none', [
      ['none', L ? 'Sans' : 'None'],
      ['mitts', L ? 'Mitaines' : 'Mitts'],
      ['full', L ? 'Complets' : 'Full'],
    ])}</div>`;
  }

  /** Chaussettes basses ou hautes (look.sockHeight) ; aperçu immédiat. */
  private sockHeightToggle(): string {
    const L = fr();
    return `<div class="field mm-sleeves">${L ? 'Hauteur des chaussettes' : 'Sock height'}${this.seg('m-sock-height', this.s.look.sockHeight ?? 'low', [
      ['low', L ? 'Basses' : 'Low'],
      ['high', L ? 'Hautes' : 'High'],
    ])}</div>`;
  }

  /** Manches courtes ou longues, pour tous les maillots (look.sleeves) ; aperçu immédiat. */
  private sleevesToggle(): string {
    const L = fr();
    return `<div class="field mm-sleeves">${L ? 'Manches' : 'Sleeves'}${this.seg('m-sleeves', this.s.look.sleeves ?? 'short', [
      ['short', L ? 'Courtes' : 'Short'],
      ['long', L ? 'Longues' : 'Long'],
    ])}</div>`;
  }

  /** Maillots regroupés par pack (en-tête, puis grille) ; un pack inconnu garde son identifiant comme titre. */
  private jerseyPacksHtml(level: number, equipped: string | undefined): string {
    const lang = fr() ? 'fr' : 'en';
    const jerseys = this.garageItems(level);
    const known = new Set(JERSEY_PACKS.map((k) => k.id));
    const packs = [...JERSEY_PACKS, ...[...new Set(jerseys.map((c) => c.pack ?? ''))].filter((id) => !known.has(id)).map((id) => ({ id, name: { fr: id, en: id } }))];
    return packs
      .map((k) => ({ k, items: jerseys.filter((c) => (c.pack ?? '') === k.id) }))
      .filter((g) => g.items.length)
      .map(
        (g) =>
          `${g.k.id || packs.length > 1 ? `<h3 class="mm-presets-title mm-pack">${esc(g.k.name[lang])} <span>${g.items.length}</span></h3>` : ''}<div class="mm-items">${g.items.map((c) => this.itemHtml(c, level, equipped)).join('')}</div>`,
      )
      .join('');
  }

  /** Panneau « Effet sur la route » : vélo roulé (équipé, ou essayé) avec les pièces de l'atelier montées. */
  private roadEffect(): string {
    const eq: Record<string, string | undefined> = { ...loadProgress().equipped, ...Object.fromEntries(this.previews) };
    const bike = tunedBikeSetup(bikeSetupFor(eq), equippedTuneIds(eq)).bike;
    return roadEffectHtml(bike, this.s.massKg, this.s.ftpWatts);
  }

  /** Home trainer montré au garage : celui essayé, sinon celui équipé (NEO 2T au départ). */
  currentTrainer(): string {
    return this.previews.get('trainer') ?? trainerOf(loadProgress().equipped);
  }

  /** Vélo réellement roulé avec l'équipement porté : masse, traînée, pneus. */
  private bikeSummary(): string {
    const L = fr();
    const b = bikeSetupFor(loadProgress().equipped);
    const drag = Math.round((b.cda / DEFAULT_BIKE.cda - 1) * 1000) / 10;
    const num = (v: number, d = 1) => v.toFixed(d).replace('.', L ? ',' : '.');
    return `<p class="mm-hint mm-bikephys">${L ? 'En selle' : 'Riding'} : <b>${num(b.massKg)} kg</b> · ${L ? 'traînée' : 'drag'} <b>${drag > 0 ? '+' : ''}${num(drag)} %</b> · ${
      b.tyre === 'gravel' ? (L ? 'pneus gravel' : 'gravel tyres') : b.tyre === 'mtb' ? (L ? 'pneus VTT' : 'MTB tyres') : L ? 'pneus route' : 'road tyres'
    }</p>`;
  }

  /** Équipements de l'emplacement choisi (hors vélos, voir bikesInCollection). */
  private garageItems(_level: number): CosmeticItem[] {
    return COSMETICS.filter((c) => c.slot === this.garageSlot);
  }

  /** Vélos de la collection choisie (ou débloqués), par marque, puis par niveau et par groupe. */
  private bikesInCollection(level: number): CosmeticItem[] {
    const group = (id: string) => BIKE_GROUPS.findIndex((g) => g.id === bikeById(id)?.group);
    return COSMETICS.filter((c) => c.slot === 'bike')
      .filter((c) => (this.bikeFilter === 'unlocked' ? c.level <= level : bikeById(c.id)?.collection === this.bikeFilter))
      .sort((a, b) => brandName(a.id).localeCompare(brandName(b.id), 'fr') || a.level - b.level || group(a.id) - group(b.id) || a.name.fr.localeCompare(b.name.fr));
  }

  /** Lignes des vélos (déjà triés par marque), un intertitre par marque. */
  private bikeRowsByBrand(list: CosmeticItem[], row: (c: CosmeticItem) => string): string {
    let out = '';
    let last: string | undefined;
    for (const c of list) {
      const brand = brandName(c.id);
      if (brand !== last) {
        out += `<h5 class="mm-bl-brand">${esc(brand)}<span>${list.filter((x) => brandName(x.id) === brand).length}</span></h5>`;
        last = brand;
      }
      out += row(c);
    }
    return out;
  }

  /**
   * Sélection du vélo : fiche du vélo regardé (aperçu d'un vélo verrouillé, sinon le vélo équipé),
   * collection, type, puis une ligne par vélo : disponibles d'abord, à débloquer ensuite.
   */
  private bikeListHtml(level: number, equippedId: string | undefined): string {
    const L = fr();
    const all = this.bikesInCollection(level);
    const types = BIKE_TYPE_ORDER.filter((ty) => all.some((c) => bikeById(c.id)?.type === ty));
    const type = this.bikeType !== 'all' && types.includes(this.bikeType) ? this.bikeType : 'all';
    const list = type === 'all' ? all : all.filter((c) => bikeById(c.id)?.type === type);
    const plain = type === 'all';
    const open = list.filter((c) => c.level <= level);
    const locked = list.filter((c) => c.level > level);
    const row = (c: CosmeticItem) => this.bikeRowHtml(c, level, equippedId);
    const chip = (id: BikeType | 'all', label: string, n: number) =>
      `<button class="${id === type ? 'on' : ''}" data-biketype="${id}" role="radio" aria-checked="${id === type}">${label}<span>${n}</span></button>`;
    return `${this.bikeFocusHtml(equippedId)}
      ${this.bottlesToggle(equippedId)}
      <div class="mm-bikefilter" role="radiogroup">${BIKE_FILTERS.map(
        ([id, fr_, en]) => `<button class="${id === this.bikeFilter ? 'on' : ''}" data-bikefilter="${id}" role="radio" aria-checked="${id === this.bikeFilter}">${L ? fr_ : en}</button>`,
      ).join('')}</div>
      ${types.length > 1 ? `<div class="mm-biketypes" role="radiogroup">${chip('all', L ? 'Tous' : 'All', all.length)}${types.map((ty) => chip(ty, BIKE_TYPE[ty][L ? 0 : 1], all.filter((c) => bikeById(c.id)?.type === ty).length)).join('')}</div>` : ''}
      <div class="mm-bikelist">
        ${open.length || plain ? `<h4 class="mm-bl-head">${L ? 'Disponibles' : 'Available'}<span>${open.length + (plain ? 1 : 0)}</span></h4>${plain ? this.plainBikeHtml() : ''}${this.bikeRowsByBrand(open, row)}` : ''}
        ${locked.length ? `<h4 class="mm-bl-head">${L ? 'À débloquer en roulant' : 'Unlock by riding'}<span>${locked.length}</span></h4>${this.bikeRowsByBrand(locked, row)}` : ''}
      </div>`;
  }

  /** Bidons : aucun, 1 ou 2 selon ce que le cadre équipé peut porter (look.bottles) ; aperçu immédiat. */
  private bottlesToggle(equippedId: string | undefined): string {
    const L = fr();
    const cap = bottleCapacity(equippedId);
    if (cap === 0) return `<div class="field mm-bottles">${L ? 'Bidons' : 'Bottles'}<span class="mm-hint">${L ? 'Ce cadre ne porte pas de bidon.' : 'This frame carries no bottle.'}</span></div>`;
    const cur = Math.min(this.s.look.bottles ?? 1, cap);
    const opts: Array<[string, string]> = [['0', L ? 'Aucun' : 'None'], ['1', '1'], ['2', '2']];
    return `<div class="field mm-bottles">${L ? 'Bidons' : 'Bottles'}${this.seg('m-bottles', String(cur), opts.slice(0, cap + 1))}</div>`;
  }

  /** Une ligne de la liste des vélos : silhouette aux couleurs de la livrée, nom, type et équipe, effet, état. */
  private bikeRowHtml(c: CosmeticItem, level: number, equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const bike = bikeById(c.id);
    const locked = c.level > level;
    const on = equippedId === c.id;
    const prev = [...this.previews.values()].includes(c.id);
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const sub = bike ? `${BIKE_TYPE[bike.type][L ? 0 : 1]}${from ? ` · ${from}` : ''}` : '';
    const state = prev ? `👁 ${L ? 'Aperçu' : 'Preview'}` : locked ? `🔒 ${L ? 'niv.' : 'lvl'} ${c.level}` : on ? `✓ ${L ? 'Équipé' : 'Equipped'}` : '';
    return `<button class="mm-bike ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${esc([bike?.desc[lang] ?? '', locked ? (L ? 'Cliquer pour l’essayer' : 'Click to try it on') : ''].filter(Boolean).join(' — '))}">
      ${bikeThumbHtml(c.id, 'mm-bikeicon', c.colors?.length ? c.colors : [c.color ?? '#7a8594'])}
      <span class="mm-bike-txt"><b>${esc(c.name[lang])}</b><small>${esc(sub)}</small></span>
      <span class="mm-bike-side">${c.effect ? `<em>${esc(c.effect[lang])}</em>` : ''}${state ? `<span class="mm-bike-state">${state}</span>` : ''}</span>
    </button>`;
  }

  /** Vélo de départ sans marque, à la couleur choisie dans « Couleurs ». */
  private plainBikeHtml(): string {
    const L = fr();
    const on = !this.s.look.bikeModel;
    return `<button class="mm-bike ${on ? 'on' : ''}" data-plainbike title="${L ? 'Couleur au choix dans l’onglet Couleurs' : 'Pick its colour in the Colours tab'}">
      ${plainThumbHtml(this.s.look.bike, 'mm-bikeicon')}
      <span class="mm-bike-txt"><b>${L ? 'Vélo sans marque' : 'Unbranded bike'}</b><small>${L ? 'Couleur au choix (onglet Couleurs)' : 'Your colour (Colours tab)'}</small></span>
      <span class="mm-bike-side">${on ? `<span class="mm-bike-state">✓ ${L ? 'Équipé' : 'Equipped'}</span>` : ''}</span></button>`;
  }

  /** Fiche du vélo regardé : aperçu d'un vélo verrouillé, sinon le vélo équipé. */
  private bikeFocusHtml(equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const previewed = this.previews.has('bike') ? COSMETICS.find((c) => c.id === this.previews.get('bike')) : undefined;
    const c = previewed ?? (equippedId ? COSMETICS.find((x) => x.id === equippedId) : undefined);
    if (!c) {
      return `<div class="mm-bikefocus">${plainThumbHtml(this.s.look.bike, 'mm-bikeicon big')}<div class="mm-bf-txt"><small>${L ? 'Ton vélo' : 'Your bike'}</small><b>${L ? 'Vélo sans marque' : 'Unbranded bike'}</b>
        <p>${L ? 'Sa couleur se choisit dans l’onglet Couleurs. Les vélos des équipes se débloquent en roulant.' : 'Pick its colour in the Colours tab. Team bikes unlock as you ride.'}</p></div></div>`;
    }
    const bike = bikeById(c.id);
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const tags = [bike ? BIKE_TYPE[bike.type][L ? 0 : 1] : '', from ?? '', bike?.year ? String(bike.year) : ''].filter(Boolean);
    return `<div class="mm-bikefocus ${previewed ? 'preview' : ''}">${bikeThumbHtml(c.id, 'mm-bikeicon big', c.colors?.length ? c.colors : [c.color ?? '#7a8594'])}
      <div class="mm-bf-txt">
        <small>${previewed ? (L ? `Aperçu · se débloque au niveau ${c.level}` : `Preview · unlocks at level ${c.level}`) : L ? 'Ton vélo' : 'Your bike'}</small>
        <b>${esc(c.name[lang])}</b>
        <span class="mm-bf-tags">${tags.map((x) => `<em>${esc(x)}</em>`).join('')}${c.effect ? `<em class="fx">${esc(c.effect[lang])}</em>` : ''}</span>
        ${bike ? `<p>${esc(bike.desc[lang])}</p>` : ''}
        ${previewed ? `<button class="mm-link" data-unpreview>${L ? '← Revenir à mon vélo' : '← Back to my bike'}</button>` : ''}
      </div></div>`;
  }

  // ————————————————————————————————————————————— Profil et réglages

  private profileHtml(): string {
    const s = this.s;
    const L = fr();
    const wkg = s.ftpWatts / s.massKg;
    const sub = `<nav class="hp-tabs mm-subtabs" role="tablist">${(
      [
        ['profile', L ? 'Mon profil' : 'My profile'],
        ['history', L ? 'Historique' : 'History'],
      ] as const
    )
      .map(([v, label]) => `<button role="tab" class="hp-tab${v === this.profileView ? ' on' : ''}" aria-selected="${v === this.profileView}" data-pview="${v}">${label}</button>`)
      .join('')}</nav>`;
    // Historique : toutes les sorties, la forme, les records et les FTP (fenêtre large).
    if (this.profileView === 'history') {
      return `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}
      <header class="mm-head"><h2>${t('profile')}</h2></header>${sub}<div id="m-history"></div></section>`;
    }
    return `<section class="mm-panel mm-center">${this.closeBtn()}
      <header class="mm-head"><h2>${t('profile')}</h2><p>${L ? 'Le poids et la taille servent à la physique (montées, prise au vent) ; la FTP règle les séances et les zones.' : 'Weight and height drive the physics (climbs, drag); FTP sets workouts and zones.'}</p></header>${sub}
      <div class="mm-bigstats"><div><b>${wkg.toFixed(1).replace('.', L ? ',' : '.')}</b><span>W/kg</span></div><div><b>${Math.round(s.ftpWatts)}</b><span>W FTP</span></div><div><b>${s.massKg}</b><span>kg</span></div><div title="${L ? 'Kilomètres roulés dans le jeu, toutes sorties confondues' : 'Kilometres ridden in the game, all rides'}"><b>${Math.round((rideHistory.summary?.totals.distanceM ?? 0) / 1000).toLocaleString(L ? 'fr-FR' : 'en-GB')}</b><span>${L ? 'km au compteur' : 'km ridden'}</span></div></div>
      <div class="grid2b">
        <label class="field">${t('name')}<input id="m-name" value="${esc(s.name)}" /></label>
        <label class="field">${L ? 'Je suis' : 'I am'}<div class="row">${(['male', 'female'] as const).map((x) => `<button class="btn small ${lookSex(s.look) === x ? 'primary' : ''}" data-sex="${x}">${x === 'male' ? (L ? 'Un homme' : 'A man') : L ? 'Une femme' : 'A woman'}</button>`).join('')}</div></label>
        <div class="field">${L ? 'Nationalité' : 'Nationality'}${this.nationHtml()}</div>
        <div class="field">${t('weight')}${this.stepper('m-mass', 30, 200, s.massKg, 0.5)}</div>
        <div class="field">${t('height')}${this.stepper('m-height', 120, 220, s.heightCm)}</div>
        <div class="field">${t('ftp')}${this.stepper('m-ftp', 50, 600, s.ftpWatts)}</div>
      </div>
    </section>`;
  }

  /** Rubriques repliables de l'onglet Réglages ouvertes en ce moment (mémorisées, pour résister aux réaffichages). */
  private settingsOpen = new Set<string>(
    (() => {
      try {
        // Tout est replié au départ : l'utilisateur ouvre ce dont il a besoin.
        return JSON.parse(localStorage.getItem('ar.settingsOpen2') ?? '[]') as string[];
      } catch {
        return [];
      }
    })(),
  );

  /** Rubrique repliable de l'onglet Réglages : titre cliquable, contenu replié ou non. */
  private settingsSection(id: string, title: string, body: string): string {
    return `<details class="set-sec" data-sec="${id}" ${this.settingsOpen.has(id) ? 'open' : ''}><summary>${title}</summary><div class="set-body">${body}</div></details>`;
  }

  private settingsHtml(): string {
    const s = this.s;
    const L = fr();
    const sec = (id: string, title: string, body: string) => this.settingsSection(id, title, body);
    const graphics = `<div class="grid3">
        <div class="field">${t('quality')}${this.seg('m-quality', s.quality, (['low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t(q)]))}</div>
        <div class="field">${L ? 'Style graphique' : 'Graphic style'}${this.seg('m-style', GRAPHIC_STYLE, [['lowpoly', L ? 'Jeu vidéo' : 'Video game'], ['real', L ? 'Réaliste' : 'Realistic']])}</div>
        <div class="field">${L ? 'Format de l\'image' : 'Picture format'}${this.seg('m-aspect', getAspectCap(), [['full', L ? 'Plein écran' : 'Full'], ['16:9', '16:9'], ['21:9', '21:9'], ['32:9', '32:9']])}</div>
        <div class="field">${L ? 'Zone de l\'interface' : 'Interface area'}${this.seg('m-uiaspect', getUiAspectCap(), [['full', L ? 'Toute la largeur' : 'Full width'], ['16:9', '16:9'], ['21:9', '21:9']])}</div>
        <div class="field">${L ? 'Résolution max' : 'Max resolution'}${this.seg('m-maxres', getResolutionCap(), [['auto', 'Auto'], ['1080p', '1080p'], ['1440p', '1440p'], ['4k', '4K']])}</div>
        <div class="field">${t('season')}${this.seg('m-season', s.season, (['spring', 'summer', 'autumn', 'winter'] as const).map((q) => [q, t(q)]))}</div>
        <label class="field">${t('hour')} <span id="m-hourv">${this.hourLabel(s.hour)}</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
        <label class="field">${L ? 'Nuages' : 'Clouds'}<input id="m-clouds" type="range" min="0" max="1" step="0.05" value="${s.clouds}" /></label>
        <label class="field">${L ? 'Pluie' : 'Rain'}<input id="m-rain" type="range" min="0" max="1" step="0.05" value="${s.rain}" /></label>
        <label class="field">${L ? 'Brouillard' : 'Fog'}<input id="m-fog" type="range" min="0" max="1" step="0.05" value="${s.fog}" /></label>
        <div class="field">${L ? 'Météo' : 'Weather'}${this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [
          ['0', L ? 'Fixe' : 'Fixed'],
          ['1', L ? 'Qui évolue' : 'Changing'],
        ])}</div>
      </div>`;
    const trainer = `<div class="grid3">
        <label class="field">${t('difficulty')} <span id="m-diffv">${Math.round(s.trainerDifficulty * 100)} %</span><input id="m-diff" type="range" min="0" max="1" step="0.05" value="${s.trainerDifficulty}" /></label>
        <label class="field" title="${L ? '100 % : masse et roues réelles. Plus bas, la vitesse suit plus vite les relances (volant du home trainer).' : '100%: real mass and wheels. Lower: speed follows accelerations faster (trainer flywheel).'}">${L ? 'Inertie' : 'Inertia'} <span id="m-inertiav">${Math.round(s.inertia * 100)} %</span><input id="m-inertia" type="range" min="0.6" max="1" step="0.05" value="${s.inertia}" /></label>
        <div class="field">Transmission${this.seg('m-drive', s.drivetrain, [
          ['cog', L ? 'Vitesses virtuelles' : 'Virtual shifting'],
          ['cassette', L ? 'Cassette réelle' : 'Real cassette'],
        ])}</div>
        <div class="field">${L ? 'Lissage puissance' : 'Power smoothing'}${this.seg('m-smooth', s.smoothing3s ? '1' : '0', [
          ['0', L ? 'Non' : 'Off'],
          ['1', '3 s'],
        ])}</div>
        <label class="field" title="${L ? 'Le coureur se met en danseuse au-delà de cette puissance (en plus du sprint, des côtes et des efforts en force). Auto : règles seules.' : 'The rider stands up above this power (on top of sprints, climbs and low-cadence efforts). Auto: rules only.'}">${L ? 'Danseuse au-delà de' : 'Stand up above'} <span id="m-standv">${s.standWatts ? `${s.standWatts} W` : 'Auto'}</span><input id="m-stand" type="range" min="0" max="1200" step="25" value="${s.standWatts}" /></label>
      </div>`;
    const lang = `<div class="grid3">
        <div class="field">${t('language')}${this.seg('m-lang', s.lang, [
          ['fr', 'Français'],
          ['en', 'English'],
        ])}</div>
        <div class="field">Strava${this.seg('m-strava', s.skipStrava ? 'skip' : 'send', [
          ['skip', L ? 'Ne pas envoyer' : 'Don’t upload'],
          ['send', L ? 'Envoyer' : 'Upload'],
        ])}</div>
      </div>
      <div id="m-strava-link"></div>`;
    // Blocs du HUD : décocher ce que son matériel ne mesure pas (cardio, cadence…).
    const hidden = new Set(s.hudHidden);
    const hud = `<p class="mm-hint">${L ? 'Décoche ce que ton matériel ne mesure pas ou ce que tu ne veux pas voir.' : 'Untick what your hardware does not measure or what you do not want to see.'}</p><div class="grid3">${HUD_BLOCKS.map((b) => `<label class="mm-check"><input type="checkbox" data-hudblock="${b.id}" ${hidden.has(b.id) ? '' : 'checked'}/> ${L ? b.fr : b.en}</label>`).join('')}</div>`;
    // Rubriques repliables (la première ouverte au départ, l'état est mémorisé) ; le mode expert est tout en bas.
    return `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}
      <header class="mm-head"><h2>${t('settings')}</h2></header>
      ${sec('graphics', L ? 'Graphismes et conditions de la sortie' : 'Graphics and ride conditions', graphics)}
      ${sec('trainer', L ? 'Home trainer' : 'Smart trainer', trainer)}
      ${sec('music', L ? 'Musique' : 'Music', '<div id="m-music-settings" class="mm-musicset"></div>')}
      ${sec('sound', L ? 'Son' : 'Sound', '<div id="m-sound-settings"></div>')}
      ${sec('hud', L ? 'Affichage en sortie' : 'In-ride display', hud)}
      ${sec('companion', L ? 'Appli compagnon (téléphone)' : 'Companion app (phone)', '<div id="m-companion-settings"></div>')}
      ${sec('zones', L ? 'Zones et cartes hors ligne' : 'Areas and offline maps', '<div id="m-zones-settings"></div>')}
      ${sec('lang', L ? 'Langue et envoi des sorties' : 'Language and ride upload', lang)}
      ${sec('expert', L ? 'Mode expert : créer mes zones' : 'Expert mode: build my own zones', '<div id="m-expert-settings"></div>')}
    </section>`;
  }

  // ————————————————————————————————————————————— Musique et Spotify

  /** Lecteur compact de la barre du haut, et section complète dans les réglages. */
  renderMusic(): void {
    const L = fr();
    const top = this.root.querySelector('#m-music');
    if (top && musicSource() === 'spotify') {
      // Spotify piloté depuis le jeu : lecture ici, titre, commandes, playlists, volume.
      top.innerHTML = `<img class="mm-cover" id="sp-cover" alt="" hidden />
        <span class="mm-now" id="mu-now"><i class="sp">●</i> Spotify</span>
        <button class="mm-ico" id="sp-prev" title="${L ? 'Précédent' : 'Previous'}">${ICON.prev}</button>
        <button class="mm-ico on" id="sp-play" title="${L ? 'Lecture / pause (B)' : 'Play / pause (B)'}">${ICON.play}</button>
        <button class="mm-ico" id="sp-next" title="${L ? 'Suivant (N)' : 'Next (N)'}">${ICON.next}</button>
        <button class="mm-ico" id="sp-lists" title="${L ? 'Mes playlists' : 'My playlists'}">${ICON.list}</button>
        <button class="mm-ico" id="sp-game" title="${L ? 'Passer à la musique du jeu (arrête Spotify)' : 'Switch to the game music (stops Spotify)'}">${ICON.music}</button>
        ${
          spotify.canPlayHere
            ? `<button class="mm-spotify" id="sp-here" title="${L ? 'Faire jouer Spotify par le jeu' : 'Play Spotify in the game'}">${L ? 'Écouter ici' : 'Play here'}</button>`
            : `<button class="mm-spotify" id="sp-relog" title="${L ? 'Une reconnexion autorise la lecture dans le jeu' : 'Reconnect once to allow in-game playback'}">${L ? 'Jouer ici' : 'Play here'}</button>`
        }
        <div class="mm-pop" id="sp-pop" hidden></div>`;
      const later = () => setTimeout(() => void this.refreshNowPlaying(), 700);
      top.querySelector('#sp-prev')?.addEventListener('click', () => void spotify.previous().then(later));
      // Lecture : dans le jeu dès que c'est autorisé (sinon l'appareil actif, ex. le téléphone).
      top.querySelector('#sp-play')?.addEventListener('click', () => {
        void spotify.toggleSmart().then(later);
      });
      top.querySelector('#sp-next')?.addEventListener('click', () => void spotify.next().then(later));
      top.querySelector('#sp-relog')?.addEventListener('click', () => void spotify.login());
      top.querySelector('#sp-here')?.addEventListener('click', () => {
        void spotify.playHere().then((ok) => {
          if (!ok) this.spotifyError();
          later();
        });
      });
      top.querySelector('#sp-lists')?.addEventListener('click', () => void this.spotifyPlaylists());
      top.querySelector('#sp-game')?.addEventListener('click', () => void this.switchSource('game'));
      void this.refreshNowPlaying();
    } else if (top) {
      const cur = music.enabled && music.current ? esc(music.current.title) : L ? 'Musique coupée' : 'Music off';
      top.innerHTML = `<button class="mm-ico ${music.enabled ? 'on' : ''}" id="mu-toggle" title="${L ? 'Musique marche / arrêt (B)' : 'Music on / off (B)'}">${music.enabled ? ICON.music : ICON.musicOff}</button>
        <span class="mm-now" id="mu-now">${cur}</span>
        <button class="mm-ico" id="mu-next" title="${L ? 'Morceau suivant (N)' : 'Next track (N)'}">${ICON.next}</button>
        <button class="mm-spotify" id="sp-login" title="${spotify.connected ? (L ? 'Passer à Spotify' : 'Switch to Spotify') : L ? 'Connecter ton compte Spotify' : 'Connect your Spotify account'}"><i class="sp">●</i> Spotify</button>`;
      top.querySelector('#mu-toggle')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      top.querySelector('#mu-next')?.addEventListener('click', () => music.next());
      top.querySelector('#sp-login')?.addEventListener('click', () => (spotify.connected ? void this.switchSource('spotify') : this.spotifyConnect()));
    }
    const set = this.root.querySelector('#m-music-settings');
    if (set) {
      set.innerHTML = `<button class="btn small ${music.enabled ? 'on' : ''}" id="mu-toggle2">♪ ${L ? 'Musique du jeu' : 'Game music'} : ${music.enabled ? (music.yielded ? (L ? 'laisse la place à Spotify' : 'yields to Spotify') : L ? 'activée' : 'on') : L ? 'coupée' : 'off'}</button>
        <label class="mm-vol">Volume<input id="mu-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" /></label>
        ${spotify.connected ? `<span class="mm-seg-inline"><button class="btn small ${musicSource() === 'game' ? 'primary' : ''}" id="src-game">${L ? 'Source : musique du jeu' : 'Source: game music'}</button><button class="btn small ${musicSource() === 'spotify' ? 'primary' : ''}" id="src-spotify">${L ? 'Source : Spotify' : 'Source: Spotify'}</button></span>` : ''}
        ${spotify.connected ? `<button class="btn small" id="sp-logout">${L ? 'Déconnecter Spotify' : 'Disconnect Spotify'}</button>` : `<button class="btn small mm-spotify" id="sp-login2"><i class="sp">●</i> ${L ? 'Connecter Spotify' : 'Connect Spotify'}</button>`}`;
      set.querySelector('#mu-toggle2')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      set.querySelector('#mu-vol')?.addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
      set.querySelector('#sp-login2')?.addEventListener('click', () => this.spotifyConnect());
      set.querySelector('#src-game')?.addEventListener('click', () => void this.switchSource('game'));
      set.querySelector('#src-spotify')?.addEventListener('click', () => void this.switchSource('spotify'));
      set.querySelector('#sp-logout')?.addEventListener('click', () => {
        spotify.logout();
        music.yieldToExternal(false);
        this.renderMusic();
      });
    }
  }

  /** Bascule entre la musique du jeu et Spotify (sans déconnecter le compte). */
  private async switchSource(to: 'game' | 'spotify'): Promise<void> {
    await setMusicSource(to);
    this.renderMusic();
  }

  /** Titre Spotify affiché (appelé aussi par le suivi périodique). */
  async refreshNowPlaying(): Promise<void> {
    if (!spotify.connected) return;
    const el = this.root.querySelector('#mu-now');
    if (!el) return;
    const np = await spotify.nowPlaying();
    el.innerHTML = np ? `${esc(np.title)} <span>— ${esc(np.artist)}</span>` : `<i class="sp">●</i> ${fr() ? 'Spotify : rien en lecture' : 'Spotify: nothing playing'}`;
    el.setAttribute('title', np ? `${np.title} — ${np.artist}` : '');
    const cover = this.root.querySelector<HTMLImageElement>('#sp-cover');
    if (cover) {
      cover.hidden = !np?.image;
      if (np?.image) cover.src = np.image;
    }
    const play = this.root.querySelector('#sp-play');
    if (play) play.innerHTML = np?.isPlaying ? ICON.pause : ICON.play;
    const here = this.root.querySelector<HTMLElement>('#sp-here');
    if (here) {
      const on = np?.isPlaying ? await spotify.playingHere() : false;
      here.classList.toggle('on', on);
      here.textContent = on ? (fr() ? '♪ Dans le jeu' : '♪ In game') : fr() ? 'Écouter ici' : 'Play here';
    }
  }

  private spotifyError(): void {
    const msg = spotify.playerError || (fr() ? 'Lecture impossible dans le jeu.' : 'Cannot play in the game.');
    const el = this.root.querySelector('#mu-now');
    if (el) el.innerHTML = `<span class="warn-text">${esc(msg)}</span>`;
  }

  /** Liste des playlists du compte : un clic la lance dans le jeu. */
  private async spotifyPlaylists(): Promise<void> {
    const pop = this.root.querySelector<HTMLElement>('#sp-pop');
    if (!pop) return;
    if (!pop.hidden) {
      pop.hidden = true;
      return;
    }
    const L = fr();
    pop.hidden = false;
    pop.innerHTML = `<div class="mm-pop-head">${L ? 'Mes playlists' : 'My playlists'}</div><div class="mm-hint">${L ? 'Chargement…' : 'Loading…'}</div>`;
    const lists = await spotify.playlists();
    pop.innerHTML = `<div class="mm-pop-head">${L ? 'Mes playlists' : 'My playlists'}
        <label class="mm-vol">Volume<input id="sp-vol" type="range" min="0" max="1" step="0.05" value="0.7" /></label></div>
      <div class="mm-pop-list">${
        lists.length
          ? lists.map((p) => `<button class="mm-pl" data-uri="${esc(p.uri)}">${p.image ? `<img src="${esc(p.image)}" alt="" />` : '<i></i>'}<b>${esc(p.name)}</b><span>${p.tracks}</span></button>`).join('')
          : `<p class="mm-hint">${spotify.canPlayHere ? (L ? 'Aucune playlist.' : 'No playlists.') : L ? 'Clique « Jouer ici » (reconnexion) pour voir tes playlists.' : 'Click “Play here” (reconnect) to see your playlists.'}</p>`
      }</div>`;
    pop.querySelector('#sp-vol')?.addEventListener('input', (e) => spotify.setHereVolume(Number((e.target as HTMLInputElement).value)));
    pop.querySelectorAll<HTMLElement>('[data-uri]').forEach((b) =>
      b.addEventListener('click', () => {
        pop.hidden = true;
        void spotify.playContext(b.dataset.uri as string).then((ok) => {
          if (!ok) this.spotifyError();
          setTimeout(() => void this.refreshNowPlaying(), 900);
        });
      }),
    );
  }

  /** Connexion Spotify ; la première fois, assistant pour déclarer l'application (identifiant client). */
  private spotifyConnect(): void {
    if (spotify.available) {
      void spotify.login();
      return;
    }
    const L = fr();
    const uri = redirectUri();
    const local = location.hostname === 'localhost';
    const dlg = document.createElement('div');
    dlg.className = 'mm-modal';
    dlg.innerHTML = `<div class="mm-dialog">
      <h2><i class="sp">●</i> ${L ? 'Connecter Spotify' : 'Connect Spotify'}</h2>
      <p>${L ? 'Une seule fois : Spotify demande que le jeu soit déclaré comme « application » sur ton compte développeur (gratuit, 2 minutes).' : 'One time only: Spotify needs the game declared as an “app” on your developer account (free, 2 minutes).'}</p>
      <ol>
        <li>${L ? 'Ouvre' : 'Open'} <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> ${L ? 'et clique « Create app ».' : 'and click “Create app”.'}</li>
        <li>${L ? 'Nom : « Allez Robert » ; API : coche « Web API ».' : 'Name: “Allez Robert”; API: tick “Web API”.'}</li>
        <li>${L ? 'Redirect URI, à copier exactement (avec le « / » final) :' : 'Redirect URI, copy exactly (with the trailing “/”):'} <code>${esc(uri)}</code> <button class="mm-link" id="sp-copy">${L ? 'Copier' : 'Copy'}</button></li>
        <li>${L ? 'Enregistre, puis colle ici le « Client ID » :' : 'Save, then paste the “Client ID” here:'}</li>
      </ol>
      <input id="sp-id" class="mm-input" placeholder="Client ID" autocomplete="off" spellcheck="false" />
      ${local ? `<p class="mm-hint">${L ? 'Spotify refuse « localhost » : à la connexion, le jeu passe tout seul à l’adresse 127.0.0.1 (garde-la ensuite).' : 'Spotify rejects “localhost”: on sign-in the game switches to 127.0.0.1 by itself (keep using it afterwards).'}</p>` : ''}
      <p class="mm-hint">${L ? 'La musique sort de ton appli Spotify (ordinateur ou téléphone) ; lecture / pause et morceau suivant demandent un compte Premium.' : 'Music plays from your Spotify app (computer or phone); play / pause and next need Premium.'}</p>
      <div class="mm-dialog-foot"><button class="btn" id="sp-cancel">${L ? 'Annuler' : 'Cancel'}</button><button class="btn primary" id="sp-ok">${L ? 'Se connecter à Spotify' : 'Sign in to Spotify'}</button></div>
    </div>`;
    this.root.appendChild(dlg);
    const close = () => dlg.remove();
    dlg.querySelector('#sp-cancel')?.addEventListener('click', close);
    dlg.addEventListener('click', (e) => e.target === dlg && close());
    dlg.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    dlg.querySelector('#sp-copy')?.addEventListener('click', () => void navigator.clipboard?.writeText(uri));
    dlg.querySelector('#sp-ok')?.addEventListener('click', () => {
      const input = dlg.querySelector('#sp-id') as HTMLInputElement;
      if (!spotify.setClientId(input.value)) {
        input.classList.add('bad');
        input.focus();
        return;
      }
      void spotify.login();
    });
    (dlg.querySelector('#sp-id') as HTMLInputElement).focus();
  }

  // ————————————————————————————————————————————— Capteurs

  private renderDevices(): void {
    const box = this.root.querySelector('#m-devices');
    if (!box) return;
    const L = fr();
    const list = this.devices.list();
    const transports = this.devices.transports();
    const roles: Array<[Role, I18nKey, string]> = [
      ['trainer', 'trainer', L ? 'Résistance pilotée (FTMS, FE-C)' : 'Controlled resistance (FTMS, FE-C)'],
      ['power', 'powerMeter', L ? 'Pédales ou manivelle (Assioma…)' : 'Pedals or crank (Assioma…)'],
      ['heartRate', 'hrm', L ? 'Ceinture ou montre (TICKR…)' : 'Strap or watch (TICKR…)'],
      ['shifter', 'shifter', L ? 'Manettes (Click, AXS, D-Fly)' : 'Controllers (Click, AXS, D-Fly)'],
      ['fan', 'fan', L ? 'Ventilateur connecté' : 'Smart fan'],
    ];
    const tile = ([role, k, sub]: [Role, I18nKey, string]) => {
      const ds = list.filter((d) => d.roleIds?.includes(role));
      const ok = ds.some((d) => d.ok);
      return `<div class="mm-dev ${ok ? 'ok' : ds.length ? 'pending' : ''}">
        <div class="mm-dev-ico">${ICON[role as keyof typeof ICON] ?? ''}</div>
        <div class="mm-dev-body"><b>${esc(t(k))}</b>
          ${ds.length ? ds.map((d) => `<span class="mm-dev-name">${esc(d.name)} · ${esc(d.state)}${d.detail ? ` · ${esc(d.detail)}` : ''} <button class="mm-link" data-forget="${esc(d.id)}">${L ? 'oublier' : 'forget'}</button></span>`).join('') : `<span>${esc(sub)}</span>`}
        </div>
        <button class="btn small ${ok ? '' : 'primary'}" data-pair="${role}">${ok ? (L ? 'Changer' : 'Change') : L ? 'Associer' : 'Pair'}</button>
      </div>`;
    };
    box.innerHTML = `
      <div class="mm-devgrid">${roles.map(tile).join('')}</div>
      <div class="mm-devopts">
        <div class="field">${L ? 'Connexion' : 'Connection'}${this.seg('m-transport', transports[0]?.id ?? '', transports.map((tr) => [tr.id, tr.label]))}</div>
        <div id="m-adapters"></div>
        <label class="mm-check"><input type="checkbox" id="m-sim" ${this.devices.simulatorOn() ? 'checked' : ''}/> ${t('simulator')} (${L ? 'rouler sans matériel' : 'ride without hardware'})</label>
        <label class="mm-check"><input type="checkbox" id="m-guest" ${this.s.guest ? 'checked' : ''}/> ${L ? 'Invité sans matériel (clavier / manette, hors classements)' : 'Guest without hardware (keyboard / gamepad, unranked)'}</label>
      </div>
      ${this.devices
        .warnings()
        .map((w) => `<div class="warning">${esc(w)}</div>`)
        .join('')}
      <div class="mm-note">${t('oneAppAtATime')}<br/>${t('edgeWarn')}</div>
      <div id="m-devextra"></div>`;
    this.bindSegs(box);
    const extra = box.querySelector<HTMLElement>('#m-devextra');
    if (extra) this.devices.renderExtras?.(extra);
    box.querySelectorAll<HTMLButtonElement>('[data-pair]').forEach((b) =>
      b.addEventListener('click', async () => {
        const transport = (box.querySelector('#m-transport') as HTMLElement).dataset.value ?? '';
        b.disabled = true;
        try {
          await this.devices.pair(b.dataset.pair as Role, transport);
        } catch (e) {
          alert(String((e as Error).message ?? e));
        } finally {
          b.disabled = false;
          this.renderDevices();
        }
      }),
    );
    box.querySelectorAll<HTMLButtonElement>('[data-forget]').forEach((b) => b.addEventListener('click', () => this.devices.forget(b.dataset.forget as string)));
    (box.querySelector('#m-guest') as HTMLInputElement).addEventListener('change', (e) => {
      this.s.guest = (e.target as HTMLInputElement).checked;
      saveSettings(this.s);
    });
    (box.querySelector('#m-sim') as HTMLInputElement).addEventListener('change', (e) => {
      this.devices.useSimulator((e.target as HTMLInputElement).checked);
      this.renderDevices();
      this.renderStatus();
    });
    if (this.devices.adapters) {
      void this.devices.adapters().then((ads) => {
        const el = box.querySelector('#m-adapters');
        if (!el || ads.length < 2) return;
        el.innerHTML = `<label class="field">${L ? 'Adaptateur Bluetooth' : 'Bluetooth adapter'}<select id="m-adapter">${ads.map((a) => `<option value="${esc(a.id)}" ${a.isDefault ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
        el.querySelector('select')?.addEventListener('change', (e) => void this.devices.selectAdapter?.((e.target as HTMLSelectElement).value));
        enhanceSelects(el);
      });
    }
  }

  /**
   * Pas de départ tant que la carte de la zone n'est pas téléchargée (le téléchargement démarre
   * tout seul), application Windows comme navigateur. Sans stockage hors ligne, la zone se charge depuis le serveur.
   */
  private zoneReady(args: Parameters<MenuCallbacks['onStart']>): boolean {
    const z = this.zones.find((c) => c.id === this.worldId);
    if (!z?.pack) return true;
    if (packState(z.id, z.pack.version).kind !== 'absent') return true;
    const busy = this.downloads.get(z.id);
    if (!busy || busy.error) void this.downloadZone(z.id);
    this.showZoneDownload(z.id, () => this.launch(...args));
    return false;
  }

  /** Écran d'attente du téléchargement d'une zone : barre et pourcentage lus sur la même valeur ; départ automatique à la fin. */
  private showZoneDownload(id: string, then: () => void): void {
    const L = fr();
    document.querySelector('.world-wait.zone-dl')?.remove();
    const el = document.createElement('div');
    el.className = 'world-wait zone-dl';
    const tip = inTauri
      ? ''
      : L
        ? 'Astuce : l’application Windows télécharge les zones plus vite et les garde sur ton ordinateur. <a href="/#telecharger" target="_blank" rel="noopener" style="color:#ffd23f">Télécharger l’application</a>'
        : 'Tip: the Windows app downloads areas faster and keeps them on your computer. <a href="/#telecharger" target="_blank" rel="noopener" style="color:#ffd23f">Get the app</a>';
    el.innerHTML = `<div class="world-wait-box"><div class="world-wait-bar"><i style="animation:none;width:0%"></i></div><span></span><small class="world-wait-tip">${tip}</small><button class="btn small" style="margin-top:14px">${L ? 'Annuler' : 'Cancel'}</button></div>`;
    document.body.appendChild(el);
    const bar = el.querySelector<HTMLElement>('.world-wait-bar i') as HTMLElement;
    const label = el.querySelector<HTMLElement>('.world-wait-box > span') as HTMLElement;
    const name = this.zoneLabel(id);
    const stop = () => {
      clearInterval(timer);
      el.remove();
    };
    el.querySelector('button')?.addEventListener('click', stop);
    const tick = () => {
      const dl = this.downloads.get(id);
      if (dl?.error) {
        bar.style.width = '0%';
        label.textContent = `${L ? 'Échec du téléchargement' : 'Download failed'} : ${dl.error}`;
        const retry = el.querySelector('button');
        if (retry) {
          retry.textContent = L ? 'Fermer' : 'Close';
        }
        clearInterval(timer);
        return;
      }
      if (!dl) {
        stop();
        if (packState(id, this.zones.find((c) => c.id === id)?.pack?.version).kind === 'installed') then();
        return;
      }
      const pct = Math.floor((dl.done / Math.max(dl.total, 1)) * 100);
      bar.style.transition = 'none';
      bar.style.width = `${pct}%`;
      label.textContent = `${L ? 'Téléchargement de' : 'Downloading'} ${name} ${pct} %`;
    };
    const timer = setInterval(tick, 150);
    tick();
  }

  /** Départ d'une sortie : l'appli compagnon est d'abord proposée (tous les modes). */
  private launch(...args: Parameters<MenuCallbacks['onStart']>): void {
    if (!this.zoneReady(args)) return;
    void companionQr()
      .beforeRide()
      .then(() => this.cb.onStart(...args));
  }

  private start(more: { customRoute?: RouteData; openStart?: { x: number; z: number } } = {}): void {
    const invite = (this.root.querySelector('#m-invite') as HTMLInputElement | null)?.value.trim();
    const laps = Number((this.root.querySelector('#m-laps') as HTMLInputElement | null)?.value);
    if (Number.isFinite(laps) && laps >= 1) this.s.raceLaps = Math.min(20, Math.round(laps));
    this.launch(this.s, { ...(this.workoutFile ? { workoutFile: this.workoutFile } : {}), ...(invite ? { inviteCode: invite } : {}), ...more });
  }

  // ————————————————————————————————————————————— Événements

  private bind(): void {
    const s = this.s;
    this.bindSegs(this.root.querySelector('.mm-panel') ?? this.root);
    this.bindSteppers(this.root);
    const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
      const el = this.root.querySelector(`#${id}`) as T | null;
      el?.addEventListener(ev, () => fn(el));
    };
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
      this.onSettingsSaved?.(s);
    };
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => {
        // « Rouler » de l'accueil : premier geste de l'utilisateur, le son est autorisé ; au premier lancement, le tutoriel prend la suite.
        if (this.tab === 'home' && el.dataset.tab === 'ride') {
          music.unlock();
          if (this.onHomeRide?.()) return;
        }
        // Nom ou avatar du coureur : sa fiche, pas l'historique.
        if (el.classList.contains('mm-me')) this.profileView = 'profile';
        this.go(el.dataset.tab as Tab);
      }),
    );
    on('m-tuto', 'click', () => this.onTutorial?.());
    on('m-login', 'click', () => this.onLogin?.());
    on('m-logout', 'click', () => this.onLogout?.());
    // Rouler : le parcours dessiné ou le départ du libre choisis sur la carte.
    on('m-start', 'click', () => {
      const drawn = this.drawnChoice;
      this.start(drawn ? { customRoute: drawn } : s.mode === 'open' && this.freeStart ? { openStart: this.freeStart } : {});
    });
    on('m-explore', 'click', () => this.onExplore?.());
    // Itinéraire sur la carte : parcours calculé (sortie libre sur ce tracé) ou roulage libre.
    this.planner.noFree = s.mode === 'race';
    if (this.picker === 'map' && this.openWorld)
      this.planner.bind(this.root, (r) => this.routeCard(r), {
        // « Rouler cet itinéraire » / « Rouler en libre » : la sortie part tout de suite.
        ride: (route) => {
          this.drawn = route;
          this.drawnWorld = this.worldId;
          s.routeId = route.id;
          s.reverse = false;
          s.startM = 0;
          if (s.mode !== 'free' && s.mode !== 'workout' && s.mode !== 'race') s.mode = 'free';
          this.picker = null;
          changed();
          this.start({ customRoute: route });
        },
        free: (start) => {
          s.mode = 'open';
          this.freeStart = start;
          this.drawnWorld = this.worldId;
          this.picker = null;
          changed();
          this.start(start ? { openStart: start } : {});
        },
      });
    // Rouler : modes et itinéraires.
    this.root.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) =>
      el.addEventListener('click', () => {
        const v = el.dataset.mode as Settings['mode'];
        if (!(v === 'free' && s.mode === 'open')) s.mode = v;
        // Entraînement : la liste des séances s'ouvre au milieu de l'écran, comme la carte de France.
        if (v === 'workout') this.picker = 'workouts';
        if (v === 'challenge') this.picker = 'koms';
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-kom]').forEach((el) =>
      el.addEventListener('click', () => {
        // Montée d'une autre zone : la zone se charge, la montée est choisie à son arrivée.
        if (el.dataset.komZone && el.dataset.komZone !== this.worldId && this.onWorld) {
          this.pendingKom = { routeId: el.dataset.komRoute as string, segId: el.dataset.kom as string };
          this.picker = null;
          this.loadingZone = this.zoneLabel(el.dataset.komZone);
          s.mode = 'challenge';
          this.onWorld(el.dataset.komZone);
          return;
        }
        s.mode = 'challenge';
        s.challengeSeg = el.dataset.kom as string;
        // montée d'un autre parcours de la zone : on prend ce parcours (dans son sens)
        if (el.dataset.komRoute && el.dataset.komRoute !== s.routeId) {
          s.routeId = el.dataset.komRoute;
          s.reverse = false;
        }
        // choisie dans la fenêtre de la zone : la fenêtre se ferme
        if (this.picker) this.picker = null;
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-komzone]').forEach((el) =>
      el.addEventListener('click', () => {
        this.komZone = el.dataset.komzone ?? '';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('tr[data-kom]').forEach((el) => el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), el.click())));
    this.root.querySelectorAll<HTMLElement>('[data-fav]').forEach((el) => {
      const toggle = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.fav as string;
        if (this.favWorkouts.has(id)) this.favWorkouts.delete(id);
        else this.favWorkouts.add(id);
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify([...this.favWorkouts]));
        } catch {
          // Stockage indisponible : favoris pour cette session seulement.
        }
        this.render();
      };
      el.addEventListener('click', toggle);
      el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && toggle(e));
    });
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => {
        const preset = el.dataset.preset as string;
        // Séance perso : jouée comme un fichier (format JSON du jeu).
        const mine = preset.startsWith('mine:') ? this.myWorkouts.find((w) => `mine:${w.id}` === preset) : undefined;
        if (mine) {
          this.workoutFile = { name: `${mine.name}.json`, content: JSON.stringify({ name: mine.name, ...(mine.description ? { description: mine.description } : {}), steps: mine.steps }) };
          if (this.picker === 'workouts') this.picker = null;
          this.render();
          return;
        }
        s.workoutPreset = preset;
        this.workoutFile = undefined;
        if (this.picker === 'workouts') this.picker = null;
        changed();
        this.render();
      }),
    );
    // Carte de France : une zone choisie ouvre ses choix (parcours, libre, à dessiner).
    if (this.picker === 'zones')
      this.franceMap.bind(this.root, this.mapZones(), (id) => {
        if (id === this.worldId) {
          this.picker = 'zone';
          this.render();
          return;
        }
        if (this.loadingZone) return;
        this.routesAfterWorld = true;
        this.loadingZone = this.mapZones().find((z) => z.id === id)?.name ?? id;
        const hint = this.root.querySelector('.fm-dialog .mm-hint');
        if (hint) hint.textContent = `${fr() ? 'Chargement de' : 'Loading'} ${this.loadingZone}…`;
        this.onWorld?.(id);
      });
    // Zones voisines : ajoutées ou retirées, le monde est rechargé avec elles (même zone principale).
    this.root.querySelectorAll<HTMLElement>('[data-near]').forEach((el) =>
      el.addEventListener('click', () => {
        if (this.loadingZone) return;
        const id = el.dataset.near as string;
        const near = neighbourZones({ formatVersion: 1, zones: this.zones }, this.worldId);
        const on = new Set(this.loadedZones.filter((z) => z !== this.worldId));
        if (on.has(id)) on.delete(id);
        else on.add(id);
        this.loadingZone = id;
        this.render();
        this.onWorld?.(compositeId([this.worldId, ...near.filter((z) => on.has(z))]));
      }),
    );
    // Zone ouverte : parcours fixés, parcours libre (départ par défaut), parcours à dessiner.
    this.root.querySelectorAll<HTMLElement>('[data-zc]').forEach((el) =>
      el.addEventListener('click', () => {
        const c = el.dataset.zc;
        // Parcours libre : la carte de la zone s'ouvre pour fixer le point de départ.
        if (c === 'free' && this.openWorld) {
          this.planner.startOnly = true;
          this.picker = 'map';
          this.render();
          return;
        }
        if (c === 'free') {
          this.selMap = true;
          s.mode = 'open';
          this.freeStart = null;
          this.picker = null;
          changed();
          this.render();
          return;
        }
        this.planner.startOnly = false;
        this.picker = c === 'draw' ? 'map' : 'routes';
        this.render();
      }),
    );
    // « Choisir ma sortie » et carte du choix : fenêtre de choix au milieu de l'écran.
    this.root.querySelectorAll<HTMLElement>('[data-picker]').forEach((el) =>
      el.addEventListener('click', () => {
        this.picker = el.dataset.picker as 'zones' | 'zone' | 'routes' | 'map' | 'route' | 'workouts' | 'koms';
        if (this.picker === 'zones' && el.closest('.mm-pickers')) this.franceMap.reset();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-picker-close]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target === el) this.closePicker();
      }),
    );
    // Zones : télécharger ou supprimer le pack de cartes.
    this.root.querySelectorAll<HTMLElement>('[data-pack]').forEach((el) => el.addEventListener('click', () => void this.downloadZone(el.dataset.pack as string)));
    // Carte de parcours : sa fiche s'ouvre (records, montées) ; on part ou on le choisit depuis elle.
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
      el.addEventListener('click', () => {
        this.detailId = el.dataset.route as string;
        this.detailReverse = this.detailId === s.routeId && s.reverse;
        this.detailStartM = this.detailId === s.routeId ? s.startM || 0 : 0;
        this.fromRect = el.getBoundingClientRect();
        this.picker = 'route';
        this.render();
      }),
    );
    const pickRoute = () => {
      this.selMap = true;
      s.routeId = this.detailId;
      s.reverse = this.detailReverse;
      s.startM = this.detailStartM;
      if (s.mode === 'open' || s.mode === 'ftpTest' || s.mode === 'challenge') s.mode = 'free';
      this.picker = null;
      changed();
    };
    this.root.querySelectorAll<HTMLElement>('[data-rd]').forEach((el) =>
      el.addEventListener('click', () => {
        pickRoute();
        if (el.dataset.rd === 'ride') this.start();
        else this.render();
      }),
    );
    // Défi sur une montée de la fiche : mode défi KOM sur ce parcours, départ lancé.
    this.root.querySelectorAll<HTMLElement>('[data-rd-kom]').forEach((el) =>
      el.addEventListener('click', () => {
        pickRoute();
        s.mode = 'challenge';
        s.challengeSeg = el.dataset.rdKom as string;
        changed();
        this.start();
      }),
    );
    if (this.picker === 'route') {
      const r = this.routes.find((x) => x.id === this.detailId);
      if (r) void loadRouteBoards(this.root, this.detailRoute(r), !!this.account);
      // Sens du parcours : la fiche se refait pour l'autre sens (profil, montées, records) ; le
      // départ choisi reste au même endroit du tracé.
      this.root.querySelectorAll<HTMLElement>('#rd-dir [data-v]').forEach((el) =>
        el.addEventListener('click', () => {
          const rev = el.dataset.v === '1';
          if (r && rev !== this.detailReverse) {
            this.detailReverse = rev;
            this.detailStartM = snapStartM(this.detailDir(r), mirrorStartM(r.lengthM, this.detailStartM));
          }
          this.render();
        }),
      );
      // Départ choisi sur la carte (boucles) : la fiche se refait depuis ce point.
      const setStart = (startM: number) => {
        if (startM === this.detailStartM) return;
        this.detailStartM = startM;
        this.render();
      };
      if (r) {
        const dir = this.detailDir(r);
        bindStartPicker(this.root, this.detailRoute(r), (d) => setStart(snapStartM(dir, d + this.detailStartM)));
      }
      this.root.querySelectorAll<HTMLElement>('[data-rd-start]').forEach((el) => el.addEventListener('click', () => setStart(0)));
    }
    this.animatePicker();
    on<HTMLInputElement>('m-workout', 'change', async (el) => {
      const f = el.files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      // Gardée dans « Mes séances » (et synchronisée avec le compte).
      try {
        const parsed = parseWorkoutFile(f.name, this.workoutFile.content);
        const ext = f.name.toLowerCase().split('.').pop() ?? '';
        if (ext === 'zwo' || ext === 'erg' || ext === 'mrc') {
          const name = (parsed.name || f.name.replace(/\.[^.]+$/, '')).slice(0, 100);
          await rideHistory.saveWorkout({ id: `${ext}.${contentId(this.workoutFile.content)}`, name, source: ext, type: null, description: parsed.description ?? null, steps: parsed.steps, deleted: false });
          this.myWorkouts = await rideHistory.workouts();
        }
      } catch (err) {
        console.warn('Séance non gardée', err);
      }
      if (this.picker === 'workouts') this.picker = null;
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-pview]').forEach((el) =>
      el.addEventListener('click', () => {
        this.profileView = el.dataset.pview as 'profile' | 'history';
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-wkfilter]').forEach((el) =>
      el.addEventListener('click', () => {
        this.wkFilter = (el.dataset.wkfilter ?? '') as WorkoutType | 'mine' | '';
        if (this.wkFilter === 'mine') void rideHistory.workouts().then((list) => {
          this.myWorkouts = list;
          if (this.picker === 'workouts') this.render();
        });
        this.render();
      }),
    );
    // Éditeur de visage : aperçu immédiat pendant le glissement, enregistrement au relâcher.
    const faceLive = (look: AvatarLook) => {
      s.look = look;
      this.onLookLive?.(look, this.bareHeadPreview);
    };
    const faceCommit = (before: AvatarLook) => {
      this.faceUndo.push(before);
      if (this.faceUndo.length > 30) this.faceUndo.shift();
      saveSettings(s);
      this.onSettingsSaved?.(s);
      const undo = this.root.querySelector<HTMLButtonElement>('#fe-undo');
      if (undo) undo.disabled = false;
    };
    const faceSet = (look: AvatarLook) => {
      const before = s.look;
      faceLive(look);
      faceCommit(before);
      this.render();
    };
    this.root.querySelectorAll<HTMLInputElement>('[data-feslider]').forEach((el) => {
      let before: AvatarLook | null = null;
      el.addEventListener('input', () => {
        before ??= s.look;
        faceLive(withSlider(s.look, el.dataset.feslider as FaceSlider, Number(el.value)));
      });
      el.addEventListener('change', () => {
        if (before) faceCommit(before);
        before = null;
      });
    });
    const feNum = (id: string, key: 'beard' | 'freckles') =>
      on<HTMLInputElement>(id, 'input', (el) => faceLive({ ...s.look, [key]: Number(el.value) }));
    feNum('fe-beard', 'beard');
    feNum('fe-freckles', 'freckles');
    for (const id of ['fe-beard', 'fe-freckles', 'fe-skin', 'fe-hair']) {
      let before: AvatarLook | null = null;
      on<HTMLInputElement>(id, 'pointerdown', () => (before = s.look));
      on<HTMLInputElement>(id, 'change', () => {
        faceCommit(before ?? s.look);
        before = null;
      });
    }
    on<HTMLInputElement>('fe-skin', 'input', (el) => faceLive({ ...s.look, skin: el.value }));
    on<HTMLInputElement>('fe-hair', 'input', (el) => faceLive({ ...s.look, hair: el.value }));
    on<HTMLInputElement>('fe-moustache', 'change', (el) => faceSet({ ...s.look, moustache: el.checked }));
    this.root.querySelectorAll<HTMLElement>('#fe-hairstyle [data-v]').forEach((el) =>
      el.addEventListener('click', () => faceSet({ ...s.look, hairStyle: Number(el.dataset.v) })),
    );
    // Homme / femme : seuls les profils de base du même sexe sont proposés.
    this.root.querySelectorAll<HTMLElement>('[data-fesex]').forEach((el) =>
      el.addEventListener('click', () => faceSet(withSex(s.look, el.dataset.fesex as 'male' | 'female'))),
    );
    this.root.querySelectorAll<HTMLElement>('[data-feprofile]').forEach((el) =>
      el.addEventListener('click', () => faceSet(withProfile(s.look, el.dataset.feprofile as string))),
    );
    this.root.querySelectorAll<HTMLElement>('[data-fetab]').forEach((el) =>
      el.addEventListener('click', () => {
        this.faceTab = el.dataset.fetab as FaceTab;
        this.render();
      }),
    );
    on('fe-random', 'click', () => faceSet(withRandomFace(s.look)));
    on('fe-reset', 'click', () => faceSet(withBaseHead(s.look)));
    on('fe-undo', 'click', () => {
      const prev = this.faceUndo.pop();
      if (!prev) return;
      faceLive(prev);
      saveSettings(s);
      this.onSettingsSaved?.(s);
      this.render();
    });
    // Ressemblance photo : consentement à chaque fois, traitement local (onboarding/likeness.ts).
    this.root.querySelector('.fe-photo')?.addEventListener('toggle', (e) => (this.photoOpen = (e.target as HTMLDetailsElement).open));
    on<HTMLInputElement>('fe-consent', 'change', (el) => {
      const input = this.root.querySelector<HTMLInputElement>('#fe-photo');
      if (input) input.disabled = !el.checked;
      this.root.querySelector('#fe-photo-label')?.setAttribute('aria-disabled', String(!el.checked));
    });
    on<HTMLInputElement>('fe-photo', 'change', async (el) => {
      const f = el.files?.[0];
      el.value = '';
      if (!f || !this.root.querySelector<HTMLInputElement>('#fe-consent')?.checked) return;
      const msg = this.root.querySelector<HTMLElement>('#fe-photo-msg');
      const L = getLang() === 'fr';
      if (msg) msg.textContent = L ? 'Analyse sur ton appareil…' : 'Analysing on your device…';
      try {
        // Repères détectés, à corriger à la main dans une fenêtre avant l'ajustement de l'avatar.
        const { likenessWithEditing } = await import('./landmarkEditor.ts');
        const l = await likenessWithEditing(f);
        if (!l) {
          const m3 = this.root.querySelector<HTMLElement>('#fe-photo-msg');
          if (m3) m3.textContent = L ? 'Annulé ; photo oubliée.' : 'Cancelled; photo discarded.';
          return;
        }
        faceSet(withLikeness(s.look, l));
        const m2 = this.root.querySelector<HTMLElement>('#fe-photo-msg');
        if (m2) m2.textContent = l.face ? (L ? 'Visage, teint et cheveux appliqués ; photo oubliée.' : 'Face, skin and hair applied; photo discarded.') : L ? 'Aucun visage trouvé : teint et cheveux seulement.' : 'No face found: skin and hair only.';
      } catch {
        if (msg) msg.textContent = L ? 'Analyse impossible sur cet appareil.' : 'Analysis failed on this device.';
      }
    });
    on<HTMLInputElement>('fe-bare', 'change', (el) => {
      this.bareHead = el.checked;
      this.onLookLive?.(s.look, this.bareHeadPreview);
    });
    // Garage : catégories, objets, vues et rotation de l'aperçu.
    this.root.querySelectorAll<HTMLElement>('[data-slot]').forEach((el) =>
      el.addEventListener('click', () => {
        const was = this.garageSlot;
        this.garageSlot = el.dataset.slot as GarageSlot;
        if (this.garageSlot === 'atelier') {
          this.render();
          this.atelier.emit();
          return;
        }
        if (was === 'atelier') this.atelier.leave();
        if (this.garageSlot === 'face') {
          this.view = 'face';
          this.yaw = 0;
        } else if (this.garageSlot !== 'colors') {
          this.view = SLOT_VIEW[this.garageSlot];
          this.yaw = 0;
        }
        this.render();
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike');
        if ((was === 'face') !== (this.garageSlot === 'face')) this.onLookLive?.(s.look, this.bareHeadPreview);
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-bikefilter]').forEach((el) =>
      el.addEventListener('click', () => {
        this.bikeFilter = el.dataset.bikefilter as BikeFilter;
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-biketype]').forEach((el) =>
      el.addEventListener('click', () => {
        this.bikeType = el.dataset.biketype as BikeType | 'all';
        this.render();
      }),
    );
    this.root.querySelector<HTMLElement>('[data-unpreview]')?.addEventListener('click', () => {
      this.previews.delete('bike');
      this.sendPreview();
      this.render();
    });
    this.root.querySelector<HTMLElement>('[data-plainbike]')?.addEventListener('click', () => {
      this.previews.delete('bike');
      equipPlainBike(s);
      changed();
      this.sendPreview();
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) =>
      el.addEventListener('click', () => {
        const item = COSMETICS.find((c) => c.id === el.dataset.item);
        if (!item) return;
        const locked = item.level > levelProgress(loadProgress().xp).level;
        if (locked) {
          // Verrouillé : simple aperçu sur le coureur, rien n'est équipé ni enregistré.
          if (this.previews.get(item.slot) === item.id) this.previews.delete(item.slot);
          else this.previews.set(item.slot, item.id);
          this.sendPreview();
          this.render();
          return;
        }
        this.previews.delete(item.slot);
        equipItem(item, s);
        changed();
        this.sendPreview();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = el.dataset.view as GarageView;
        this.yaw = 0;
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === el));
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike');
      }),
    );
    const zone = this.root.querySelector<HTMLElement>('#m-dragzone');
    if (zone) {
      let lastX: number | null = null;
      let downAt: [number, number] | null = null;
      zone.addEventListener('pointerdown', (e) => {
        lastX = e.clientX;
        downAt = [e.clientX, e.clientY];
        zone.setPointerCapture(e.pointerId);
      });
      zone.addEventListener('pointermove', (e) => {
        if (lastX === null) return;
        if (this.garageSlot === 'atelier') {
          this.atelier.yaw -= (e.clientX - lastX) * 0.008;
          lastX = e.clientX;
          this.atelier.emit();
          return;
        }
        this.yaw -= (e.clientX - lastX) * 0.008;
        lastX = e.clientX;
        this.onScene?.(this.view, this.yaw, this.garageSlot === 'bike');
      });
      const up = (e: PointerEvent) => {
        lastX = null;
        // Simple clic (sans glisser) sur une pièce du vélo : la catégorie correspondante s'ouvre.
        if (e.type === 'pointerup' && downAt && this.garageSlot === 'atelier' && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) {
          const slot = this.onAtelierPick?.(e.clientX, e.clientY);
          if (slot) this.atelier.focusSlot(slot);
        }
        downAt = null;
      };
      zone.addEventListener('pointerup', up);
      zone.addEventListener('pointercancel', up);
    }
    const color = (id: string, key: 'jersey' | 'jerseyAccent' | 'helmet' | 'bike' | 'skin' | 'hair' | 'shoes' | 'shoeAccent' | 'socks') =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s.look = { ...s.look, [key]: el.value };
        changed();
      });
    color('m-jersey', 'jersey');
    color('m-accent', 'jerseyAccent');
    color('m-helmet', 'helmet');
    color('m-skin', 'skin');
    // Couleur du vélo : celle du vélo sans marque, qui devient le vélo équipé.
    on<HTMLInputElement>('m-bike', 'input', (el) => {
      equipPlainBike(s, el.value);
      changed();
    });
    color('m-hair', 'hair');
    color('m-shoes', 'shoes');
    color('m-shoe-accent', 'shoeAccent');
    on<HTMLSelectElement>('m-shoe-mark', 'change', (el) => {
      const mark = SHOE_MARKS.find((m) => m.id === el.value)?.id;
      const { shoeMark: _old, ...rest } = s.look;
      s.look = mark ? { ...rest, shoeMark: mark } : rest;
      changed();
    });
    color('m-socks', 'socks');
    on<HTMLElement>('m-bottles', 'change', (el) => {
      const n = Number((el as unknown as { value: string }).value);
      s.look = { ...s.look, bottles: n === 0 || n === 1 || n === 2 ? n : 2 };
      changed();
    });
    on<HTMLElement>('m-legs', 'change', (el) => {
      s.look = { ...s.look, legs: (el as unknown as { value: string }).value === 'long' ? 'long' : 'short' };
      changed();
    });
    on<HTMLElement>('m-sock-height', 'change', (el) => {
      s.look = { ...s.look, sockHeight: (el as unknown as { value: string }).value === 'high' ? 'high' : 'low' };
      changed();
    });
    on<HTMLElement>('m-gloves', 'change', (el) => {
      const v = (el as unknown as { value: string }).value;
      s.look = { ...s.look, gloves: v === 'mitts' || v === 'full' ? v : 'none' };
      changed();
    });
    on<HTMLInputElement>('m-glove-color', 'input', (el) => {
      s.look = { ...s.look, gloveColor: el.value };
      changed();
    });
    on<HTMLElement>('m-sleeves', 'change', (el) => {
      s.look = { ...s.look, sleeves: (el as unknown as { value: string }).value === 'long' ? 'long' : 'short' };
      changed();
    });
    this.root.querySelectorAll<HTMLElement>('[data-outfit]').forEach((el) =>
      el.addEventListener('click', () => {
        const o = OUTFITS.find((x) => x.id === el.dataset.outfit);
        if (!o) return;
        // Tenue complète : couleurs seulement, la peau, les cheveux et la carrure restent.
        s.look = { ...s.look, ...o.look };
        changed();
        this.render();
      }),
    );
    // Profil.
    const num = (id: string, key: 'massKg' | 'ftpWatts' | 'heightCm' | 'aiRiders') =>
      on<HTMLInputElement>(id, 'change', (el) => {
        s[key] = Number(el.value);
        changed();
        if (this.tab === 'profile') this.render();
      });
    num('m-mass', 'massKg');
    num('m-ftp', 'ftpWatts');
    num('m-height', 'heightCm');
    num('m-ai', 'aiRiders');
    this.root.querySelectorAll<HTMLElement>('[data-sex]').forEach((el) =>
      el.addEventListener('click', () => {
        s.look = withSex(s.look, el.dataset.sex as 'male' | 'female');
        changed();
        this.render();
      }),
    );
    on<HTMLInputElement>('m-name', 'change', (el) => {
      s.name = el.value.trim().slice(0, 24) || 'Robert';
      changed();
      this.render();
    });
    // Nationalité : drapeau montré aux autres coureurs (À proximité, classement des courses).
    const dd = this.root.querySelector<HTMLElement>('#m-nation');
    if (dd) {
      const list = dd.querySelector<HTMLElement>('.mm-dd-list') as HTMLElement;
      const close = () => {
        list.hidden = true;
        list.style.cssText = '';
        dd.appendChild(list);
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('scroll', close, true);
      };
      const outside = (e: Event) => {
        if (!dd.contains(e.target as Node) && !list.contains(e.target as Node)) close();
      };
      dd.querySelector('.mm-dd-btn')?.addEventListener('click', () => {
        if (!list.hidden) return close();
        // Posée sur l'écran (et non dans le panneau, qui la rognerait) juste sous le champ.
        const r = (dd.querySelector('.mm-dd-btn') as HTMLElement).getBoundingClientRect();
        // Sorti du panneau (son flou crée un repère qui rognerait la liste) : posé sur la page.
        document.body.appendChild(list);
        list.style.cssText = `position:fixed;z-index:90;left:${r.left}px;top:${r.bottom + 6}px;width:${r.width}px;max-height:${Math.max(160, Math.min(340, innerHeight - r.bottom - 16))}px`;
        list.hidden = false;
        list.querySelector('.on')?.scrollIntoView({ block: 'center' });
        document.addEventListener('pointerdown', outside, true);
        // Le défilement de la page ferme la liste, mais pas celui qu'on provoque pour montrer le pays choisi.
        setTimeout(() => !list.hidden && document.addEventListener('scroll', close, true), 200);
      });
      dd.querySelectorAll<HTMLElement>('[data-nation]').forEach((o) =>
        o.addEventListener('click', () => {
          const { nationality: _old, ...rest } = s.look;
          const code = o.dataset.nation ?? '';
          s.look = code ? { ...rest, nationality: code } : rest;
          close();
          changed();
          this.render();
        }),
      );
      dd.addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), close()));
    }
    // Réglages.
    on<HTMLSelectElement>('m-quality', 'change', (el) => {
      s.quality = el.value as Settings['quality'];
      localStorage.setItem('ar.quality', s.quality);
      changed();
    });
    // Style graphique : matériaux construits au chargement, la page se recharge.
    on<HTMLSelectElement>('m-style', 'change', (el) => setGraphicStyle(el.value as GraphicStyle));
    // Format et résolution : pris en compte tout de suite (le moteur écoute « resize »), sans recharger.
    on<HTMLSelectElement>('m-aspect', 'change', (el) => {
      setAspectCap(el.value as AspectCap);
      window.dispatchEvent(new Event('resize'));
    });
    on<HTMLSelectElement>('m-uiaspect', 'change', (el) => {
      setUiAspectCap(el.value as AspectCap);
      window.dispatchEvent(new Event('resize'));
    });
    on<HTMLSelectElement>('m-maxres', 'change', (el) => {
      setResolutionCap(el.value as ResolutionCap);
      window.dispatchEvent(new Event('resize'));
    });
    on<HTMLSelectElement>('m-season', 'change', (el) => {
      s.season = el.value as Settings['season'];
      changed();
    });
    const range = (id: string, key: 'hour' | 'clouds' | 'rain' | 'fog' | 'trainerDifficulty' | 'inertia', label?: string, fmt?: (v: number) => string) =>
      on<HTMLInputElement>(id, 'input', (el) => {
        s[key] = Number(el.value);
        const l = label ? this.root.querySelector(`#${label}`) : null;
        if (l && fmt) l.textContent = fmt(s[key]);
        changed();
      });
    range('m-hour', 'hour', 'm-hourv', (v) => this.hourLabel(v));
    range('m-clouds', 'clouds');
    range('m-rain', 'rain');
    range('m-fog', 'fog');
    range('m-diff', 'trainerDifficulty', 'm-diffv', (v) => `${Math.round(v * 100)} %`);
    range('m-inertia', 'inertia', 'm-inertiav', (v) => `${Math.round(v * 100)} %`);
    on<HTMLSelectElement>('m-lang', 'change', (el) => {
      s.lang = el.value as Settings['lang'];
      setLang(s.lang);
      changed();
      this.render();
    });
    on<HTMLSelectElement>('m-drive', 'change', (el) => {
      s.drivetrain = el.value as Settings['drivetrain'];
      changed();
    });
    on<HTMLSelectElement>('m-strava', 'change', (el) => {
      s.skipStrava = el.value === 'skip';
      changed();
    });
    on<HTMLSelectElement>('m-target', 'change', (el) => {
      s.groupTargetKmh = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-ailevel', 'change', (el) => {
      s.aiLevel = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-equal', 'change', (el) => {
      s.equalEquipment = el.value === '1';
      changed();
    });
    if (this.tab === 'garage' && this.garageSlot === 'atelier') this.atelier.bind(this.root);
    on<HTMLSelectElement>('m-wx', 'change', (el) => {
      const w = WEATHER_PRESETS.find(([id]) => id === el.value)?.[1];
      if (!w) return;
      Object.assign(s, w);
      changed();
    });
    on<HTMLSelectElement>('m-wind', 'change', (el) => {
      s.windMs = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-evolve', 'change', (el) => {
      s.weatherEvolves = el.value === '1';
      changed();
    });
    on<HTMLSelectElement>('m-realwx', 'change', (el) => {
      s.realWeather = el.value === '1';
      changed();
      this.render();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-hudblock]').forEach((el) =>
      el.addEventListener('change', () => {
        const id = el.dataset.hudblock as string;
        s.hudHidden = el.checked ? s.hudHidden.filter((x) => x !== id) : [...new Set([...s.hudHidden, id])];
        changed();
      }),
    );
    on<HTMLSelectElement>('m-smooth', 'change', (el) => {
      s.smoothing3s = el.value === '1';
      changed();
    });
    on<HTMLInputElement>('m-stand', 'input', (el) => {
      s.standWatts = Number(el.value);
      const v = document.getElementById('m-standv');
      if (v) v.textContent = s.standWatts ? `${s.standWatts} W` : 'Auto';
      changed();
    });
  }
}
