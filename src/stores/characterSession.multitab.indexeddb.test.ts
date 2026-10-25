// Two tabs editing one character (TEST-002, REL-007 #98). Each tab is its own
// session store, as each browser tab has its own module instance, and both
// write through the real repositories to the same IndexedDB. A tab's save is
// checked against the revision it last read, so a stale tab is refused
// instead of writing its whole document over the other tab's change.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterRepo, type SaveExpect } from '@/db/characterRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import {
  createCharacterSessionStore,
  KEPT_LABEL,
  NOT_SAVED_LABEL,
  REPLACED_LABEL,
  SaveConflictError,
  type SessionCharacters,
} from './characterSession';
import { readJournal } from './saveJournal';

/** The database's clock: both tabs share one machine. */
let clock = 1_000_000;

function openTab({
  characters = characterRepo,
  history = historyRepo,
  debounceMs = 60_000,
}: {
  characters?: SessionCharacters;
  history?: Pick<typeof historyRepo, 'record'>;
  debounceMs?: number;
} = {}) {
  // Each tab keeps its own clock for grouping edits, as two tabs would.
  let tabClock = clock;
  const session = createCharacterSessionStore({
    characters,
    history,
    debounceMs,
    now: () => tabClock,
  });
  const edit = async (recipe: (doc: CharacterDoc) => void) => {
    clock += 1_000;
    tabClock = clock;
    session.getState().update(recipe);
    await session.getState().flush();
  };
  return { session, edit, state: () => session.getState() };
}

type Tab = ReturnType<typeof openTab>;

/** The real repository, counting the saves it is asked for. */
function countingRepo() {
  const saves: SaveExpect[] = [];
  const repo: SessionCharacters = {
    getWithRevision: (id) => characterRepo.getWithRevision(id),
    save: (doc, expect) => {
      saves.push(expect);
      return characterRepo.save(doc, expect);
    },
  };
  return { saves, repo };
}

/** Name and current HP, the two fields the tabs fight over. */
function pair(doc: CharacterDoc | null | undefined) {
  return [doc?.name, doc?.play.currentHp];
}

async function storedPair() {
  return pair(await characterRepo.get('c1'));
}

const rename = (doc: CharacterDoc) => {
  doc.name = 'Wren the Bold';
};
const hp = (n: number) => (doc: CharacterDoc) => {
  doc.play.currentHp = n;
};

/** History rows must order strictly by time, even when written in one millisecond. */
function expectStrictlyIncreasing(ats: number[]): void {
  for (let i = 1; i < ats.length; i++) expect(ats[i]).toBeGreaterThan(ats[i - 1] ?? Infinity);
}

