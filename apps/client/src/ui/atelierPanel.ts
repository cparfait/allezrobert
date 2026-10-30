import {
  RARITY_LABEL,
  TUNE_EVENT_LABEL,
  TUNE_ITEMS,
  TUNE_KITS,
  TUNE_SLOTS,
  applyTuneLook,
  bikeOfLook,
  bikeSetupFor,
  kitPrice,
  kitProgress,
  levelProgress,
  tuneAvailability,
  tuneItem,
  type AvatarLook,
  type BikeBuild,
  type TuneFamily,
  type TuneItem,
  type TuneSlot,
} from '@allezrobert/shared';
import { TUNE_BONUS_CAP, bikeStats, tuneGains, tunedBikeSetup, type BikeStats } from '@allezrobert/physics';
import { getLang } from '../i18n/index.ts';
import type { Settings } from './settings.ts';
import { applyServerPurchase, buyLocal, equipKit, equipTune, equippedTune, loadProgress, resetTune, unequipTune } from './garage.ts';
import { buyOnServer } from './account.ts';
import { SLOT_PARTS, type AtelierState } from './atelier.ts';

/**
 * Panneau de l'atelier (onglet Garage) : familles, emplacements, pièces (survol = essai immédiat
 * sur le vélo 3D avec surbrillance), ensembles avec leur avancement, achat en crédits (montant
 * manquant affiché), équipement, réinitialisation, et chiffres avant → après calculés avec la
 * vraie physique (@allezrobert/physics).
 */

const FAMILY_LABEL: Record<TuneFamily, [string, string]> = {
  tech: ['Technique', 'Tech'],
  paint: ['Peinture', 'Paint'],
  wheelfx: ['Roues & effets', 'Wheels & FX'],
  accessory: ['Accessoires', 'Accessories'],
  kit: ['Ensembles', 'Sets'],
  event: ['Récompenses', 'Rewards'],
};

export const TUNE_SLOT_LABEL: Record<TuneSlot, [string, string]> = {
  wheelset: ['Roues', 'Wheels'],
  tyres: ['Pneus', 'Tyres'],
  cockpit: ['Cockpit', 'Cockpit'],
  aerobars: ['Prolongateurs', 'Aerobars'],
  groupset: ['Transmission', 'Groupset'],
  crank: ['Pédalier', 'Crankset'],
  cassette: ['Cassette', 'Cassette'],
  pulleys: ['Galets', 'Pulleys'],
  rotors: ['Disques', 'Rotors'],
  saddle: ['Selle', 'Saddle'],
  seatpost: ['Tige de selle', 'Seatpost'],
  paint: ['Livrées', 'Liveries'],
  finish: ['Vernis', 'Finish'],
  sticker: ['Autocollants', 'Stickers'],
  number: ['Plaques', 'Numbers'],
  rimdecal: ['Décors de jante', 'Rim decals'],
  spokes: ['Rayons', 'Spokes'],
  rimglow: ['Jantes lumineuses', 'Glowing rims'],
  valves: ['Valves', 'Valves'],
  tape: ['Guidoline', 'Bar tape'],
  bottles: ['Bidons', 'Bottles'],
  chain: ['Chaîne', 'Chain'],
  topcap: ['Capuchon', 'Top cap'],
  spacers: ['Entretoises', 'Spacers'],
  bolts: ['Visserie', 'Bolts'],
  computer: ['Compteur', 'Computer'],
};

/** Zones du vélo (schéma cliquable) : chacune regroupe des emplacements de pièces. */
interface Zone {
  id: string;
  label: [string, string];
  slots: TuneSlot[];
}
const ZONES: Zone[] = [
  { id: 'wheels', label: ['Roues', 'Wheels'], slots: ['wheelset', 'spokes', 'rimdecal', 'rimglow', 'valves'] },
  { id: 'tyres', label: ['Pneus', 'Tyres'], slots: ['tyres'] },
  { id: 'cockpit', label: ['Cockpit', 'Cockpit'], slots: ['cockpit', 'aerobars', 'tape', 'computer', 'topcap', 'spacers', 'bolts'] },
  { id: 'saddle', label: ['Selle', 'Saddle'], slots: ['saddle', 'seatpost'] },
  { id: 'drive', label: ['Transmission', 'Drivetrain'], slots: ['groupset', 'crank', 'cassette', 'chain', 'pulleys', 'rotors'] },
  { id: 'frame', label: ['Cadre', 'Frame'], slots: ['paint', 'finish', 'sticker', 'number', 'bottles'] },
];
const zoneOfSlot = (sl: TuneSlot): Zone => ZONES.find((z) => z.slots.includes(sl)) ?? (ZONES[0] as Zone);
const familyOfSlot = (sl: TuneSlot): TuneFamily => ((Object.keys(TUNE_SLOTS) as Array<keyof typeof TUNE_SLOTS>).find((f) => (TUNE_SLOTS[f] as readonly string[]).includes(sl)) ?? 'tech') as TuneFamily;
const pic = (d: string) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
/** Pictogramme de chaque zone, posé sur la couleur de la pièce. */
const ZONE_PICTO: Record<string, string> = {
  wheels: pic('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v6.5M12 14v6.5M3.5 12H10M14 12h6.5"/>'),
  tyres: pic('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5.5"/>'),
  cockpit: pic('<path d="M3 8h18M12 8v8M5 8c0 4 1 6 3 7M19 8c0 4-1 6-3 7"/>'),
  saddle: pic('<path d="M4 9c3-1 7 0 10 1l6-1c1 0 1 2 0 2l-6 1c-3 1-7 1-10 0-1 0-1-2 0-3ZM12 13v7"/>'),
  drive: pic('<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1"/>'),
  frame: pic('<path d="M5 17 9 8h8l-3 9M9 8 7 5H5M14 17H5M17 8l2 9"/>'),
};
/** Encre lisible (claire ou foncée) sur le fond d'une pastille : d'après la première couleur hexadécimale. */
function inkOn(bg: string): string {
  const m = /#([0-9a-f]{6})/i.exec(bg);
  if (!m) return '#ffffff';
  const v = parseInt(m[1] as string, 16);
  const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.62 ? '#10141c' : '#ffffff';
}

