import { describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { ALLOW_ALL, type SourcePolicy } from '@/data5e/sourceFilter';
import type { ChoicePrompt, EffectOrigin } from '@/engine/types';
import { fillSpellPrompt, type SpellPool } from './spellPrompt';

const origin: EffectOrigin = { label: 'Test Feat', uid: 'feat|test feat|hb', type: 'feat' };

const registry = new EntityRegistry();
registry.addAll('spell', [
  { name: 'Fake Spark', source: 'PHB', level: 0, school: 'V', reprintedAs: ['Fake Spark|XPHB'] },
  { name: 'Fake Spark', source: 'XPHB', level: 0, school: 'V' },
  { name: 'Fake Ward', source: 'HB', level: 1, school: 'A' },
  { name: 'Fake Charm', source: 'HB', level: 1, school: 'E' },
  { name: 'Fake Alarm', source: 'HB', level: 1, school: 'E', meta: { ritual: true } },
  { name: 'Fake Vision', source: 'BOOK', level: 2, school: 'D' },
  { name: 'Fake Vision', source: 'HB', level: 2, school: 'D' },
]);

const lists: Record<string, string[]> = {
  testclass: ['fake spark|phb', 'fake spark|xphb', 'fake ward|hb'],
};

const pool = (over: Partial<SpellPool> = {}): SpellPool => ({
  registry,
  onClassList: (className, uid) => lists[className.toLowerCase()]?.includes(uid) ?? false,
  version: '2024',
  policy: ALLOW_ALL,
  scope: 'device',
  granted: new Set(),
  ...over,
});

const promptFor = (over: Partial<ChoicePrompt['spellQuery']>): ChoicePrompt => ({
  id: 'p1',
  origin,
  kind: 'spell',
  label: 'Test Feat: Spell',
  count: 1,
  options: [],
  spellQuery: { levels: [], classes: [], schools: [], ritual: false, attacks: [], ...over },
});

const ids = (prompt: ChoicePrompt) => prompt.options.map((o) => o.id);

describe('fillSpellPrompt', () => {
  it('lists the spells that fit the query, lowest level first', () => {
    const filled = fillSpellPrompt(promptFor({ schools: ['E', 'A'] }), pool(), undefined);
    expect(ids(filled)).toEqual(['Fake Alarm|HB', 'Fake Charm|HB', 'Fake Ward|HB']);
  });

  it('draws on the class lists, any of those named', () => {
    const filled = fillSpellPrompt(
      promptFor({ levels: [1], classes: ['Nobody', 'Testclass'] }),
      pool(),
      undefined,
    );
    expect(ids(filled)).toEqual(['Fake Ward|HB']);
  });

  it('takes each edition its own printing', () => {
    const query = promptFor({ levels: [0] });
    expect(ids(fillSpellPrompt(query, pool({ version: '2024' }), undefined))).toEqual([
      'Fake Spark|XPHB',
    ]);
    expect(ids(fillSpellPrompt(query, pool({ version: '2014' }), undefined))).toEqual([
      'Fake Spark|PHB',
    ]);
  });

  it('keeps a saved pick of the other printing, so it does not vanish', () => {
    const filled = fillSpellPrompt(promptFor({ levels: [0] }), pool(), ['fake spark|phb']);
    expect(ids(filled)).toEqual(['Fake Spark|PHB', 'Fake Spark|XPHB']);
    // Two printings on one list read the same but for their book.
    expect(filled.options.map((o) => o.label)).toEqual(['Fake Spark (PHB)', 'Fake Spark (XPHB)']);
  });

  it('lets a saved pick move to its other printing, though the origin now gives that name', () => {
    const filled = fillSpellPrompt(
      promptFor({ levels: [0] }),
      pool({ granted: new Set(['fake spark']) }),
      ['Fake Spark|PHB'],
    );
    expect(filled.options.map((o) => o.disabled)).toEqual([undefined, undefined]);
  });

  const onlyHb: SourcePolicy = { mode: 'only', sources: ['HB'] };

  it('narrows to the sources in force', () => {
    const filled = fillSpellPrompt(promptFor({ levels: [2] }), pool({ policy: onlyHb }), undefined);
    expect(ids(filled)).toEqual(['Fake Vision|HB']);
  });

  it('does not leave a dead end when the sources in force have nothing', () => {
    const hbless: SourcePolicy = { mode: 'only', sources: ['NOTHING'] };
    const filled = fillSpellPrompt(promptFor({ levels: [2] }), pool({ policy: hbless }), undefined);
    expect(ids(filled)).toEqual(['Fake Vision|BOOK', 'Fake Vision|HB']);
  });

  it('does not let a saved pick close that dead end around itself', () => {
    const hbless: SourcePolicy = { mode: 'only', sources: ['NOTHING'] };
    const filled = fillSpellPrompt(promptFor({ levels: [2] }), pool({ policy: hbless }), [
      'Fake Vision|HB',
    ]);
    expect(ids(filled)).toEqual(['Fake Vision|BOOK', 'Fake Vision|HB']);
  });

  it("says when an option comes from outside a character's own books", () => {
    const filled = fillSpellPrompt(
      promptFor({ levels: [2] }),
      pool({ policy: onlyHb, scope: 'character' }),
      ['fake vision|book'],
    );
    expect(filled.options.find((o) => o.id === 'Fake Vision|BOOK')?.advisory).toContain(
      "outside this character's sources",
    );
    expect(filled.options.find((o) => o.id === 'Fake Vision|HB')?.advisory).toBeUndefined();
  });

  it('captions each spell, with its level when the list spans several', () => {
    const one = fillSpellPrompt(promptFor({ levels: [2] }), pool(), undefined);
    expect(one.options[0]?.description).toBe('Divination');
    const many = fillSpellPrompt(promptFor({ levels: [1, 2] }), pool(), undefined);
    expect(many.options[0]?.description).toBe('Level 1 · Enchantment');
  });

  it("disables a spell the origin gives already, but never the prompt's own pick", () => {
    const granted = new Set(['fake charm', 'fake ward']);
    const filled = fillSpellPrompt(promptFor({ levels: [1] }), pool({ granted }), ['Fake Ward|HB']);
    expect(filled.options.find((o) => o.id === 'Fake Charm|HB')?.disabled?.reason).toBe(
      'Test Feat already gives you this spell',
    );
    expect(filled.options.find((o) => o.id === 'Fake Ward|HB')?.disabled).toBeUndefined();
  });

  it('keeps a saved pick whose file is not in yet, listed as the engine named it', () => {
    const saved = { id: 'Fake Lost|ELSEWHERE', label: 'Fake Lost' };
    const filled = fillSpellPrompt({ ...promptFor({ schools: ['A'] }), options: [saved] }, pool(), [
      'Fake Lost|ELSEWHERE',
    ]);
    expect(filled.options[0]).toEqual(saved);
    expect(ids(filled)).toContain('Fake Ward|HB');
  });

  it('leaves a spelled-out list as it is, with captions for what it can find', () => {
    const list: ChoicePrompt = {
      ...promptFor({}),
      spellQuery: undefined,
      options: [
        { id: 'fake ward', label: 'Fake Ward' },
        { id: 'fake missing', label: 'Fake Missing' },
      ],
    };
    const filled = fillSpellPrompt(list, pool({ granted: new Set(['fake missing']) }), undefined);
    expect(ids(filled)).toEqual(['fake ward', 'fake missing']);
    expect(filled.options[0]?.description).toBe('Abjuration');
    expect(filled.options[1]?.description).toBeUndefined();
    expect(filled.options[1]?.disabled).toBeDefined();
  });
});
