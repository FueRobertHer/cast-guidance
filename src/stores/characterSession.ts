import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { characterRepo, type SaveExpect, type SaveResult } from '@/db/characterRepo';
import { historyRepo } from '@/db/historyRepo';
import type { CharacterDoc } from '@/engine/types';
import { burstKey, diffDocs, sameContent } from '@/lib/docDiff';
import { historyLabel } from '@/lib/historyLabel';
import { storageErrorText } from '@/lib/storageErrors';
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
export type CharacterSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * A save this tab was refused (REL-007, #98) because another tab changed or
 * deleted the character since this one read it. `name` is the name this tab
 * showed when it happened, fixed for as long as the conflict lasts.
 */
export interface SaveConflict {
  kind: 'changed' | 'deleted';
  name: string;
}

/** The history label for this tab's edits when the stored copy is kept instead. */
export const NOT_SAVED_LABEL = 'Not saved: the stored copy had changed';
/** The history label for this tab's edits when they are kept over the stored copy. */
export const KEPT_LABEL = "Kept this tab's version";
/** The history label for the stored copy that Keep mine replaces. */
export const REPLACED_LABEL = "Replaced: the other tab's version";

/**
 * How a refused save ended: the stored copy shown (`reloaded`), the edits
 * dropped for a character that is gone (`discarded`), or the edits saved
 * over the stored copy (`kept`).
 */
export type ConflictOutcome = 'reloaded' | 'discarded' | 'kept';

/**
 * Why a flush did not write: the save is waiting on the person's choice
 * between this tab's edits and the stored copy (see `resolveConflict`).
 */
export class SaveConflictError extends Error {
  readonly characterId: string;
  constructor(characterId: string) {
    super('The character was changed in another tab, so this save is waiting');
    this.name = 'SaveConflictError';
    this.characterId = characterId;
  }
}

/**
 * Applies a change to the loaded character. Pass `label` when the change is a
 * named action ("Long rest", "Attacked with Longsword") that the resulting
 * document diff cannot describe on its own; without it history infers a label
 * from the diff. See {@link historyLabel}.
 *
 * A function label is resolved against the already-updated doc, for actions
 * whose name depends on what they turned out to do (which slot a spell took).
 *
 * `automatic` marks an edit the sheet makes by itself rather than the person
 * (current HP following the maximum): it never raises a save conflict, and
 * over a copy taken from another tab it is not saved at all; see `scheduleSave`.
 */
export type DocUpdater = (
  recipe: (doc: CharacterDoc) => void,
  label?: string | ((doc: CharacterDoc) => string),
  opts?: { automatic?: boolean },
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
  /**
   * Refused saves, by character. Never in `saveErrors`, so Retry cannot
   * target them: only `resolveConflict` ends one.
   */
  saveConflicts: Record<string, SaveConflict>;
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
   * End a refused save. `reload` keeps the stored copy and puts this tab's
   * edits in history; `overwrite` puts the stored copy in history and saves
   * the edits over it as it is at the moment of the choice (or brings a
   * deleted character back). Resolves with what happened, or undefined when
   * nothing was resolved: no conflict, a character deleted meanwhile (the
   * conflict then offers the deleted choices), or a save that failed or was
   * refused again (which the state shows). Rejects, keeping the conflict and
   * its edits, when the row or the history row cannot be read or written.
   */
  resolveConflict(id: string, choice: 'reload' | 'overwrite'): Promise<ConflictOutcome | undefined>;
  /**
   * Take the stored copy if another tab saved since, but only while this tab
   * has nothing of its own waiting to be saved. Called when the characters
   * table changes and when the page comes back into view.
   */
  refreshIfClean(id: string): Promise<void>;
  /**
   * Copy every snapshot not yet written to IndexedDB into the synchronous
   * journal. Called only as the page goes away; see {@link installCharacterSessionLifecycle}.
   */
  journalUnsaved(): void;
  /**
   * Save, through the normal path, any journaled snapshot whose stored row
   * still holds what the snapshot was built on. Runs once per session; `load` waits for it, so a character
   * is never shown without its last edits. Resolves with the names of the
   * characters whose snapshot went to history instead, for the person to be
   * told (see {@link installCharacterSessionLifecycle}).
   */
  replayJournal(): Promise<string[]>;
}

/** What the session needs from the character store. */
export type SessionCharacters = Pick<typeof characterRepo, 'getWithRevision' | 'save'>;

interface SessionDependencies {
  characters: SessionCharacters;
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
  /** Every edit folded into this snapshot was automatic; see {@link DocUpdater}. */
  automatic?: boolean;
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
   * Undefined once the row is known to be gone, so a save must create it.
   */
  stored?: CharacterDoc;
  /** The stored row's revision when it held `stored`; the two move together. */
  revision?: string;
  /** Set while a save is refused; edits keep folding into `pending` meanwhile. */
  conflict?: SaveConflict;
  /** A `resolveConflict` is under way, so a second tap does not start another. */
  resolving?: boolean;
  /**
   * The document on screen came from another tab's save (a refresh), not from
   * this tab's own read or edits. Until the person edits, an automatic edit is
   * not saved over it.
   */
  adopted?: boolean;
  /**
   * A refresh was set aside because this tab was busy with its own save, so
   * the slot looks again once that save is done (see `flushCharacter`).
   */
  recheck?: boolean;
  /** The entry this session wrote, until a write at least that new lands. */
  journaled?: { seq: number; text: string };
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
}

/** No snapshot, or one made only of automatic edits. */
function allAutomatic(save: PendingSave | undefined): boolean {
  return save === undefined || save.automatic === true;
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
  let replay: Promise<string[]> | undefined;
  let store: StoreApi<CharacterSessionState>;

  const slotFor = (id: string): SaveSlot => {
    const existing = slots.get(id);
    if (existing !== undefined) return existing;
    const created: SaveSlot = { baseline: null, epoch: 0 };
    slots.set(id, created);
    return created;
  };

  const publishSave = (status: CharacterSaveStatus, characterId: string, error?: unknown): void => {
    const previous = store.getState();
    const saveErrors = { ...previous.saveErrors };
    // Stored as text, so a full device is told what to do here, at the catch.
    if (error !== undefined) saveErrors[characterId] = storageErrorText(error);
    // Saved, refused, or nothing left to write: the failure is over either way.
    else if (status === 'saved' || status === 'conflict' || status === 'idle')
      delete saveErrors[characterId];
    // The same object for as long as the conflict lasts, so the banner's text
    // (and its one announcement) does not change under it.
    const conflict = slots.get(characterId)?.conflict;
    let saveConflicts = previous.saveConflicts;
    if (saveConflicts[characterId] !== conflict) {
      saveConflicts = { ...saveConflicts };
      if (conflict === undefined) delete saveConflicts[characterId];
      else saveConflicts[characterId] = conflict;
    }
    store.setState({
      saveStatus: status,
      saveCharacterId: characterId,
      saveErrors,
      saveConflicts,
    });
  };

  /** Nothing of this tab's own is waiting, being written or refused. */
  const isClean = (slot: SaveSlot, inDrain = false): boolean =>
    slot.pending === undefined &&
    slot.writing === undefined &&
    slot.conflict === undefined &&
    (inDrain || slot.inFlight === undefined);

  /** What a save from this slot expects to find; see `characterRepo.save`. */
  const expectation = (slot: SaveSlot): SaveExpect =>
    slot.stored === undefined
      ? { kind: 'absent' }
      : { kind: 'revision', revision: slot.revision, content: slot.stored };

  /**
   * Make a stored row (or its absence) this slot's starting point, and show it
   * if the character is on screen. Everything waiting has already been dealt
   * with by the caller.
   */
  const adopt = (
    slot: SaveSlot,
    id: string,
    read: { doc: CharacterDoc; revision: string | undefined } | undefined,
  ): void => {
    slot.baseline = read === undefined ? null : structuredClone(read.doc);
    slot.stored = read?.doc;
    slot.revision = read?.revision;
    slot.adopted = true;
    slot.burst = undefined;
    slot.epoch++;
    const state = store.getState();
    if (state.doc?.id !== id || state.loadStatus !== 'ready') return;
    if (read === undefined) store.setState({ doc: null, rev: 0, loadStatus: 'missing' });
    else store.setState({ doc: structuredClone(read.doc), rev: state.rev + 1 });
  };

  /**
   * Re-read the row and adopt it if it changed, provided the slot is clean
   * both before and after the read. Anything that happens to the slot while
   * the read is out (an edit, a save landing, a load) makes that read stale,
   * and it is dropped: adopting it would hide the edit, or let it save over
   * the other tab with a matching revision. `inDrain` is the drain's own
   * call, which runs while its flush is still in flight.
   */
  const adoptLatest = async (id: string, slot: SaveSlot, inDrain = false): Promise<void> => {
    // Set aside while a save of this tab's own is under way: one that lands
    // was checked, and another tab's write that came first refuses it. A
    // change that came just after it would be missed, though, so the slot
    // looks again once it is done. A conflict waits for the person instead.
    const setAside = () => {
      if (!inDrain && slot.conflict === undefined) slot.recheck = true;
    };
    if (!isClean(slot, inDrain)) return setAside();
    slot.recheck = false;
    const { epoch, stored } = slot;
    const read = await characters.getWithRevision(id);
    if (!isClean(slot, inDrain) || slot.epoch !== epoch || slot.stored !== stored) {
      return setAside();
    }
    if (
      read === undefined
        ? stored === undefined
        : stored !== undefined && read.revision === slot.revision && sameContent(read.doc, stored)
    ) {
      return;
    }
    adopt(slot, id, read);
  };

  /**
   * Keep a snapshot whose write failed or was refused, for Retry or the
   * person's choice. A newer snapshot already waiting supersedes it, and was
   * built on it, so it carries what the older one carried: if that was the
   * person's edit, the newer one is no longer only automatic.
   */
  const retain = (slot: SaveSlot, failed: PendingSave): PendingSave => {
    if (slot.pending === undefined) slot.pending = { ...failed, attempted: true };
    else if (failed.automatic !== true) slot.pending.automatic = false;
    return slot.pending;
  };

  /** Forget the journal entry this slot wrote, once what it held is settled another way. */
  const dropJournaled = (slot: SaveSlot, id: string): void => {
    if (journal !== undefined && slot.journaled !== undefined) {
      removeJournalEntry(journal, id, slot.journaled.text);
    }
    slot.journaled = undefined;
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
    // Nothing is written until the person chooses (`resolveConflict`).
    if (slot.conflict !== undefined) throw new SaveConflictError(characterId);
    if (slot.pending === undefined) return;

    const drain = async (): Promise<void> => {
      while (slot.pending !== undefined) {
        const pending = slot.pending;
        slot.pending = undefined;
        publishSave('saving', characterId);
        let result: SaveResult;
        try {
          slot.writing = pending;
          result = await characters.save(pending.doc, expectation(slot));
          slot.writing = undefined;
          if (result.status === 'saved') {
            slot.stored = pending.doc;
            slot.revision = result.revision;
            if (slot.journaled !== undefined && pending.seq >= slot.journaled.seq) {
              dropJournaled(slot, characterId);
            }
            await recordHistory(slot, pending);
            slot.baseline = structuredClone(pending.doc);
            publishSave('saved', characterId);
            continue;
          }
        } catch (error) {
          slot.writing = undefined;
          slot.burst = undefined;
          // A newer edit supersedes a failed older snapshot. Otherwise retain the
          // failed snapshot so Retry can persist it without reconstructing state.
          retain(slot, pending);
          publishSave('error', characterId, error);
          throw error;
        }

        // Refused: another tab saved or deleted the character since this one
        // read it, and nothing was written.
        slot.burst = undefined;
        if (pending.automatic === true && allAutomatic(slot.pending)) {
          // Only the sheet's own edits were refused, and the sheet makes them
          // again on whatever it is shown, so take the stored copy quietly.
          // An edit by the person since, even one made during the write,
          // makes this a real conflict instead.
          slot.pending = undefined;
          dropJournaled(slot, characterId);
          await adoptLatest(characterId, slot, true).catch(() => undefined);
          // Nothing was written, so not "saved": a save error this clears
          // must not be followed by "Changes saved".
          if (slot.pending === undefined) publishSave('idle', characterId);
          continue;
        }
        const kept = retain(slot, pending);
        slot.conflict = {
          kind: result.status === 'missing' ? 'deleted' : 'changed',
          name: kept.doc.name,
        };
        publishSave('conflict', characterId);
        throw new SaveConflictError(characterId);
      }
    };

    slot.inFlight = drain().finally(() => {
      slot.inFlight = undefined;
      if (slot.recheck === true && isClean(slot))
        void adoptLatest(characterId, slot).catch(() => undefined);
    });
    return slot.inFlight;
  };

  const scheduleSave = (
    doc: CharacterDoc,
    label: string | undefined,
    { immediate = false, automatic = false }: { immediate?: boolean; automatic?: boolean } = {},
  ): void => {
    const slot = slotFor(doc.id);
    // An automatic edit over a copy another tab saved stays on screen only,
    // until the person edits. Two tabs can derive different maxima (homebrew
    // or game data changed in one of them), and each saving its own over the
    // other's would go back and forth for as long as both stay open.
    if (automatic && slot.adopted === true) return;
    if (!automatic) slot.adopted = false;
    // Edits inside the debounce window coalesce into one snapshot. A named
    // action outranks the incidental edits that land with it, so an existing
    // label survives an unlabelled follow-up; a newer named action replaces it.
    // A label from a snapshot whose write already failed is not inherited: that
    // one waits for Retry indefinitely, so the next edit may be unrelated.
    const carried = slot.pending?.attempted === true ? undefined : slot.pending?.label;
    slot.pending = {
      doc: structuredClone(doc),
      label: label ?? carried,
      seq: ++saveSeq,
      // One edit by the person makes the whole snapshot theirs. One still
      // being written is accounted for if that write fails or is refused
      // (see `retain`): until then it may land, leaving this one automatic.
      automatic: automatic && allAutomatic(slot.pending),
    };
    clearTimeout(slot.timer);
    slot.timer = undefined;
    if (slot.conflict !== undefined) {
      // Kept in memory while the person chooses: no timer, so nothing tries
      // to write, and the header keeps saying the edits are not saved.
      publishSave('conflict', doc.id);
      return;
    }
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
   * one of the bases it was built on. The replay is a checked save like any
   * other, against the revision read here, so a save by another window that
   * lands in between is not overwritten: it raises a conflict instead.
   *
   * Over any other row (a later write from another tab, a migration that
   * rewrote the row, or a save left for Retry that another tab got past) the
   * snapshot goes into the character's history, and the person is told, so it
   * is not lost unseen. Content the row already has needs no replay, and a
   * character deleted since stays deleted. Resolves with the character's
   * name when its snapshot went to history.
   */
  const replayEntry = async (
    storage: JournalStorage,
    entry: StoredJournalEntry,
  ): Promise<string | undefined> => {
    const id = entry.doc.id;
    const read = await characters.getWithRevision(id);
    if (read === undefined || sameContent(read.doc, entry.doc)) {
      removeJournalEntry(storage, id, entry.text);
      return undefined;
    }
    const stored = read.doc;
    // A build from before the revision was ignored hashed it with the rest.
    const hashes = [contentHash(stored)];
    if (read.revision !== undefined) hashes.push(contentHash(stored, read.revision));
    const base = entry.bases.find((b) => hashes.includes(b.hash));
    if (base === undefined) {
      // Only the sheet's own edits: nothing the person would look for.
      if (entry.automatic === true) {
        removeJournalEntry(storage, id, entry.text);
        return undefined;
      }
      // A failed history write leaves the entry for the next boot.
      await history.record(entry.doc, NOT_SAVED_LABEL);
      removeJournalEntry(storage, id, entry.text);
      return entry.doc.name;
    }
    const slot = slotFor(id);
    // The stored row is what this snapshot changed, so history labels the
    // replayed edit as the interrupted save would have.
    slot.baseline = structuredClone(stored);
    slot.stored = stored;
    slot.revision = read.revision;
    slot.pending = {
      doc: structuredClone(entry.doc),
      label: base.label,
      seq: ++saveSeq,
      automatic: entry.automatic === true,
    };
    slot.journaled = { seq: slot.pending.seq, text: entry.text };
    // A failed write stays queued and visible for Retry, and journaled.
    await flushCharacter(id);
    return undefined;
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
    saveConflicts: {},

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
        const persisted = await characters.getWithRevision(id);
        if (generation !== loadGeneration || get().requestedId !== id) return false;

        const slot = slotFor(id);
        // Prefer an unsaved in-memory snapshot when revisiting after a write
        // failure; showing the older IndexedDB row would look like data loss.
        const doc = slot.pending?.doc ?? persisted?.doc;
        if (doc === undefined) {
          set({ doc: null, rev: 0, loadStatus: 'missing' });
          return false;
        }
        // The stored copy and its revision move together, and only while
        // nothing of this tab's is waiting: a pending edit was built on the
        // copy this tab had, and its save must be checked against that one.
        if (isClean(slot) && persisted !== undefined) {
          slot.baseline = structuredClone(doc);
          slot.stored = persisted.doc;
          slot.revision = persisted.revision;
          slot.adopted = false;
        }
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

    update(recipe, label, opts) {
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
      scheduleSave(draft, typeof label === 'function' ? label(draft) : label, {
        automatic: opts?.automatic === true,
      });
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
      scheduleSave(restored, label, { immediate: true });
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

    async resolveConflict(id, choice) {
      const slot = slots.get(id);
      const conflict = slot?.conflict;
      if (slot === undefined || conflict === undefined || slot.resolving === true) return undefined;
      slot.resolving = true;
      try {
        // Read now rather than trusting the row as it was when the save was
        // refused: a third write may have landed since, and the choice is
        // between this tab's edits and what is stored at the moment of it.
        const read = await characters.getWithRevision(id);
        if (read === undefined && conflict.kind === 'changed') {
          // Deleted since the banner went up: there is no stored copy to load
          // or to keep in history, so offer the choices that fit instead.
          slot.conflict = { kind: 'deleted', name: conflict.name };
          publishSave('conflict', id);
          return undefined;
        }
        if (choice === 'overwrite') {
          // The copy being replaced goes into history first, so both versions
          // are there whichever way the person chose: a rename from the
          // roster, say, records none of its own. Skipped when it is already
          // the newest row. A failed write keeps the conflict and the edits.
          if (read !== undefined) await history.record(read.doc, REPLACED_LABEL);
          slot.stored = read?.doc;
          slot.revision = read?.revision;
          slot.conflict = undefined;
          if (slot.pending !== undefined) {
            // The person's choice: never the quiet path if refused again.
            slot.pending = {
              ...slot.pending,
              label: KEPT_LABEL,
              attempted: undefined,
              automatic: false,
            };
          }
          publishSave(slot.pending === undefined ? 'saved' : 'pending', id);
          // A write landing between that read and this save refuses it again.
          await flushCharacter(id).catch(() => undefined);
          return slot.conflict === undefined && get().saveErrors[id] === undefined
            ? 'kept'
            : undefined;
        }
        if (read !== undefined) {
          // Edits made while this waits are kept too: each snapshot recorded
          // is the newest one at the time, until none is newer. A failed
          // history write keeps the conflict and the edits, and says so.
          let recorded: PendingSave | undefined;
          while (slot.pending !== undefined && slot.pending !== recorded) {
            recorded = slot.pending;
            if (!sameContent(recorded.doc, read.doc)) {
              await history.record(recorded.doc, NOT_SAVED_LABEL);
            }
          }
        }
        slot.pending = undefined;
        slot.conflict = undefined;
        dropJournaled(slot, id);
        adopt(slot, id, read);
        publishSave('saved', id);
        return read === undefined ? 'discarded' : 'reloaded';
      } finally {
        slot.resolving = false;
      }
    },

    async refreshIfClean(id) {
      const slot = slots.get(id);
      if (slot !== undefined) await adoptLatest(id, slot);
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
        const automatic = allAutomatic(pending) && allAutomatic(writing);
        const text = writeJournalEntry(journal, { doc: unsaved.doc, bases, automatic });
        if (text !== undefined) slot.journaled = { seq: unsaved.seq, text };
      }
    },

    replayJournal() {
      const storage = journal;
      if (storage === undefined) return Promise.resolve([]);
      replay ??= (async () => {
        const kept: string[] = [];
        for (const entry of readJournal(storage)) {
          // One entry that cannot be checked or saved must not block the rest,
          // nor the load waiting on this. It stays journaled for next time.
          const name = await replayEntry(storage, entry).catch(() => undefined);
          if (name !== undefined) kept.push(name);
        }
        return kept;
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
 *
 * It also keeps the character on screen current (REL-007, #98): after any
 * write to the characters table, here or in another tab, and when the page
 * comes back into view, a tab with nothing of its own waiting takes the
 * stored copy, so its next edit is not refused for being built on an old one.
 * While a save is refused, leaving the page asks first.
 *
 * `onKept` is told each character whose journaled edits went to history
 * instead of being replayed, so the person hears where they are. A callback
 * rather than a call into the notices store: this module is shared with the
 * lazy routes, and importing that here split the announcer into a chunk of
 * its own that every boot then had to fetch.
 */
export function installCharacterSessionLifecycle(
  session: StoreApi<CharacterSessionState> = characterSessionStore,
  {
    onCharactersChanged = characterRepo.onChange,
    onKept,
  }: {
    onCharactersChanged?: (listener: () => void) => () => void;
    onKept?: (name: string) => void;
  } = {},
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  void session
    .getState()
    .replayJournal()
    .then((kept) => {
      for (const name of kept) onKept?.(name);
    });
  const flush = () => {
    const state = session.getState();
    // Journal first: the flush moves the pending snapshot into flight, and
    // the entry must know the row that snapshot was built on.
    state.journalUnsaved();
    void state.flushAll().catch(() => undefined);
  };
  const refresh = () => {
    const state = session.getState();
    const id = state.doc?.id;
    if (id !== undefined) void state.refreshIfClean(id).catch(() => undefined);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
    else refresh();
  };
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    // Older browsers ask only when this is set too.
    event.returnValue = '';
  };
  let guarding = false;
  const guard = (state: CharacterSessionState) => {
    const open = Object.keys(state.saveConflicts).length > 0;
    if (open === guarding) return;
    guarding = open;
    // Only while a conflict is open: a beforeunload listener can keep a page
    // out of the back-forward cache.
    if (open) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const stopChanges = onCharactersChanged(refresh);
  const stopGuard = session.subscribe(guard);
  guard(session.getState());
  return () => {
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    stopChanges();
    stopGuard();
  };
}

export function useCharacterSession<T>(selector: (state: CharacterSessionState) => T): T {
  return useStore(characterSessionStore, selector);
}
