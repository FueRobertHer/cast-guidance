import { useOutletContext } from 'react-router';
import { SpellManager } from '../SpellManager';
import type { CharacterSheetState } from '../useCharacterSheet';

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* Slot pips live on the Play tab; casting here spends them too. */}
      <SpellManager doc={doc} sheet={sheet} update={update} />
    </div>
  );
}
