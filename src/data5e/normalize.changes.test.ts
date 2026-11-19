// Changes to the books (ADR-002, D2) in the merge: a change takes the place of
// the entry it changes, so every character holding the book's entry gets it,
// and only a file with the changes role, or a pack for the entries it lists,
// may do that. Every other clash keeps today's rule.
import { describe, expect, it } from 'vitest';
import type { PackAppliesTo } from '@/engine/castGuidance';
import { writeChange } from '@/features/workshop/copyWriter';
import type { Entity } from './copyMod';
import { fieldPrint } from './fingerprint';
import {
  type EntityRegistry,
  identityKey,
  mergeHomebrew,
  normalizeDataset,
  stackChanges,
} from './normalize';

const AID_TEXT = 'Each target’s Hit Point maximum and current Hit Points increase by 5.';

/** A small release: Aid and Fireball, the Barbarian's Rage, and two classes' ASI. */
function release(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      'spells/spells-xphb.json',
      {
        spell: [
          {
            name: 'Aid',
            source: 'XPHB',
            page: 239,
            srd52: true,
            level: 2,
            school: 'A',
            range: { type: 'point', distance: { type: 'feet', amount: 30 } },
            entries: ['Choose up to three creatures within range.', AID_TEXT],
          },
          // Marks XPHB as a 2024 book, so the bare Aid reads as one through its book.
          { name: 'Fireball', source: 'XPHB', edition: 'one', level: 3, entries: ['Boom.'] },
        ],
      },
    ],
    [
      'class/class-barbarian.json',
      {
        class: [{ name: 'Barbarian', source: 'XPHB', edition: 'one' }],
        classFeature: [
          {
            name: 'Rage',
            source: 'XPHB',
            className: 'Barbarian',
            classSource: 'XPHB',
            level: 1,
            entries: ['You can imbue yourself with a primal power called Rage.'],
          },
          {
            name: 'Ability Score Improvement',
            source: 'XPHB',
            className: 'Barbarian',
            classSource: 'XPHB',
            level: 4,
            entries: ['The Barbarian’s.'],
          },
        ],
      },
    ],
    [
      'class/class-fighter.json',
      {
        class: [{ name: 'Fighter', source: 'XPHB', edition: 'one' }],
        classFeature: [
          {
            name: 'Ability Score Improvement',
            source: 'XPHB',
            className: 'Fighter',
            classSource: 'XPHB',
            level: 4,
            entries: ['The Fighter’s.'],
          },
        ],
      },
    ],
  ]);
}

const BOOK = normalizeDataset(release());

function bookEntry(type: 'spell' | 'classFeature', find: (e: Entity) => boolean): Entity {
  const e = BOOK.byType(type).find(find);
  if (e === undefined) throw new Error('not in the book');
  return structuredClone(e);
}

const bookAid = () => bookEntry('spell', (e) => e.name === 'Aid');
const bookRage = () => bookEntry('classFeature', (e) => e.name === 'Rage');
const bookAsi = (className: string) =>
  bookEntry(
    'classFeature',
    (e) => e.name === 'Ability Score Improvement' && e.className === className,
  );

/** The change the Workshop would store for Aid raised to 10 at 60 feet. */
function aidChange(): Entity {
  const aid = bookAid();
  const draft = {
    ...aid,
    range: { type: 'point', distance: { type: 'feet', amount: 60 } },
    entries: [(aid.entries as string[])[0], AID_TEXT.replace('5', '10')],
  };
  return writeChange('spell', aid, draft);
}

function rageChange(text = 'You can enter a fury called Rage.'): Entity {
  const rage = bookRage();
  return writeChange('classFeature', rage, { ...rage, entries: [text] });
}

/** A file the player's Changes to the books would be: its own source beside book entries. */
const changesFile = (content: Record<string, Entity[]>) => ({
  _meta: { sources: [{ json: 'MyChanges', full: 'Changes to the books' }] },
  ...content,
});

interface Build {
  files: Array<[string, Record<string, unknown>]>;
  changes?: string[];
  packs?: Array<[string, PackAppliesTo, number?]>;
}

function build({ files, changes = [], packs = [] }: Build): EntityRegistry {
  const reg = normalizeDataset(release());
  mergeHomebrew(
    reg,
    new Map(files),
    new Map(packs.map(([id, appliesTo, order]) => [id, { appliesTo, order }])),
    new Set(changes),
  );
  return reg;
}

const withChanges = (content: Record<string, Entity[]>, more: Build['files'] = []) =>
  build({ files: [['changes', changesFile(content)], ...more], changes: ['changes'] });

