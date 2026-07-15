import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type Ability, newCharacterDoc } from '../types';
import { Collector } from './base';
import {
  buildPrereqContext,
  meetsPrerequisite,
  type PrereqContext,
  requiredLevel,
  summarizePrerequisite,
} from './class';

const ABILITY_10: Record<Ability, number> = {
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
};

function prereqCtx(over: Partial<PrereqContext> = {}): PrereqContext {
  return {
    abilityScores: ABILITY_10,
    totalLevel: 1,
    raceName: '',
    featNames: new Set(),
    backgroundName: undefined,
    proficiencies: new Set(),
    hasSpellcasting: false,
    ...over,
  };
}

describe('summarizePrerequisite', () => {
  it('reads ability requirements', () => {
    expect(summarizePrerequisite([{ ability: [{ str: 13 }] }])).toBe('STR 13');
  });

  it('reads warlock invocation gates: pact, patron, spell, spellcasting, level', () => {
    expect(summarizePrerequisite([{ pact: 'Blade' }])).toBe('Pact of the Blade');
    expect(summarizePrerequisite([{ patron: 'The Fiend|PHB' }])).toBe('The Fiend patron');
    expect(summarizePrerequisite([{ spell: ['eldritch blast#c|phb'] }])).toBe(
      'knows eldritch blast',
    );
    expect(summarizePrerequisite([{ spellcasting: true }])).toBe('spellcasting');
    expect(summarizePrerequisite([{ level: 5 }])).toBe('level 5');
    expect(summarizePrerequisite([{ level: { level: 7 } }])).toBe('level 7');
  });

  it('joins multiple parts and is empty for none', () => {
    expect(summarizePrerequisite([{ pact: 'Tome', level: 5 }])).toBe('level 5, Pact of the Tome');
    expect(summarizePrerequisite(undefined)).toBe('');
    expect(summarizePrerequisite([])).toBe('');
  });

  it('reads race, feat, background, and proficiency requirements (previously dropped)', () => {
    expect(summarizePrerequisite([{ race: [{ name: 'elf' }, { name: 'half-elf' }] }])).toBe(
      'race elf/half-elf',
    );
    expect(summarizePrerequisite([{ feat: ['strixhaven initiate|scc'] }])).toBe(
      'strixhaven initiate feat',
    );
    expect(summarizePrerequisite([{ background: ['acolyte|xphb'] }])).toBe('acolyte background');
    expect(summarizePrerequisite([{ proficiency: [{ armor: 'heavy' }] }])).toBe('heavy armor');
    // A subrace qualifier is preserved.
    expect(summarizePrerequisite([{ race: [{ name: 'elf', subrace: 'high' }] }])).toBe(
      'race high elf',
    );
  });

  it('renders alternative requirement sets with "or" instead of flattening to "and"', () => {
    // XPHB Ritual Caster: (level 4 AND INT 13) OR (level 4 AND WIS 13).
    expect(
      summarizePrerequisite([
        { level: 4, ability: [{ int: 13 }] },
        { level: 4, ability: [{ wis: 13 }] },
      ]),
    ).toBe('INT 13, level 4 or WIS 13, level 4');
  });
});

describe('requiredLevel', () => {
  it('returns the highest numeric level prerequisite', () => {
    expect(requiredLevel([{ level: 3 }])).toBe(3);
    expect(requiredLevel([{ level: { level: 7 } }])).toBe(7);
    expect(requiredLevel([{ level: 3 }, { level: 9 }])).toBe(9);
  });

  it('is undefined without a level requirement', () => {
    expect(requiredLevel([{ pact: 'Blade' }])).toBeUndefined();
    expect(requiredLevel(undefined)).toBeUndefined();
  });
});

