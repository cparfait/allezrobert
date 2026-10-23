import type { AvatarLook, CosmeticItem, RouteData, RouteSegment, WorldCatalogue } from '@allezrobert/shared';
import { readKomRecord } from '../game/challenge.ts';
import { BIKE_GROUPS, BIKE_TEAMS, COSMETICS, DEFAULT_BIKE, bikeById, bikeSetupFor, levelProgress, SHOE_MARKS, type BikeCollection, type BikeType, type CosmeticSlot } from '@allezrobert/shared';
import { shoeAccentOf } from '../rider/shoeLook.ts';
import { WORKOUT_LIBRARY } from '@allezrobert/physics';
import { formatBytes, installPack, loadCatalogue, packState, removePack } from '../world/packs.ts';
import { t, setLang, getLang, type I18nKey } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { saveSettings } from './settings.ts';
import { music } from '../audio/music.ts';
import { spotify, redirectUri } from '../audio/spotify.ts';
import { renderSoundSettings } from './soundSettings.ts';
import { renderCompanionSettings } from './companionQr.ts';
import { loadProgress, equipItem, equipPlainBike, SLOT_LABEL } from './garage.ts';
import { AtelierPanel, COIN } from './atelierPanel.ts';
import type { AtelierState } from './atelier.ts';
import { WORLD_LIST } from '../world/worlds.ts';
import { OUTFITS } from './outfits.ts';
import type { GarageView } from './poster.ts';
import { FriendsPanel } from './friends.ts';
import { faceEditorHtml, withBaseHead, withLikeness, withProfile, withRandomFace, withSlider, type FaceTab } from './faceEditor.ts';
import type { FaceSlider } from '@allezrobert/shared';
import { joinSettings } from './friendsLogic.ts';
import { RoutePlanner } from './routePlanner.ts';
import { companionQr } from './companionQr.ts';
import { FranceMap, type MapZone } from './franceMap.ts';
import { loadRouteBoards, routeDetailHtml } from './routeDetail.ts';
import { canReverse, reversedOf, routeKey } from '../game/direction.ts';
import { ZONE_SPOTS } from '../world/zoneMap.ts';
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
  useSimulator(on: boolean): void;
  simulatorOn(): boolean;
  warnings(): string[];
  /** Adaptateurs Bluetooth (app Windows) : intégré ou dongle. */
  adapters?(): Promise<Array<{ id: string; name: string; isDefault: boolean }>>;
  selectAdapter?(id: string): Promise<void>;
  onChange(cb: () => void): void;
  /** Réglages avancés du matériel (calibration, ventilateur, adaptateurs, journal) : ui/hardware-panel.ts. */
  renderExtras?(el: HTMLElement): void;
}

export interface MenuCallbacks {
  /** `inviteFriends` : amis (identifiants de relation) à inviter une fois la sortie créée. */
  onStart(settings: Settings, extras: { workoutFile?: { name: string; content: string }; inviteCode?: string; inviteFriends?: string[]; customRoute?: RouteData; openStart?: { x: number; z: number } }): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

type Tab = 'home' | 'ride' | 'friends' | 'garage' | 'devices' | 'profile' | 'settings';
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
  fr: { free: 'Seul ou avec des IA', group: 'Avec tes amis', race: 'Classement', workout: 'Séances ERG', ftpTest: 'Test rampe', challenge: 'Records en côte' },
  en: { free: 'Solo or with AI', group: 'With friends', race: 'Results', workout: 'ERG sessions', ftpTest: 'Ramp test', challenge: 'Climb records' },
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
  explore: svg('<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3z"/>', 20),
};

/** Gros plan du garage selon la catégorie choisie. */
const SLOT_VIEW: Record<CosmeticSlot, GarageView> = { jersey: '3q', helmet: 'front', bike: 'side', socks: 'bike', glasses: 'front' };

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

/**
 * Silhouette de vélo aux couleurs de la livrée (cadre : 1re couleur, haubans et fourche : 2e,
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

/** Vignette d'un équipement : couleur unie, ou bandes de la livrée pour un vélo. */
function swatch(c: CosmeticItem): string {
  const cols = c.colors ?? [];
  if (cols.length < 2) return c.color ?? '#7a8594';
  const n = cols.length;
  return `linear-gradient(135deg, ${cols.map((x, i) => `${x} ${((i * 100) / n).toFixed(0)}% ${(((i + 1) * 100) / n).toFixed(0)}%`).join(', ')})`;
}

/**
 * Menu principal façon jeu : barre d'onglets en haut (Rouler, Garage, Capteurs, Profil,
 * Réglages), lecteur de musique et compte à droite ; panneaux posés sur la scène 3D fixe.
 * Onglet Rouler : modes en tuiles, carte et profil de l'itinéraire, départ. Garage : aperçu 3D
 * du coureur (vues prédéfinies, rotation à la souris) piloté par onScene.
 */
export class MainMenu {
  private readonly root: HTMLElement;
  private readonly s: Settings;
  private routes: RouteData[];
  private readonly devices: DevicePanel;
  private readonly cb: MenuCallbacks;
  private workoutFile: { name: string; content: string } | undefined;
  private tab: Tab = 'ride';
  private garageSlot: CosmeticSlot | 'colors' | 'face' | 'atelier' = 'jersey';
  /** Atelier (pièces du vélo, ensembles, crédits) : panneau et état de la scène 3D. */
  private readonly atelier: AtelierPanel;
  /** Atelier 3D (pièce procédurale, vélo sur pied) : état demandé, null pour le fermer. */
  onAtelier?: (st: AtelierState | null) => void;
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
  /** « Explorer la carte » : survol libre du monde chargé, sans rouler (Échap pour revenir). */
  onExplore?: () => void;
  /** Aperçu immédiat d'une tenue (éditeur de visage) sur le coureur du garage, sans reconstruire la scène. */
  onLookLive?: (look: AvatarLook, bareHead: boolean) => void;
  /** Éditeur de visage ouvert avec tête nue : l'aperçu garde casque et lunettes masqués. */
  get bareHeadPreview(): boolean {
    return this.tab === 'garage' && this.garageSlot === 'face' && this.bareHead;
  }
  /** Cadrage 3D demandé par le menu : photo du groupe ou vue du garage (rotation en radians). */
  onScene?: (view: 'poster' | GarageView, yaw: number) => void;
  /** Aperçu d'un équipement (même verrouillé) sur le coureur du garage ; null : tenue équipée. */
  onPreviewLook?: (look: AvatarLook | null) => void;
  private previewId: string | null = null;
  /** Compte connecté (affiché dans le menu), connexion / déconnexion, synchro du profil. */
  account: { name: string; level: number; credits?: number } | null = null;
  onLogin?: () => void;
  onLogout?: () => void;
  /** Monde affiché et changement de monde (rechargement de la page). */
  worldId = 'chevreuse';

