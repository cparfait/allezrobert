import { bootError, bootLabel, bootProgress, bootStep } from '../ui/splash.ts';
import { formatBytes, initPacks } from '../world/packs.ts';
import { DOWNLOADS_BASE, inDesktop, invoke, listen } from './desktop.ts';

/**
 * Démarrage de l'application Windows, avant le jeu : zones présentes sur le disque, puis ressources du jeu
 * (vidéos du menu, modèles, musique, voix, mondes) mises à la version de l'exe. Elles ne sont pas dans
 * l'installateur : seules celles qui ont changé se téléchargent (apps/desktop/src-tauri/src/packs.rs,
 * `media_sync`), le reste est repris du disque. Barre de chargement de 2 à 18 %.
 */

/** Manifeste embarqué dans l'exe (écrit au build par scripts/installerDiet.ts, `media-manifest.json`). */
interface MediaManifest {
  version: string;
  bytes: number;
  files: Array<{ p: string; b: number; h: string }>;
}

/** Fichiers des ressources du jeu (chemins sans « / » initial), connus une fois le manifeste lu. */
let mediaFiles: Set<string> | null = null;

/**
 * Le fichier fait partie des ressources du jeu sur le disque (application Windows construite) ; en
 * développement (serveur Vite, pas de manifeste), tout ce qui est dans public/ est servi : vrai aussi.
 */
export function hasLocalMedia(path: string): boolean {
  return !mediaFiles || mediaFiles.has(path.replace(/^\//, ''));
}

const MENU_LOOP = /^menu\/loop-.*\.(mp4|webm)$/;

/**
 * Boucles vidéo du menu à garder sur le disque : celle de la saison et du style choisis (H.264 et AV1, le codec
 * n'est tranché qu'à la lecture). Les autres (≈ 300 Mo) ne sont plus téléchargées avant le premier écran : le menu
 * les lit depuis le serveur si on change de saison ou de style (`hasLocalMedia` faux), l'image fixe couvrant l'attente.
 */
export function wantedMenuLoops(style: string | null, season: string | null): Set<string> {
  // Style Beta : ses boucles viennent du service V3, aucune de celles du manifeste ne sert.
  if (style === 'v3') return new Set();
  const name = `menu/loop-${style === 'lowpoly' ? 'lowpoly-' : ''}${season ?? 'autumn'}`;
  return new Set([`${name}.mp4`, `${name}.av1.mp4`]);
}

/** Manifeste sans les boucles du menu inutiles ; sa version dépend des boucles gardées (autre saison : nouvelle synchro). */
export function trimMenuLoops(manifest: MediaManifest, keep: ReadonlySet<string>): MediaManifest {
  const files = manifest.files.filter((f) => !MENU_LOOP.test(f.p) || keep.has(f.p));
  if (files.length === manifest.files.length) return manifest;
  const kept = files.filter((f) => MENU_LOOP.test(f.p)).map((f) => f.p.replace(/^menu\/loop-|\.mp4$/g, ''));
  return { ...manifest, version: `${manifest.version}-${kept.join('+') || 'sans-boucle'}`, bytes: files.reduce((n, f) => n + f.b, 0), files };
}

function currentMenuLoops(): Set<string> {
  let style: string | null = null;
  let season: string | null = null;
  try {
    style = new URLSearchParams(location.search).get('style') ?? localStorage.getItem('ar.style');
    season = (JSON.parse(localStorage.getItem('ar.settings') ?? '{}') as { season?: string }).season ?? null;
  } catch {
    // réglages illisibles : boucle par défaut
  }
  return wantedMenuLoops(style, season);
}

export async function prepareDesktop(): Promise<void> {
  if (!inDesktop) return;
  await initPacks();
  const full = await fetch('/media-manifest.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<MediaManifest>) : null))
    .catch(() => null);
  // Développement (serveur Vite) : tout est servi par Vite, rien à télécharger.
  if (!full) return;
  const manifest = trimMenuLoops(full, currentMenuLoops());
  mediaFiles = new Set(manifest.files.map((f) => f.p));
  const status = await invoke<{ ready: boolean; present: boolean; missingBytes: number }>('media_status', { manifest });
  if (status.ready) return;
  bootStep(2, `Téléchargement des ressources du jeu (${formatBytes(status.missingBytes, true)})`);
  const off = await listen<{ id: string; done: number; total: number }>('pack://progress', (p) => {
    if (p.id !== 'media') return;
    bootProgress(2 + (16 * p.done) / Math.max(p.total, 1));
    bootLabel(`Téléchargement des ressources du jeu : ${formatBytes(p.done, true)} sur ${formatBytes(p.total, true)}`);
  });
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await invoke('media_sync', { manifest, baseUrl: DOWNLOADS_BASE });
        return;
      } catch (err) {
        // Ressources d'une version précédente sur le disque : on joue avec, la mise à jour se refera au prochain lancement.
        if (status.present) {
          console.warn('Ressources du jeu non mises à jour', err);
          return;
        }
        bootError(`ressources du jeu non téléchargées (${String(err)}). Nouvel essai dans ${Math.min(60, 5 * attempt)} s…`);
        await new Promise((r) => setTimeout(r, Math.min(60, 5 * attempt) * 1000));
      }
    }
  } finally {
    off();
  }
}
