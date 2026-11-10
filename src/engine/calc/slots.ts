import type { Collector } from '../effects/base';
import { num, str } from '../effects/base';
import {
  type Ability,
  type CharacterDoc,
  type ClassLevelEntry,
  type DataEntity,
  type DerivedAbility,
  type EffectOrigin,
  refUid,
  type SpellcastingBlock,
  type SpellcastingMode,
} from '../types';
import { dv } from './core';

/**
 * Classify how a class relates to its spells from its 5etools data (GAME-002).
 * Signals, in order: Pact Magic wins; `preparedSpells` + a fixed known-spell
 * progression is a spellbook (wizard); `preparedSpells` alone is a prepared
 * caster (cleric/druid/paladin); a known-spell progression is a known caster
 * (sorcerer/bard/ranger). Anything without a caster progression is `none`.
 */
export function classSpellcastingMode(cls: DataEntity | undefined): SpellcastingMode {
  if (cls === undefined) return 'none';
  const progression = str(cls.casterProgression);
  if (progression === undefined) return 'none';
  if (progression === 'pact') return 'pact';
  const prepared = cls.preparedSpells !== undefined || Array.isArray(cls.preparedSpellsProgression);
  const knowsFixed = Array.isArray(cls.spellsKnownProgressionFixed);
  if (prepared) return knowsFixed ? 'spellbook' : 'prepared';
  if (Array.isArray(cls.spellsKnownProgression) || knowsFixed) return 'known';
  return 'none';
}

/** Standard full-caster slot table; row = caster level 1-20, cols = slot levels 1-9. */
// prettier-ignore
export const STANDARD_SLOTS: number[][] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Warlock pact magic: [count, slotLevel] by class level 1-20. */
// prettier-ignore
export const PACT_SLOTS: Array<[number, number]> = [
  [1, 1],
  [2, 1],
  [2, 2],
  [2, 2],
  [2, 3],
  [2, 3],
  [2, 4],
  [2, 4],
  [2, 5],
  [2, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [3, 5],
  [4, 5],
  [4, 5],
  [4, 5],
  [4, 5],
];

/** Mystic Arcanum: the warlock level that opens each of spell levels 6-9, in both editions. */
export const ARCANUM_LEVELS = [11, 13, 15, 17];

/** The lowest spell level a pact caster learns as an arcanum rather than a spell. */
export const ARCANUM_FIRST_SPELL_LEVEL = 6;

/** See `SpellcastingBlock.mysticArcanum`. */
export function mysticArcanumLevels(classLevel: number): number[] {
  return ARCANUM_LEVELS.flatMap((at, i) =>
    at <= classLevel ? [ARCANUM_FIRST_SPELL_LEVEL + i] : [],
  );
}

const NO_SLOTS = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/**
 * A class's or subclass's own spell slot table ("Spell Slots per Spell
 * Level"), one row per class level, nine columns. 5etools keeps it in
 * `classTableGroups` on a class and `subclassTableGroups` on a subclass
 * caster such as the Eldritch Knight; undefined when there is none.
 */
export function ownSlotTable(e: DataEntity): number[][] | undefined {
  for (const key of ['classTableGroups', 'subclassTableGroups']) {
    const groups = e[key];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const rows = (g as { rowsSpellProgression?: unknown } | null)?.rowsSpellProgression;
      if (!Array.isArray(rows) || rows.length === 0 || !rows.every(Array.isArray)) continue;
      return rows.map((r: unknown[]) =>
        NO_SLOTS.map((_, i) => {
          const n = r[i];
          return typeof n === 'number' && n > 0 ? n : 0;
        }),
      );
    }
  }
  return undefined;
}

/**
 * The full-caster row a class's own table follows, for data with no table.
 * On its own, a half or third caster rounds up from its first spellcasting
 * level (a Paladin 5 has a level 3 caster's slots), where the shared
 * multiclass count (`casterLevelFor`) rounds down.
 */
