import type { Entity } from '@/data5e/copyMod';
import { subraceBelongsTo } from '@/data5e/subraceOptions';
import type { CharacterDoc, DerivedSheet, EntityRef } from '@/engine/types';
import { classifyKnown } from '@/features/sheet/SpellManager';
import { countPrepared, spellLimits } from '@/features/sheet/spellTrim';

/**
 * Picks the rules engine leaves out of its pending list, which a new
 * character still needs (review item 3): a subrace the race cannot go
 * without, and spells not yet chosen. Counted beside the engine's pending
 * picks in "to choose" and on Review.
 */

/**
 * Whether the draft's race needs a subrace it does not have. A race whose
 * data has a nameless subrace (its base entry: the 2014 Human, Half-Elf,
 * Tiefling) is whole without one; a race whose every subrace has a name (the
 * 2014 Elf, Dwarf, Halfling) is not.
 */
export function subraceMissing(
  doc: CharacterDoc,
  allSubraces: readonly Entity[],
  offered: readonly Entity[],
): boolean {
  const race = doc.race;
  if (race === undefined || doc.subrace !== undefined || offered.length === 0) return false;
  return !allSubraces.some((s) => typeof s.name !== 'string' && subraceBelongsTo(s, race));
}

/** What one casting class still has to choose: cantrips, and leveled spells. */
export interface SpellShortfall {
  className: string;
  cantrips: number;
  spells: number;
}

/**
 * The spells each casting class has room for and has not chosen yet: its
 * cantrips, and its prepared spells (a prepared or spellbook caster) or
 * spells known (a known or pact caster). Only classes short of something.
 */
export function spellShortfalls(
  doc: CharacterDoc,
  sheet: DerivedSheet,
  levelOf: (ref: EntityRef) => number | undefined,
): SpellShortfall[] {
  return sheet.spellcasting.flatMap((block) => {
    const state = doc.spellcasting[block.classUid] ?? { known: [], prepared: [] };
    const limits = spellLimits(block);
    const { cantrips, leveled } = classifyKnown(state.known, levelOf, limits);
    const cantripsLeft = Math.max(0, (limits.cantrips ?? 0) - cantrips);
    const spellsLeft =
      limits.known !== undefined
        ? Math.max(0, limits.known - leveled)
        : limits.prepared !== undefined
          ? Math.max(0, limits.prepared - countPrepared(state.prepared, limits, levelOf))
          : 0;
    return cantripsLeft > 0 || spellsLeft > 0
      ? [{ className: block.className, cantrips: cantripsLeft, spells: spellsLeft }]
      : [];
  });
}

/** "2 cantrips and 1 spell", for a shortfall. */
export function shortfallWords(s: SpellShortfall): string {
  const parts = [
    s.cantrips > 0 ? `${s.cantrips} cantrip${s.cantrips > 1 ? 's' : ''}` : undefined,
    s.spells > 0 ? `${s.spells} spell${s.spells > 1 ? 's' : ''}` : undefined,
  ].filter((p) => p !== undefined);
  return parts.join(' and ');
}
