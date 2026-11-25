/**
 * Écarts de course en une ligne discrète, en bas au centre au-dessus du profil (idée NCT Ride, avec la moto de
 * l'ardoisier) : « Devant +0:12 · Derrière −0:25 ». Masquée quand la course est groupée.
 */
export class RaceGapsChip {
  private readonly el = document.createElement('div');
  private text = '';

  constructor(parent: HTMLElement = document.body) {
    const st = this.el.style;
    st.cssText =
      'position:fixed;left:50%;bottom:12vh;transform:translateX(-50%);z-index:20;pointer-events:none;padding:4px 12px;border-radius:999px;' +
      'background:rgba(8,12,20,.55);color:rgba(245,247,250,.92);font:600 13px var(--mono, ui-monospace, monospace);letter-spacing:.02em;' +
      'font-variant-numeric:tabular-nums;white-space:nowrap;opacity:0;transition:opacity .6s';
    this.el.setAttribute('aria-live', 'off');
    parent.appendChild(this.el);
  }

  /** `line` : texte (gapsLine) ou null pour masquer. */
  set(line: string | null): void {
    if (line === null) {
      this.el.style.opacity = '0';
      return;
    }
    if (line !== this.text) this.el.textContent = `⏱ ${(this.text = line)}`;
    this.el.style.opacity = '1';
  }

  dispose(): void {
    this.el.remove();
  }
}
