import type { Entity } from '@/data5e/copyMod';
import { parseSpellRef } from '@/engine/effects/additionalSpells';
import { parseSpellFilter, spellFitsQuery } from '@/engine/spellQuery';
import type { SpellcastingBlock } from '@/engine/types';

const uidOf = (e: Entity) => `${String(e.name)}|${String(e.source)}`.toLowerCase();

/**
 * What an expanded spell list (`SpellcastingBlock.expanded`: a Warlock patron's,
 * Divine Soul's, a dragonmark's) adds to a class's list: for a spell, the name of
 * what adds it, or undefined. A named spell matches any printing of it, so the
 * rules version picks which one shows; a filter ("level=1|class=Cleric") matches
 * as a spell prompt's does, its classes read through `onClassList`.
 */
export function expandedListMatcher(
  expanded: SpellcastingBlock['expanded'],
  onClassList: (className: string, uid: string) => boolean,
): (spell: Entity) => string | undefined {
  const lists = (expanded ?? []).map((x) => ({
    from: x.from,
    names: new Set(x.spells.map((ref) => parseSpellRef(ref).name.toLowerCase())),
    queries: x.filters.flatMap((f) => parseSpellFilter(f) ?? []),
  }));
  if (lists.length === 0) return () => undefined;
  return (spell) => {
    const name = String(spell.name).toLowerCase();
    return lists.find(
      (x) =>
        x.names.has(name) ||
        x.queries.some(
          (q) =>
            spellFitsQuery(spell, q) &&
            (q.classes.length === 0 || q.classes.some((c) => onClassList(c, uidOf(spell)))),
        ),
    )?.from;
  };
}
