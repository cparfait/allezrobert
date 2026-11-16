import { listKeys } from '../ui/dropdown.ts';

const valueOf = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
const indexOf = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex')!;

/**
 * Liste déroulante aux couleurs de l'appli (mêmes classes que ui/dropdown.ts : fond sombre, choix surligné en
 * jaune) pour les <select> du garage V3, dont les choix changent après coup (coloris de l'article, types de vélos,
 * postures des clips) : la liste est refaite à chaque ouverture, le libellé suit la valeur, même imposée par le code.
 * Le <select> reste dans la page, masqué : sa valeur et son événement « change » restent ceux que le code lit.
 */
export function v3Select(sel: HTMLSelectElement): HTMLSelectElement {
  sel.dataset.dd = 'v3';
  sel.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'mm-dd v3-dd';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mm-dd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  const label = document.createElement('span');
  const arrow = document.createElement('em');
  arrow.textContent = '▾';
  btn.append(label, arrow);
  const list = document.createElement('div');
  list.className = 'mm-dd-list v3-dd-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(btn, list);
  sel.after(wrap);
  const aria = sel.getAttribute('aria-label');
  if (aria) btn.setAttribute('aria-label', aria);

  const sync = () => {
    label.textContent = sel.selectedOptions[0]?.textContent ?? '';
    btn.disabled = sel.disabled;
    list.querySelectorAll<HTMLElement>('.mm-dd-opt').forEach(o => o.classList.toggle('on', o.dataset.v === sel.value));
  };
  // Valeur imposée par le code (sel.value = …, sans événement) : le libellé suit.
  Object.defineProperty(sel, 'value', { configurable: true, get: () => valueOf.get!.call(sel), set: (v: string) => { valueOf.set!.call(sel, v); sync(); } });
  Object.defineProperty(sel, 'selectedIndex', { configurable: true, get: () => indexOf.get!.call(sel), set: (v: number) => { indexOf.set!.call(sel, v); sync(); } });
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', sync);

  const build = () => {
    const rows: HTMLElement[] = [];
    for (const child of sel.children) {
      const options = child instanceof HTMLOptGroupElement ? [...child.children] : [child];
      if (child instanceof HTMLOptGroupElement) {
        const head = document.createElement('div');
        head.className = 'v3-dd-group';
        head.textContent = child.label;
        rows.push(head);
      }
      for (const option of options) {
        if (!(option instanceof HTMLOptionElement)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'option');
        button.className = 'mm-dd-opt';
        button.dataset.v = option.value;
        button.disabled = option.disabled;
        const text = document.createElement('span');
        text.textContent = option.textContent ?? '';
        button.append(text);
        rows.push(button);
      }
    }
    list.replaceChildren(...rows);
    sync();
  };
  const choose = (o: HTMLElement) => {
    valueOf.set!.call(sel, o.dataset.v ?? '');
    sync();
    close();
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const onKey = listKeys(list, '.mm-dd-opt', choose);
  const onScroll = (e: Event) => { if (!list.contains(e.target as Node)) close(); };
  const outside = (e: Event) => { if (!wrap.contains(e.target as Node) && !list.contains(e.target as Node)) close(); };
  function close(): void {
    list.hidden = true;
    list.style.cssText = '';
    wrap.appendChild(list);
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onKey, true);
  }
  btn.addEventListener('click', () => {
    if (!list.hidden) return close();
    build();
    // Posée sur la page (le flou du panneau rognerait une liste restée dedans), sous le champ ou au-dessus.
    const r = btn.getBoundingClientRect();
    const below = innerHeight - r.bottom - 16;
    const up = below < 160 && r.top > below;
    document.body.appendChild(list);
    list.style.cssText = `position:fixed;z-index:9999;left:${r.left}px;width:${Math.max(r.width, 180)}px;max-height:${Math.max(120, Math.min(340, up ? r.top - 16 : below))}px;${up ? `bottom:${innerHeight - r.top + 6}px` : `top:${r.bottom + 6}px`}`;
    list.hidden = false;
    list.querySelector('.on')?.scrollIntoView({ block: 'center' });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => { if (!list.hidden) document.addEventListener('scroll', onScroll, true); }, 200);
  });
  list.addEventListener('click', e => {
    const o = (e.target as HTMLElement).closest<HTMLElement>('.mm-dd-opt');
    if (o && !(o as HTMLButtonElement).disabled) choose(o);
  });
  wrap.addEventListener('keydown', e => { if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); } });
  build();
  return sel;
}
