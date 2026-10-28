import * as THREE from 'three/webgpu';
import { abs, attribute, cos, float, instancedBufferAttribute, mix, positionGeometry, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BirdPerch, LifeChunk, RoadsideLife } from './roadsideLife.ts';

/**
 * Oiseaux et papillons du style jeu vidéo. Oiseaux : deux triangles d'ailes battus dans le shader,
 * volées en V qui traversent le ciel devant le coureur, petits groupes posés sur les fils électriques
 * ou dans les champs qui s'envolent quand il approche. Papillons : posés sur les fleurs des bas-côtés,
 * ils s'envolent à son passage (vol et battements calculés dans le shader à partir de l'heure du
 * déclenchement), puis se reposent. Un maillage instancié pour chacun ; quelques dizaines d'instances.
 */

const BIRDS = 72;
const BUTTERFLIES = 36;
/** Papillons posés sur les touffes à moins de cette distance du coureur. */
const BUTTERFLY_M = 45;

/** Oiseau (avant +z, gauche +x) : corps en losange, queue, deux ailes (attribut `wing` ±1). */
function birdGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, wing: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
    ng.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count).fill(wing), 1));
    return ng;
  };
  const tri = (a: number[], b: number[], c: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
    return g;
  };
  return mergeGeometries(
    [
      tag(new THREE.OctahedronGeometry(0.5, 0).scale(0.09, 0.08, 0.3), 0),
      tag(tri([0, 0, -0.12], [0.07, 0, -0.3], [-0.07, 0, -0.3]), 0),
      tag(tri([0.03, 0, 0.08], [0.03, 0, -0.08], [0.45, 0, -0.06]), 1),
      tag(tri([-0.03, 0, -0.08], [-0.03, 0, 0.08], [-0.45, 0, -0.06]), -1),
    ],
    false,
  ) as THREE.BufferGeometry;
}

/** Papillon : deux paires d'ailes (attribut `wing` ±1) et un corps fin. */
function butterflyGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, wing: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
    ng.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(ng.getAttribute('position').count).fill(wing), 1));
    return ng;
  };
  const wing = (s: number) => {
    const g = new THREE.BufferGeometry();
    // aile antérieure et postérieure, dans le plan horizontal, charnière sur l'axe z
    const p = [0, 0, 0.012, s * 0.05, 0, 0.032, s * 0.042, 0, -0.004, 0, 0, -0.004, s * 0.04, 0, -0.006, s * 0.026, 0, -0.03];
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p), 3));
    return g;
  };
  return mergeGeometries([tag(wing(1), 1), tag(wing(-1), -1), tag(new THREE.BoxGeometry(0.006, 0.006, 0.04), 0)], false) as THREE.BufferGeometry;
}

interface Bird {
  slot: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  phase: number;
  rate: number;
  flap: number;
  scale: number;
  /** 0 posé, 1 envolé, 2 volée en V. */
  state: 0 | 1 | 2;
  delay: number;
  age: number;
  perch: BirdPerch | null;
  /** Volée en V : rang dans la formation (arrière, côté). */
  back: number;
  lat: number;
}

interface Flock {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  birds: Bird[];
}

const DARK = new THREE.Color('#1d2129');
const CROW = new THREE.Color('#17171a');
const PIGEON = new THREE.Color('#7f8590');
const GOOSE = new THREE.Color('#5b5650');
const BUTTERFLY_COLS = ['#f7f4ea', '#f4d23a', '#ff8a2a', '#5a8cff', '#d94f7a', '#f2f2a0'].map((c) => new THREE.Color(c));

export class SkyLife {
  readonly group = new THREE.Group();
  private readonly birdMesh: THREE.InstancedMesh;
  private readonly bPose: THREE.InstancedBufferAttribute;
  private readonly bMisc: THREE.InstancedBufferAttribute;
  private readonly bCol: THREE.InstancedBufferAttribute;
  private readonly birds: Bird[] = [];
  private readonly freeBirds: number[] = [];
  private readonly flocks: Flock[] = [];
  private readonly perched = new Map<BirdPerch, Bird[]>();
  private readonly spent = new WeakSet<BirdPerch>();
  private perches: BirdPerch[] = [];
  private nextFlock = 8 + Math.random() * 15;

