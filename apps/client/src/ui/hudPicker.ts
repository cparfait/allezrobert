/**
 * Choix du HUD dans les Réglages, avec un aperçu de chaque disposition (maquettes en HTML : pas de rechargement,
 * la disposition choisie est prise en compte à la prochaine sortie).
 */
import './hudPicker.css';
import { getLang } from '../i18n/index.ts';
import { HUD_LAYOUTS, hudChoice, resolveHudLayout, setHudLayout, type HudLayout } from '../hud/hud.ts';

type Choice = 'auto' | HudLayout;

const LABELS: Record<Choice, [string, string, string, string]> = {
  auto: ['Selon le style', 'By style', 'Complet en réaliste, compact en jeu vidéo.', 'Full in realistic, compact in video game.'],
  full: ['Complet', 'Full', 'Compteur en arc et grandes tuiles.', 'Arc gauge and large tiles.'],
  compact: ['Compact', 'Compact', 'Bandeaux serrés, deux fois moins de place.', 'Tight strips, half the space.'],
  facet: ['Facettes', 'Facets', 'Compact en angles coupés et aplats jaunes.', 'Compact with cut corners and yellow blocks.'],
};

/** Maquette d'une disposition : décor de route, compteur, liste des coureurs, profil. */
function mock(layout: HudLayout): string {
  const common = `<i class="hm-road"></i><i class="hm-prof"></i><i class="hm-list"></i>`;
  if (layout === 'full')
    return `<span class="hm hm-full">${common}<i class="hm-arc"><b>210</b></i><i class="hm-tile hm-tl"></i><i class="hm-tile hm-tr"></i><i class="hm-side"></i></span>`;
  return `<span class="hm hm-compact${layout === 'facet' ? ' hm-facet' : ''}">${common}<i class="hm-strip"><b class="hm-spd"></b><b></b><b></b><b></b></i><i class="hm-left"></i></span>`;
}

export function hudPickerHtml(): string {
  const L = getLang() === 'fr';
  const cur = hudChoice();
  const card = (c: Choice) => {
    const [fl, en, fd, ed] = LABELS[c];
    const shown = c === 'auto' ? resolveHudLayout('auto') : c;
    return `<button type="button" class="hp-card${c === cur ? ' on' : ''}" data-hud="${c}" aria-pressed="${c === cur}">${mock(shown)}<b>${L ? fl : en}</b><small>${L ? fd : ed}</small></button>`;
  };
  return `<div class="hp-picker">${(['auto', ...HUD_LAYOUTS] as Choice[]).map(card).join('')}</div>`;
}

/** Branche les cartes : le choix est enregistré tout de suite, `redraw` remet l'écran à jour. */
export function bindHudPicker(root: ParentNode, redraw: () => void): void {
  root.querySelectorAll<HTMLElement>('.hp-picker [data-hud]').forEach((b) =>
    b.addEventListener('click', () => {
      setHudLayout(b.dataset.hud as Choice);
      redraw();
    }),
  );
}
