import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { raceUnderSubrace } from './race';

/*
 * Shaped like the 5etools release: a base race carries its spells in
 * `additionalSpells` beside the trait that names them, and a subrace trait
 * with `data.overwrite` replaces a race trait by name (Mammon's Legacy of
 * Minauros for the Tiefling's Infernal Legacy). Prose is placeholder.
 */
const trait = (name: string, overwrite?: string, text = 'Placeholder text.'): DataEntity => ({
  name,
  type: 'entries',
  entries: [text],
  ...(overwrite !== undefined ? { data: { overwrite } } : {}),
});

const FIENDKIN: DataEntity = {
  name: 'Fiendkin',
  source: 'TST',
  ability: [{ int: 1, cha: 2 }],
  darkvision: 60,
  skillProficiencies: [{ intimidation: true }],
  languageProficiencies: [{ common: true, anyStandard: 1 }],
  resist: ['fire'],
  additionalSpells: [
    {
      ability: 'cha',
      innate: { '3': { daily: { '1': ['aid|tst'] } } },
      known: { '1': ['guidance|tst#c'] },
    },
  ],
  entries: [
    trait('Darkvision'),
    trait('Fiend Gift'),
    // The prose scanner reads this into the `relentless-endurance` pool.
    trait('Relentless Endurance', undefined, 'Drop to 1 HP instead of 0 once per long rest.'),
    trait('Languages'),
  ],
};

const HALFKIN: DataEntity = {
  name: 'Halfkin',
  source: 'TST',
  skillProficiencies: [{ any: 2 }],
  entries: [trait('Versatility')],
};

// Several picks in one list: the readers number them in reading order.
const PICKKIN: DataEntity = {
  name: 'Pickkin',
  source: 'TST',
  ability: [{ choose: { from: ['str', 'dex'] } }, { choose: { from: ['int', 'wis'] } }],
  skillProficiencies: [{ any: 1, choose: { from: ['arcana', 'history'] } }],
  entries: [trait('Knack')],
};

// Alternative ability arrangements: the reader asks which one applies.
const weighted = (weights: number[], from = ['str', 'dex', 'con']) => ({
  choose: { weighted: { from, weights } },
});
const ARRKIN: DataEntity = {
  name: 'Arrkin',
  source: 'TST',
  ability: [weighted([2, 1]), weighted([1, 1, 1])],
  entries: [trait('Knack')],
};

// An `any` key in an ability list, which the ability reader asks nothing for.
const ODDKIN: DataEntity = {
  name: 'Oddkin',
  source: 'TST',
  ability: [{ choose: { from: ['str', 'dex'] } }, { any: 1 }],
  entries: [trait('Knack')],
};

// PHB-Human-shaped: the race's own scores live on its nameless subrace.
const BASEKIN: DataEntity = {
  name: 'Basekin',
  source: 'TST',
  speed: 30,
  entries: [trait('Versatility')],
};

const sub = (name: string, fields: DataEntity, race = FIENDKIN): DataEntity => ({
  name,
  source: 'TST',
  raceName: race.name,
  raceSource: race.source,
  ...fields,
});

