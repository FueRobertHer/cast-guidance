/**
 * Class and subclass features that grant a skill, or a pick of skills, in prose
 * alone, end to end through `deriveSheet`. The world has the names, sources and
 * levels of the pinned release, placeholder prose, and made-up class skill lists
 * so a test can tell the list came from the class data.
 */
import { describe, expect, it } from 'vitest';
import { pruneChoicesFor, pruneClass } from '../../lib/pruneChoices';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
  SKILLS,
} from '../types';

const PROSE = ['Placeholder text.'];

const cls = (
  name: string,
  source: string,
  classFeatures: string[] = [],
  skills?: string[],
): DataEntity => ({
  name,
  source,
  hd: { number: 1, faces: 8 },
  classFeatures,
  ...(skills
    ? { startingProficiencies: { skills: [{ choose: { from: skills, count: 2 } }] } }
    : {}),
});

const classFeature = (
  name: string,
  className: string,
  classSource: string,
  source: string,
  level: number,
): DataEntity => ({ name, className, classSource, source, level, entries: PROSE });

/** A subclass and the one feature it lists, with the ref string the release uses. */
function subclassWith(
  name: string,
  shortName: string,
  source: string,
  className: string,
  classSource: string,
  feature: string,
  level: number,
): [DataEntity, DataEntity] {
  return [
    {
      name,
      shortName,
      source,
      className,
      classSource,
      subclassFeatures: [`${feature}|${className}|${classSource}|${shortName}|${source}|${level}`],
    },
    {
      name: feature,
      source,
      className,
      classSource,
      subclassShortName: shortName,
      subclassSource: source,
      level,
      entries: PROSE,
    },
  ];
}

const SUBCLASSES = [
  subclassWith('Arcane Archer', 'Arcane Archer', 'XGE', 'Fighter', 'PHB', 'Arcane Archer Lore', 3),
  subclassWith('Arcane Archer', 'Arcane Archer', 'AU', 'Fighter', 'XPHB', 'Arcane Archer Lore', 3),
  subclassWith('Cavalier', 'Cavalier', 'XGE', 'Fighter', 'PHB', 'Bonus Proficiency', 3),
  subclassWith('Battle Master', 'Battle Master', 'XPHB', 'Fighter', 'XPHB', 'Student of War', 3),
  subclassWith('Battle Master', 'Battle Master', 'PHB', 'Fighter', 'PHB', 'Student of War', 3),
  subclassWith('Arcana Domain', 'Arcana', 'SCAG', 'Cleric', 'PHB', 'Arcane Initiate', 1),
  subclassWith('Arcana Domain', 'Arcana', 'AU', 'Cleric', 'XPHB', 'Student of Arcana', 3),
  subclassWith('College of Lore', 'Lore', 'PHB', 'Bard', 'PHB', 'Bonus Proficiencies', 3),
  subclassWith('College of Valor', 'Valor', 'PHB', 'Bard', 'PHB', 'Bonus Proficiencies', 3),
  subclassWith('Way of Mercy', 'Mercy', 'TCE', 'Monk', 'PHB', 'Implements of Mercy', 3),
  subclassWith('Fey Wanderer', 'Fey Wanderer', 'TCE', 'Ranger', 'PHB', 'Otherworldly Glamour', 3),
  subclassWith('Enchanter', 'Enchanter', 'AU', 'Wizard', 'XPHB', 'Enchanting Conversationalist', 3),
  subclassWith('Scout', 'Scout', 'XGE', 'Rogue', 'PHB', 'Survivalist', 3),
];