const fr = () => getLang() === 'fr';
const L2 = (p: [string, string]) => (fr() ? p[0] : p[1]);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const n = (v: number, d = 1) => v.toFixed(d).replace('.', fr() ? ',' : '.');
const credits = (v: number) => `${Math.round(v).toLocaleString(fr() ? 'fr-FR' : 'en-GB')}`;
/** Pictogramme des crédits (pièce). */
export const COIN = `<svg class="at-coin" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#ffd23f"/><circle cx="8" cy="8" r="4.6" fill="none" stroke="#a87d00" stroke-width="1.4"/></svg>`;

/** Vignette d'une pièce : ses couleurs (livrée, pièces, flancs, jantes). */
export function swatch(t: TuneItem): string {
  const l = t.look ?? {};
  const cols: string[] = [];
  if (l.livery?.colors) cols.push(...l.livery.colors);
  if (l.livery?.stops) cols.push(...l.livery.stops.map((s) => s.color));
  if (l.parts) cols.push(...Object.values(l.parts).filter((c): c is string => !!c));
  if (l.tireWall && l.tireWall !== 'rainbow') cols.push('#141416', l.tireWall);
  if (l.rim && l.rim !== 'holo') cols.push('#1b1c1f', l.rim);
  if (l.glow) return `radial-gradient(circle, #0b0d12 38%, ${l.glow} 42% 55%, #0b0d12 60%)`;
  if (l.number) return `linear-gradient(${l.number.bg} 0 72%, ${l.number.stripe ?? l.number.bg} 72%)`;
  if (l.tireWall === 'rainbow' || l.rim === 'holo') return 'conic-gradient(#e63946, #ffd23f, #2a9d8f, #1e5bd8, #a855f7, #e63946)';
  if (l.finish) return { matte: '#4b5563', gloss: 'linear-gradient(135deg,#9ca3af,#f3f4f6 50%,#6b7280)', metallic: 'linear-gradient(135deg,#6b7280,#e5e7eb,#4b5563)', pearl: 'linear-gradient(135deg,#f5f3ff,#dbeafe,#fce7f3)', iridescent: 'linear-gradient(135deg,#7c3aed,#06b6d4,#84cc16,#f59e0b)', chrome: 'linear-gradient(135deg,#6b7280,#fff,#9ca3af)', raw: '#1b1c1f', chroma: 'linear-gradient(135deg,#1d34b8,#7334c4,#c23c86,#c8892c)' }[l.finish];
  if (l.wheels) return `radial-gradient(circle, #2a2c30 18%, #0b0d12 20% ${l.wheels[0] === 'c65' || l.wheels[1] === 'disc' ? 56 : l.wheels[0] === 'c50' ? 64 : 72}%, #1b1c1f 74% 86%, #0b0d12 88%)`;
  if (l.marks) return 'linear-gradient(135deg,#111214 0 45%,#ffd23f 45% 55%,#111214 55%)';
  if (!cols.length) return '#3a3f48';
  const k = cols.length;
  return `linear-gradient(135deg, ${cols.map((c, i) => `${c} ${((i * 100) / k).toFixed(0)}% ${(((i + 1) * 100) / k).toFixed(0)}%`).join(', ')})`;
}

/**
 * Vignette d'un ensemble : vélo de profil en SVG (cadre aux couleurs de la livrée, profondeur des
 * jantes, flancs, guidoline, selle, liseré lumineux).
 */
