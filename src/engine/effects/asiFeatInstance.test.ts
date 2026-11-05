import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type CharacterDoc, type DataEntity, newCharacterDoc } from '../types';
import { asiFeatInstance } from './asiFeatInstance';

// Invented wording throughout. Elemental Adept's name sits in the feat tables, so
// it is real; its text is not any book's.
const adept: DataEntity = {
  name: 'Elemental Adept',
  source: 'PHB',
  entries: ['Pick a favorite among the old powers.'],
};
const drilled: DataEntity = {
  name: 'Drilled',
  source: 'HB',
  repeatable: true,
  skillProficiencies: [{ any: 1 }],
  entries: ['Drill until one more skill sticks.'],
};
const steady: DataEntity = {
  name: 'Steady',
  source: 'HB',
  skillProficiencies: [{ any: 1 }],
  entries: ['Stay steady at one more skill.'],
};

const base = makeTestContext();
const warrior = base.get('class', 'Warrior', 'TST') as DataEntity;
const sage: DataEntity = {
  ...warrior,
  name: 'Sage',
  classFeatures: ['Ability Score Improvement|Sage|TST|4'],
};
const asi = base
  .byType('classFeature')
  .find((f) => f.name === 'Ability Score Improvement') as DataEntity;
const extra: Record<string, DataEntity[]> = {
  class: [sage],
  classFeature: [{ ...asi, className: 'Sage' }],
  feat: [adept, drilled, steady],
};
const ctx = {
  get(type: string, name: string, source?: string) {
    const found = (extra[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    );
    return found ?? base.get(type as never, name, source);
  },
  byType: (type: string) => [...base.byType(type as never), ...(extra[type] ?? [])],
} as typeof base;

const WARRIOR = 'warrior|tst';
const SAGE = 'sage|tst';
const DRILLED = 'drilled|hb';
const ADEPT = 'elemental adept|phb';

/** Warrior 4 then Sage 4, with the feat taken at each one's level 4 ASI. */
function bothTake(feat: string, choices: CharacterDoc['choices'] = {}): CharacterDoc {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] },
    { ref: { name: 'Sage', source: 'TST' }, levels: 4, hp: [] },
  ];
  doc.choices = {
    [`class:${WARRIOR}:asi:4`]: 'feat',
    [`class:${WARRIOR}:asi:4:feat`]: feat,
    [`class:${SAGE}:asi:4`]: 'feat',
    [`class:${SAGE}:asi:4:feat`]: feat,
    ...choices,
  };
  return doc;
}

const featPending = (doc: CharacterDoc) =>
  deriveSheet(doc, ctx)
    .pending.map((p) => p.id)
    .filter((id) => id.startsWith('feat:'));

const proficient = (doc: CharacterDoc, skill: 'Stealth' | 'Arcana') =>
  (deriveSheet(doc, ctx).skills[skill]?.prof ?? 0) > 0;

describe('one repeatable feat taken at one level by two classes', () => {
  const first = `feat:${DRILLED}:asi4:skill:0`;
  const second = `feat:${DRILLED}:asi4@${SAGE}:skill:0`;

  it('asks each copy for its own pick, under its own id', () => {
    expect(featPending(bothTake(DRILLED))).toEqual([first, second]);
  });

  it('does the same for a feat the prose alone makes repeatable', () => {
    expect(featPending(bothTake(ADEPT))).toEqual([
      `feat:${ADEPT}:asi4:damageType`,
      `feat:${ADEPT}:asi4@${SAGE}:damageType`,
    ]);
  });

  it('applies a pick saved under the shared key to the first copy alone', () => {
    const doc = bothTake(DRILLED, { [first]: ['stealth'] });
    expect(featPending(doc)).toEqual([second]);
    expect(proficient(doc, 'Stealth')).toBe(true);
  });

  it('applies each copy its own pick', () => {
    const doc = bothTake(DRILLED, { [first]: ['stealth'], [second]: ['arcana'] });
    expect(featPending(doc)).toEqual([]);
    expect(proficient(doc, 'Stealth')).toBe(true);
    expect(proficient(doc, 'Arcana')).toBe(true);
  });

  it('closes a damage type the other copy holds, whichever answered', () => {
    const firstType = `feat:${ADEPT}:asi4:damageType`;
    const secondType = `feat:${ADEPT}:asi4@${SAGE}:damageType`;
    const held = (saved: string, open: string) => {
      const sheet = deriveSheet(bothTake(ADEPT, { [saved]: ['fire'] }), ctx);
      return sheet.pending
        .find((p) => p.id === open)
        ?.options.filter((o) => o.disabled !== undefined)
        .map((o) => o.id);
    };
    expect(held(firstType, secondType)).toEqual(['fire']);
    expect(held(secondType, firstType)).toEqual(['fire']);
  });

  it('keeps a later copy on its own key once it comes first', () => {
    // The first class changes feat. Its old picks stay behind under the shared
    // key, and must not replace the pick the other copy made.
    const doc = bothTake(DRILLED, { [first]: ['stealth'], [second]: ['arcana'] });
    doc.choices[`class:${WARRIOR}:asi:4:feat`] = 'steady|hb';
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.resolvedChoices.map((r) => r.prompt.id)).toContain(second);
    expect(sheet.resolvedChoices.map((r) => r.prompt.id)).not.toContain(first);
    expect(proficient(doc, 'Stealth')).toBe(false);
    expect(proficient(doc, 'Arcana')).toBe(true);
  });

  it('leaves the shared key with a class levelled down past the ASI', () => {
    // Its copy sleeps with its pick saved, and the other class does not inherit it.
    const doc = bothTake(DRILLED, { [first]: ['stealth'] });
    const [warriorEntry] = doc.classes;
    if (warriorEntry !== undefined) warriorEntry.levels = 3;
    expect(featPending(doc)).toEqual([second]);
    expect(proficient(doc, 'Stealth')).toBe(false);
    if (warriorEntry !== undefined) warriorEntry.levels = 4;
    expect(featPending(doc)).toEqual([second]);
    expect(proficient(doc, 'Stealth')).toBe(true);
  });

  it('does not count the same feat at another level as a copy ahead of it', () => {
    const doc = bothTake(DRILLED);
    delete doc.choices[`class:${WARRIOR}:asi:4:feat`];
    doc.choices[`class:${WARRIOR}:asi:8:feat`] = DRILLED;
    expect(asiFeatInstance(doc, SAGE, 4, DRILLED)).toBe('asi4');
  });
});

describe('a single copy', () => {
  it('stays under the plain key', () => {
    const doc = bothTake(DRILLED);
    doc.classes.pop();
    delete doc.choices[`class:${SAGE}:asi:4`];
    delete doc.choices[`class:${SAGE}:asi:4:feat`];
    expect(featPending(doc)).toEqual([`feat:${DRILLED}:asi4:skill:0`]);
  });

  it('ignores a feat that cannot repeat the second time, with one prompt', () => {
    const doc = bothTake('steady|hb');
    expect(featPending(doc)).toEqual(['feat:steady|hb:asi4:skill:0']);
    expect(deriveSheet(doc, ctx).warnings.join()).toContain('not a repeatable feat');
  });
});
