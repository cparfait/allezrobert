/** Petits outils d'affichage : rien n'est réécrit quand rien ne change (l'état arrive 4 fois par seconde, un bouton remplacé sous le doigt perdrait le toucher). */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const $ = (id: string): HTMLElement | null => document.getElementById(id);

const written = new WeakMap<Element, string>();

export function setText(el: Element | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Écrit le HTML d'un conteneur s'il a changé ; vrai s'il a été réécrit. */
export function setHtml(el: Element | null, html: string): boolean {
  if (!el || written.get(el) === html) return false;
  el.innerHTML = html;
  written.set(el, html);
  return true;
}

/** Remplit une case de chiffre : libellé, valeur, unité, couleur ; la taille suit le nombre de caractères. */
export function setNum(el: Element | null, lbl: string, v: string, u: string, color?: string): void {
  if (!el) return;
  setText(el.children[0] ?? null, lbl);
  setText(el.children[1] ?? null, v);
  setText(el.children[2] ?? null, u);
  const st = (el as HTMLElement).style;
  const ch = String(Math.max(3, v.length));
  if (st.getPropertyValue('--ch') !== ch) st.setProperty('--ch', ch);
  if (color) st.setProperty('--zc', color);
  else st.removeProperty('--zc');
}

export const numHtml = (cls = '', attrs = ''): string => `<div class="num ${cls}" ${attrs}><span class="lbl"></span><b class="val"></b><small></small></div>`;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Message en grand sous la barre du haut ; `who` : message d'un joueur, resté plus longtemps, un appui ouvre la réponse. */
export function showToast(text: string, who = ''): void {
  const el = $('toast');
  if (!el) return;
  el.innerHTML = who ? `<b>${esc(who)}</b> ${esc(text)}` : esc(text);
  el.classList.add('on');
  el.classList.toggle('msg', !!who);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), who ? 7000 : 4000);
}

/** Confirmation visible d'un appui : le bouton s'éclaire un instant (pas de vibration sur iPhone). */
export function flash(el: HTMLElement): void {
  el.classList.remove('done');
  void el.offsetWidth;
  el.classList.add('done');
  setTimeout(() => el.classList.remove('done'), 700);
}
