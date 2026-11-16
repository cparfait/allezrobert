import { Quaternion, Vector3, type Bone } from 'three/webgpu';

type Key = { frame: number; rotation?: Quaternion; position?: Vector3 };
export interface V3Clip {
  name: string;
  rig: 'Male' | 'Female';
  duration: number;
  /** Format compact des clips du garage (pistes encodées en base64). */
  tracks?: [number, number, number, number][];
  timeBytes?: number;
  data?: string;
  /** Format de l'étude (clips décodés, version 24 comprise) : temps en secondes, quaternions et positions en clair. */
  keys?: { b: number; t: number[]; q?: number[]; p?: number[] }[];
}
type Track = { bone: number; keys: Key[] };
const decoded = new WeakMap<V3Clip, Track[]>();

function rotation(value: number): Quaternion {
  const components = [20, 10, 0].map(shift => (((value >>> shift) & 1023) - 511.5) * Math.SQRT1_2 / 511.5);
  components.splice(value >>> 30, 0, Math.sqrt(Math.max(0, 1 - components.reduce((length, x) => length + x * x, 0))));
  return new Quaternion().fromArray(components).normalize();
}

function tracksOf(clip: V3Clip): Track[] {
  const existing = decoded.get(clip);
  if (existing) return existing;
  if (clip.keys) {
    const tracks = clip.keys.map(({ b, t, q, p }) => ({
      bone: b,
      keys: t.map((time, i): Key => ({
        frame: time * 30,
        rotation: q && q.length >= i * 4 + 4 ? new Quaternion().fromArray(q, i * 4).normalize() : undefined,
        position: p && p.length >= i * 3 + 3 ? new Vector3().fromArray(p, i * 3) : undefined,
      })),
    }));
    decoded.set(clip, tracks);
    return tracks;
  }
  const binary = Uint8Array.from(atob(clip.data ?? ''), char => char.charCodeAt(0));
  const source = new DataView(binary.buffer);
  const tracks = (clip.tracks ?? []).map(([offset, count, bone, flags]) => {
    const keys: Key[] = [];
    for (let i = 0; i < count; i++) {
      const frame = clip.timeBytes === 1 ? source.getUint8(offset) : source.getUint16(offset, true);
      offset += clip.timeBytes ?? 1;
      const key: Key = { frame };
      if (flags & 1) {
        key.rotation = rotation(source.getUint32(offset, true));
        offset += 4;
      }
      if (flags & 2) {
        key.position = new Vector3().fromArray([0, 2, 4].map(i => {
          const n = source.getUint16(offset + i, true);
          return (n & 32768 ? -1 : 1) * (n & 32767) / 32768;
        }));
        offset += 6;
      }
      keys.push(key);
    }
    return { bone, keys };
  });
  decoded.set(clip, tracks);
  return tracks;
}

export function sampleV3(clip: V3Clip, joints: Map<number, Bone>, turns: number): void {
  const cycles = Math.max(1, Math.round(clip.duration / (2 / 3)));
  const frame = /^cyclistsuperaero$/i.test(clip.name) ? 0 : (turns % cycles) / cycles * clip.duration * 30;
  for (const { bone, keys } of tracksOf(clip)) {
    const joint = joints.get(bone);
    if (!joint || !keys.length) continue;
    const found = keys.findIndex(key => key.frame >= frame);
    const end = found < 0 ? keys.length - 1 : found;
    const a = keys[Math.max(0, end - 1)]!;
    const b = keys[end]!;
    const alpha = a.frame === b.frame ? 0 : Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)));
    if (a.rotation && b.rotation) joint.quaternion.copy(a.rotation).slerp(b.rotation, alpha);
    if (a.position && b.position) joint.position.copy(a.position).lerp(b.position, alpha);
  }
}
