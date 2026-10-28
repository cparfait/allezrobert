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

export async function prepareDesktop(): Promise<void> {
  if (!inDesktop) return;
  await initPacks();
  const manifest = await fetch('/media-manifest.json')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<MediaManifest>) : null))
    .catch(() => null);
  // Développement (serveur Vite) : tout est servi par Vite, rien à télécharger.
  if (!manifest) return;
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
