import { describe, expect, it } from 'vitest';
import {
  type ChoicePrompt,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import {
  ARTISANS_TOOLS,
  GAMING_SETS,
  isLanguageOrToolMix,
  MUSICAL_INSTRUMENTS,
  readLanguageOrToolMix,
  readProficiencyList,
  toolOptions,
  weaponOptions,
} from './readers';

const ctx: EngineContext = {
  get: () => undefined,
  byType: () => [],
};
const origin: EffectOrigin = { label: 'Test origin', uid: 'test|tst', type: 'race' };

function toolCollector(raw: unknown): Collector {
  const col = new Collector(newCharacterDoc('id', 'Test', 'test-tag'), ctx);
  readProficiencyList(
    col,
    raw,
    origin,
    'race:test|tst:tool',
    'tool',
    'Tool proficiency',
    (name) => col.add({ kind: 'toolProf', name, origin }),
    toolOptions,
  );
  return col;
}

describe('tool proficiency choices', () => {
  it('offers a full tool list for generic any choices such as Autognome', () => {
    const col = toolCollector([{ any: 2 }]);
    expect(col.pending).toHaveLength(1);
    expect(col.pending[0]?.count).toBe(2);
    expect(col.pending[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "smith's tools" }),
        expect.objectContaining({ id: 'lute' }),
        expect.objectContaining({ id: 'dice set' }),
        expect.objectContaining({ id: "thieves' tools" }),
      ]),
    );
  });

  it('expands artisan, instrument, and gaming-set category keys', () => {
    expect(toolCollector([{ anyArtisansTool: 2 }]).pending[0]?.options).toHaveLength(
      ARTISANS_TOOLS.length,
    );
    expect(toolCollector([{ anyMusicalInstrument: 1 }]).pending[0]?.options).toHaveLength(
      MUSICAL_INSTRUMENTS.length,
    );
    expect(toolCollector([{ anyGamingSet: 1 }]).pending[0]?.options).toHaveLength(
      GAMING_SETS.length,
    );
  });

  it('expands category tokens nested in explicit choices', () => {
    const col = toolCollector([{ choose: { from: ['anyArtisansTool', 'musical instrument'] } }]);
    expect(col.pending[0]?.options).toHaveLength(
      ARTISANS_TOOLS.length + MUSICAL_INSTRUMENTS.length,
    );
  });

  it('turns a generic fixed category into a concrete choice', () => {
    const col = toolCollector([{ 'gaming set': true }]);
    expect(col.pending[0]?.options).toHaveLength(GAMING_SETS.length);
    expect(col.effects).toHaveLength(0);
  });
});

describe('stored choice validation', () => {
  function collect(prompt: ChoicePrompt, stored: string[] | string) {
    const doc = newCharacterDoc('id', 'Test', 'test-tag');
    doc.choices[prompt.id] = stored;
    const col = new Collector(doc, ctx);
    let applied: string[] = [];
    col.choice(prompt, (selected) => {
      applied = selected;
    });
    return { col, applied };
  }

  const prompt: ChoicePrompt = {
    id: 'choice',
    origin,
    kind: 'tool',
    label: 'Tool proficiency',
    count: 2,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: { reason: 'already granted' } },
      { id: 'c', label: 'C' },
    ],
  };

  it('does not apply unknown, duplicate, or excess stored values', () => {
    const unknown = collect(prompt, ['a', 'missing']);
    expect(unknown.applied).toEqual(['a']);
    expect(unknown.col.pending).toHaveLength(1);
    expect(unknown.col.warnings.join(' ')).toContain('no longer available');

    const duplicate = collect(prompt, ['a', 'a']);
    expect(duplicate.applied).toEqual(['a']);
    expect(duplicate.col.pending).toHaveLength(1);
    expect(duplicate.col.warnings.join(' ')).toContain('more than once');

    const excess = collect(prompt, ['a', 'c', 'b']);
    expect(excess.applied).toEqual(['a', 'c']);
    expect(excess.col.pending).toHaveLength(1);
    expect(excess.col.warnings.join(' ')).toContain('extra choices were ignored');
  });

  it('keeps disabled overrides but labels them unusual', () => {
    const result = collect(prompt, ['a', 'b']);
    expect(result.applied).toEqual(['a', 'b']);
    expect(result.col.resolved).toHaveLength(1);
    expect(result.col.warnings.join(' ')).toContain('unusual');
  });

  it('allows repeats only when the prompt explicitly opts in', () => {
    const result = collect({ ...prompt, allowRepeat: true }, ['a', 'a']);
    expect(result.applied).toEqual(['a', 'a']);
    expect(result.col.resolved).toHaveLength(1);
  });
});

