// @vitest-environment jsdom
// #123: an edit inside the save debounce was lost on reload, because the page
// is torn down before the pagehide flush's IndexedDB write commits. The
// session journals unsaved snapshots to Web Storage at teardown and replays
// them on the next boot.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { createCharacterSessionStore, installCharacterSessionLifecycle } from './characterSession';
import {
  contentHash,
  type JournalBase,
  journalKey,
  MAX_JOURNAL_CHARS,
  readJournal,
  writeJournalEntry,
} from './saveJournal';

function character(id: string, name = id.toUpperCase()): CharacterDoc {
  return newCharacterDoc(id, name, 'test-tag');
}

/** A Web Storage stand-in, so each test owns its own and can make it fail. */
function memoryStorage() {
  const map = new Map<string, string>();
  const area = {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => {
      map.set(k, String(v));
    }),
    removeItem: vi.fn((k: string) => {
      map.delete(k);
    }),
    clear: () => map.clear(),
  };
  return { area, storage: () => area as unknown as Storage };
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

/** A fake repo shared by every session (tab) a test opens. */
function repo(...docs: CharacterDoc[]) {
  const rows = new Map(docs.map((d) => [d.id, structuredClone(d)]));
  const put = vi.fn(async (doc: CharacterDoc) => {
    rows.set(doc.id, structuredClone(doc));
  });
  const get = vi.fn(async (id: string) => structuredClone(rows.get(id)));
  return { rows, characters: { get, put } };
}

/** An entry replayable over a row holding `over` (by default, the doc's own id, unedited). */
function entryText(doc: unknown, bases?: JournalBase[]): string {
  const id = (doc as { id: string }).id;
  return JSON.stringify({ v: 1, bases: bases ?? [{ hash: contentHash(character(id)) }], doc });
}

function base(doc: CharacterDoc, label?: string): JournalBase {
  return { hash: contentHash(doc), label };
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.restoreAllMocks();
});

function pagehide() {
  window.dispatchEvent(new Event('pagehide'));
}