const feature = (reg: EntityRegistry, name: string, className: string, level: number) =>
  reg
    .byType('classFeature')
    .find((f) => f.name === name && f.className === className && f.level === level);

const aids = (reg: EntityRegistry) => reg.byType('spell').filter((s) => s.name === 'Aid');

describe('a change to the books', () => {
  it('is stored as changes only, under the entry’s own identity', () => {
    const stored = aidChange();
    expect(stored).toMatchObject({
      name: 'Aid',
      source: 'XPHB',
      range: { distance: { amount: 60 } },
      _copy: { name: 'Aid', source: 'XPHB', _mod: { entries: [{ mode: 'replaceArr' }] } },
      castGuidance: { basedOn: 'Aid|XPHB' },
    });
    expect(stored).not.toHaveProperty('entries');
    expect(stored).not.toHaveProperty('level');
    // Printed in the book's own book: its edition is the book's, given back by the registry.
    expect(stored).not.toHaveProperty('edition');
    const g = stored.castGuidance as Record<string, unknown>;
    expect(Object.keys(g.basedOnFields as object).sort()).toEqual(['entries', 'range']);
  });

  it('takes the place of Aid, for every character holding the book’s', () => {
    const reg = withChanges({ spell: [aidChange()] });
    const aid = reg.get('spell', 'Aid', 'XPHB');
    expect((aid?.entries as string[])[1]).toContain('increase by 10');
    expect(aid?.range).toEqual({ type: 'point', distance: { type: 'feet', amount: 60 } });
    // What it did not change is the book's, and so is what a copy would drop.
    expect(aid).toMatchObject({ level: 2, school: 'A', page: 239, srd52: true });
    expect(aid?.bookEdition).toBe('one');
    expect(aid).not.toHaveProperty('_copy');
    // Pickers list it once, where the book's was, and the book still counts as the book.
    expect(aids(reg)).toEqual([aid]);
    expect(reg.byType('spell').indexOf(aid as Entity)).toBe(
      BOOK.byType('spell').findIndex((s) => s.name === 'Aid'),
    );
    expect(reg.officialCount('spell')).toBe(BOOK.officialCount('spell'));
    expect(reg.sourceCounts().get('XPHB')).toBe(BOOK.sourceCounts().get('XPHB'));
    expect(reg.sourceCounts().has('MyChanges')).toBe(false);
  });

  it('keeps both versions, each knowing the other', () => {
    const reg = withChanges({ spell: [aidChange()] });
    const placed = reg.get('spell', 'Aid', 'XPHB') as Entity;
    const record = reg.changeOf(placed);
    expect(record?.base).toEqual(BOOK.get('spell', 'Aid', 'XPHB'));
    expect(record?.placed).toBe(placed);
    expect(reg.changeOf(record?.base as Entity)).toBe(record);
    expect(record?.layers).toHaveLength(1);
    expect(record?.layers[0]).toMatchObject({
      from: { kind: 'changes', fileId: 'changes', source: 'MyChanges' },
      shared: true,
      needsLook: [],
    });
    expect(reg.changedEntries()).toEqual([record]);
    // A view holding the same layers gets the same entry (E4 stacks its own).
    expect(
      stackChanges(
        'spell',
        record?.base as Entity,
        (record?.layers ?? []).map((l) => l.entry),
      ),
    ).toEqual(placed);
  });

  it('to Rage matches its class and level', () => {
    const stored = rageChange();
    expect(stored._copy).toMatchObject({ className: 'Barbarian', classSource: 'XPHB', level: 1 });
    expect(stored).toMatchObject({ className: 'Barbarian', classSource: 'XPHB', level: 1 });
    const reg = withChanges({ classFeature: [stored] });
    expect(feature(reg, 'Rage', 'Barbarian', 1)?.entries).toEqual([
      'You can enter a fury called Rage.',
    ]);
    expect(reg.byType('classFeature').filter((f) => f.name === 'Rage')).toHaveLength(1);
  });

  it('to one class’s feature leaves another class’s of the same name and source', () => {
    const asi = bookAsi('Fighter');
    const stored = writeChange('classFeature', asi, { ...asi, entries: ['Changed.'] });
    const reg = withChanges({ classFeature: [stored] });
    expect(feature(reg, 'Ability Score Improvement', 'Fighter', 4)?.entries).toEqual(['Changed.']);
    expect(feature(reg, 'Ability Score Improvement', 'Barbarian', 4)?.entries).toEqual([
      'The Barbarian’s.',
    ]);
    // The index found the Barbarian's first, and still does.
    expect(reg.get('classFeature', 'Ability Score Improvement', 'XPHB')?.className).toBe(
      'Barbarian',
    );
  });

  it('with nothing of its identity below it is left out, not added as a stub', () => {
    const asi = bookAsi('Barbarian');
    const stored = writeChange(
      'classFeature',
      { ...asi, level: 8 },
      {
        ...asi,
        level: 8,
        entries: ['Changed.'],
      },
    );
    const reg = withChanges({ classFeature: [stored] });
    expect(reg.byType('classFeature').filter((f) => f.level === 8)).toEqual([]);
    expect(reg.changedEntries()).toEqual([]);
    expect(reg.warnings.map((w) => w.message).join('\n')).toContain('nothing of that identity');
  });

  it('keeps the name of what it changes, or is left out', () => {
    const renamed = { ...aidChange(), name: 'Aid (house)' };
    const reg = withChanges({ spell: [renamed] });
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    expect(reg.byType('spell').some((s) => s.name === 'Aid (house)')).toBe(false);
    expect(reg.warnings.map((w) => w.message).join('\n')).toContain(
      'keeps the name and source of what it changes',
    );
  });

  it('is written under the original’s name whatever the draft calls it', () => {
    const aid = bookAid();
    const stored = writeChange('spell', aid, { ...aid, name: 'Aid (house)', level: 3 });
    expect(stored).toMatchObject({ name: 'Aid', level: 3 });
    expect(withChanges({ spell: [stored] }).get('spell', 'Aid', 'XPHB')?.level).toBe(3);
  });

  it('that says its own edition is printed under it, not its book’s', () => {
    const aid = bookAid();
    expect(aid.bookEdition).toBe('one');
    const stored = writeChange('spell', aid, { ...aid, edition: 'classic' });
    expect(stored.edition).toBe('classic');
    const placed = withChanges({ spell: [stored] }).get('spell', 'Aid', 'XPHB');
    expect(placed?.edition).toBe('classic');
    expect(placed).not.toHaveProperty('bookEdition');
  });

  it('carries no edition when the draft keeps the one its book gives', () => {
    const aid = bookAid();
    expect(writeChange('spell', aid, { ...aid, edition: 'one', level: 3 })).not.toHaveProperty(
      'edition',
    );
  });

  it('is read against the entry below it, never a copy of itself', () => {
    // Without the special lookup the change finds itself in its own file and waits forever.
    const reg = withChanges({ spell: [aidChange()] });
    expect(reg.warnings).toEqual([]);
  });

  it('leaves other files’ copies of the book’s entry reading the book’s', () => {
    const workshop = {
      _meta: { sources: [{ json: 'MyHomebrew' }] },
      spell: [{ name: 'Aid Plus', source: 'MyHomebrew', _copy: { name: 'Aid', source: 'XPHB' } }],
    };
    const reg = withChanges({ spell: [aidChange()] }, [['workshop', workshop]]);
    expect(reg.get('spell', 'Aid Plus', 'MyHomebrew')?.entries).toEqual(bookAid().entries);
  });
});

