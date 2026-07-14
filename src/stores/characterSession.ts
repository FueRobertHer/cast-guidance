import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { characterRepo } from '@/db/characterRepo';
import { historyRepo } from '@/db/historyRepo';
import type { CharacterDoc } from '@/engine/types';
import { historyLabel } from '@/lib/historyLabel';

export type CharacterLoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';
export type CharacterSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

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
  update(recipe: (doc: CharacterDoc) => void): void;
  /** Replace the doc with a history snapshot (records its own entry). */
  restore(snapshot: CharacterDoc): void;
  flush(characterId?: string): Promise<void>;
  flushAll(): Promise<void>;
  retryFailedSaves(): Promise<void>;
  close(): Promise<void>;
}

interface SessionDependencies {
  characters: Pick<typeof characterRepo, 'get' | 'put'>;
  history: Pick<typeof historyRepo, 'record'>;
  debounceMs?: number;
}

interface PendingSave {
  doc: CharacterDoc;
  label?: string;
}

interface SaveSlot {
  baseline: CharacterDoc | null;
  pending?: PendingSave;
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
}: SessionDependencies): StoreApi<CharacterSessionState> {
  const slots = new Map<string, SaveSlot>();
  let loadGeneration = 0;
  let store: StoreApi<CharacterSessionState>;

  const slotFor = (id: string): SaveSlot => {
    const existing = slots.get(id);
    if (existing !== undefined) return existing;
    const created: SaveSlot = { baseline: null };
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
          await characters.put(pending.doc);
          await history.record(
            pending.doc,
            pending.label ?? historyLabel(slot.baseline ?? undefined, pending.doc),
          );
          slot.baseline = structuredClone(pending.doc);
          publishSave('saved', characterId);
        } catch (error) {
          // A newer edit supersedes a failed older snapshot. Otherwise retain the
          // failed snapshot so Retry can persist it without reconstructing state.
          slot.pending ??= pending;
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
    slot.pending = { doc: structuredClone(doc), label };
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

    update(recipe) {
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
      scheduleSave(draft);
    },

    restore(snapshot) {
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
      set((current) => ({ doc: restored, rev: current.rev + 1 }));
      scheduleSave(restored, 'Restored from history', true);
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
  }));

  return store;
}

export const characterSessionStore = createCharacterSessionStore({
  characters: characterRepo,
  history: historyRepo,
});

/** Flush pending writes on lifecycle transitions where IndexedDB can still run. */
export function installCharacterSessionLifecycle(
  session: StoreApi<CharacterSessionState> = characterSessionStore,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
  const flush = () => {
    void session
      .getState()
      .flushAll()
      .catch(() => undefined);
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
