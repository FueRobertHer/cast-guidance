// The spell text reader: what it finds in an author's words, the fields each
// finding fills, and how typed words keep the tags the author accepted.
import { describe, expect, it } from 'vitest';
import { spellRollActions } from '@/features/sheet/spellRolls';
import { type Finding, readSpellText, retag, tagFirst, tagsIn, wordsOf } from './textReader';

type Json = Record<string, unknown>;

/** Every finding accepted in turn, each read again over the last one's result. */
function acceptAll(spell: Json): Json {
  let next = spell;
  for (let i = 0; i < 40; i++) {
    const f = readSpellText(next)[0];
    if (f === undefined) return next;
    next = { ...next, ...f.patch };
    for (const [k, v] of Object.entries(f.patch)) if (v === undefined) delete next[k];
  }
  throw new Error('the reader kept finding things');
}

const brief = (found: Finding[]) => found.map((f) => `${f.kind}: ${f.what}`);

const BOLT = {
  name: 'Bright Bolt',
  level: 1,
  entries: [
    'A flash of light streaks toward a creature of your choice within range. Make a ranged spell attack against the target. On a hit, the target takes 4d6 radiant damage.',
    'At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the damage increases by 1d6 for each slot level above 1st.',
  ],
};

describe('readSpellText', () => {
  it('finds a leveled spell attack, its damage and how it grows, and applies nothing itself', () => {
    const found = readSpellText(BOLT);
    expect(brief(found)).toEqual([
      'damage: 4d6 radiant damage',
      'attack: Ranged spell attack',
      'higher: 1d6 more for each slot level above 1st',
    ]);
    // Reading changed nothing.
    expect(BOLT.entries[0]).toContain('takes 4d6 radiant');
  });

  it('fills the fields the sheet reads, so the Spells tab rolls it and its upcast', () => {
    const spell = acceptAll(BOLT);
    expect(spell).toMatchObject({
      spellAttack: ['R'],
      damageInflict: ['radiant'],
      entries: [expect.stringContaining('takes {@damage 4d6} radiant damage')],
      entriesHigherLevel: [
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: [
            'When you cast this spell using a spell slot of 2nd level or higher, the damage increases by {@scaledamage 4d6|1-9|1d6} for each slot level above 1st.',
          ],
        },
      ],
    });
    // The higher-level paragraph moved to its field, out of the text.
    expect(spell.entries).toHaveLength(1);
    expect(readSpellText(spell)).toEqual([]);
    const at = (slotLevel: number) =>
      spellRollActions(spell, { characterLevel: 5, abilityModifier: 4, slotLevel }).map(
        (r) => r.expr,
      );
    expect(at(1)).toEqual(['4d6']);
    expect(at(3)).toEqual(['6d6']);
  });

  it('names a 2024 spell the 2024 way', () => {
    const spell = acceptAll({
      ...BOLT,
      edition: 'one',
      entries: [
        BOLT.entries[0],
        'Using a Higher-Level Spell Slot. The damage increases by 1d6 for each spell slot level above 1.',
      ],
    });
    expect(spell.entriesHigherLevel).toEqual([
      {
        type: 'entries',
        name: 'Using a Higher-Level Spell Slot',
        entries: [
          'The damage increases by {@scaledamage 4d6|1-9|1d6} for each spell slot level above 1.',
        ],
      },
    ]);
  });

  it("reads a 2014 cantrip's ladder and leaves the paragraph where the book prints it", () => {
    const ladder =
      "This spell's damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).";
    const cantrip = {
      level: 0,
      entries: [
        'Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.',
        ladder,
      ],
    };
    // The ladder's dice are steps, not rolls of their own.
    expect(brief(readSpellText(cantrip))).toEqual([
      'damage: 1d10 fire damage',
      'attack: Ranged spell attack',
      'cantrip: 1d10 more damage at levels 5, 11 and 17',
    ]);
    const spell = acceptAll(cantrip);
    expect(spell.scalingLevelDice).toEqual({
      label: 'fire damage',
      scaling: { 1: '1d10', 5: '2d10', 11: '3d10', 17: '4d10' },
    });
    expect(spell.entries).toEqual([
      'Make a ranged spell attack against the target. On a hit, the target takes {@damage 1d10} fire damage.',
      ladder,
    ]);
    expect(spell.entriesHigherLevel).toBeUndefined();
    expect(spellRollActions(spell, { characterLevel: 11 }).map((r) => r.expr)).toEqual(['3d10']);
  });

  it('reads healing with the caster modifier as a heal the sheet colours and adds to', () => {
    const spell = acceptAll({
      level: 1,
      entries: [
        'A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.',
      ],
      entriesHigherLevel: [
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: ['The healing increases by 1d8 for each slot level above 1st.'],
        },
      ],
    });
    expect(spell.miscTags).toEqual(['HL']);
    expect(spell.entriesHigherLevel).toEqual([
      {
        type: 'entries',
        name: 'At Higher Levels',
        entries: [
          'The healing increases by {@scaledice 1d8|1-9|1d8} for each slot level above 1st.',
        ],
      },
    ]);
    const [roll] = spellRollActions(spell, { characterLevel: 1, abilityModifier: 3, slotLevel: 2 });
    expect(roll).toMatchObject({ expr: '2d8+3', variant: 'heal' });
  });

  it('reads a save and the condition it puts on a failure', () => {
    const spell = acceptAll({
      level: 2,
      entries: [
        'The target must succeed on a Wisdom saving throw or be paralyzed for the duration.',
      ],
    });
    expect(spell).toMatchObject({
      savingThrow: ['wisdom'],
      conditionInflict: ['paralyzed'],
      entries: [expect.stringContaining('or be {@condition paralyzed} for')],
    });
  });

  it('finds nothing in a spell the books already tag', () => {
    expect(
      readSpellText({
        level: 1,
        entries: [
          'Make a ranged spell attack. On a hit, the target takes {@damage 4d6} radiant damage.',
        ],
        spellAttack: ['R'],
        damageInflict: ['radiant'],
      }),
    ).toEqual([]);
  });

  it('does not offer a benefit the spell gives as a save it forces', () => {
    expect(
      readSpellText({ level: 1, entries: ['You have advantage on Wisdom saving throws.'] }),
    ).toEqual([]);
  });

  it('tags each of two rolls of the same dice where its own type stands', () => {
    const flame = {
      level: 5,
      entries: ['Each creature takes 4d6 fire damage and 4d6 radiant damage.'],
    };
    const [fire, radiant] = readSpellText(flame);
    expect(fire?.what).toBe('4d6 fire damage');
    expect(fire?.patch.entries).toEqual([
      'Each creature takes {@damage 4d6} fire damage and 4d6 radiant damage.',
    ]);
    expect(radiant?.what).toBe('4d6 radiant damage');
    expect(radiant?.patch.entries).toEqual([
      'Each creature takes 4d6 fire damage and {@damage 4d6} radiant damage.',
    ]);
    expect(radiant?.patch.damageInflict).toEqual(['radiant']);
    expect(acceptAll(flame)).toMatchObject({
      entries: ['Each creature takes {@damage 4d6} fire damage and {@damage 4d6} radiant damage.'],
      damageInflict: ['fire', 'radiant'],
    });
  });

  it('reads a spell that says how it grows in the same paragraph', () => {
    const one = {
      level: 1,
      entries: [
        'A bolt deals 3d8 fire damage to the target. The damage increases by 1d8 for each slot level above 1st.',
      ],
    };
    expect(brief(readSpellText(one))).toEqual([
      'damage: 3d8 fire damage',
      'higher: 1d8 more for each slot level above 1st',
    ]);
    const spell = acceptAll(one);
    expect(spell.entries).toEqual(['A bolt deals {@damage 3d8} fire damage to the target.']);
    expect(JSON.stringify(spell.entriesHigherLevel)).toContain('{@scaledamage 3d8|1-9|1d8}');
  });
});

describe('typing over tagged text', () => {
  const tagged =
    'On a hit, the target takes {@damage 4d6} radiant damage and is {@condition prone}.';

  it('shows the tags as the words they read as', () => {
    expect(wordsOf(tagged)).toBe('On a hit, the target takes 4d6 radiant damage and is prone.');
  });

  it('keeps each tag on its words through an edit around them', () => {
    const typed = 'If it hits, the target takes 4d6 radiant damage and falls prone.';
    expect(retag(typed, tagsIn(tagged))).toBe(
      'If it hits, the target takes {@damage 4d6} radiant damage and falls {@condition prone}.',
    );
  });

  it('drops a tag whose words were deleted, and tags no new dice on its own', () => {
    const typed = 'On a hit, the target takes 2d6 radiant damage and is prone.';
    expect(retag(typed, tagsIn(tagged))).toBe(
      'On a hit, the target takes 2d6 radiant damage and is {@condition prone}.',
    );
  });

  it('tags the first untagged words, never inside a tag', () => {
    expect(tagFirst(['{@damage 1d6} and 1d6 more'], '1d6', 'damage')).toEqual([
      '{@damage 1d6} and {@damage 1d6} more',
    ]);
  });
});
