import { describe, expect, it } from 'vitest';
import { singleFlight } from './singleFlight';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('runs the factory once for concurrent calls with the same key', async () => {
    const map = new Map<string, Promise<number>>();
    let calls = 0;
    const d = deferred<number>();
    const factory = () => {
      calls += 1;
      return d.promise;
    };

    const a = singleFlight(map, 'k', factory);
    const b = singleFlight(map, 'k', factory);
    expect(a).toBe(b);
    expect(calls).toBe(1);

    d.resolve(42);
    expect(await a).toBe(42);
    expect(await b).toBe(42);
  });

  it('runs the factory per distinct key', async () => {
    const map = new Map<string, Promise<string>>();
    let calls = 0;
    const run = (k: string) =>
      singleFlight(map, k, async () => {
        calls += 1;
        return k;
      });
    const [x, y] = await Promise.all([run('a'), run('b')]);
    expect([x, y]).toEqual(['a', 'b']);
    expect(calls).toBe(2);
  });

  it('clears the entry after settling so a later call re-runs', async () => {
    const map = new Map<string, Promise<number>>();
    let calls = 0;
    const run = () =>
      singleFlight(map, 'k', async () => {
        calls += 1;
        return calls;
      });
    expect(await run()).toBe(1);
    expect(map.has('k')).toBe(false);
    expect(await run()).toBe(2);
    expect(calls).toBe(2);
  });

  it('clears the entry on rejection too', async () => {
    const map = new Map<string, Promise<number>>();
    await expect(
      singleFlight(map, 'k', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(map.has('k')).toBe(false);
    await expect(singleFlight(map, 'k', async () => 7)).resolves.toBe(7);
  });
});