export function bikeThumb(build: BikeBuild, id: string): string {
  const liv = build.livery;
  const cols = liv.stops?.length ? liv.stops.map((s) => s.color) : liv.colors;
  const c0 = cols[0] ?? '#888';
  const c1 = cols[1] ?? c0;
  const c2 = cols[2] ?? c1;
  const chrome = liv.finish === 'chrome';
  const ex = build.extras ?? {};
  const wheel = (cx: number, type: string) => {
    const depth = type === 'disc' ? 26 : type === 'c65' ? 9 : type === 'c50' ? 7 : type === 'tri' ? 6 : type === 'box' ? 2.5 : 5;
    const wall = liv.tireWall ?? '#141416';
    const rainbow = ex.rainbowWall ? `url(#rb-${id})` : wall;
    return `<circle cx="${cx}" cy="62" r="29" fill="none" stroke="#111214" stroke-width="4"/>
      <circle cx="${cx}" cy="62" r="26.5" fill="none" stroke="${rainbow}" stroke-width="1.6"/>
      ${type === 'disc' ? `<circle cx="${cx}" cy="62" r="25" fill="${liv.disc ?? '#1b1c1f'}"/>` : `<circle cx="${cx}" cy="62" r="${25 - depth / 2}" fill="none" stroke="${type === 'box' ? '#c9ced6' : '#1b1c1f'}" stroke-width="${depth}"/>`}
      ${type === 'tri' ? [0, 120, 240].map((a) => `<line x1="${cx}" y1="62" x2="${cx + 22 * Math.cos((a * Math.PI) / 180)}" y2="${62 + 22 * Math.sin((a * Math.PI) / 180)}" stroke="#1b1c1f" stroke-width="6" stroke-linecap="round"/>`).join('') : type !== 'disc' ? `<g stroke="${ex.parts?.spokes ?? '#9aa0a8'}" stroke-width="0.6">${[0, 30, 60, 90, 120, 150].map((a) => `<line x1="${cx - 20 * Math.cos((a * Math.PI) / 180)}" y1="${62 - 20 * Math.sin((a * Math.PI) / 180)}" x2="${cx + 20 * Math.cos((a * Math.PI) / 180)}" y2="${62 + 20 * Math.sin((a * Math.PI) / 180)}"/>`).join('')}</g>` : ''}
      ${ex.glow ? `<circle cx="${cx}" cy="62" r="${23 - depth}" fill="none" stroke="${ex.glow}" stroke-width="1.6" filter="url(#gl-${id})"/>` : ''}
      ${liv.rim && !ex.glow ? `<circle cx="${cx}" cy="62" r="${25 - depth / 2}" fill="none" stroke="${liv.rim}" stroke-width="1" stroke-dasharray="6 30"/>` : ''}
      <circle cx="${cx}" cy="62" r="2.5" fill="#2a2c30"/>`;
  };
  const [wf, wr] = build.params.wheels;
  return `<svg class="at-thumb" viewBox="0 0 180 100" aria-hidden="true">
    <defs>
      <linearGradient id="fr-${id}" x1="0" x2="1" y1="0" y2="0.3"><stop offset="0" stop-color="${c0}"/><stop offset="0.55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
      <linearGradient id="rb-${id}"><stop offset="0" stop-color="#0a5cc2"/><stop offset="0.25" stop-color="#d81e2b"/><stop offset="0.5" stop-color="#f4c300"/><stop offset="0.75" stop-color="#1a9b3a"/><stop offset="1" stop-color="#0a5cc2"/></linearGradient>
      <filter id="gl-${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
    </defs>
    ${wheel(40, wr)}${wheel(140, wf)}
    <g fill="none" stroke="url(#fr-${id})" stroke-width="${chrome ? 4.2 : 4}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M40 62 L78 64 L68 26 Z"/><path d="M68 26 L124 22 L78 64"/><path d="M124 22 L128 34 L140 62"/>
    </g>
    ${chrome ? '<path d="M70 28 L122 24" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/>' : ''}
    <path d="M124 22 L127 12 L138 12 Q146 12 144 20" fill="none" stroke="${liv.tape ?? '#141518'}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M68 26 L66 16" stroke="${ex.parts?.seatpost ?? '#2a2c30'}" stroke-width="2.6"/><path d="M56 15 Q66 12 74 15" stroke="${liv.saddle ?? '#141518'}" stroke-width="3.6" stroke-linecap="round" fill="none"/>
    <circle cx="78" cy="64" r="6" fill="none" stroke="${ex.parts?.chainring ?? '#2a2c30'}" stroke-width="2"/>
    <path d="M40 62 L78 58" stroke="${ex.parts?.chain ?? '#9a9da3'}" stroke-width="1.1"/>
    ${ex.number ? `<rect x="58" y="18" width="9" height="7" rx="1" fill="${ex.number.bg}" stroke="${ex.number.fg}" stroke-width="0.6"/>` : ''}
  </svg>`;
}

export interface AtelierPanelHost {
  /** Compte connecté (achats sur le serveur), niveau du compte ou local. */
  account(): { level: number } | null;
  /** État 3D demandé à l'atelier (null : fermé). */
  scene(st: AtelierState | null): void;
  /** Réglages enregistrés (tenue) : image d'accueil et profil du compte. */
  changed(): void;
  /** Nouveau rendu du menu (solde, panneau). */
  rerender(): void;
}

export class AtelierPanel {
  family: TuneFamily = 'tech';
  slot: TuneSlot = 'wheelset';
  /** Pièce sélectionnée (aperçu figé, détail et actions) ; pièce survolée (aperçu passager). */
  private selected: string | null = null;
  private hover: string | null = null;
  rider = false;
  yaw = 0;
  /** Distance de la caméra (molette), bornée par le menu. */
  zoom = 1;
  private msg = '';
  private readonly s: Settings;
  private readonly host: AtelierPanelHost;

  constructor(s: Settings, host: AtelierPanelHost) {
    this.s = s;
    this.host = host;
  }

  /** Pièce touchée sur le vélo 3D : ouvre la famille et l'emplacement correspondants (liste et cadrage). */
  focusSlot(slot: TuneSlot): void {
    const fam = (Object.keys(TUNE_SLOTS) as Array<keyof typeof TUNE_SLOTS>).find((f) => (TUNE_SLOTS[f] as readonly string[]).includes(slot));
    if (!fam) return;
    this.family = fam as TuneFamily;
    this.slot = slot;
    this.selected = null;
    this.hover = null;
    this.msg = '';
    this.emit(SLOT_PARTS[slot]);
    this.host.rerender();
  }

  /** Ouvre une pièce ou un ensemble (onglet Progression) : sa famille, son emplacement, sélectionnée et essayée. */
  openItem(id: string): void {
    const it = tuneItem(id);
    if (!it) return;
    this.family = it.family;
    if (it.slot && it.family !== 'event') this.slot = it.slot;
    this.selected = it.id;
    this.hover = null;
    this.msg = '';
  }

