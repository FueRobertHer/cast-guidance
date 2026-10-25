import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { characterRepo } from '@/db/characterRepo';
import { historyRepo } from '@/db/historyRepo';
import type { CharacterDoc } from '@/engine/types';
import { burstKey, diffDocs, sameContent } from '@/lib/docDiff';
import { historyLabel } from '@/lib/historyLabel';
import {
  contentHash,
  type JournalBase,
  type JournalStorage,
  readJournal,
  removeJournalEntry,
  type StoredJournalEntry,
  writeJournalEntry,
} from './saveJournal';

export type CharacterLoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
export type CharacterSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * Applies a change to the loaded character. Pass `label` when the change is a
 * named action ("Long rest", "Attacked with Longsword") that the resulting
 * document diff cannot describe on its own; without it history infers a label
 * from the diff. See {@link historyLabel}.
 *
 * A function label is resolved against the already-updated doc, for actions
 * whose name depends on what they turned out to do (which slot a spell took).
 */
export type DocUpdater = (
  recipe: (doc: CharacterDoc) => void,
  label?: string | ((doc: CharacterDoc) => string),
) => void;

export interface CharacterSessionState {
  doc: CharacterDoc | null;
  /** Bumps on every mutation — memo key for derivation. */
  rev: number;
  requestedId: string | null;
  loadStatus: CharacterLoadStatus;
  loadError: string | null;
  saveStatus: CharacterSaveStatus;
  saveCharacterId: string | null;
  /** Failed saves stay queued and visible until a retry succeeds. */
  saveErrors: Record<string, string>;
  load(id: string): Promise<boolean>;
  /** Mutate the doc via a recipe; persists (debounced) and bumps rev. */
  update: DocUpdater;
  /**
   * Replace the doc with an earlier snapshot. It records its own history entry,
   * under `label` when given (an undo names what it undid) and as a restore from
   * history otherwise.
   */
  restore(snapshot: CharacterDoc, label?: string): void;
  flush(characterId?: string): Promise<void>;
  flushAll(): Promise<void>;
  retryFailedSaves(): Promise<void>;
  close(): Promise<void>;
  /**
   * Copy every snapshot not yet written to IndexedDB into the synchronous
   * journal. Called only as the page goes away; see {@link installCharacterSessionLifecycle}.
   */
  journalUnsaved(): void;
  /**
   * Save, through the normal path, any journaled snapshot whose stored row
   * still holds what the snapshot was built on. Runs once per session; `load` waits for it, so a character
   * is never shown without its last edits.
   */
  replayJournal(): Promise<void>;
}

interface SessionDependencies {
  characters: Pick<typeof characterRepo, 'get' | 'put'>;
  history: Pick<typeof historyRepo, 'record'>;
  debounceMs?: number;
  /** Clock for grouping rapid edits; injectable for tests. */
  now?: () => number;
  /**
   * How rapid edits group into one history entry: a run continues while each
   * edit lands within `idleMs` of the last and the run is under `maxSpanMs`
   * old, so a long stretch of typing still leaves a checkpoint now and then.
   */
  coalesce?: { idleMs: number; maxSpanMs: number };
  /** Where unsaved snapshots are journaled at page teardown; omitted, nothing is. */
  journal?: JournalStorage;
}

interface PendingSave {
  doc: CharacterDoc;
  label?: string;
  /** Orders snapshots, so a landed write knows whether it covers the journaled one. */
  seq: number;
  /**
   * Set once a write for this snapshot has been tried and failed. Such a
   * snapshot is retained for Retry with no time bound, so its label must not be
   * inherited by whatever edit happens to arrive next.
   */
  attempted?: boolean;
}

/**
 * A run of rapid edits being folded into one history row (UX-005). Without
 * this, fifty taps on an HP stepper were fifty rows, and the 50-row cap pruned
 * the level-up someone actually wanted to go back to.
 */
interface Burst {
  /** The document before the run began, so the label covers the whole run. */
  base: CharacterDoc;
  /** Which kinds of edit belong to this run; see {@link burstKey}. */
  key: string;
  rowId: string;
  startedAt: number;
  lastAt: number;
}

