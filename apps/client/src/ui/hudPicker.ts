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

/** Capture réelle d'une disposition (public/hud/<disposition>.jpg), prise en jeu. */
const shot = (layout: HudLayout): string => `/hud/${layout}.jpg`;

export function hudPickerHtml(): string {
  const L = getLang() === 'fr';
  const cur = hudChoice();
  const card = (c: Choice) => {
    const [fl, en] = LABELS[c];
    const img = c === 'auto' ? resolveHudLayout('auto') : c;
    return `<button type="button" class="hp-card${c === cur ? ' on' : ''}" data-hud="${c}" data-shot="${shot(img)}" aria-pressed="${c === cur}">${L ? fl : en}</button>`;
  };
  // Aperçu : caché, il n'apparaît qu'au survol (ou au focus clavier) d'un nom.
  return `<div class="hp-picker">${(['auto', ...HUD_LAYOUTS] as Choice[]).map(card).join('')}</div><img class="hp-pop" alt="" hidden />`;
}

/** Branche les cartes : le choix est enregistré tout de suite, `redraw` remet l'écran à jour. */
export function bindHudPicker(root: ParentNode, redraw: () => void): void {
  root.querySelectorAll<HTMLElement>('.hp-picker [data-hud]').forEach((b) =>
    b.addEventListener('click', () => {
      setHudLayout(b.dataset.hud as Choice);
      redraw();
    }),
  );
  // Survol ou focus d'un nom : l'aperçu en jeu de cette disposition apparaît, il disparaît ensuite.
  const pop = root.querySelector<HTMLImageElement>('.hp-pop');
  root.querySelectorAll<HTMLElement>('.hp-picker [data-shot]').forEach((b) => {
    const show = () => {
      if (!pop) return;
      pop.src = b.dataset.shot as string;
      pop.hidden = false;
    };
    const hide = () => pop && (pop.hidden = true);
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('pointerleave', hide);
    b.addEventListener('blur', hide);
  });
}
