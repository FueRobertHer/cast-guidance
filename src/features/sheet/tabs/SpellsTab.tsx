import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { CharacterDoc } from '@/engine/types';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { cardClass } from '@/ui/surfaces';
import { AddSpellSheet } from '../AddSpellSheet';
import { SpellManager } from '../SpellManager';
import type { CharacterSheetState } from '../useCharacterSheet';
import { YourSpells } from '../YourSpells';

type View = 'yours' | 'choose';

const VIEWS = [
  { value: 'yours', label: 'Your spells' },
  { value: 'choose', label: 'Choose', name: 'Choose spells' },
] as const;

/** Who has no spellcasting: the one class by name ("Fighter"), else the character. */
function noCasterName(doc: CharacterDoc): string {
  if (doc.classes.length === 1 && doc.classes[0] !== undefined) return doc.classes[0].ref.name;
  return doc.name.trim() === '' ? 'This character' : doc.name.trim();
}

/**
 * Leads with the character's own spells, for the table; choosing them, which
 * happens between sessions, is one step away. The view is the tab's to hold for
 * as long as it is open, as a list's search is.
 *
 * Every character has the tab: one with no spellcasting can still add a spell
 * the table allows, and its granted spells are listed here as a caster's are.
 */
export function Component() {
  const { sheet, built, doc, update } = useOutletContext<CharacterSheetState>();
  const [view, setView] = useState<View>('yours');
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;
  const add = <AddSpellSheet doc={doc} sheet={sheet} update={update} />;
  if (sheet.spellcasting.length === 0) {
    const none = sheet.grantedSpells.length === 0;
    // Add a spell keeps its place as the empty state turns into the list, so
    // the sheet it opened hands focus back to it rather than to the page.
    return (
      <div className={none ? `${cardClass} flex flex-col gap-3` : 'flex flex-col gap-4'}>
        {none ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-heading">{noCasterName(doc)} has no spellcasting</h2>
            <p className="text-caption text-ink-muted">
              You can still add a spell your table allows, like a gift or a curse from your DM. You
              choose the ability it casts with.
            </p>
          </div>
        ) : (
          <YourSpells doc={doc} sheet={sheet} built={built} update={update} />
        )}
        {add}
      </div>
    );
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
        <>
          <YourSpells doc={doc} sheet={sheet} built={built} update={update} />
          {add}
        </>
      ) : (
        <SpellManager doc={doc} sheet={sheet} update={update} />
      )}
    </div>
  );
}
