import type * as THREE from 'three/webgpu';
import type { Engine } from './renderer.ts';

/** ?perf=1 ouvre le panneau dès le départ et active les mesures GPU (nécessite le démarrage avec ce paramètre). */
export function perfRequested(): boolean {
  try {
    return new URLSearchParams(location.search).has('perf');
  } catch {
    return false;
  }
}

const WINDOW = 180;

/** Objets dessinables visibles sous `root` (un appel de dessin chacun, plus un par cascade d'ombres s'ils en projettent). */
function countDrawables(root: THREE.Object3D): { meshes: number; casters: number } {
  let meshes = 0;
  let casters = 0;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) {
      meshes++;
      if (o.castShadow) casters++;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return { meshes, casters };
}

/**
 * Panneau de performance (F3) : cadence, temps d'image moyen / 95e centile / pire, temps GPU (avec ?perf=1),
 * appels de dessin, triangles, taille de rendu. Alt+1 / Alt+2 / Alt+3 coupent ou rétablissent l'AO, le bloom
 * et le TAA à chaud : l'écart de temps d'image donne le coût de chaque effet sur la machine.
 * Inactif (aucune mesure, aucun nœud DOM) tant qu'il n'est pas affiché.
 */
export class PerfOverlay {
  private el: HTMLElement | null = null;
  private visible = false;
  private readonly samples: number[] = [];
  private readonly cpu: number[] = [];
  private sinceDraw = 0;
  private frames = 0;
  private engine: Engine | null = null;
  private readonly tracking = perfRequested();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      } else if (this.visible && e.altKey && this.engine) {
        const key = ({ Digit1: 'ao', Digit2: 'bloom', Digit3: 'taa' } as const)[e.code as 'Digit1'];
        if (!key) return;
        e.preventDefault();
        const q = this.engine.quality;
        this.engine.rebuildPipeline({ ...q, [key]: !q[key] });
        this.samples.length = 0;
        this.cpu.length = 0;
      }
    });
    if (this.tracking) this.toggle();
  }

  toggle(): void {
    this.visible = !this.visible;
    if (this.visible && !this.el) {
      const el = document.createElement('pre');
      el.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999;margin:0;padding:8px 10px;background:rgba(0,0,0,.72);color:#9ef59e;font:12px/1.35 ui-monospace,Consolas,monospace;pointer-events:none;border-radius:6px;white-space:pre';
      document.body.appendChild(el);
      this.el = el;
    }
    if (this.el) this.el.style.display = this.visible ? 'block' : 'none';
    this.samples.length = 0;
    this.cpu.length = 0;
  }

  /** Appelé après chaque image rendue (`dt` : ms depuis l'image précédente, 0 la première fois ; `renderCpuMs` : temps passé côté processeur à préparer et soumettre le rendu). */
  frame(dt: number, engine: Engine, renderCpuMs = 0): void {
    this.engine = engine;
    if (!this.visible || !(dt > 0) || dt > 1000) return;
    this.samples.push(dt);
    this.cpu.push(renderCpuMs);
    if (this.samples.length > WINDOW) {
      this.samples.shift();
      this.cpu.shift();
    }
    this.sinceDraw += dt;
    this.frames++;
    if (this.tracking && this.frames % 15 === 0) void engine.renderer.resolveTimestampsAsync('render').catch(() => undefined);
    if (this.sinceDraw >= 500) {
      this.sinceDraw = 0;
      this.draw(engine);
    }
  }

  private draw(engine: Engine): void {
    if (!this.el) return;
    const s = this.samples;
    const sorted = [...s].sort((a, b) => a - b);
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    const p95 = sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)] as number;
    const max = sorted[sorted.length - 1] as number;
    const info = engine.renderer.info;
    const canvas = engine.renderer.domElement;
    const gpu = this.tracking ? (info.render.timestamp > 0 ? `${info.render.timestamp.toFixed(1)} ms` : '…') : 'off (?perf=1)';
    const q = engine.quality;
    const px = (canvas.width * canvas.height) / 1e6;
    const cpuRender = this.cpu.reduce((a, b) => a + b, 0) / this.cpu.length;
    const gpuMs = this.tracking ? info.render.timestamp : 0;
    const bound = gpuMs > avg * 0.8 ? 'GPU' : cpuRender > avg * 0.5 ? 'CPU : préparation du rendu' : gpuMs > 0 ? 'CPU : logique du jeu ou attente' : '?';
    // Où se concentrent les objets dessinés : grands groupes de la scène, du plus chargé au moins chargé.
    const groups = engine.scene.children
      .map((c) => ({ name: c.name || c.type, ...countDrawables(c) }))
      .filter((g) => g.meshes > 0)
      .sort((a, b) => b.meshes + b.casters * engine.quality.shadowCascades - (a.meshes + a.casters * engine.quality.shadowCascades))
      .slice(0, 6)
      .map((g) => `  ${g.name.slice(0, 18).padEnd(18)} ${String(g.meshes).padStart(4)} obj  ${String(g.casters).padStart(4)} ombres`);
    this.el.textContent = [
      `${(1000 / avg).toFixed(0)} fps   ${avg.toFixed(1)} ms  p95 ${p95.toFixed(1)}  max ${max.toFixed(1)}`,
      `GPU ${gpu}   limite : ${bound}`,
      `CPU rendu ${cpuRender.toFixed(1)} ms   hors rendu ${Math.max(avg - cpuRender, 0).toFixed(1)} ms (jeu, attente)`,
      `appels ${info.render.drawCalls}   triangles ${(info.render.triangles / 1e6).toFixed(2)} M`,
      `géométries ${info.memory.geometries}   textures ${info.memory.textures}`,
      `rendu ${canvas.width}×${canvas.height} (${px.toFixed(1)} Mpx)  échelle dyn. ${engine.dynamicRes.scale}`,
      `${engine.backend}  qualité ${q.level}  AO ${q.ao ? 'on' : 'off'}  bloom ${q.bloom ? 'on' : 'off'}  TAA ${q.taa ? 'on' : 'off'}`,
      `ombres : ${q.shadowCascades} cascade(s) ${q.shadowMapSize} px  · objets par groupe :`,
      ...groups,
      `F3 masquer · Alt+1 AO · Alt+2 bloom · Alt+3 TAA`,
    ].join('\n');
  }
}
