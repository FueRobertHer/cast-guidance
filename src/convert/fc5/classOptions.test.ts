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

  it("counts a later feature named for one more option, as Fight Club's 2014 sorcerer has", () => {
    const result = convertOptions(
      [choice('Metamagic: Careful Spell', 3), choice('Metamagic: Distant Spell', 3)],
      host({
        fixed: [
          { name: 'Metamagic', level: 3, entries: ['You gain two of the following options.'] },
          {
            name: 'Metamagic Option (3rd)',
            level: 10,
            entries: ['At 10th level, you learn an additional metamagic option.'],
          },
          { name: 'Metamagic Option (4th)', level: 17, entries: ['You learn one more.'] },
          { name: 'Metamagic Optional Rules (a long aside)', level: 18, entries: ['Learn two.'] },
        ],
      }),
    );
    expect(result.progression[0]?.progression).toEqual({ '3': 2, '10': 3, '17': 4 });
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

  it("reads an option's spells, and names one whose table of spells it keeps as text", () => {
    const dash = String.fromCharCode(0x2014);
    const result = convertOptions(
      [
        choice(
          'Circle Spells: Arctic',
          3,
          `These spells are always prepared.\n3rd ${dash} hold person, spike growth\n5th ${dash} sleet storm, slow`,
        ),
        choice(
          'Circle Spells: Coast',
          3,
          `You gain these spells.\n3rd ${dash} mirror image or misty step`,
        ),
      ],
      host(),
    );
    expect(result.parts.map((p) => [p.entity.name, p.entity.additionalSpells])).toEqual([
      [
        'Arctic',
        [{ prepared: { 3: ['hold person', 'spike growth'], 5: ['sleet storm', 'slow'] } }],
      ],
      ['Coast', undefined],
    ]);
    expect(result.spellsKept).toEqual(['Coast']);
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

    it('offers a list whose owner carries tags or wrapping brackets, in its own edition only', () => {
      const lists = withLists(
        'Ember Knight ((Ash) (TP)) [5.5e]: Tricks',
        'Ember Knight (Ash (Legacy)): Tricks',
      );
      const offered = (edition: RulesVersion) =>
        convertOptions(
          [],
          host({
            owner: 'Ember Knight (Ash)',
            edition,
            ctx: lists,
            counters: [counter('Tricks Known', [3, '2'])],
          }),
        ).progression.map((p) => p.featureType);
      expect(offered('2024')).toEqual([['Ember Knight ((Ash) (TP)) [5.5e]: Tricks']]);
      expect(offered('2014')).toEqual([['Ember Knight (Ash (Legacy)): Tricks']]);
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

describe("lists stored as spells, counted from their features' text", () => {
  /** A host whose file stores these lists as spells, with these fixed features. */
  const storing = (
    lists: string[],
    fixed: { name: string; level: number; entries: Entry[] }[],
    more: { owner?: string; classFixed?: { name: string; level: number; entries: Entry[] }[] } = {},
  ): OptionHost => {
    const ctx = fc5Context(FILE);
    ctx.optionLists = new Set(lists);
    return {
      ...host({ ctx, fixed, ...(more.owner !== undefined && { owner: more.owner }) }),
      ...(more.classFixed !== undefined && { classFixed: more.classFixed }),
    };
  };
  const offer = (h: OptionHost) => {
    const result = convertOptions([], h);
    return {
      progression: result.progression.map((p) => [p.featureType, p.progression]),
      counted: result.countedFromText,
    };
  };

  it("offers the host's own list at the picks its feature gives, and those it adds at listed levels", () => {
    const h = storing(
      ['Ember Knight: Trick Shots', 'Ash Warden: Trick Shots'],
      [
        {
          name: 'Adept Marksman',
          level: 3,
          entries: [
            'You learn two trick shots of your choice. You learn an additional trick shot of your choice at 7th, 10th, and 15th level. Whenever you learn a new trick shot, you can also replace one trick shot you know.',
          ],
        },
      ],
    );
    expect(offer(h)).toEqual({
      progression: [[['Ember Knight: Trick Shots'], { '3': 2, '7': 3, '10': 4, '15': 5 }]],
      counted: ['Trick Shots'],
    });
  });

  it('adds one at each level listed after another, and each later feature that gives more', () => {
    const h = storing(
      ['Ember Knight: Grand Hexes', 'Ember Knight: Resonants'],
      [
        {
          name: 'Grand Hex',
          level: 11,
          entries: ['You learn one grand hex, and you learn another at 13th and 15th level.'],
        },
        { name: 'Resonant Utterance', level: 6, entries: ['You learn two Resonants.'] },
        {
          name: 'Pronouncement',
          level: 10,
          entries: ['You learn two new Resonants of your choice.'],
        },
      ],
    );
    expect(offer(h).progression).toEqual([
      [['Ember Knight: Grand Hexes'], { '11': 1, '13': 2, '15': 3 }],
      [['Ember Knight: Resonants'], { '6': 2, '10': 4 }],
    ]);
    // A level the opening sentence gives with no `another` is when, not more.
    const when = storing(
      ['Ember Knight: Tricks'],
      [{ name: 'Trickery', level: 3, entries: ['You learn two tricks at 3rd level.'] }],
    );
    expect(offer(when).progression).toEqual([[['Ember Knight: Tricks'], { '3': 2 }]]);
  });

  it('counts none for the options the host has outright, and an additional one only where listed', () => {
    const h = storing(
      ['Ember Knight: Focus Art', 'Ember Knight: Finisher'],
      [
        {
          name: 'Focus',
          level: 1,
          entries: [
            'You learn two such Focus Arts: Weapon Parry and Dodge Step. You learn one additional Focus Art of your choice at 2nd and 7th level.',
          ],
        },
        { name: 'Focus Art: Weapon Parry', level: 1, entries: ['Parry.'] },
        { name: 'Focus Art: Dodge Step', level: 1, entries: ['Step.'] },
        {
          name: 'Momentum',
          level: 2,
          entries: ['You learn one additional Finisher of your choice at 4th and 6th level.'],
        },
        { name: 'Finisher: Brutal Finisher', level: 2, entries: ['Brutal.'] },
      ],
    );
    expect(offer(h).progression).toEqual([
      [['Ember Knight: Focus Art'], { '2': 1, '7': 2 }],
      [['Ember Knight: Finisher'], { '4': 1, '6': 2 }],
    ]);
  });

  it('counts a level listed by one feature and given by another once', () => {
    const h = storing(
      ['Ember Knight: Arcane Shot Options'],
      [
        {
          name: 'Arcane Shot',
          level: 3,
          entries: [
            'You learn two Arcane Shot options. You gain one additional option at Fighter levels 7 and 10.',
          ],
        },
        {
          name: 'Arcane Shot Improvement (1)',
          level: 7,
          entries: ['You learn an additional Arcane Shot option of your choice.'],
        },
      ],
    );
    expect(offer(h).progression).toEqual([
      [['Ember Knight: Arcane Shot Options'], { '3': 2, '7': 3, '10': 4 }],
    ]);
  });

  it('reads the word before a generic Options as what is picked', () => {
    const h = storing(
      ['Ember Knight: Psionic Discipline Options'],
      [
        {
          name: 'Psionic Discipline',
          level: 2,
          entries: [
            'You gain two disciplines of your choice. When you gain a level, you can replace one of your options. You gain one additional option at Psion levels 5, 10, and 13.',
          ],
        },
      ],
    );
    expect(offer(h).progression).toEqual([
      [['Ember Knight: Psionic Discipline Options'], { '2': 2, '5': 3, '10': 4, '13': 5 }],
    ]);
  });

  it('takes no swap, no choice among ones known, and no later choose as a pick', () => {
    const h = storing(
      ['Ember Knight: Mutagens'],
      [
        {
          name: 'Formulas',
          level: 3,
          entries: [
            'When you gain a level and learn a new mutagen formula, you can replace one formula you know. You choose four mutagen formulas to learn. You can choose one of the mutagens you know to drink.',
          ],
        },
        { name: 'Exalted Mutation', level: 18, entries: ['Choose one mutagen affecting you.'] },
      ],
    );
    expect(offer(h).progression).toEqual([[['Ember Knight: Mutagens'], { '3': 4 }]]);
  });

  it('leaves a list unoffered when no feature gives a number of it, or another list offers its label', () => {
    expect(
      offer(
        storing(
          ['Ember Knight: Traps'],
          [{ name: 'Traps', level: 1, entries: ['You know traps.'] }],
        ),
      ),
    ).toEqual({ progression: [], counted: [] });
    const own = convertOptions(
      [choice('Tricks: Flare', 1), choice('Tricks: Smoke', 1)],
      storing(['Tricks'], [{ name: 'Tricks', level: 1, entries: ['You learn two tricks.'] }]),
    );
    expect(own.progression.map((p) => p.featureType)).toEqual([['Ember Knight: Tricks']]);
    expect(own.countedFromText).toEqual([]);
    // Another class's list, named in full, is that class's.
    const boons = {
      name: 'Boons',
      level: 1,
      entries: ['You learn two boons from the Ash Warden: Boons list.'],
    };
    expect(offer(storing(['Ash Warden: Boons'], [boons]))).toEqual({
      progression: [],
      counted: [],
    });
  });

  it('offers a list stored with no class name to the class that names it, not its subclass', () => {
    const curse = { name: 'Blood Maledict', level: 1, entries: ['You know one blood curse.'] };
    expect(offer(storing(['Blood Curses'], [curse])).progression).toEqual([
      [['Blood Curses'], { '1': 1 }],
    ]);
    const sub = { name: 'Brand', level: 7, entries: ['You learn one blood curse.'] };
    expect(
      offer(
        storing(['Blood Curses'], [sub], { owner: 'Ember Knight (Order)', classFixed: [curse] }),
      ).progression,
    ).toEqual([]);
    expect(
      offer(storing(['Blood Curses'], [sub], { owner: 'Ember Knight (Order)', classFixed: [] }))
        .progression,
    ).toEqual([[['Blood Curses'], { '7': 1 }]]);
    // A list that only shares a word is not named.
    expect(
      offer(storing(['Blood Curses'], [{ ...curse, entries: ['You know one curse.'] }])),
    ).toEqual({ progression: [], counted: [] });
  });

  /** The progression one list gets from these features, read at their levels. */
  const countOf = (lists: string[], ...features: [number, string][]) =>
    offer(
      storing(
        lists,
        features.map(([level, text], i) => ({ name: `Feature ${i}`, level, entries: [text] })),
      ),
    ).progression;

  it('counts an extra the sentence gives once, at the levels it gives it', () => {
    const tricks = ['Ember Knight: Trick Shots'];
    expect(
      countOf(tricks, [
        3,
        'You learn two trick shots, and you learn an additional trick shot at 7th level.',
      ]),
    ).toEqual([[tricks, { '3': 2, '7': 3 }]]);
    expect(
      countOf(tricks, [1, 'You learn two trick shots at 3rd level and another at 7th level.']),
    ).toEqual([[tricks, { '1': 2, '7': 3 }]]);
    expect(countOf(tricks, [3, 'You learn two trick shots, and two more at 7th level.'])).toEqual([
      [tricks, { '3': 2, '7': 4 }],
    ]);
    // `an additional one`, and ordinals after `levels`.
    expect(
      countOf(tricks, [
        6,
        'You gain two trick shots of your choice and an additional one at 14th level.',
      ]),
    ).toEqual([[tricks, { '6': 2, '14': 3 }]]);
    expect(
      countOf(tricks, [
        3,
        'You learn 3 trick shots, chosen from the list, and gain an additional one at levels 7th, 10th, and 14th.',
      ]),
    ).toEqual([[tricks, { '3': 3, '7': 4, '10': 5, '14': 6 }]]);
  });

  it("gives a longer list's words to the longer list only", () => {
    expect(
      countOf(
        ['Ember Knight: Hexes', 'Ember Knight: Grand Hexes'],
        [1, 'You learn two hexes.'],
        [11, 'You learn one grand hex, and you learn another at 13th and 15th level.'],
      ),
    ).toEqual([
      [['Ember Knight: Hexes'], { '1': 2 }],
      [['Ember Knight: Grand Hexes'], { '11': 1, '13': 2, '15': 3 }],
    ]);
    expect(countOf(['Blood Curses', 'Curses'], [1, 'You know one blood curse.'])).toEqual([
      [['Blood Curses'], { '1': 1 }],
    ]);
    // One feature naming both: each list takes its own words.
    expect(
      countOf(
        ['Ember Knight: Hexes', 'Ember Knight: Grand Hexes'],
        [1, 'You learn two hexes. You learn one additional grand hex at 11th level.'],
      ),
    ).toEqual([
      [['Ember Knight: Hexes'], { '1': 2 }],
      [['Ember Knight: Grand Hexes'], { '11': 1 }],
    ]);
    // A class that names the longer list leaves the shorter one to its subclass.
    expect(
      offer(
        storing(
          ['Blood Curses', 'Curses'],
          [{ name: 'Hex Brand', level: 7, entries: ['You learn one curse.'] }],
          {
            owner: 'Ember Knight (Order)',
            classFixed: [{ name: 'Maledict', level: 1, entries: ['You know one blood curse.'] }],
          },
        ),
      ).progression,
    ).toEqual([[['Curses'], { '7': 1 }]]);
  });

  it('reads a number known in all as a total, and a condition or a number of as no pick', () => {
    const tricks = ['Ember Knight: Tricks'];
    expect(
      countOf(tricks, [1, 'You learn two tricks.'], [7, 'You now know three tricks.']),
    ).toEqual([[tricks, { '1': 2, '7': 3 }]]);
    expect(
      countOf(tricks, [1, 'You know a number of tricks equal to your Intelligence modifier.']),
    ).toEqual([]);
    expect(
      countOf(
        tricks,
        [3, 'You learn two tricks.'],
        [10, 'Whenever you learn a new trick, you can pick one with a prerequisite.'],
      ),
    ).toEqual([[tricks, { '3': 2 }]]);
    // A condition in the sentence before is that sentence's.
    expect(
      countOf(tricks, [1, 'Whenever you rest, you regain your focus. You learn two tricks.']),
    ).toEqual([[tricks, { '1': 2 }]]);
  });

  it('reads a long run of text with no full stop, or many lists, in time that grows with its size', () => {
    const run = 'you learn one trick '.repeat(50_000);
    let started = performance.now();
    expect(countOf(['Ember Knight: Tricks'], [1, run])).toEqual([
      [['Ember Knight: Tricks'], { '1': 1 }],
    ]);
    expect(performance.now() - started).toBeLessThan(5000);
    const lists = Array.from({ length: 5000 }, (_, i) => `Zq${i} Wv${i}`);
    const prose = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const fixed = Array.from({ length: 40 }, (_, i) => ({
      name: `Feature ${i}`,
      level: 1,
      entries: [prose],
    }));
    started = performance.now();
    expect(offer(storing(lists, fixed, { classFixed: fixed })).progression).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5000);
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
      '2 class options are on a list no class in this file says how many to pick from (Ember Knight: Tricks). They are in the Library under Optional features, but no character can pick them yet.',
    ]);
    // Its class's features give a number: offered, in either order.
    const learning = knight('Ember Knight', f('Trickery', 'You learn two tricks.', ''));
    expect(warnings(`${learning}${tricks}`)).toEqual([]);
    expect(warnings(`${tricks}${learning}`)).toEqual([]);
    // Of a class the file does not hold.
    expect(warnings(`${knight('Ash Warden')}${tricks}`)).toEqual([
      expect.stringMatching(/^2 class options are for a class this app cannot convert yet/),
    ]);
    // Of a class the file holds, its name tagged and marked.
    const tagged = tricks.replaceAll('Ember Knight: Tricks', 'Ember Knight (TP) [5.5e]: Tricks');
    expect(warnings(`${knight('Ember Knight')}${tagged}`)).toEqual([
      expect.stringMatching(/^2 class options are on a list no class in this file says how many/),
    ]);
    // An option a class's own list offers too is offered, whichever comes first.
    const flare =
      '<spell><name>Flare</name><level>0</level><classes>Warmage: Tricks</classes><text>A trick.</text></spell>';
    const tricky = knight('Ember Knight', `${f('Tricks: Flare')}${f('Tricks: Smoke')}`);
    expect(warnings(`${flare}${tricky}`)).toEqual([]);
    expect(warnings(`${tricky}${flare}`)).toEqual([]);
  });

  it('offers a list stored with no class name to the class its features name, not again to its subclass', () => {
    const curses = ['Hemo', 'Rot']
      .map(
        (n) =>
          `<spell><name>${n}</name><level>0</level><classes>Blood Curses</classes><text>A curse.</text></spell>`,
      )
      .join('');
    const hunter = (classText: string) => `<class><name>Ember Knight</name><hd>10</hd>
      <autolevel level="1">${f('Maledict', classText, '')}</autolevel>
      <autolevel level="3">${f('Martial Archetype', 'Choose.', '')}${f('Martial Archetype: Ash')}${f('Brand (Ash)', 'You learn one blood curse.')}</autolevel>
    </class>`;
    const offers = (classText: string) => {
      const { json, report } = convertFc5Compendium(
        parseXml(`<compendium>${curses}${hunter(classText)}</compendium>`),
        { fileName: FILE },
      );
      const of = (e: Record<string, unknown> | undefined) =>
        ((e?.optionalfeatureProgression ?? []) as Record<string, unknown>[])
          .filter((p) => (p.featureType as string[]).includes('Blood Curses'))
          .map((p) => p.progression);
      return {
        cls: of(list(json, 'class')[0]),
        sub: of(list(json, 'subclass')[0]),
        warnings: report.warnings,
      };
    };
    expect(offers('You know one blood curse.')).toEqual({
      cls: [{ '1': 1 }],
      sub: [],
      warnings: [],
    });
    expect(offers('You fight.')).toEqual({ cls: [], sub: [{ '3': 1 }], warnings: [] });
  });

  it('warns of a list stored with no class name that no class counts', () => {
    const { report } = convertFc5Compendium(
      parseXml(
        `<compendium>${knight('Ember Knight')}<spell><name>Bargain</name><level>0</level><classes>Dark Bargains</classes><text>A deal.</text></spell></compendium>`,
      ),
      { fileName: FILE },
    );
    expect(report.warnings).toEqual([
      '1 class option is on a list no class in this file says how many to pick from (Dark Bargains). It is in the Library under Optional features, but no character can pick it yet.',
    ]);
    // A list stored as a subclass's, of a subclass the file does not convert;
    // one with an author's tag is a list of no class's.
    const stored = (list: string) =>
      convertFc5Compendium(
        parseXml(
          `<compendium>${knight('Ember Knight')}${['Flare', 'Smoke']
            .map(
              (n) =>
                `<spell><name>Trick Shot: ${n}</name><level>0</level><classes>${list}</classes><text>A shot.</text></spell>`,
            )
            .join('')}</compendium>`,
        ),
        { fileName: FILE },
      ).report.warnings;
    expect(stored('Ember Knight (Order)')).toEqual([
      expect.stringMatching(/^2 class options are for a class this app cannot convert yet/),
    ]);
    expect(stored('Combo Actions (Ryoko)')).toEqual([
      expect.stringMatching(/^2 class options are on a list no class in this file says how many/),
    ]);
    const shots = { report: { warnings: stored('Fighter (Gunslinger)') } };
    expect(shots.report.warnings).toEqual([
      expect.stringMatching(
        /^2 class options are for a class this app cannot convert yet \(Fighter \(Gunslinger\)\)/,
      ),
    ]);
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

  it('gives an option the file stores the spells a class reads from its copy, in either order', () => {
    const hex =
      '<spell><name>Hex Sight</name><level>0</level><classes>Eldritch Invocations</classes><text>You see.</text></spell>';
    const caster = `<class><name>Ember Knight</name><hd>10</hd><autolevel level="2">${f('Eldritch Invocations', 'Learn two.', '')}${f('Eldritch Invocations: Hex Sight', 'You always have the hex spell prepared.')}${f('Eldritch Invocations: Ash Sight', 'S.')}</autolevel></class>`;
    for (const xml of [`${hex}${caster}`, `${caster}${hex}`]) {
      const { json } = convertFc5Compendium(parseXml(`<compendium>${xml}</compendium>`), {
        fileName: FILE,
      });
      expect(list(json, 'optionalfeature').map((o) => [o.name, o.additionalSpells])).toEqual([
        ['Hex Sight', [{ prepared: { 2: ['hex'] } }]],
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

  it('reads signs and numbers apart, and hyphens and dashes as spacing', () => {
    const style = (name: string, text: string) =>
      `<class><name>${name}</name><hd>10</hd><autolevel level="1">${f('Fighting Style', 'Adopt one.', '')}${f('Fighting Style: Archery', text)}${f('Fighting Style: Defense', 'Armor.')}</autolevel></class>`;
    const archeries = (one: string, two: string) =>
      list(
        convertFc5Compendium(
          parseXml(
            `<compendium>${style('Ember Knight', one)}${style('Ash Warden', two)}</compendium>`,
          ),
          { fileName: FILE },
        ).json,
        'optionalfeature',
      ).filter((o) => String(o.name).startsWith('Archery')).length;
    const minus = String.fromCharCode(0x2212);
    const enDash = String.fromCharCode(0x2013);
    const emDash = String.fromCharCode(0x2014);
    const apart: [string, string][] = [
      ['AC changes by +1.', 'AC changes by -1.'],
      ['A 1, 2 or 3.', 'A 12 or 3.'],
    ];
    for (const [one, two] of apart) {
      expect(archeries(one, two), `${one} | ${two}`).toBe(2);
    }
    const same: [string, string][] = [
      ['Your AC+1 here.', 'Your AC + 1 here.'],
      ['A -1 penalty.', `A ${minus}1 penalty.`],
      ['Range 1-4 feet.', `Range 1${enDash}4 feet.`],
      ['Two-weapon fighting.', 'Two weapon fighting.'],
      ['Non-magical attacks.', 'Nonmagical attacks.'],
      ['A 1st-level spell.', 'A 1st level spell.'],
      [`Reach 5 feet${emDash}or more.`, 'Reach 5 feet -- or more.'],
      ['Reach 5 feet - or more.', 'Reach 5 feet, or more.'],
    ];
    for (const [one, two] of same) {
      expect(archeries(one, two), `${one} | ${two}`).toBe(1);
    }
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
