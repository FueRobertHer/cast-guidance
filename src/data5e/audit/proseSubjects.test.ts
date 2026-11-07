import { describe, expect, it } from 'vitest';
import { normalizeDataset } from '../normalize';
import { answersFor, type JudgmentFile, judgmentKey, runJudgments, setTag } from './judgments';
import { auditProse, PROSE_SET } from './proseChecks';
import { proseSubjects, readableEntries, textHash } from './proseSubjects';

// Synthetic entities: the wording mimics the shapes the scanner reads, not any book.
const registry = normalizeDataset(
  new Map<string, unknown>(
    Object.entries({
      'races.json': {
        race: [
          {
            name: 'Testfolk',
            source: 'HB',
            entries: [
              {
                name: 'Quick Step',
                entries: [
                  'You can take the Dash action as a {@variantrule Bonus Action|XPHB|Bonus Action}.',
                ],
              },
              // Curated by name (`trait:hare-trigger`), so the engine never scans it.
              { name: 'Hare-Trigger', entries: ['You add a bonus to initiative.'] },
              { name: 'Empty Trait', entries: [] },
              'An unnamed paragraph is not a trait.',
            ],
          },
          // A second printing with the same trait prose shares one subject.
          {
            name: 'Testfolk Reprint',
            source: 'HB2',
            entries: [
              {
                name: 'Quick Step',
                entries: [
                  'You can take the Dash action as a {@variantrule Bonus Action|XPHB|Bonus Action}.',
                ],
              },
            ],
          },
        ],
      },
      'feats.json': {
        feat: [
          // Curated as `alert|phb`.
          { name: 'Alert', source: 'PHB', entries: ['Always on guard.'] },
          {
            name: 'Lucky Charm',
            source: 'HB',
            entries: [
              'You can use this feature twice, and regain its uses when you finish a long rest.',
            ],
          },
        ],
      },
      'class/class-testclass.json': {
        class: [{ name: 'Testclass', source: 'HB' }],
        classFeature: [
          {
            name: 'Surge',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            level: 2,
            entries: ['As a reaction, you push back.'],
          },
        ],
        subclass: [
          {
            name: 'Path of Tests',
            shortName: 'Tests',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
          },
        ],
        subclassFeature: [
          {
            name: 'Probe',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            subclassShortName: 'Tests',
            subclassSource: 'HB',
            level: 3,
            entries: ['You notice things.'],
          },
        ],
      },
    }),
  ),
);

describe('readableEntries', () => {
  it('keeps case and leads named sub-entries with their name', () => {
    const text = readableEntries([
      'Choose one:',
      { type: 'list', items: [{ type: 'item', name: 'Longtooth', entries: ['You bite.'] }] },
    ]);
    expect(text).toBe('Choose one:\nLongtooth. You bite.');
  });

  it("leaves tables out by default, since a subject's identity hashes this text", () => {
    const table = { type: 'table', colLabels: ['Roll'], rows: [['1']] };
    expect(readableEntries(['Words.', table])).toBe('Words.');
    expect(readableEntries(['Words.', table], { tables: true })).toBe('Words.\nRoll\n1');
  });

  it('reads tags the given way, in table cells as well', () => {
    const entries = ['{@b A}', { type: 'table', rows: [['{@b B}', 2]] }];
    expect(readableEntries(entries, { tables: true, tagText: (t) => t.toLowerCase() })).toBe(
      '{@b a}\n{@b b} | 2',
    );
  });

  it("reads a name's tags only when a reader asks, since names are part of the hash", () => {
    const entries = [{ type: 'entries', name: '{@b Name}', entries: ['Words.'] }];
    expect(readableEntries(entries)).toBe('{@b Name}. Words.');
    expect(readableEntries(entries, { tagText: (t) => t.toLowerCase() })).toBe('{@b name}. words.');
  });

  it('reads a table cell with no usable roll by its words', () => {
    const table = { type: 'table', rows: [[{ type: 'cell', roll: null, entry: 'Sparks' }]] };
    expect(readableEntries([table], { tables: true })).toBe('Sparks');
  });

  it('shows the third part of a tag laid out as name, source, display, else the first', () => {
    expect(readableEntries(['a {@variantrule Proficiency|XPHB|Proficiency Bonus} b'])).toBe(
      'a Proficiency Bonus b',
    );
    expect(readableEntries(['{@spell bless|phb} and {@dice 1d6}'])).toBe('bless and 1d6');
    expect(readableEntries(['{@item Rope|PHB|}'])).toBe('Rope');
  });

  // The third part of each of these is a target, a chapter or a source: a judge
  // shown it reads "your class=Testclass" or "the SRC" for the words on the page.
  it.each([
    ['{@filter tester spells|spells|class=Testclass}', 'tester spells'],
    ['{@filter tester spells|spells|level=0|class=Testclass}', 'tester spells'],
    ['{@book chapter 9|HB|9}', 'chapter 9'],
    ['{@book Test Manual|HB|6|Some Section}', 'Test Manual'],
    ['{@quickref rough ground||3}', 'rough ground'],
    ['{@quickref Testcover||3||half testcover}', 'half testcover'],
    ['{@deity Testgod|Testheon|HB}', 'Testgod'],
    ['{@classFeature Surge|Testclass|HB|2|HB}', 'Surge'],
    ['{@subclassFeature Probe|Testclass|HB|Tests|HB|3|HB}', 'Probe'],
    ['{@subclass Tests|Testclass|HB|HB}', 'Tests'],
  ])('reads %s by its display text', (tagged, words) => {
    expect(readableEntries([tagged])).toBe(words);
  });

  it('reads a tag inside a tag whole', () => {
    expect(readableEntries(['{@i level 2 {@variantrule test features|hb|test feature}}'])).toBe(
      'level 2 test feature',
    );
  });
});

