/**
 * Standing defenses, senses and speeds that subclass features and optional
 * features state only in prose. Unlike a curated row (`CURATED`), a
 * row here adds to what the prose scan reads from the same feature: the scan keeps
 * its actions and pools (Wind Soul's flight for others, Guarded Mind's die), and
 * this adds the resistance or speed the scan does not read. Keys as in `CURATED`:
 *   - subclass features: `featureName|subclassName` (lowercased)
 *   - optional features: `name|source` (lowercased)
 * `level` is the level the feature is gained at, which tells apart option features
 * of one name (Storm Herald's Desert at 3, 6 and 14).
 */
import type { Collector } from '../effects/base';
import type { EffectOrigin, WhileState } from '../types';

type StandingFn = (
  col: Collector,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
) => void;

/** The 2024 printing of a feature whose subclass shares its name with the 2014 one. */
const printed2024 = (origin: EffectOrigin, from?: string) =>
  origin.uid.endsWith('|xphb') || from === 'xphb';

/** Resistance to each type, held while `held` says (always when empty). */
const resists =
  (types: readonly string[], note?: string, held?: readonly WhileState[]): StandingFn =>
  (col, origin) => {
    for (const damageType of types) {
      col.add({
        kind: 'resist',
        damageType,
        ...(note !== undefined ? { note } : {}),
        ...(held !== undefined ? { while: held } : {}),
        origin,
      });
    }
  };

const immunities =
  (types: readonly string[]): StandingFn =>
  (col, origin) => {
    for (const damageType of types) col.add({ kind: 'immune', damageType, origin });
  };

const conditionImmunities =
  (conditions: readonly string[], note?: string, held?: readonly WhileState[]): StandingFn =>
  (col, origin) => {
    for (const condition of conditions) {
      col.add({
        kind: 'conditionImmune',
        condition,
        ...(note !== undefined ? { note } : {}),
        ...(held !== undefined ? { while: held } : {}),
        origin,
      });
    }
  };

/** The longest darkvision collected so far (the race's is in by now), from `from` alone if given. */
function darkvisionSoFar(col: Collector, from?: EffectOrigin['type']): number {
  let best = 0;
  for (const e of col.effects) {
    if (e.kind !== 'sense' || e.sense.toLowerCase() !== 'darkvision') continue;
    if (from !== undefined && e.origin.type !== from) continue;
    best = Math.max(best, e.range);
  }
  return best;
}

/**
 * Darkvision of `range`, or what the character has plus `more` when it has some
 * already ("its range increases by 60 feet"). `raceOnly`: only a race's counts
 * (the 2014 Gloom Stalker's "from your race").
 */
const darkvisionOrMore =
  (range: number, more: number, raceOnly = false): StandingFn =>
  (col, origin) => {
    const had = darkvisionSoFar(col, raceOnly ? 'race' : undefined);
    col.add({ kind: 'sense', sense: 'darkvision', range: had > 0 ? had + more : range, origin });
  };

/** The subclass branch picked (a Genie's kind, a 2024 Land druid's land), lowercased. */
function branchOf(col: Collector, origin: EffectOrigin): string | undefined {
  const picked = col.doc.choices[`${origin.type}:${origin.uid}:branch`];
  return Array.isArray(picked) ? picked[0]?.toLowerCase() : undefined;
}

export const STANDING: Record<string, StandingFn> = {
  // Every row the stored format holds is data, in
  // `src/rules/cast-guidance/standing.json`: more of each section below, and all
  // of the Artificer's, Sorcerer's, Wizard's, WoW's and optional features'. These
  // need a test of the printing, the subclass branch picked, or what the character
  // has already. The picks are data too: Bestial Soul and Tiger (4a, 4b); Unfettered
  // Mind, Elegant Courtier (its Persuasion bonus a curated row) and Iron Mind, a
  // save or a pick of one the character lacks (4c); and a named option or a damage
  // type (4d): Aspect of the Wilds, Aura of Elemental Shielding and both Fiendish
  // Resiliences.

  // --- Druid -----------------------------------------------------------------
  "nature's ward|circle of the land": (col, origin, from, level) => {
    if (printed2024(origin, from)) {
      conditionImmunities(['poisoned'])(col, origin, from, level);
      const land = branchOf(col, origin)?.split(' ')[0];
      const type = { arid: 'fire', polar: 'cold', temperate: 'lightning', tropical: 'poison' }[
        land ?? ''
      ];
      if (type !== undefined) resists([type])(col, origin, from, level);
      return;
    }
    immunities(['poison'])(col, origin, from, level);
    conditionImmunities(['poisoned', 'disease'])(col, origin, from, level);
    // Only a charm or fright from an elemental or fey: an immunity would hold off
    // every one in play, so it is said, not counted.
    col.add({
      kind: 'cue',
      tone: 'ward',
      text: "Can't be charmed or frightened by elementals or fey.",
      origin,
    });
  },

  // --- Monk ------------------------------------------------------------------
  'darkvision|warrior of shadow': darkvisionOrMore(60, 60),

  // --- Ranger ----------------------------------------------------------------
  'umbral sight|gloom stalker': (col, origin, from, level) =>
    printed2024(origin, from)
      ? darkvisionOrMore(60, 60)(col, origin, from, level)
      : darkvisionOrMore(60, 30, true)(col, origin, from, level),

  // --- Rogue -----------------------------------------------------------------
  // The god chosen is the cantrip picked from its row of the table.
  'dread allegiance|scion of the three': (col, origin, from, level) => {
    const byCantrip: Record<string, string> = {
      'minor illusion': 'psychic',
      'blade ward': 'poison',
      'chill touch': 'necrotic',
    };
    const cantrip = col.effects.find(
      (e) =>
        e.kind === 'grantSpell' &&
        e.origin.uid === origin.uid &&
        byCantrip[e.spell.name.toLowerCase()] !== undefined,
    );
    const type =
      cantrip?.kind === 'grantSpell' ? byCantrip[cantrip.spell.name.toLowerCase()] : undefined;
    if (type !== undefined) resists([type])(col, origin, from, level);
  },

  // --- Warlock ---------------------------------------------------------------
  'elemental gift|the genie': (col, origin, from, level) => {
    const kind = branchOf(col, origin);
    const type = { dao: 'bludgeoning', djinni: 'thunder', efreeti: 'fire', marid: 'cold' }[
      kind ?? ''
    ];
    if (type !== undefined) resists([type])(col, origin, from, level);
  },
};

/** Whether `STANDING` has a row under a key, as `emitStandingEffects` looks it up. */
export function hasStandingRow(key: string): boolean {
  return STANDING[key] !== undefined;
}

/**
 * Adds a feature's standing row, if it has one, beside the prose scan. Returns
 * whether it had one, so the caller stops at the first of its keys that does.
 */
export function emitStandingEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
): boolean {
  const fn = STANDING[key];
  fn?.(col, origin, from, level);
  return fn !== undefined;
}