  private level(): number {
    return this.host.account()?.level ?? levelProgress(loadProgress().xp).level;
  }

  /** Pièces montées, avec la pièce essayée (ou les pièces de l'ensemble essayé) à leur place. */
  private trial(id: string | null): string[] {
    const cur = equippedTune();
    const it = tuneItem(id ?? undefined);
    if (!it) return cur;
    const add = it.family === 'kit' ? (it.pieces ?? []).map((p) => tuneItem(p)).filter((p): p is TuneItem => !!p) : [it];
    const slots = new Set(add.map((p) => p.slot));
    return [...cur.filter((c) => !slots.has(tuneItem(c)?.slot)), ...add.map((p) => p.id)];
  }

  private lookWith(ids: readonly string[]): AvatarLook {
    const { tune: _t, ...rest } = this.s.look;
    return ids.length ? { ...rest, tune: [...ids] } : rest;
  }

  /** Emplacement à cadrer : celui de la pièce essayée, sinon celui choisi. */
  private focus(): TuneSlot | 'overview' {
    const it = tuneItem(this.hover ?? this.selected ?? undefined);
    if (it?.slot) return it.slot;
    if (this.family === 'kit' || this.family === 'event') return 'overview';
    return this.slot;
  }

  /** Envoie l'état 3D (pièce essayée, cadrage, surbrillance). */
  emit(pulse?: readonly string[]): void {
    const look = this.lookWith(this.trial(this.hover ?? this.selected));
    this.host.scene({ look, focus: this.focus(), rider: this.rider, yaw: this.yaw, zoom: this.zoom, ...(pulse ? { pulse } : {}) });
  }

  /** Sortie de l'atelier : la pièce sélectionnée le reste (de nouveau essayée au retour). */
  leave(): void {
    this.hover = null;
    this.host.scene(null);
  }

  /** Arrivée depuis Progression : la pièce clignote (surbrillance répétée) quelques secondes pour la repérer. */
  blink(id: string): void {
    clearInterval(this.blinkTimer);
    let n = 0;
    this.blinkTimer = setInterval(() => {
      this.emit(this.pulseOf(id));
      if (++n >= 6) clearInterval(this.blinkTimer);
    }, 650);
  }

  private blinkTimer: ReturnType<typeof setInterval> | undefined;

  private pulseOf(id: string | null): string[] {
    const it = tuneItem(id ?? undefined);
    if (!it) return [];
    if (it.family === 'kit') return ['frame', ...new Set((it.pieces ?? []).flatMap((p) => SLOT_PARTS[tuneItem(p)?.slot as TuneSlot] ?? []))];
    return [...(SLOT_PARTS[it.slot as TuneSlot] ?? [])];
  }

  // ————————————————————————————————————————————— Affichage

  html(header = '', nav = ''): string {
    const L = fr();
    const p = loadProgress();
    const level = this.level();
    const fams: TuneFamily[] = ['tech', 'paint', 'wheelfx', 'accessory', 'kit', 'event'];
    const slots = this.family in TUNE_SLOTS ? TUNE_SLOTS[this.family as keyof typeof TUNE_SLOTS] : [];
    const list =
      this.family === 'kit'
        ? `<div class="at-kits">${TUNE_KITS.map((k) => this.kitCard(k, p.owned, p.credits, level)).join('')}</div>`
        : `<div class="at-chips">${TUNE_ITEMS.filter((t) => (this.family === 'event' ? t.family === 'event' : t.family === this.family && t.slot === this.slot))
            .map((t) => this.itemChip(t, p, level))
            .join('')}</div><div class="gr-cap at-cap" id="at-cap"><b></b><span></span><em></em></div>`;
    return `<div class="mm-dragzone" id="m-dragzone"></div>
      <section class="mm-panel mm-side gr-panel at-panel">
        <div class="gr-top">${header}${nav}
          ${this.zonesHtml(p)}
        </div>
        <div class="gr-body">${list}${this.msg ? `<p class="at-msg">${esc(this.msg)}</p>` : ''}</div>
        <div class="gr-foot at-bottom">
          ${this.detailHtml(p, level) || `<p class="at-hint">${L ? 'Survole une pièce pour l’essayer sur le vélo. Les crédits se gagnent en roulant.' : 'Hover a part to try it on the bike. Credits are earned by riding.'}</p>`}
          <div class="at-foot">
            <div class="mm-seg at-rider" data-value="${this.rider ? '1' : '0'}"><button type="button" class="${this.rider ? '' : 'on'}" data-atrider="0">${L ? 'Vélo seul' : 'Bike only'}</button><button type="button" class="${this.rider ? 'on' : ''}" data-atrider="1">${L ? 'Avec le coureur' : 'With rider'}</button></div>
            <button class="at-reset" id="at-reset" title="${L ? 'Démonter toutes les pièces de l’atelier' : 'Remove every workshop part'}">${L ? 'Réinitialiser' : 'Reset'}</button>
          </div>
        </div>
      </section>
      ${this.statsHtml()}`;
  }