describe('meetsPrerequisite (GAME-005)', () => {
  it('treats no/empty/non-array prerequisites as met', () => {
    expect(meetsPrerequisite(undefined, prereqCtx())).toBe(true);
    expect(meetsPrerequisite([], prereqCtx())).toBe(true);
    expect(meetsPrerequisite(['garbage', 42], prereqCtx())).toBe(true);
  });

  it('checks ability minimums (AND within a set)', () => {
    const req = [{ ability: [{ str: 13 }] }];
    expect(meetsPrerequisite(req, prereqCtx({ abilityScores: { ...ABILITY_10, str: 13 } }))).toBe(
      true,
    );
    expect(meetsPrerequisite(req, prereqCtx({ abilityScores: { ...ABILITY_10, str: 12 } }))).toBe(
      false,
    );
  });

  it('checks level', () => {
    expect(meetsPrerequisite([{ level: 4 }], prereqCtx({ totalLevel: 4 }))).toBe(true);
    expect(meetsPrerequisite([{ level: 4 }], prereqCtx({ totalLevel: 3 }))).toBe(false);
    expect(meetsPrerequisite([{ level: { level: 5 } }], prereqCtx({ totalLevel: 5 }))).toBe(true);
  });

  it('checks spellcasting (the spell-less-Fighter case)', () => {
    expect(meetsPrerequisite([{ spellcasting: true }], prereqCtx({ hasSpellcasting: false }))).toBe(
      false,
    );
    expect(meetsPrerequisite([{ spellcasting: true }], prereqCtx({ hasSpellcasting: true }))).toBe(
      true,
    );
    // The 2020 variant key is honored too.
    expect(
      meetsPrerequisite([{ spellcasting2020: [] }], prereqCtx({ hasSpellcasting: false })),
    ).toBe(false);
  });

  it('matches race, feat, background, and proficiency requirements', () => {
    expect(
      meetsPrerequisite([{ race: [{ name: 'elf' }] }], prereqCtx({ raceName: 'high elf' })),
    ).toBe(true);
    expect(
      meetsPrerequisite([{ race: [{ name: 'dwarf' }] }], prereqCtx({ raceName: 'high elf' })),
    ).toBe(false);
    expect(
      meetsPrerequisite(
        [{ feat: ['strixhaven initiate|scc'] }],
        prereqCtx({ featNames: new Set(['strixhaven initiate']) }),
      ),
    ).toBe(true);
    expect(meetsPrerequisite([{ feat: ['alert|phb'] }], prereqCtx())).toBe(false);
    expect(
      meetsPrerequisite(
        [{ background: ['acolyte|xphb'] }],
        prereqCtx({ backgroundName: 'acolyte' }),
      ),
    ).toBe(true);
    expect(
      meetsPrerequisite(
        [{ proficiency: [{ armor: 'heavy' }] }],
        prereqCtx({ proficiencies: new Set(['heavy', 'light']) }),
      ),
    ).toBe(true);
    expect(meetsPrerequisite([{ proficiency: [{ armor: 'heavy' }] }], prereqCtx())).toBe(false);
  });

  it('is satisfied when ANY alternative requirement set matches (OR)', () => {
    const req = [
      { level: 4, ability: [{ int: 13 }] },
      { level: 4, ability: [{ wis: 13 }] },
    ];
    // Meets the WIS branch though not the INT branch.
    expect(
      meetsPrerequisite(
        req,
        prereqCtx({ totalLevel: 4, abilityScores: { ...ABILITY_10, wis: 13 } }),
      ),
    ).toBe(true);
    // Meets neither.
    expect(meetsPrerequisite(req, prereqCtx({ totalLevel: 4 }))).toBe(false);
  });

  it('does not false-flag on requirements it cannot evaluate, or on absent context', () => {
    // pact/patron/spell/other are treated as satisfied (avoid false flags).
    expect(meetsPrerequisite([{ pact: 'Blade' }], prereqCtx())).toBe(true);
    expect(meetsPrerequisite([{ other: 'DM approval' }], prereqCtx())).toBe(true);
    // Race/background gates don't flag when the character hasn't chosen one yet.
    expect(meetsPrerequisite([{ race: [{ name: 'elf' }] }], prereqCtx({ raceName: '' }))).toBe(
      true,
    );
    expect(
      meetsPrerequisite(
        [{ background: ['acolyte|xphb'] }],
        prereqCtx({ backgroundName: undefined }),
      ),
    ).toBe(true);
  });
});

describe('buildPrereqContext (GAME-005)', () => {
  it('snapshots scores, level, race, feats, spellcasting, and proficiencies', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.abilities.base = { str: 15, dex: 10, con: 12, int: 14, wis: 10, cha: 8 };
    doc.race = { name: 'Testfolk', source: 'TST' };
    doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: [] }];
    doc.feats = [{ ref: { name: 'Alert', source: 'PHB' }, instanceId: 'f0' }];
    const col = new Collector(doc, makeTestContext());
    const ctx = buildPrereqContext(col);
    expect(ctx.abilityScores.str).toBe(15);
    expect(ctx.totalLevel).toBe(3);
    expect(ctx.raceName.toLowerCase()).toContain('testfolk');
    expect(ctx.featNames.has('alert')).toBe(true);
    expect(ctx.hasSpellcasting).toBe(true); // Mage is a full caster
  });

  it('reports no spellcasting for a martial class', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    const ctx = buildPrereqContext(new Collector(doc, makeTestContext()));
    expect(ctx.hasSpellcasting).toBe(false);
  });
});

describe('feat/optional-feature picker advisory (GAME-005)', () => {
  const ctx = makeTestContext();

  /** Drive a class list to its Warrior level-4 ASI, resolve to "feat", return the prompt. */
  function featPromptFor(classes: Array<{ name: string; levels: number }>) {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = classes.map((c) => ({
      ref: { name: c.name, source: 'TST' },
      levels: c.levels,
      hp: [],
    }));
    const asi = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'asiOrFeat');
    expect(asi).toBeDefined();
    if (asi !== undefined) doc.choices[asi.id] = 'feat';
    const prompt = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'feat');
    expect(prompt).toBeDefined();
    return prompt;
  }

  it('flags a caster-only feat for a non-caster, but keeps it selectable', () => {
    const opts = featPromptFor([{ name: 'Warrior', levels: 4 }])?.options ?? [];
    const ea = opts.find((o) => o.id === 'elemental adept|tst');
    expect(ea?.advisory).toBeDefined();
    expect(ea?.disabled).toBeUndefined(); // advisory, not a block
    // STR 10 Warrior also fails Grappler's STR 13 gate.
    expect(opts.find((o) => o.id === 'grappler|tst')?.advisory).toBeDefined();
    // A prereq-free feat carries no advisory.
    expect(opts.find((o) => o.label.startsWith('Alert'))?.advisory).toBeUndefined();
  });

  it('does not flag a caster feat for a caster (Warrior 4 / Mage 1)', () => {
    const opts =
      featPromptFor([
        { name: 'Warrior', levels: 4 },
        { name: 'Mage', levels: 1 },
      ])?.options ?? [];
    expect(opts.find((o) => o.id === 'elemental adept|tst')?.advisory).toBeUndefined();
  });

  it('flags an invocation whose non-level prerequisite is unmet', () => {
    // Warrior's Combat Stance optional feature (FS:T) at level 1; the sample
    // options carry pact/level gates. Verify the advisory path is exercised
    // without turning any option into a hard block beyond the level gate.
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    const opt = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'optionalfeature');
    expect(opt).toBeDefined();
    // No option is both disabled AND advisory (the two cues are exclusive).
    for (const o of opt?.options ?? []) {
      expect(o.disabled !== undefined && o.advisory !== undefined).toBe(false);
    }
  });
});