const WORLD: Record<string, DataEntity[]> = {
  class: [
    cls('Barbarian', 'PHB', ['Primal Knowledge|Barbarian||3|TCE'], ['athletics', 'survival']),
    cls('Barbarian', 'XPHB', ['Primal Knowledge|Barbarian|XPHB|3'], ['intimidation', 'nature']),
    cls('Expert Sidekick', 'TCE', ['Bonus Proficiencies|Expert Sidekick|TCE|1']),
    cls('Fighter', 'PHB'),
    cls('Fighter', 'XPHB', [], ['athletics', 'history', 'insight']),
    cls('Cleric', 'PHB'),
    cls('Cleric', 'XPHB', [], ['history', 'religion']),
    cls('Bard', 'PHB', ['Expertise|Bard||3']),
    cls('Monk', 'PHB'),
    cls('Ranger', 'PHB'),
    cls(
      'Rogue',
      'PHB',
      ['Expertise|Rogue||1', 'Expertise|Rogue||6'],
      ['acrobatics', 'perception', 'stealth'],
    ),
    cls('Wizard', 'XPHB'),
  ],
  classFeature: [
    classFeature('Primal Knowledge', 'Barbarian', 'PHB', 'TCE', 3),
    classFeature('Primal Knowledge', 'Barbarian', 'XPHB', 'XPHB', 3),
    classFeature('Bonus Proficiencies', 'Expert Sidekick', 'TCE', 'TCE', 1),
    classFeature('Expertise', 'Bard', 'PHB', 'PHB', 3),
    classFeature('Expertise', 'Rogue', 'PHB', 'PHB', 1),
    classFeature('Expertise', 'Rogue', 'PHB', 'PHB', 6),
  ],
  subclass: SUBCLASSES.map(([sub]) => sub),
  subclassFeature: SUBCLASSES.map(([, feature]) => feature),
  race: [{ name: 'Elf', source: 'TEST', languageProficiencies: [{ common: true, elvish: true }] }],
  background: [
    { name: 'Hermit', source: 'TEST', skillProficiencies: [{ nature: true, medicine: true }] },
    { name: 'Scholar', source: 'TEST', skillProficiencies: [{ arcana: true, nature: true }] },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => WORLD[type] ?? [],
};

/** STR 10, DEX 14, CON 10, INT 16, WIS 12, CHA 8. */
function build(
  ref: EntityRef,
  levels: number,
  opts: { subclass?: EntityRef; background?: string; choices?: CharacterDoc['choices'] } = {},
): CharacterDoc {
  const doc = newCharacterDoc('s', 'Skills', 't');
  doc.abilities = {
    method: 'manual',
    base: { str: 10, dex: 14, con: 10, int: 16, wis: 12, cha: 8 },
  };
  doc.classes = [{ ref, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') }];
  if (opts.background !== undefined) doc.background = { name: opts.background, source: 'TEST' };
  doc.choices = { ...opts.choices };
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const prof = (sheet: DerivedSheet, skill: string) => sheet.skills[skill]?.prof;
const total = (sheet: DerivedSheet, skill: string) => sheet.skills[skill]?.total.value;
const prompt = (sheet: DerivedSheet, id: string) => sheet.pending.find((p) => p.id === id);
const optionIds = (sheet: DerivedSheet, id: string) => prompt(sheet, id)?.options.map((o) => o.id);
const fromFeature = (sheet: DerivedSheet, feature: string) =>
  Object.entries(sheet.skills)
    .filter(([, s]) => s.sources.some((o) => o.label === feature))
    .map(([name]) => name);
const ALL_SKILLS = SKILLS.map((s) => s.name);

const BARBARIAN = { name: 'Barbarian', source: 'PHB' };
const BARBARIAN_2024 = { name: 'Barbarian', source: 'XPHB' };
const FIGHTER = { name: 'Fighter', source: 'PHB' };
const FIGHTER_2024 = { name: 'Fighter', source: 'XPHB' };
const CLERIC = { name: 'Cleric', source: 'PHB' };
const CLERIC_2024 = { name: 'Cleric', source: 'XPHB' };
const BARD = { name: 'Bard', source: 'PHB' };

const KNOWLEDGE_PICK = 'class:barbarian|phb:skill:primal knowledge';
const KNOWLEDGE_PICK_2024 = 'class:barbarian|xphb:skill:primal knowledge';
const LORE_XGE = 'subclass:arcane archer|xge:skill:arcane archer lore';
const LORE_AU = 'subclass:arcane archer|au:skill:arcane archer lore';
const CAVALIER = 'subclass:cavalier|xge:skill:bonus proficiency';
const STUDENT = 'subclass:battle master|xphb:skill:student of war';
const BARD_LORE = 'subclass:college of lore|phb:skill:bonus proficiencies';
const GLAMOUR = 'subclass:fey wanderer|tce:skill:otherworldly glamour';
const CONVERSATIONALIST = 'subclass:enchanter|au:skill:enchanting conversationalist';

describe('Primal Knowledge', () => {
  it('opens a pick from the 2014 barbarian list in the data, under the class', () => {
    const sheet = derive(build(BARBARIAN, 3));
    expect(prompt(sheet, KNOWLEDGE_PICK)).toMatchObject({
      kind: 'skill',
      count: 1,
      origin: { type: 'class', uid: 'barbarian|phb', label: 'Primal Knowledge' },
    });
    expect(optionIds(sheet, KNOWLEDGE_PICK)).toEqual(['Athletics', 'Survival']);
  });

  it('waits for barbarian 3', () => {
    expect(prompt(derive(build(BARBARIAN, 2)), KNOWLEDGE_PICK)).toBeUndefined();
  });

  it('asks for a second skill at barbarian 10 in the TCE printing', () => {
    expect(prompt(derive(build(BARBARIAN, 9)), KNOWLEDGE_PICK)?.count).toBe(1);
    expect(prompt(derive(build(BARBARIAN, 10)), KNOWLEDGE_PICK)?.count).toBe(2);
  });

  it('asks for one in the 2024 printing at any level, from that printing list', () => {
    const sheet = derive(build(BARBARIAN_2024, 10));
    expect(prompt(sheet, KNOWLEDGE_PICK_2024)?.count).toBe(1);
    expect(optionIds(sheet, KNOWLEDGE_PICK_2024)).toEqual(['Intimidation', 'Nature']);
    expect(prompt(sheet, KNOWLEDGE_PICK)).toBeUndefined();
  });

  it('grants plain proficiency once picked, and closes', () => {
    const sheet = derive(build(BARBARIAN, 3, { choices: { [KNOWLEDGE_PICK]: ['Survival'] } }));
    expect(prof(sheet, 'Survival')).toBe(1);
    expect(prof(sheet, 'Athletics')).toBe(0);
    expect(prompt(sheet, KNOWLEDGE_PICK)).toBeUndefined();
    expect(sheet.warnings).toEqual([]);
  });

  it('keeps the one picked at level 9 and opens again for the second at 10', () => {
    const sheet = derive(build(BARBARIAN, 10, { choices: { [KNOWLEDGE_PICK]: ['Survival'] } }));
    expect(prof(sheet, 'Survival')).toBe(1);
    expect(prompt(sheet, KNOWLEDGE_PICK)?.count).toBe(2);
  });

  it('is cleared with the class', () => {
    const doc = build(BARBARIAN, 3, { choices: { [KNOWLEDGE_PICK]: ['Survival'] } });
    const [entry] = doc.classes;
    expect(entry && pruneClass(doc, entry)).toContain(KNOWLEDGE_PICK);
  });
});

describe('a sidekick class', () => {
  it('picks five of every skill', () => {
    const sheet = derive(build({ name: 'Expert Sidekick', source: 'TCE' }, 1));
    const id = 'class:expert sidekick|tce:skill:bonus proficiencies';
    expect(prompt(sheet, id)).toMatchObject({ count: 5, label: 'Skill proficiencies' });
    expect(optionIds(sheet, id)).toEqual(ALL_SKILLS);
  });
});

describe('Arcane Archer Lore', () => {
  const XGE = { name: 'Arcane Archer', source: 'XGE' };
  const AU = { name: 'Arcane Archer', source: 'AU' };

  it('picks Arcana or Nature in the XGE printing', () => {
    const open = derive(build(FIGHTER, 3, { subclass: XGE }));
    expect(optionIds(open, LORE_XGE)).toEqual(['Arcana', 'Nature']);
    expect(prompt(open, LORE_XGE)?.count).toBe(1);
    const picked = derive(
      build(FIGHTER, 3, { subclass: XGE, choices: { [LORE_XGE]: ['Nature'] } }),
    );
    expect(prof(picked, 'Nature')).toBe(1);
    expect(prof(picked, 'Arcana')).toBe(0);
    expect(prompt(picked, LORE_XGE)).toBeUndefined();
  });

  it('grants both in the AU printing, with no pick, when neither is held', () => {
    const sheet = derive(build(FIGHTER_2024, 3, { subclass: AU }));
    expect(prof(sheet, 'Arcana')).toBe(1);
    expect(prof(sheet, 'Nature')).toBe(1);
    expect(prompt(sheet, LORE_AU)).toBeUndefined();
  });

  it('turns one already held into a pick from the fighter list in the data', () => {
    const sheet = derive(build(FIGHTER_2024, 3, { subclass: AU, background: 'Hermit' }));
    expect(fromFeature(sheet, 'Arcane Archer Lore')).toEqual(['Arcana']);
    expect(prompt(sheet, LORE_AU)).toMatchObject({ count: 1, label: 'Skill in place of Nature' });
    expect(optionIds(sheet, LORE_AU)).toEqual(['Athletics', 'History', 'Insight']);
  });

  it('turns both into two picks when both are held', () => {
    const sheet = derive(build(FIGHTER_2024, 3, { subclass: AU, background: 'Scholar' }));
    expect(fromFeature(sheet, 'Arcane Archer Lore')).toEqual([]);
    expect(prompt(sheet, LORE_AU)?.count).toBe(2);
  });

  it('closes once the skill in its place is picked', () => {
    const sheet = derive(
      build(FIGHTER_2024, 3, {
        subclass: AU,
        background: 'Hermit',
        choices: { [LORE_AU]: ['History'] },
      }),
    );
    expect(prof(sheet, 'History')).toBe(1);
    expect(prompt(sheet, LORE_AU)).toBeUndefined();
    expect(sheet.warnings).toEqual([]);
  });

  it('waits for fighter 3', () => {
    const sheet = derive(build(FIGHTER_2024, 2, { subclass: AU }));
    expect(prof(sheet, 'Arcana')).toBe(0);
  });
});

describe('Bonus Proficiency (Cavalier)', () => {
  const CAV = { name: 'Cavalier', source: 'XGE' };

  it('offers its skills, then a language instead, in one pick', () => {
    const sheet = derive(build(FIGHTER, 3, { subclass: CAV }));
    const ids = optionIds(sheet, CAVALIER) ?? [];
    expect(prompt(sheet, CAVALIER)).toMatchObject({ count: 1, label: 'Skill or language' });
    expect(ids.slice(0, 5)).toEqual([
      'Animal Handling',
      'History',
      'Insight',
      'Performance',
      'Persuasion',
    ]);
    expect(ids).toContain('Elvish');
    expect(ids).not.toContain('Stealth');
    expect(sheet.languages).toEqual([]);
  });

  it('grants a skill picked', () => {
    const sheet = derive(
      build(FIGHTER, 3, { subclass: CAV, choices: { [CAVALIER]: ['Insight'] } }),
    );
    expect(prof(sheet, 'Insight')).toBe(1);
    expect(sheet.languages).toEqual([]);
    expect(prompt(sheet, CAVALIER)).toBeUndefined();
  });

  it('grants a language picked instead, and no skill', () => {
    const sheet = derive(build(FIGHTER, 3, { subclass: CAV, choices: { [CAVALIER]: ['Elvish'] } }));
    expect(sheet.languages).toContain('Elvish');
    expect(fromFeature(sheet, 'Bonus Proficiency')).toEqual([]);
    expect(prompt(sheet, CAVALIER)).toBeUndefined();
  });

  it('marks a language the character already speaks, as other language picks do', () => {
    const doc = build(FIGHTER, 3, { subclass: CAV });
    doc.race = { name: 'Elf', source: 'TEST' };
    const options = prompt(derive(doc), CAVALIER)?.options ?? [];
    expect(options.find((o) => o.id === 'Elvish')?.disabled?.reason).toBe(
      'You already speak Elvish',
    );
    expect(options.find((o) => o.id === 'Dwarvish')?.disabled).toBeUndefined();
    expect(options.find((o) => o.id === 'History')?.disabled).toBeUndefined();
  });
});

describe('Student of War', () => {
  it('picks from the fighter list in the 2024 printing', () => {
    const sheet = derive(
      build(FIGHTER_2024, 3, { subclass: { name: 'Battle Master', source: 'XPHB' } }),
    );
    expect(optionIds(sheet, STUDENT)).toEqual(['Athletics', 'History', 'Insight']);
  });

  it('asks for no skill in the 2014 printing, a tool alone', () => {
    const sheet = derive(build(FIGHTER, 3, { subclass: { name: 'Battle Master', source: 'PHB' } }));
    expect(sheet.pending.filter((p) => p.origin.label === 'Student of War')).toEqual([]);
    expect(fromFeature(sheet, 'Student of War')).toEqual([]);
  });
});

describe('Arcana Domain', () => {
  it('grants Arcana outright in the SCAG printing', () => {
    const sheet = derive(build(CLERIC, 1, { subclass: { name: 'Arcana Domain', source: 'SCAG' } }));
    expect(prof(sheet, 'Arcana')).toBe(1);
    expect(sheet.pending.filter((p) => p.origin.label === 'Arcane Initiate')).toEqual([]);
  });

  it('picks Arcana or one of the cleric list in the AU printing', () => {
    const sheet = derive(
      build(CLERIC_2024, 3, { subclass: { name: 'Arcana Domain', source: 'AU' } }),
    );
    expect(optionIds(sheet, 'subclass:arcana domain|au:skill:student of arcana')).toEqual([
      'Arcana',
      'History',
      'Religion',
    ]);
    expect(prof(sheet, 'Arcana')).toBe(0);
  });
});

describe('Bonus Proficiencies (College of Lore)', () => {
  const LORE = { name: 'College of Lore', source: 'PHB' };

  it('picks three of every skill, under the subclass', () => {
    const sheet = derive(build(BARD, 3, { subclass: LORE }));
    expect(prompt(sheet, BARD_LORE)).toMatchObject({ count: 3, origin: { type: 'subclass' } });
    expect(optionIds(sheet, BARD_LORE)).toEqual(ALL_SKILLS);
  });

  it('closes once three are picked, and is cleared with the subclass', () => {
    const doc = build(BARD, 3, {
      subclass: LORE,
      choices: { [BARD_LORE]: ['Arcana', 'Insight', 'Stealth'] },
    });
    const sheet = derive(doc);
    expect(['Arcana', 'Insight', 'Stealth'].map((s) => prof(sheet, s))).toEqual([1, 1, 1]);
    expect(prompt(sheet, BARD_LORE)).toBeUndefined();
    expect(pruneChoicesFor(doc, 'subclass', LORE)).toEqual([BARD_LORE]);
  });

  it('keeps asking while fewer are picked', () => {
    const sheet = derive(build(BARD, 3, { subclass: LORE, choices: { [BARD_LORE]: ['Arcana'] } }));
    expect(prof(sheet, 'Arcana')).toBe(1);
    expect(prompt(sheet, BARD_LORE)).toBeDefined();
  });

  it('offers the skills it grants to the bard Expertise of the same level', () => {
    const sheet = derive(
      build(BARD, 3, {
        subclass: LORE,
        choices: { [BARD_LORE]: ['Arcana', 'Insight', 'Stealth'] },
      }),
    );
    expect(optionIds(sheet, 'class:bard|phb:expertise:3')).toEqual([
      'Arcana',
      'Insight',
      'Stealth',
    ]);
    const doubled = derive(
      build(BARD, 3, {
        subclass: LORE,
        choices: {
          [BARD_LORE]: ['Arcana', 'Insight', 'Stealth'],
          'class:bard|phb:expertise:3': ['Stealth', 'Arcana'],
        },
      }),
    );
    expect(prof(doubled, 'Stealth')).toBe(2);
    expect(prof(doubled, 'Arcana')).toBe(2);
    expect(prof(doubled, 'Insight')).toBe(1);
    expect(doubled.warnings).toEqual([]);
  });

  it('waits for bard 3, and is no part of the College of Valor feature of that name', () => {
    expect(prompt(derive(build(BARD, 2, { subclass: LORE })), BARD_LORE)).toBeUndefined();
    const valor = derive(build(BARD, 3, { subclass: { name: 'College of Valor', source: 'PHB' } }));
    expect(valor.pending.filter((p) => p.kind === 'skill')).toEqual([]);
  });
});

describe('Implements of Mercy', () => {
  const MERCY = { name: 'Way of Mercy', source: 'TCE' };

  it('grants Insight and Medicine outright at monk 3', () => {
    const sheet = derive(build({ name: 'Monk', source: 'PHB' }, 3, { subclass: MERCY }));
    expect(fromFeature(sheet, 'Implements of Mercy')).toEqual(['Insight', 'Medicine']);
    expect(sheet.pending).toEqual([]);
  });

  it('adds the proficiency beside one already held, with nothing in its place', () => {
    const sheet = derive(
      build({ name: 'Monk', source: 'PHB' }, 3, { subclass: MERCY, background: 'Hermit' }),
    );
    expect(sheet.skills.Medicine?.sources.map((o) => o.label)).toEqual([
      'Hermit',
      'Implements of Mercy',
    ]);
    expect(prof(sheet, 'Medicine')).toBe(1);
    expect(sheet.pending).toEqual([]);
  });

  it('waits for monk 3', () => {
    const sheet = derive(build({ name: 'Monk', source: 'PHB' }, 2, { subclass: MERCY }));
    expect(fromFeature(sheet, 'Implements of Mercy')).toEqual([]);
  });
});

describe('Otherworldly Glamour', () => {
  const FEY = { name: 'Fey Wanderer', source: 'TCE' };

  it('keeps its Charisma check bonus and adds a pick of three skills', () => {
    const sheet = derive(build({ name: 'Ranger', source: 'PHB' }, 3, { subclass: FEY }));
    expect(optionIds(sheet, GLAMOUR)).toEqual(['Deception', 'Performance', 'Persuasion']);
    // CHA -1, and WIS +1 from the bonus.
    expect(sheet.checks.cha.total.value).toBe(0);
  });

  it('grants the skill picked', () => {
    const sheet = derive(
      build({ name: 'Ranger', source: 'PHB' }, 3, {
        subclass: FEY,
        choices: { [GLAMOUR]: ['Deception'] },
      }),
    );
    expect(prof(sheet, 'Deception')).toBe(1);
    expect(prompt(sheet, GLAMOUR)).toBeUndefined();
  });
});

describe('Enchanting Conversationalist', () => {
  const ENCHANTER = { name: 'Enchanter', source: 'AU' };
  const WIZARD = { name: 'Wizard', source: 'XPHB' };

  it('picks one of three, and the skill picked takes the Intelligence bonus', () => {
    const sheet = derive(
      build(WIZARD, 3, { subclass: ENCHANTER, choices: { [CONVERSATIONALIST]: ['Persuasion'] } }),
    );
    expect(prof(sheet, 'Persuasion')).toBe(1);
    // CHA -1, proficiency +2, INT +3.
    expect(total(sheet, 'Persuasion')).toBe(4);
    // The others get neither.
    expect(total(sheet, 'Deception')).toBe(-1);
    expect(prompt(sheet, CONVERSATIONALIST)).toBeUndefined();
  });

  it('gives at least +1, and nothing before the pick', () => {
    const doc = build(WIZARD, 3, {
      subclass: ENCHANTER,
      choices: { [CONVERSATIONALIST]: ['Intimidation'] },
    });
    doc.abilities.base.int = 8;
    expect(total(derive(doc), 'Intimidation')).toBe(2);
    const open = derive(build(WIZARD, 3, { subclass: ENCHANTER }));
    expect(optionIds(open, CONVERSATIONALIST)).toEqual(['Deception', 'Intimidation', 'Persuasion']);
    expect(total(open, 'Persuasion')).toBe(-1);
  });
});

describe('Expertise asked after the subclass', () => {
  const ROGUE = { name: 'Rogue', source: 'PHB' };
  const SCOUT = { name: 'Scout', source: 'XGE' };
  const EXPERTISE = 'class:rogue|phb:expertise:1';
  const CLASS_SKILLS = 'class:rogue|phb:skill:0';

  it('offers every skill while the only skills held are ones a feature already doubles', () => {
    const sheet = derive(build(ROGUE, 3, { subclass: SCOUT }));
    expect(prof(sheet, 'Nature')).toBe(2);
    expect(optionIds(sheet, EXPERTISE)).toEqual(ALL_SKILLS);
  });

  it('offers the skills held once one could still take it, the doubled ones too', () => {
    const sheet = derive(
      build(ROGUE, 3, { subclass: SCOUT, choices: { [CLASS_SKILLS]: ['Stealth', 'Perception'] } }),
    );
    expect(optionIds(sheet, EXPERTISE)?.slice().sort()).toEqual([
      'Nature',
      'Perception',
      'Stealth',
      'Survival',
    ]);
  });

  it('still offers only the skills held once an earlier Expertise doubled them all', () => {
    const LATER = 'class:rogue|phb:expertise:6';
    const sheet = derive(
      build(ROGUE, 6, {
        choices: {
          [CLASS_SKILLS]: ['Stealth', 'Perception'],
          [EXPERTISE]: ['Stealth', 'Perception'],
          [LATER]: ['Acrobatics'],
        },
      }),
    );
    expect(optionIds(sheet, LATER)?.slice().sort()).toEqual(['Perception', 'Stealth']);
    expect(prof(sheet, 'Acrobatics')).toBe(0);
    expect(sheet.warnings).toHaveLength(1);
  });

  it('offers only the class skills without the subclass', () => {
    const sheet = derive(
      build(ROGUE, 3, { choices: { [CLASS_SKILLS]: ['Stealth', 'Perception'] } }),
    );
    expect(optionIds(sheet, EXPERTISE)?.slice().sort()).toEqual(['Perception', 'Stealth']);
  });

  it('keeps a saved pick of a skill the subclass also doubles, without a warning', () => {
    const sheet = derive(
      build(ROGUE, 3, {
        subclass: SCOUT,
        choices: {
          [CLASS_SKILLS]: ['Stealth', 'Perception'],
          [EXPERTISE]: ['Stealth', 'Survival'],
        },
      }),
    );
    expect(prof(sheet, 'Stealth')).toBe(2);
    expect(prompt(sheet, EXPERTISE)).toBeUndefined();
    expect(sheet.warnings).toEqual([]);
  });
});

describe('a saved character', () => {
  it.each([
    [BARBARIAN, 3, undefined, KNOWLEDGE_PICK],
    [FIGHTER, 3, { name: 'Cavalier', source: 'XGE' }, CAVALIER],
    [BARD, 3, { name: 'College of Lore', source: 'PHB' }, BARD_LORE],
  ] as const)('just gets an open prompt, with no warning (%#)', (ref, level, subclass, id) => {
    const sheet = derive(build(ref, level, { subclass }));
    expect(prompt(sheet, id)).toBeDefined();
    expect(sheet.warnings).toEqual([]);
  });
});