/** Both tabs open; A saves HP 3, then B, still holding HP 10, renames and is refused. */
async function conflicted(bOpts?: Parameters<typeof openTab>[0]): Promise<{ a: Tab; b: Tab }> {
  const a = openTab();
  const b = openTab(bOpts);
  await a.state().load('c1');
  await b.state().load('c1');
  await a.edit(hp(3));
  await expect(b.edit(rename)).rejects.toBeInstanceOf(SaveConflictError);
  return { a, b };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const doc = newCharacterDoc('c1', 'Wren', 'tag');
  doc.play.currentHp = 10;
  await characterRepo.put(doc);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('one character open in two tabs', () => {
  it("refuses a stale tab's save: tab B's rename is not written over tab A's HP change (REL-007)", async () => {
    // This flips the last-writer-wins test that pinned the behaviour before
    // the revision check, on purpose: B wrote its whole document, HP 10 and
    // all, over A's HP 3.
    const { b } = await conflicted();

    expect(await storedPair()).toEqual(['Wren', 3]);
    expect(b.state().saveConflicts).toEqual({ c1: { kind: 'changed', name: 'Wren the Bold' } });
    expect(b.state().saveStatus).toBe('conflict');
    // Never a save error, so Retry cannot target it.
    expect(b.state().saveErrors).toEqual({});
    // Kept in memory, not lost.
    expect(pair(b.state().doc)).toEqual(['Wren the Bold', 10]);
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => pair(r.doc))).toEqual([['Wren', 3]]);
  });

  it('refuses a save over a row older code rewrote, though it kept the revision', async () => {
    // An older build passes the stored revision through and writes it back,
    // so only the content shows the row changed.
    const b = openTab();
    await b.state().load('c1');
    const row = await db.characters.get('c1');
    if (row === undefined) throw new Error('no row');
    await db.characters.put({ ...row, play: { ...row.play, currentHp: 1 } });

    await expect(b.edit(rename)).rejects.toBeInstanceOf(SaveConflictError);
    expect(await storedPair()).toEqual(['Wren', 1]);
  });

  describe('Reload stored version', () => {
    it("shows the stored copy, keeps this tab's edits in history, and saves the next edit", async () => {
      const { b } = await conflicted();

      await expect(b.state().resolveConflict('c1', 'reload')).resolves.toBe('reloaded');

      expect(pair(b.state().doc)).toEqual(['Wren', 3]);
      expect(b.state().saveConflicts).toEqual({});
      const [newest] = await historyRepo.list('c1');
      expect(newest?.label).toBe(NOT_SAVED_LABEL);
      expect(pair(newest?.doc)).toEqual(['Wren the Bold', 10]);
      // The stored revision was adopted, so this is not refused again.
      await b.edit((doc) => {
        doc.play.inspiration = true;
      });
      const stored = await characterRepo.get('c1');
      expect([...pair(stored), stored?.play.inspiration]).toEqual(['Wren', 3, true]);
    });

    it('keeps an edit typed while the stored copy was being read', async () => {
      const { b } = await conflicted();

      const reload = b.state().resolveConflict('c1', 'reload');
      b.state().update((doc) => {
        doc.notes = 'typed while it loaded';
      });
      await reload;

      const [newest] = await historyRepo.list('c1');
      expect(newest?.label).toBe(NOT_SAVED_LABEL);
      expect(newest?.doc.notes).toBe('typed while it loaded');
      expect(b.state().doc?.notes).toBe('');
    });

    it('offers the deleted choices instead when the character was deleted meanwhile', async () => {
      const { b } = await conflicted();
      await characterRepo.delete('c1');

      await expect(b.state().resolveConflict('c1', 'reload')).resolves.toBeUndefined();
      expect(b.state().saveConflicts).toEqual({ c1: { kind: 'deleted', name: 'Wren the Bold' } });
      expect(pair(b.state().doc)).toEqual(['Wren the Bold', 10]);
    });
  });

  describe('Keep mine', () => {
    it('saves this tab over the stored copy, as its own history entry', async () => {
      const { b } = await conflicted();

      await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBe('kept');

      expect(await storedPair()).toEqual(['Wren the Bold', 10]);
      const [newest] = await historyRepo.list('c1');
      expect(newest?.label).toBe(KEPT_LABEL);
      expect(b.state().saveConflicts).toEqual({});
      expect(b.state().saveStatus).toBe('saved');
    });

    it('replaces what is stored when it is chosen, however many saves landed since the refusal', async () => {
      // Checked against the refusal's revision instead, it would be refused
      // again on every click while the other tab keeps saving.
      const { a, b } = await conflicted();
      await a.edit(hp(2));

      await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBe('kept');
      expect(await storedPair()).toEqual(['Wren the Bold', 10]);
    });

    it('is still a checked save: a write landing after the choice is refused again', async () => {
      let interleave: (() => Promise<void>) | undefined;
      const repo: SessionCharacters = {
        getWithRevision: async (id) => {
          const read = await characterRepo.getWithRevision(id);
          const step = interleave;
          interleave = undefined;
          await step?.();
          return read;
        },
        save: (doc, expect) => characterRepo.save(doc, expect),
      };
      const { a, b } = await conflicted({ characters: repo });
      // Tab A saves between Keep mine's read and its write.
      interleave = () => a.edit(hp(2));

      await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBeUndefined();
      expect(await storedPair()).toEqual(['Wren', 2]);
      expect(b.state().saveConflicts.c1?.kind).toBe('changed');
    });
  });

  it('writes nothing while the conflict is open, and Keep mine stores the latest edit', async () => {
    const counted = countingRepo();
    const { b } = await conflicted({ characters: counted.repo, debounceMs: 5 });
    const tried = counted.saves.length;

    b.state().update(hp(7));
    // The header keeps saying the edits are not saved, not "Unsaved".
    expect(b.state().saveStatus).toBe('conflict');
    await expect(b.state().flush()).rejects.toBeInstanceOf(SaveConflictError);
    // Past the debounce: no timer was set.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(counted.saves.length).toBe(tried);
    expect(await storedPair()).toEqual(['Wren', 3]);

    await b.state().resolveConflict('c1', 'overwrite');
    expect(await storedPair()).toEqual(['Wren the Bold', 7]);
  });

  it('leaves a conflict alone on Retry', async () => {
    const counted = countingRepo();
    const { b } = await conflicted({ characters: counted.repo });
    const tried = counted.saves.length;

    await expect(b.state().retryFailedSaves()).resolves.toBeUndefined();
    expect(counted.saves.length).toBe(tried);
    expect(b.state().saveConflicts.c1?.kind).toBe('changed');
  });

  it('settles saves racing from both tabs: one lands whole, the other is refused', async () => {
    const a = openTab();
    const b = openTab();
    await a.state().load('c1');
    await b.state().load('c1');

    a.state().update(hp(4));
    b.state().update(rename);
    const results = await Promise.allSettled([a.state().flush(), b.state().flush()]);

    const refused = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(SaveConflictError);
    // The character holds one tab's whole document, never a blend, and only
    // the save that landed has a history row.
    const stored = await storedPair();
    expect([
      ['Wren', 4],
      ['Wren the Bold', 10],
    ]).toContainEqual(stored);
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => pair(r.doc))).toEqual([stored]);
  });

  describe('a tab with nothing unsaved follows the other', () => {
    it("takes the other tab's save, and its own next edit lands on top", async () => {
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');

      await a.edit(hp(3));
      await b.state().refreshIfClean('c1');
      expect(pair(b.state().doc)).toEqual(['Wren', 3]);

      await b.edit(rename);
      expect(await storedPair()).toEqual(['Wren the Bold', 3]);
    });

    it('follows a rename made from the roster, which patches only the name', async () => {
      const b = openTab();
      await b.state().load('c1');
      await b.edit(hp(6));

      await characterRepo.rename('c1', 'Wren of the Roster');
      await b.state().refreshIfClean('c1');
      expect(pair(b.state().doc)).toEqual(['Wren of the Roster', 6]);
      await b.edit(hp(5));
      expect(await storedPair()).toEqual(['Wren of the Roster', 5]);
    });

    it('is not refreshed while it has an edit of its own, and that edit is refused', async () => {
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');

      b.state().update(rename);
      await a.edit(hp(3));
      await b.state().refreshIfClean('c1');

      expect(pair(b.state().doc)).toEqual(['Wren the Bold', 10]);
      await expect(b.state().flush()).rejects.toBeInstanceOf(SaveConflictError);
      expect(await storedPair()).toEqual(['Wren', 3]);
    });

    it('drops a refresh when an edit arrives while it reads', async () => {
      // Adopting the read after the edit would show the other tab's copy
      // with the edit gone from the screen, and then save the edit, built on
      // the old copy, under the new revision: over the other tab, unchecked.
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');
      await a.edit(hp(3));

      const refresh = b.state().refreshIfClean('c1');
      b.state().update(rename);
      await refresh;

      expect(pair(b.state().doc)).toEqual(['Wren the Bold', 10]);
      await expect(b.state().flush()).rejects.toBeInstanceOf(SaveConflictError);
      expect(await storedPair()).toEqual(['Wren', 3]);
    });

    it('looks again once its own save is done, for a save that landed meanwhile', async () => {
      // B's row is written but its history row is still going in when A
      // saves on top of it, so the change notice finds B busy.
      let release: () => void = () => undefined;
      let hold = false;
      const a = openTab();
      const b = openTab({
        history: {
          record: async (doc, label, opts) => {
            if (hold) await new Promise<void>((resolve) => (release = resolve));
            return historyRepo.record(doc, label, opts);
          },
        },
      });
      await a.state().load('c1');
      await b.state().load('c1');

      hold = true;
      b.state().update(hp(9));
      const saving = b.state().flush();
      await vi.waitFor(async () => expect(await storedPair()).toEqual(['Wren', 9]));
      await a.state().refreshIfClean('c1');
      await a.edit(rename);
      await b.state().refreshIfClean('c1');
      expect(pair(b.state().doc)).toEqual(['Wren', 9]);

      hold = false;
      release();
      await saving;
      await vi.waitFor(() => expect(pair(b.state().doc)).toEqual(['Wren the Bold', 9]));
      await b.edit(hp(8));
      expect(await storedPair()).toEqual(['Wren the Bold', 8]);
    });

    it('shows a character deleted in the other tab as not found', async () => {
      const b = openTab();
      await b.state().load('c1');
      await characterRepo.delete('c1');

      await b.state().refreshIfClean('c1');
      expect(b.state()).toMatchObject({ doc: null, loadStatus: 'missing' });
    });
  });

  describe("the sheet's own edits (HP following the maximum)", () => {
    const follow = (n: number) => (doc: CharacterDoc) => {
      doc.play.currentHp = n;
    };

    it('takes the stored copy quietly when only those were refused', async () => {
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');
      await a.edit(hp(3));

      b.state().update(follow(12), undefined, { automatic: true });
      await expect(b.state().flush()).resolves.toBeUndefined();

      expect(b.state().saveConflicts).toEqual({});
      expect(pair(b.state().doc)).toEqual(['Wren', 3]);
      expect((await historyRepo.list('c1')).map((r) => pair(r.doc))).toEqual([['Wren', 3]]);
    });

    it('saves none of them over a copy taken from the other tab until the person edits', async () => {
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');
      await a.edit(hp(3));
      await b.state().refreshIfClean('c1');

      b.state().update(follow(12), undefined, { automatic: true });
      expect(b.state().doc?.play.currentHp).toBe(12);
      await b.state().flush();
      expect(await storedPair()).toEqual(['Wren', 3]);

      // The person's edit carries the follow with it.
      await b.edit(rename);
      expect(await storedPair()).toEqual(['Wren the Bold', 12]);
    });

    it('raises the conflict when the person taps while one of them is being written', async () => {
      const a = openTab();
      const b = openTab();
      await a.state().load('c1');
      await b.state().load('c1');
      await a.edit(hp(3));

      b.state().update(follow(12), undefined, { automatic: true });
      const writing = b.state().flush();
      b.state().update(rename);

      await expect(writing).rejects.toBeInstanceOf(SaveConflictError);
      expect(b.state().saveConflicts.c1?.kind).toBe('changed');
      expect(pair(b.state().doc)).toEqual(['Wren the Bold', 12]);
    });

    it('settles when the two tabs derive different maxima, instead of trading writes', async () => {
      // Homebrew or game data changed in one tab only: each derives its own
      // maximum, and saving each follow over the other's would never stop.
      const row = await characterRepo.get('c1');
      if (row === undefined) throw new Error('no row');
      row.play.hpInitialized = false;
      await characterRepo.put(row);
      const counted = countingRepo();
      const a = openTab({ characters: counted.repo, debounceMs: 1 });
      const b = openTab({ characters: counted.repo, debounceMs: 1 });
      await a.state().load('c1');
      await b.state().load('c1');

      // What useCharacterSheet does after each render, with each tab's maximum.
      const sheet = (tab: Tab, max: number) => {
        const check = () =>
          queueMicrotask(() => {
            const doc = tab.state().doc;
            if (doc?.play.hpInitialized === false && doc.play.currentHp !== max) {
              tab.state().update(follow(max), undefined, { automatic: true });
            }
          });
        check();
        return tab.session.subscribe(check);
      };
      const stops = [
        sheet(a, 20),
        sheet(b, 24),
        characterRepo.onChange(() => {
          for (const tab of [a, b])
            void tab
              .state()
              .refreshIfClean('c1')
              .catch(() => undefined);
        }),
      ];
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (const stop of stops) stop();

      // Each tab's first follow, one of which is refused and adopted quietly.
      expect(counted.saves.length).toBeLessThanOrEqual(2);
      expect(a.state().saveConflicts).toEqual({});
      expect(b.state().saveConflicts).toEqual({});
    });
  });

  it('treats the same change made in both tabs as no conflict, writing nothing', async () => {
    const a = openTab();
    const b = openTab();
    await a.state().load('c1');
    await b.state().load('c1');
    await a.edit(hp(3));
    const revision = (await db.characters.get('c1'))?.revision;

    await expect(b.edit(hp(3))).resolves.toBeUndefined();
    expect(b.state().saveConflicts).toEqual({});
    expect((await db.characters.get('c1'))?.revision).toBe(revision);
    // And the stored revision is B's from here on.
    await b.edit(rename);
    expect(await storedPair()).toEqual(['Wren the Bold', 3]);
  });

  describe('deleted in the other tab', () => {
    async function deletedUnder(): Promise<Tab> {
      const b = openTab();
      await b.state().load('c1');
      await characterRepo.delete('c1');
      await expect(b.edit(rename)).rejects.toBeInstanceOf(SaveConflictError);
      return b;
    }

    it('is not brought back by the stale tab', async () => {
      const b = await deletedUnder();
      expect(await db.characters.get('c1')).toBeUndefined();
      expect(b.state().saveConflicts).toEqual({ c1: { kind: 'deleted', name: 'Wren the Bold' } });
    });

    it('comes back on Keep mine', async () => {
      const b = await deletedUnder();
      await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBe('kept');
      expect(await storedPair()).toEqual(['Wren the Bold', 10]);
      expect(b.state().saveConflicts).toEqual({});
    });

    it('stays deleted on Discard, and the sheet says it is not found', async () => {
      const b = await deletedUnder();
      await expect(b.state().resolveConflict('c1', 'reload')).resolves.toBe('discarded');
      expect(await db.characters.get('c1')).toBeUndefined();
      expect(await historyRepo.list('c1')).toEqual([]);
      expect(b.state()).toMatchObject({ doc: null, loadStatus: 'missing', saveConflicts: {} });
    });
  });

  it("never folds one tab's burst of HP taps into the other tab's history row", async () => {
    // Each switch between tabs goes through the refresh a clean tab gets
    // when the other saves, as it does in the browser.
    const a = openTab();
    const b = openTab();
    await a.state().load('c1');
    await b.state().load('c1');
    const turn = async (tab: Tab, n: number) => {
      await tab.state().refreshIfClean('c1');
      await tab.edit(hp(n));
    };

    await turn(a, 9);
    await turn(b, 8);
    // A's run started at 10, but it took B's copy: a fresh row, labelled
    // from there.
    await turn(a, 7);
    // Now A's row is the newest, so this tap folds into it.
    await turn(a, 6);
    await turn(b, 5);

    const rows = (await historyRepo.list('c1')).reverse();
    expect(rows.map((r) => r.doc.play.currentHp)).toEqual([9, 8, 6, 5]);
    expect(rows.map((r) => r.label)).toEqual(['HP 10→9', 'HP 9→8', 'HP 8→6', 'HP 6→5']);
    expectStrictlyIncreasing(rows.map((r) => r.at));
  });
});

