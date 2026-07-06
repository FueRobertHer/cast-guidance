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

  return {
    doc,
    sheet,
    missing,
    update: characterSessionStore.getState().update,
  };
}