  /** Schéma du vélo (zones cliquables), ensembles et récompenses, puis les emplacements de la zone choisie. */
  private zonesHtml(p: ReturnType<typeof loadProgress>): string {
    const L = fr();
    const zone = this.family === 'kit' || this.family === 'event' ? null : zoneOfSlot(this.slot);
    const hot = (z: Zone, cx: number, cy: number, r: number, tx: number | null, ty = 0, anchor = 'middle') =>
      `<g class="at-hot ${zone?.id === z.id ? 'on' : ''}" data-atzone="${z.id}" role="button" tabindex="0" aria-label="${L2(z.label)}"><title>${L2(z.label)}</title><circle cx="${cx}" cy="${cy}" r="${r}"/>${tx === null ? '' : `<text x="${tx}" y="${ty}" text-anchor="${anchor}">${L2(z.label)}</text>`}</g>`;
    const [wheels, tyres, cockpit, saddle, drive, frame] = ZONES as [Zone, Zone, Zone, Zone, Zone, Zone];
    const svg = `<svg class="at-bike" viewBox="0 0 330 168" role="group" aria-label="${L ? 'Schéma du vélo' : 'Bike diagram'}">
      <g class="at-line"><circle cx="75" cy="112" r="42"/><circle cx="255" cy="112" r="42"/><path d="M75 112 L135 112 L180 52 L112 52 Z M135 112 L180 52 M180 52 L245 52 L255 112 M112 52 L104 34 M245 52 L236 32 L258 32"/></g>
      ${hot(wheels, 75, 112, 13, 75, 168)}${hot(wheels, 255, 112, 13, null)}${hot(tyres, 33, 112, 7, null)}${hot(tyres, 297, 112, 7, 297, 134)}
      ${hot(cockpit, 247, 24, 9, 247, 10)}${hot(saddle, 104, 24, 9, 104, 10)}${hot(drive, 135, 112, 10, 170, 154)}${hot(frame, 180, 52, 9, 196, 42, 'start')}
    </svg>`;
    const extra = `<div class="at-extra"><button class="gr-vchip ${this.family === 'kit' ? 'on' : ''}" data-atzone="kit">${L2(FAMILY_LABEL.kit)}</button><button class="gr-vchip ${this.family === 'event' ? 'on' : ''}" data-atzone="event">${L2(FAMILY_LABEL.event)}</button></div>`;
    const types =
      zone && zone.slots.length > 1
        ? `<div class="gr-vopt at-types"><small>${L2(zone.label)}</small><div>${zone.slots
            .map((sl) => `<button class="gr-vchip ${sl === this.slot ? 'on' : ''}" data-atslot="${sl}" aria-pressed="${sl === this.slot}">${L2(TUNE_SLOT_LABEL[sl])}${p.equipped[sl] ? '<u class="at-dot"></u>' : ''}</button>`)
            .join('')}</div></div>`
        : '';
    return `<div class="at-zones">${svg}${extra}</div>${types}`;
  }

  /** Pastille d'une pièce : pictogramme de sa zone sur ses couleurs, liseré de rareté, état en coin. */
  private itemChip(t: TuneItem, p: ReturnType<typeof loadProgress>, level: number): string {
    const L = fr();
    const owned = p.owned.includes(t.id);
    const on = !!t.slot && p.equipped[t.slot] === t.id;
    const av = tuneAvailability(t, level, p.owned);
    const locked = !owned && av !== 'buyable';
    const bg = swatch(t);
    const rar = RARITY_LABEL[t.rarity];
    const state = on ? (L ? 'Équipé' : 'Equipped') : owned ? (L ? 'Possédé' : 'Owned') : locked ? (av === 'level' && 'level' in t.unlock ? `${L ? 'Niveau' : 'Level'} ${t.unlock.level}` : L ? 'Verrouillé' : 'Locked') : `${credits(t.price)} ${L ? 'crédits' : 'credits'}`;
    const badge = on ? '<u class="ok">✓</u>' : locked ? `<u>${pic('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>').replace('width="26" height="26"', 'width="10" height="10"')}</u>` : owned ? '' : `<u class="coin">${COIN}</u>`;
    return `<button class="at-item at-chip ${on ? 'on' : ''} ${owned ? 'owned' : ''} ${locked ? 'locked' : ''} ${this.selected === t.id ? 'sel' : ''}" data-tune="${t.id}" data-cap-name="${esc(t.name[L ? 'fr' : 'en'])}" data-cap-effect="${esc(t.effect[L ? 'fr' : 'en'])}" data-cap-state="${esc(state)}" style="--rar:${rar.color};background:${bg};color:${inkOn(bg)}" aria-label="${esc(t.name[L ? 'fr' : 'en'])} — ${esc(state)}">${badge}</button>`;
  }

  private stateLabel(t: TuneItem, owned: boolean, on: boolean, level: number, creditsNow: number): string {
    const L = fr();
    if (on) return `<span class="at-st on">${L ? 'Équipé' : 'Equipped'}</span>`;
    if (owned) return `<span class="at-st own">${L ? 'Possédé' : 'Owned'}</span>`;
    const av = tuneAvailability(t, level, []);
    if (av === 'event' && 'event' in t.unlock) return `<span class="at-st ev">🏆 ${esc(TUNE_EVENT_LABEL[t.unlock.event][L ? 'fr' : 'en'])}</span>`;
    if (av === 'kit' && 'kit' in t.unlock) return `<span class="at-st kit">${L ? 'Ensemble' : 'Set'} ${esc(tuneItem(t.unlock.kit)?.name[L ? 'fr' : 'en'] ?? '')}</span>`;
    if (av === 'level' && 'level' in t.unlock) return `<span class="at-st lock">🔒 ${L ? 'niveau' : 'level'} ${t.unlock.level}</span>`;
    return `<span class="at-st price ${creditsNow < t.price ? 'short' : ''}">${COIN} ${credits(t.price)}</span>`;
  }