const SUBRACES: DataEntity[] = [
  // Mammon-shaped: its own spells and a trait replacing the one that names the race's.
  sub('Legacy', {
    additionalSpells: [
      { ability: 'cha', innate: { '3': { daily: { '1': ['flame strike|tst'] } } } },
    ],
    entries: [trait('Other Gift', 'Fiend Gift')],
  }),
  // Asmodeus-shaped: keeps the race's gift and spells.
  sub('Plain', { entries: [trait('Appearance')] }),
  // Winged-shaped: replaces the gift and removes the race's spells outright.
  sub('Winged', { additionalSpells: null, entries: [trait('Wings', 'Fiend Gift')] }),
  sub('Recast', { ability: [{ dex: 1, cha: 2 }], overwrite: { ability: true } }),
  sub('Overlap', { ability: [{ cha: 2, wis: 1 }] }),
  // Mark-of-Finding-shaped: a null removes the skill the replaced trait gave.
  sub('Marked', {
    skillProficiencies: null,
    entries: [trait('Hunch', 'Relentless Endurance')],
  }),
  sub('Tongued', {
    languageProficiencies: [{ common: true, goblin: true }],
    overwrite: { languageProficiencies: true },
  }),
  sub('Extra Tongue', { languageProficiencies: [{ anyStandard: 1 }] }),
  sub('Deep', { darkvision: 120, entries: [trait('Superior Darkvision', 'Darkvision')] }),
  sub('Unburnt', { resist: null }),
  sub('Loose Match', { entries: [trait('Gift Again', '  fiend gift ')] }),
  sub('No Match', { entries: [trait('Odd', 'Not A Trait')] }),
  sub('Everything', {
    entries: ['Darkvision', 'Fiend Gift', 'Relentless Endurance', 'Languages'].map((n) =>
      trait(`New ${n}`, n),
    ),
  }),
  // Belongs to another race; the lookup can still hand it over (two races can
  // each have a subrace of the same name and source).
  sub(
    'Stray',
    { additionalSpells: null, resist: null, entries: [trait('X', 'Fiend Gift')] },
    {
      name: 'Otherkin',
      source: 'TST',
    },
  ),
  // Same race name, another book's printing of it.
  sub(
    'Elsewhere',
    { additionalSpells: null, entries: [trait('Y', 'Fiend Gift')] },
    {
      name: 'Fiendkin',
      source: 'XTST',
    },
  ),
  sub('Variant', { skillProficiencies: [{ any: 2 }] }, HALFKIN),
  // Sets the race's first picks, which a later race pick follows.
  sub(
    'Early Picks',
    { ability: [{ choose: { from: ['cha'] } }, { con: 1 }], skillProficiencies: [{ any: 1 }] },
    PICKKIN,
  ),
  // Sets only the race's last picks.
  sub(
    'Late Picks',
    {
      ability: [{}, { choose: { from: ['cha'] } }],
      skillProficiencies: [{ choose: { from: ['stealth'] } }],
    },
    PICKKIN,
  ),
  // Hand-written homebrew: no `raceSource`.
  {
    name: 'Homebrew',
    source: 'TST',
    raceName: 'Fiendkin',
    additionalSpells: null,
    entries: [trait('Z', 'Fiend Gift')],
  },
  sub('Blank', { entries: null }),
  // Two races' subraces of one name and source (Ixalan|PSX for the Goblin and
  // the Vampire); a lookup by name and source finds the Fiendkin's first.
  sub('Twin', { speed: 25, entries: [trait('Fiend Twin')] }),
  sub('Twin', { speed: 35, skillProficiencies: null, entries: [trait('Half Twin')] }, HALFKIN),
  // A later copy of the same race's one (homebrew re-adding it): the first
  // wins, as in the registry and the picker.
  sub('Twin', { speed: 40, entries: [trait('Late Twin')] }, HALFKIN),
  sub('Late Arrangement', { ability: [{}, weighted([1], ['cha'])] }, ARRKIN),
  sub('Odd Pick', { ability: [{ choose: { from: ['cha'] } }, {}] }, ODDKIN),
  // Nameless subraces, each its race's base entry. Another book's printing's
  // comes first, so a lookup by race name alone would find it.
  { source: 'XTST', raceName: 'Basekin', raceSource: 'XTST', ability: [{ cha: 2 }] },
  {
    source: 'TST',
    raceName: 'Basekin',
    raceSource: 'TST',
    ability: [{ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }],
    speed: 35,
    entries: [trait('Base Gift')],
  },
  sub(
    'Varied',
    { ability: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], count: 2 } }] },
    BASEKIN,
  ),
];