describe('journaling unsaved edits at page teardown', () => {
  it('journals on pagehide only when an edit is waiting, never on the edit itself', async () => {
    const { area, storage } = memoryStorage();
    const put = deferred<void>();
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put: () => put.promise },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');

    pagehide();
    expect(area.setItem).not.toHaveBeenCalled();

    session.getState().update((doc) => {
      doc.play.inspiration = true;
    });
    expect(area.setItem).not.toHaveBeenCalled();

    pagehide();
    const [entry] = readJournal(storage);
    expect(entry?.doc.play.inspiration).toBe(true);
    // Built on the row it read.
    expect(entry?.bases).toEqual([base(character('a'))]);
  });

  it('journals on the page becoming hidden too', async () => {
    const { storage } = memoryStorage();
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put: () => new Promise(() => undefined) },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Hidden';
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(readJournal(storage).map((e) => e.doc.name)).toEqual(['Hidden']);
  });

  it('journals against the row it last saved, not the one it first read', async () => {
    const { storage } = memoryStorage();
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put: vi.fn(async () => undefined) },
      // History lags the put; the row is already saved while this is pending.
      history: { record: () => new Promise(() => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Saved';
    });
    void session.getState().flush();
    // The put lands; the history write after it never does.
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.getState().update((doc) => {
      doc.name = 'Unsaved';
    });
    session.getState().journalUnsaved();
    expect(readJournal(storage).map((e) => [e.doc.name, e.bases])).toEqual([
      ['Unsaved', [base(character('a', 'Saved'))]],
    ]);
  });

  it('journals a write still in flight, and the newer edit queued behind it', async () => {
    const { storage } = memoryStorage();
    const first = deferred<void>();
    const put = vi.fn<(doc: CharacterDoc) => Promise<void>>(() => first.promise);
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'In flight';
    }, 'Long rest');
    void session.getState().flush();
    expect(put).toHaveBeenCalledTimes(1);

    // Only the in-flight write is unsaved: it is journaled.
    pagehide();
    expect(readJournal(storage).map((e) => [e.doc.name, e.bases])).toEqual([
      ['In flight', [base(character('a'), 'Long rest')]],
    ]);

    // A newer edit waits behind it and drains only after it lands, which a
    // teardown never sees: the newer one is journaled, replayable over either
    // row. Over the old row it stands for the lost named action too.
    session.getState().update((doc) => {
      doc.name = 'Queued';
    });
    pagehide();
    expect(readJournal(storage).map((e) => [e.doc.name, e.bases])).toEqual([
      ['Queued', [base(character('a'), 'Long rest'), base(character('a', 'In flight'))]],
    ]);
  });

  it('clears the entry once the write lands, but not for an older write', async () => {
    const { area, storage } = memoryStorage();
    const writes: Array<ReturnType<typeof deferred<void>>> = [];
    const session = createCharacterSessionStore({
      characters: {
        get: async () => character('a'),
        put: () => {
          const write = deferred<void>();
          writes.push(write);
          return write.promise;
        },
      },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Older';
    });
    const flushed = session.getState().flush();
    session.getState().update((doc) => {
      doc.name = 'Newer';
    });
    pagehide();
    expect(area.map.has(journalKey('a'))).toBe(true);

    // The older write landing does not cover the journaled newer snapshot.
    writes[0]?.resolve();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(readJournal(storage).map((e) => e.doc.name)).toEqual(['Newer']);

    writes[1]?.resolve();
    await flushed;
    expect(area.map.has(journalKey('a'))).toBe(false);
  });

  it("leaves another tab's newer entry when its own write lands", async () => {
    const { area, storage } = memoryStorage();
    const write = deferred<void>();
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put: () => write.promise },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'This tab';
    });
    pagehide();
    const other = entryText(character('a', 'Other tab'));
    area.map.set(journalKey('a'), other);

    write.resolve();
    await session.getState().flush();
    expect(area.map.get(journalKey('a'))).toBe(other);
  });

  it('keeps flushing when storage throws or the entry is too large', async () => {
    const put = vi.fn(async () => undefined);
    const session = createCharacterSessionStore({
      characters: { get: async () => character('a'), put },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    uninstall = installCharacterSessionLifecycle(session);
    await session.getState().load('a');
    session.getState().update((doc) => {
      doc.name = 'Still saved';
    });
    expect(() => pagehide()).not.toThrow();
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));

    const quota = memoryStorage();
    quota.area.setItem.mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(writeJournalEntry(quota.storage, { doc: character('a'), bases: [] })).toBeUndefined();

    const big = memoryStorage();
    const huge = character('a');
    huge.notes = 'x'.repeat(MAX_JOURNAL_CHARS);
    expect(writeJournalEntry(big.storage, { doc: huge, bases: [] })).toBeUndefined();
    expect(big.area.setItem).not.toHaveBeenCalled();
  });
});