  private itemCard(t: TuneItem, p: ReturnType<typeof loadProgress>, level: number): string {
    const L = fr();
    const owned = p.owned.includes(t.id);
    const on = !!t.slot && p.equipped[t.slot] === t.id;
    const rar = RARITY_LABEL[t.rarity];
    const sel = this.selected === t.id;
    return `<button class="at-item ${on ? 'on' : ''} ${owned ? 'owned' : ''} ${sel ? 'sel' : ''}" data-tune="${t.id}" style="--rar:${rar.color}" title="${esc(t.desc[L ? 'fr' : 'en'])}">
      <i class="at-sw" style="background:${swatch(t)}"></i>
      <span class="at-body"><b>${esc(t.name[L ? 'fr' : 'en'])}</b><small><em class="at-rar">${rar[L ? 'fr' : 'en']}</em>${this.family === 'event' && t.slot ? ` · ${L2(TUNE_SLOT_LABEL[t.slot])}` : ''}</small><span class="at-eff ${t.effect.fr === 'Style uniquement' ? 'style' : ''}">${esc(t.effect[L ? 'fr' : 'en'])}</span></span>
      ${this.stateLabel(t, owned, on, level, p.credits)}</button>`;
  }

  private kitCard(k: TuneItem, owned: string[], creditsNow: number, level: number): string {
    const L = fr();
    const prog = kitProgress(k, owned);
    const price = kitPrice(k, owned);
    const lvl = 'level' in k.unlock ? k.unlock.level : 1;
    const rar = RARITY_LABEL[k.rarity];
    const build = applyTuneLook(bikeOfLook({ ...this.s.look, tune: [] }), k.pieces ?? []);
    const pieces = (k.pieces ?? []).map((id) => tuneItem(id)).filter((t): t is TuneItem => !!t);
    const buyable = price > 0;
    const action = !buyable
      ? ''
      : level < lvl
        ? `<span class="at-st lock">🔒 ${L ? 'niveau' : 'level'} ${lvl}</span>`
        : creditsNow < price
          ? `<button class="at-btn ghost" disabled>${L ? 'Il manque' : 'Missing'} ${COIN} ${credits(price - creditsNow)}</button>`
          : `<button class="at-btn" data-atbuy="${k.id}">${L ? 'Acheter' : 'Buy'} · ${COIN} ${credits(price)}</button>`;
    return `<article class="at-kit ${prog.complete ? 'done' : ''} ${this.selected === k.id ? 'sel' : ''}" data-tune="${k.id}" style="--rar:${rar.color};--badge:${k.badge ?? rar.color}">
      <div class="at-kit-top">${bikeThumb(build, k.id)}<span class="at-badge" title="${esc(k.title?.[L ? 'fr' : 'en'] ?? '')}">${prog.complete ? '★' : ''}</span></div>
      <div class="at-kit-body"><b>${esc(k.name[L ? 'fr' : 'en'])}</b><small><em class="at-rar">${rar[L ? 'fr' : 'en']}</em></small>
        <p>${esc(k.desc[L ? 'fr' : 'en'])}</p>
        <div class="at-prog"><i style="width:${((prog.have / Math.max(1, prog.total)) * 100).toFixed(0)}%"></i></div>
        <span class="at-count">${prog.have}/${prog.total} ${L ? 'pièces' : 'parts'}${prog.complete ? ` · ${L ? 'Titre' : 'Title'} « ${esc(k.title?.[L ? 'fr' : 'en'] ?? '')} »` : ''}</span>
        <ul class="at-pieces">${pieces.map((t) => `<li class="${owned.includes(t.id) ? 'have' : ''}">${esc(t.name[L ? 'fr' : 'en'])}</li>`).join('')}</ul>
        <div class="at-kit-act"><button class="at-btn ${prog.have ? '' : 'ghost'}" data-atkit="${k.id}" ${prog.have ? '' : 'disabled'}>${L ? 'Équiper l’ensemble' : 'Equip the set'}</button>${action}</div>
      </div></article>`;
  }

  /** Détail et actions de la pièce sélectionnée. */
  private detailHtml(p: ReturnType<typeof loadProgress>, level: number): string {
    const t = tuneItem(this.selected ?? undefined);
    if (!t || t.family === 'kit') return '';
    const L = fr();
    const owned = p.owned.includes(t.id);
    const on = !!t.slot && p.equipped[t.slot] === t.id;
    const av = tuneAvailability(t, level, p.owned);
    let act = '';
    if (on) act = `<button class="at-btn ghost" data-atoff="${t.slot}">${L ? 'Démonter' : 'Remove'}</button>`;
    else if (owned) act = `<button class="at-btn" data-atequip="${t.id}">${L ? 'Équiper' : 'Equip'}</button>`;
    else if (av === 'buyable')
      act =
        p.credits >= t.price
          ? `<button class="at-btn" data-atbuy="${t.id}">${L ? 'Acheter et équiper' : 'Buy and equip'} · ${COIN} ${credits(t.price)}</button>`
          : `<button class="at-btn ghost" disabled>${L ? 'Il manque' : 'Missing'} ${COIN} ${credits(t.price - p.credits)}</button>`;
    else act = this.stateLabel(t, false, false, level, p.credits);
    return `<div class="at-detail" style="--rar:${RARITY_LABEL[t.rarity].color}">
      <div><b>${esc(t.name[L ? 'fr' : 'en'])}</b>${t.brand ? ` <small>${esc(t.brand)}</small>` : ''}<p>${esc(t.desc[L ? 'fr' : 'en'])}</p><span class="at-eff">${esc(t.effect[L ? 'fr' : 'en'])}</span></div>
      <div class="at-detail-act">${act}<button class="at-btn ghost" data-atclose>${L ? 'Annuler l’essai' : 'Stop trying'}</button></div></div>`;
  }