function ctx(): EngineContext {
  const base = makeTestContext();
  const extra: Record<string, DataEntity[]> = {
    race: [FIENDKIN, HALFKIN, PICKKIN, ARRKIN, ODDKIN, BASEKIN],
    subrace: SUBRACES,
  };
  return {
    byType: (t) => [...(extra[t] ?? []), ...base.byType(t)],
    get: (type, name, source) =>
      (extra[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      ) ?? base.get(type, name, source),
  };
}

function derive(subrace?: string, race = 'Fiendkin', choices: CharacterDoc['choices'] = {}) {
  const doc = newCharacterDoc('c', 'Probe', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  doc.race = { name: race, source: 'TST' };
  if (subrace !== undefined) doc.subrace = { name: subrace, source: 'TST' };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: Array(5).fill('avg') }];
  doc.choices = choices;
  return deriveSheet(doc, ctx());
}

const raceCard = (sheet: ReturnType<typeof derive>, name = 'Fiendkin') =>
  sheet.features.find((f) => f.name === name && f.origin.type === 'race');
const traitNames = (card: { entries?: unknown } | undefined) =>
  (Array.isArray(card?.entries) ? card.entries : []).map((e) => (e as DataEntity).name);
const spells = (sheet: ReturnType<typeof derive>) =>
  sheet.grantedSpells.map((g) => `${g.name} [${g.origin}]`).sort();
const pools = (sheet: ReturnType<typeof derive>) =>
  sheet.resources
    .map((r) => r.key)
    .filter((k) => k.startsWith('spell:') || k === 'relentless-endurance')
    .sort();
const bonus = (sheet: ReturnType<typeof derive>, ability: 'int' | 'cha' | 'dex' | 'wis') =>
  sheet.abilities[ability].parts.filter((p) => p.label !== 'Base');

describe('a subrace trait that overwrites a race trait', () => {
  it('drops the race trait from the card and the race spells its own block replaces', () => {
    const sheet = derive('Legacy');
    expect(traitNames(raceCard(sheet))).toEqual([
      'Darkvision',
      'Relentless Endurance',
      'Languages',
    ]);
    expect(traitNames(sheet.features.find((f) => f.name === 'Legacy'))).toEqual(['Other Gift']);
    expect(spells(sheet)).toEqual(['flame strike [Legacy]']);
    expect(pools(sheet)).toEqual(['relentless-endurance', 'spell:legacy|tst:flame-strike']);
  });

  it('leaves the race whole for a subrace that replaces nothing', () => {
    const sheet = derive('Plain');
    expect(traitNames(raceCard(sheet))).toEqual(traitNames(FIENDKIN));
    expect(spells(sheet)).toEqual(['aid [Fiendkin]', 'guidance [Fiendkin]']);
    expect(pools(sheet)).toEqual(['relentless-endurance', 'spell:fiendkin|tst:aid']);
  });

  it('removes the race spells when the subrace sets them to null', () => {
    const sheet = derive('Winged');
    expect(spells(sheet)).toEqual([]);
    expect(traitNames(raceCard(sheet))).not.toContain('Fiend Gift');
  });

  it("drops a replaced trait's curated effect and the skill a null removes", () => {
    const sheet = derive('Marked');
    expect(pools(sheet)).not.toContain('relentless-endurance');
    expect(sheet.skills.Intimidation?.profBase).toBe(0);
    expect(traitNames(raceCard(sheet))).not.toContain('Relentless Endurance');
  });

  it('matches the trait name as 5etools does, ignoring case and outer spaces', () => {
    expect(traitNames(raceCard(derive('Loose Match')))).not.toContain('Fiend Gift');
  });

  it('drops nothing for an overwrite naming a trait the race lacks', () => {
    expect(traitNames(raceCard(derive('No Match')))).toEqual(traitNames(FIENDKIN));
  });

  it('shows no race card once every race trait is replaced', () => {
    const sheet = derive('Everything');
    expect(raceCard(sheet)).toBeUndefined();
    expect(sheet.features.find((f) => f.name === 'Everything')).toBeDefined();
  });

  it('leaves the race alone when the subrace belongs to another race', () => {
    const sheet = derive('Stray');
    expect(traitNames(sheet.features.find((f) => f.name === 'Stray'))).toEqual(['X']);
    expect(traitNames(raceCard(sheet))).toEqual(traitNames(FIENDKIN));
    expect(spells(sheet)).toContain('aid [Fiendkin]');
    expect(sheet.resists.map((r) => r.damageType)).toEqual(['fire']);
  });

  it("leaves the race alone when the subrace belongs to another book's race of that name", () => {
    const sheet = derive('Elsewhere');
    expect(traitNames(raceCard(sheet))).toEqual(traitNames(FIENDKIN));
    expect(spells(sheet)).toContain('aid [Fiendkin]');
  });

  it("reads the race's own subrace when another race has one of that name and source", () => {
    const half = derive('Twin', 'Halfkin');
    expect(traitNames(half.features.find((f) => f.name === 'Twin'))).toEqual(['Half Twin']);
    expect(half.speedWalk.value).toBe(35);
    expect(half.pending.some((p) => p.id === 'race:halfkin|tst:skill:0')).toBe(false);
    const fiend = derive('Twin');
    expect(traitNames(fiend.features.find((f) => f.name === 'Twin'))).toEqual(['Fiend Twin']);
    expect(fiend.speedWalk.value).toBe(25);
  });

  it('applies a subrace with no race source to the race it names', () => {
    const sheet = derive('Homebrew');
    expect(traitNames(raceCard(sheet))).not.toContain('Fiend Gift');
    expect(spells(sheet)).toEqual([]);
  });

  it('removes every race trait when the subrace sets its entries to null', () => {
    const sheet = derive('Blank');
    expect(raceCard(sheet)).toBeUndefined();
    expect(pools(sheet)).not.toContain('relentless-endurance');
    expect(spells(sheet)).toEqual(['aid [Fiendkin]', 'guidance [Fiendkin]']);
  });
});