  private readonly flyMesh: THREE.InstancedMesh;
  private readonly fAnchor: THREE.InstancedBufferAttribute;
  private readonly fTrig: THREE.InstancedBufferAttribute;
  private readonly fCol: THREE.InstancedBufferAttribute;
  private readonly clock = uniform(0);
  private t = 0;
  /** Touffe de chaque papillon (indice dans `tufts`, −1 libre) et touffes proches. */
  private readonly flyTuft = new Int32Array(BUTTERFLIES).fill(-1);
  private tufts = new Float32Array(0);
  private readonly lastAssign = new THREE.Vector3(Infinity, 0, 0);
  private version = -1;
  private readonly heading = new THREE.Vector2(0, 1);
  private readonly lastFocus = new THREE.Vector3(Number.NaN, 0, 0);
  private scan = 0;
  /** Conditions : pas d'oiseaux la nuit, pas de papillons en hiver, la nuit ni sous la pluie. */
  birdsOn = true;
  butterfliesOn = true;

  constructor(private readonly life: RoadsideLife) {
    this.group.name = 'sky-life';
    const attr = (cap: number, n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    // ── Oiseaux ──
    this.bPose = attr(BIRDS, 4);
    this.bMisc = attr(BIRDS, 4);
    this.bCol = attr(BIRDS, 3);
    {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
      m.flatShading = true;
      const P = instancedBufferAttribute(this.bPose) as unknown as THREE.Node<'vec4'>;
      const Q = instancedBufferAttribute(this.bMisc) as unknown as THREE.Node<'vec4'>;
      m.colorNode = instancedBufferAttribute(this.bCol) as unknown as THREE.Node<'vec3'>;
      const w = attribute<'float'>('wing');
      const p = positionGeometry;
      const a = Q.x.mul(w);
      const ca = cos(a);
      const sa = sin(a);
      const lx = p.x.mul(ca).sub(p.y.mul(sa)).mul(Q.y);
      const ly = p.x.mul(sa).add(p.y.mul(ca)).mul(Q.y);
      const lz = p.z.mul(Q.y);
      const cy = cos(P.w);
      const sy = sin(P.w);
      m.positionNode = vec3(P.x.add(lx.mul(cy)).add(lz.mul(sy)), P.y.add(ly), P.z.sub(lx.mul(sy)).add(lz.mul(cy)));
      this.birdMesh = new THREE.InstancedMesh(birdGeometry(), m, BIRDS);
    }
    this.birdMesh.count = 0;
    this.birdMesh.frustumCulled = false;
    this.birdMesh.name = 'birds';
    for (let i = BIRDS - 1; i >= 0; i--) this.freeBirds.push(i);
    this.group.add(this.birdMesh);

    // ── Papillons : tout le vol est dans le shader ──
    this.fAnchor = attr(BUTTERFLIES, 4);
    this.fTrig = attr(BUTTERFLIES, 1);
    this.fCol = attr(BUTTERFLIES, 3);
    this.fTrig.array.fill(-100);
    {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
      m.flatShading = true;
      const A = instancedBufferAttribute(this.fAnchor) as unknown as THREE.Node<'vec4'>;
      const trig = instancedBufferAttribute(this.fTrig) as unknown as THREE.Node<'float'>;
      const w = attribute<'float'>('wing');
      m.colorNode = mix(vec3(0.03, 0.03, 0.03), instancedBufferAttribute(this.fCol) as unknown as THREE.Node<'vec3'>, abs(w));
      const seed = A.w;
      const clock = this.clock;
      const age = clock.sub(trig);
      // s'envole au passage du coureur, se repose au bout de 6 à 8 s
      const fly = smoothstep(0, 0.4, age).mul(float(1).sub(smoothstep(6, 8, age)));
      const t = clock.mul(0.8).add(seed.mul(10));
      const off = vec3(sin(t.mul(1.3)).mul(1.6).add(sin(t.mul(2.7)).mul(0.5)), sin(t.mul(1.9)).mul(0.3).add(0.7).add(sin(t.mul(5)).mul(0.12)), cos(t.mul(1.1)).mul(1.6).add(sin(t.mul(3.1)).mul(0.4))).mul(fly);
      // ailes : fermées à la verticale au repos, battements rapides en vol
      const flapA = mix(float(1.45), sin(clock.mul(16).add(seed.mul(30))).mul(0.65).add(0.75), fly);
      const a = flapA.mul(w);
      const p = positionGeometry;
      const ca = cos(a);
      const sa = sin(a);
      const lx = p.x.mul(ca).sub(p.y.mul(sa)).mul(1.6);
      const ly = p.x.mul(sa).add(p.y.mul(ca)).mul(1.6);
      const lz = p.z.mul(1.6);
      const yaw = seed.mul(6.28).add(t.mul(0.6).mul(fly));
      const cy = cos(yaw);
      const sy = sin(yaw);
      // instances libres : ancre très bas, échelle nulle (w = −1)
      const vis = smoothstep(-0.5, 0, seed);
      m.positionNode = vec3(A.x.add(off.x).add(lx.mul(cy)).add(lz.mul(sy)), A.y.add(off.y).add(ly), A.z.add(off.z).sub(lx.mul(sy)).add(lz.mul(cy))).mul(vis);
      this.flyMesh = new THREE.InstancedMesh(butterflyGeometry(), m, BUTTERFLIES);
    }
    for (let i = 0; i < BUTTERFLIES; i++) this.fAnchor.setXYZW(i, 0, -1e4, 0, -1);
    this.flyMesh.count = BUTTERFLIES;
    this.flyMesh.frustumCulled = false;
    this.flyMesh.name = 'butterflies';
    this.group.add(this.flyMesh);
  }

  reset(): void {
    for (const b of [...this.birds]) this.freeBird(b);
    this.flocks.length = 0;
    this.perched.clear();
    this.flyTuft.fill(-1);
    for (let i = 0; i < BUTTERFLIES; i++) this.fAnchor.setXYZW(i, 0, -1e4, 0, -1);
    this.fAnchor.needsUpdate = true;
    this.version = -1;
    this.lastAssign.set(Infinity, 0, 0);
  }

  update(dt: number, focus: THREE.Vector3): void {
    this.t += dt;
    this.clock.value = this.t;
    // cap du coureur (lissé), pour placer les volées devant lui
    if (Number.isFinite(this.lastFocus.x)) {
      const dx = focus.x - this.lastFocus.x;
      const dz = focus.z - this.lastFocus.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1e-6 && d2 < 400) {
        this.heading.x += (dx / Math.sqrt(d2) - this.heading.x) * Math.min(1, dt * 0.5);
        this.heading.y += (dz / Math.sqrt(d2) - this.heading.y) * Math.min(1, dt * 0.5);
        this.heading.normalize();
      }
    }
    this.lastFocus.copy(focus);
    if (this.life.version !== this.version) {
      this.version = this.life.version;
      const perches: BirdPerch[] = [];
      let n = 0;
      for (const c of this.life.chunkList as readonly LifeChunk[]) {
        for (const p of c.perches) perches.push(p);
        n += c.flowers.length;
      }
      this.perches = perches;
      const tufts = new Float32Array(n);
      let o = 0;
      for (const c of this.life.chunkList as readonly LifeChunk[]) {
        tufts.set(c.flowers, o);
        o += c.flowers.length;
      }
      // chaque papillon garde sa touffe si elle existe encore (indices renumérotés)
      const index = new Map<string, number>();
      for (let t = 0; t * 3 + 2 < tufts.length; t++) index.set(tuftKey(tufts[t * 3] as number, tufts[t * 3 + 2] as number), t);
      for (let i = 0; i < BUTTERFLIES; i++) {
        if ((this.flyTuft[i] as number) < 0) continue;
        const t = index.get(tuftKey(this.fAnchor.getX(i), this.fAnchor.getZ(i)));
        this.flyTuft[i] = t ?? -1;
        if (t === undefined) this.fAnchor.setXYZW(i, 0, -1e4, 0, -1);
      }
      this.fAnchor.needsUpdate = true;
      this.tufts = tufts;
      this.lastAssign.set(Infinity, 0, 0);
      for (const [p, list] of this.perched) if (!perches.includes(p)) for (const b of list) if (b.state === 0) this.freeBird(b);
    }
    this.updateFlocks(dt, focus);
    this.updatePerches(dt, focus);
    this.updateBirds(dt, focus);
    this.updateButterflies(focus);
  }

