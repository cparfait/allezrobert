import { COSMETICS, levelProgress, xpForRide, type CosmeticItem, type CosmeticSlot } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';
import { saveSettings, type Settings } from './settings.ts';

/** Progression locale (synchronisée avec le serveur une fois connecté). */
interface Progress {
  xp: number;
  equipped: Partial<Record<CosmeticSlot, string>>;
}

const KEY = 'ar.progress';

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { xp: 0, equipped: {}, ...(JSON.parse(raw) as Partial<Progress>) };
  } catch {
    // Progression illisible : on repart de zéro plutôt que de bloquer le jeu.
  }
  return { xp: 0, equipped: {} };
}

function saveProgress(p: Progress): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** Crédite l'XP d'une sortie ; renvoie le gain, le niveau et les nouveaux déblocages. */
export function awardRide(ride: { distanceM: number; elevationM: number; movingS: number }): { gained: number; level: number; levelUp: boolean; unlocked: CosmeticItem[] } {
  const p = loadProgress();
  const before = levelProgress(p.xp).level;
  const gained = xpForRide(ride);
  p.xp += gained;
  saveProgress(p);
  const after = levelProgress(p.xp).level;
  return { gained, level: after, levelUp: after > before, unlocked: COSMETICS.filter((c) => c.level > before && c.level <= after) };
}

const SLOT_LABEL: Record<CosmeticSlot, { fr: string; en: string }> = {
  jersey: { fr: 'Maillots', en: 'Jerseys' },
  helmet: { fr: 'Casques', en: 'Helmets' },
  bike: { fr: 'Vélos', en: 'Bikes' },
  socks: { fr: 'Chaussettes', en: 'Socks' },
  glasses: { fr: 'Lunettes', en: 'Glasses' },
  wheels: { fr: 'Roues', en: 'Wheels' },
};

/** Garage : niveau, barre d'XP, cosmétiques débloqués à équiper (verrouillés grisés). */
export function showGarage(root: HTMLElement, s: Settings, onClose: () => void): void {
  const lang = getLang();
  const render = () => {
    const p = loadProgress();
    const lp = levelProgress(p.xp);
    const slots = [...new Set(COSMETICS.map((c) => c.slot))];
    root.innerHTML = `<div class="menu"><div class="card panel">
      <h1>Garage</h1>
      <div class="row" style="gap:18px;margin:10px 0 18px"><div class="num" style="font-size:40px;font-weight:800;color:var(--ar-accent)">${lang === 'fr' ? 'Niveau' : 'Level'} ${lp.level}</div>
        <div style="flex:1"><div class="meta num" style="color:var(--ar-muted)">${p.xp} XP${lp.nextLevelXp ? ` / ${lp.nextLevelXp}` : ''}</div>
        <div style="height:10px;background:rgba(255,255,255,.12);border-radius:5px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${(lp.progress * 100).toFixed(1)}%;background:var(--ar-accent)"></div></div></div></div>
      ${slots
        .map(
          (slot) => `<h2>${SLOT_LABEL[slot][lang]}</h2><div class="row">${COSMETICS.filter((c) => c.slot === slot)
            .map((c) => {
              const locked = c.level > lp.level;
              const on = p.equipped[slot] === c.id;
              return `<button class="btn small" data-item="${c.id}" ${locked ? 'disabled' : ''} style="opacity:${locked ? 0.4 : 1};border:2px solid ${on ? 'var(--ar-accent)' : 'transparent'}">
                <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.color ?? '#888'};vertical-align:-2px;margin-right:6px"></span>${c.name[lang]}${locked ? ` · 🔒 ${c.level}` : ''}</button>`;
            })
            .join('')}</div>`,
        )
        .join('')}
      <div class="row" style="justify-content:flex-end;margin-top:22px"><button class="btn primary" id="g-close">OK</button></div>
    </div></div>`;
    root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((b) =>
      b.addEventListener('click', () => {
        const item = COSMETICS.find((c) => c.id === b.dataset.item);
        if (!item) return;
        const pr = loadProgress();
        pr.equipped[item.slot] = item.id;
        saveProgress(pr);
        // Les cosmétiques à couleur s'appliquent à l'avatar (le rendu reste maître).
        if (item.color) {
          if (item.slot === 'jersey') s.look = { ...s.look, jersey: item.color };
          if (item.slot === 'helmet') s.look = { ...s.look, helmet: item.color };
          if (item.slot === 'bike') s.look = { ...s.look, bike: item.color };
        }
        saveSettings(s);
        render();
      }),
    );
    (root.querySelector('#g-close') as HTMLElement).onclick = onClose;
  };
  render();
}