describe('who may replace', () => {
  const impostor = (entries: string[]) => ({
    _meta: { sources: [{ json: 'XPHB', full: 'Player’s Handbook' }] },
    spell: [{ name: 'Aid', source: 'XPHB', level: 9, entries }],
  });

  it('never an imported file declaring the book: today’s rule', () => {
    const reg = build({ files: [['imp', impostor(['Rewritten.'])]] });
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    expect(reg.changedEntries()).toEqual([]);
  });

  it('never an imported file over a stored change', () => {
    for (const files of [
      [
        ['changes', changesFile({ spell: [aidChange()] })],
        ['imp', impostor(['Rewritten.'])],
      ],
      [
        ['imp', impostor(['Rewritten.'])],
        ['changes', changesFile({ spell: [aidChange()] })],
      ],
    ] as Build['files'][]) {
      const reg = build({ files, changes: ['changes'] });
      const aid = reg.get('spell', 'Aid', 'XPHB');
      expect((aid?.entries as string[])[1]).toContain('increase by 10');
      expect(aid?.level).toBe(2);
      // The change is the book's entry: an imported tie lands beside it as before.
      expect(reg.changeOf(aid as Entity)?.layers).toHaveLength(1);
    }
  });

  it('never a file whose content looks like a change but whose row has no role', () => {
    const reg = build({ files: [['changes', changesFile({ spell: [aidChange()] })]] });
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    expect(reg.changedEntries()).toEqual([]);
  });
});

