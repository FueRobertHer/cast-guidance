import { describe, expect, it } from 'vitest';
import { engineContextFor } from '../../data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '../../data5e/normalize';
import type { RulesVersion } from '../../data5e/rulesVersion';
import { pendingChoices } from '../../engine/derive';
import { newCharacterDoc } from '../../engine/types';
import type { InstalledCheck } from '../types';
import { parseXml } from '../xml';
import type { FileCounter } from './classCounters';
import { convertOptions, type OptionChoice, type OptionHost } from './classOptions';
import { convertFc5Compendium, fc5Context } from './compendium';
import type { Fc5Context } from './context';
import type { Entry } from './text';

const FILE = 'ember_homebrew.xml';

const choice = (name: string, level: number, text = 'x'): OptionChoice => ({
  name,
  level,
  el: parseXml(`<feature optional="YES"><name>${name}</name><text>${text}</text></feature>`),
});

const counter = (name: string, ...rows: [number, string][]): FileCounter => ({
  name,
  rows: rows.map(([level, value]) => ({ level, value })),
});

function host(
  more: {
    owner?: string;
    className?: string;
    edition?: RulesVersion;
    fixed?: { name: string; level: number; entries: Entry[] }[];
    counters?: FileCounter[];
    ctx?: Fc5Context;
  } = {},
): OptionHost {
  const ctx = more.ctx ?? fc5Context(FILE);
  return {
    owner: more.owner ?? 'Ember Knight',
    className: more.className ?? 'Ember Knight',
    ctx,
    placement: ctx.place(undefined, more.edition),
    edition: more.edition,
    fixed: more.fixed ?? [],
    counters: new Map((more.counters ?? []).map((c) => [c.name.toLowerCase(), c])),
  };
}

const styles = (level: number, ...names: string[]) =>
  names.map((n) => choice(`Fighting Style: ${n}`, level));

