/**
 * Subclass features that grant skills and double them with nothing structured
 * in the data, end to end through `deriveSheet`. The world has the names, levels
 * and ref strings of the pinned release, and placeholder prose.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { pruneChoicesFor } from '../../lib/pruneChoices';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../types';
import { emitCuratedEffects } from './curatedEffects';

const PROSE = ['Placeholder text.'];

const subclass = (
  name: string,
  shortName: string,
  source: string,
  className: string,
  classSource: string,
  feature: string,
  level: number,
): DataEntity => ({
  name,
  shortName,
  source,
  className,
  classSource,
  subclassFeatures: [`${feature}|${className}|${classSource}|${shortName}|${source}|${level}`],
});

const subclassFeature = (
  name: string,
  shortName: string,
  source: string,
  className: string,
  classSource: string,
  level: number,
  entries: unknown[] = PROSE,
): DataEntity => ({
  name,
  source,
  className,
  classSource,
  subclassShortName: shortName,
  subclassSource: source,
  level,
  entries,
});

const refTo = (feature: string) => ({
  type: 'refSubclassFeature',
  subclassFeature: `${feature}|Cleric||Knowledge||1`,
});

const WORLD: Record<string, DataEntity[]> = {
  class: [
    { name: 'Rogue', source: 'PHB', hd: { number: 1, faces: 8 }, classFeatures: [] },
    { name: 'Rogue', source: 'XPHB', hd: { number: 1, faces: 8 }, classFeatures: [] },
    { name: 'Fighter', source: 'PHB', hd: { number: 1, faces: 10 }, classFeatures: [] },
    {
      name: 'Fighter',
      source: 'XPHB',
      hd: { number: 1, faces: 10 },
      classFeatures: [],
      startingProficiencies: {
        skills: [{ choose: { from: ['athletics', 'insight', 'persuasion'], count: 2 } }],
      },
    },
    { name: 'Cleric', source: 'PHB', hd: { number: 1, faces: 8 }, classFeatures: [] },
    { name: 'Cleric', source: 'XPHB', hd: { number: 1, faces: 8 }, classFeatures: [] },
  ],
  subclass: [
    subclass('Scout', 'Scout', 'XGE', 'Rogue', 'PHB', 'Survivalist', 3),
    subclass('Wanderer', 'Wanderer', 'XGE', 'Rogue', 'PHB', 'Survivalist', 3),
    subclass(
      'Purple Dragon Knight (Banneret)',
      'Purple Dragon Knight (Banneret)',
      'SCAG',
      'Fighter',
      'PHB',
      'Royal Envoy',
      7,
    ),
    subclass('Knowledge Domain', 'Knowledge', 'PHB', 'Cleric', 'PHB', 'Blessings of Knowledge', 1),
    subclass(
      'Knowledge Domain',
      'Knowledge',
      'FRHoF',
      'Cleric',
      'XPHB',
      'Blessings of Knowledge',
      3,
    ),
    subclass(
      'Knowledge Domain (PSA)',
      'Knowledge (PSA)',
      'PSA',
      'Cleric',
      'PHB',
      'Knowledge Domain (PSA)',
      1,
    ),
  ],
  subclassFeature: [
    subclassFeature('Survivalist', 'Scout', 'XGE', 'Rogue', 'PHB', 3),
    subclassFeature('Survivalist', 'Wanderer', 'XGE', 'Rogue', 'PHB', 3),
    subclassFeature('Royal Envoy', 'Purple Dragon Knight (Banneret)', 'SCAG', 'Fighter', 'PHB', 7),
    subclassFeature('Blessings of Knowledge', 'Knowledge', 'PHB', 'Cleric', 'PHB', 1),
    subclassFeature('Blessings of Knowledge', 'Knowledge', 'FRHoF', 'Cleric', 'XPHB', 3),
    // The PSA domain reaches the 2014 feature through two references, as in the release.
    subclassFeature('Knowledge Domain', 'Knowledge', 'PHB', 'Cleric', 'PHB', 1, [
      refTo('Blessings of Knowledge'),
    ]),
    subclassFeature('Knowledge Domain (PSA)', 'Knowledge (PSA)', 'PSA', 'Cleric', 'PHB', 1, [
      refTo('Knowledge Domain'),
    ]),
  ],
  background: [
    {
      name: 'Courtier',
      source: 'TEST',
      skillProficiencies: [{ persuasion: true, history: true }],
    },
    { name: 'Hermit', source: 'TEST', skillProficiencies: [{ nature: true, medicine: true }] },
    { name: 'Sailor', source: 'TEST', skillProficiencies: [{ athletics: true }] },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? [])),
};

const ROGUE = { name: 'Rogue', source: 'PHB' };
const FIGHTER = { name: 'Fighter', source: 'PHB' };
const SCOUT = { name: 'Scout', source: 'XGE' };
const BANNERET = { name: 'Purple Dragon Knight (Banneret)', source: 'SCAG' };
const KNOWLEDGE = { name: 'Knowledge Domain', source: 'PHB' };
const KNOWLEDGE_2024 = { name: 'Knowledge Domain', source: 'FRHoF' };
const KNOWLEDGE_PSA = { name: 'Knowledge Domain (PSA)', source: 'PSA' };

const PICK_2014 = 'subclass:knowledge domain|phb:skill:blessings of knowledge';
const PICK_2024 = 'subclass:knowledge domain|frhof:skill:blessings of knowledge';
const PICK_PSA = 'subclass:knowledge domain (psa)|psa:skill:blessings of knowledge';
const ENVOY_PICK = 'subclass:purple dragon knight (banneret)|scag:skill:royal envoy';
const FIGHTER_PICK = 'class:fighter|xphb:skill:0';

/** STR 10, DEX 14, CON 10, INT 16, WIS 12, CHA 8. */
function build(
  cls: EntityRef,
  levels: number,
  opts: {
    subclass?: EntityRef;
    background?: string;
    choices?: CharacterDoc['choices'];
  } = {},
): CharacterDoc {
  const doc = newCharacterDoc('s', 'Skills', 't');
  doc.abilities = {
    method: 'manual',
    base: { str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 8 },
  };
  doc.classes = [
    { ref: cls, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') },
  ];
  if (opts.background !== undefined) doc.background = { name: opts.background, source: 'TEST' };
  doc.choices = { ...opts.choices };
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const prof = (sheet: DerivedSheet, skill: string) => sheet.skills[skill]?.prof;
const total = (sheet: DerivedSheet, skill: string) => sheet.skills[skill]?.total.value;
const pendingIds = (sheet: DerivedSheet) => sheet.pending.map((p) => p.id);

describe('Survivalist', () => {
  it('doubles both of its skills, with no pick to make', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: SCOUT }));
    expect(prof(sheet, 'Nature')).toBe(2);
    expect(prof(sheet, 'Survival')).toBe(2);
    // INT +3 and WIS +1, each with twice a proficiency bonus of 2.
    expect(total(sheet, 'Nature')).toBe(7);
    expect(total(sheet, 'Survival')).toBe(5);
    expect(sheet.skills.Nature?.total.parts).toContainEqual({
      label: 'Survivalist (expertise)',
      amount: 4,
    });
    expect(pendingIds(sheet)).toEqual([]);
  });

  it('is the same under the 2024 rogue', () => {
    const sheet = derive(build({ name: 'Rogue', source: 'XPHB' }, 3, { subclass: SCOUT }));
    expect(prof(sheet, 'Nature')).toBe(2);
    expect(prof(sheet, 'Survival')).toBe(2);
  });

  it('touches no other skill', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: SCOUT }));
    expect(prof(sheet, 'Stealth')).toBe(0);
    expect(prof(sheet, 'Arcana')).toBe(0);
  });

  it('waits for its level and for the subclass', () => {
    expect(prof(derive(build(ROGUE, 2, { subclass: SCOUT })), 'Nature')).toBe(0);
    expect(prof(derive(build(ROGUE, 3)), 'Nature')).toBe(0);
  });

  it('belongs to the Scout alone, whatever another subclass calls a feature', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: { name: 'Wanderer', source: 'XGE' } }));
    expect(prof(sheet, 'Nature')).toBe(0);
  });

  it('doubles a skill the character already had, and asks for nothing in its place', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: SCOUT, background: 'Hermit' }));
    expect(prof(sheet, 'Nature')).toBe(2);
    expect(prof(sheet, 'Medicine')).toBe(1);
    expect(pendingIds(sheet)).toEqual([]);
  });

  it('counts as a source for another pick, not only as expertise', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: SCOUT, background: 'Hermit' }));
    const beside = sheet.skills.Nature?.sourcesBesideBackground.map((o) => o.label);
    expect(beside).toEqual(['Survivalist']);
  });
});