describe('a rule pack’s replaced entries', () => {
  const feet = (amount: number) => ({ type: 'point', distance: { type: 'feet', amount } });
  const rangeOf = (e: Entity | undefined) =>
    (e?.range as { distance: { amount: number } } | undefined)?.distance.amount;
  const packFile = (replaces: unknown, extra: Record<string, unknown> = {}, range = 90) => ({
    _meta: {
      sources: [{ json: 'TBL', full: 'Our Table' }],
      castGuidance: { v: 1, replaces },
    },
    spell: [
      {
        name: 'Aid',
        source: 'XPHB',
        range: feet(range),
        _copy: {
          name: 'Aid',
          source: 'XPHB',
          _mod: { entries: { mode: 'appendArr', items: ['At our table, it lasts a day.'] } },
        },
      },
      { name: 'Fireball', source: 'XPHB', level: 9, entries: ['Not listed.'] },
    ],
    ...extra,
  });
  const listsAid = [{ type: 'spell', name: 'Aid', source: 'XPHB' }];
  const everyone: PackAppliesTo = { characters: [], appDefault: true };
  const text = (reg: EntityRegistry) =>
    (reg.get('spell', 'Aid', 'XPHB')?.entries as string[]) ?? [];

  it('take a book entry’s place when the pack applies to every character', () => {
    const reg = build({ files: [['pack', packFile(listsAid)]], packs: [['pack', everyone]] });
    expect(text(reg)).toContain('At our table, it lasts a day.');
    expect(aids(reg)).toHaveLength(1);
    const layer = reg.changeOf(reg.get('spell', 'Aid', 'XPHB') as Entity)?.layers[0];
    expect(layer).toMatchObject({
      from: { kind: 'pack', fileId: 'pack', source: 'TBL', reach: everyone },
      shared: true,
    });
  });

  it('only the entries it lists: the rest keep today’s rule', () => {
    const reg = build({ files: [['pack', packFile(listsAid)]], packs: [['pack', everyone]] });
    expect(reg.get('spell', 'Fireball', 'XPHB')?.level).toBe(3);
  });

  it('wait for E4’s view when the pack applies to some characters, listed once meanwhile', () => {
    const hild: PackAppliesTo = { characters: ['hild'] };
    const reg = build({ files: [['pack', packFile(listsAid)]], packs: [['pack', hild]] });
    expect(text(reg)).toEqual(bookAid().entries);
    expect(aids(reg)).toHaveLength(1);
    const record = reg.changeOf(reg.get('spell', 'Aid', 'XPHB') as Entity);
    expect(record?.placed).toBe(record?.base);
    expect(record?.layers[0]).toMatchObject({ shared: false, from: { reach: hild } });
    // Hild's view stacks it.
    const hers = stackChanges('spell', record?.base as Entity, [
      record?.layers[0]?.entry as Entity,
    ]);
    expect(hers.entries).toContain('At our table, it lasts a day.');
  });

  it('replace nothing while the pack is applied to nobody', () => {
    const reg = build({ files: [['pack', packFile(listsAid)]] });
    expect(text(reg)).toEqual(bookAid().entries);
    expect(
      reg.changeOf(reg.get('spell', 'Aid', 'XPHB') as Entity)?.layers[0]?.from,
    ).not.toHaveProperty('reach');
  });

  it('replace nothing while the pack breaks a limit', () => {
    const broken = packFile(listsAid);
    const g = broken._meta.castGuidance as Record<string, unknown>;
    g.patches = Array.from({ length: 501 }, () => ({ target: 'Aid|XPHB', add: [] }));
    const reg = build({ files: [['pack', broken]], packs: [['pack', everyone]] });
    expect(text(reg)).toEqual(bookAid().entries);
  });

  it('sit under the player’s own change', () => {
    const reg = build({
      files: [
        ['changes', changesFile({ spell: [aidChange()] })],
        ['pack', packFile(listsAid)],
      ],
      changes: ['changes'],
      packs: [['pack', everyone]],
    });
    expect(text(reg)[1]).toContain('increase by 10');
    expect(text(reg)).toContain('At our table, it lasts a day.');
    // Both set the range: the player's, on top, wins.
    expect(rangeOf(reg.get('spell', 'Aid', 'XPHB'))).toBe(60);
    const layers = reg.changeOf(reg.get('spell', 'Aid', 'XPHB') as Entity)?.layers ?? [];
    expect(layers.map((l) => l.from.kind)).toEqual(['pack', 'changes']);
  });

  it('stack in the player’s pack order', () => {
    const files: Build['files'] = [
      ['low', packFile(listsAid, {}, 90)],
      ['high', packFile(listsAid, {}, 120)],
    ];
    const one = build({
      files,
      packs: [
        ['low', everyone, 0],
        ['high', everyone, 1],
      ],
    });
    expect(rangeOf(one.get('spell', 'Aid', 'XPHB'))).toBe(120);
    expect(one.changedEntries()[0]?.layers.map((l) => l.from.fileId)).toEqual(['low', 'high']);
    const other = build({
      files,
      packs: [
        ['low', everyone, 1],
        ['high', everyone, 0],
      ],
    });
    expect(rangeOf(other.get('spell', 'Aid', 'XPHB'))).toBe(90);
  });

  it('are the entry below the player’s change, which a second edit is written against', () => {
    const packOnly = build({ files: [['pack', packFile(listsAid)]], packs: [['pack', everyone]] });
    const shown = packOnly.get('spell', 'Aid', 'XPHB') as Entity;
    expect(packOnly.belowOwnChange(shown)).toBe(shown);
    const reg = build({
      files: [
        ['changes', changesFile({ spell: [aidChange()] })],
        ['pack', packFile(listsAid)],
      ],
      changes: ['changes'],
      packs: [['pack', everyone]],
    });
    const below = reg.belowOwnChange(reg.get('spell', 'Aid', 'XPHB') as Entity);
    expect(rangeOf(below)).toBe(90);
    expect(below.entries).toContain('At our table, it lasts a day.');
    expect((below.entries as string[])[1]).toContain('increase by 5');
    const fireball = reg.get('spell', 'Fireball', 'XPHB') as Entity;
    expect(reg.belowOwnChange(fireball)).toBe(fireball);
  });

  it('are what the player’s change is read against for Needs a look', () => {
    // The player changed the pack's Aid, as the registry showed it to them.
    const packed = build({ files: [['pack', packFile(listsAid)]], packs: [['pack', everyone]] });
    const shown = structuredClone(packed.get('spell', 'Aid', 'XPHB') as Entity);
    const stored = writeChange('spell', shown, {
      ...shown,
      entries: [...(shown.entries as string[]), 'And one more line.'],
    });
    const reg = build({
      files: [
        ['changes', changesFile({ spell: [stored] })],
        ['pack', packFile(listsAid)],
      ],
      changes: ['changes'],
      packs: [['pack', everyone]],
    });
    const layers = reg.changedEntries()[0]?.layers ?? [];
    expect(layers.map((l) => l.needsLook)).toEqual([[], []]);
    expect(text(reg).slice(-2)).toEqual(['At our table, it lasts a day.', 'And one more line.']);
  });

  it('match a parent-keyed type by its parent', () => {
    const rage = bookRage();
    const pack = {
      _meta: { sources: [{ json: 'TBL' }], castGuidance: { v: 1, replaces: [] as unknown[] } },
      classFeature: [{ ...rage, entries: ['Pack Rage.'] }],
    };
    const ref = { type: 'classFeature', name: 'Rage', source: 'XPHB', className: 'Barbarian' };
    pack._meta.castGuidance.replaces = [ref];
    const missingLevel = build({ files: [['pack', pack]], packs: [['pack', everyone]] });
    expect(feature(missingLevel, 'Rage', 'Barbarian', 1)?.entries).toEqual(rage.entries);
    pack._meta.castGuidance.replaces = [{ ...ref, classSource: 'XPHB', level: 1 }];
    const reg = build({ files: [['pack', pack]], packs: [['pack', everyone]] });
    expect(feature(reg, 'Rage', 'Barbarian', 1)?.entries).toEqual(['Pack Rage.']);
  });

  it('read no more than the limit, and nothing from a list that is not one', () => {
    const many = Array.from({ length: 501 }, () => ({ type: 'spell', name: 'X', source: 'Y' }));
    const reg = build({
      files: [['pack', packFile([...many, ...listsAid])]],
      packs: [['pack', everyone]],
    });
    expect(text(reg)).toEqual(bookAid().entries);
    expect(reg.warnings.map((w) => w.message).join('\n')).toContain('at most 500');
    const odd = build({ files: [['pack', packFile('Aid')]], packs: [['pack', everyone]] });
    expect(odd.warnings.map((w) => w.message).join('\n')).toContain('is a list');
  });
});