describe('textHash', () => {
  it('is stable, fixed-width hex, and tells near-identical text apart', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});

describe('proseSubjects', () => {
  const subjects = proseSubjects(registry);
  const named = (name: string) => subjects.filter((s) => s.name === name);

  it('lists every scanned kind of trait and feature, labelled by owner', () => {
    expect(subjects.map((s) => s.label)).toEqual([
      'Quick Step (Testfolk|HB)',
      'Hare-Trigger (Testfolk|HB)',
      'Surge (Testclass|HB)',
      'Probe (Testclass: Path of Tests|HB)',
      'Alert (feat|PHB)',
      'Lucky Charm (feat|HB)',
    ]);
  });

  it('collapses identical prose into one subject, counting its owners', () => {
    const [step] = named('Quick Step');
    expect(named('Quick Step')).toHaveLength(1);
    expect(step?.owners).toBe(2);
    expect(step?.state).toBe('Quick Step\nYou can take the Dash action as a Bonus Action.');
    expect(step?.key).toBe(textHash(step?.state ?? ''));
  });

  it('marks what the engine handles from the curated table', () => {
    expect(named('Hare-Trigger')[0]?.curated).toBe(true);
    expect(named('Alert')[0]?.curated).toBe(true);
    expect(named('Lucky Charm')[0]?.curated).toBe(false);
  });

  it("records the scanner's own output", () => {
    expect(named('Quick Step')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'bonus' }),
    );
    expect(named('Surge')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'reaction' }),
    );
    expect(named('Lucky Charm')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', max: 2, resetOn: 'long' }),
    );
    expect(named('Probe')[0]?.effects).toEqual([]);
  });
});