interface SaveSlot {
  baseline: CharacterDoc | null;
  burst?: Burst;
  /** Bumps whenever the run must end regardless of saves still in flight. */
  epoch: number;
  pending?: PendingSave;
  /** The snapshot whose IndexedDB put has been issued and has not resolved. */
  writing?: PendingSave;
  /**
   * What the stored row holds as far as this session knows: the row it read,
   * or the last snapshot whose put resolved. Unlike `baseline`, which history
   * moves only once the entry is recorded, this moves as soon as the put lands.
   */
  stored?: CharacterDoc;
  /** The entry this session wrote, until a write at least that new lands. */
  journaled?: { seq: number; text: string };
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Create an isolated session service. Exported so persistence races can be tested directly. */
export function createCharacterSessionStore({
  characters,
  history,
  debounceMs = 400,
  now = Date.now,
  coalesce = { idleMs: 10_000, maxSpanMs: 120_000 },
  journal,
}: SessionDependencies): StoreApi<CharacterSessionState> {
  const slots = new Map<string, SaveSlot>();
  let loadGeneration = 0;
  let saveSeq = 0;
  let replay: Promise<void> | undefined;
  let store: StoreApi<CharacterSessionState>;

  const slotFor = (id: string): SaveSlot => {
    const existing = slots.get(id);
    if (existing !== undefined) return existing;
    const created: SaveSlot = { baseline: null, epoch: 0 };
    slots.set(id, created);
    return created;
  };

  const publishSave = (status: CharacterSaveStatus, characterId: string, error?: unknown): void => {
    const previous = store.getState().saveErrors;
    const saveErrors = { ...previous };
    if (error !== undefined) saveErrors[characterId] = errorMessage(error);
    else if (status === 'saved') delete saveErrors[characterId];
    store.setState({
      saveStatus: status,
      saveCharacterId: characterId,
      saveErrors,
    });
  };

  /**
   * Record one saved snapshot, folding it into the current run of rapid edits
   * when it continues that run. A named action (a rest, a cast, a restore)
   * always gets its own entry and ends the run, as does anything that reshapes
   * the character (a level, a class, a species), a pause, or a different kind
   * of edit.
   */
  const recordHistory = async (slot: SaveSlot, pending: PendingSave): Promise<void> => {
    const prev = slot.baseline;
    const epoch = slot.epoch;
    const t = now();
    const changes = pending.label === undefined && prev !== null ? diffDocs(prev, pending.doc) : [];
    const burst = slot.burst;
    if (pending.label === undefined && prev !== null && changes.length === 0) {
      // An edit that changed nothing (a clamped stepper, re-ticking a used
      // pip) neither starts nor ends a run. History skips it as a duplicate.
      const rowId = await history.record(pending.doc, historyLabel(prev, pending.doc));
      if (rowId !== undefined && slot.epoch === epoch) slot.burst = undefined;
      return;
    }
    const key = burstKey(changes);
    const merging =
      key !== undefined &&
      burst !== undefined &&
      burst.key === key &&
      t - burst.lastAt <= coalesce.idleMs &&
      t - burst.startedAt <= coalesce.maxSpanMs;
    const label =
      pending.label ?? historyLabel((merging ? burst.base : prev) ?? undefined, pending.doc);
    const rowId = await history.record(
      pending.doc,
      label,
      merging ? { replaceId: burst.rowId } : undefined,
    );
    // The character was left and reopened while this was saving: the run
    // belonged to the earlier visit.
    if (slot.epoch !== epoch) return;
    if (key === undefined || prev === null || rowId === undefined) slot.burst = undefined;
    // Another tab wrote in between, so this went into a fresh row. Its label
    // already covers the whole run, so the run carries on in that row.
    else if (merging) slot.burst = { ...burst, rowId, lastAt: t };
    else slot.burst = { base: structuredClone(prev), key, rowId, startedAt: t, lastAt: t };
  };

  const flushCharacter = async (characterId: string): Promise<void> => {
    const slot = slots.get(characterId);
    if (slot === undefined) return;
    clearTimeout(slot.timer);
    slot.timer = undefined;
    if (slot.inFlight !== undefined) return slot.inFlight;
    if (slot.pending === undefined) return;

    const drain = async (): Promise<void> => {
      while (slot.pending !== undefined) {
        const pending = slot.pending;
        slot.pending = undefined;
        publishSave('saving', characterId);
        try {
          slot.writing = pending;
          await characters.put(pending.doc);
          slot.writing = undefined;
          slot.stored = pending.doc;
          if (
            journal !== undefined &&
            slot.journaled !== undefined &&
            pending.seq >= slot.journaled.seq
          ) {
            removeJournalEntry(journal, characterId, slot.journaled.text);
            slot.journaled = undefined;
          }
          await recordHistory(slot, pending);
          slot.baseline = structuredClone(pending.doc);
          publishSave('saved', characterId);
        } catch (error) {
          slot.writing = undefined;
          slot.burst = undefined;
          // A newer edit supersedes a failed older snapshot. Otherwise retain the
          // failed snapshot so Retry can persist it without reconstructing state.
          slot.pending ??= { ...pending, attempted: true };
          publishSave('error', characterId, error);
          throw error;
        }
      }
    };

    slot.inFlight = drain().finally(() => {
      slot.inFlight = undefined;
    });
    return slot.inFlight;
  };

  const scheduleSave = (doc: CharacterDoc, label?: string, immediate = false): void => {
    const slot = slotFor(doc.id);
    // Edits inside the debounce window coalesce into one snapshot. A named
    // action outranks the incidental edits that land with it, so an existing
    // label survives an unlabelled follow-up; a newer named action replaces it.
    // A label from a snapshot whose write already failed is not inherited: that
    // one waits for Retry indefinitely, so the next edit may be unrelated.
    const carried = slot.pending?.attempted === true ? undefined : slot.pending?.label;
    slot.pending = { doc: structuredClone(doc), label: label ?? carried, seq: ++saveSeq };
    clearTimeout(slot.timer);
    publishSave('pending', doc.id);
    if (immediate) {
      void flushCharacter(doc.id).catch(() => undefined);
      return;
    }
    slot.timer = setTimeout(() => {
      slot.timer = undefined;
      // Failure is represented in store state and retained for Retry.
      void flushCharacter(doc.id).catch(() => undefined);
    }, debounceMs);
  };

  const flushMany = async (ids: string[]): Promise<void> => {
    const results = await Promise.allSettled(ids.map((id) => flushCharacter(id)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length > 0)
      throw new AggregateError(failures, 'One or more characters failed to save');
  };

  /**
   * Replay one journaled snapshot, only over a stored row that still holds
   * one of the bases it was built on. Anything else means a later write (from
   * another tab, or after a failed save was left for Retry) and wins; content
   * the row already has needs no replay.
   */
  const replayEntry = async (storage: JournalStorage, entry: StoredJournalEntry): Promise<void> => {
    const id = entry.doc.id;
    // The check and the write below are separate transactions, so a save by
    // another visible window that lands between them is overwritten. That
    // needs two windows editing this character while a third boots with an
    // entry for it; accepted rather than holding a transaction across the
    // history write.
    const stored = await characters.get(id);
    const base =
      stored === undefined ? undefined : entry.bases.find((b) => b.hash === contentHash(stored));
    if (stored === undefined || base === undefined || sameContent(stored, entry.doc)) {
      removeJournalEntry(storage, id, entry.text);
      return;
    }
    const slot = slotFor(id);
    // The stored row is what this snapshot changed, so history labels the
    // replayed edit as the interrupted save would have.
    slot.baseline = structuredClone(stored);
    slot.stored = stored;
    slot.pending = { doc: structuredClone(entry.doc), label: base.label, seq: ++saveSeq };
    slot.journaled = { seq: slot.pending.seq, text: entry.text };
    // A failed write stays queued and visible for Retry, and journaled.
    await flushCharacter(id);
  };

  store = createStore<CharacterSessionState>((set, get) => ({
    doc: null,
    rev: 0,
    requestedId: null,
    loadStatus: 'idle',
    loadError: null,
    saveStatus: 'idle',
    saveCharacterId: null,
    saveErrors: {},

    async load(id) {
      const state = get();
      if (state.doc?.id === id && state.loadStatus === 'ready') return true;

      const generation = ++loadGeneration;
      const previousId = state.doc?.id;
      // Hide the previous character immediately so it can never render under
      // or receive edits from the newly requested route.
      set({
        doc: null,
        rev: 0,
        requestedId: id,
        loadStatus: 'loading',
        loadError: null,
      });

      if (previousId !== undefined) {
        // Continue loading even if the old character fails to save. Its queued
        // snapshot and visible error remain available for a later Retry.
        await flushCharacter(previousId).catch(() => undefined);
      }
      if (journal !== undefined) await get().replayJournal();

      try {
        const persisted = await characters.get(id);
        if (generation !== loadGeneration || get().requestedId !== id) return false;

        const slot = slotFor(id);
        // Prefer an unsaved in-memory snapshot when revisiting after a write
        // failure; showing the older IndexedDB row would look like data loss.
        const doc = slot.pending?.doc ?? persisted;
        if (doc === undefined) {
          set({ doc: null, rev: 0, loadStatus: 'missing' });
          return false;
        }
        if (slot.pending === undefined) slot.baseline = structuredClone(doc);
        if (persisted !== undefined) slot.stored = persisted;
        // A return visit starts a fresh entry rather than extending the run
        // left behind last time, even one whose last save is still landing.
        slot.burst = undefined;
        slot.epoch++;
        set({ doc: structuredClone(doc), rev: 1, loadStatus: 'ready' });
        return true;
      } catch (error) {
        if (generation !== loadGeneration || get().requestedId !== id) return false;
        const pending = slots.get(id)?.pending?.doc;
        if (pending !== undefined) {
          set({ doc: structuredClone(pending), rev: 1, loadStatus: 'ready' });
          return true;
        }
        set({
          doc: null,
          rev: 0,
          loadStatus: 'error',
          loadError: errorMessage(error),
        });
        return false;
      }
    },

    update(recipe, label) {
      const state = get();
      const doc = state.doc;
      if (
        doc === null ||
        state.loadStatus !== 'ready' ||
        state.requestedId === null ||
        doc.id !== state.requestedId
      ) {
        return;
      }
      const draft = structuredClone(doc);
      recipe(draft);
      set((current) => ({ doc: draft, rev: current.rev + 1 }));
      scheduleSave(draft, typeof label === 'function' ? label(draft) : label);
    },

    restore(snapshot, label = 'Restored from history') {
      const state = get();
      if (
        state.doc === null ||
        state.loadStatus !== 'ready' ||
        snapshot.id !== state.doc.id ||
        snapshot.id !== state.requestedId
      ) {
        return;
      }
      const restored = structuredClone(snapshot);
      const slot = slots.get(snapshot.id);
      if (slot !== undefined) {
        slot.burst = undefined;
        slot.epoch++;
      }
      set((current) => ({ doc: restored, rev: current.rev + 1 }));
      scheduleSave(restored, label, true);
    },

    flush(characterId) {
      const id = characterId ?? get().doc?.id;
      return id === undefined ? Promise.resolve() : flushCharacter(id);
    },

    flushAll() {
      return flushMany([...slots.keys()]);
    },

    retryFailedSaves() {
      return flushMany(Object.keys(get().saveErrors));
    },

    async close() {
      const id = get().doc?.id;
      ++loadGeneration;
      set({
        doc: null,
        rev: 0,
        requestedId: null,
        loadStatus: 'idle',
        loadError: null,
      });
      if (id !== undefined) await flushCharacter(id);
    },

    journalUnsaved() {
      if (journal === undefined) return;
      for (const slot of slots.values()) {
        // A put already issued may not commit before teardown either, and a
        // newer pending snapshot would only drain after it.
        const { pending, writing, stored } = slot;
        const unsaved = pending ?? writing;
        if (unsaved === undefined) continue;
        const bases: JournalBase[] = [];
        // If the in-flight write is lost too, the replay stands for it as well,
        // so a named action it carried ("Long rest") keeps its name.
        if (stored !== undefined) {
          bases.push({ hash: contentHash(stored), label: unsaved.label ?? writing?.label });
        }
        if (pending !== undefined && writing !== undefined) {
          bases.push({ hash: contentHash(writing.doc), label: pending.label });
        }
        // With no known stored row there is nothing it could safely replay over.
        if (bases.length === 0) continue;
        const text = writeJournalEntry(journal, { doc: unsaved.doc, bases });
        if (text !== undefined) slot.journaled = { seq: unsaved.seq, text };
      }
    },

    replayJournal() {
      const storage = journal;
      if (storage === undefined) return Promise.resolve();
      replay ??= (async () => {
        for (const entry of readJournal(storage)) {
          // One entry that cannot be checked or saved must not block the rest,
          // nor the load waiting on this. It stays journaled for next time.
          await replayEntry(storage, entry).catch(() => undefined);
        }
      })();
      return replay;
    },
  }));

  return store;
}

export const characterSessionStore = createCharacterSessionStore({
  characters: characterRepo,
  history: historyRepo,
  journal: () => localStorage,
});

/**
 * Flush pending writes on lifecycle transitions where IndexedDB can still run.
 * A teardown can cut that write off before it commits, so the same moment
 * journals every unsaved snapshot synchronously first, and installing starts
 * the replay of anything the last page journaled.
 */
export function installCharacterSessionLifecycle(
  session: StoreApi<CharacterSessionState> = characterSessionStore,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  void session.getState().replayJournal();
  const flush = () => {
    const state = session.getState();
    // Journal first: the flush moves the pending snapshot into flight, and
    // the entry must know the row that snapshot was built on.
    state.journalUnsaved();
    void state.flushAll().catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export function useCharacterSession<T>(selector: (state: CharacterSessionState) => T): T {
  return useStore(characterSessionStore, selector);
}