/** A Web Storage stand-in shared by the tabs (and the next boot) that use it. */
function memoryJournal(): () => Storage {
  const map = new Map<string, string>();
  const area = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  return () => area as unknown as Storage;
}

/** History that fails while `failing` is set, as a full device would. */
function flakyHistory() {
  const state = { failing: false };
  const history: Pick<typeof historyRepo, 'record'> = {
    record: async (doc, label, opts) => {
      if (state.failing)
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return historyRepo.record(doc, label, opts);
    },
  };
  return { state, history };
}

describe('what resolving a refused save must never lose', () => {
  it("keeps a person's edit refused under one of the sheet's own as theirs, through teardown and boot", async () => {
    // An undo is being written when HP follows the maximum: the newer
    // snapshot holds the undo too. Refused, it must stay the person's.
    const journal = memoryJournal();
    const tab = () =>
      createCharacterSessionStore({ characters: characterRepo, history: historyRepo, journal });
    const a = tab();
    const b = tab();
    await a.getState().load('c1');
    await b.getState().load('c1');
    a.getState().update(hp(3));
    await a.getState().flush();

    const undone = structuredClone(b.getState().doc) as CharacterDoc;
    undone.name = 'Restored by undo';
    b.getState().restore(undone, 'Undo rename');
    b.getState().update(hp(12), undefined, { automatic: true });
    await expect(b.getState().flush()).rejects.toBeInstanceOf(SaveConflictError);
    expect(b.getState().saveConflicts.c1?.kind).toBe('changed');

    b.getState().journalUnsaved();
    expect(readJournal(journal).map((e) => [e.doc.name, e.automatic])).toEqual([
      ['Restored by undo', undefined],
    ]);
    expect(await tab().getState().replayJournal()).toEqual(['Restored by undo']);
    const [newest] = await historyRepo.list('c1');
    expect([newest?.label, newest?.doc.name]).toEqual([NOT_SAVED_LABEL, 'Restored by undo']);
  });

  it('Reload keeps the conflict and the edits when their history row cannot be written', async () => {
    const flaky = flakyHistory();
    const { b } = await conflicted({ history: flaky.history });
    b.state().update((doc) => {
      doc.notes = 'precious notes';
    });
    flaky.state.failing = true;

    await expect(b.state().resolveConflict('c1', 'reload')).rejects.toThrow('quota');
    expect(b.state().saveConflicts.c1?.kind).toBe('changed');
    expect(b.state().doc?.notes).toBe('precious notes');
    flaky.state.failing = false;
    await expect(b.state().resolveConflict('c1', 'reload')).resolves.toBe('reloaded');
    const [newest] = await historyRepo.list('c1');
    expect(newest?.doc.notes).toBe('precious notes');
  });

  it('Reload records an edit made while it writes the history row', async () => {
    let typeDuring: (() => void) | undefined;
    const { b } = await conflicted({
      history: {
        record: async (doc, label, opts) => {
          const id = await historyRepo.record(doc, label, opts);
          const step = typeDuring;
          typeDuring = undefined;
          step?.();
          return id;
        },
      },
    });
    typeDuring = () =>
      b.state().update((doc) => {
        doc.notes = 'typed while history was written';
      });

    await b.state().resolveConflict('c1', 'reload');
    const [newest] = await historyRepo.list('c1');
    expect([newest?.label, newest?.doc.notes]).toEqual([
      NOT_SAVED_LABEL,
      'typed while history was written',
    ]);
  });

  it('Keep mine puts the stored copy in history first, so a roster rename is not lost', async () => {
    // A rename from the roster records no history row of its own.
    const b = openTab();
    await b.state().load('c1');
    b.state().update(hp(4));
    await characterRepo.rename('c1', 'Renamed on roster');
    await expect(b.state().flush()).rejects.toBeInstanceOf(SaveConflictError);

    await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBe('kept');
    expect(await storedPair()).toEqual(['Wren', 4]);
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => [r.label, r.doc.name])).toEqual([
      [KEPT_LABEL, 'Wren'],
      [REPLACED_LABEL, 'Renamed on roster'],
    ]);
  });

  it('Keep mine keeps the conflict and the edits when the stored copy cannot go into history', async () => {
    const flaky = flakyHistory();
    const { b } = await conflicted({ history: flaky.history });
    await characterRepo.rename('c1', 'Renamed on roster');
    flaky.state.failing = true;

    await expect(b.state().resolveConflict('c1', 'overwrite')).rejects.toThrow('quota');
    expect(await storedPair()).toEqual(['Renamed on roster', 3]);
    expect(b.state().saveConflicts.c1?.kind).toBe('changed');
    expect(pair(b.state().doc)).toEqual(['Wren the Bold', 10]);
  });

  it('Keep mine offers the deleted choices for a character deleted since, rather than bring it back', async () => {
    const { b } = await conflicted();
    await characterRepo.delete('c1');

    await expect(b.state().resolveConflict('c1', 'overwrite')).resolves.toBeUndefined();
    expect(await db.characters.get('c1')).toBeUndefined();
    expect(b.state().saveConflicts).toEqual({ c1: { kind: 'deleted', name: 'Wren the Bold' } });
  });

  it('acts once on a double tap', async () => {
    const { b } = await conflicted();
    const [first, second] = await Promise.all([
      b.state().resolveConflict('c1', 'reload'),
      b.state().resolveConflict('c1', 'overwrite'),
    ]);
    expect([first, second]).toEqual(['reloaded', undefined]);
    expect(await storedPair()).toEqual(['Wren', 3]);
    expect((await historyRepo.list('c1')).map((r) => r.label)).toEqual([
      NOT_SAVED_LABEL,
      'HP 10→3',
    ]);
  });

  it('Reload forgets the journal entry made while it waited, so the next boot keeps nothing twice', async () => {
    // A phone hides the page (and journals) with the banner still up.
    const journal = memoryJournal();
    const tab = () =>
      createCharacterSessionStore({ characters: characterRepo, history: historyRepo, journal });
    const a = tab();
    const b = tab();
    await a.getState().load('c1');
    await b.getState().load('c1');
    a.getState().update(hp(3));
    await a.getState().flush();
    b.getState().update(rename);
    await expect(b.getState().flush()).rejects.toBeInstanceOf(SaveConflictError);
    b.getState().journalUnsaved();
    expect(readJournal(journal)).toHaveLength(1);

    await b.getState().resolveConflict('c1', 'reload');
    expect(readJournal(journal)).toEqual([]);
    expect(await tab().getState().replayJournal()).toEqual([]);
    expect((await historyRepo.list('c1')).filter((r) => r.label === NOT_SAVED_LABEL)).toHaveLength(
      1,
    );
  });

  it("forgets the journal entry of the sheet's own edits it drops quietly", async () => {
    const journal = memoryJournal();
    const a = openTab();
    const b = createCharacterSessionStore({
      characters: characterRepo,
      history: historyRepo,
      debounceMs: 60_000,
      journal,
    });
    await a.state().load('c1');
    await b.getState().load('c1');
    await a.edit(hp(3));
    b.getState().update(hp(12), undefined, { automatic: true });
    b.getState().journalUnsaved();
    expect(readJournal(journal)).toHaveLength(1);

    await b.getState().flush();
    expect(readJournal(journal)).toEqual([]);
  });

  it("does not call a save error over when only the sheet's own edits were dropped", async () => {
    // Its write failed, so it waits for Retry; Retry is then refused, and
    // the stored copy taken quietly. Nothing was written: not "saved".
    let failing = true;
    const b = openTab({
      characters: {
        getWithRevision: (id) => characterRepo.getWithRevision(id),
        save: async (doc, expectAt) => {
          if (failing) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          return characterRepo.save(doc, expectAt);
        },
      },
    });
    const a = openTab();
    await b.state().load('c1');
    await a.state().load('c1');
    b.state().update(hp(12), undefined, { automatic: true });
    await expect(b.state().flush()).rejects.toThrow();
    expect(Object.keys(b.state().saveErrors)).toEqual(['c1']);
    await a.edit(hp(3));
    failing = false;

    await b.state().retryFailedSaves();
    expect(b.state().saveErrors).toEqual({});
    expect(b.state().saveConflicts).toEqual({});
    expect(b.state().saveStatus).toBe('idle');
    expect(pair(b.state().doc)).toEqual(['Wren', 3]);
  });
});
