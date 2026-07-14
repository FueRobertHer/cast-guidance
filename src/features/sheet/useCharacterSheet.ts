import { useEffect, useMemo } from 'react';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistry } from '@/data5e/hooks';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import {
  type CharacterLoadStatus,
  type CharacterSaveStatus,
  characterSessionStore,
  useCharacterSession,
} from '@/stores/characterSession';

export interface CharacterSheetState {
  doc: CharacterDoc | null;
  sheet: DerivedSheet | null;
  loadStatus: CharacterLoadStatus;
  missing: boolean;
  error: string | null;
  saveStatus: CharacterSaveStatus;
  update: (recipe: (doc: CharacterDoc) => void) => void;
  retryLoad: () => void;
}

/** Load the character for a route id and derive its sheet reactively. */
export function useCharacterSheet(id: string | undefined): CharacterSheetState {
  const registry = useRegistry(['essentials']);
  const sessionDoc = useCharacterSession((s) => s.doc);
  const rev = useCharacterSession((s) => s.rev);
  const requestedId = useCharacterSession((s) => s.requestedId);
  const loadStatus = useCharacterSession((s) => s.loadStatus);
  const error = useCharacterSession((s) => s.loadError);
  const saveStatus = useCharacterSession((s) => s.saveStatus);
  const saveCharacterId = useCharacterSession((s) => s.saveCharacterId);
  const routeLoadStatus = id !== undefined && requestedId === id ? loadStatus : 'loading';

  const doc =
    id !== undefined && requestedId === id && routeLoadStatus === 'ready' && sessionDoc?.id === id
      ? sessionDoc
      : null;

  useEffect(() => {
    if (id === undefined) return;
    void characterSessionStore.getState().load(id);
    return () => {
      void characterSessionStore
        .getState()
        .flush(id)
        .catch(() => undefined);
    };
  }, [id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev tracks doc mutations
  const sheet = useMemo(() => {
    if (doc === null || registry === null) return null;
    return deriveSheet(doc, engineContextFor(registry));
  }, [doc, registry, rev]);

  // While a character is still being built (HP never manually touched),
  // currentHp tracks the derived max — so leveling up keeps you at full.
  // The first time the player damages/heals HP in play, it locks (see PlayTab).
  // Never affects saved characters (hpInitialized === undefined).
  useEffect(() => {
    if (doc === null || sheet === null) return;
    if (doc.play.hpInitialized === false && doc.play.currentHp !== sheet.maxHp.value) {
      characterSessionStore.getState().update((d) => {
        d.play.currentHp = sheet.maxHp.value;
      });
    }
  }, [doc, sheet]);

  return {
    doc,
    sheet,
    loadStatus: routeLoadStatus,
    missing: routeLoadStatus === 'missing',
    error: requestedId === id ? error : null,
    saveStatus: saveCharacterId === id ? saveStatus : 'idle',
    update: characterSessionStore.getState().update,
    retryLoad: () => {
      if (id !== undefined) void characterSessionStore.getState().load(id);
    },
  };
}