describe('Royal Envoy', () => {
  it('grants and doubles Persuasion, and asks for nothing when it is new', () => {
    const sheet = derive(build(FIGHTER, 7, { subclass: BANNERET }));
    expect(prof(sheet, 'Persuasion')).toBe(2);
    // CHA -1, with twice a proficiency bonus of 3.
    expect(total(sheet, 'Persuasion')).toBe(5);
    expect(pendingIds(sheet)).not.toContain(ENVOY_PICK);
  });

  it('waits for its level', () => {
    expect(prof(derive(build(FIGHTER, 6, { subclass: BANNERET })), 'Persuasion')).toBe(0);
  });

  it('still doubles Persuasion the fighter had, and opens a pick of another skill', () => {
    const sheet = derive(build(FIGHTER, 7, { subclass: BANNERET, background: 'Courtier' }));
    expect(prof(sheet, 'Persuasion')).toBe(2);
    const prompt = sheet.pending.find((p) => p.id === ENVOY_PICK);
    expect(prompt).toMatchObject({
      kind: 'skill',
      count: 1,
      // The class card and a subclass swap both find the pick by this.
      origin: { type: 'subclass', uid: 'purple dragon knight (banneret)|scag' },
    });
    expect(prompt?.options.map((o) => o.id)).toEqual([
      'Animal Handling',
      'Insight',
      'Intimidation',
      'Performance',
    ]);
  });

  it('opens that pick when the fighter took Persuasion from its own class list', () => {
    const sheet = derive(
      build({ name: 'Fighter', source: 'XPHB' }, 7, {
        subclass: BANNERET,
        choices: { [FIGHTER_PICK]: ['Athletics', 'Persuasion'] },
      }),
    );
    expect(prof(sheet, 'Persuasion')).toBe(2);
    expect(pendingIds(sheet)).toEqual([ENVOY_PICK]);
  });

  it('opens no pick when the class list went on other skills', () => {
    const sheet = derive(
      build({ name: 'Fighter', source: 'XPHB' }, 7, {
        subclass: BANNERET,
        choices: { [FIGHTER_PICK]: ['Athletics', 'Insight'] },
      }),
    );
    expect(prof(sheet, 'Persuasion')).toBe(2);
    expect(pendingIds(sheet)).toEqual([]);
  });

  it('leaves that proficiency to Courtier, the source it came from', () => {
    const sheet = derive(build(FIGHTER, 7, { subclass: BANNERET, background: 'Courtier' }));
    expect(sheet.skills.Persuasion?.sourcesBesideBackground).toEqual([]);
  });

  it('gives the other skill plain proficiency, not expertise', () => {
    const sheet = derive(
      build(FIGHTER, 7, {
        subclass: BANNERET,
        background: 'Courtier',
        choices: { [ENVOY_PICK]: ['Insight'] },
      }),
    );
    expect(prof(sheet, 'Insight')).toBe(1);
    expect(prof(sheet, 'Intimidation')).toBe(0);
    expect(pendingIds(sheet)).not.toContain(ENVOY_PICK);
  });

  it('opens no pick for a proficiency in some other skill', () => {
    const sheet = derive(build(FIGHTER, 7, { subclass: BANNERET, background: 'Sailor' }));
    expect(prof(sheet, 'Athletics')).toBe(1);
    expect(pendingIds(sheet)).not.toContain(ENVOY_PICK);
  });

  it('ignores a saved pick once Persuasion is no longer otherwise proficient', () => {
    const sheet = derive(
      build(FIGHTER, 7, { subclass: BANNERET, choices: { [ENVOY_PICK]: ['Insight'] } }),
    );
    expect(prof(sheet, 'Insight')).toBe(0);
    expect(prof(sheet, 'Persuasion')).toBe(2);
    expect(sheet.warnings).toEqual([]);
  });

  it('knows a proficiency however a source spells the skill', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), ctx);
    const origin = { label: 'Royal Envoy', uid: 'x|y', type: 'subclass' } as const;
    col.add({ kind: 'skillProf', skill: 'persuasion', level: 1, origin });
    emitCuratedEffects(col, 'royal envoy|purple dragon knight (banneret)', origin);
    expect(col.pending.map((p) => p.id)).toEqual(['subclass:x|y:skill:royal envoy']);
  });
});

