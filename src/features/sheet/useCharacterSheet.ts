import { useEffect, useMemo } from 'react';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type AsyncStatus, useRegistryState } from '@/data5e/hooks';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import {
  type CharacterLoadStatus,
  type CharacterSaveStatus,
  type CharacterSessionState,
  characterSessionStore,
  type DocUpdater,
  useCharacterSession,
} from '@/stores/characterSession';
import { type CharacterDataState, useCharacterData } from './useCharacterData';

export interface CharacterSheetState {
  doc: CharacterDoc | null;
  sheet: DerivedSheet | null;
  /**
   * The sheet without the effects in play (Bless, Rage): what the build alone
   * makes, for telling which numbers an effect raised. The same object as
   * `sheet` while none are in play; absent where a test leaves it out, which
   * reads as the same.
   */
  built?: DerivedSheet | null;
  loadStatus: CharacterLoadStatus;
  missing: boolean;
  error: string | null;
  saveStatus: CharacterSaveStatus;
  update: DocUpdater;
  /** Put back an earlier snapshot as its own history entry (an undo, a restore). */
  restore: CharacterSessionState['restore'];
  retryLoad: () => void;
  /**
   * The game data the sheet is derived from. Until it is here `sheet` stays
   * null, and an `error` is the difference between waiting for it and never
   * getting it (not downloaded, and offline or failing). That includes this
   * character's class files and equipped gear, not only the essentials.
   */
  data: {
    status: AsyncStatus;
    error: string | null;
    retry: () => void;
    equipment?: CharacterDataState['equipment'];
  };
}

/** Load the character for a route id and derive its sheet reactively. */
export function useCharacterSheet(id: string | undefined): CharacterSheetState {
  const registryState = useRegistryState(['essentials']);
  const registry = registryState.registry;
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

  const characterData = useCharacterData(doc, registry, rev);
  const dataReady = characterData.status === 'ready';

  // biome-ignore lint/correctness/useExhaustiveDependencies: rev tracks doc mutations
  const sheets = useMemo(() => {
    if (doc === null || registry === null || !dataReady) return null;
    const context = engineContextFor(registry);
    const sheet = deriveSheet(doc, context);
    const inPlay = (doc.play.activeEffects ?? []).length > 0;
    return { sheet, built: inPlay ? deriveSheet(doc, context, { active: false }) : sheet };
  }, [doc, registry, rev, dataReady]);
  const sheet = sheets?.sheet ?? null;

  // While a character is still being built (HP never manually touched),
  // currentHp tracks the derived max — so leveling up keeps you at full.
  // The first time the player damages/heals HP in play, it locks (see PlayTab).
  // Never affects saved characters (hpInitialized === undefined).
  // Automatic, since the sheet does this by itself: it never raises a save
  // conflict with another tab, and is not saved over another tab's copy
  // until the person edits (see `scheduleSave` in the session).
  useEffect(() => {
    if (doc === null || sheet === null) return;
    if (doc.play.hpInitialized === false && doc.play.currentHp !== sheet.maxHp.value) {
      characterSessionStore.getState().update(
        (d) => {
          d.play.currentHp = sheet.maxHp.value;
        },
        undefined,
        { automatic: true },
      );
    }
  }, [doc, sheet]);

  return {
    doc,
    sheet,
    built: sheets?.built ?? null,
    loadStatus: routeLoadStatus,
    missing: routeLoadStatus === 'missing',
    error: requestedId === id ? error : null,
    saveStatus: saveCharacterId === id ? saveStatus : 'idle',
    update: characterSessionStore.getState().update,
    restore: characterSessionStore.getState().restore,
    retryLoad: () => {
      if (id !== undefined) void characterSessionStore.getState().load(id);
    },
    data: {
      // The essentials come first: nothing can say what else is missing without them.
      status: registryState.status === 'ready' ? characterData.status : registryState.status,
      error: registryState.status === 'ready' ? characterData.error : registryState.error,
      retry: () => {
        registryState.retry();
        characterData.retry();
      },
      equipment: characterData.equipment,
    },
  };
}
