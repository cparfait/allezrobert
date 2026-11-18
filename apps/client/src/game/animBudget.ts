/**
 * Budget d'animation des coureurs IA (inspiré de l'AnimationBudgetAllocator de MyWhoosh, étude de rendu du
 * 17/11/2026) : les coureurs proches sont animés à chaque image, les plus lointains une image sur 2, 3 ou 4,
 * avec le temps accumulé entre deux mises à jour. À plus de 40 m, un coureur occupe quelques dizaines de
 * pixels : le pédalage à 15–30 images/s ne se voit pas, et le squelette n'est plus recalculé à chaque image.
 */

/** ?animbudget=0 : toutes les animations à chaque image (comparaison). */
const ENABLED = typeof location !== 'undefined' && new URLSearchParams(location.search).get('animbudget') !== '0';

/** Une image sur N selon la distance à la caméra (m). */
export function animStride(distM: number, enabled = ENABLED): number {
  if (!enabled || distM < 40) return 1;
  if (distM < 90) return 2;
  if (distM < 160) return 3;
  return 4;
}

/** Accumulateur par coureur : renvoie le pas de temps à appliquer, ou 0 si l'animation saute cette image. */
export class AnimBudget {
  private acc = 0;
  private frames = 0;
  /** Décalage propre au coureur, pour que les coureurs lointains ne se mettent pas tous à jour la même image. */
  constructor(private readonly phase = 0) {}

  step(dt: number, distM: number, frame: number, enabled = ENABLED): number {
    this.acc += dt;
    this.frames++;
    const stride = animStride(distM, enabled);
    // Mise à jour si le pas est atteint pour ce coureur, ou si du temps s'est trop accumulé (changement de pas).
    if (stride > 1 && (frame + this.phase) % stride !== 0 && this.frames < stride) return 0;
    const out = this.acc;
    this.acc = 0;
    this.frames = 0;
    return out;
  }
}
