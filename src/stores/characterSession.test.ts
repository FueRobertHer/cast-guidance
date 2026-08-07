import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc } from '@/engine/types';
import { newCharacterDoc } from '@/engine/types';
import { createCharacterSessionStore } from './characterSession';

function character(id: string, name = id.toUpperCase()): CharacterDoc {
  return newCharacterDoc(id, name, 'test-tag');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('character session persistence', () => {
  it('flushes character A before loading and editing character B', async () => {
    const docs = new Map([
      ['a', character('a')],
      ['b', character('b')],
    ]);
    const put = vi.fn(async (doc: CharacterDoc) => {
      docs.set(doc.id, structuredClone(doc));
    });
    const record = vi.fn(async () => undefined);
    const session = createCharacterSessionStore({
      characters: {
        get: vi.fn(async (id: string) => structuredClone(docs.get(id))),
        put,
      },
      history: { record },
      debounceMs: 10_000,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'A edited';
    });
    await session.getState().load('b');
    session.getState().update((doc) => {
      doc.name = 'B edited';
    });
    await session.getState().flush();

    expect(docs.get('a')?.name).toBe('A edited');
    expect(docs.get('b')?.name).toBe('B edited');
    expect(put.mock.calls.map(([doc]) => doc.id)).toEqual(['a', 'b']);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('ignores late reads during rapid A to B to C navigation', async () => {
    const reads = new Map<string, ReturnType<typeof deferred<CharacterDoc | undefined>>>();
    const get = vi.fn((id: string) => {
      const read = deferred<CharacterDoc | undefined>();
      reads.set(id, read);
      return read.promise;
    });
    const session = createCharacterSessionStore({
      characters: { get, put: vi.fn(async () => undefined) },
      history: { record: vi.fn(async () => undefined) },
    });

    const loadA = session.getState().load('a');
    reads.get('a')?.resolve(character('a'));
    await loadA;

    const loadB = session.getState().load('b');
    expect(session.getState()).toMatchObject({
      doc: null,
      requestedId: 'b',
      loadStatus: 'loading',
    });
    session.getState().update((doc) => {
      doc.name = 'Must not apply';
    });
    expect(session.getState().doc).toBeNull();
    const loadC = session.getState().load('c');
    reads.get('c')?.resolve(character('c'));
    await loadC;

    expect(session.getState().doc?.id).toBe('c');
    reads.get('b')?.resolve(character('b'));
    await loadB;
    expect(session.getState()).toMatchObject({
      requestedId: 'c',
      loadStatus: 'ready',
    });
    expect(session.getState().doc?.id).toBe('c');
  });

  it('retains a failed write and clears the visible error after Retry', async () => {
    const put = vi
      .fn<(doc: CharacterDoc) => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined);
    const session = createCharacterSessionStore({
      characters: { get: vi.fn(async () => character('a')), put },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Not lost';
    });
    await expect(session.getState().flush()).rejects.toThrow('quota exceeded');
    expect(session.getState()).toMatchObject({
      saveStatus: 'error',
      saveErrors: { a: 'quota exceeded' },
    });
    session.getState().update((doc) => {
      doc.name = 'Newest edit';
    });
    expect(session.getState().saveErrors).toEqual({ a: 'quota exceeded' });

    await session.getState().retryFailedSaves();
    expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Newest edit' }));
    expect(session.getState()).toMatchObject({ saveStatus: 'saved', saveErrors: {} });
  });

  it('serializes writes so an older snapshot cannot overwrite a newer edit', async () => {
    const firstWrite = deferred<void>();
    const names: string[] = [];
    const put = vi.fn(async (doc: CharacterDoc) => {
      names.push(doc.name);
      if (names.length === 1) await firstWrite.promise;
    });
    const session = createCharacterSessionStore({
      characters: { get: vi.fn(async () => character('a')), put },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'First';
    });
    const flushing = session.getState().flush();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    session.getState().update((doc) => {
      doc.name = 'Second';
    });
    firstWrite.resolve();
    await flushing;

    expect(names).toEqual(['First', 'Second']);
    expect(session.getState().saveStatus).toBe('saved');
  });

  it('handles debounced write failures without an unhandled rejection', async () => {
    vi.useFakeTimers();
    const session = createCharacterSessionStore({
      characters: {
        get: vi.fn(async () => character('a')),
        put: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 50,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Queued';
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(session.getState()).toMatchObject({
      saveStatus: 'error',
      saveErrors: { a: 'database unavailable' },
    });
  });
});

describe('history labels for named actions', () => {
  /** A session whose only observable output is the label handed to history. */
  const labelSession = () => {
    const record = vi.fn(async (_doc: CharacterDoc, _label: string) => undefined);
    const session = createCharacterSessionStore({
      characters: {
        get: vi.fn(async (id: string) => character(id)),
        put: vi.fn(async () => undefined),
      },
      history: { record },
      debounceMs: 10_000,
    });
    const labels = () => record.mock.calls.map(([, label]) => label);
    return { session, record, labels };
  };

  it('records the action label instead of a diff-inferred one', async () => {
    const { session, labels } = labelSession();
    await session.getState().load('a');

    session.getState().update((doc) => {
      doc.play.turn = { action: true, bonus: false, reaction: false };
    }, 'Attacked with Longsword');
    await session.getState().flush();

    expect(labels()[0]).toBe('Attacked with Longsword');
  });

  it('resolves a function label against the updated doc', async () => {
    const { session, labels } = labelSession();
    await session.getState().load('a');

    session.getState().update(
      (doc) => {
        doc.play.slotsSpent[2] = 1;
      },
      (doc) => `Cast Fireball (L${doc.play.slotsSpent.findIndex((n) => n > 0) + 1})`,
    );
    await session.getState().flush();

    expect(labels()[0]).toBe('Cast Fireball (L3)');
  });

  it('keeps the action label when an unlabelled edit coalesces with it', async () => {
    const { session, record, labels } = labelSession();
    await session.getState().load('a');

    // Both land inside the debounce window, so they become one snapshot. The
    // named action is what the reader did; the HP tweak rode along with it.
    session.getState().update((doc) => {
      doc.play.currentHp = 12;
    }, 'Long rest');
    session.getState().update((doc) => {
      doc.play.tempHp = 5;
    });
    await session.getState().flush();

    expect(record).toHaveBeenCalledTimes(1);
    expect(labels()[0]).toBe('Long rest');
  });

  it('lets a newer named action replace an older one', async () => {
    const { session, labels } = labelSession();
    await session.getState().load('a');

    session.getState().update((doc) => {
      doc.play.tempHp = 1;
    }, 'Short rest');
    session.getState().update((doc) => {
      doc.play.tempHp = 2;
    }, 'Long rest');
    await session.getState().flush();

    expect(labels()[0]).toBe('Long rest');
  });

  it('still infers a label when the caller names nothing', async () => {
    const { session, labels } = labelSession();
    await session.getState().load('a');

    session.getState().update((doc) => {
      doc.play.inspiration = true;
    });
    await session.getState().flush();

    expect(labels()[0]).toBe('Inspiration gained');
  });
});

describe('history labels across a failed save', () => {
  it('does not lend a failed action label to a later unrelated edit', async () => {
    const record = vi.fn(async (_doc: CharacterDoc, _label: string) => undefined);
    const put = vi
      .fn<(doc: CharacterDoc) => Promise<void>>()
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValue(undefined);
    const session = createCharacterSessionStore({
      characters: { get: vi.fn(async () => character('a')), put },
      history: { record },
      debounceMs: 10_000,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    }, 'Long rest');
    await expect(session.getState().flush()).rejects.toThrow('quota exceeded');

    // The failed snapshot waits for Retry with no time bound, so an edit
    // arriving arbitrarily later is not part of that rest.
    session.getState().update((doc) => {
      doc.notes = 'much later';
    });
    await session.getState().flush();

    // The inferred label names both changes; inheriting "Long rest" would have
    // named one of them wrongly and hidden the other.
    expect(record.mock.calls.map(([, label]) => label)).toEqual(['Notes · HP 0→4']);
  });

  it('still retries a failed labelled save under its own label', async () => {
    const record = vi.fn(async (_doc: CharacterDoc, _label: string) => undefined);
    const put = vi
      .fn<(doc: CharacterDoc) => Promise<void>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const session = createCharacterSessionStore({
      characters: { get: vi.fn(async () => character('a')), put },
      history: { record },
      debounceMs: 10_000,
    });

    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    }, 'Long rest');
    await expect(session.getState().flush()).rejects.toThrow('disk full');
    await session.getState().retryFailedSaves();

    expect(record.mock.calls.map(([, label]) => label)).toEqual(['Long rest']);
  });
});
