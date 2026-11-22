/**
 * Choix du HUD dans les Réglages, avec un aperçu de chaque disposition (maquettes en HTML : pas de rechargement,
 * la disposition choisie est prise en compte à la prochaine sortie).
 */
import './blocks.css';
import './hudPicker.css';
import { strings } from '../i18n/index.ts';
import { HUD_LAYOUTS, hudChoice, resolveHudLayout, setHudLayout, type HudLayout } from '../hud/hud.ts';

type Choice = 'auto' | HudLayout;

const S = strings(
  {
    auto: 'Selon le style',
    autoDetail: 'Complet en réaliste, compact en jeu vidéo.',
    full: 'Complet',
    fullDetail: 'Compteur en arc et grandes tuiles.',
    compact: 'Compact',
    compactDetail: 'Bandeaux serrés, deux fois moins de place.',
    facet: 'Facettes',
    facetDetail: 'Compact en angles coupés et aplats jaunes.',
    chosen: 'Choisi',
  },
  {
    auto: 'By style',
    autoDetail: 'Full in realistic, compact in video game.',
    full: 'Full',
    fullDetail: 'Arc gauge and large tiles.',
    compact: 'Compact',
    compactDetail: 'Tight strips, half the space.',
    facet: 'Facets',
    facetDetail: 'Compact with cut corners and yellow blocks.',
    chosen: 'Chosen',
  },
);

/** Capture réelle d'une disposition (public/hud/<disposition>.jpg), prise en jeu. */
const shot = (layout: HudLayout): string => `/hud/${layout}.jpg`;

export function hudPickerHtml(): string {
  const cur = hudChoice();
  // Un bloc par disposition (nom en gras, détail d'une ligne) ; celle choisie porte la bordure jaune et son état écrit.
  const card = (c: Choice) => {
    const img = c === 'auto' ? resolveHudLayout('auto') : c;
    const on = c === cur;
    return `<button type="button" role="radio" class="ab-tile ab-plain hp-card${on ? ' on is-on' : ''}" data-hud="${c}" data-shot="${shot(img)}" aria-checked="${on}">
      <span class="ab-name">${S(c)}</span><span class="ab-detail">${S(`${c}Detail` as const)}</span>${on ? `<span class="ab-state is-ok"><i></i>${S('chosen')}</span>` : ''}</button>`;
  };
  // Aperçu : caché, il n'apparaît qu'au survol (ou au focus clavier) d'un bloc.
  return `<div class="hp-picker ab-grid ab-grid-2" role="radiogroup">${(['auto', ...HUD_LAYOUTS] as Choice[]).map(card).join('')}</div>`;
}
/** Branche les cartes : le choix est enregistré tout de suite, `redraw` remet l'écran à jour. */
export function bindHudPicker(root: ParentNode, redraw: () => void): void {
  root.querySelectorAll<HTMLElement>('.hp-picker [data-hud]').forEach((b) =>
    b.addEventListener('click', () => {
      setHudLayout(b.dataset.hud as Choice);
      redraw();
    }),
  );
  // Survol ou focus d'un nom : l'aperçu en jeu de cette disposition apparaît au centre de l'écran (posé sur la page,
  // hors du panneau qui le rognerait), puis disparaît.
  let pop: HTMLImageElement | null = null;
  const hide = () => {
    pop?.remove();
    pop = null;
  };
  root.querySelectorAll<HTMLElement>('.hp-picker [data-shot]').forEach((b) => {
    const show = () => {
      hide();
      pop = document.createElement('img');
      pop.className = 'hp-pop';
      pop.alt = '';
      pop.src = b.dataset.shot as string;
      document.body.appendChild(pop);
    };
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', show);
    b.addEventListener('pointerleave', hide);
    b.addEventListener('blur', hide);
    b.addEventListener('click', hide);
  });
}