  /** Chiffres du vélo monté → avec la pièce essayée (vraie physique). */
  private statsHtml(): string {
    const L = fr();
    const p = loadProgress();
    const base = bikeSetupFor(p.equipped);
    const cur = tunedBikeSetup(base, equippedTune(p));
    const next = tunedBikeSetup(base, this.trial(this.hover ?? this.selected));
    const a = bikeStats(cur.bike, this.s.massKg, this.s.ftpWatts);
    const b = bikeStats(next.bike, this.s.massKg, this.s.ftpWatts);
    const time = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
    const rows: Array<[string, (s: BikeStats) => string, (s: BikeStats) => number, number]> = [
      [L ? 'Poids du vélo' : 'Bike weight', (s) => `${n(s.massKg, 2)} kg`, (s) => s.massKg, -1],
      ['CdA', (s) => `${n(s.cda, 3)} m²`, (s) => s.cda, -1],
      ['Crr', (s) => n(s.crr, 4), (s) => s.crr, -1],
      [L ? 'Rendement transmission' : 'Drivetrain efficiency', (s) => `${n(s.drivetrainEfficiency * 100, 1)} %`, (s) => s.drivetrainEfficiency, 1],
      [L ? 'Plat à la FTP' : 'Flat at FTP', (s) => `${n(s.flatFtpKmh, 1)} km/h`, (s) => s.flatFtpKmh, 1],
      [L ? 'Plat à 75 % FTP' : 'Flat at 75% FTP', (s) => `${n(s.flat75Kmh, 1)} km/h`, (s) => s.flat75Kmh, 1],
      [L ? 'Montée 5 km à 7 %' : 'Climb 5 km at 7%', (s) => time(s.climbS), (s) => s.climbS, -1],
    ];
    const g = tuneGains(base, next.bike);
    const pct = (v: number) => `${v >= 0 ? '+' : '−'}${n(Math.abs(v * 100), 1)} %`;
    const diff = JSON.stringify(cur.bike) !== JSON.stringify(next.bike);
    return `<aside class="mm-panel at-stats">
      <h3>${L ? 'Sur le vélo' : 'On the bike'} <small>${Math.round(this.s.massKg)} kg · ${Math.round(this.s.ftpWatts)} W FTP</small></h3>
      <table>${rows
        .map(([label, f, v, better]) => {
          const d = v(b) - v(a);
          const cls = Math.abs(d) < 1e-9 ? '' : d * better > 0 ? 'up' : 'down';
          return `<tr><th>${label}</th><td>${f(a)}</td>${diff ? `<td class="at-arrow">→</td><td class="${cls}">${f(b)}</td>` : ''}</tr>`;
        })
        .join('')}</table>
      <p class="at-gain">${L ? 'Bonus atelier' : 'Workshop bonus'} : ${L ? 'plat' : 'flat'} <b>${pct(g.flat)}</b> · ${L ? 'côte' : 'climb'} <b>${pct(g.climb)}</b>${next.scale < 1 ? ` <em>${L ? 'plafonné à' : 'capped at'} ${Math.round(TUNE_BONUS_CAP * 100)} %</em>` : ''}</p>
      <p class="at-note">${L ? 'Courses : « Équipement égalisé » met tout le monde sur le même vélo.' : 'Races: “Equal equipment” puts everyone on the same bike.'}</p>
    </aside>`;
  }

  // ————————————————————————————————————————————— Actions

