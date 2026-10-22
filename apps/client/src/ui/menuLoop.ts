import type { Season } from '../world/environment.ts';

/**
 * Film d'accueil : boucle vidéo de la saison (public/menu/loop-<saison>.webm, .mp4 en repli),
 * rendue par tools/menu-loop, posée sur l'image fixe derrière le menu. Elle n'apparaît (fondu)
 * qu'une fois la lecture lancée : fichier absent, format illisible ou mouvement réduit demandé
 * par le système, l'image fixe reste seule.
 */
export class MenuLoop {
  private readonly video: HTMLVideoElement;
  private season: Season | null = null;
  private wanted = false;
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(canvas: HTMLElement) {
    const v = document.createElement('video');
    v.className = 'menu-loop';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    v.setAttribute('aria-hidden', 'true');
    v.addEventListener('playing', () => this.sync());
    canvas.after(v);
    this.video = v;
  }

  /** Boucle de la saison choisie (rechargée seulement si la saison change). */
  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    const v = this.video;
    v.classList.remove('on');
    v.replaceChildren(source(`/menu/loop-${season}.webm`, 'video/webm'), source(`/menu/loop-${season}.mp4`, 'video/mp4'));
    v.load();
    this.sync();
  }

  /** Visible sur l'onglet d'accueil, masquée (et en pause) dans le garage, en exploration et en sortie. */
  show(on: boolean): void {
    this.wanted = on;
    this.sync();
  }

  dispose(): void {
    this.wanted = false;
    this.video.pause();
    this.video.replaceChildren();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }

  private sync(): void {
    const v = this.video;
    const play = this.wanted && !this.still.matches && v.querySelector('source') !== null;
    if (play && v.paused) void v.play().catch(() => undefined);
    if (!play && !v.paused) v.pause();
    v.classList.toggle('on', play && !v.paused && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
  }
}

function source(src: string, type: string): HTMLSourceElement {
  const s = document.createElement('source');
  s.src = src;
  s.type = type;
  return s;
}