  private allocBird(): Bird | null {
    const slot = this.freeBirds.pop();
    if (slot === undefined) return null;
    const b: Bird = { slot, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, phase: Math.random() * 6.28, rate: 2, flap: 0, scale: 1, state: 0, delay: 0, age: 0, perch: null, back: 0, lat: 0 };
    this.birds.push(b);
    this.birdMesh.count = Math.max(this.birdMesh.count, slot + 1);
    return b;
  }

  private freeBird(b: Bird): void {
    const i = this.birds.indexOf(b);
    if (i < 0) return;
    this.birds.splice(i, 1);
    this.bMisc.setXYZW(b.slot, 0, 0, 0, 0);
    this.freeBirds.push(b.slot);
    if (b.perch) {
      const list = this.perched.get(b.perch);
      if (list) {
        const j = list.indexOf(b);
        if (j >= 0) list.splice(j, 1);
        if (!list.length) this.perched.delete(b.perch);
      }
    }
    let top = 0;
    for (const o of this.birds) top = Math.max(top, o.slot + 1);
    this.birdMesh.count = top;
  }

  /** Volées en V, haut dans le ciel, qui traversent devant le coureur. */
  private updateFlocks(dt: number, f: THREE.Vector3): void {
    this.nextFlock -= dt;
    if (this.nextFlock <= 0 && this.flocks.length < 2 && this.birdsOn) {
      this.nextFlock = 25 + Math.random() * 45;
      const hx = this.heading.x;
      const hz = this.heading.y;
      const side = Math.random() < 0.5 ? -1 : 1;
      // à droite du coureur : (−hz, hx)
      const ahead = 250 + Math.random() * 200;
      const x = f.x + hx * ahead + -hz * side * 380;
      const z = f.z + hz * ahead + hx * side * 380;
      let dx = hz * side + hx * 0.3;
      let dz = -hx * side + hz * 0.3;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      const flock: Flock = { x, y: f.y + 60 + Math.random() * 50, z, dx, dz, speed: 12 + Math.random() * 4, birds: [] };
      const n = 7 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n; i++) {
        const b = this.allocBird();
        if (!b) break;
        const rank = Math.ceil(i / 2);
        b.state = 2;
        b.back = rank * 2.6 + (Math.random() - 0.5) * 0.4;
        b.lat = (i % 2 ? 1 : -1) * rank * 2.2;
        b.scale = 1.9 + Math.random() * 0.3;
        b.rate = 2 + Math.random() * 0.4;
        this.bCol.setXYZ(b.slot, GOOSE.r, GOOSE.g, GOOSE.b);
        flock.birds.push(b);
      }
      this.bCol.needsUpdate = true;
      this.flocks.push(flock);
    }
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const fl = this.flocks[i] as Flock;
      fl.x += fl.dx * fl.speed * dt;
      fl.z += fl.dz * fl.speed * dt;
      const yaw = Math.atan2(fl.dx, fl.dz);
      // perpendiculaire à gauche du vol : (dz, −dx) ↔ +x local = (cos yaw, −sin yaw)
      for (const b of fl.birds) {
        b.x = fl.x - fl.dx * b.back + Math.cos(yaw) * b.lat;
        b.z = fl.z - fl.dz * b.back - Math.sin(yaw) * b.lat;
        b.y = fl.y + Math.sin(this.t * 0.7 + b.lat) * 0.4;
        b.yaw = yaw;
      }
      if (Math.hypot(fl.x - f.x, fl.z - f.z) > 1100 || !this.birdsOn) {
        for (const b of fl.birds) this.freeBird(b);
        this.flocks.splice(i, 1);
      }
    }
  }

  /** Oiseaux posés sur les perchoirs proches ; envol quand le coureur approche. */
  private updatePerches(dt: number, f: THREE.Vector3): void {
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.5;
      for (const p of this.perches) {
        if (this.perched.has(p) || this.spent.has(p) || !this.birdsOn) continue;
        if (Math.hypot(p.x - f.x, p.z - f.z) > 140) continue;
        const list: Bird[] = [];
        for (let i = 0; i + 2 < p.pts.length; i += 3) {
          const b = this.allocBird();
          if (!b) break;
          b.state = 0;
          b.perch = p;
          b.x = p.pts[i] as number;
          b.y = p.pts[i + 1] as number;
          b.z = p.pts[i + 2] as number;
          b.yaw = p.yaw + (Math.random() - 0.5) * (p.ground ? 3 : 0.4);
          b.scale = p.ground ? 0.8 + Math.random() * 0.25 : 0.42 + Math.random() * 0.1;
          const c = p.ground ? (Math.random() < 0.6 ? CROW : PIGEON) : DARK;
          this.bCol.setXYZ(b.slot, c.r, c.g, c.b);
          list.push(b);
        }
        if (list.length) this.perched.set(p, list);
        this.bCol.needsUpdate = true;
      }
    }
    for (const [p, list] of this.perched) {
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < (p.ground ? 45 : 32)) {
        // envol : chacun s'écarte du coureur, monte, bat vite des ailes
        this.spent.add(p);
        for (const b of list) {
          if (b.state !== 0) continue;
          let ax = b.x - f.x;
          let az = b.z - f.z;
          const L = Math.hypot(ax, az) || 1;
          ax /= L;
          az /= L;
          const sp = 5 + Math.random() * 3;
          const j = (Math.random() - 0.5) * 0.8;
          b.vx = (ax - az * j) * sp;
          b.vz = (az + ax * j) * sp;
          b.vy = 2.5 + Math.random() * 2;
          b.state = 1;
          b.delay = Math.random() * 0.6;
          b.age = 0;
          b.rate = 6 + Math.random() * 2;
          b.perch = null;
        }
        this.perched.delete(p);
      } else if (d > 190) {
        for (const b of [...list]) this.freeBird(b);
      }
    }
  }

  private updateBirds(dt: number, f: THREE.Vector3): void {
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i] as Bird;
      if (b.state === 0) {
        // posé : ailes repliées, rien ne bouge
        b.flap = -1.25;
      } else if (b.state === 1) {
        if (b.delay > 0) {
          b.delay -= dt;
          b.flap = -1.25;
        } else {
          b.age += dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
          // la montée faiblit, la vitesse horizontale grandit (≈ 9 m/s)
          b.vy += (1.2 - b.vy) * Math.min(1, dt * 0.6);
          const hs = Math.hypot(b.vx, b.vz) || 1;
          const k = 1 + (9 - hs) * Math.min(1, dt * 0.4) / hs;
          b.vx *= k;
          b.vz *= k;
          b.yaw = turnTo(b.yaw, Math.atan2(b.vx, b.vz), dt * 6);
          b.rate += (3.5 - b.rate) * Math.min(1, dt * 0.3);
          b.phase += b.rate * Math.PI * 2 * dt;
          b.flap = Math.sin(b.phase) * 0.9;
          if (b.age > 14 || Math.hypot(b.x - f.x, b.z - f.z) > 280) {
            this.freeBird(b);
            continue;
          }
        }
      } else {
        b.phase += b.rate * Math.PI * 2 * dt;
        // battements, avec de courts vols planés
        const glide = Math.sin(this.t * 0.4 + b.lat) > 0.6;
        b.flap = glide ? 0.12 : Math.sin(b.phase) * 0.55;
      }
      b.phase %= Math.PI * 2;
      this.bPose.setXYZW(b.slot, b.x, b.y, b.z, b.yaw);
      this.bMisc.setXYZW(b.slot, b.flap, b.scale, 0, 0);
    }
    this.bPose.needsUpdate = true;
    this.bMisc.needsUpdate = true;
  }

  /** Papillons posés sur les touffes de fleurs proches ; envol quand le coureur passe à moins de 14 m. */
  private updateButterflies(f: THREE.Vector3): void {
    const tufts = this.tufts;
    const on = this.butterfliesOn;
    if (this.lastAssign.distanceToSquared(f) > 400 || !on) {
      this.lastAssign.copy(f);
      // libère les papillons trop loin, place les libres sur des touffes proches (une sur trois)
      const taken = new Set<number>();
      for (let i = 0; i < BUTTERFLIES; i++) {
        const t = this.flyTuft[i] as number;
        if (t < 0) continue;
        const d = Math.hypot((tufts[t * 3] as number) - f.x, (tufts[t * 3 + 2] as number) - f.z);
        if (d > BUTTERFLY_M + 10 || !on) {
          this.flyTuft[i] = -1;
          this.fAnchor.setXYZW(i, 0, -1e4, 0, -1);
        } else taken.add(t);
      }
      if (on) {
        let i = 0;
        for (let t = 0; t * 3 + 2 < tufts.length; t++) {
          if (taken.has(t)) continue;
          const tx = tufts[t * 3] as number;
          const ty = tufts[t * 3 + 1] as number;
          const tz = tufts[t * 3 + 2] as number;
          // une touffe sur trois (choix stable, d'après sa position)
          const seed = fract(tx * 0.1234 + tz * 0.4567);
          if (seed > 0.34 || Math.hypot(tx - f.x, tz - f.z) > BUTTERFLY_M) continue;
          while (i < BUTTERFLIES && (this.flyTuft[i] as number) >= 0) i++;
          if (i >= BUTTERFLIES) break;
          this.flyTuft[i] = t;
          this.fAnchor.setXYZW(i, tx, ty, tz, seed * 2.9 + 0.01);
          const c = BUTTERFLY_COLS[Math.floor(seed * 17) % BUTTERFLY_COLS.length] as THREE.Color;
          this.fCol.setXYZ(i, c.r, c.g, c.b);
          this.fTrig.setX(i, -100);
        }
        this.fCol.needsUpdate = true;
        this.fTrig.needsUpdate = true;
      }
      this.fAnchor.needsUpdate = true;
    }
    // envol au passage (une fois posé depuis 9 s)
    let trig = false;
    for (let i = 0; i < BUTTERFLIES; i++) {
      const t = this.flyTuft[i] as number;
      if (t < 0) continue;
      const d = Math.hypot((tufts[t * 3] as number) - f.x, (tufts[t * 3 + 2] as number) - f.z);
      if (d < 14 && this.t - (this.fTrig.getX(i) as number) > 9) {
        this.fTrig.setX(i, this.t + Math.random() * 0.4);
        trig = true;
      }
    }
    if (trig) this.fTrig.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.birdMesh, this.flyMesh]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

const fract = (v: number) => v - Math.floor(v);
const tuftKey = (x: number, z: number) => `${Math.round(x * 4)},${Math.round(z * 4)}`;

function turnTo(from: number, to: number, step: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-step, Math.min(step, d));
}
