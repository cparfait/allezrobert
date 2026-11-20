import { describe, expect, it } from 'vitest';
import { buildBridgeRailings } from '../src/world/bridgeRailings.ts';

const road = (bridge: boolean, id = 'w1') => ({ id, kind: 'secondary', width: 8, pts: [0, 0, 40, 0], pts3: [0, 10, 0, 40, 10, 0], bridge });

describe('garde-corps des ponts', () => {
  it('pont : rambardes des deux côtés, à hauteur du tablier, au bord de la chaussée', () => {
    const g = buildBridgeRailings([road(true)]);
    expect(g).not.toBeNull();
    const pos = g!.getAttribute('position');
    let minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(maxZ).toBeGreaterThan(4.3);
    expect(minZ).toBeLessThan(-4.3);
    expect(maxY).toBeCloseTo(10 + 1.05 + 0.07, 2);
  });
  it('route ordinaire ou copie du même tronçon : rien en plus', () => {
    expect(buildBridgeRailings([road(false)])).toBeNull();
    const one = buildBridgeRailings([road(true, 'w1')])!.getAttribute('position').count;
    const twice = buildBridgeRailings([road(true, 'w1'), road(true, 'route:x:w1')])!.getAttribute('position').count;
    expect(twice).toBe(one);
  });
});
