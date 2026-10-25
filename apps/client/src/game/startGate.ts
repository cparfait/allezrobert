import { bindGear, gearHtml, type GearSource } from './gearList.ts';

export interface StartGateOptions {
  gear: GearSource;
  fr: boolean;
  routeName: string;
  /** Prévenu à chaque changement de l'état du matériel ou du compagnon (le panneau se redessine). */
  watch(cb: () => void): void;
  onStart(): void;
  onLeave(): void;
}

/**
 * Départ à la demande (course sans salle en ligne) : une fois dans la zone, la session n'est lancée
 * que par le bouton. Montre le matériel actif et synchronisé, avec « Reconnecter » au besoin.
 * Renvoie la fonction qui referme la fenêtre.
 */
export function showStartGate(parent: HTMLElement, o: StartGateOptions): () => void {
  const fr = o.fr;
  const el = document.createElement('div');
  el.className = 'mp-overlay';
  parent.appendChild(el);
  const draw = () => {
    el.innerHTML = `<div class="panel mp-modal mp-lobby">
      <h2>${fr ? 'Prêt au départ ?' : 'Ready to start?'}</h2>
      <div class="sub">${fr ? 'Course' : 'Race'} · ${o.routeName.replace(/[<>&]/g, '')}</div>
      ${gearHtml(o.gear, fr)}
      <div class="mp-btns">
        <button class="mp-btn primary" data-act="go">${fr ? 'Lancer la session' : 'Start the session'}</button>
        <button class="mp-btn" data-act="leave">${fr ? 'Quitter' : 'Leave'}</button>
      </div></div>`;
    bindGear(el, o.gear);
    el.querySelector('[data-act="go"]')?.addEventListener('click', () => {
      close();
      o.onStart();
    });
    el.querySelector('[data-act="leave"]')?.addEventListener('click', () => {
      close();
      o.onLeave();
    });
  };
  let closed = false;
  const close = () => {
    closed = true;
    el.remove();
  };
  o.watch(() => !closed && draw());
  draw();
  return close;
}