describe('Blessings of Knowledge', () => {
  it.each([
    ['2014', { name: 'Cleric', source: 'PHB' }, KNOWLEDGE, 1, PICK_2014],
    ['FRHoF', { name: 'Cleric', source: 'XPHB' }, KNOWLEDGE_2024, 3, PICK_2024],
  ])('opens a pick of two among its four skills in the %s printing', (_, cls, sub, level, id) => {
    const sheet = derive(build(cls, level, { subclass: sub }));
    const prompt = sheet.pending.find((p) => p.id === id);
    expect(prompt).toMatchObject({ kind: 'skill', count: 2 });
    expect(prompt?.options.map((o) => o.id)).toEqual(['Arcana', 'History', 'Nature', 'Religion']);
  });

  it('hangs the pick on the subclass, where the class card and a swap find it', () => {
    const sheet = derive(build({ name: 'Cleric', source: 'PHB' }, 1, { subclass: KNOWLEDGE }));
    expect(sheet.pending.find((p) => p.id === PICK_2014)?.origin).toMatchObject({
      type: 'subclass',
      uid: 'knowledge domain|phb',
      label: 'Blessings of Knowledge',
    });
  });

  it('comes the same through the PSA domain, which refers to the 2014 feature', () => {
    const open = derive(build({ name: 'Cleric', source: 'PHB' }, 1, { subclass: KNOWLEDGE_PSA }));
    expect(pendingIds(open)).toEqual([PICK_PSA]);
    expect(open.pending[0]?.origin).toMatchObject({ uid: 'knowledge domain (psa)|psa' });

    const doc = build({ name: 'Cleric', source: 'PHB' }, 1, {
      subclass: KNOWLEDGE_PSA,
      choices: { [PICK_PSA]: ['History', 'Nature'] },
    });
    const picked = derive(doc);
    expect(prof(picked, 'History')).toBe(2);
    expect(prof(picked, 'Arcana')).toBe(0);
    expect(pendingIds(picked)).toEqual([]);

    expect(pruneChoicesFor(doc, 'subclass', KNOWLEDGE_PSA)).toEqual([PICK_PSA]);
  });

  it('waits for the level the FRHoF printing comes at', () => {
    const sheet = derive(
      build({ name: 'Cleric', source: 'XPHB' }, 2, { subclass: KNOWLEDGE_2024 }),
    );
    expect(pendingIds(sheet)).toEqual([]);
  });

  it('gives a saved cleric an open prompt, and no warning, until it is answered', () => {
    const sheet = derive(build({ name: 'Cleric', source: 'PHB' }, 1, { subclass: KNOWLEDGE }));
    expect(pendingIds(sheet)).toEqual([PICK_2014]);
    expect(sheet.warnings).toEqual([]);
    for (const skill of ['Arcana', 'History', 'Nature', 'Religion']) {
      expect(prof(sheet, skill)).toBe(0);
    }
  });

  it('doubles the two picked and leaves the other two', () => {
    const sheet = derive(
      build({ name: 'Cleric', source: 'PHB' }, 1, {
        subclass: KNOWLEDGE,
        choices: { [PICK_2014]: ['Arcana', 'Religion'] },
      }),
    );
    expect(prof(sheet, 'Arcana')).toBe(2);
    expect(prof(sheet, 'Religion')).toBe(2);
    // INT +3 with twice a proficiency bonus of 2.
    expect(total(sheet, 'Arcana')).toBe(7);
    expect(prof(sheet, 'History')).toBe(0);
    expect(prof(sheet, 'Nature')).toBe(0);
    expect(pendingIds(sheet)).toEqual([]);
  });

  it('keeps asking until both are picked', () => {
    const sheet = derive(
      build({ name: 'Cleric', source: 'PHB' }, 1, {
        subclass: KNOWLEDGE,
        choices: { [PICK_2014]: ['Arcana'] },
      }),
    );
    expect(prof(sheet, 'Arcana')).toBe(2);
    expect(pendingIds(sheet)).toEqual([PICK_2014]);
  });

  it('grants nothing for a saved skill it does not offer', () => {
    const sheet = derive(
      build({ name: 'Cleric', source: 'PHB' }, 1, {
        subclass: KNOWLEDGE,
        choices: { [PICK_2014]: ['Stealth', 'Arcana'] },
      }),
    );
    expect(prof(sheet, 'Stealth')).toBe(0);
    expect(prof(sheet, 'Arcana')).toBe(2);
    expect(pendingIds(sheet)).toEqual([PICK_2014]);
    expect(sheet.warnings).toHaveLength(1);
  });

  it('says when a picked skill is already proficient from elsewhere', () => {
    const sheet = derive(
      build({ name: 'Cleric', source: 'PHB' }, 1, { subclass: KNOWLEDGE, background: 'Hermit' }),
    );
    const options = sheet.pending.find((p) => p.id === PICK_2014)?.options;
    expect(options?.find((o) => o.id === 'Nature')?.advisory).toMatch(/^Already proficient/);
    expect(options?.find((o) => o.id === 'Arcana')?.advisory).toBeUndefined();
  });

  it('is cleared with the subclass, so a swap does not leave the pick behind', () => {
    const doc = build({ name: 'Cleric', source: 'PHB' }, 1, {
      subclass: KNOWLEDGE,
      choices: { [PICK_2014]: ['Arcana', 'Religion'] },
    });
    expect(pruneChoicesFor(doc, 'subclass', KNOWLEDGE)).toEqual([PICK_2014]);
    expect(doc.choices).toEqual({});
  });
});
