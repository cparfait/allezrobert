/**
 * Robert, le guide du tutoriel, qui pédale sur son home trainer au-dessus des barres d'attente : boucle
 * vidéo WebM à fond transparent (tools/robert-trainer, rendue avec HyperFrames), image fixe si la vidéo
 * ne peut pas être lue (navigateur sans WebM transparent, mouvements réduits).
 */
export function waitBike(): HTMLElement {
  const still = '/robert-trainer.png';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const img = document.createElement('img');
    img.className = 'world-wait-bike';
    img.src = still;
    img.alt = '';
    return img;
  }
  const v = document.createElement('video');
  v.className = 'world-wait-bike';
  v.src = '/robert-trainer.webm';
  v.poster = still;
  v.muted = true;
  v.loop = true;
  v.autoplay = true;
  v.playsInline = true;
  v.setAttribute('aria-hidden', 'true');
  v.addEventListener('error', () => v.replaceWith(Object.assign(document.createElement('img'), { className: 'world-wait-bike', src: still, alt: '' })));
  return v;
}
