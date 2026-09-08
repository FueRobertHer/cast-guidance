/**
 * The builder's spell-grant field, to and from 5etools `additionalSpells`.
 *
 * An item that grants a spell says so in the same shape a race or a feat does,
 * which is why the engine needed no new vocabulary to read one. That shape is
 * nested and expressive, and the form offers one spell with one limit, so these
 * functions translate between the two and, crucially, admit when they can't:
 * a file saying more than the form can show is left alone rather than flattened
 * to whatever fits.
 */
import { ABILITIES, type Ability } from '@/engine/types';

export interface SpellGrant {
  /** The ref as written: "misty step", or "misty step|phb" to pin a source. */
  spell: string;
  /** Casts before a long rest. Undefined is at will, which is what a cantrip wants. */
  perDay?: number;
  /** Whose modifier sets the attack and DC. Undefined leaves the spell flat. */
  ability?: Ability;
}

/** A file the form cannot express: several spells, level gates, choices. */
export const COMPLEX = 'complex';

const isAbility = (v: unknown): v is Ability => ABILITIES.includes(v as Ability);

/** The single spell name in `["misty step"]`, or undefined for anything else. */
function loneSpell(list: unknown): string | undefined {
  if (!Array.isArray(list) || list.length !== 1) return undefined;
  const only = list[0];
  return typeof only === 'string' && only.trim() !== '' ? only : undefined;
}

/**
 * The grant behind an `additionalSpells` value, `COMPLEX` when the file says
 * more than one spell with one limit, or undefined when there is no grant.
 */
export function readSpellGrant(raw: unknown): SpellGrant | typeof COMPLEX | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length !== 1) return COMPLEX;
  const entry = raw[0];
  if (entry === null || typeof entry !== 'object') return COMPLEX;
  const e = entry as Record<string, unknown>;

  const keys = Object.keys(e);
  if (keys.some((k) => k !== 'ability' && k !== 'known' && k !== 'innate')) return COMPLEX;
  if (e.ability !== undefined && !isAbility(e.ability)) return COMPLEX;
  const ability = isAbility(e.ability) ? e.ability : undefined;

  if (e.known !== undefined && e.innate !== undefined) return COMPLEX;

  if (e.known !== undefined) {
    const known = e.known as Record<string, unknown> | null;
    // `typeof null` is 'object', and this function exists to survive whatever a
    // hand-written file holds, so a null here has to fail rather than throw.
    if (known === null || typeof known !== 'object') return COMPLEX;
    if (Object.keys(known).join() !== '_') return COMPLEX;
    const spell = loneSpell(known._);
    return spell === undefined ? COMPLEX : { spell, ability };
  }

  if (e.innate !== undefined) {
    const innate = e.innate as Record<string, unknown> | null;
    if (innate === null || typeof innate !== 'object') return COMPLEX;
    if (Object.keys(innate).join() !== '_') return COMPLEX;
    const bucket = innate._ as Record<string, unknown> | undefined;
    if (bucket === null || typeof bucket !== 'object') return COMPLEX;
    if (Object.keys(bucket).join() !== 'daily') return COMPLEX;
    const daily = bucket.daily as Record<string, unknown>;
    if (daily === null || typeof daily !== 'object') return COMPLEX;
    const counts = Object.keys(daily);
    if (counts.length !== 1) return COMPLEX;
    const perDay = Number.parseInt(counts[0] ?? '', 10);
    const spell = loneSpell(daily[counts[0] ?? '']);
    if (spell === undefined || Number.isNaN(perDay) || perDay <= 0) return COMPLEX;
    return { spell, perDay, ability };
  }

  // `{ ability: "cha" }` alone grants nothing; treat it as no grant so clearing
  // the spell box clears the field rather than leaving a husk behind.
  return undefined;
}

/**
 * The `additionalSpells` value for a grant, or undefined to drop the field.
 *
 * At will becomes `known`, which is how a cantrip on a wand should read: no
 * pool, no tracking. A per-day count becomes an `innate` daily bucket, the
 * shape the engine turns into a resource with its own pips.
 */
export function writeSpellGrant(grant: SpellGrant): unknown {
  const spell = grant.spell.trim();
  if (spell === '') return undefined;
  const ability = grant.ability !== undefined ? { ability: grant.ability } : {};
  const uses = grant.perDay;
  if (uses === undefined || !Number.isFinite(uses) || uses <= 0) {
    return [{ ...ability, known: { _: [spell] } }];
  }
  return [{ ...ability, innate: { _: { daily: { [String(Math.floor(uses))]: [spell] } } } }];
}