describe('convertOptions', () => {
  it('counts the picks the prose gives, and each later feature of the label', () => {
    const result = convertOptions(
      [choice('Metamagic: Careful Spell', 3), choice('Metamagic: Distant Spell', 3)],
      host({
        fixed: [
          { name: 'Metamagic', level: 3, entries: ['You gain two of the following options.'] },
          { name: 'Metamagic (2nd)', level: 10, entries: ['You learn one more.'] },
        ],
      }),
    );
    expect(result.progression).toEqual([
      {
        name: 'Metamagic',
        featureType: ['Ember Knight: Metamagic', 'MM'],
        progression: { '3': 2, '10': 3 },
      },
    ]);
    expect(result.parts.map((p) => [p.entity.name, p.entity.featureType, p.official])).toEqual([
      ['Careful Spell', ['Ember Knight: Metamagic'], 'MM'],
      ['Distant Spell', ['Ember Knight: Metamagic'], 'MM'],
    ]);
    expect(result.rest).toEqual([]);
  });

  it('takes the count from a Known counter over the prose, and marks the counter read', () => {
    const result = convertOptions(
      styles(1, 'Archery', 'Defense'),
      host({
        fixed: [{ name: 'Fighting Style', level: 1, entries: ['Choose two of these.'] }],
        counters: [counter('Fighting Styles Known', [1, '1'], [10, '2'])],
      }),
    );
    expect(result.progression[0]?.progression).toEqual({ '1': 1, '10': 2 });
    expect([...result.countersRead]).toEqual(['fighting styles known']);
  });

  it('counts one pick where the prose names none, and none more for a list repeated later', () => {
    const result = convertOptions(
      [...styles(1, 'Archery', 'Defense'), ...styles(10, 'Archery', 'Defense')],
      host({ fixed: [{ name: 'Fighting Style', level: 1, entries: ['Adopt a style.'] }] }),
    );
    expect(result.progression[0]?.progression).toEqual({ '1': 1 });
    expect(result.parts.map((p) => p.entity.name)).toEqual(['Archery', 'Defense']);
    expect(result.parts.every((p) => p.entity.prerequisite === undefined)).toBe(true);
  });

  it('counts each list by the Known counter of its own name, not one its name ends in', () => {
    const result = convertOptions(
      [
        choice('Hexes: Bane', 1),
        choice('Hexes: Blight', 1),
        choice('Grand Hexes: Doom', 11),
        choice('Grand Hexes: Ruin', 11),
      ],
      host({
        counters: [counter('Hexes Known', [1, '2']), counter('Grand Hexes Known', [11, '1'])],
      }),
    );
    expect(result.progression.map((p) => [p.name, p.progression])).toEqual([
      ['Hexes', { '1': 2 }],
      ['Grand Hexes', { '11': 1 }],
    ]);
    expect([...result.countersRead].sort()).toEqual(['grand hexes known', 'hexes known']);
  });

  it('needs the level of an option first listed after the rest', () => {
    const result = convertOptions(
      [...styles(1, 'Archery', 'Defense'), ...styles(7, 'Ember Ward')],
      host(),
    );
    expect(result.parts.map((p) => [p.entity.name, p.entity.prerequisite])).toEqual([
      ['Archery', undefined],
      ['Defense', undefined],
      ['Ember Ward', [{ level: { level: 7, class: { name: 'Ember Knight', visible: true } } }]],
    ]);
  });

  it("names the official list of the class's fighting styles, and none for the 2024 rules", () => {
    const official = (className: string, edition?: RulesVersion) =>
      convertOptions(styles(1, 'Archery', 'Defense'), host({ className, edition })).parts[0]
        ?.official;
    expect(official('Ember Knight')).toBe('FS:F');
    expect(official('Paladin (Ember)')).toBe('FS:P');
    expect(official('Ranger')).toBe('FS:R');
    expect(official('Bard')).toBe('FS:B');
    expect(official('Ember Knight', '2024')).toBeUndefined();
  });

  it('leaves a label with one option, and a choice with no label, as the rest', () => {
    const lone = choice('Ember Path: Ash', 3);
    const plain = choice('Ember Surge', 3);
    const result = convertOptions([lone, plain], host());
    expect(result.progression).toEqual([]);
    expect(result.parts).toEqual([]);
    expect(result.rest).toEqual([lone, plain]);
  });

  it('keeps one of a name listed at two levels, from the first', () => {
    const result = convertOptions(
      [...styles(3, 'Archery'), ...styles(1, 'Archery', 'Defense')],
      host(),
    );
    expect(result.parts.map((p) => [p.entity.name, p.entity.prerequisite])).toEqual([
      ['Archery', undefined],
      ['Defense', undefined],
    ]);
  });

  describe('lists stored as spells', () => {
    const withLists = (...lists: string[]): Fc5Context => ({
      ...fc5Context(FILE),
      optionLists: new Set(lists),
    });

    it('offers the list of its name that a Known counter counts', () => {
      const result = convertOptions(
        [],
        host({
          ctx: withLists(
            'Ember Knight: Tricks',
            'Ash Warden: Tricks',
            'Ember Knight (Ash): Tricks',
          ),
          counters: [counter('Tricks Known', [2, '2'], [5, '3'])],
        }),
      );
      expect(result.progression).toEqual([
        { name: 'Tricks', featureType: ['Ember Knight: Tricks'], progression: { '2': 2, '5': 3 } },
      ]);
      expect([...result.countersRead]).toEqual(['tricks known']);
    });

    it('offers a subclass its own list', () => {
      const result = convertOptions(
        [],
        host({
          owner: 'Ember Knight (Ash)',
          ctx: withLists('Ember Knight: Tricks', 'Ember Knight (Ash): Tricks'),
          counters: [counter('Tricks Known', [3, '2'])],
        }),
      );
      expect(result.progression.map((p) => p.featureType)).toEqual([
        ['Ember Knight (Ash): Tricks'],
      ]);
    });

    it('takes the list of the counter’s own name over one whose name ends in it', () => {
      const result = convertOptions(
        [],
        host({
          ctx: withLists('Ember Knight: Grand Hexes', 'Ember Knight: Hexes'),
          counters: [counter('Hexes Known', [1, '2'])],
        }),
      );
      expect(result.progression.map((p) => p.featureType)).toEqual([['Ember Knight: Hexes']]);
    });

    it('counts its own list and the file’s stored one by their own counters, in either order', () => {
      const hexes = counter('Hexes Known', [1, '2']);
      const grand = counter('Grand Hexes Known', [11, '1']);
      for (const counters of [
        [hexes, grand],
        [grand, hexes],
      ]) {
        const result = convertOptions(
          [choice('Grand Hexes: Doom', 11), choice('Grand Hexes: Ruin', 11)],
          host({ ctx: withLists('Ember Knight: Hexes'), counters }),
        );
        expect(result.progression.map((p) => [p.name, p.progression])).toEqual([
          ['Grand Hexes', { '11': 1 }],
          ['Hexes', { '1': 2 }],
        ]);
      }
    });

    it('finds a list that names its class with (UA)', () => {
      const result = convertOptions(
        [],
        host({
          owner: 'Ember Mystic',
          ctx: withLists('Ember Mystic (UA): Psionic Talents'),
          counters: [counter('Talents Known', [1, '1'])],
        }),
      );
      expect(result.progression.map((p) => p.featureType)).toEqual([
        ['Ember Mystic (UA): Psionic Talents'],
      ]);
    });

    it('offers the official list a counter names, when no list of the file fits', () => {
      const result = convertOptions(
        [],
        host({
          className: 'Warlock',
          owner: 'Warlock',
          counters: [counter('Eldritch Invocations Known', [2, '2'], [5, '3'])],
        }),
      );
      expect(result.progression).toEqual([
        { name: 'Eldritch Invocations', featureType: ['EI'], progression: { '2': 2, '5': 3 } },
      ]);
    });

    it('leaves Spells Known to spellcasting, though a list ends in its name', () => {
      const result = convertOptions(
        [choice('Bonus Spells: Flare', 1), choice('Bonus Spells: Smoke', 1)],
        host({
          ctx: withLists('Ember Knight: Spells'),
          counters: [counter('Spells Known', [1, '2'])],
        }),
      );
      expect(result.progression.map((p) => p.progression)).toEqual([{ '1': 1 }]);
      expect(result.countersRead.size).toBe(0);
    });

    it('offers none when two lists fit the counter alike, or the counter is not numbers', () => {
      const two = convertOptions(
        [],
        host({
          ctx: withLists('Ember Knight: Fire Tricks', 'Ember Knight: Ember Tricks'),
          counters: [counter('Tricks Known', [2, '2'])],
        }),
      );
      expect(two.progression).toEqual([]);
      expect(two.countersRead.size).toBe(0);
      const text = convertOptions(
        [],
        host({
          ctx: withLists('Ember Knight: Tricks'),
          counters: [counter('Tricks Known', [2, '%0'])],
        }),
      );
      expect(text.progression).toEqual([]);
    });

    it('adds nothing for a list the class lists options of already', () => {
      const result = convertOptions(
        [choice('Tricks: Flare', 2), choice('Tricks: Smoke', 2)],
        host({
          ctx: withLists('Ember Knight: Tricks'),
          counters: [counter('Tricks Known', [2, '2'])],
        }),
      );
      expect(result.progression).toEqual([
        { name: 'Tricks', featureType: ['Ember Knight: Tricks'], progression: { '2': 2 } },
      ]);
    });
  });
});

