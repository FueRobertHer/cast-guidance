import type { Collector } from '../effects/base';
import { num, str } from '../effects/base';
import {
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  refUid,
  type SpellcastingBlock,
} from '../types';

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

export function calcSpellcasting(
  doc: CharacterDoc,
  col: Collector,
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): SpellcastingBlock[] {
  const blocks: SpellcastingBlock[] = [];

  // Multiclass spell slots: sum caster levels across slot-progression classes
  // and read one shared table row. Pact magic stays separate.
  let combinedCasterLevel = 0;
  for (const entry of doc.classes) {
    const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
    const progression = str(cls?.casterProgression);
    if (progression !== undefined && progression !== 'pact') {
      combinedCasterLevel += casterLevelFor(progression, entry.levels);
    }
  }
  const sharedSlots: number[] =
    combinedCasterLevel > 0
      ? [...(STANDARD_SLOTS[Math.min(combinedCasterLevel, 20) - 1] ?? [])]
      : [0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (const entry of doc.classes) {
    const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
    if (cls === undefined) continue;
    const progression = str(cls.casterProgression);
    const abilityKey = str(cls.spellcastingAbility) as Ability | undefined;
    if (progression === undefined || abilityKey === undefined) continue;

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

    // Spell slots are a character-wide pool: every caster block sees the
    // shared multiclass table; pact magic is tracked on top for warlocks.
    const slots: number[] = [...sharedSlots];
    let pactSlots: { count: number; level: number } | undefined;
    if (progression === 'pact') {
      const row = PACT_SLOTS[Math.min(entry.levels, 20) - 1];
      if (row !== undefined) pactSlots = { count: row[0], level: row[1] };
    }

    const cantrips = Array.isArray(cls.cantripProgression)
      ? num(cls.cantripProgression[Math.min(entry.levels, 20) - 1])
      : undefined;

    let preparedMax: number | undefined;
    if (Array.isArray(cls.preparedSpellsProgression)) {
      preparedMax = num(cls.preparedSpellsProgression[Math.min(entry.levels, 20) - 1]);
    } else if (str(cls.preparedSpells)?.includes('<$level$>')) {
      // 2014 formula style: "<$level$> + <$wis_mod$>" — level + ability mod
      preparedMax = Math.max(1, entry.levels + mod);
    }

    blocks.push({
      classUid: refUid(entry.ref),
      className: str(cls.name) ?? entry.ref.name,
      ability: abilityKey,
      saveDc: {
        value: dcParts.reduce((s, p) => s + p.amount, 0),
        base: dcParts.reduce((s, p) => s + p.amount, 0),
        overridden: false,
        parts: dcParts,
      },
      attackMod: {
        value: atkParts.reduce((s, p) => s + p.amount, 0),
        base: atkParts.reduce((s, p) => s + p.amount, 0),
        overridden: false,
        parts: atkParts,
      },
      slots,
      pactSlots,
      cantripsKnown: cantrips,
      preparedMax,
    });
  }
  return blocks;
}