export function ownCasterLevel(progression: string, classLevel: number): number {
  switch (progression) {
    case 'full':
      return classLevel;
    case 'artificer':
      return Math.ceil(classLevel / 2);
    case '1/2':
      return classLevel >= 2 ? Math.ceil(classLevel / 2) : 0;
    case '1/3':
      return classLevel >= 3 ? Math.ceil(classLevel / 3) : 0;
    default:
      return 0;
  }
}

const KNOWN_PROGRESSIONS = new Set(['full', 'artificer', '1/2', '1/3']);

/**
 * A slot caster's own slots at each class level 1-20: its table's row where
 * the data has one, else the full-caster row its progression follows (past
 * the end of a short homebrew table, say). Undefined for a progression this
 * cannot read and no table.
 */
function ownSlotRows(caster: DataEntity, progression: string): number[][] | undefined {
  const table = ownSlotTable(caster);
  const known = KNOWN_PROGRESSIONS.has(progression);
  if (table === undefined && !known) return undefined;
  return Array.from({ length: Math.max(20, table?.length ?? 0) }, (_, i) => {
    const row = table?.[i];
    if (row !== undefined) return row;
    const level = known ? ownCasterLevel(progression, i + 1) : 0;
    return level > 0 ? [...(STANDARD_SLOTS[Math.min(level, 20) - 1] ?? NO_SLOTS)] : [...NO_SLOTS];
  });
}

/** A slot caster's own slots at its current level, all zeros where it has none. */
function ownSlotsAt(caster: DataEntity, progression: string, classLevel: number): number[] {
  return ownSlotRows(caster, progression)?.[Math.min(classLevel, 20) - 1] ?? [...NO_SLOTS];
}

/** See `SpellcastingBlock.learnable`. */
export function learnableSpellLevels(
  caster: DataEntity,
  progression: string,
  classLevel: number,
): SpellcastingBlock['learnable'] {
  const unlocksAt: (number | null)[] = [];
  if (progression === 'pact') {
    for (let n = 1; n <= 9; n++) {
      const i = PACT_SLOTS.findIndex(([, level]) => level >= n);
      unlocksAt.push(n <= 5 ? (i >= 0 ? i + 1 : null) : (ARCANUM_LEVELS[n - 6] ?? null));
    }
  } else {
    const rows = ownSlotRows(caster, progression);
    if (rows === undefined) return undefined;
    for (let n = 1; n <= 9; n++) {
      const i = rows.findIndex((r) => (r[n - 1] ?? 0) > 0);
      unlocksAt.push(i >= 0 ? i + 1 : null);
    }
  }
  const upTo = unlocksAt.reduce<number>(
    (top, at, i) => (at !== null && at <= classLevel ? i + 1 : top),
    0,
  );
  return { upTo, unlocksAt };
}

/**
 * Where a class's spellcasting comes from: the class itself, or, for a class
 * with none of its own, its subclass (the Eldritch Knight's Fighter).
 */
function casterOf(
  col: Collector,
  entry: ClassLevelEntry,
): { cls: DataEntity; caster: DataEntity; progression: string; sub?: DataEntity } | undefined {
  const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
  if (cls === undefined) return undefined;
  const own = str(cls.casterProgression);
  if (own !== undefined) return { cls, caster: cls, progression: own };
  const ref = entry.subclass;
  const sub = ref !== undefined ? col.ctx.get('subclass', ref.name, ref.source) : undefined;
  const progression = str(sub?.casterProgression);
  if (sub === undefined || progression === undefined) return undefined;
  return { cls, caster: sub, progression, sub };
}

export function casterLevelFor(progression: string, classLevel: number): number {
  switch (progression) {
    case 'full':
      return classLevel;
    case '1/2':
      return classLevel >= 2 ? Math.floor(classLevel / 2) : 0;
    case 'artificer':
      return Math.ceil(classLevel / 2);
    case '1/3':
      return classLevel >= 3 ? Math.floor(classLevel / 3) : 0;
    default:
      return 0;
  }
}

/**
 * The 2014 prepared-spell formula: "<$level$> + <$wis_mod$>" (level plus the
 * modifier) for full casters, "<$level$> / 2 + <$cha_mod$>" (half the level,
 * rounded down) for the paladin and artificer. Never fewer than one. Reading
 * every formula as the first shape overstated a half caster's limit, which
 * hid real overage and let "Trim to limit" stop short.
 */