describe('class options in a file', () => {
  const opt = ' optional="YES"';
  const f = (name: string, text = 'x', attrs = opt) =>
    `<feature${attrs}><name>${name}</name><text>${text}</text></feature>`;
  const knight = (name: string, more = '') => `
    <class><name>${name}</name><hd>10</hd>
      <autolevel level="1">${f('Fighting Style', 'Adopt one style.', '')}${f('Fighting Style: Archery', 'Aim.')}${f('Fighting Style: Ember Guard', 'Guard.')}${more}</autolevel>
    </class>`;
  const list = (json: Record<string, unknown>, kind: string) =>
    (json[kind] ?? []) as Record<string, unknown>[];
  const trick = (name: string) =>
    `<spell><name>Trick: ${name}</name><level>0</level><classes>Ember Knight: Tricks</classes><text>A trick.</text></spell>`;

  it('needs a level of an option two classes list only where each class does', () => {
    const at = (warden: number, knightLevel: number) => {
      const cls = (name: string, lv: number) => `
        <class><name>${name}</name><hd>10</hd>
          <autolevel level="1">${f('Fighting Style', 'Adopt one.', '')}${f('Fighting Style: Archery')}</autolevel>
          <autolevel level="${lv}">${f('Fighting Style: Ember Ward')}</autolevel>
        </class>`;
      const { json } = convertFc5Compendium(
        parseXml(
          `<compendium>${cls('Ash Warden', warden)}${cls('Ember Knight', knightLevel)}</compendium>`,
        ),
        { fileName: FILE },
      );
      return list(json, 'optionalfeature').find((o) => o.name === 'Ember Ward')?.prerequisite;
    };
    expect(at(7, 1)).toBeUndefined();
    expect(at(1, 7)).toBeUndefined();
    expect(at(7, 5)).toEqual([
      { level: { level: 7, class: { name: 'Ash Warden', visible: true } } },
      { level: { level: 5, class: { name: 'Ember Knight', visible: true } } },
    ]);
  });

  it('keeps an option of its own list that shares a name with an installed one', () => {
    const check: InstalledCheck = (kind, name) => kind === 'optionalfeature' && name === 'Defense';
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium><class><name>Ember Knight</name><hd>10</hd><autolevel level="1">${f('Ember Stance', 'Adopt one stance.', '')}${f('Ember Stance: Defense', 'Ember defense.')}${f('Ember Stance: Fury', 'Fury.')}</autolevel></class></compendium>`,
      ),
      { fileName: FILE, isInstalled: check },
    );
    expect(list(json, 'optionalfeature').map((o) => [o.name, o.featureType])).toEqual([
      ['Defense', ['Ember Knight: Ember Stance']],
      ['Fury', ['Ember Knight: Ember Stance']],
    ]);
  });

  it('warns of a list stored as spells only when no class offers it, in either order', () => {
    const tricks = `${trick('Flare')}${trick('Smoke')}`;
    const offered = knight(
      'Ember Knight',
      '<counter><name>Tricks Known</name><value>2</value></counter>',
    );
    const warnings = (xml: string) =>
      convertFc5Compendium(parseXml(`<compendium>${xml}</compendium>`), { fileName: FILE }).report
        .warnings;
    expect(warnings(`${tricks}${offered}`)).toEqual([]);
    expect(warnings(`${offered}${tricks}`)).toEqual([]);
    expect(warnings(`${knight('Ember Knight')}${tricks}`)).toEqual([
      expect.stringMatching(/^2 class options are for a class this app cannot convert yet/),
    ]);
    // An option a class's own list offers too is offered, whichever comes first.
    const flare =
      '<spell><name>Flare</name><level>0</level><classes>Warmage: Tricks</classes><text>A trick.</text></spell>';
    const tricky = knight('Ember Knight', `${f('Tricks: Flare')}${f('Tricks: Smoke')}`);
    expect(warnings(`${flare}${tricky}`)).toEqual([]);
    expect(warnings(`${tricky}${flare}`)).toEqual([]);
  });

  it('keeps the prerequisite of an option the file stores, whichever list comes first', () => {
    const lance =
      '<spell><name>Ember Lance</name><level>0</level><classes>Eldritch Invocations</classes><text>Prerequisite: 5th level\nA lance.</text></spell>';
    const caster = `<class><name>Ember Knight</name><hd>10</hd><autolevel level="2">${f('Eldritch Invocations', 'Learn two.', '')}${f('Eldritch Invocations: Ember Lance', 'L.')}${f('Eldritch Invocations: Ash Sight', 'S.')}</autolevel></class>`;
    for (const xml of [`${lance}${caster}`, `${caster}${lance}`]) {
      const { json } = convertFc5Compendium(parseXml(`<compendium>${xml}</compendium>`), {
        fileName: FILE,
      });
      expect(list(json, 'optionalfeature').map((o) => [o.name, o.prerequisite])).toEqual([
        ['Ember Lance', [{ level: { level: 5, class: { name: 'Warlock', visible: true } } }]],
        ['Ash Sight', undefined],
      ]);
    }
  });

  it('keeps one of an option two classes list, on both lists', () => {
    const { json } = convertFc5Compendium(
      parseXml(`<compendium>${knight('Ember Knight')}${knight('Ash Warden')}</compendium>`),
      { fileName: FILE },
    );
    expect(list(json, 'optionalfeature').map((o) => [o.name, o.featureType])).toEqual([
      ['Archery', ['Ember Knight: Fighting Style', 'Ash Warden: Fighting Style']],
      ['Ember Guard', ['Ember Knight: Fighting Style', 'Ash Warden: Fighting Style']],
    ]);
    expect(list(json, 'class').map((c) => c.optionalfeatureProgression)).toEqual([
      [
        {
          name: 'Fighting Style',
          featureType: ['Ember Knight: Fighting Style', 'FS:F'],
          progression: { '1': 1 },
        },
      ],
      [
        {
          name: 'Fighting Style',
          featureType: ['Ash Warden: Fighting Style', 'FS:F'],
          progression: { '1': 1 },
        },
      ],
    ]);
  });

  it('keeps apart options of one name under two labels that say different things', () => {
    const totem = `
      <class><name>Ember Knight</name><hd>10</hd>
        <autolevel level="3">${f('Totem Spirit', 'Choose one.', '')}${f('Totem Spirit: Bear', 'Resist.')}${f('Totem Spirit: Wolf', 'Pack.')}</autolevel>
        <autolevel level="6">${f('Aspect of the Beast', 'Choose one.', '')}${f('Aspect of the Beast: Bear', 'Carry more.')}${f('Aspect of the Beast: Wolf', 'Track.')}</autolevel>
      </class>`;
    const { json } = convertFc5Compendium(parseXml(`<compendium>${totem}</compendium>`), {
      fileName: FILE,
    });
    expect(list(json, 'optionalfeature').map((o) => [o.name, o.featureType, o.entries])).toEqual([
      ['Bear', ['Ember Knight: Totem Spirit'], ['Resist.']],
      ['Wolf', ['Ember Knight: Totem Spirit'], ['Pack.']],
      ['Bear (Aspect of the Beast)', ['Ember Knight: Aspect of the Beast'], ['Carry more.']],
      ['Wolf (Aspect of the Beast)', ['Ember Knight: Aspect of the Beast'], ['Track.']],
    ]);
  });

  it("keeps one of two classes' options only when they say the same", () => {
    const style = (name: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="1">${f('Fighting Style', 'Adopt one.', '')}${f('Fighting Style: Archery', text)}${f('Fighting Style: Defense', 'Armor.')}</autolevel></class>`;
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium>${style('Ember Knight', 'Gain +1.')}${style('Ash Warden', 'gain + 1')}${style('Iron Guard', 'Gain +2.')}${style('Stone Guard', 'Gain +3.')}${style('Oak Guard', 'Gain + 2.')}</compendium>`,
      ),
      { fileName: FILE },
    );
    const archery = list(json, 'optionalfeature').filter((o) =>
      String(o.name).startsWith('Archery'),
    );
    expect(archery.map((o) => [o.name, o.featureType, o.entries])).toEqual([
      ['Archery', ['Ember Knight: Fighting Style', 'Ash Warden: Fighting Style'], ['Gain +1.']],
      [
        'Archery (Fighting Style)',
        ['Iron Guard: Fighting Style', 'Oak Guard: Fighting Style'],
        ['Gain +2.'],
      ],
      ['Archery (Fighting Style 2)', ['Stone Guard: Fighting Style'], ['Gain +3.']],
    ]);
    expect(list(json, 'optionalfeature').filter((o) => o.name === 'Defense')).toHaveLength(1);
  });

  it('keeps apart copies whose numbers differ in sign only', () => {
    const style = (name: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="1">${f('Fighting Style', 'Adopt one.', '')}${f('Fighting Style: Archery', text)}${f('Fighting Style: Defense', 'Armor.')}</autolevel></class>`;
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium>${style('Ember Knight', 'AC changes by +1.')}${style('Ash Warden', 'AC changes by -1.')}</compendium>`,
      ),
      { fileName: FILE },
    );
    expect(
      list(json, 'optionalfeature')
        .filter((o) => String(o.name).startsWith('Archery'))
        .map((o) => [o.name, o.entries]),
    ).toEqual([
      ['Archery', ['AC changes by +1.']],
      ['Archery (Fighting Style)', ['AC changes by -1.']],
    ]);
  });

  it('finds a copy that says the same under another label', () => {
    const style = (name: string, label: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="1">${f(label, 'Adopt one.', '')}${f(`${label}: Archery`, text)}${f(`${label}: Defense`, 'Armor.')}</autolevel></class>`;
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium>${style('Ember Knight', 'Fighting Style', 'One.')}${style('Ash Warden', 'Fighting Style', 'Two.')}${style('Iron Guard', 'Combat Style', 'Two.')}</compendium>`,
      ),
      { fileName: FILE },
    );
    expect(
      list(json, 'optionalfeature')
        .filter((o) => String(o.name).startsWith('Archery'))
        .map((o) => [o.name, o.featureType]),
    ).toEqual([
      ['Archery', ['Ember Knight: Fighting Style']],
      ['Archery (Fighting Style)', ['Ash Warden: Fighting Style', 'Iron Guard: Combat Style']],
    ]);
  });

  it('gives a stored option the first class copy and keeps another apart, in any order', () => {
    const lance =
      '<spell><name>Ember Lance</name><level>0</level><classes>Eldritch Invocations</classes><text>Prerequisite: 5th level\nA lance.</text></spell>';
    const caster = (name: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="2">${f('Eldritch Invocations', 'Learn two.', '')}${f('Eldritch Invocations: Ember Lance', text)}${f('Eldritch Invocations: Ash Sight', 'S.')}</autolevel></class>`;
    const a = caster('Ember Knight', 'Lance one.');
    const b = caster('Ash Warden', 'Lance two.');
    const c = caster('Iron Guard', 'Lance two.');
    const lances = (xml: string) =>
      list(
        convertFc5Compendium(parseXml(`<compendium>${xml}</compendium>`), { fileName: FILE }).json,
        'optionalfeature',
      )
        .filter((o) => String(o.name).startsWith('Ember Lance'))
        .map((o) => [o.name, [...(o.featureType as string[])].sort()]);
    const apart = [
      ['Ember Lance', ['EI', 'Ember Knight: Eldritch Invocations']],
      ['Ember Lance (Eldritch Invocations)', ['Ash Warden: Eldritch Invocations']],
    ];
    expect(lances(`${a}${b}${lance}`)).toEqual(apart);
    expect(lances(`${lance}${a}${b}`)).toEqual(apart);
    expect(lances(`${a}${lance}${b}`)).toEqual(apart);
    expect(lances(`${a}${b}${lance}${c}`)).toEqual([
      ['Ember Lance', ['EI', 'Ember Knight: Eldritch Invocations']],
      [
        'Ember Lance (Eldritch Invocations)',
        ['Ash Warden: Eldritch Invocations', 'Iron Guard: Eldritch Invocations'],
      ],
    ]);
  });

  it('gives an option kept under its label the printing of its own name', () => {
    const phb = 'Source: Player’s Handbook (2014) p. 72';
    const style = (name: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="1">${f('Fighting Style', 'Adopt one.', '')}${f('Fighting Style: Archery', `${text}\n${phb}`)}${f('Fighting Style: Defense', `Armor.\n${phb}`)}</autolevel></class>`;
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium>${style('Ember Knight', 'Gain +2 to ranged.')}${style('Ash Warden', 'You gain a +2 bonus to ranged attacks.')}</compendium>`,
      ),
      { fileName: FILE },
    );
    expect(
      list(json, 'optionalfeature')
        .filter((o) => String(o.name).startsWith('Archery'))
        .map((o) => [o.name, o.printingOf]),
    ).toEqual([
      ['Archery', ['Archery|PHB']],
      ['Archery (Fighting Style)', ['Archery|PHB']],
    ]);
  });

  it("puts an installed class's options on its official list, and names those no list offers", () => {
    const check: InstalledCheck = (kind, name) =>
      (kind === 'class' && name === 'Fighter') ||
      (kind === 'optionalfeature' && name === 'Archery');
    const { json, report } = convertFc5Compendium(
      parseXml(
        `<compendium>${knight('Fighter', `${f('Ember Trick: Flare')}${f('Ember Trick: Smoke')}`)}</compendium>`,
      ),
      { fileName: FILE, isInstalled: check },
    );
    expect(json.class).toBeUndefined();
    expect(list(json, 'optionalfeature').map((o) => [o.name, o.featureType])).toEqual([
      ['Ember Guard', ['FS:F']],
    ]);
    const note = report.notes.find((n) => n.kind === 'class');
    expect(note?.status).toBe('installed');
    expect(note?.reasons).toContain(
      "its options (Flare, Smoke) are left out: your game data's class has no list of their kind to offer them on",
    );
  });

  it("puts a counter named for an option on that option's mechanics", () => {
    const { json } = convertFc5Compendium(
      parseXml(
        `<compendium>${knight(
          'Ember Knight',
          '<counter><name>Ember Guard</name><value>2</value><reset>L</reset></counter>',
        )}</compendium>`,
      ),
      { fileName: FILE },
    );
    const guard = list(json, 'optionalfeature').find((o) => o.name === 'Ember Guard');
    expect(guard?.castGuidance).toMatchObject({
      effects: [
        { kind: 'resource', label: 'Ember Guard', max: { byLevel: { '1': 2 } }, reset: 'long' },
      ],
    });
    expect(list(json, 'class')[0]?.castGuidance).toBeUndefined();
  });

  it('offers a file list stored as spells to its class, by its Known counter', () => {
    const { json, report } = convertFc5Compendium(
      parseXml(
        `<compendium>${knight(
          'Ember Knight',
          '<counter><name>Tricks Known</name><value>2</value></counter>',
        )}${trick('Flare')}${trick('Smoke')}</compendium>`,
      ),
      { fileName: FILE },
    );
    const [cls] = list(json, 'class');
    expect(cls?.optionalfeatureProgression).toContainEqual({
      name: 'Tricks',
      featureType: ['Ember Knight: Tricks'],
      progression: { '1': 2 },
    });
    expect(
      list(json, 'optionalfeature')
        .filter((o) => (o.featureType as string[]).includes('Ember Knight: Tricks'))
        .map((o) => o.name),
    ).toEqual(['Trick: Flare', 'Trick: Smoke']);
    const note = report.notes.find((n) => n.kind === 'class');
    expect(note?.reasons ?? []).not.toContainEqual(expect.stringContaining('Tricks Known'));
  });

  it('asks the sheet for as many options as the class gives, from its list', () => {
    const { json } = convertFc5Compendium(
      parseXml(`<compendium>${knight('Ember Knight')}</compendium>`),
      {
        fileName: FILE,
      },
    );
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const [cls] = list(json, 'class');
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.classes = [
      { ref: { name: String(cls?.name), source: String(cls?.source) }, levels: 1, hp: ['avg'] },
    ];
    const prompts = pendingChoices(doc, engineContextFor(reg)).filter(
      (p) => p.kind === 'optionalfeature',
    );
    expect(prompts.map((p) => [p.label, p.count, p.options.map((o) => o.label)])).toEqual([
      [
        'Fighting Style',
        1,
        [`Archery (${String(cls?.source)})`, `Ember Guard (${String(cls?.source)})`],
      ],
    ]);
  });
});