describe('a change to an imported entry', () => {
  const ember = (v: { entries?: string[]; level?: number } = {}) => ({
    _meta: { sources: [{ json: 'HB', full: 'Homebrew' }] },
    spell: [
      {
        name: 'Ember Lance',
        source: 'HB',
        level: v.level ?? 1,
        range: { type: 'point', distance: { type: 'feet', amount: 30 } },
        entries: v.entries ?? ['A lance of embers.'],
      },
    ],
  });
  const original = () => normalizeAndGet(ember());
  function normalizeAndGet(file: Record<string, unknown>): Entity {
    const reg = build({ files: [['hb', file]] });
    return structuredClone(reg.get('spell', 'Ember Lance', 'HB') as Entity);
  }
  const fix = () =>
    writeChange('spell', original(), { ...original(), entries: ['A lance of white embers.'] });

  it('stays on top of the collection', () => {
    const reg = withChanges({ spell: [fix()] }, [['hb', ember()]]);
    expect(reg.get('spell', 'Ember Lance', 'HB')?.entries).toEqual(['A lance of white embers.']);
    expect(reg.changedEntries()[0]?.layers[0]?.needsLook).toEqual([]);
  });

  it('stays on top through an update that changes another field', () => {
    const reg = withChanges({ spell: [fix()] }, [['hb2', ember({ level: 2 })]]);
    const lance = reg.get('spell', 'Ember Lance', 'HB');
    expect(lance).toMatchObject({ level: 2, entries: ['A lance of white embers.'] });
    expect(reg.changedEntries()[0]?.layers[0]?.needsLook).toEqual([]);
  });

  it('goes to Needs a look, with both versions, when an update changes a field it changes', () => {
    const reg = withChanges({ spell: [fix()] }, [
      ['hb2', ember({ entries: ['A lance of fire.'] })],
    ]);
    const record = reg.changedEntries()[0];
    expect(record?.layers[0]?.needsLook).toEqual(['entries']);
    expect(record?.base.entries).toEqual(['A lance of fire.']);
    expect(record?.placed).toBe(reg.get('spell', 'Ember Lance', 'HB'));
  });

  it('and to a book entry, when a release changes what it changes', () => {
    const stored = aidChange();
    const g = stored.castGuidance as { basedOnFields: Record<string, string> };
    const marks = { ...g.basedOnFields };
    // As if made against a release where Aid's range was 20 feet.
    const older = writeChange(
      'spell',
      { ...bookAid(), range: { type: 'point', distance: { type: 'feet', amount: 20 } } },
      { ...bookAid(), range: { type: 'point', distance: { type: 'feet', amount: 60 } } },
    );
    const reg = withChanges({ spell: [older] });
    expect(reg.changedEntries()[0]?.layers[0]?.needsLook).toEqual(['range']);
    expect(marks.range).not.toBe(
      (older.castGuidance as { basedOnFields: Record<string, string> }).basedOnFields.range,
    );
  });

  it('reads no more marks than the limit', () => {
    const twenty = { type: 'point', distance: { type: 'feet', amount: 20 } };
    const older = writeChange('spell', { ...bookAid(), range: twenty }, bookAid());
    const g = older.castGuidance as { basedOnFields: Record<string, string> };
    const filler = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`x${i}`, fieldPrint(bookAid(), `x${i}`)]),
    );
    const late = {
      ...older,
      castGuidance: { ...g, basedOnFields: { ...filler, ...g.basedOnFields } },
    };
    expect(withChanges({ spell: [late] }).changedEntries()[0]?.layers[0]?.needsLook).toEqual([]);
    const early = {
      ...older,
      castGuidance: { ...g, basedOnFields: { ...g.basedOnFields, ...filler } },
    };
    expect(withChanges({ spell: [early] }).changedEntries()[0]?.layers[0]?.needsLook).toEqual([
      'range',
    ]);
  });
});