describe('the rest of the 5etools subrace merge', () => {
  it("replaces the race's ability scores when the subrace's overwrite flags them", () => {
    const sheet = derive('Recast');
    expect(bonus(sheet, 'int')).toEqual([]);
    expect(bonus(sheet, 'cha')).toEqual([{ label: 'Recast', amount: 2 }]);
    expect(bonus(sheet, 'dex')).toEqual([{ label: 'Recast', amount: 1 }]);
  });

  it('lets the subrace win an ability both set, without a flag, and keeps the rest', () => {
    const sheet = derive('Overlap');
    expect(bonus(sheet, 'int')).toEqual([{ label: 'Fiendkin', amount: 1 }]);
    expect(bonus(sheet, 'cha')).toEqual([{ label: 'Overlap', amount: 2 }]);
    expect(bonus(sheet, 'wis')).toEqual([{ label: 'Overlap', amount: 1 }]);
  });

  it("replaces the race's languages, and its pick, when flagged", () => {
    const sheet = derive('Tongued');
    expect(sheet.languages).toEqual(['Common', 'Goblin']);
    expect(sheet.pending.some((p) => p.id === 'race:fiendkin|tst:lang:0')).toBe(false);
  });

  it("adds the subrace's languages to the race's without a flag", () => {
    const ids = derive('Extra Tongue')
      .pending.filter((p) => p.kind === 'language')
      .map((p) => p.id);
    expect(ids).toEqual(['race:fiendkin|tst:lang:0', 'subrace:extra tongue|tst:lang:0']);
  });

  it("keeps only the subrace's darkvision when both set one", () => {
    expect(derive('Deep').senses).toEqual([{ sense: 'darkvision', range: 120, origin: 'Deep' }]);
  });

  it('removes the race resistance the subrace sets to null', () => {
    expect(derive('Unburnt').resists).toEqual([]);
    expect(derive('Plain').resists.map((r) => r.damageType)).toEqual(['fire']);
  });

  it('asks once for a skill choice both set, under the subrace', () => {
    const skillPicks = (sheet: ReturnType<typeof derive>) =>
      sheet.pending
        .filter((p) => p.kind === 'skill' && !p.id.startsWith('class:'))
        .map((p) => [p.id, p.count]);
    expect(skillPicks(derive('Variant', 'Halfkin'))).toEqual([['subrace:variant|tst:skill:0', 2]]);
    expect(skillPicks(derive(undefined, 'Halfkin'))).toEqual([['race:halfkin|tst:skill:0', 2]]);
  });

  const racePicks = (sheet: ReturnType<typeof derive>, race = 'pickkin') =>
    sheet.pending
      .filter((p) => p.id.startsWith(`race:${race}|tst:`))
      .map((p) => p.id)
      .sort();

  it('keeps a shared race pick that a later race pick follows, so ids stay put', () => {
    const answered = derive('Early Picks', 'Pickkin', {
      'race:pickkin|tst:ability:c1': ['int'],
      'race:pickkin|tst:skill:1': ['Arcana'],
    });
    expect(bonus(answered, 'int')).toEqual([{ label: 'Pickkin', amount: 1 }]);
    expect(answered.skills.Arcana?.profBase).toBe(1);
    expect(racePicks(derive('Early Picks', 'Pickkin'))).toEqual([
      'race:pickkin|tst:ability:c0',
      'race:pickkin|tst:ability:c1',
      'race:pickkin|tst:skill:0',
      'race:pickkin|tst:skill:1',
    ]);
  });

  it('drops a shared race pick that no later race pick follows', () => {
    expect(racePicks(derive('Late Picks', 'Pickkin'))).toEqual([
      'race:pickkin|tst:ability:c0',
      'race:pickkin|tst:skill:0',
    ]);
    expect(racePicks(derive(undefined, 'Pickkin'))).toEqual([
      'race:pickkin|tst:ability:c0',
      'race:pickkin|tst:ability:c1',
      'race:pickkin|tst:skill:0',
      'race:pickkin|tst:skill:1',
    ]);
  });

  it("keeps the race's alternative ability arrangements whole, so it still asks which", () => {
    const asked = ['race:arrkin|tst:ability:arrangement'];
    expect(racePicks(derive(undefined, 'Arrkin'), 'arrkin')).toEqual(asked);
    expect(racePicks(derive('Late Arrangement', 'Arrkin'), 'arrkin')).toEqual(asked);
  });

  it('counts only the ability picks the ability reader asks', () => {
    expect(racePicks(derive('Odd Pick', 'Oddkin'), 'oddkin')).toEqual([]);
  });
});

