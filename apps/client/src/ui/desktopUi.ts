import './desktopUi.css';
import { getLang } from '../i18n/index.ts';
import { inDesktop, invoke, listen, revealPath } from '../platform/desktop.ts';
import { formatBytes } from '../world/packs.ts';

/**
 * Écrans propres à l'application Windows : mise à jour disponible, dossier des données (Réglages › Zones et
 * cartes), fichier exporté enregistré. Rien de tout cela ne s'affiche dans un navigateur.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const fr = () => getLang() === 'fr';

/** Bandeau en bas de l'écran (un seul à la fois), retiré après `ms` (0 : reste affiché). */
function notice(html: string, ms: number): HTMLElement {
  document.querySelector('.ar-desk-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'ar-desk-notice';
  el.innerHTML = html;
  document.body.appendChild(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}

/** Après l'enregistrement d'une sortie ou d'une capture : où est le fichier, et un bouton pour l'ouvrir. */
export function exportSaved(path: string): void {
  const L = fr();
  const el = notice(`<span>${L ? 'Enregistré' : 'Saved'} : <code>${esc(path)}</code></span><button class="btn small">${L ? 'Afficher' : 'Show'}</button>`, 8000);
  el.querySelector('button')?.addEventListener('click', () => revealPath(path));
}

interface UpdateInfo {
  version: string;
  current: string;
  notes?: string;
}

/** Cherche une nouvelle version de l'application (une fois par lancement) et propose de l'installer. */
export async function offerDesktopUpdate(): Promise<void> {
  if (!inDesktop || import.meta.env.DEV) return;
  const info = await invoke<UpdateInfo | null>('update_check').catch((e) => {
    console.info('Recherche de mise à jour impossible', e);
    return null;
  });
  if (!info) return;
  const L = fr();
  const el = notice(
    `<span><b>${L ? 'Nouvelle version' : 'New version'} ${esc(info.version)}</b> · ${L ? 'tu as la' : 'you have'} ${esc(info.current)}</span>
     <button class="btn small primary" data-up-go>${L ? 'Installer et redémarrer' : 'Install and restart'}</button><button class="btn small" data-up-later>${L ? 'Plus tard' : 'Later'}</button>`,
    0,
  );
  el.querySelector('[data-up-later]')?.addEventListener('click', () => el.remove());
  el.querySelector('[data-up-go]')?.addEventListener('click', () => {
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    const label = el.querySelector('span') as HTMLElement;
    label.textContent = L ? 'Téléchargement de la mise à jour…' : 'Downloading the update…';
    void listen<{ done: number; total?: number }>('update://progress', (p) => {
      label.textContent = `${L ? 'Téléchargement' : 'Downloading'} ${p.total ? `${Math.floor((p.done / p.total) * 100)} %` : formatBytes(p.done, L)}`;
    }).then((off) =>
      invoke('update_install').catch((err) => {
        off();
        label.textContent = `${L ? 'Mise à jour impossible' : 'Update failed'} : ${String(err)}`;
        el.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }),
    );
  });
}

interface StorageInfo {
  dataDir: string;
  defaultDir: boolean;
  freeBytes?: number;
  totalBytes?: number;
  worldsBytes: number;
  mediaBytes: number;
}

let lastInfo: { at: number; info: Promise<StorageInfo | null> } | null = null;

/** Emplacement du bloc « Dossier des données » dans Réglages › Zones et cartes (vide dans un navigateur). */
export function storagePanelHtml(): string {
  return inDesktop ? '<div class="zs-store" data-zs-store></div>' : '';
}

/** Remplit le bloc « Dossier des données » : chemin, place occupée et libre, ouvrir, changer de dossier. */
export async function fillStoragePanel(root: HTMLElement, onMoved: () => void): Promise<void> {
  const el = root.querySelector<HTMLElement>('[data-zs-store]');
  if (!el) return;
  // La liste des zones se redessine souvent (progression) : le dossier n'est parcouru qu'une fois toutes les 5 s.
  if (!lastInfo || performance.now() - lastInfo.at > 5000) lastInfo = { at: performance.now(), info: invoke<StorageInfo>('storage_info').catch(() => null) };
  const info = await lastInfo.info;
  if (!info) {
    el.remove();
    return;
  }
  const L = fr();
  const size = (b: number | undefined) => (b === undefined ? '?' : formatBytes(b, L));
  el.innerHTML = `<div class="zs-store-head"><b>${L ? 'Dossier des données' : 'Data folder'}</b><code title="${esc(info.dataDir)}">${esc(info.dataDir)}</code></div>
    <div class="zs-store-space">${L ? 'Zones' : 'Areas'} <b>${size(info.worldsBytes)}</b> · ${L ? 'ressources du jeu' : 'game resources'} <b>${size(info.mediaBytes)}</b> · ${L ? 'libre sur ce disque' : 'free on this disk'} <b>${size(info.freeBytes)}</b></div>
    <div class="zs-store-act"><button class="btn small" data-zs-open>${L ? 'Ouvrir le dossier' : 'Open folder'}</button><button class="btn small" data-zs-move>${L ? 'Changer de dossier…' : 'Change folder…'}</button></div>`;
  el.querySelector('[data-zs-open]')?.addEventListener('click', () => void invoke('storage_open_dir').catch(() => undefined));
  el.querySelector('[data-zs-move]')?.addEventListener('click', () => void moveData(el, info, onMoved));
}

async function moveData(el: HTMLElement, info: StorageInfo, onMoved: () => void): Promise<void> {
  const L = fr();
  const target = await invoke<string | null>('storage_pick_dir').catch(() => null);
  if (!target || target === info.dataDir) return;
  const amount = formatBytes(info.worldsBytes + info.mediaBytes, L);
  if (!confirm(L ? `Déplacer les zones et les ressources du jeu (${amount}) vers ${target} ?` : `Move areas and game resources (${amount}) to ${target}?`)) return;
  el.querySelectorAll('button').forEach((b) => (b.disabled = true));
  const space = el.querySelector('.zs-store-space') as HTMLElement;
  space.textContent = L ? 'Déplacement…' : 'Moving…';
  const off = await listen<{ done: number; total: number }>('storage://progress', (p) => {
    space.textContent = `${L ? 'Déplacement' : 'Moving'} ${Math.floor((p.done / Math.max(p.total, 1)) * 100)} %`;
  });
  try {
    await invoke<string>('storage_move', { target });
  } catch (err) {
    alert(`${L ? 'Déplacement impossible' : 'Move failed'} : ${String(err)}`);
  } finally {
    off();
  }
  lastInfo = null;
  onMoved();
}
