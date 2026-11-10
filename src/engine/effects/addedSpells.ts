import type { AddedSpell, CharacterDoc, EffectOrigin } from '../types';
import { ABILITIES } from '../types';
import type { Collector } from './base';

/** What an added spell's rows, pools and casting tiles say it comes from. */
export const ADDED_SPELL_ORIGIN: EffectOrigin = {
  type: 'added',
  uid: 'added',
  label: 'Added by you',
};

const USES = new Set<AddedSpell['uses']>(['long', 'short', 'will']);

/**
 * The player's added spells that are whole: a stored doc is not checked field
 * by field, so one written by hand or by an older build is read leniently.
 */
export function addedSpellsOf(doc: Pick<CharacterDoc, 'addedSpells'>): AddedSpell[] {
  if (!Array.isArray(doc.addedSpells)) return [];
  return doc.addedSpells.filter(
    (a): a is AddedSpell =>
      typeof a === 'object' &&
      a !== null &&
      typeof a.spell?.name === 'string' &&
      a.spell.name !== '' &&
      typeof a.spell.source === 'string' &&
      (ABILITIES as readonly string[]).includes(a.ability) &&
      USES.has(a.uses),
  );
}

/**
 * The pool holding a limited added spell's one use. The name as it is, not a
 * slug: the sheet holds one added spell per name, and a slug would let
 * "Fire-Bolt" and "Fire Bolt", or two names in another script, share a pool.
 */
export function addedSpellPoolKey(name: string): string {
  return `spell:added:${name.trim().toLowerCase()}`;
}

/**
 * Spells the player added outside the build, granted as a species' or a feat's
 * are: with the ability chosen for each, and one use a rest unless at will. A
 * cantrip is always at will.
 */
export function collectAddedSpells(col: Collector): void {
  const origin = ADDED_SPELL_ORIGIN;
  for (const added of addedSpellsOf(col.doc)) {
    const { spell, ability } = added;
    const level = col.ctx.get('spell', spell.name, spell.source)?.level;
    const uses = level === 0 ? 'will' : added.uses;
    if (uses === 'will') {
      col.add({ kind: 'grantSpell', spell, ability, origin });
      continue;
    }
    const key = addedSpellPoolKey(spell.name);
    col.add({ kind: 'resource', key, label: spell.name, max: 1, resetOn: uses, origin });
    col.add({
      kind: 'grantSpell',
      spell,
      ability,
      usage: uses === 'long' ? '1/day' : '1/rest',
      resourceKey: key,
      origin,
    });
  }
}
