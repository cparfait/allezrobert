/**
 * Listes déroulantes aux couleurs de l'appli : chaque <select> d'un écran est masqué et remplacé par un
 * bouton et une liste maison (fond sombre, choix surligné en jaune, barre de défilement de l'appli).
 * Le <select> reste dans la page : sa valeur et son événement « change » restent ceux que le code
 * existant lit, la liste ne fait que les piloter. À rappeler après chaque rendu d'écran.
 */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

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

    const close = () => {
      list.hidden = true;
      list.style.cssText = '';
      wrap.appendChild(list);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('scroll', close, true);
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
      list.style.cssText = `position:fixed;z-index:90;left:${r.left}px;width:${r.width}px;max-height:${Math.max(120, Math.min(320, up ? r.top - 16 : below))}px;${up ? `bottom:${innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`}`;
      list.hidden = false;
      list.querySelector('.on')?.scrollIntoView({ block: 'center' });
      document.addEventListener('pointerdown', outside, true);
      // Le défilement de la page ferme la liste, pas celui qu'on provoque pour montrer le choix courant.
      setTimeout(() => !list.hidden && document.addEventListener('scroll', close, true), 200);
    });
    list.addEventListener('click', (e) => {
      const o = (e.target as HTMLElement).closest<HTMLElement>('.mm-dd-opt');
      if (!o) return;
      sel.value = o.dataset.v ?? '';
      sync();
      close();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    wrap.addEventListener('keydown', (e) => e.key === 'Escape' && !list.hidden && (e.stopPropagation(), close()));
    // Le <select> peut être modifié par le code (valeur imposée) : le libellé suit au prochain affichage.
    sel.addEventListener('change', sync);
  });
}