describe('structuredLimit', () => {
  const SPELLS = {
    'spells/spells-test.json': {
      spell: [
        { name: 'Test Bolt', source: 'HB', level: 1 },
        { name: 'Test Ward', source: 'HB', level: 2 },
        { name: 'Test Spark', source: 'HB', level: 0 },
      ],
    },
  };
  /** The words name the spells by tag, and carry no limit the scanner would read. */
  const words = (...spells: string[]) => [
    `You can draw on ${spells.map((s) => `{@spell ${s}}`).join(' and ')} with this.`,
  ];
  const trait = (name: string, ...spells: string[]) => ({ name, entries: words(...spells) });
  const race = (name: string, additionalSpells: unknown, entries: unknown[]) => ({
    name,
    source: 'HB',
    additionalSpells,
    entries,
  });
  const races = (...race: unknown[]) => ({ 'races.json': { race } });
  const feat = (name: string, additionalSpells: unknown, entries = ['You gain this feat.']) => ({
    'feats.json': { feat: [{ name, source: 'HB', additionalSpells, entries }] },
  });
  const daily = (...spells: unknown[]) => ({ _: { daily: { '1e': spells } } });
  const limited = (...spells: unknown[]) => [{ ability: 'int', innate: daily(...spells) }];
  const free = (...spells: string[]) => [{ ability: 'int', known: { _: spells } }];

  const subjectsOf = (bodies: Record<string, unknown>) =>
    proseSubjects(normalizeDataset(new Map(Object.entries({ ...SPELLS, ...bodies }))));
  const named = (bodies: Record<string, unknown>, name: string) => {
    const found = subjectsOf(bodies).find((s) => s.name === name);
    if (found === undefined) throw new Error(`no subject named ${name}`);
    return found;
  };
  const limitOf = (bodies: Record<string, unknown>, name: string) =>
    named(bodies, name).structuredLimit;

  it('holds when the engine gives the owner a pool on a spell the prose names', () => {
    expect(
      limitOf(
        races(race('Folk', limited('test bolt|hb'), [trait('Bolt Trait', 'test bolt|hb')])),
        'Bolt Trait',
      ),
    ).toBe(true);
  });

  it('holds for a pool that refills on a rest, and past a level gate', () => {
    const block = [{ ability: 'int', innate: { 5: { rest: { 1: ['test bolt|hb'] } } } }];
    expect(
      limitOf(races(race('Folk', block, [trait('Bolt Trait', 'test bolt|hb')])), 'Bolt Trait'),
    ).toBe(true);
  });

  it('matches a tag and a block whatever their case, source or hint', () => {
    expect(
      limitOf(
        races(
          race('Folk', limited('Test Bolt|HB#2'), [trait('Bolt Trait', 'TEST BOLT|xphb|bolt')]),
        ),
        'Bolt Trait',
      ),
    ).toBe(true);
  });

  it('holds once the ability the grant waits on is answered', () => {
    const block = [
      { ability: { choose: ['int', 'wis'] }, innate: { _: { daily: { 1: ['test bolt|hb'] } } } },
    ];
    expect(
      limitOf(races(race('Folk', block, [trait('Bolt Trait', 'test bolt|hb')])), 'Bolt Trait'),
    ).toBe(true);
  });

  it('adds nothing to what the scanner drew, or to what a judge read', () => {
    const [bolt] = subjectsOf(
      races(race('Folk', limited('test bolt|hb'), [trait('Bolt Trait', 'test bolt|hb')])),
    );
    expect(bolt?.effects).toEqual([]);
    expect(bolt?.state).toBe('Bolt Trait\nYou can draw on test bolt with this.');
    expect(bolt?.key).toBe(textHash(bolt?.state ?? ''));
  });

  it('is off when the block has no limit for the spell', () => {
    expect(
      limitOf(
        races(race('Folk', free('test bolt|hb'), [trait('Bolt Trait', 'test bolt|hb')])),
        'Bolt Trait',
      ),
    ).toBe(false);
  });

  it('is off for a limit the engine does not keep, written inside a known list', () => {
    const block = [{ ability: 'int', known: { _: { rest: { 1: ['test bolt|hb'] } } } }];
    expect(
      limitOf(races(race('Folk', block, [trait('Bolt Trait', 'test bolt|hb')])), 'Bolt Trait'),
    ).toBe(false);
  });

  it("is off when the owner's pool is on a spell the prose does not name", () => {
    const bodies = races(
      race('Folk', limited('test ward|hb'), [
        trait('Bolt Trait', 'test bolt|hb'),
        { name: 'Other Trait', entries: ['You can steady yourself with this.'] },
      ]),
    );
    expect(limitOf(bodies, 'Bolt Trait')).toBe(false);
    expect(limitOf(bodies, 'Other Trait')).toBe(false);
  });

  it('is off for a spell the prose only says in words, since tags are the evidence', () => {
    const bodies = races(
      race('Folk', limited('test bolt|hb'), [
        { name: 'Worded Trait', entries: ['You can draw on test bolt with this.'] },
      ]),
    );
    expect(limitOf(bodies, 'Worded Trait')).toBe(false);
  });

  it('is off when an owner has no block', () => {
    expect(limitOf(feat('Plain Feat', undefined), 'Plain Feat')).toBe(false);
  });

  describe('for the owners the engine reads and does not', () => {
    const classFile = (extra: Record<string, unknown>) => ({
      'class/class-testclass.json': {
        class: [{ name: 'Testclass', source: 'HB', classFeatures: [], ...extra }],
        classFeature: [
          {
            name: 'Class Bolt',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            level: 1,
            entries: words('test bolt|hb'),
          },
        ],
        subclass: [
          {
            name: 'Path of Tests',
            shortName: 'Tests',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            additionalSpells: [{ innate: { 3: { daily: { '1e': ['test ward|hb'] } } } }],
            subclassFeatures: [],
          },
        ],
        subclassFeature: [
          {
            name: 'Path Ward',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            subclassShortName: 'Tests',
            subclassSource: 'HB',
            level: 3,
            entries: words('test ward|hb'),
          },
        ],
      },
    });

    it('holds for a subclass feature, from its subclass', () => {
      expect(limitOf(classFile({}), 'Path Ward')).toBe(true);
    });

    it("is off for a spell a class's own block names, which the engine does not grant", () => {
      const own = { additionalSpells: [{ prepared: { 1: { daily: { 2: ['test bolt|hb'] } } } }] };
      expect(limitOf(classFile(own), 'Class Bolt')).toBe(false);
    });

    it('is off for an optional feature, whose block the engine does not read', () => {
      const option = {
        name: 'Bolt Option',
        source: 'HB',
        featureType: ['EI'],
        additionalSpells: limited('test bolt|hb'),
        entries: words('test bolt|hb'),
      };
      expect(
        limitOf({ 'optionalfeatures.json': { optionalfeature: [option] } }, 'Bolt Option'),
      ).toBe(false);
    });

    const subrace = (additionalSpells: unknown) => ({
      name: 'Kin',
      source: 'HB',
      raceName: 'Folk',
      raceSource: 'HB',
      additionalSpells,
      entries: [trait('Kin Trait', 'test bolt|hb')],
    });

    it("holds for a subrace's trait, from its own block or its race's", () => {
      const own = {
        'races.json': {
          race: [race('Folk', undefined, [])],
          subrace: [subrace(limited('test bolt|hb'))],
        },
      };
      const parent = {
        'races.json': {
          race: [race('Folk', limited('test bolt|hb'), [])],
          subrace: [subrace(undefined)],
        },
      };
      expect(limitOf(own, 'Kin Trait')).toBe(true);
      expect(limitOf(parent, 'Kin Trait')).toBe(true);
    });
  });

  describe('when owners share the prose', () => {
    const entries = () => [trait('Shared Trait', 'test bolt|hb')];

    it('is off unless every owner has the pool, in either order', () => {
      const tracked = race('Tracked', limited('test bolt|hb'), entries());
      const bare = race('Bare', undefined, entries());
      const unlimited = race('Unlimited', free('test bolt|hb'), entries());
      for (const owners of [
        [tracked, bare],
        [bare, tracked],
        [tracked, unlimited],
        [unlimited, tracked],
      ]) {
        const [shared] = subjectsOf(races(...owners));
        expect(shared?.owners).toBe(2);
        expect(shared?.structuredLimit).toBe(false);
      }
    });

    it('holds when every owner has one', () => {
      const [shared] = subjectsOf(
        races(
          race('One', limited('test bolt|hb'), entries()),
          race('Two', limited('test bolt'), entries()),
        ),
      );
      expect(shared?.owners).toBe(2);
      expect(shared?.structuredLimit).toBe(true);
    });
  });

  describe('when the prose names several spells', () => {
    const named = (block: unknown, ...spells: string[]) =>
      limitOf(races(race('Folk', block, [trait('Two Spells', ...spells)])), 'Two Spells');

    it('is off when the sheet leaves a leveled one free, tracking only part of the limit', () => {
      const block = [
        { ability: 'int', known: { _: ['test bolt|hb'] }, innate: daily('test ward|hb') },
      ];
      expect(named(block, 'test bolt|hb', 'test ward|hb')).toBe(false);
    });

    it('holds beside a cantrip, which is free by its nature', () => {
      const block = [
        { ability: 'int', known: { _: ['test spark|hb'] }, innate: daily('test ward|hb') },
      ];
      expect(named(block, 'test spark|hb', 'test ward|hb')).toBe(true);
    });

    it('looks a free cantrip up when its block names no source', () => {
      const block = [
        { ability: 'int', known: { _: ['test spark#c'] }, innate: daily('test ward|hb') },
      ];
      expect(named(block, 'test spark', 'test ward|hb')).toBe(true);
    });

    it('takes a free spell it cannot look up as leveled', () => {
      const block = [
        { ability: 'int', known: { _: ['no such spell'] }, innate: daily('test ward|hb') },
      ];
      expect(named(block, 'no such spell', 'test ward|hb')).toBe(false);
    });

    it('holds for a spell both prepared for slots and limited for free casts', () => {
      const block = [{ ability: 'int', prepared: { _: { daily: { 1: ['test ward|hb'] } } } }];
      expect(named(block, 'test ward|hb')).toBe(true);
    });

    it('ignores a spell the prose names that the owner never grants', () => {
      expect(named(limited('test ward|hb'), 'test bolt|hb', 'test ward|hb')).toBe(true);
    });
  });

  describe("for a pick, which the prose can't name", () => {
    const pick = [{ ability: 'int', innate: { _: { daily: { 1: [{ choose: 'level=1' }] } } } }];
    const listed = [
      {
        ability: 'int',
        innate: { _: { daily: { 1: [{ choose: { from: ['test bolt|hb', 'test ward|hb'] } }] } } },
      },
    ];

    it('holds on a feat, whose prose is all there is of it', () => {
      expect(limitOf(feat('Pick Feat', pick), 'Pick Feat')).toBe(true);
      expect(limitOf(feat('List Feat', listed), 'List Feat')).toBe(true);
    });

    it('is off on a trait, which shares its block with the rest of the race', () => {
      expect(
        limitOf(races(race('Folk', pick, [trait('Bolt Trait', 'test bolt|hb')])), 'Bolt Trait'),
      ).toBe(false);
    });

    it('holds on a feat with a free pick ahead of its limited one', () => {
      const both = [
        {
          ability: 'int',
          prepared: {
            _: { will: [{ choose: 'level=1' }], daily: { 1: [{ choose: 'level=2' }] } },
          },
        },
      ];
      expect(limitOf(feat('Two Picks', both), 'Two Picks')).toBe(true);
    });

    it('is off on a feat whose pick has no limit', () => {
      const unlimited = [{ ability: 'int', known: { _: [{ choose: 'level=1' }] } }];
      expect(limitOf(feat('Free Pick', unlimited), 'Free Pick')).toBe(false);
    });
  });

  describe('for a block with branches', () => {
    const branch = (name: string, spell: string, limit: boolean) => ({
      name,
      ability: 'int',
      ...(limit ? { innate: daily(spell) } : { known: { _: [spell] } }),
    });

    it('holds when every branch gives a pool', () => {
      const block = [branch('Sun', 'test bolt|hb', true), branch('Moon', 'test ward|hb', true)];
      expect(limitOf(feat('Branch Feat', block), 'Branch Feat')).toBe(true);
    });

    it('is off when any branch does not, whatever the order', () => {
      const yes = branch('Sun', 'test bolt|hb', true);
      const no = branch('Moon', 'test ward|hb', false);
      expect(limitOf(feat('Branch Feat', [yes, no]), 'Branch Feat')).toBe(false);
      expect(limitOf(feat('Branch Feat', [no, yes]), 'Branch Feat')).toBe(false);
    });
  });

  describe('structuredShortRest', () => {
    const perRest = (spell: unknown) => [
      { ability: 'int', innate: { _: { rest: { 1: [spell] } } } },
    ];
    const shortOf = (bodies: Record<string, unknown>, name: string) =>
      named(bodies, name).structuredShortRest;

    it('reads the rest that refills the pool', () => {
      const bodies = races(
        race('Folk', perRest('test bolt|hb'), [trait('Short Trait', 'test bolt|hb')]),
        race('Others', limited('test ward|hb'), [trait('Long Trait', 'test ward|hb')]),
      );
      expect(limitOf(bodies, 'Short Trait')).toBe(true);
      expect(shortOf(bodies, 'Short Trait')).toBe(true);
      expect(limitOf(bodies, 'Long Trait')).toBe(true);
      expect(shortOf(bodies, 'Long Trait')).toBe(false);
    });

    it('reads only the pools on spells the prose names', () => {
      const block = [
        {
          ability: 'int',
          innate: { _: { daily: { 1: ['test bolt|hb'] }, rest: { 1: ['test ward|hb'] } } },
        },
      ];
      const bodies = races(
        race('Folk', block, [
          trait('Long Trait', 'test bolt|hb'),
          trait('Short Trait', 'test ward|hb'),
          trait('Both Trait', 'test bolt|hb', 'test ward|hb'),
        ]),
      );
      expect(shortOf(bodies, 'Long Trait')).toBe(false);
      expect(shortOf(bodies, 'Short Trait')).toBe(true);
      expect(shortOf(bodies, 'Both Trait')).toBe(true);
    });

    it('reads the refill the sheet keeps when one pool is written with two', () => {
      const bothOf = (first: string, second: string) =>
        races(
          race(
            'Folk',
            [
              {
                ability: 'int',
                innate: { _: { [first]: { 1: ['test bolt|hb'] } } },
                prepared: { _: { [second]: { 1: ['test bolt|hb'] } } },
              },
            ],
            [trait('Bolt Trait', 'test bolt|hb')],
          ),
        );
      expect(shortOf(bothOf('daily', 'rest'), 'Bolt Trait')).toBe(false);
      expect(shortOf(bothOf('rest', 'daily'), 'Bolt Trait')).toBe(true);
    });

    it("reads a feat's pick, which is the feat's", () => {
      expect(shortOf(feat('Pick Feat', perRest({ choose: 'level=1' })), 'Pick Feat')).toBe(true);
    });

    it('needs it of every owner, in either order', () => {
      const short = race('Folk', perRest('test bolt|hb'), [trait('Bolt Trait', 'test bolt|hb')]);
      const long = race('Others', limited('test bolt|hb'), [trait('Bolt Trait', 'test bolt|hb')]);
      expect(shortOf(races(short, long), 'Bolt Trait')).toBe(false);
      expect(shortOf(races(long, short), 'Bolt Trait')).toBe(false);
      expect(limitOf(races(short, long), 'Bolt Trait')).toBe(true);
    });

    it('needs it of every branch, in either order', () => {
      const short = { name: 'Sun', ...perRest('test bolt|hb')[0] };
      const long = { name: 'Moon', ...limited('test ward|hb')[0] };
      expect(shortOf(feat('Branch Feat', [short, long]), 'Branch Feat')).toBe(false);
      expect(shortOf(feat('Branch Feat', [long, short]), 'Branch Feat')).toBe(false);
      expect(limitOf(feat('Branch Feat', [short, long]), 'Branch Feat')).toBe(true);
    });

    it('keeps a pool on the wrong rest counted in the audit', () => {
      const subjects = subjectsOf(
        races(
          race('Folk', limited('test bolt|hb'), [trait('Long Trait', 'test bolt|hb')]),
          race('Others', perRest('test ward|hb'), [trait('Short Trait', 'test ward|hb')]),
        ),
      );
      const ids = PROSE_SET.questions.map((q) => q.id);
      const yes = ['limitedUses', 'shortRest'];
      const sure = { label: 'saved', p: ids.map((id) => (yes.includes(id) ? 0.95 : 0.05)) };
      const file: JudgmentFile = {
        sets: { [setTag(PROSE_SET)]: ids },
        judgments: Object.fromEntries(subjects.map((s) => [judgmentKey(PROSE_SET, s.key), sure])),
      };
      const audit = auditProse(subjects, file);
      expect(audit.disagreements.map((d) => d.label)).toEqual(['Long Trait (Folk|HB)']);
      expect(audit.byCheck).toEqual({ 'limitedUses: missed': 1 });
    });
  });

  it('settles only the tracked subject in the audit', () => {
    const subjects = subjectsOf(
      races(
        race('Folk', limited('test bolt|hb'), [trait('Tracked Trait', 'test bolt|hb')]),
        race('Others', free('test ward|hb'), [trait('Untracked Trait', 'test ward|hb')]),
      ),
    );
    const ids = PROSE_SET.questions.map((q) => q.id);
    const sure = { label: 'saved', p: ids.map((id) => (id === 'limitedUses' ? 0.95 : 0.05)) };
    const file: JudgmentFile = {
      sets: { [setTag(PROSE_SET)]: ids },
      judgments: Object.fromEntries(subjects.map((s) => [judgmentKey(PROSE_SET, s.key), sure])),
    };
    const audit = auditProse(subjects, file);
    expect(audit.judged).toBe(2);
    expect(audit.disagreements.map((d) => d.label)).toEqual(['Untracked Trait (Others|HB)']);
    expect(audit.byCheck).toEqual({ 'limitedUses: missed': 1 });
  });
});