// Hobgoblin (VGM, ERLW) and Weapon Master (PHB) name their weapons with a
// `fromFilter` instead of a `from` list, and the pick used to have no options.
describe('weapon proficiency choices', () => {
  const weapons: DataEntity[] = [
    {
      name: 'Longsword',
      source: 'PHB',
      type: 'M',
      weaponCategory: 'martial',
      dmg1: '1d8',
      dmgType: 'S',
    },
    {
      name: 'Longsword',
      source: 'XPHB',
      type: 'M|XPHB',
      weaponCategory: 'martial',
      dmg1: '1d8',
      dmgType: 'S',
    },
    {
      name: 'Longbow',
      source: 'PHB',
      type: 'R',
      weaponCategory: 'martial',
      dmg1: '1d8',
      dmgType: 'P',
    },
    {
      name: 'Dagger',
      source: 'PHB',
      type: 'M',
      weaponCategory: 'simple',
      dmg1: '1d4',
      dmgType: 'P',
    },
    { name: 'Laser Rifle', source: 'DMG', type: 'R', weaponCategory: 'martial', age: 'futuristic' },
    { name: 'Chain Mail', source: 'PHB', type: 'HA' },
  ];
  const weaponCtx: EngineContext = {
    get: () => undefined,
    byType: (type) => (type === 'baseitem' ? weapons : []),
  };

  function weaponCollector(raw: unknown): Collector {
    const col = new Collector(newCharacterDoc('id', 'Test', 'test-tag'), weaponCtx);
    readProficiencyList(
      col,
      raw,
      origin,
      'race:test|tst:weapon',
      'generic',
      'Weapon proficiency',
      (name) => col.add({ kind: 'weaponProf', name, origin }),
      weaponOptions(weaponCtx),
    );
    return col;
  }

  it('offers the base weapons a filter names, each once, without optional firearms', () => {
    const col = weaponCollector([
      { choose: { fromFilter: 'type=martial weapon|miscellaneous=mundane', count: 2 } },
    ]);
    expect(col.pending).toHaveLength(1);
    expect(col.pending[0]?.count).toBe(2);
    expect(col.pending[0]?.options).toEqual([
      { id: 'Longbow', label: 'Longbow', description: 'Martial ranged · 1d8 piercing' },
      { id: 'Longsword', label: 'Longsword', description: 'Martial melee · 1d8 slashing' },
    ]);
  });

  it('reads a type it does not know, but that names a weapon, as any weapon', () => {
    const col = weaponCollector([
      { choose: { fromFilter: 'type=martial weapon;mundane weapon|miscellaneous=mundane' } },
    ]);
    expect(col.pending[0]?.options.map((o) => o.id)).toEqual(['Dagger', 'Longbow', 'Longsword']);
  });

  it('grants what is picked, and still offers a plain from list as given', () => {
    const col = new Collector(
      {
        ...newCharacterDoc('id', 'Test', 'test-tag'),
        choices: { 'race:test|tst:weapon:0': ['Longsword'] },
      },
      weaponCtx,
    );
    readProficiencyList(
      col,
      [{ choose: { fromFilter: 'type=martial weapon' } }],
      origin,
      'race:test|tst:weapon',
      'generic',
      'Weapon proficiency',
      (name) => col.add({ kind: 'weaponProf', name, origin }),
      weaponOptions(weaponCtx),
    );
    expect(col.effects).toContainEqual({ kind: 'weaponProf', name: 'Longsword', origin });
    expect(
      weaponCollector([{ choose: { from: ['whip', 'net'] } }]).pending[0]?.options.map((o) => o.id),
    ).toEqual(['whip', 'net']);
  });

  it('grants a fixed weapon by its name, without the source its key carries', () => {
    expect(weaponCollector([{ 'hand crossbow|phb': true }]).effects).toEqual([
      { kind: 'weaponProf', name: 'Hand Crossbow', origin },
    ]);
  });
});

describe('languages and tools in any mix', () => {
  const mix = (raw: unknown) => {
    const col = new Collector(newCharacterDoc('id', 'Test', 'test-tag'), ctx);
    const read = readLanguageOrToolMix(col, raw, origin, 'background:test|tst:lang:0');
    const p = col.pending[0];
    const ids = p?.options.map((o) => o.id) ?? [];
    return { read, kind: p?.kind, label: p?.label, count: p?.count, ids };
  };

  it('reads alternatives of language and tool counts alone', () => {
    expect(isLanguageOrToolMix([{ anyLanguage: 2 }, { anyLanguage: 1, anyTool: 1 }])).toBe(true);
    expect(isLanguageOrToolMix([])).toBe(false);
    expect(isLanguageOrToolMix(undefined)).toBe(false);
    expect(isLanguageOrToolMix([{}])).toBe(false);
    expect(isLanguageOrToolMix([{ anyLanguage: 1, anySkill: 1 }])).toBe(false);
    expect(isLanguageOrToolMix([{ anyLanguage: true }])).toBe(false);
    expect(isLanguageOrToolMix([{ choose: [{ from: ['anySkill', 'anyTool'] }] }])).toBe(false);
    expect(mix([{ choose: [{ from: ['anySkill', 'anyTool'] }] }]).read).toBe(false);
  });

  it('offers only the kinds the alternatives name, as many as the largest', () => {
    const languages = mix([{ anyLanguage: 1 }, { anyLanguage: 2 }]);
    expect([languages.read, languages.kind, languages.label, languages.count]).toEqual([
      true,
      'language',
      'Language',
      2,
    ]);
    expect(languages.ids).toContain('Elvish');
    expect(languages.ids).not.toContain("thieves' tools");
    const tools = mix([{ anyTool: 1 }]);
    expect([tools.kind, tools.label, tools.count]).toEqual(['tool', 'Tool proficiency', 1]);
    expect(tools.ids).toContain("thieves' tools");
    expect(tools.ids).not.toContain('Elvish');
  });
});
