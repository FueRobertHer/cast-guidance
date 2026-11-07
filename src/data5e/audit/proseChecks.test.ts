import { describe, expect, it } from 'vitest';
import type { EffectInput, EffectOrigin } from '../../engine/types';
import { type JudgmentFile, judgmentKey, setTag } from './judgments';
import { auditProse, disagreementsFor, PROSE_SET } from './proseChecks';
import type { ProseSubject } from './proseSubjects';

const origin: EffectOrigin = { label: 'x', uid: 'x', type: 'feat' };
const bonus: EffectInput = { kind: 'action', economy: 'bonus', label: 'x', origin };
const uses: EffectInput = {
  kind: 'resource',
  key: 'x',
  label: 'x',
  max: 'profBonus',
  resetOn: 'long',
  origin,
};

const subject = (key: string, effects: EffectInput[], curated = false): ProseSubject => ({
  key,
  label: `Feature ${key}`,
  name: key,
  type: 'feat',
  state: key,
  owners: 1,
  curated,
  effects,
  spendKeys: [],
  structuredLimit: false,
});

const ids = PROSE_SET.questions.map((q) => q.id);
/** Jev says "no" to everything except the given answers. */
const says = (overrides: Record<string, number>) => ids.map((id) => overrides[id] ?? 0.05);

describe('disagreementsFor', () => {
  it('flags a confident yes the scanner missed and a confident no it drew anyway', () => {
    const found = disagreementsFor(subject('a', [bonus]), {
      ...Object.fromEntries(ids.map((id) => [id, 0.05])),
      bonusAction: 0.1,
      limitedUses: 0.9,
    });
    expect(found).toEqual([
      { key: 'a', label: 'Feature a', check: 'bonusAction', kind: 'extra', p: 0.1 },
      { key: 'a', label: 'Feature a', check: 'limitedUses', kind: 'missed', p: 0.9 },
    ]);
  });

  it('leaves uncertain answers alone', () => {
    const answers = Object.fromEntries(ids.map((id) => [id, 0.5]));
    expect(disagreementsFor(subject('a', [bonus, uses]), answers)).toEqual([]);
  });

  it('compares reset and count only once the scanner found uses', () => {
    const answers = { ...Object.fromEntries(ids.map((id) => [id, 0.05])), usesProficiency: 0.95 };
    // No resource: the count question has nothing to compare against.
    expect(disagreementsFor(subject('a', []), answers)).toEqual([]);
    // A proficiency-bonus pool agrees with the yes.
    expect(disagreementsFor(subject('a', [uses]), { ...answers, limitedUses: 0.95 })).toEqual([]);
    // A fixed count contradicts it.
    const twice: EffectInput = { ...uses, max: 2 } as EffectInput;
    expect(
      disagreementsFor(subject('a', [twice]), { ...answers, limitedUses: 0.95 }).map(
        (d) => d.check,
      ),
    ).toEqual(['usesProficiency']);
  });

  it('compares a plain action only for a limited-use feature with no faster economy', () => {
    const answers = { ...Object.fromEntries(ids.map((id) => [id, 0.05])), action: 0.95 };
    expect(disagreementsFor(subject('a', []), answers).map((d) => d.check)).toEqual([]);
    expect(
      disagreementsFor(subject('a', [uses]), {
        ...answers,
        limitedUses: 0.95,
        usesProficiency: 0.95,
      }).map((d) => d.check),
    ).toEqual(['action']);
  });

  describe('with a limit the sheet tracks from structured data', () => {
    const tracked = { ...subject('a', []), structuredLimit: true };
    const allNo = Object.fromEntries(ids.map((id) => [id, 0.05]));

    it('does not count the limit as missed, and counts it without the pool', () => {
      const answers = { ...allNo, limitedUses: 0.95 };
      expect(disagreementsFor(tracked, answers)).toEqual([]);
      expect(disagreementsFor(subject('a', []), answers).map((d) => d.check)).toEqual([
        'limitedUses',
      ]);
    });

    it('keeps every other disagreement', () => {
      const sure = Object.fromEntries(ids.map((id) => [id, 0.95]));
      const missedBy = (effects: EffectInput[]) =>
        disagreementsFor({ ...subject('a', effects), structuredLimit: true }, sure).map(
          (d) => d.check,
        );
      // Between them, these two have the scanner of every other check saying no.
      const twicePerLongRest: EffectInput = {
        kind: 'resource',
        key: 'x',
        label: 'x',
        max: 2,
        resetOn: 'long',
        origin,
      };
      const plainRoll: EffectInput = {
        kind: 'action',
        economy: 'action',
        label: 'x',
        roll: '1d6',
        origin,
      };
      expect(missedBy([twicePerLongRest])).toEqual([
        'bonusAction',
        'reaction',
        'action',
        'usesProficiency',
        'shortRest',
      ]);
      expect(missedBy([plainRoll])).toEqual(['bonusAction', 'reaction', 'healing', 'forcesSave']);
    });

    it('starts no comparison that reads the scanner found uses', () => {
      const sure = Object.fromEntries(ids.map((id) => [id, 0.95]));
      expect(
        disagreementsFor(tracked, sure)
          .map((d) => d.check)
          .filter((check) => check !== 'bonusAction' && check !== 'reaction'),
      ).toEqual([]);
    });

    it('never makes the limit an extra, which is about what the scanner drew', () => {
      expect(disagreementsFor(tracked, allNo)).toEqual([]);
      // The scanner did draw this one, and the sheet's other count changes nothing.
      const drawn = { ...subject('a', [uses]), structuredLimit: true };
      const answers = { ...allNo, usesProficiency: 0.95 };
      expect(disagreementsFor(drawn, answers).map((d) => `${d.check} ${d.kind}`)).toEqual([
        'limitedUses extra',
      ]);
    });
  });
});

describe('auditProse', () => {
  const subjects = [
    subject('a', [bonus]),
    subject('b', []),
    subject('c', [], true),
    subject('d', [bonus]),
  ];
  const file: JudgmentFile = {
    sets: { [setTag(PROSE_SET)]: ids },
    judgments: {
      [judgmentKey(PROSE_SET, 'a')]: { label: 'Feature a', p: says({ bonusAction: 0.95 }) },
      [judgmentKey(PROSE_SET, 'b')]: {
        label: 'Feature b',
        p: says({ limitedUses: 0.9, reaction: 0.85 }),
      },
      [judgmentKey(PROSE_SET, 'c')]: { label: 'Feature c', p: says({ limitedUses: 0.99 }) },
    },
  };

  it('counts judged subjects and their disagreements, leaving curated ones out', () => {
    const audit = auditProse(subjects, file);
    expect(audit.subjects).toBe(3);
    expect(audit.judged).toBe(2);
    expect(audit.disagreements.map((d) => `${d.key} ${d.check} ${d.kind}`)).toEqual([
      'b limitedUses missed',
      'b reaction missed',
    ]);
    expect(audit.byCheck).toEqual({ 'limitedUses: missed': 1, 'reaction: missed': 1 });
  });

  it('reports nothing judged without a file', () => {
    expect(auditProse(subjects, undefined)).toEqual({
      subjects: 3,
      judged: 0,
      disagreements: [],
      byCheck: {},
    });
  });
});
