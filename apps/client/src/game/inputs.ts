import type { ShiftAction, TrainerCommand } from '@allezrobert/shared';

/** Ce que la boucle de jeu lit chaque image, quel que soit le matériel. */
export interface RideInputs {
  watts: number;
  cadence: number;
  hr?: number;
  balanceLeft?: number;
  teLeft?: number;
  teRight?: number;
  psLeft?: number;
  psRight?: number;
  /** Direction demandée (−1 gauche … +1 droite). */
  steer: number;
}

/** Source d'entrées : capteurs réels (DeviceManager), simulateur, invité au clavier. */
export interface InputSource {
  read(): RideInputs;
  /** Commande envoyée au home trainer (pente simulée, ERG…). */
  sendTrainer(cmd: TrainerCommand): void;
  /** Ventilateur asservi (HEADWIND), 0–100 %. */
  setFan?(percent: number): void;
  onShift(cb: (a: ShiftAction) => void): void;
  /** Alertes matériel à afficher pendant la sortie (Garmin qui pilote le trainer, Assioma…). */
  onWarning?(cb: (message: string) => void): void;
  /** État lisible des appareils pour le HUD. */
  status(): Array<{ label: string; state: 'ok' | 'warn' | 'off' }>;
  dispose(): void;
}

/**
 * Entrées clavier communes à toutes les sources : ↑/↓ vitesses, ←/→ direction,
 * PageUp/PageDown plateau. Les commandes matérielles (Click, Di2…) passent par le DeviceManager.
 */
export class KeyboardControls {
  steer = 0;
  /** Flèches réservées à autre chose (caméra libre) : ni changement de vitesse ni direction. */
  arrowsBlocked: () => boolean = () => false;
  private readonly keys = new Set<string>();
  private readonly listeners: Array<(a: ShiftAction) => void> = [];
  private readonly onDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    this.keys.add(e.key);
    const map: Record<string, ShiftAction> = { ArrowUp: 'up', ArrowDown: 'down', PageUp: 'frontUp', PageDown: 'frontDown' };
    const a = map[e.key];
    if (a && e.key.startsWith('Arrow') && this.arrowsBlocked()) return;
    if (a && !e.repeat) {
      e.preventDefault();
      this.listeners.forEach((l) => l(a));
    }
  };
  private readonly onUp = (e: KeyboardEvent) => this.keys.delete(e.key);

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  onShift(cb: (a: ShiftAction) => void): void {
    this.listeners.push(cb);
  }

  update(dt: number): number {
    const target = this.arrowsBlocked() ? 0 : (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 6);
    // Manette : stick gauche horizontal.
    const pad = navigator.getGamepads?.().find((g) => g);
    if (pad && Math.abs(pad.axes[0] ?? 0) > 0.15) this.steer = pad.axes[0] ?? 0;
    return this.steer;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }
}
