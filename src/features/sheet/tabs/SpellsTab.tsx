import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { SpellManager } from '../SpellManager';
import type { CharacterSheetState } from '../useCharacterSheet';
import { YourSpells } from '../YourSpells';

type View = 'yours' | 'choose';

const VIEWS = [
  { value: 'yours', label: 'Your spells' },
  { value: 'choose', label: 'Choose', name: 'Choose spells' },
] as const;

/**
 * Leads with the character's own spells, for the table; choosing them, which
 * happens between sessions, is one step away. The view is the tab's to hold for
 * as long as it is open, as a list's search is.
 */
export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const [view, setView] = useState<View>('yours');
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;
  if (sheet.spellcasting.length === 0) {
    return <SpellManager doc={doc} sheet={sheet} update={update} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SegmentedControl<View>
        label="Spells view"
        options={VIEWS}
        value={view}
        onChange={setView}
        block
      />
      {view === 'yours' ? (
        <YourSpells doc={doc} sheet={sheet} update={update} />
      ) : (
        <SpellManager doc={doc} sheet={sheet} update={update} />
      )}
    </div>
  );
}
