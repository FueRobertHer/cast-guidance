import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Semaphore', () => {
  it('rejects a non-positive permit count', () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
  });

  it('never exceeds the permit count under heavy contention', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 20 }, () => deferred<void>());

    const tasks = gates.map((g, i) =>
      sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await g.promise;
        active -= 1;
        return i;
      }),
    );

    // Let the first wave acquire; only `permits` may be active at once.
    await Promise.resolve();
    await Promise.resolve();
    expect(active).toBe(3);

    // Release gates one at a time; peak must stay bounded throughout.
    for (const g of gates) {
      g.resolve();
      await Promise.resolve();
    }
    const results = await Promise.all(tasks);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBe(3);
  });

  it('serializes fully with a single permit and preserves FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const tasks = [1, 2, 3].map((n) =>
      sem.run(async () => {
        order.push(n);
      }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases the permit even when the task throws', async () => {
    const sem = new Semaphore(1);
    await expect(
      sem.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // A subsequent task can still acquire the freed permit.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});