  /** Nouveau monde chargé sur place : parcours, identifiant, monde ouvert ; l'écran est refait. */
  setWorld(routes: RouteData[], worldId: string, open: boolean): void {
    this.routes = routes;
    this.worldId = worldId;
    this.openWorld = open;
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
  private picker: 'zones' | 'zone' | 'routes' | 'map' | 'route' | null = null;
  /** Parcours ouvert dans sa fiche (fenêtre « route »). */
  private detailId = '';
  /** Sens montré dans la fiche du parcours (choisi au départ). */
  private detailReverse = false;
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
  private lastProgressRender = 0;
  /** Onglet Amis : présence, demandes, invitations (interrogation tant que le menu est affiché). */
  private readonly friends: FriendsPanel;

  constructor(root: HTMLElement, settings: Settings, routes: RouteData[], devices: DevicePanel, cb: MenuCallbacks) {
    this.root = root;
    this.s = settings;
    this.routes = routes;
    this.devices = devices;
    this.cb = cb;
    if (!this.s.routeId || !routes.some((r) => r.id === this.s.routeId)) this.s.routeId = routes[0]?.id ?? '';
    void loadCatalogue().then((cat) => {
      this.zones = cat?.zones ?? [];
      if (this.tab === 'ride' && this.root.querySelector('.mm')) this.render();
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
  }

  show(tab: Tab = 'home'): void {
    document.addEventListener('keydown', this.onKey);
    this.friends.start();
    // Lien /?ami=CODE : l'onglet Amis propose la demande.
    this.go((tab === 'home' || tab === 'ride') && this.friends.hasPendingCode() ? 'friends' : tab);
  }

  hide(): void {
    if (this.garageSlot === 'atelier') this.atelier.leave();
    document.removeEventListener('keydown', this.onKey);
    this.friends.stop();
    this.root.innerHTML = '';
  }

  private go(tab: Tab): void {
    this.picker = null;
    if (tab !== 'garage' && this.previewId) {
      this.previewId = null;
      this.onPreviewLook?.(null);
    }
    this.tab = tab;
    this.render();
    // Garage resté sur l'atelier : sa pièce 3D ; sinon la photo ou le coureur du garage.
    if (tab === 'garage' && this.garageSlot === 'atelier') return this.atelier.emit();
    if (this.garageSlot === 'atelier') this.atelier.leave();
    this.onScene?.(tab === 'garage' ? this.view : 'poster', tab === 'garage' ? this.yaw : 0);
  }

  /** Croix de fermeture d'un panneau (retour à l'onglet Rouler, comme Échap). */
  private closeBtn(): string {
    return `<button class="mm-close" data-tab="ride" aria-label="${fr() ? 'Fermer' : 'Close'}" title="${fr() ? 'Fermer (Échap)' : 'Close (Esc)'}">×</button>`;
  }

  /** Choix en boutons segmentés (remplace les listes déroulantes du système). */
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
  private lookWith(item: CosmeticItem): AvatarLook {
    const look = { ...this.s.look };
    if (item.color) {
      if (item.slot === 'jersey') look.jersey = item.color;
      if (item.slot === 'helmet') look.helmet = item.color;
      if (item.slot === 'bike') look.bike = item.color;
      if (item.slot === 'socks') look.socks = item.color;
    }
    if (item.slot === 'bike') {
      // Modèle du catalogue (cadre, livrée) ou VTT / gravel : le type de pneus suit l'équipement.
      look.bikeType = item.physics?.tyre ?? 'road';
      if (bikeById(item.id)) look.bikeModel = item.id;
      else delete look.bikeModel;
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
          ['free', 'free', 'Rouler à son rythme, avec ou sans coureurs IA.'],
          ['group', 'group', 'Rouler à plusieurs : le groupe reste ensemble.'],
          ['race', 'race', 'Course en ligne, classement à l’arrivée.'],
          ['workout', 'workout', 'Séance structurée en mode ERG : séances intégrées ou fichier .zwo, .erg, .mrc.'],
          ['ftpTest', 'ftpTest', 'Test rampe : paliers d’une minute jusqu’à épuisement, pour estimer ta FTP.'],
          ['challenge', 'challenge', 'Bats ton record sur une montée : départ lancé, fantôme de ton meilleur temps, écart en direct.'],
        ]
      : [
          ['free', 'free', 'Ride at your own pace, with or without AI riders.'],
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
      ['friends', L ? 'Amis' : 'Friends'],
      ['garage', 'Garage'],
      ['devices', t('devices')],
      ['profile', t('profile')],
      ['settings', t('settings')],
    ];
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const level = this.account?.level ?? lp.level;
    const name = this.account?.name ?? this.s.name;
    const initials = name
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase();
    // Accueil : rien que la vidéo, le titre et le bouton Rouler, qui ouvre le menu.
    if (this.tab === 'home') {
      this.root.innerHTML = `<div class="mm mm-tab-home">
        <div class="mm-hero mm-hero-home"><h1>Allez <em>Robert</em> !</h1><p>${L ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>
        <button class="mm-go mm-home-go" data-tab="ride">${t('ride')} <span>→</span></button>
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
      profile: () => this.profileHtml(),
      settings: () => this.settingsHtml(),
    };
    // Liste longue (vélos) : même panneau, même position de défilement après un nouveau rendu.
    const key = `${this.tab}/${this.garageSlot}/${this.bikeFilter}/${this.bikeType}`;
    const scroll = key === this.panelKey ? (this.root.querySelector('.mm-side')?.scrollTop ?? 0) : 0;
    this.panelKey = key;
    this.root.innerHTML = `<div class="mm mm-tab-${this.tab}">
      <header class="mm-top">
        <button class="mm-brand" data-tab="home" title="${L ? 'Accueil' : 'Home'}">Allez <em>Robert</em> !</button>
        <nav class="mm-tabs">${tabs.map(([id, label]) => `<button class="mm-tab ${id === this.tab ? 'on' : ''}" data-tab="${id}">${esc(label)}${id === 'friends' ? this.friends.badgeHtml() : ''}</button>`).join('')}
          <button class="mm-tab subtle" id="m-tuto">${L ? 'Tutoriel' : 'Tutorial'}</button></nav>
        <div class="mm-right">
          <div class="mm-music" id="m-music"></div>
          <div class="mm-account">
            <div class="mm-avatar" style="background:${this.s.look.jersey}">${esc(initials || 'R')}</div>
            <div class="mm-who"><b>${esc(name)}</b>
              <span>${L ? 'Niveau' : 'Level'} ${level}<i class="mm-xp"><i style="width:${(lp.progress * 100).toFixed(0)}%"></i></i><em class="mm-credits" title="${L ? 'Crédits (atelier)' : 'Credits (workshop)'}">${COIN} ${(this.account?.credits ?? p.credits).toLocaleString(L ? 'fr-FR' : 'en-GB')}</em></span></div>
            ${this.account ? `<button class="mm-link" id="m-logout">${L ? 'Déconnexion' : 'Sign out'}</button>` : `<button class="mm-link" id="m-login">${L ? 'Se connecter' : 'Sign in'}</button>`}
          </div>
        </div>
      </header>
      ${body[this.tab]()}
      <div id="m-friendbar"></div>
      <footer class="mm-foot">
        <div class="mm-status" id="m-status"></div>
        ${this.tab === 'ride' ? `<button id="m-start" class="mm-go">${t('ride')} <span>→</span></button>` : `<button class="mm-go ghost" data-tab="ride">← ${t('ride')}</button>`}
      </footer>
    </div>`;
    if (this.tab === 'devices') this.renderDevices();
    const side = this.root.querySelector('.mm-side');
    if (side) side.scrollTop = scroll;
    this.renderStatus();
    this.renderMusic();
    renderSoundSettings(this.root.querySelector('#m-sound-settings'));
    renderCompanionSettings(this.root.querySelector('#m-companion-settings'));
    this.bind();
    this.friends.mount(this.root, this.tab === 'friends');
  }

  /** Pied de page : état des capteurs (cliquable vers l'onglet Capteurs) et raccourcis. */
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
    box.innerHTML = `<button class="mm-chips" title="${t('devices')}">${chips}</button><span class="mm-keys">${t('shortcuts')}</span>`;
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
      <div class="mm-modes">${this.modes()
        .map(
          ([v, k]) =>
            `<button class="mm-mode ${v === shown ? 'on' : ''}" data-mode="${v}" style="--c:${MODE_COLORS[v] ?? '#ffd23f'}"><span class="mm-mode-ico">${ICON[v]}</span><b>${esc(t(k))}</b><small>${esc(tag[v] ?? '')}</small></button>`,
        )
        .join('')}</div>
      <p class="mm-hint">${s.mode === 'open' ? (L ? 'Parcours libre : ← / → pour choisir ta direction à chaque carrefour, U pour faire demi-tour.' : 'Free ride: ← / → to pick your way at each junction, U to turn around.') : mode ? esc(mode[2]) : ''}</p>
      ${
        s.mode === 'group' || s.mode === 'race'
          ? `<input id="m-invite" class="mm-input" placeholder="${L ? 'Code d’invitation (facultatif)' : 'Invite code (optional)'}" />${
              // Course sur une boucle : nombre de tours (créateur de la course).
              s.mode === 'race' && r?.loop ? `<label class="mm-input" style="display:flex;align-items:center;justify-content:space-between;gap:10px">${L ? 'Tours de la course' : 'Race laps'}<input id="m-laps" type="number" min="1" max="20" value="${s.raceLaps}" style="width:64px" /></label>` : ''
            }
            <div class="mm-groupopts">
              <label class="field">${L ? 'Heure de départ' : 'Start time'} <span id="m-hourv">${this.hourLabel(s.hour)}</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
              <div class="field">${L ? 'Météo' : 'Weather'}${this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [
                ['0', L ? 'Fixe' : 'Fixed'],
                ['1', L ? 'Qui évolue' : 'Changing'],
              ])}</div>
              <div class="field">${L ? 'Équipement égalisé' : 'Equal equipment'}${this.seg('m-equal', (s.equalEquipment ?? s.mode === 'race') ? '1' : '0', [
                ['1', L ? 'Oui : même vélo pour tous' : 'Yes: same bike for all'],
                ['0', L ? 'Non : pièces de l’atelier' : 'No: workshop parts'],
              ])}</div>
              <p class="mm-hint">${L ? 'Si tu crées la sortie, ton heure, ta météo et l’égalisation s’appliquent à tout le groupe.' : 'If you create the ride, your time, weather and equipment rule apply to the whole group.'}</p>
            </div>`
          : s.mode === 'challenge'
            ? this.challengeHtml(r)
          : s.mode === 'workout'
            ? `<div class="mm-routes mm-presets">${WORKOUT_LIBRARY.map(
                (w) =>
                  `<button class="mm-route ${!this.workoutFile && w.id === s.workoutPreset ? 'on' : ''}" data-preset="${w.id}"><b>${esc(w.name[getLang()])}</b><span>${esc(w.description[getLang()])}</span></button>`,
              ).join('')}</div>
              <label class="mm-file">${L ? 'Ou importer une séance' : 'Or import a workout'} (.zwo / .erg / .mrc)<input id="m-workout" type="file" accept=".zwo,.erg,.mrc" hidden /><span id="m-wname">${this.workoutFile ? esc(this.workoutFile.name) : ''}</span></label>`
            : ''
      }
      ${
        s.mode === 'ftpTest'
          ? this.ftpTestHtml()
          : `<h3 class="mm-where">${L ? 'Où rouler ?' : 'Where to ride?'}</h3>${this.pickersHtml(r)}`
      }
    </section>
    <div class="mm-hero"><h1>Allez <em>Robert</em> !</h1><p>${L ? 'Rouler ensemble, chacun chez soi.' : 'Ride together, each from home.'}</p></div>
    ${this.pickerHtml()}`;
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
    const map = this.openWorld ? this.planner.preview(route, free ? this.freeStart : null) : '';
    const body = map ? `<div class="mm-selmap">${map}</div>` : route ? this.routeCard(route) : '';
    const pickers = `<div class="mm-pickers mm-pickers-one">
      <button class="mm-pick mm-pick-big" data-picker="zones"><b>${L ? 'CHOISIR MA SORTIE' : 'CHOOSE MY RIDE'}</b><i aria-hidden="true">›</i></button>
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
    if (this.picker === 'route') return this.routeDetailWindow();
    if (this.picker === 'zone') return this.zoneHtml();
    // Parcours fixés de la zone (cartes), avec retour aux choix de la zone ou à la carte de France.
    const w = WORLD_LIST.find((x) => x.id === this.worldId);
    const list = `<div class="mm-cardgrid">${this.routes
      .map(
        (x) => `<button class="mm-routepick ${x.id === this.s.routeId ? 'on' : ''}" data-route="${esc(x.id)}">
            ${this.routeCard(x)}
            <span class="mm-routetag">${x.loop ? (L ? 'Boucle' : 'Loop') : L ? 'Aller simple' : 'One way'}${x.id === this.s.routeId ? ` · ${this.s.reverse ? (L ? 'choisi, sens inverse' : 'selected, reversed') : L ? 'choisi' : 'selected'}` : ''}</span></button>`,
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
    const chosen = base.id === this.s.routeId && this.s.reverse === this.detailReverse;
    const dir = canReverse(base)
      ? this.seg('rd-dir', this.detailReverse ? '1' : '0', [
          ['0', L ? 'Sens normal' : 'Normal'],
          ['1', L ? 'Sens inverse' : 'Reversed'],
        ])
      : '';
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker rd-dialog" role="dialog" aria-modal="true">
        <header><h2>${esc(this.routeName(base))}</h2><span class="rd-head-tag">${r.loop ? (L ? 'Boucle' : 'Loop') : L ? 'Aller simple' : 'One way'}</span>${dir}<span class="rp-head-links"><button class="mm-link" data-picker="routes">← ${L ? 'Parcours' : 'Routes'}</button>${chosen ? '' : `<button class="mm-link" data-rd="pick">${L ? 'Choisir sans partir' : 'Select without riding'}</button>`}</span><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        ${routeDetailHtml(r, this.routeName(r), { loggedIn: !!this.account })}
      </div></div>`;
  }

  /** Parcours de la fiche dans le sens choisi (records et montées de ce sens). */
  private detailRoute(base: RouteData): RouteData {
    return this.detailReverse && canReverse(base) ? reversedOf(base) : base;
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

  /** Mode défi : montées de l'itinéraire choisi, avec le record de chacune. */
  private challengeHtml(r: RouteData | undefined): string {
    const L = fr();
    const koms = r?.segments.filter((g) => g.kind === 'kom') ?? [];
    if (!r || !koms.length) return `<p class="mm-hint">${L ? 'Pas de montée chronométrée sur cet itinéraire : choisis-en un autre.' : 'No timed climb on this route: pick another one.'}</p>`;
    if (!koms.some((k) => k.id === this.s.challengeSeg)) this.s.challengeSeg = (koms[0] as RouteSegment).id;
    return `<div class="mm-routes mm-presets">${koms
      .map((k) => {
        const rec = readKomRecord(r.id, k.id);
        const t = rec ? `${Math.floor(rec.timeS / 60)}:${String(Math.round(rec.timeS % 60)).padStart(2, '0')}` : L ? 'pas encore de record' : 'no record yet';
        return `<button class="mm-route ${k.id === this.s.challengeSeg ? 'on' : ''}" data-kom="${esc(k.id)}"><b>${esc(k.name)}</b><span>${this.km(k.endM - k.startM)} km · ${k.avgGrade.toFixed(1).replace('.', L ? ',' : '.')} % · ${L ? 'record' : 'best'} ${t}</span></button>`;
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
      const n = z?.routes.length ?? 0;
      const info = [n ? `${n} ${L ? 'parcours' : n > 1 ? 'routes' : 'route'}` : '', spot.open ? (L ? 'monde ouvert' : 'open world') : '', w ? w.hint[lang] : ''].filter(Boolean).join(' · ');
      return { id: spot.id, name: w ? w.name[lang] : spot.name[lang], region: spot.region[lang], x: spot.x, y: spot.y, available, current: spot.id === this.worldId, info };
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
    if (dl && !dl.error) return `<span class="mm-pack busy">${Math.floor((dl.done / Math.max(dl.total, 1)) * 100)} %</span>`;
    if (dl?.error) return `<button class="mm-pack err" data-pack="${esc(id)}" title="${esc(dl.error)}">${L ? 'Réessayer' : 'Retry'}</button>`;
    if (st.kind === 'installed' && st.upToDate) return `<span class="mm-pack ok">${L ? 'Téléchargée' : 'Downloaded'} ✓</span><button class="mm-link mm-unpack" data-unpack="${esc(id)}">${L ? 'Supprimer' : 'Remove'}</button>`;
    if (st.kind === 'installed') return `<button class="mm-pack" data-pack="${esc(id)}">${L ? 'Mettre à jour' : 'Update'}${z?.pack ? ` · ${formatBytes(z.pack.bytes, L)}` : ''}</button>`;
    if (st.kind === 'absent' && z?.pack) return `<button class="mm-pack" data-pack="${esc(id)}">↓ ${formatBytes(z.pack.bytes, L)}</button>`;
    return '';
  }

  /** Fenêtre « Zones » : carte de France, un point par zone. */
  private franceHtml(): string {
    const L = fr();
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker fm-dialog" role="dialog" aria-modal="true">
        <header><h2>${L ? 'Où veux-tu rouler ?' : 'Where do you want to ride?'}</h2><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        <p class="mm-hint">${this.loadingZone ? `${L ? 'Chargement de' : 'Loading'} ${esc(this.loadingZone)}…` : L ? 'Clique sur un point pour ouvrir la zone ; un point numéroté réunit plusieurs zones proches.' : 'Click a point to open the area; a numbered point groups several nearby areas.'}</p>
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
    const card = (id: string, icon: string, title: string, text: string) =>
      id !== 'routes' && !this.openWorld
        ? `<button class="zc-choice zc-off" disabled>${icon}<b>${title}</b><span>${openOnly}</span></button>`
        : `<button class="zc-choice" data-zc="${id}">${icon}<b>${title}</b><span>${text}</span></button>`;
    const pack = this.packAction(this.worldId);
    // Région, puis la description de la zone (sans répéter la région si elle y figure déjà).
    const hint = w?.hint[lang] ?? '';
    const region = spot?.region[lang] ?? '';
    const zoneSub = [hint.includes(region) ? '' : region, hint].filter(Boolean).join(' · ');
    return `<div class="mm-modal mm-picker-modal" data-picker-close>
      <div class="mm-dialog mm-picker" role="dialog" aria-modal="true">
        <header class="zc-head"><div><h2>${esc(w ? w.name[lang] : (spot?.name[lang] ?? this.worldId))}</h2><small>${esc(zoneSub)}</small></div><button class="mm-x" data-picker-close aria-label="${L ? 'Fermer' : 'Close'}">×</button></header>
        <div class="zc-choices">
          ${n ? card('routes', ICON.free, L ? 'Parcours' : 'Routes', L ? `${n} parcours déjà tracé${n > 1 ? 's' : ''} : boucles et itinéraires de la zone.` : `${n} ready-made route${n > 1 ? 's' : ''}: loops and rides of the area.`) : ''}
          ${card('free', ICON.open, L ? 'Parcours libre' : 'Free ride', L ? 'Pars du départ de la zone et choisis ta route à chaque carrefour (← / →, U pour faire demi-tour).' : 'Start from the area’s start and pick your road at each junction (← / →, U to turn around).')}
          ${card('draw', svg('<path d="M4 19c3-.5 3.5-6 7-6s3 5.5 6 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="17" cy="18" r="1.6"/><path d="m15.5 3.5 3 3L12 13H9v-3z"/>'), L ? 'Parcours à dessiner' : 'Draw a route', L ? 'Sur la carte : ton départ, tes points de passage, ton arrivée ou une boucle.' : 'On the map: your start, waypoints, finish or a loop.')}
        </div>
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
        if (now - this.lastProgressRender > 250 && this.tab === 'ride') {
          this.lastProgressRender = now;
          this.render();
        }
      });
      this.downloads.delete(id);
    } catch (err) {
      this.downloads.set(id, { done: 0, total: 1, error: String((err as Error).message ?? err) });
    }
    if (this.tab === 'ride') this.render();
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
    if (this.garageSlot === 'atelier') return this.atelier.html();
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
          </div>
          <h3 class="mm-presets-title">${L ? 'Tenues préréglées' : 'Kit presets'}</h3>
          <div class="mm-items mm-kits">${OUTFITS.map(
            (o) =>
              `<button class="mm-item" data-outfit="${o.id}"><i style="background:linear-gradient(90deg, ${o.look.jersey} 0 50%, ${o.look.jerseyAccent} 50% 100%)"></i><b>${esc(o.name[lang])}</b><span>${esc(o.hint[lang])}</span></button>`,
          ).join('')}
          </div>`
        : this.garageSlot === 'bike'
        ? this.bikeListHtml(lp.level, p.equipped.bike)
        : `<div class="mm-items">${this.garageItems(lp.level)
            .map((c) => {
              const locked = c.level > lp.level;
              const on = p.equipped[c.slot] === c.id;
              const prev = this.previewId === c.id;
              return `<button class="mm-item ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${locked ? (L ? 'Cliquer pour l’essayer' : 'Click to try it on') : ''}">
                <i style="background:${swatch(c)}"></i>
                <span class="mm-it-txt"><b>${esc(c.name[lang])}</b>${c.effect ? `<em class="mm-effect">${esc(c.effect[lang])}</em>` : ''}
                <span class="mm-it-state">${prev ? `👁 ${L ? 'Aperçu' : 'Preview'} · 🔒 ${L ? 'niv.' : 'lvl'} ${c.level}` : locked ? `🔒 ${L ? 'niveau' : 'level'} ${c.level}` : on ? (L ? '✓ Équipé' : '✓ Equipped') : L ? 'Disponible' : 'Available'}</span></span></button>`;
            })
            .join('')}</div>`;
    return `<div class="mm-dragzone" id="m-dragzone"></div>
      <div class="mm-views">${views.map(([v, label]) => `<button class="mm-view ${v === this.view ? 'on' : ''}" data-view="${v}">${label}</button>`).join('')}
        <span class="mm-drag">${ICON.rotate} ${L ? 'Glisser pour tourner' : 'Drag to rotate'}</span></div>
      <section class="mm-panel mm-side">${this.closeBtn()}
        <header class="mm-head"><h2>${L ? 'Ton coureur' : 'Your rider'}</h2>
          <div class="mm-level"><b>${L ? 'Niveau' : 'Level'} ${lp.level}</b><span>${p.xp} XP${lp.nextLevelXp ? ` / ${lp.nextLevelXp}` : ''}</span><i class="mm-xp big"><i style="width:${(lp.progress * 100).toFixed(1)}%"></i></i></div></header>
        <div class="mm-slots">${slots.map((sl) => `<button class="mm-slot ${sl === this.garageSlot ? 'on' : ''}" data-slot="${sl}">${SLOT_LABEL[sl][lang]}</button>`).join('')}
          <button class="mm-slot ${this.garageSlot === 'colors' ? 'on' : ''}" data-slot="colors">${L ? 'Couleurs' : 'Colours'}</button>
          <button class="mm-slot ${this.garageSlot === 'face' ? 'on' : ''}" data-slot="face">${L ? 'Visage' : 'Face'}</button>
          <button class="mm-slot at-open" data-slot="atelier">🔧 ${L ? 'Atelier' : 'Workshop'}</button></div>
        ${items}
        ${this.bikeSummary()}
        <p class="mm-hint">${L ? 'Les équipements se débloquent en roulant (XP par kilomètre et par mètre de dénivelé). Clique un équipement verrouillé pour l’essayer.' : 'Gear unlocks as you ride (XP per kilometre and metre climbed). Click locked gear to try it on.'}</p>
      </section>`;
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

  /** Vélos de la collection choisie (ou débloqués), par niveau puis par groupe. */
  private bikesInCollection(level: number): CosmeticItem[] {
    const group = (id: string) => BIKE_GROUPS.findIndex((g) => g.id === bikeById(id)?.group);
    return COSMETICS.filter((c) => c.slot === 'bike')
      .filter((c) => (this.bikeFilter === 'unlocked' ? c.level <= level : bikeById(c.id)?.collection === this.bikeFilter))
      .sort((a, b) => a.level - b.level || group(a.id) - group(b.id) || a.name.fr.localeCompare(b.name.fr));
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
      <div class="mm-bikefilter" role="radiogroup">${BIKE_FILTERS.map(
        ([id, fr_, en]) => `<button class="${id === this.bikeFilter ? 'on' : ''}" data-bikefilter="${id}" role="radio" aria-checked="${id === this.bikeFilter}">${L ? fr_ : en}</button>`,
      ).join('')}</div>
      ${types.length > 1 ? `<div class="mm-biketypes" role="radiogroup">${chip('all', L ? 'Tous' : 'All', all.length)}${types.map((ty) => chip(ty, BIKE_TYPE[ty][L ? 0 : 1], all.filter((c) => bikeById(c.id)?.type === ty).length)).join('')}</div>` : ''}
      <div class="mm-bikelist">
        ${open.length || plain ? `<h4 class="mm-bl-head">${L ? 'Disponibles' : 'Available'}<span>${open.length + (plain ? 1 : 0)}</span></h4>${plain ? this.plainBikeHtml() : ''}${open.map(row).join('')}` : ''}
        ${locked.length ? `<h4 class="mm-bl-head">${L ? 'À débloquer en roulant' : 'Unlock by riding'}<span>${locked.length}</span></h4>${locked.map(row).join('')}` : ''}
      </div>`;
  }

  /** Une ligne de la liste des vélos : silhouette aux couleurs de la livrée, nom, type et équipe, effet, état. */
  private bikeRowHtml(c: CosmeticItem, level: number, equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const bike = bikeById(c.id);
    const locked = c.level > level;
    const on = equippedId === c.id;
    const prev = this.previewId === c.id;
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const sub = bike ? `${BIKE_TYPE[bike.type][L ? 0 : 1]}${from ? ` · ${from}` : ''}` : '';
    const state = prev ? `👁 ${L ? 'Aperçu' : 'Preview'}` : locked ? `🔒 ${L ? 'niv.' : 'lvl'} ${c.level}` : on ? `✓ ${L ? 'Équipé' : 'Equipped'}` : '';
    return `<button class="mm-bike ${on ? 'on' : ''} ${locked ? 'locked' : ''} ${prev ? 'preview' : ''}" data-item="${c.id}" title="${esc([bike?.desc[lang] ?? '', locked ? (L ? 'Cliquer pour l’essayer' : 'Click to try it on') : ''].filter(Boolean).join(' — '))}">
      ${bikeIcon(c.colors?.length ? c.colors : [c.color ?? '#7a8594'])}
      <span class="mm-bike-txt"><b>${esc(c.name[lang])}</b><small>${esc(sub)}</small></span>
      <span class="mm-bike-side">${c.effect ? `<em>${esc(c.effect[lang])}</em>` : ''}${state ? `<span class="mm-bike-state">${state}</span>` : ''}</span>
    </button>`;
  }

  /** Vélo de départ sans marque, à la couleur choisie dans « Couleurs ». */
  private plainBikeHtml(): string {
    const L = fr();
    const on = !this.s.look.bikeModel;
    return `<button class="mm-bike ${on ? 'on' : ''}" data-plainbike title="${L ? 'Couleur au choix dans l’onglet Couleurs' : 'Pick its colour in the Colours tab'}">
      ${bikeIcon([this.s.look.bike])}
      <span class="mm-bike-txt"><b>${L ? 'Vélo sans marque' : 'Unbranded bike'}</b><small>${L ? 'Couleur au choix (onglet Couleurs)' : 'Your colour (Colours tab)'}</small></span>
      <span class="mm-bike-side">${on ? `<span class="mm-bike-state">✓ ${L ? 'Équipé' : 'Equipped'}</span>` : ''}</span></button>`;
  }

  /** Fiche du vélo regardé : aperçu d'un vélo verrouillé, sinon le vélo équipé. */
  private bikeFocusHtml(equippedId: string | undefined): string {
    const L = fr();
    const lang = getLang();
    const previewed = this.previewId ? COSMETICS.find((c) => c.id === this.previewId && c.slot === 'bike') : undefined;
    const c = previewed ?? (equippedId ? COSMETICS.find((x) => x.id === equippedId) : undefined);
    if (!c) {
      return `<div class="mm-bikefocus">${bikeIcon([this.s.look.bike], true)}<div class="mm-bf-txt"><small>${L ? 'Ton vélo' : 'Your bike'}</small><b>${L ? 'Vélo sans marque' : 'Unbranded bike'}</b>
        <p>${L ? 'Sa couleur se choisit dans l’onglet Couleurs. Les vélos des équipes se débloquent en roulant.' : 'Pick its colour in the Colours tab. Team bikes unlock as you ride.'}</p></div></div>`;
    }
    const bike = bikeById(c.id);
    const from = bike ? bikeFrom(bike.group, lang) : undefined;
    const tags = [bike ? BIKE_TYPE[bike.type][L ? 0 : 1] : '', from ?? '', bike?.year ? String(bike.year) : ''].filter(Boolean);
    return `<div class="mm-bikefocus ${previewed ? 'preview' : ''}">${bikeIcon(c.colors?.length ? c.colors : [c.color ?? '#7a8594'], true)}
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
    return `<section class="mm-panel mm-center">${this.closeBtn()}
      <header class="mm-head"><h2>${t('profile')}</h2><p>${L ? 'Le poids et la taille servent à la physique (montées, prise au vent) ; la FTP règle les séances et les zones.' : 'Weight and height drive the physics (climbs, drag); FTP sets workouts and zones.'}</p></header>
      <div class="mm-bigstats"><div><b>${wkg.toFixed(1).replace('.', L ? ',' : '.')}</b><span>W/kg</span></div><div><b>${Math.round(s.ftpWatts)}</b><span>W FTP</span></div><div><b>${s.massKg}</b><span>kg</span></div></div>
      <div class="grid2b">
        <label class="field">${t('name')}<input id="m-name" value="${esc(s.name)}" /></label>
        <label class="field">${t('weight')}<input id="m-mass" type="number" min="30" max="200" step="0.5" value="${s.massKg}" /></label>
        <label class="field">${t('height')}<input id="m-height" type="number" min="120" max="220" value="${s.heightCm}" /></label>
        <label class="field">${t('ftp')}<input id="m-ftp" type="number" min="50" max="600" value="${s.ftpWatts}" /></label>
      </div>
    </section>`;
  }

  private settingsHtml(): string {
    const s = this.s;
    const L = fr();
    return `<section class="mm-panel mm-center mm-wide">${this.closeBtn()}
      <header class="mm-head"><h2>${t('settings')}</h2></header>
      <h3>${L ? 'Graphismes et conditions de la sortie' : 'Graphics and ride conditions'}</h3>
      <div class="grid3">
        <div class="field">${t('quality')}${this.seg('m-quality', s.quality, (['low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t(q)]))}</div>
        <div class="field">${t('season')}${this.seg('m-season', s.season, (['spring', 'summer', 'autumn', 'winter'] as const).map((q) => [q, t(q)]))}</div>
        <label class="field">${t('hour')} <span id="m-hourv">${this.hourLabel(s.hour)}</span><input id="m-hour" type="range" min="5" max="22" step="0.25" value="${s.hour}" /></label>
        <label class="field">${L ? 'Nuages' : 'Clouds'}<input id="m-clouds" type="range" min="0" max="1" step="0.05" value="${s.clouds}" /></label>
        <label class="field">${L ? 'Pluie' : 'Rain'}<input id="m-rain" type="range" min="0" max="1" step="0.05" value="${s.rain}" /></label>
        <label class="field">${L ? 'Brouillard' : 'Fog'}<input id="m-fog" type="range" min="0" max="1" step="0.05" value="${s.fog}" /></label>
        <div class="field">${L ? 'Météo' : 'Weather'}${this.seg('m-evolve', s.weatherEvolves ? '1' : '0', [
          ['0', L ? 'Fixe' : 'Fixed'],
          ['1', L ? 'Qui évolue' : 'Changing'],
        ])}</div>
      </div>
      <h3>${L ? 'Home trainer' : 'Smart trainer'}</h3>
      <div class="grid3">
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
      </div>
      <h3>${L ? 'Coureurs IA' : 'AI riders'}</h3>
      <div class="grid3">
        <label class="field">${L ? 'Nombre' : 'Count'}<input id="m-ai" type="number" min="0" max="19" value="${s.aiRiders}" /></label>
        <div class="field">${L ? 'Niveau' : 'Level'}${this.seg('m-ailevel', String(s.aiLevel), [
          ['0.8', '80 % FTP'],
          ['1', '100 % FTP'],
          ['1.15', '115 % FTP'],
        ])}</div>
      </div>
      <h3>${L ? 'Musique' : 'Music'}</h3>
      <div id="m-music-settings" class="mm-musicset"></div>
      <h3>${L ? 'Son' : 'Sound'}</h3>
      <div id="m-sound-settings"></div>
      <h3>${L ? 'Appli compagnon (téléphone)' : 'Companion app (phone)'}</h3>
      <div id="m-companion-settings"></div>
      <h3>${L ? 'Langue et envoi des sorties' : 'Language and ride upload'}</h3>
      <div class="grid3">
        <div class="field">${t('language')}${this.seg('m-lang', s.lang, [
          ['fr', 'Français'],
          ['en', 'English'],
        ])}</div>
        <div class="field">Strava${this.seg('m-strava', s.skipStrava ? 'skip' : 'send', [
          ['skip', L ? 'Ne pas envoyer' : 'Don’t upload'],
          ['send', L ? 'Envoyer' : 'Upload'],
        ])}</div>
      </div>
    </section>`;
  }

  // ————————————————————————————————————————————— Musique et Spotify

  /** Lecteur compact de la barre du haut, et section complète dans les réglages. */
  renderMusic(): void {
    const L = fr();
    const top = this.root.querySelector('#m-music');
    if (top && spotify.connected) {
      // Spotify piloté depuis le jeu : lecture ici, titre, commandes, playlists, volume.
      top.innerHTML = `<img class="mm-cover" id="sp-cover" alt="" hidden />
        <span class="mm-now" id="mu-now"><i class="sp">●</i> Spotify</span>
        <button class="mm-ico" id="sp-prev" title="${L ? 'Précédent' : 'Previous'}">${ICON.prev}</button>
        <button class="mm-ico on" id="sp-play" title="${L ? 'Lecture / pause (B)' : 'Play / pause (B)'}">${ICON.play}</button>
        <button class="mm-ico" id="sp-next" title="${L ? 'Suivant (N)' : 'Next (N)'}">${ICON.next}</button>
        <button class="mm-ico" id="sp-lists" title="${L ? 'Mes playlists' : 'My playlists'}">${ICON.list}</button>
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
      void this.refreshNowPlaying();
    } else if (top) {
      const cur = music.enabled && music.current ? esc(music.current.title) : L ? 'Musique coupée' : 'Music off';
      top.innerHTML = `<button class="mm-ico ${music.enabled ? 'on' : ''}" id="mu-toggle" title="${L ? 'Musique marche / arrêt (B)' : 'Music on / off (B)'}">${music.enabled ? ICON.music : ICON.musicOff}</button>
        <span class="mm-now" id="mu-now">${cur}</span>
        <button class="mm-ico" id="mu-next" title="${L ? 'Morceau suivant (N)' : 'Next track (N)'}">${ICON.next}</button>
        <button class="mm-spotify" id="sp-login" title="${L ? 'Connecter ton compte Spotify' : 'Connect your Spotify account'}"><i class="sp">●</i> Spotify</button>`;
      top.querySelector('#mu-toggle')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      top.querySelector('#mu-next')?.addEventListener('click', () => music.next());
      top.querySelector('#sp-login')?.addEventListener('click', () => this.spotifyConnect());
    }
    const set = this.root.querySelector('#m-music-settings');
    if (set) {
      set.innerHTML = `<button class="btn small ${music.enabled ? 'on' : ''}" id="mu-toggle2">♪ ${L ? 'Musique du jeu' : 'Game music'} : ${music.enabled ? (L ? 'activée' : 'on') : L ? 'coupée' : 'off'}</button>
        <label class="mm-vol">Volume<input id="mu-vol" type="range" min="0" max="1" step="0.05" value="${music.volume}" /></label>
        ${spotify.connected ? `<button class="btn small" id="sp-logout">${L ? 'Déconnecter Spotify' : 'Disconnect Spotify'}</button>` : `<button class="btn small mm-spotify" id="sp-login2"><i class="sp">●</i> ${L ? 'Connecter Spotify' : 'Connect Spotify'}</button>`}`;
      set.querySelector('#mu-toggle2')?.addEventListener('click', () => {
        music.toggle();
        this.renderMusic();
      });
      set.querySelector('#mu-vol')?.addEventListener('input', (e) => music.setVolume(Number((e.target as HTMLInputElement).value)));
      set.querySelector('#sp-login2')?.addEventListener('click', () => this.spotifyConnect());
      set.querySelector('#sp-logout')?.addEventListener('click', () => {
        spotify.logout();
        this.renderMusic();
      });
    }
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
      });
    }
  }

  /** Départ d'une sortie : l'appli compagnon est d'abord proposée (tous les modes). */
  private launch(...args: Parameters<MenuCallbacks['onStart']>): void {
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
    const on = <T extends HTMLElement>(id: string, ev: string, fn: (el: T) => void) => {
      const el = this.root.querySelector(`#${id}`) as T | null;
      el?.addEventListener(ev, () => fn(el));
    };
    const changed = () => {
      saveSettings(s);
      this.onSettingsChange?.(s);
      this.onSettingsSaved?.(s);
    };
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => el.addEventListener('click', () => this.go(el.dataset.tab as Tab)));
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
    if (this.picker === 'map' && this.openWorld)
      this.planner.bind(this.root, (r) => this.routeCard(r), {
        // « Rouler cet itinéraire » / « Rouler en libre » : la sortie part tout de suite.
        ride: (route) => {
          this.drawn = route;
          this.drawnWorld = this.worldId;
          s.routeId = route.id;
          s.reverse = false;
          if (s.mode !== 'free' && s.mode !== 'workout') s.mode = 'free';
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
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-kom]').forEach((el) =>
      el.addEventListener('click', () => {
        s.challengeSeg = el.dataset.kom as string;
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) =>
      el.addEventListener('click', () => {
        s.workoutPreset = el.dataset.preset as string;
        this.workoutFile = undefined;
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
    // Zone ouverte : parcours fixés, parcours libre (départ par défaut), parcours à dessiner.
    this.root.querySelectorAll<HTMLElement>('[data-zc]').forEach((el) =>
      el.addEventListener('click', () => {
        const c = el.dataset.zc;
        if (c === 'free') {
          s.mode = 'open';
          this.freeStart = null;
          this.picker = null;
          changed();
          this.render();
          return;
        }
        this.picker = c === 'draw' ? 'map' : 'routes';
        this.render();
      }),
    );
    // « Choisir ma sortie » et carte du choix : fenêtre de choix au milieu de l'écran.
    this.root.querySelectorAll<HTMLElement>('[data-picker]').forEach((el) =>
      el.addEventListener('click', () => {
        this.picker = el.dataset.picker as 'zones' | 'zone' | 'routes' | 'map' | 'route';
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
    this.root.querySelectorAll<HTMLElement>('[data-unpack]').forEach((el) =>
      el.addEventListener('click', () => {
        void removePack(el.dataset.unpack as string).then(() => this.render());
      }),
    );
    // Carte de parcours : sa fiche s'ouvre (records, montées) ; on part ou on le choisit depuis elle.
    this.root.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
      el.addEventListener('click', () => {
        this.detailId = el.dataset.route as string;
        this.detailReverse = this.detailId === s.routeId && s.reverse;
        this.fromRect = el.getBoundingClientRect();
        this.picker = 'route';
        this.render();
      }),
    );
    const pickRoute = () => {
      s.routeId = this.detailId;
      s.reverse = this.detailReverse;
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
      // Sens du parcours : la fiche se refait pour l'autre sens (profil, montées, records).
      this.root.querySelectorAll<HTMLElement>('#rd-dir [data-v]').forEach((el) =>
        el.addEventListener('click', () => {
          this.detailReverse = el.dataset.v === '1';
          this.render();
        }),
      );
    }
    this.animatePicker();
    on<HTMLInputElement>('m-workout', 'change', async (el) => {
      const f = el.files?.[0];
      if (!f) return;
      this.workoutFile = { name: f.name, content: await f.text() };
      const n = this.root.querySelector('#m-wname');
      if (n) n.textContent = f.name;
    });
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
        const { likenessFromPhoto } = await import('../onboarding/likeness.ts');
        const l = await likenessFromPhoto(f);
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
        this.garageSlot = el.dataset.slot as CosmeticSlot | 'colors' | 'face' | 'atelier';
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
        this.onScene?.(this.view, this.yaw);
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
      this.previewId = null;
      this.onPreviewLook?.(null);
      this.render();
    });
    this.root.querySelector<HTMLElement>('[data-plainbike]')?.addEventListener('click', () => {
      this.previewId = null;
      this.onPreviewLook?.(null);
      equipPlainBike(s);
      changed();
      this.render();
    });
    this.root.querySelectorAll<HTMLElement>('[data-item]').forEach((el) =>
      el.addEventListener('click', () => {
        const item = COSMETICS.find((c) => c.id === el.dataset.item);
        if (!item) return;
        const locked = item.level > levelProgress(loadProgress().xp).level;
        if (locked) {
          // Verrouillé : simple aperçu sur le coureur, rien n'est équipé ni enregistré.
          this.previewId = this.previewId === item.id ? null : item.id;
          this.onPreviewLook?.(this.previewId ? this.lookWith(item) : null);
          this.render();
          return;
        }
        this.previewId = null;
        this.onPreviewLook?.(null);
        equipItem(item, s);
        changed();
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach((el) =>
      el.addEventListener('click', () => {
        this.view = el.dataset.view as GarageView;
        this.yaw = 0;
        this.root.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b === el));
        this.onScene?.(this.view, this.yaw);
      }),
    );
    const zone = this.root.querySelector<HTMLElement>('#m-dragzone');
    if (zone) {
      let lastX: number | null = null;
      zone.addEventListener('pointerdown', (e) => {
        lastX = e.clientX;
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
        this.onScene?.(this.view, this.yaw);
      });
      const up = () => (lastX = null);
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
    on<HTMLInputElement>('m-name', 'change', (el) => {
      s.name = el.value.trim().slice(0, 24) || 'Robert';
      changed();
      this.render();
    });
    // Réglages.
    on<HTMLSelectElement>('m-quality', 'change', (el) => {
      s.quality = el.value as Settings['quality'];
      localStorage.setItem('ar.quality', s.quality);
      changed();
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
    on<HTMLSelectElement>('m-ailevel', 'change', (el) => {
      s.aiLevel = Number(el.value);
      changed();
    });
    on<HTMLSelectElement>('m-equal', 'change', (el) => {
      s.equalEquipment = el.value === '1';
      changed();
    });
    if (this.tab === 'garage' && this.garageSlot === 'atelier') this.atelier.bind(this.root);
    on<HTMLSelectElement>('m-evolve', 'change', (el) => {
      s.weatherEvolves = el.value === '1';
      changed();
    });
    on<HTMLSelectElement>('m-smooth', 'change', (el) => {
      s.smoothing3s = el.value === '1';
      changed();
    });
  }
}
