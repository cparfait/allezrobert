import { bootLabel, bootStep } from '../ui/splash.ts';
import { GRAPHIC_STYLE } from '../engine/style.ts';
import { declinedPacks, formatBytes, installPack, installedPacks, loadCatalogue } from '../world/packs.ts';
import { ROBERT_ISLAND, worldAvailableInStyle } from '../world/worlds.ts';
import { inDesktop, invoke } from './desktop.ts';

/**
 * Zones installées d'office par l'application de bureau, pour pouvoir rouler sans connexion :
 * - Longchamp, la zone du mode en ligne : installée au premier lancement, avant le menu ;
 * - l'Île de Robert : installée ensuite en tâche de fond en mode Poly, sans bloquer le menu.
 * Elles passent par `installPack`, comme une zone téléchargée à la main : même dossier, même état dans
 * Réglages → Zones hors ligne, mêmes mises à jour, même suppression. Une zone supprimée par le joueur n'est pas
 * réinstallée (`declinedPacks`). Rien de tout cela dans un navigateur.
 */
export const DEFAULT_ZONES: ReadonlyArray<{ id: string; name: string; when: 'boot' | 'background'; bytes: number }> = [
  // Tailles de repli (octets) si le catalogue ne les donne pas.
  { id: 'longchamp', name: 'Longchamp', when: 'boot', bytes: 70_000_000 },
  { id: ROBERT_ISLAND, name: 'Île de Robert', when: 'background', bytes: 400_000_000 },
];

/** Place gardée libre après l'installation d'une zone d'office (octets). */
export const DISK_MARGIN_BYTES = 1_000_000_000;

export type DefaultZoneDecision = 'install' | 'not-desktop' | 'installed' | 'declined' | 'offline' | 'disk-full' | 'riding';

export interface DefaultZoneContext {
  desktop: boolean;
  installed: boolean;
  /** Le joueur a supprimé cette zone lui-même. */
  declined: boolean;
  online: boolean;
  /** Place libre sur le disque des données (octets) ; null si elle est inconnue. */
  freeBytes: number | null;
  /** Taille de la zone (octets). */
  bytes: number;
  /** Une sortie est en cours ou en train de se lancer. */
  riding: boolean;
}

/** Faut-il installer cette zone d'office maintenant ? Fonction pure (testée) : la première raison de ne pas le faire l'emporte. */
export function decideDefaultZone(c: DefaultZoneContext): DefaultZoneDecision {
  if (!c.desktop) return 'not-desktop';
  if (c.installed) return 'installed';
  if (c.declined) return 'declined';
  if (c.riding) return 'riding';
  if (!c.online) return 'offline';
  if (c.freeBytes !== null && c.freeBytes < c.bytes + DISK_MARGIN_BYTES) return 'disk-full';
  return 'install';
}

let riding = false;
let background: AbortController | null = null;
let chip: HTMLElement | null = null;

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const autostart = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('autostart');

async function freeBytes(): Promise<number | null> {
  try {
    return (await invoke<{ freeBytes?: number | null }>('storage_info')).freeBytes ?? null;
  } catch {
    return null;
  }
}

async function decide(zone: (typeof DEFAULT_ZONES)[number]): Promise<{ decision: DefaultZoneDecision; bytes: number }> {
  const bytes = (await loadCatalogue())?.zones.find((z) => z.id === zone.id)?.pack?.bytes ?? zone.bytes;
  const base = { desktop: inDesktop, installed: installedPacks().some((p) => p.id === zone.id), declined: declinedPacks().has(zone.id), online: isOnline(), bytes, riding };
  // La place libre n'est demandée que si tout le reste dit d'installer.
  if (decideDefaultZone({ ...base, freeBytes: null }) !== 'install') return { decision: decideDefaultZone({ ...base, freeBytes: null }), bytes };
  return { decision: decideDefaultZone({ ...base, freeBytes: await freeBytes() }), bytes };
}

/**
 * Installe une zone avec un garde-fou : sans aucun octet reçu pendant `stallMs`, l'installation est abandonnée
 * (réseau coupé en route, serveur muet) pour ne pas retenir le démarrage. Le Rust reprend où il s'était arrêté
 * à l'essai suivant.
 */
