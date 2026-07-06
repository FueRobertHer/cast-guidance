import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { characterRepo } from '@/db/characterRepo';
import type { CharacterDoc } from '@/engine/types';

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export interface CharacterSessionState {
  doc: CharacterDoc | null;
  /** Bumps on every mutation — memo key for derivation. */
  rev: number;
  load(id: string): Promise<boolean>;
  /** Mutate the doc via a recipe; persists (debounced) and bumps rev. */
  update(recipe: (doc: CharacterDoc) => void): void;
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
    saveTimer = setTimeout(() => {
      void characterRepo.put(draft);
    }, 400);
  },

  close() {
    clearTimeout(saveTimer);
    const doc = get().doc;
    if (doc !== null) void characterRepo.put(doc);
    set({ doc: null, rev: 0 });
  },
}));

export function useCharacterSession<T>(selector: (s: CharacterSessionState) => T): T {
  return useStore(characterSessionStore, selector);
}
