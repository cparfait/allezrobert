import type { ShiftAction, TrainerCommand } from '@allezrobert/shared';
import type { InputSource, RideInputs } from './inputs.ts';

/** Puissance virtuelle maximale d'un invité (W/kg) : il peut attaquer, pas tout écraser. */
export const GUEST_MAX_WKG = 3.5;

/**
 * Invité sans matériel : puissance virtuelle bornée pilotée au clavier (Z / S ou W / S,
 * Maj pour attaquer) ou à la manette (gâchettes). En sortie de groupe, le serveur
 * l'« accroche » au peloton ; il reste hors classements, segments, XP compétitive et FIT.
 */
export class GuestInputSource implements InputSource {
  private readonly massKg: number;
  private wkg = 2.2;
  private attack = false;
  private readonly keys = new Set<string>();
  private readonly onDown = (e: KeyboardEvent) => {
    this.keys.add(e.key.toLowerCase());
    if (e.key === 'Shift') this.attack = true;
  };
  private readonly onUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
    if (e.key === 'Shift') this.attack = false;
  };
  private last = performance.now();

  constructor(massKg: number) {
    this.massKg = massKg;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  read(): RideInputs {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const up = this.keys.has('z') || this.keys.has('w');
    const down = this.keys.has('s');
    const pad = navigator.getGamepads?.().find((g) => g);
    const rt = pad?.buttons[7]?.value ?? 0;
    const lt = pad?.buttons[6]?.value ?? 0;
    this.wkg += ((up ? 1 : 0) - (down ? 1 : 0) + rt - lt) * dt * 0.8;
    this.wkg = Math.min(Math.max(this.wkg, 0), GUEST_MAX_WKG);
    const boost = this.attack || (pad?.buttons[0]?.pressed ?? false) ? 1.25 : 1;
    const watts = Math.min(this.wkg * boost, GUEST_MAX_WKG) * this.massKg;
    return { watts, cadence: watts > 5 ? 86 : 0, steer: 0 };
  }

  sendTrainer(_cmd: TrainerCommand): void {
    // Pas de home trainer : rien à piloter.
  }

  onShift(_cb: (a: ShiftAction) => void): void {
    // Les vitesses ne changent rien pour un invité (puissance virtuelle directe).
  }

  status(): Array<{ label: string; state: 'ok' | 'warn' | 'off' }> {
    return [{ label: `Invité · ${this.wkg.toFixed(1).replace('.', ',')} W/kg (Z/S, Maj = attaque)`, state: 'warn' }];
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }
}