describe("a race's nameless subrace", () => {
  it('gives a race with no subrace taken its scores, under the race name', () => {
    const sheet = derive(undefined, 'Basekin');
    for (const ability of ['int', 'cha', 'dex', 'wis'] as const) {
      expect(bonus(sheet, ability)).toEqual([{ label: 'Basekin', amount: 1 }]);
    }
  });

  it("puts its traits on the race's card and its speed under the race name", () => {
    const sheet = derive(undefined, 'Basekin');
    expect(traitNames(raceCard(sheet, 'Basekin'))).toEqual(['Versatility', 'Base Gift']);
    expect(sheet.speedWalk.parts).toEqual([{ label: 'Basekin', amount: 35 }]);
  });

  it('gives way to a named subrace, as 5etools merges one or the other', () => {
    const sheet = derive('Varied', 'Basekin');
    expect(bonus(sheet, 'cha')).toEqual([]);
    expect(traitNames(raceCard(sheet, 'Basekin'))).toEqual(['Versatility']);
    expect(sheet.speedWalk.parts).toEqual([{ label: 'Basekin', amount: 30 }]);
  });
});

describe('raceUnderSubrace', () => {
  it('reads an undefined key as one the subrace does not set', () => {
    const view = raceUnderSubrace(FIENDKIN, { name: 'Bare', additionalSpells: undefined });
    expect(view.additionalSpells).toBe(FIENDKIN.additionalSpells);
  });

  it('leaves the race entity it was given unchanged', () => {
    const before = JSON.stringify(FIENDKIN);
    raceUnderSubrace(FIENDKIN, SUBRACES[0] as DataEntity);
    raceUnderSubrace(FIENDKIN, SUBRACES.find((s) => s.name === 'Overlap') as DataEntity);
    expect(JSON.stringify(FIENDKIN)).toBe(before);
  });
});
