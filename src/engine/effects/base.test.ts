import { describe, expect, it } from 'vitest';
import { type ChoicePrompt, type EngineContext, newCharacterDoc } from '../types';
import { asEntityArray, Collector, num, str } from './base';

const ctx: EngineContext = { get: () => undefined, byType: () => [] };

function prompt(over: Partial<ChoicePrompt> = {}): ChoicePrompt {
  return {
    id: 'p1',
    origin: { label: 'Rogue', uid: 'class|rogue', type: 'class' },
    kind: 'skill',
    label: 'Skill',
    count: 1,
    options: [
      { id: 'stealth', label: 'Stealth' },
      { id: 'perception', label: 'Perception' },
      { id: 'arcana', label: 'Arcana', disabled: { reason: 'not on the class list' } },
    ],
    ...over,
  };
}

/** Run a prompt against a Collector seeded with `choices`; capture the apply arg. */
function run(choices: Record<string, unknown>, p: ChoicePrompt) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.choices = choices as typeof doc.choices;
  const col = new Collector(doc, ctx);
  let applied: string[] | undefined;
  col.choice(p, (sel) => {
    applied = sel;
  });
  return { applied, col };
}

describe('str / num / asEntityArray', () => {
  it('narrow by type', () => {
    expect(str('x')).toBe('x');
    expect(str(3)).toBeUndefined();
    expect(num(3)).toBe(3);
    expect(num('3')).toBeUndefined();
    expect(asEntityArray([{ a: 1 }, 'skip', null, 2])).toEqual([{ a: 1 }]);
    expect(asEntityArray('nope')).toEqual([]);
  });
});

describe('Collector.choice', () => {
  it('surfaces an unmade choice as pending', () => {
    const { applied, col } = run({}, prompt());
    expect(applied).toBeUndefined();
    expect(col.pending).toHaveLength(1);
    expect(col.resolved).toHaveLength(0);
  });

  it('resolves a valid pick', () => {
    const { applied, col } = run({ p1: 'stealth' }, prompt());
    expect(applied).toEqual(['stealth']);
    expect(col.resolved).toHaveLength(1);
    expect(col.pending).toHaveLength(0);
    expect(col.warnings).toHaveLength(0);
  });

  it('drops an unknown saved id, warns, and stays pending', () => {
    const { applied, col } = run({ p1: 'ghost-skill' }, prompt());
    expect(applied).toEqual([]);
    expect(col.pending).toHaveLength(1);
    expect(col.warnings[0]).toMatch(/no longer available/);
  });

  it('keeps a disabled option (override) but warns', () => {
    const { applied, col } = run({ p1: 'arcana' }, prompt());
    expect(applied).toEqual(['arcana']);
    expect(col.resolved).toHaveLength(1);
    expect(col.warnings[0]).toMatch(/unusual/);
  });

  it('de-dupes repeated picks unless allowRepeat', () => {
    const p = prompt({ count: 2 });
    const { applied, col } = run({ p1: ['stealth', 'stealth', 'perception'] }, p);
    expect(applied).toEqual(['stealth', 'perception']);
    expect(col.warnings.some((w) => /more than once/.test(w))).toBe(true);
  });

  it('ignores picks beyond count, with a warning', () => {
    const { applied, col } = run({ p1: ['stealth', 'perception'] }, prompt({ count: 1 }));
    expect(applied).toEqual(['stealth']);
    expect(col.warnings.some((w) => /more than 1 saved pick/.test(w))).toBe(true);
  });

  it('applies a partial multi-pick but keeps it pending', () => {
    const p = prompt({ count: 2 });
    const { applied, col } = run({ p1: ['stealth'] }, p);
    expect(applied).toEqual(['stealth']);
    expect(col.pending).toHaveLength(1); // still waiting on the 2nd pick
  });
});

describe('Collector.proficientSkills', () => {
  it('lists skills granted at proficiency ≥ 1', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), ctx);
    const origin = { label: 'x', uid: 'x', type: 'class' as const };
    col.add({ origin, kind: 'skillProf', skill: 'Stealth', level: 1 });
    col.add({ origin, kind: 'skillProf', skill: 'Arcana', level: 0 });
    expect(col.proficientSkills()).toEqual(['Stealth']);
  });
});