describe('a change’s guidance', () => {
  const lance = (effects: unknown[] | undefined, more: Record<string, unknown> = {}) => ({
    _meta: { sources: [{ json: 'HB' }] },
    spell: [
      {
        name: 'Ember Lance',
        source: 'HB',
        level: 1,
        entries: ['A lance of embers.'],
        ...(effects === undefined ? {} : { castGuidance: { v: 1, effects, ...more } }),
      },
    ],
  });
  const speed = (amount: number) => [{ kind: 'speedBonus', amount }];
  const shown = (file: Record<string, unknown>) =>
    structuredClone(build({ files: [['hb', file]] }).get('spell', 'Ember Lance', 'HB') as Entity);
  const placed = (stored: Entity, file: Record<string, unknown>) =>
    withChanges({ spell: [stored] }, [['hb', file]]).get('spell', 'Ember Lance', 'HB');
  const guidance = (e: Entity | undefined) =>
    e?.castGuidance as Record<string, unknown> | undefined;

  it('holds only the parts the player changed, so an update to the others comes through', () => {
    const was = shown(lance(speed(10)));
    const stored = writeChange('spell', was, { ...was, entries: ['A lance of white embers.'] });
    expect(guidance(stored)).not.toHaveProperty('effects');
    const after = placed(stored, lance(speed(30)));
    expect(after?.entries).toEqual(['A lance of white embers.']);
    expect(guidance(after)?.effects).toEqual(speed(30));
  });

  it('changes the part the player changed, and keeps the rest', () => {
    const was = shown(lance(speed(10), { drop: ['Ember'] }));
    const stored = writeChange('spell', was, {
      ...was,
      castGuidance: { ...guidance(was), effects: speed(20) },
    });
    const after = placed(stored, lance(speed(10), { drop: ['Lance'] }));
    expect(guidance(after)).toMatchObject({ effects: speed(20), drop: ['Lance'] });
  });

  it('clears a part the player emptied', () => {
    const was = shown(lance(speed(10), { replace: true }));
    const stored = writeChange('spell', was, {
      ...was,
      castGuidance: { ...guidance(was), effects: [], replace: false },
    });
    const after = guidance(placed(stored, lance(speed(10), { replace: true })));
    expect(after).not.toHaveProperty('effects');
    expect(after).not.toHaveProperty('replace');
  });

  it('is read in the player’s version where the entry below says none', () => {
    const bare = {
      _meta: { sources: [{ json: 'HB' }] },
      spell: [
        { name: 'Ember Lance', source: 'HB', level: 1, castGuidance: { effects: speed(10) } },
      ],
    };
    const was = shown(bare);
    const stored = writeChange('spell', was, {
      ...was,
      castGuidance: { ...guidance(was), effects: speed(20) },
    });
    expect(guidance(placed(stored, bare))).toMatchObject({ v: 1, effects: speed(20) });
  });

  it('goes to Needs a look for the part an update changes, not another', () => {
    const was = shown(lance(speed(10), { drop: ['Ember'] }));
    const stored = writeChange('spell', was, {
      ...was,
      castGuidance: { ...guidance(was), effects: speed(20) },
    });
    const look = (file: Record<string, unknown>) =>
      withChanges({ spell: [stored] }, [['hb', file]]).changedEntries()[0]?.layers[0]?.needsLook;
    expect(look(lance(speed(10), { drop: ['Lance'] }))).toEqual([]);
    expect(look(lance(speed(30), { drop: ['Ember'] }))).toEqual(['castGuidance.effects']);
  });

  it('leaves no guidance of its own on an entry that had none', () => {
    const aid = withChanges({ spell: [aidChange()] }).get('spell', 'Aid', 'XPHB');
    expect(aid).not.toHaveProperty('castGuidance');
  });

  it('is taken whole from a change written whole', () => {
    const everyone: PackAppliesTo = { characters: [], appDefault: true };
    const pack = {
      _meta: {
        sources: [{ json: 'TBL' }],
        castGuidance: { v: 1, replaces: [{ type: 'spell', name: 'Ember Lance', source: 'HB' }] },
      },
      spell: [{ name: 'Ember Lance', source: 'HB', level: 1, entries: ['Whole.'] }],
    };
    const reg = build({
      files: [
        ['hb', lance(speed(10))],
        ['pack', pack],
      ],
      packs: [['pack', everyone]],
    });
    expect(reg.get('spell', 'Ember Lance', 'HB')).not.toHaveProperty('castGuidance');
  });
});