describe('saved answers across a change in how tags read', () => {
  const feat = (name: string, line: string) => ({ name, source: 'HB', entries: [line] });
  const subjects = proseSubjects(
    normalizeDataset(
      new Map<string, unknown>([
        [
          'feats.json',
          {
            feat: [
              feat('Plain Trait', 'You push back with no tags at all.'),
              feat(
                'Same Either Way',
                'As a {@variantrule Bonus Action|XPHB|Bonus Action}, roll {@dice 1d6} and name {@spell testbolt|HB}.',
              ),
              feat('Filter Trait', 'Pick from the {@filter tester spells|spells|class=Testclass}.'),
            ],
          },
        ],
      ]),
    ),
  );
  const subject = (name: string) => {
    const found = subjects.find((s) => s.name === name);
    if (found === undefined) throw new Error(`no subject named ${name}`);
    return found;
  };

  // Literals, taken from the reader that showed a tag's third part. A saved
  // answer is filed under these, so they hold whatever the reader becomes: if
  // one moves, every answer on prose like it goes unread and is asked again.
  const PLAIN_KEY = '10899455b1efc3';
  const SAME_KEY = '1efd76a16f8569';
  const GARBLED_KEY = '0d8e3981190e01';

  it('keeps the key of prose whose words did not change', () => {
    expect(subject('Plain Trait').key).toBe(PLAIN_KEY);
    expect(subject('Same Either Way').key).toBe(SAME_KEY);
  });

  it('moves the key of prose a judge read garbled, so its answer is not reused', () => {
    expect(textHash('Filter Trait\nPick from the class=Testclass.')).toBe(GARBLED_KEY);
    expect(subject('Filter Trait').state).toBe('Filter Trait\nPick from the tester spells.');
    expect(subject('Filter Trait').key).not.toBe(GARBLED_KEY);
  });

  it('asks again about only the prose that moved, and keeps every saved answer', async () => {
    const answer = { label: 'saved', p: PROSE_SET.questions.map(() => 0.5) };
    const file: JudgmentFile = {
      sets: { [setTag(PROSE_SET)]: PROSE_SET.questions.map((q) => q.id) },
      judgments: {
        [judgmentKey(PROSE_SET, PLAIN_KEY)]: answer,
        [judgmentKey(PROSE_SET, SAME_KEY)]: answer,
        [judgmentKey(PROSE_SET, GARBLED_KEY)]: answer,
      },
    };
    expect(answersFor(file, PROSE_SET, subject('Filter Trait').key)).toBeUndefined();

    const asked: string[] = [];
    const result = await runJudgments({
      set: PROSE_SET,
      subjects,
      file,
      ask: async ({ state, questions }) => {
        asked.push(state);
        return Object.fromEntries(questions.map((q) => [q.id, 0.9]));
      },
    });

    expect(asked).toEqual(['Filter Trait\nPick from the tester spells.']);
    expect(result.alreadyJudged).toBe(2);
    expect(answersFor(file, PROSE_SET, subject('Filter Trait').key)?.bonusAction).toBe(0.9);
    expect(file.judgments[judgmentKey(PROSE_SET, PLAIN_KEY)]).toEqual(answer);
    expect(file.judgments[judgmentKey(PROSE_SET, SAME_KEY)]).toEqual(answer);
    // The answer given on the garbled text stays in the file, read by nothing.
    expect(file.judgments[judgmentKey(PROSE_SET, GARBLED_KEY)]).toEqual(answer);
  });
});
