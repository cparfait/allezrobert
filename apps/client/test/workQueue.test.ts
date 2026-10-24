import { describe, expect, it } from 'vitest';
import { WorkQueue } from '../src/world/workQueue.ts';

/** Horloge factice : chaque tâche « coûte » le temps qu'on lui donne. */
function clock() {
  let t = 0;
  return { now: () => t, spend: (ms: number) => (t += ms) };
}

describe('WorkQueue', () => {
  it('respecte le budget par image, le plus proche d’abord', () => {
    const c = clock();
    const q = new WorkQueue();
    const order: string[] = [];
    for (const [name, prio] of [['loin', 3000], ['près', 100], ['milieu', 1500]] as const) q.defer(() => (order.push(name), c.spend(3)), prio);
    expect(q.pump(5, c.now)).toBe(2); // 3 ms puis 3 ms : la seconde tâche commence sous le budget, la troisième non
    expect(order).toEqual(['près', 'milieu']);
    expect(q.size).toBe(1);
    q.pump(5, c.now);
    expect(order).toEqual(['près', 'milieu', 'loin']);
  });
  it('fait au moins une tâche même si elle dépasse le budget', () => {
    const c = clock();
    const q = new WorkQueue();
    q.defer(() => c.spend(50));
    q.defer(() => c.spend(50));
    expect(q.pump(4, c.now)).toBe(1);
    expect(q.size).toBe(1);
  });
  it('à priorité égale, garde l’ordre d’arrivée', () => {
    const q = new WorkQueue();
    const order: number[] = [];
    for (let i = 0; i < 5; i++) q.defer(() => order.push(i), 10);
    q.flush();
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
  it('flush exécute aussi les tâches ajoutées pendant le vidage', () => {
    const q = new WorkQueue();
    const order: string[] = [];
    q.defer(() => {
      order.push('tuile');
      q.defer(() => order.push('végétation'), 5);
    });
    q.flush();
    expect(order).toEqual(['tuile', 'végétation']);
    expect(q.size).toBe(0);
  });
  it('une tâche en échec n’arrête pas la file', () => {
    const q = new WorkQueue();
    const order: string[] = [];
    q.defer(() => {
      throw new Error('tuile illisible');
    });
    q.defer(() => order.push('suite'));
    q.flush();
    expect(order).toEqual(['suite']);
  });
});