describe('a change that cannot stand for what it changes', () => {
  const everyone: PackAppliesTo = { characters: [], appDefault: true };
  const viaPack = (entry: Entity, type = 'spell') => ({
    _meta: {
      sources: [{ json: 'TBL' }],
      castGuidance: {
        v: 1,
        replaces: [
          {
            type,
            name: entry.name,
            source: entry.source,
            ...(type === 'classFeature'
              ? { className: 'Barbarian', classSource: 'XPHB', level: 1 }
              : {}),
          },
        ],
      },
    },
    [type]: [entry],
  });
  const packed = (entry: Entity, type = 'spell') =>
    build({ files: [['pack', viaPack(entry, type)]], packs: [['pack', everyone]] });
  const aidMod = (mod: unknown) => ({
    name: 'Aid',
    source: 'XPHB',
    _copy: { name: 'Aid', source: 'XPHB', _mod: mod },
  });
  const said = (reg: EntityRegistry) => reg.warnings.map((w) => w.message).join('\n');

  it('is left out when its _mod renames it', () => {
    const reg = packed(aidMod({ name: 'Fireball' }));
    expect(aids(reg)).toHaveLength(1);
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    expect(reg.byType('spell').filter((s) => s.name === 'Fireball')).toHaveLength(1);
    expect(said(reg)).toContain('no longer stands for the entry it changes');
    expect(reg.changedEntries()).toEqual([]);
  });

  it('is left out when its _mod moves it to another class or level', () => {
    const rage = {
      name: 'Rage',
      source: 'XPHB',
      className: 'Barbarian',
      classSource: 'XPHB',
      level: 1,
      _copy: {
        name: 'Rage',
        source: 'XPHB',
        className: 'Barbarian',
        classSource: 'XPHB',
        level: 1,
        _mod: { level: 3, className: 'Fighter' },
      },
    };
    const reg = packed(rage, 'classFeature');
    expect(feature(reg, 'Rage', 'Barbarian', 1)?.entries).toEqual(bookRage().entries);
    expect(feature(reg, 'Rage', 'Fighter', 3)).toBeUndefined();
    expect(said(reg)).toContain('no longer stands for the entry it changes');
    expect(reg.changedEntries()).toEqual([]);
  });

  it('keeps the exact name and source of what it changes', () => {
    const reg = withChanges({ spell: [{ ...aidChange(), source: 'xphb', name: ['Aid'] }] });
    const aid = aids(reg)[0];
    expect(aid).toMatchObject({ name: 'Aid', source: 'XPHB' });
    expect((aid?.entries as string[])[1]).toContain('increase by 10');
    expect([...reg.sourceCounts()]).toEqual([...BOOK.sourceCounts()]);
  });

  it('never leaves a _copy on the entry', () => {
    const reg = packed(aidMod({ _copy: { name: 'Fireball', source: 'XPHB' } }));
    expect(reg.get('spell', 'Aid', 'XPHB')).not.toHaveProperty('_copy');
  });

  it('is left out, not a stub, when its copy cannot be read', () => {
    const broken = aidMod({ entries: { mode: 'removeArr', names: [{ toString: 1 }] } });
    const reg = packed(broken);
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    expect(reg.changedEntries()).toEqual([]);
    // A view stacking it (E4) leaves it out the same way.
    expect(stackChanges('spell', bookAid(), [broken]).entries).toEqual(bookAid().entries);
    for (const odd of ['Aid', null, ['Aid']]) {
      const malformed = packed({ name: 'Aid', source: 'XPHB', _copy: odd, entries: ['Odd.'] });
      expect(malformed.get('spell', 'Aid', 'XPHB')?.entries).toEqual(bookAid().entries);
    }
  });

  it('leaves the player’s change standing over a pack change that cannot be read', () => {
    const reg = build({
      files: [
        ['changes', changesFile({ spell: [aidChange()] })],
        ['pack', viaPack(aidMod({ entries: { mode: 'removeArr', names: [{ toString: 1 }] } }))],
      ],
      changes: ['changes'],
      packs: [['pack', everyone]],
    });
    const aid = reg.get('spell', 'Aid', 'XPHB');
    expect((aid?.entries as string[])[1]).toContain('increase by 10');
    expect(aid?.level).toBe(2);
  });

  it('stays, with a warning, when one of its changes no longer finds its text', () => {
    const reg = packed(
      aidMod({
        entries: [
          { mode: 'replaceArr', replace: 'Not in Aid.', items: ['Never.'] },
          { mode: 'appendArr', items: ['Still added.'] },
        ],
      }),
    );
    expect(reg.get('spell', 'Aid', 'XPHB')?.entries).toContain('Still added.');
    expect(reg.warnings.length).toBeGreaterThan(0);
  });
});

describe('identityKey', () => {
  it('is name and source, then the parent for the types known by one', () => {
    expect(identityKey('spell', { name: 'Aid', source: 'XPHB', level: 2 })).toBe('aid|xphb');
    expect(identityKey('classFeature', bookRage())).toBe('rage|xphb|barbarian|xphb|1');
    expect(
      identityKey('subrace', { name: 'Hill', source: 'PHB', raceName: 'Dwarf', raceSource: 'PHB' }),
    ).toBe('hill|phb|dwarf|phb');
    // Never a key a file's object inherits.
    expect(identityKey('constructor', { name: 'A', source: 'B' })).toBe('a|b');
  });
});