  bind(root: HTMLElement): void {
    const q = <T extends HTMLElement>(sel: string) => root.querySelectorAll<T>(sel);
    // Pièce sélectionnée (p. ex. au retour dans l'atelier) : visible dans la liste.
    root.querySelector('.at-item.sel, .at-kit.sel')?.scrollIntoView({ block: 'nearest' });
    q('[data-atzone]').forEach((el) => {
      const go = () => {
        const id = el.dataset.atzone as string;
        if (id === 'kit' || id === 'event') this.family = id;
        else {
          const z = ZONES.find((x) => x.id === id);
          if (!z) return;
          // La zone déjà ouverte garde son emplacement ; sinon son premier.
          this.slot = z.slots.includes(this.slot) && this.family !== 'kit' && this.family !== 'event' ? this.slot : (z.slots[0] as TuneSlot);
          this.family = familyOfSlot(this.slot);
        }
        this.selected = null;
        this.hover = null;
        this.msg = '';
        this.yaw = 0;
        this.emit(id === 'kit' || id === 'event' ? undefined : SLOT_PARTS[this.slot]);
        this.host.rerender();
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
          e.preventDefault();
          go();
        }
      });
    });
    q('[data-atslot]').forEach((el) =>
      el.addEventListener('click', () => {
        this.slot = el.dataset.atslot as TuneSlot;
        this.family = familyOfSlot(this.slot);
        this.selected = null;
        this.hover = null;
        this.msg = '';
        this.yaw = 0;
        this.emit(SLOT_PARTS[this.slot]);
        this.host.rerender();
      }),
    );
    // Légende de la pastille survolée (sinon la sélectionnée ou la montée).
    const cap = root.querySelector<HTMLElement>('#at-cap');
    const showCap = (chip: HTMLElement | null) => {
      if (!cap) return;
      (cap.querySelector('b') as HTMLElement).textContent = chip?.dataset.capName ?? '';
      (cap.querySelector('span') as HTMLElement).textContent = chip?.dataset.capEffect ?? '';
      (cap.querySelector('em') as HTMLElement).textContent = chip?.dataset.capState ?? '';
      cap.classList.toggle('empty', !chip);
    };
    showCap(root.querySelector<HTMLElement>('.at-chip.sel') ?? root.querySelector<HTMLElement>('.at-chip.on'));
    // Survol : essai immédiat (surbrillance) ; clic : sélection (détail, achat, équipement).
    q('[data-tune]').forEach((el) => {
      const id = el.dataset.tune as string;
      el.addEventListener('pointerenter', () => {
        showCap(el);
        if (this.hover === id) return;
        this.hover = id;
        this.emit(this.pulseOf(id));
        this.refreshStats(root);
      });
      el.addEventListener('pointerleave', () => {
        showCap(root.querySelector<HTMLElement>('.at-chip.sel') ?? root.querySelector<HTMLElement>('.at-chip.on'));
        if (this.hover !== id) return;
        this.hover = null;
        this.emit();
        this.refreshStats(root);
      });
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-atbuy],[data-atkit]')) return;
        // Pièce possédée et pas encore montée : montée directement.
        const t = tuneItem(id);
        const p = loadProgress();
        if (t && t.family !== 'kit' && t.slot && p.owned.includes(id) && p.equipped[t.slot] !== id && equipTune(t, this.s)) {
          this.done(t, fr() ? `${t.name.fr} monté.` : `${t.name.en} fitted.`);
          return;
        }
        this.selected = this.selected === id ? null : id;
        this.msg = '';
        this.emit(this.pulseOf(id));
        this.host.rerender();
      });
    });
    q('[data-atclose]').forEach((el) =>
      el.addEventListener('click', () => {
        this.selected = null;
        this.emit();
        this.host.rerender();
      }),
    );
    q('[data-atequip]').forEach((el) =>
      el.addEventListener('click', () => {
        const t = tuneItem(el.dataset.atequip);
        if (t && equipTune(t, this.s)) this.done(t, fr() ? `${t.name.fr} monté.` : `${t.name.en} fitted.`);
      }),
    );
    q('[data-atoff]').forEach((el) =>
      el.addEventListener('click', () => {
        const slot = el.dataset.atoff as TuneSlot;
        unequipTune(slot, this.s);
        this.selected = null;
        this.host.changed();
        this.emit(SLOT_PARTS[slot]);
        this.host.rerender();
      }),
    );
    q('[data-atbuy]').forEach((el) => el.addEventListener('click', () => void this.buy(el.dataset.atbuy as string)));
    q('[data-atkit]').forEach((el) =>
      el.addEventListener('click', () => {
        const k = tuneItem(el.dataset.atkit);
        if (!k) return;
        const count = equipKit(k, this.s);
        this.done(k, fr() ? `${count} pièce${count > 1 ? 's' : ''} de l’ensemble ${k.name.fr} montée${count > 1 ? 's' : ''}.` : `${count} part${count > 1 ? 's' : ''} of the ${k.name.en} set fitted.`);
      }),
    );
    q('[data-atrider]').forEach((el) =>
      el.addEventListener('click', () => {
        this.rider = el.dataset.atrider === '1';
        this.emit();
        this.host.rerender();
      }),
    );
    root.querySelector('#at-reset')?.addEventListener('click', () => {
      resetTune(this.s);
      this.selected = null;
      this.msg = fr() ? 'Vélo d’origine : toutes les pièces de l’atelier sont démontées.' : 'Stock bike: every workshop part removed.';
      this.host.changed();
      this.emit(['frame', 'rim_decal', 'tire_wall', 'bar_tape']);
      this.host.rerender();
    });
  }

  /** Pièce (ou ensemble) montée : enregistrement, surbrillance, nouveau rendu. */
  private done(t: TuneItem, msg: string): void {
    this.selected = null;
    this.hover = null;
    this.msg = msg;
    this.host.changed();
    this.emit(this.pulseOf(t.id));
    this.host.rerender();
  }

  /** Achat (compte : validé par le serveur ; sinon progression locale), puis montage. */
  private async buy(id: string): Promise<void> {
    const t = tuneItem(id);
    if (!t) return;
    const L = fr();
    let ok = false;
    let missing = 0;
    if (this.host.account()) {
      const r = await buyOnServer(id);
      if (r.ok && r.owned && r.credits !== undefined) applyServerPurchase(r.credits, r.owned);
      ok = r.ok;
      missing = r.missing ?? 0;
      if (!ok && !missing) this.msg = L ? `Achat refusé par le serveur (${r.error ?? 'erreur'}).` : `Purchase refused by the server (${r.error ?? 'error'}).`;
    } else {
      const r = buyLocal(id);
      ok = r.ok;
      missing = r.missing ?? 0;
      if (!ok && !missing) this.msg = L ? 'Achat impossible.' : 'Cannot buy this.';
    }
    if (missing) this.msg = L ? `Il manque ${credits(missing)} crédits : roule encore un peu !` : `${credits(missing)} credits missing: ride a bit more!`;
    if (!ok) return this.host.rerender();
    if (t.family === 'kit') equipKit(t, this.s);
    else equipTune(t, this.s);
    this.done(t, L ? `${t.name.fr} : acheté et monté.` : `${t.name.en}: bought and fitted.`);
  }

  /** Chiffres seulement (survol), sans refaire tout le panneau. */
  private refreshStats(root: HTMLElement): void {
    const old = root.querySelector('.at-stats');
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.statsHtml();
    const fresh = tmp.firstElementChild;
    if (fresh) old.replaceWith(fresh);
  }
}
