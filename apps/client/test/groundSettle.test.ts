import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundChange, settleWhileVisible } from '../src/world/groundSettle.ts';

describe('groundSettle', () => {
  it('re-pose au premier rendu puis au plus une fois par intervalle', () => {
    const obj = new THREE.Object3D();
    let t = 1000;
    let calls = 0;
    settleWhileVisible(obj as never, () => calls++, 400, () => t);
    const render = () => (obj.onBeforeRender as unknown as () => void).call(obj);
    render();
    expect(calls).toBe(1);
    t += 100;
    render();
    expect(calls).toBe(1);
    t += 400;
    render();
    expect(calls).toBe(2);
  });

  it('garde le rappel déjà posé sur l’objet', () => {
    const obj = new THREE.Object3D();
    let before = 0;
    obj.onBeforeRender = () => {
      before++;
    };
    settleWhileVisible(obj as never, () => {}, 400, () => 0);
    (obj.onBeforeRender as unknown as () => void).call(obj);
    expect(before).toBe(1);
  });

  it('ne retient que un sol connu qui s’écarte de plus d’1 cm', () => {
    expect(groundChange(10, Number.NaN)).toBeNull();
    expect(groundChange(10, 10.005)).toBeNull();
    expect(groundChange(10, 9.7)).toBe(9.7);
  });
});
