import { useEffect, useMemo, useState } from 'react';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistry } from '@/data5e/hooks';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import { characterSessionStore, useCharacterSession } from '@/stores/characterSession';

export interface CharacterSheetState {
  doc: CharacterDoc | null;
  sheet: DerivedSheet | null;
  missing: boolean;
  update: (recipe: (doc: CharacterDoc) => void) => void;
}

/** Load the character for a route id and derive its sheet reactively. */
export function useCharacterSheet(id: string | undefined): CharacterSheetState {
  const registry = useRegistry(['essentials']);
  const doc = useCharacterSession((s) => s.doc);
  const rev = useCharacterSession((s) => s.rev);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    void characterSessionStore
      .getState()
      .load(id)
      .then((ok) => setMissing(!ok));
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
    missing,
    update: characterSessionStore.getState().update,
  };
}