export function preparedFromFormula(
  formula: string | undefined,
  level: number,
  mod: number,
): number | undefined {
  if (formula?.includes('<$level$>') !== true) return undefined;
  const divisor = Number(/<\$level\$>\s*\/\s*(\d+)/.exec(formula)?.[1] ?? 1);
  return Math.max(1, Math.floor(level / (divisor > 0 ? divisor : 1)) + mod);
}

export function calcSpellcasting(
  doc: CharacterDoc,
  col: Collector,
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): SpellcastingBlock[] {
  const blocks: SpellcastingBlock[] = [];
  // The classes and subclasses this character has, for whose expanded list is whose.
  const owners = new Set(
    doc.classes.flatMap((c) => [
      refUid(c.ref),
      ...(c.subclass !== undefined ? [refUid(c.subclass)] : []),
    ]),
  );
  const ownedByAClass = (o: EffectOrigin) =>
    (o.type === 'class' || o.type === 'subclass') && owners.has(o.uid);

  const casters = doc.classes.map((entry) => ({ entry, from: casterOf(col, entry) }));

  // Spell slots: one class with them reads its own table. Several sum their
  // caster levels and read one shared row, which rounds a half or third
  // caster down. Pact magic is separate and counts toward neither, and so
  // does a class with no slots yet (a 2014 ranger at level 1 has no
  // Spellcasting feature to multiclass with).
  const slotCasters = casters.filter(
    (c) =>
      c.from !== undefined &&
      c.from.progression !== 'pact' &&
      ownSlotsAt(c.from.caster, c.from.progression, c.entry.levels).some((n) => n > 0),
  );
  let sharedSlots = [...NO_SLOTS];
  const only = slotCasters.length === 1 ? slotCasters[0] : undefined;
  if (only?.from !== undefined) {
    sharedSlots = [...ownSlotsAt(only.from.caster, only.from.progression, only.entry.levels)];
  } else if (slotCasters.length > 1) {
    const combinedCasterLevel = slotCasters.reduce(
      (sum, c) => sum + (c.from ? casterLevelFor(c.from.progression, c.entry.levels) : 0),
      0,
    );
    if (combinedCasterLevel > 0) {
      sharedSlots = [...(STANDARD_SLOTS[Math.min(combinedCasterLevel, 20) - 1] ?? NO_SLOTS)];
    }
  }

  for (const { entry, from } of casters) {
    if (from === undefined) continue;
    const { cls, caster: cs, progression, sub } = from;
    const abilityKey = str(cs.spellcastingAbility) as Ability | undefined;
    if (abilityKey === undefined) continue;

    const mod = abilities[abilityKey]?.mod ?? 0;
    const dcParts = [
      { label: 'Base', amount: 8 },
      { label: 'Proficiency', amount: profBonus },
      { label: `${abilityKey.toUpperCase()} modifier`, amount: mod },
    ];
    const atkParts = [
      { label: 'Proficiency', amount: profBonus },
      { label: `${abilityKey.toUpperCase()} modifier`, amount: mod },
    ];
    // A spell attack is one modifier for melee and ranged alike, so only a
    // bonus to every attack reaches it.
    // A DC bonus names its class; a subclass caster's block goes by either name.
    const names = [str(cls.name) ?? entry.ref.name, str(sub?.name)]
      .filter((n): n is string => n !== undefined)
      .map((n) => n.trim().toLowerCase());
    for (const b of col.effects) {
      if (
        b.kind === 'attackBonus' &&
        (b.attack === 'spell' || b.attack === 'any') &&
        b.scope === 'all' &&
        (b.ability === undefined || b.ability === abilityKey)
      ) {
        atkParts.push({ label: b.origin.label, amount: b.amount });
      }
      if (
        b.kind === 'spellDcBonus' &&
        (b.className === undefined || names.includes(b.className.trim().toLowerCase()))
      ) {
        dcParts.push({ label: b.origin.label, amount: b.amount });
      }
    }

    // Spell slots are a character-wide pool: every caster block sees the same
    // slots; pact magic is tracked on top for warlocks.
    const slots: number[] = [...sharedSlots];
    let pactSlots: { count: number; level: number } | undefined;
    let mysticArcanum: number[] | undefined;
    if (progression === 'pact') {
      const row = PACT_SLOTS[Math.min(entry.levels, 20) - 1];
      if (row !== undefined) pactSlots = { count: row[0], level: row[1] };
      mysticArcanum = mysticArcanumLevels(entry.levels);
    }

    const cantrips = Array.isArray(cs.cantripProgression)
      ? num(cs.cantripProgression[Math.min(entry.levels, 20) - 1])
      : undefined;

    const learnable = learnableSpellLevels(cs, progression, entry.levels);
    // Before its first spell slot (a 2014 paladin at level 1) a class has no
    // leveled spells to prepare or know, whatever its formula's floor of one.
    const noLeveledYet = learnable?.upTo === 0;

    let preparedMax: number | undefined;
    if (noLeveledYet) {
      preparedMax = undefined;
    } else if (Array.isArray(cs.preparedSpellsProgression)) {
      preparedMax = num(cs.preparedSpellsProgression[Math.min(entry.levels, 20) - 1]);
    } else {
      preparedMax = preparedFromFormula(str(cs.preparedSpells), entry.levels, mod);
    }

    // Known casters (sorcerer/bard/ranger/warlock) cap the leveled spells they
    // know via a level-indexed progression. Read it for the over-limit cue; the
    // UI only enforces it advisorily for known/pact modes.
    const knownRow = Array.isArray(cs.spellsKnownProgression)
      ? cs.spellsKnownProgression
      : Array.isArray(cs.spellsKnownProgressionFixed)
        ? cs.spellsKnownProgressionFixed
        : undefined;
    const knownFromRow =
      knownRow !== undefined && !noLeveledYet
        ? num(knownRow[Math.min(entry.levels, 20) - 1])
        : undefined;
    // The row already includes a class's own picks. One also on its list is counted
    // there, as a character from before the picks may have it.
    const onList = new Set((doc.spellcasting[refUid(entry.ref)]?.known ?? []).map(refUid));
    const knownByPick = col.effects.filter(
      (e) =>
        e.kind === 'grantSpell' &&
        e.countsAsKnown === true &&
        e.origin.uid === refUid(entry.ref) &&
        !onList.has(refUid(e.spell)),
    ).length;
    const spellsKnownMax =
      knownFromRow !== undefined ? Math.max(0, knownFromRow - knownByPick) : undefined;

    const className = str(cls.name) ?? entry.ref.name;
    // A class's or subclass's expanded list widens that class; a race's, a feat's
    // or a background's, every spellcasting class ("your spellcasting class"). So
    // does one whose origin names no class or subclass here: an optional feature
    // takes its host's type but keeps its own uid.
    const expanded = col.effects.flatMap((e) =>
      e.kind === 'spellListAdd' &&
      (!ownedByAClass(e.origin) ||
        (e.origin.type === 'class'
          ? e.origin.uid === refUid(entry.ref)
          : entry.subclass !== undefined && e.origin.uid === refUid(entry.subclass)))
        ? [{ from: e.origin.label, spells: e.spells, filters: e.filters }]
        : [],
    );
    blocks.push({
      classUid: refUid(entry.ref),
      className: sub !== undefined ? (str(sub.name) ?? className) : className,
      ...(sub !== undefined
        ? { fromSubclass: { className, shortName: str(sub.shortName) ?? str(sub.name) ?? '' } }
        : {}),
      ...(learnable !== undefined ? { learnable } : {}),
      ability: abilityKey,
      mode: classSpellcastingMode(cs),
      saveDc: dv(dcParts),
      attackMod: dv(atkParts),
      slots,
      pactSlots,
      ...(mysticArcanum !== undefined ? { mysticArcanum } : {}),
      cantripsKnown: cantrips,
      preparedMax,
      spellsKnownMax,
      ...(expanded.length > 0 ? { expanded } : {}),
    });
  }
  return blocks;
}
