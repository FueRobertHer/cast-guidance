import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { collectBackground } from './background';
import { Collector } from './base';

/** Fixture context with one synthetic background injected by name. */
function ctxWith(bg: DataEntity | undefined): EngineContext {
  const base = makeTestContext();
  return {
    byType: (t) => base.byType(t),
    get: (type, name, source) =>
      type === 'background' && name === 'Custom' ? bg : base.get(type, name, source),
  };
}

function collect(bg: DataEntity | undefined, ref = { name: 'Custom', source: 'TST' }) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.background = ref;
  const col = new Collector(doc, ctxWith(bg));
  collectBackground(col);
  return col;
}

describe('collectBackground', () => {
  it('no-ops when the character has no background', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const col = new Collector(doc, makeTestContext());
    collectBackground(col);
    expect(col.effects).toEqual([]);
    expect(col.features).toEqual([]);
  });

  it('warns when the background is not in the registry', () => {
    const col = collect(undefined);
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Background not found: custom\|tst/i),
    );
  });

  it('surfaces a real feat picker for a free origin feat (any) — no dead-end note', () => {
    const col = collect({ name: 'Custom', feats: [{ any: true }], entries: ['x'] });
    // No note pointing at a nonexistent "Feats step".
    expect(col.effects.some((e) => e.kind === 'note')).toBe(false);
    const prompt = col.pending.find((p) => p.kind === 'feat');
    expect(prompt).toBeDefined();
    expect(prompt?.id).toBe('background:custom|tst:feat:0');
    expect(prompt?.count).toBe(1);
    // Every fixture feat is offered (no category filter).
    expect(prompt?.options.some((o) => o.label.startsWith('Alert'))).toBe(true);
  });

  it('gives each free-feat grant its own indexed picker id (no collision)', () => {
    const col = collect({ name: 'Custom', feats: [{ any: true }, { any: true }], entries: ['x'] });
    const ids = col.pending.filter((p) => p.kind === 'feat').map((p) => p.id);
    expect(ids).toEqual(['background:custom|tst:feat:0', 'background:custom|tst:feat:1']);
  });

  it('collects the chosen free origin feat once the pick is stored', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.background = { name: 'Custom', source: 'TST' };
    doc.choices['background:custom|tst:feat:0'] = ['alert|phb'];
    const col = new Collector(
      doc,
      ctxWith({ name: 'Custom', feats: [{ any: true }], entries: ['x'] }),
    );
    collectBackground(col);
    // Alert is a curated +5 initiative feat in the fixture — it actually applies.
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'initiativeBonus', amount: 5 }),
    );
    expect(col.pending.some((p) => p.kind === 'feat')).toBe(false);
  });

  it('disables an already-taken non-repeatable feat picked elsewhere', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.background = { name: 'Custom', source: 'TST' };
    // Alert was chosen at a class ASI (a different `:feat` slot).
    doc.choices['class:warrior|tst:asi:4:feat'] = ['alert|phb'];
    const col = new Collector(
      doc,
      ctxWith({ name: 'Custom', feats: [{ any: true }], entries: ['x'] }),
    );
    collectBackground(col);
    const prompt = col.pending.find((p) => p.kind === 'feat');
    expect(prompt?.options.find((o) => o.id === 'alert|phb')?.disabled).toBeDefined();
  });

  it('narrows anyFromCategory to a feat category and reads the count (>1)', () => {
    const feats: DataEntity[] = [
      { name: 'Origin One', source: 'TST', category: 'O', entries: ['o'] },
      { name: 'Origin Two', source: 'TST', category: 'O', entries: ['o2'] },
      { name: 'General One', source: 'TST', category: 'G', entries: ['g'] },
    ];
    const base = makeTestContext();
    const bg: DataEntity = {
      name: 'Custom',
      feats: [{ anyFromCategory: { category: 'O', count: 2 } }],
      entries: ['x'],
    };
    const ctx: EngineContext = {
      byType: (t) => (t === 'feat' ? feats : base.byType(t)),
      get: (type, name, source) =>
        type === 'background' && name === 'Custom'
          ? bg
          : type === 'feat'
            ? feats.find((f) => String(f.name).toLowerCase() === name.toLowerCase())
            : base.get(type, name, source),
    };
    const doc = newCharacterDoc('c', 'H', 't');
    doc.background = { name: 'Custom', source: 'TST' };
    const col = new Collector(doc, ctx);
    collectBackground(col);
    const prompt = col.pending.find((p) => p.kind === 'feat');
    expect(prompt?.count).toBe(2); // reads the count, not just the default
    expect(prompt?.options.map((o) => o.id)).toEqual(['origin one|tst', 'origin two|tst']);
  });

  it('reads a numeric {any: N} count', () => {
    const col = collect({ name: 'Custom', feats: [{ any: 2 }], entries: ['x'] });
    expect(col.pending.find((p) => p.kind === 'feat')?.count).toBe(2);
  });

  it('warns instead of prompting when a category matches no feats', () => {
    const col = collect({
      name: 'Custom',
      feats: [{ anyFromCategory: 'ZZZ' }],
      entries: ['x'],
    });
    expect(col.pending.some((p) => p.kind === 'feat')).toBe(false);
    expect(col.warnings).toContainEqual(expect.stringMatching(/no matching feats/i));
  });

  it('warns when a named origin feat is missing from the registry', () => {
    const col = collect({ name: 'Custom', feats: [{ 'ghostfeat|zzz': true }] });
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Origin feat not found: ghostfeat\|zzz/i),
    );
  });

  it('resolves an origin feat with a "; option" sub-selector (Acolyte/Sage/Guide)', () => {
    // "magic initiate; cleric|xphb" style key — the base feat (Alert here, a
    // curated +5 initiative feat in the fixture) must resolve and apply.
    const col = collect({ name: 'Custom', feats: [{ 'alert; cleric|phb': true }], entries: ['x'] });
    expect(col.warnings).not.toContainEqual(expect.stringMatching(/Origin feat not found/i));
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'initiativeBonus', amount: 5 }),
    );
    // The locked sub-choice is surfaced as a note.
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'note', text: expect.stringMatching(/locked to .*cleric/i) }),
    );
  });

  it('still warns (with the base name) when a "; option" feat is missing', () => {
    const col = collect({ name: 'Custom', feats: [{ 'ghostfeat; wizard|zzz': true }] });
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Origin feat not found: ghostfeat\|zzz/i),
    );
  });

  it('pushes a feature card for the background', () => {
    const col = collect({ name: 'Custom', entries: ['Background flavor.'] });
    expect(col.features.some((f) => f.name === 'Custom')).toBe(true);
  });

  it('grants a background additionalSpells known spell (previously dropped)', () => {
    const col = collect({
      name: 'Custom',
      additionalSpells: [{ ability: 'int', known: { _: ['guidance|tst'] } }],
      entries: ['x'],
    });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'grantSpell', spell: { name: 'guidance', source: 'tst' } }),
    );
  });

  it('adds a background expanded list keyed by spell level (Strixhaven student)', () => {
    const col = collect({
      name: 'Custom',
      additionalSpells: [{ expanded: { s1: ['shield|tst'], s5: ['flame strike|tst'] } }],
      entries: ['x'],
    });
    expect(col.effects).toContainEqual(
      expect.objectContaining({
        kind: 'spellListAdd',
        spells: ['shield|tst', 'flame strike|tst'],
        filters: [],
      }),
    );
  });

  describe("Custom Background's languages and tools", () => {
    // As the release prints it: the alternatives beside a two-language shorthand.
    const custom: DataEntity = {
      name: 'Custom',
      skillProficiencies: [{ any: 2 }],
      languageProficiencies: [{ anyStandard: 2 }],
      skillToolLanguageProficiencies: [
        { anyLanguage: 2 },
        { anyLanguage: 1, anyTool: 1 },
        { anyTool: 1 },
      ],
      entries: ['x'],
    };
    const id = 'background:custom|tst:lang:0';
    function picked(selected: string[], bg = custom) {
      const doc = newCharacterDoc('c', 'H', 't');
      doc.background = { name: 'Custom', source: 'TST' };
      doc.choices[id] = selected;
      const col = new Collector(doc, ctxWith(bg));
      collectBackground(col);
      return col;
    }
    const granted = (col: Collector) =>
      col.effects.flatMap((e) =>
        e.kind === 'language'
          ? [`language ${e.name}`]
          : e.kind === 'toolProf'
            ? [`tool ${e.name}`]
            : [],
      );

    it('asks one pick of two from languages and tools, where two languages were asked', () => {
      const col = collect(custom);
      const asked = col.pending.filter((p) => p.kind !== 'skill');
      expect(asked.map((p) => [p.id, p.label, p.count])).toEqual([[id, 'Language or tool', 2]]);
      expect(asked[0]?.options.map((o) => o.id)).toEqual(
        expect.arrayContaining(['Elvish', "thieves' tools", 'lute']),
      );
    });

    it('keeps a saved pair of languages', () => {
      const col = picked(['Elvish', 'Dwarvish']);
      expect(granted(col)).toEqual(['language Elvish', 'language Dwarvish']);
      expect(col.pending.some((p) => p.id === id)).toBe(false);
    });

    it('grants a language and a tool, or two tools, as the rule allows', () => {
      expect(granted(picked(['Elvish', "thieves' tools"]))).toEqual([
        'language Elvish',
        "tool thieves' tools",
      ]);
      expect(granted(picked(['lute', "thieves' tools"]))).toEqual([
        'tool lute',
        "tool thieves' tools",
      ]);
    });

    it('still grants a fixed tool beside the mix', () => {
      const col = picked(['Elvish', 'Dwarvish'], {
        ...custom,
        toolProficiencies: [{ "thieves' tools": true }],
      });
      expect(granted(col)).toEqual(['language Elvish', 'language Dwarvish', "tool Thieves' Tools"]);
    });

    it('marks a language the character already speaks', () => {
      const doc = newCharacterDoc('c', 'H', 't');
      doc.background = { name: 'Custom', source: 'TST' };
      const col = new Collector(doc, ctxWith(custom));
      col.add({
        kind: 'language',
        name: 'Elvish',
        origin: { label: 'Elf', uid: 'elf|tst', type: 'race' },
      });
      collectBackground(col);
      const elvish = col.pending.find((p) => p.id === id)?.options.find((o) => o.id === 'Elvish');
      expect(elvish?.disabled?.reason).toBe('You already speak Elvish');
    });

    it('reads the other fields as before when the alternatives are not counts alone', () => {
      const col = collect({
        ...custom,
        skillToolLanguageProficiencies: [{ choose: [{ from: ['anySkill', 'anyTool'] }] }],
        toolProficiencies: [{ "thieves' tools": true }],
      });
      expect(col.pending.find((p) => p.id === id)?.label).toBe('Language');
      expect(granted(col)).toEqual(["tool Thieves' Tools"]);
    });
  });
});
