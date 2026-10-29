/**
 * Listes déroulantes aux couleurs de l'appli : chaque <select> d'un écran est masqué et remplacé par un
 * bouton et une liste maison (fond sombre, choix surligné en jaune, barre de défilement de l'appli).
 * Le <select> reste dans la page : sa valeur et son événement « change » restent ceux que le code
 * existant lit, la liste ne fait que les piloter. À rappeler après chaque rendu d'écran.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const plain = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Saisie au clavier dans une liste ouverte : les premières lettres tapées (réinitialisées après 0,8 s) amènent
 * le premier choix qui commence ainsi ; flèches pour parcourir, Entrée pour valider. Les touches prises ici
 * n'atteignent pas le reste de l'écran (raccourcis, tutoriel). `pick` reçoit le choix validé.
 */
export function listKeys(list: HTMLElement, optSelector: string, pick: (o: HTMLElement) => void): (e: KeyboardEvent) => void {
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hl: HTMLElement | null = null;
  const opts = () => [...list.querySelectorAll<HTMLElement>(optSelector)];
  const mark = (o: HTMLElement | null | undefined) => {
    if (!o) return;
    hl?.classList.remove('hl');
    hl = o;
    o.classList.add('hl');
    o.scrollIntoView({ block: 'nearest' });
  };
  return (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const all = opts();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const i = hl ? all.indexOf(hl) : all.findIndex((o) => o.classList.contains('on'));
      mark(all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]);
    } else if (e.key === 'Enter' && hl) pick(hl);
    else if (e.key.length === 1 && e.key !== ' ') {
      buf += plain(e.key);
      clearTimeout(timer);
      timer = setTimeout(() => (buf = ''), 800);
      mark(all.find((o) => plain(o.textContent ?? '').startsWith(buf)) ?? all.find((o) => plain(o.textContent ?? '').includes(buf)));
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
}

export function enhanceSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>('select:not([data-dd])').forEach((sel) => {
    sel.dataset.dd = '1';
    sel.style.display = 'none';
    const wrap = document.createElement('div');
    wrap.className = 'mm-dd';
    wrap.innerHTML = `<button type="button" class="mm-dd-btn" aria-haspopup="listbox"><span></span><em>▾</em></button><div class="mm-dd-list" role="listbox" hidden></div>`;
    sel.after(wrap);
    const btn = wrap.querySelector('.mm-dd-btn') as HTMLButtonElement;
    const label = btn.querySelector('span') as HTMLElement;
    const list = wrap.querySelector('.mm-dd-list') as HTMLElement;
    const sync = () => {
      label.textContent = sel.selectedOptions[0]?.textContent ?? '';
      list.querySelectorAll<HTMLElement>('.mm-dd-opt').forEach((o) => o.classList.toggle('on', o.dataset.v === sel.value));
    };
    list.innerHTML = [...sel.options].map((o) => `<button type="button" role="option" class="mm-dd-opt" data-v="${esc(o.value)}"><span>${esc(o.textContent ?? '')}</span></button>`).join('');
    sync();

    const choose = (o: HTMLElement) => {
      sel.value = o.dataset.v ?? '';
      sync();
      close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const onKey = listKeys(list, '.mm-dd-opt', choose);
    // Le défilement de la liste elle-même ne la ferme pas (seul celui de la page).
    const onScroll = (e: Event) => {
      if (!list.contains(e.target as Node)) close();
    };
    const close = () => {
      list.hidden = true;
      list.style.cssText = '';
      list.querySelector('.hl')?.classList.remove('hl');
      wrap.appendChild(list);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const outside = (e: Event) => {
      if (!wrap.contains(e.target as Node) && !list.contains(e.target as Node)) close();
    };
    btn.addEventListener('click', () => {
      if (!list.hidden) return close();
      // Posée sur la page (le flou du panneau rognerait une liste restée dedans), juste sous le champ.
      const r = btn.getBoundingClientRect();
      const below = innerHeight - r.bottom - 16;
      const up = below < 160 && r.top > below;
      document.body.appendChild(list);
      list.style.cssText = `position:fixed;z-index:9999;left:${r.left}px;width:${r.width}px;max-height:${Math.max(120, Math.min(320, up ? r.top - 16 : below))}px;${up ? `bottom:${innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`}`;
      list.hidden = false;
      list.querySelector('.on')?.scrollIntoView({ block: 'center' });
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
      // Le défilement de la page ferme la liste, pas celui qu'on provoque pour montrer le choix courant.
      setTimeout(() => !list.hidden && document.addEventListener('scroll', onScroll, true), 200);
    });
    list.addEventListener('click', (e) => {
      const o = (e.target as HTMLElement).closest<HTMLElement>('.mm-dd-opt');
      if (!o) return;
      choose(o);
    });
    wrap.addEventListener('keydown', (e) => e.key === 'Escape' && !list.hidden && (e.stopPropagation(), close()));
    // Le <select> peut être modifié par le code (valeur imposée) : le libellé suit au prochain affichage.
    sel.addEventListener('change', sync);
  });
}

let watching = false;

/**
 * Remplace aussi les <select> ajoutés après coup (listes remplies une fois les appareils lus, panneaux
 * dessinés à la demande) : sans cela, ils gardent la liste blanche du navigateur. À appeler une fois au démarrage.
 */
export function autoEnhanceSelects(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  let queued = false;
  const run = () => {
    queued = false;
    enhanceSelects(document);
  };
  new MutationObserver((muts) => {
    if (queued || !muts.some((m) => [...m.addedNodes].some((n) => n instanceof Element && (n.matches('select') || n.querySelector('select'))))) return;
    queued = true;
    queueMicrotask(run);
  }).observe(document.body, { childList: true, subtree: true });
}
