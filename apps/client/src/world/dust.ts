import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, smoothstep, uv, float } from 'three/tsl';

const MAX = 140;

interface Grain {
  life: number;
  age: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
}

/**
 * Poussière soulevée par la roue arrière sur les chemins non revêtus (idée NCT Ride) :
 * petits nuages en billboards instanciés, qui grossissent et s'effacent en ~1,5 s.
 * Le débit suit la vitesse ; rien sous 7 km/h ni sur l'enrobé.
 */
export class Dust {
  readonly mesh: THREE.InstancedMesh;
  private readonly grains: Grain[] = [];
  private readonly alpha: THREE.InstancedBufferAttribute;
  private acc = 0;
  private readonly m = new THREE.Matrix4();
  private readonly s = new THREE.Vector3();

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ color: '#b8a27a', transparent: true, depthWrite: false });
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    // Disque flou : opacité nulle au bord du carré, pleine au centre.
    mat.opacityNode = instancedBufferAttribute<'float'>(this.alpha).mul(smoothstep(float(0.5), float(0.08), uv().sub(0.5).length()));
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'dust';
    for (let i = 0; i < MAX; i++) this.grains.push({ life: 0, age: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0 });
  }

  /**
   * @param emit roue arrière du coureur (position, direction de marche, vitesse) sur un chemin, ou null
   */
  update(dt: number, emit: { pos: THREE.Vector3; dir: THREE.Vector3; speedMs: number; amount: number } | null, camera: THREE.Camera): void {
    if (emit && emit.speedMs > 2) {
      this.acc += dt * Math.min(60, emit.speedMs * 3.2) * emit.amount;
      while (this.acc >= 1) {
        this.acc -= 1;
        const g = this.grains.find((x) => x.age >= x.life);
        if (!g) break;
        g.age = 0;
        g.life = 1.1 + Math.random() * 0.8;
        g.size = 0.25 + Math.random() * 0.2;
        g.pos.copy(emit.pos).addScaledVector(emit.dir, -0.55).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.12, (Math.random() - 0.5) * 0.3));
        // Projetée vers l'arrière et vers le haut, puis freinée par l'air.
        g.vel.copy(emit.dir).multiplyScalar(-emit.speedMs * 0.15).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8));
      }
    }
    let n = 0;
    const q = camera.quaternion;
    for (const g of this.grains) {
      if (g.age >= g.life) continue;
      g.age += dt;
      g.vel.multiplyScalar(Math.exp(-dt * 1.6));
      g.pos.addScaledVector(g.vel, dt);
      const t = Math.min(1, g.age / g.life);
      const size = g.size + t * 1.4;
      this.m.compose(g.pos, q, this.s.set(size, size, size));
      this.mesh.setMatrixAt(n, this.m);
      this.alpha.setX(n, 0.32 * (1 - t) * Math.min(1, g.age * 8));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
