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
  // The class's own additional spells: `class:<uid>:spell:<group>:<i>`, then
  // the slot (`known:<level>:<n>`). An optional feature's picks start with the
  // class too, but carry the option's own uid, which the engine does not count.
  const prefix = `class:${classUid}:spell:`;
  return pending
    .filter(
      (p) =>
        p.kind === 'spell' &&
        p.origin.type === 'class' &&
        p.origin.uid === classUid &&
        p.id.startsWith(prefix) &&
        p.id.includes(':known:') &&
        !onlyCantrips(p),
    )
    .reduce((sum, p) => sum + Math.max(0, p.count - validPicks(doc, p)), 0);
}

/**
 * The saved picks the engine grants: those among the prompt's options, each
 * once, up to its count. A prompt holding a stale or repeated pick stays
 * pending with the rest still to choose.
 */
function validPicks(doc: CharacterDoc, p: ChoicePrompt): number {
  const stored = doc.choices[p.id];
  const raw = Array.isArray(stored)
    ? stored.map(String)
    : stored === undefined
      ? []
      : [String(stored)];
  const options = new Set(p.options.map((o) => o.id.toLowerCase()));
  const held = new Set(raw.map((r) => r.toLowerCase()).filter((r) => options.has(r)));
  return Math.min(held.size, p.count);
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
