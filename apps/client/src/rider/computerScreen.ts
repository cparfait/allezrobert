import * as THREE from 'three/webgpu';

/** Données affichées sur le compteur du vélo (coureur du joueur). */
export interface ComputerData {
  speedKmh: number;
  watts: number;
  cadence: number;
  hr?: number;
  timeS?: number;
}

/** Écran de compteur dessiné sur un canevas (128 × 176), rafraîchi au plus 4 fois par seconde. */
export class ComputerScreen {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private last = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 176;
    this.ctx = c.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.draw({ speedKmh: 0, watts: 0, cadence: 0 });
  }

  /** Redessine si la dernière image date de plus de 250 ms. */
  set(d: ComputerData): void {
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;
    this.draw(d);
  }

  draw(d: ComputerData): void {
    const g = this.ctx;
    const W = 128;
    g.fillStyle = '#0b0f14';
    g.fillRect(0, 0, W, 176);
    // bandeau de tête et heure de sortie
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, W, 22);
    g.fillStyle = '#0b0f14';
    g.font = 'bold 15px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const t = Math.max(0, Math.round(d.timeS ?? 0));
    g.fillText(`${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, W / 2, 12);
    const cell = (y: number, label: string, value: string, color: string) => {
      g.fillStyle = '#7d8a99';
      g.font = 'bold 11px Arial, sans-serif';
      g.fillText(label, W / 2, y);
      g.fillStyle = color;
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText(value, W / 2, y + 22);
    };
    cell(36, 'KM/H', d.speedKmh.toFixed(1).replace('.', ','), '#ffffff');
    cell(84, 'WATTS', String(Math.round(d.watts)), '#7ee081');
    g.fillStyle = '#26303b';
    g.fillRect(6, 130, W - 12, 1);
    g.font = 'bold 18px Arial, sans-serif';
    g.fillStyle = '#ff7b88';
    g.fillText(d.hr ? `♥${Math.round(d.hr)}` : '♥ --', W * 0.3, 152);
    g.fillStyle = '#5fc8ff';
    g.fillText(`${Math.round(d.cadence)}`, W * 0.75, 152);
    this.texture.needsUpdate = true;
  }
}
