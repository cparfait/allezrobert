import { describe, expect, it } from 'vitest';
import { deltaDecodeU16, deltaEncodeU16 } from '../src/heights.ts';

describe('altitudes en différences', () => {
  it('aller-retour exact, y compris en franchissant 0 et 65535', () => {
    const n = 4;
    const N = n + 1;
    const q = new Uint16Array(N * N);
    for (let k = 0; k < q.length; k++) q[k] = (k * 9973 + (k % 3 === 0 ? 65000 : 0)) & 0xffff;
    const orig = q.slice();
    deltaEncodeU16(q, n);
    expect(Array.from(q)).not.toEqual(Array.from(orig));
    deltaDecodeU16(q, n);
    expect(Array.from(q)).toEqual(Array.from(orig));
  });

  it('un relief régulier donne de petites différences', () => {
    const n = 2;
    const q = Uint16Array.from([1000, 1001, 1002, 1010, 1011, 1012, 1020, 1021, 1022]);
    expect(Array.from(deltaEncodeU16(q, n))).toEqual([1000, 1, 1, 10, 1, 1, 10, 1, 1]);
  });
});
