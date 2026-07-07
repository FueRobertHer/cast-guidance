import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { characterRepo } from '@/db/characterRepo';
import { historyRepo } from '@/db/historyRepo';
import type { CharacterDoc } from '@/engine/types';
import { historyLabel } from '@/lib/historyLabel';

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** State as of the last persisted snapshot — history labels diff against it. */
let baselineDoc: CharacterDoc | null = null;

function persist(doc: CharacterDoc): void {
  void characterRepo.put(doc);
  void historyRepo.record(doc, historyLabel(baselineDoc ?? undefined, doc));
  baselineDoc = doc;
}

export interface CharacterSessionState {
  doc: CharacterDoc | null;
  /** Bumps on every mutation — memo key for derivation. */
  rev: number;
  load(id: string): Promise<boolean>;
  /** Mutate the doc via a recipe; persists (debounced) and bumps rev. */
  update(recipe: (doc: CharacterDoc) => void): void;
  /** Replace the doc with a history snapshot (records its own entry). */
  restore(snapshot: CharacterDoc): void;
  close(): void;
}

export const characterSessionStore = createStore<CharacterSessionState>((set, get) => ({
  doc: null,
  rev: 0,

  async load(id) {
    const current = get().doc;
    if (current?.id === id) return true;
    const doc = await characterRepo.get(id);
    if (doc === undefined) {
      set({ doc: null, rev: 0 });
      return false;
    }
    baselineDoc = doc;
    set({ doc, rev: 1 });
    return true;
  },

  update(recipe) {
    const doc = get().doc;
    if (doc === null) return;
    // Shallow-clone root so React sees a new reference; recipe mutates freely.
    const draft = structuredClone(doc);
    recipe(draft);
    set((s) => ({ doc: draft, rev: s.rev + 1 }));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(draft), 400);
  },

  restore(snapshot) {
    const doc = get().doc;
    if (doc === null || snapshot.id !== doc.id) return;
    const restored = structuredClone(snapshot);
    set((s) => ({ doc: restored, rev: s.rev + 1 }));
    clearTimeout(saveTimer);
    void characterRepo.put(restored);
    void historyRepo.record(restored, 'Restored from history');
    baselineDoc = restored;
  },

  close() {
    clearTimeout(saveTimer);
    const doc = get().doc;
    if (doc !== null) persist(doc);
    set({ doc: null, rev: 0 });
  },
}));

export function useCharacterSession<T>(selector: (s: CharacterSessionState) => T): T {
  return useStore(characterSessionStore, selector);
}
