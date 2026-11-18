import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainStartupQueue } from '../src/world/startupDrain.ts';
import { WorkQueue } from '../src/world/workQueue.ts';

function browserFrames() {
  let frameId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    pending,
    paint() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
      return vi.advanceTimersByTimeAsync(0);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('drainStartupQueue', () => {
  it('cède une image entre les lots et maintient la progression quand des tâches sont ajoutées', async () => {
    vi.useFakeTimers();
    const frames = browserFrames();
    const queue = new WorkQueue();
    let clock = 0;
    const pump = queue.pump.bind(queue);
    const calls = vi.spyOn(queue, 'pump').mockImplementation((budget) => pump(budget, () => clock));
    const task = () => { clock += 10; };
    queue.defer(task);
    queue.defer(() => {
      task();
      queue.defer(task);
      queue.defer(task);
      queue.defer(task);
    });
    const progress: number[] = [];
    const drained = drainStartupQueue(queue, (fraction) => progress.push(fraction));
    expect(calls).not.toHaveBeenCalled();
    await frames.paint();
    expect(progress).toEqual([0.5]);
    await frames.paint();
    expect(progress).toEqual([0.5]);
    await frames.paint();
    await frames.paint();
    await frames.paint();
    await drained;
    expect(calls.mock.calls).toEqual([[6], [6], [6], [6], [6]]);
    expect(progress).toEqual([0.5, 0.6, 0.8, 1]);
    expect(queue.size).toBe(0);
  });

  it('avance après 60 ms quand aucune image ne se présente', async () => {
    vi.useFakeTimers();
    const frames = browserFrames();
    const queue = new WorkQueue();
    const work = vi.fn();
    queue.defer(work);
    const drained = drainStartupQueue(queue);
    await vi.advanceTimersByTimeAsync(59);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await drained;
    expect(work).toHaveBeenCalledOnce();
    expect(frames.pending.size).toBe(0);
  });
});
