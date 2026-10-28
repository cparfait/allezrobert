import type { ShiftAction, TrainerCommand } from '@allezrobert/shared';
import type { InputSource, RideInputs } from './inputs.ts';

/**
 * Source de développement minimale (sans matériel) : puissance cible réglable au clavier
 * (+ / −), cadence et FC plausibles, balance G/D. Remplacée par le simulateur de
 * `@allezrobert/devices` dès qu'il est branché, et conservée comme repli.
 */
export class DevSimSource implements InputSource {
  target = 210;
  private t = 0;
  private hr = 95;
  private lastGrade = 0;
  private readonly shiftCbs: Array<(a: ShiftAction) => void> = [];
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === '+' || e.key === '=') this.target = Math.min(this.target + 10, 1500);
    if (e.key === '-') this.target = Math.max(this.target - 10, 0);
  };

  constructor() {
    window.addEventListener('keydown', this.onKey);
  }

  read(): RideInputs {
    this.t += 1 / 60;
    const noise = Math.sin(this.t * 2.1) * 6 + Math.sin(this.t * 7.3) * 4 + (Math.random() - 0.5) * 10;
    // Le coureur virtuel pousse un peu plus fort en côte.
    const watts = Math.max(0, this.target * (1 + Math.max(this.lastGrade, 0) * 0.02) + noise);
    const cadence = watts < 5 ? 0 : 88 - Math.max(this.lastGrade, 0) * 2.5 + Math.sin(this.t * 0.7) * 3;
    const hrTarget = 70 + watts * 0.42;
    this.hr += (hrTarget - this.hr) * 0.002;
    return { watts, cadence, hr: this.hr, balanceLeft: 49 + Math.sin(this.t * 0.3) * 1.5, teLeft: 78, teRight: 80, psLeft: 24, psRight: 26, steer: 0, cadenceSimulated: true };
  }

  sendTrainer(cmd: TrainerCommand): void {
    if (cmd.kind === 'simulation') this.lastGrade = cmd.gradePercent;
  }

  onShift(cb: (a: ShiftAction) => void): void {
    this.shiftCbs.push(cb);
  }

  status(): Array<{ label: string; state: 'ok' | 'warn' | 'off' }> {
    return [{ label: `Simulateur · ${this.target} W (+/−)`, state: 'warn' }];
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
  }
}
