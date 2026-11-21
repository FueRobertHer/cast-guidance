import type { Entity } from '@/data5e/copyMod';
import { subraceBelongsTo } from '@/data5e/subraceOptions';
import type { CharacterDoc, ChoicePrompt, DerivedSheet, EntityRef } from '@/engine/types';
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
  if (race === undefined || doc.subrace !== undefined) return false;
  // Only a subrace that names this printing makes one required: one offered by
  // its race's name alone (hand-written homebrew) may be meant for another.
  if (!offered.some((s) => typeof s.raceSource === 'string')) return false;
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
        ? Math.max(0, limits.known - leveled - classPicksLeft(doc, sheet.pending, block.classUid))
        : limits.prepared !== undefined
          ? Math.max(0, limits.prepared - countPrepared(state.prepared, limits, levelOf))
          : 0;
    return cantripsLeft > 0 || spellsLeft > 0
      ? [{ className: block.className, cantrips: cantripsLeft, spells: spellsLeft }]
      : [];
  });
}

/**
 * The picks a class's own spell prompts still wait for (a 2014 Bard's Magical
 * Secrets). Each one the class learns takes a place in its spells known once
 * picked, so the engine's prompt already asks for it: counting it here as well
 * would ask twice. Cantrip picks do not take a place, so they are left out.
 */
function classPicksLeft(
  doc: CharacterDoc,
  pending: readonly ChoicePrompt[],
  classUid: string,
): number {
  const prefix = `class:${classUid}:known:`;
  return pending
    .filter((p) => p.kind === 'spell' && p.id.startsWith(prefix) && !onlyCantrips(p))
    .reduce((sum, p) => {
      const stored = doc.choices[p.id];
      const held = Array.isArray(stored) ? stored.length : stored === undefined ? 0 : 1;
      return sum + Math.max(0, p.count - held);
    }, 0);
}

/** Whether a spell prompt can only pick a cantrip, as the engine reads it. */
function onlyCantrips(p: ChoicePrompt): boolean {
  return p.spellQuery !== undefined
    ? p.spellQuery.levels.length > 0 && p.spellQuery.levels.every((level) => level === 0)
    : p.options.length > 0 && p.options.every((o) => /#c\b/i.test(o.id));
}

/** "2 cantrips and 1 spell", for a shortfall. */
export function shortfallWords(s: SpellShortfall): string {
  const parts = [
    s.cantrips > 0 ? `${s.cantrips} cantrip${s.cantrips > 1 ? 's' : ''}` : undefined,
    s.spells > 0 ? `${s.spells} spell${s.spells > 1 ? 's' : ''}` : undefined,
  ].filter((p) => p !== undefined);
  return parts.join(' and ');
}
