/**
 * Récupération d'une sortie interrompue (game/rideDraft.ts) : au lancement, si une sortie ne s'est pas
 * terminée normalement, un écran en gros blocs propose de l'enregistrer (historique et XP), d'en
 * télécharger le FIT ou de l'effacer. Échap la garde pour le prochain lancement.
 */

import './blocks.css';
import './rideRecovery.css';
import { getLang, strings } from '../i18n/index.ts';
import { loadDraft, pendingDrafts, type DraftStore, type RideDraft } from '../game/rideDraft.ts';

const S = strings(
  {
    title: 'Sortie interrompue',
    sub: 'Ta dernière sortie ne s’est pas terminée normalement. Elle est sauvegardée jusqu’à {time}.',
    km: 'km',
    duration: 'durée',
    watts: 'W moy.',
    simulated: 'Simulateur : hors classements et records',
    ignore: 'Effacer',
    ignoreSure: 'Effacer pour de bon',
    fit: 'Télécharger le FIT',
    save: 'Enregistrer la sortie',
    saving: 'Enregistrement…',
    saved: 'Enregistrée dans l’historique',
    xp: '+{n} XP',
    failed: 'Échec de l’enregistrement : {e}',
    close: 'Fermer',
    later: 'Échap : décider au prochain lancement',
  },
  {
    title: 'Interrupted ride',
    sub: 'Your last ride did not end normally. It is saved up to {time}.',
    km: 'km',
    duration: 'time',
    watts: 'W avg.',
    simulated: 'Simulator: no leaderboards or records',
    ignore: 'Delete',
    ignoreSure: 'Delete for good',
    fit: 'Download FIT',
    save: 'Save the ride',
    saving: 'Saving…',
    saved: 'Saved to your history',
    xp: '+{n} XP',
    failed: 'Could not save: {e}',
    close: 'Close',
    later: 'Esc: decide next time',
  },
);

export interface RecoveryActions {
  /** Enregistre la sortie (historique) et crédite l'XP restante ; renvoie l'XP gagnée. */
  save(draft: RideDraft): Promise<{ xp: number }>;
  /** Télécharge le FIT de la sortie. */
  fit(draft: RideDraft): void;
}

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M6 17l4-8h5l3 8M10 9l-1.5-3H7M15 9l-2 8"/></svg>';

const num = (x: number, digits: number): string => x.toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const clock = (t: number): string => new Date(t).toLocaleString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const duration = (s: number): string => {
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Propose, l'une après l'autre, les sorties interrompues (la plus récente d'abord). */
export async function offerRideRecovery(store: DraftStore, actions: RecoveryActions): Promise<void> {
  let metas;
  try {
    metas = await pendingDrafts(store);
  } catch (e) {
    console.warn('Brouillons de sortie illisibles', e);
    return;
  }
  for (const meta of metas) {
    let draft: RideDraft;
    try {
      draft = await loadDraft(store, meta);
    } catch (e) {
      console.warn('Brouillon de sortie illisible', e);
      continue;
    }
    const keepGoing = await showDraft(store, draft, actions);
    if (!keepGoing) return;
  }
}

/** Affiche un brouillon ; résout `false` si le joueur remet la décision à plus tard. */
function showDraft(store: DraftStore, draft: RideDraft, actions: RecoveryActions): Promise<boolean> {
  return new Promise((resolve) => {
    const watts = draft.records.length ? draft.records.reduce((a, r) => a + (r.watts ?? 0), 0) / draft.records.length : 0;
    const lastT = draft.records.at(-1)?.t ?? draft.savedAt;
    const root = document.createElement('div');
    root.className = 'rr-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'rr-title');
    root.innerHTML = `<div class="rr-card">
      <header><h2 class="ab-title" id="rr-title">${S('title')}</h2><p class="ab-sub">${S('sub').replace('{time}', esc(new Date(lastT).toLocaleTimeString(getLang() === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })))}</p></header>
      <div class="ab-tile is-info rr-tile">
        <span class="ab-ico">${ICON}</span>
        <span class="ab-name">${esc(draft.name)}</span>
        <span class="ab-detail">${esc(clock(draft.startT))}</span>
        <span class="ab-val rr-vals"><span><b>${num(draft.distanceM / 1000, 1)}</b> <small>${S('km')}</small></span><span><b>${duration(draft.elapsedS)}</b> <small>${S('duration')}</small></span>${watts > 0 ? `<span><b>${Math.round(watts)}</b> <small>${S('watts')}</small></span>` : ''}</span>
        ${draft.simulated ? `<span class="ab-state is-warn"><i></i>${S('simulated')}</span>` : ''}
      </div>
      <p class="rr-msg" aria-live="polite"></p>
      <footer class="ab-foot"><span class="rr-later">${S('later')}</span><div class="ab-btns">
        <button type="button" class="ab-btn" data-rr="ignore">${S('ignore')}</button>
        <button type="button" class="ab-btn" data-rr="fit">${S('fit')}</button>
        <button type="button" class="ab-btn ab-go" data-rr="save">${S('save')}</button>
      </div></footer>
    </div>`;
    document.body.appendChild(root);
    const btn = (k: string) => root.querySelector<HTMLButtonElement>(`[data-rr="${k}"]`)!;
    const msg = root.querySelector<HTMLElement>('.rr-msg')!;
    const close = (next: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(next);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close(false);
    };
    document.addEventListener('keydown', onKey, true);
    btn('fit').onclick = () => actions.fit(draft);
    let sure = false;
    btn('ignore').onclick = () => {
      if (!sure) {
        sure = true;
        btn('ignore').textContent = S('ignoreSure');
        btn('ignore').classList.add('rr-danger');
        return;
      }
      void store.remove(draft.startT).finally(() => close(true));
    };
    btn('save').onclick = async () => {
      const save = btn('save');
      save.disabled = true;
      btn('ignore').disabled = true;
      save.textContent = S('saving');
      try {
        const { xp } = await actions.save(draft);
        await store.remove(draft.startT);
        msg.textContent = `${S('saved')}${xp > 0 ? ` · ${S('xp').replace('{n}', String(xp))}` : ''}`;
        msg.classList.add('is-ok');
        btn('ignore').remove();
        save.disabled = false;
        save.textContent = S('close');
        save.onclick = () => close(true);
        save.focus();
      } catch (e) {
        msg.textContent = S('failed').replace('{e}', e instanceof Error ? e.message : String(e));
        save.disabled = false;
        btn('ignore').disabled = false;
        save.textContent = S('save');
      }
    };
    btn('save').focus();
  });
}