describe('replaying the journal on boot', () => {
  it('replays a snapshot over the row it was built on, before the character is shown', async () => {
    const { area, storage } = memoryStorage();
    const edited = character('a');
    edited.play.inspiration = true;
    area.map.set(journalKey('a'), entryText(edited));
    const { rows, characters } = repo(character('a'));
    const session = createCharacterSessionStore({
      characters,
      history: { record: vi.fn(async () => 'row') },
      journal: storage,
    });

    expect(await session.getState().load('a')).toBe(true);

    expect(session.getState().doc?.play.inspiration).toBe(true);
    expect(rows.get('a')?.play.inspiration).toBe(true);
    expect(characters.put).toHaveBeenCalledTimes(1);
    expect(area.map.has(journalKey('a'))).toBe(false);
  });

  it('records the replayed edit in history once, under the label it would have had', async () => {
    const { area, storage } = memoryStorage();
    const edited = character('a');
    edited.play.inspiration = true;
    area.map.set(journalKey('a'), entryText(edited));
    const rested = character('b');
    rested.play.currentHp = 3;
    area.map.set(journalKey('b'), entryText(rested, [base(character('b'), 'Long rest')]));
    const { characters } = repo(character('a'), character('b'));
    const record = vi.fn(async (_doc: CharacterDoc, _label: string) => 'row');
    const session = createCharacterSessionStore({
      characters,
      history: { record },
      journal: storage,
    });

    await session.getState().replayJournal();
    await session.getState().replayJournal();
    await session.getState().load('a');

    expect(record.mock.calls.map(([doc, label]) => [doc.id, label])).toEqual([
      ['a', 'Inspiration gained'],
      ['b', 'Long rest'],
    ]);
  });

  it('labels the replay for the row it lands on', async () => {
    // Journaled with a "Long rest" still in flight: if that write did land,
    // the replay is only the edit after it, and must not claim the rest.
    const rested = character('a', 'Rested');
    const latest = character('a', 'Renamed after');
    const text = entryText(latest, [base(character('a'), 'Long rest'), base(rested)]);
    const labels = async (stored: CharacterDoc) => {
      const { area, storage } = memoryStorage();
      area.map.set(journalKey('a'), text);
      const record = vi.fn(async (_doc: CharacterDoc, _label: string) => 'row');
      await createCharacterSessionStore({
        characters: repo(stored).characters,
        history: { record },
        journal: storage,
      })
        .getState()
        .replayJournal();
      return record.mock.calls.map(([, label]) => label);
    };

    expect(await labels(character('a'))).toEqual(['Long rest']);
    expect(await labels(rested)).toEqual(['Renamed to Renamed after']);
  });

  it('does not replay an edit the stored row already has', async () => {
    // Replaying it would add a history row for a change that is not there.
    const { area, storage } = memoryStorage();
    const edited = character('a');
    edited.play.inspiration = true;
    area.map.set(journalKey('a'), entryText(edited, [base(edited)]));
    const { characters } = repo(edited);
    const record = vi.fn(async () => 'row');
    const session = createCharacterSessionStore({
      characters,
      history: { record },
      journal: storage,
    });

    await session.getState().load('a');

    expect(characters.put).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(area.map.has(journalKey('a'))).toBe(false);
  });

  it('never replays over a row another tab saved since', async () => {
    const { area, storage } = memoryStorage();
    area.map.set(journalKey('a'), entryText(character('a', 'Stale edit')));
    const { characters } = repo(character('a', 'Saved later in another tab'));
    const session = createCharacterSessionStore({
      characters,
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });

    await session.getState().load('a');

    expect(session.getState().doc?.name).toBe('Saved later in another tab');
    expect(characters.put).not.toHaveBeenCalled();
    expect(area.map.has(journalKey('a'))).toBe(false);
  });

  it('never replays a save left for Retry over a newer edit from another tab', async () => {
    // Tab A's save fails and is kept for Retry; tab B then saves a newer edit;
    // only later does A go away and journal its old snapshot. However late
    // that is, B's edit must stand.
    const { area, storage } = memoryStorage();
    const shared = repo(character('a'));
    const failing = vi.fn(async () => {
      throw new Error('quota exceeded');
    });
    const tabA = createCharacterSessionStore({
      characters: { get: shared.characters.get, put: failing },
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
      journal: storage,
    });
    await tabA.getState().load('a');
    tabA.getState().update((doc) => {
      doc.name = 'A, never saved';
    });
    await expect(tabA.getState().flush()).rejects.toThrow('quota exceeded');

    const tabB = createCharacterSessionStore({
      characters: shared.characters,
      history: { record: vi.fn(async () => undefined) },
      debounceMs: 10_000,
    });
    await tabB.getState().load('a');
    tabB.getState().update((doc) => {
      doc.name = 'B, saved';
    });
    await tabB.getState().flush();

    tabA.getState().journalUnsaved();
    expect(area.map.has(journalKey('a'))).toBe(true);

    const booted = createCharacterSessionStore({
      characters: shared.characters,
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });
    await booted.getState().load('a');
    expect(booted.getState().doc?.name).toBe('B, saved');
    expect(shared.rows.get('a')?.name).toBe('B, saved');
    expect(area.map.has(journalKey('a'))).toBe(false);
  });

  it('does not bring back a character deleted since', async () => {
    const { area, storage } = memoryStorage();
    area.map.set(journalKey('gone'), entryText(character('gone', 'Edited')));
    const { characters } = repo();
    const session = createCharacterSessionStore({
      characters,
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });

    expect(await session.getState().load('gone')).toBe(false);
    expect(characters.put).not.toHaveBeenCalled();
    expect(area.map.size).toBe(0);
  });

  it('drops corrupt entries, keeps ones from a newer version, and still loads', async () => {
    // Each bad entry is otherwise replayable (its row exists and holds the
    // entry's base), so only validation keeps it out.
    const ids = [
      'a',
      'json',
      'shape',
      'other',
      'future',
      'version',
      'noversion',
      'v0',
      'v1.5',
      'v-3',
      'futureshape',
      'fractionschema',
      'bases',
      'hash',
      'label',
      'array',
      'huge',
      'long',
    ];
    const edited = (id: string, name = 'Edited'): CharacterDoc => character(id, name);
    const bases = (id: string) => [base(character(id))];
    const { area, storage } = memoryStorage();
    area.map.set(journalKey('a'), entryText(edited('a', 'Recovered')));
    area.map.set(journalKey('json'), '{not json');
    area.map.set(journalKey('shape'), entryText({ ...edited('shape'), classes: 'x' }));
    area.map.set(journalKey('other'), entryText(edited('a', 'Wrong character'), bases('other')));
    area.map.set(journalKey('future'), entryText({ ...edited('future'), schemaVersion: 99 }));
    // A newer schema that changed a field's type is still kept for its app.
    area.map.set(
      journalKey('futureshape'),
      entryText({ ...edited('futureshape'), schemaVersion: 2, classes: { reshaped: true } }),
    );
    area.map.set(
      journalKey('fractionschema'),
      entryText({ ...edited('fractionschema'), schemaVersion: 1.5 }),
    );
    // Only a later integer format is kept; any other version is corrupt.
    for (const v of [0, 1.5, -3]) {
      area.map.set(
        journalKey(`v${v}`),
        JSON.stringify({ v, bases: bases(`v${v}`), doc: edited(`v${v}`) }),
      );
    }
    area.map.set(
      journalKey('version'),
      JSON.stringify({ v: 2, bases: bases('version'), doc: edited('version') }),
    );
    area.map.set(
      journalKey('noversion'),
      JSON.stringify({ bases: bases('noversion'), doc: edited('noversion') }),
    );
    area.map.set(journalKey('bases'), JSON.stringify({ v: 1, bases: 'x', doc: edited('bases') }));
    area.map.set(journalKey('hash'), entryText(edited('hash'), [{ hash: 7 } as never]));
    area.map.set(
      journalKey('label'),
      entryText(edited('label'), [base(character('label'), 'x'.repeat(501))]),
    );
    area.map.set(journalKey('array'), '[]');
    // Every string within the import limits, the whole past the journal's.
    const chunk = 'x'.repeat(100_000);
    const choices = Object.fromEntries(
      Array.from({ length: MAX_JOURNAL_CHARS / chunk.length }, (_, i) => [`k${i}`, chunk]),
    );
    area.map.set(journalKey('huge'), entryText({ ...edited('huge'), choices }));
    // One string past the import limit, the entry within the journal's.
    area.map.set(journalKey('long'), entryText({ ...edited('long'), notes: 'x'.repeat(250_000) }));
    area.map.set('someone-else', 'keep');
    const { characters } = repo(...ids.map((id) => character(id)));
    const session = createCharacterSessionStore({
      characters,
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });

    await session.getState().load('a');

    expect(session.getState().doc?.name).toBe('Recovered');
    expect(characters.put.mock.calls.map(([doc]) => [doc.id, doc.name])).toEqual([
      ['a', 'Recovered'],
    ]);
    // A later version of the app may be able to replay these.
    expect([...area.map.keys()]).toEqual([
      journalKey('future'),
      journalKey('futureshape'),
      journalKey('version'),
      'someone-else',
    ]);
  });

  it('loads normally when storage cannot be read at all', async () => {
    const { characters } = repo(character('a'));
    const session = createCharacterSessionStore({
      characters,
      history: { record: vi.fn(async () => undefined) },
      journal: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(await session.getState().load('a')).toBe(true);
    expect(characters.put).not.toHaveBeenCalled();
  });

  it('keeps an entry it could not check, and queues one it could not save', async () => {
    const { area, storage } = memoryStorage();
    area.map.set(journalKey('a'), entryText(character('a', 'Unsaved')));
    const get = vi
      .fn<(id: string) => Promise<CharacterDoc | undefined>>()
      .mockRejectedValueOnce(new Error('read failed'));
    const unreadable = createCharacterSessionStore({
      characters: { get, put: vi.fn(async () => undefined) },
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });
    await unreadable.getState().replayJournal();
    expect(area.map.has(journalKey('a'))).toBe(true);

    const session = createCharacterSessionStore({
      characters: {
        get: async () => character('a'),
        put: vi.fn(async () => {
          throw new Error('quota exceeded');
        }),
      },
      history: { record: vi.fn(async () => undefined) },
      journal: storage,
    });
    expect(await session.getState().load('a')).toBe(true);
    expect(session.getState().doc?.name).toBe('Unsaved');
    expect(session.getState().saveErrors).toEqual({ a: 'quota exceeded' });
    expect(area.map.has(journalKey('a'))).toBe(true);
  });
});