async function install(id: string, onProgress: (done: number, total: number) => void, signal: AbortSignal, stallMs: number): Promise<void> {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  signal.addEventListener('abort', abort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = -1;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(abort, stallMs);
  };
  arm();
  try {
    await installPack(
      id,
      (done, total) => {
        if (done !== last) {
          last = done;
          arm();
        }
        onProgress(done, total);
      },
      ctl.signal,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/**
 * Démarrage de l'application de bureau, après les ressources du jeu : installe Longchamp si elle manque, avec
 * l'avancement sur l'écran de chargement. Un échec (pas de réseau, disque plein) ne bloque pas : le jeu démarre
 * et l'installation est retentée au lancement suivant.
 */
export async function installBootZones(): Promise<void> {
  if (!inDesktop) return;
  for (const zone of DEFAULT_ZONES.filter((z) => z.when === 'boot')) {
    if (!worldAvailableInStyle(zone.id, GRAPHIC_STYLE)) continue;
    const { decision } = await decide(zone);
    if (decision !== 'install') continue;
    bootStep(18, `Installation de ${zone.name}…`);
    try {
      await install(
        zone.id,
        (done, total) => {
          if (total > 1) bootLabel(`Installation de ${zone.name}… ${Math.round((100 * done) / total)} %`);
        },
        new AbortController().signal,
        20_000,
      );
    } catch (err) {
      console.warn(`Zone ${zone.id} non installée, nouvel essai au prochain lancement`, err);
    }
  }
}

function showChip(text: string | null): void {
  if (typeof document === 'undefined') return;
  if (text === null) {
    chip?.remove();
    chip = null;
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.setAttribute('role', 'status');
    chip.style.cssText =
      'position:fixed;left:16px;bottom:52px;z-index:40;padding:6px 12px;border-radius:999px;background:rgba(10,14,22,.82);border:1px solid rgba(255,255,255,.12);color:#dfe5ec;font:600 12.5px/1.2 system-ui,sans-serif;pointer-events:none';
    document.body.appendChild(chip);
  }
  chip.textContent = text;
}

/**
 * Après l'affichage du menu : installe en tâche de fond les zones d'office restantes (l'Île de Robert), avec une
 * puce discrète en bas à gauche. Interrompue au départ d'une sortie (`pauseBackgroundZones`) et reprise au retour
 * au menu, c'est-à-dire au rechargement de la page ; pas lancée du tout sur un départ direct (`?autostart`).
 */
export async function installBackgroundZones(): Promise<void> {
  if (!inDesktop || background || autostart()) return;
  const fr = typeof document === 'undefined' || document.documentElement.lang !== 'en';
  for (const zone of DEFAULT_ZONES.filter((z) => z.when === 'background')) {
    if (!worldAvailableInStyle(zone.id, GRAPHIC_STYLE)) continue;
    const { decision, bytes } = await decide(zone);
    if (decision !== 'install') {
      if (decision === 'disk-full') console.warn(`Zone ${zone.id} non installée : il faut ${formatBytes(bytes + DISK_MARGIN_BYTES, true)} libres`);
      continue;
    }
    background = new AbortController();
    try {
      await install(
        zone.id,
        (done, total) => {
          if (total > 1) showChip(`${fr ? 'Installation de' : 'Installing'} ${zone.name} : ${Math.round((100 * done) / total)} %`);
        },
        background.signal,
        60_000,
      );
      showChip(fr ? `${zone.name} : prête hors ligne` : `${zone.name}: ready offline`);
      setTimeout(() => showChip(null), 6000);
    } catch (err) {
      showChip(null);
      console.warn(`Zone ${zone.id} : installation interrompue, reprise au prochain retour au menu`, err);
      return;
    } finally {
      background = null;
    }
  }
}

/** Départ d'une sortie : l'installation de fond s'arrête (elle prendrait le réseau et le disque du chargement). */
export function pauseBackgroundZones(): void {
  riding = true;
  background?.abort();
}
