/**
 * Commandes tactiles de la sortie (téléphone, tablette) : direction, vitesses, caméra, pause. Les boutons envoient
 * les mêmes touches que le clavier (flèches, C, espace) : rien d'autre à brancher. Affichés seulement sur un écran
 * tactile (pointeur « coarse », ou ?touch=1).
 */
import './touchControls.css';
import { getLang } from '../i18n/index.ts';

export const isTouchDevice = (): boolean => {
  try {
    return matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
  } catch {
    return false;
  }
};

const press = (key: string, down: boolean): void => {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { key, bubbles: true, cancelable: true }));
};

export class TouchControls {
  private readonly el = document.createElement('div');

  constructor(parent: HTMLElement = document.body) {
    const fr = getLang() === 'fr';
    this.el.className = 'tc';
    this.el.innerHTML = `
      <div class="tc-group tc-left">
        <button class="tc-btn tc-hold" data-key="ArrowLeft" aria-label="${fr ? 'À gauche' : 'Left'}">◀</button>
        <button class="tc-btn tc-hold" data-key="ArrowRight" aria-label="${fr ? 'À droite' : 'Right'}">▶</button>
      </div>
      <div class="tc-group tc-right">
        <button class="tc-btn" data-key="ArrowDown" aria-label="${fr ? 'Rapport plus petit' : 'Easier gear'}">−</button>
        <button class="tc-btn" data-key="ArrowUp" aria-label="${fr ? 'Rapport plus grand' : 'Harder gear'}">+</button>
        <button class="tc-btn tc-small" data-key="c" aria-label="${fr ? 'Changer de caméra' : 'Change camera'}">🎥</button>
        <button class="tc-btn tc-small" data-key=" " aria-label="Pause">⏸</button>
      </div>`;
    parent.appendChild(this.el);
    this.el.querySelectorAll<HTMLButtonElement>('.tc-btn').forEach((b) => {
      const key = b.dataset.key as string;
      const hold = b.classList.contains('tc-hold');
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        press(key, true);
        if (!hold) press(key, false);
      });
      const up = () => {
        b.classList.remove('on');
        if (hold) press(key, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
  }

  dispose(): void {
    this.el.remove();
  }
}
