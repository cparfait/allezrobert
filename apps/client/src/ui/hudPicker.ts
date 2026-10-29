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
  const shown = resolveHudLayout(cur);
  const card = (c: Choice) => {
    const [fl, en, fd, ed] = LABELS[c];
    const img = c === 'auto' ? resolveHudLayout('auto') : c;
    return `<button type="button" class="hp-card${c === cur ? ' on' : ''}" data-hud="${c}" data-shot="${shot(img)}" aria-pressed="${c === cur}"><img class="hp-thumb" src="${shot(img)}" alt="" loading="lazy" /><b>${L ? fl : en}</b><small>${L ? fd : ed}</small></button>`;
  };
  return `<div class="hp-picker">${(['auto', ...HUD_LAYOUTS] as Choice[]).map(card).join('')}</div>
    <figure class="hp-big"><img src="${shot(shown)}" alt="${L ? 'Aperçu du HUD choisi' : 'Preview of the chosen HUD'}" /><figcaption>${L ? 'Aperçu en jeu' : 'In-game preview'} · ${L ? LABELS[cur][0] : LABELS[cur][1]}</figcaption></figure>`;
}

/** Branche les cartes : le choix est enregistré tout de suite, `redraw` remet l'écran à jour. */
export function bindHudPicker(root: ParentNode, redraw: () => void): void {
  root.querySelectorAll<HTMLElement>('.hp-picker [data-hud]').forEach((b) =>
    b.addEventListener('click', () => {
      setHudLayout(b.dataset.hud as Choice);
      redraw();
    }),
  );
  // Survol ou focus d'une carte : l'aperçu montre cette disposition, puis revient à celle choisie.
  const big = root.querySelector<HTMLImageElement>('.hp-big img');
  const keep = big?.src;
  root.querySelectorAll<HTMLElement>('.hp-picker [data-shot]').forEach((b) => {
    const show = () => big && (big.src = b.dataset.shot as string);
    const back = () => big && keep && (big.src = keep);
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('pointerleave', back);
    b.addEventListener('blur', back);
  });
}
