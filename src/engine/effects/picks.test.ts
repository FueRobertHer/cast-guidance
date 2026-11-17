import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import curated from '../../rules/cast-guidance/curated.json';
import standing from '../../rules/cast-guidance/standing.json';
import { storedInPlay } from '../activeEffects';
import { RULE_SET_TYPE } from '../castGuidance';
import {
  ABILITIES,
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
  SKILLS,
} from '../types';
import { Collector } from './base';
import { collectFeatEntity } from './feat';
import { emitRuleRows, inPlayRefusal, readRuleSet, readStoredEffects } from './mechanics';
import { DAMAGE_TYPES, type PickFill, spellFill } from './picks';
import { toolOptions } from './readers';

// Invented picks: what the reader and the asker do with them is the point.

const origin: EffectOrigin = { label: 'Lantern', uid: 'lantern|hb', type: 'feat' };
const classOrigin: EffectOrigin = { label: 'Old Lore', uid: 'warrior|tst', type: 'class' };

function character(edit: (d: CharacterDoc) => void = () => {}): CharacterDoc {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
  ];
  edit(d);
  return d;
}

/** Built-in rows, read as the app's own rule sets are. */
function builtIn(effects: unknown[]) {
  const set = readRuleSet({
    type: RULE_SET_TYPE,
    v: 1,
    name: 'Built-in rules',
    rows: [{ part: 'curated', keys: ['lantern|hb'], effects }],
  });
  expect(set.problems).toEqual([]);
  return set.rows;
}

/** A collector with `held` added first, then the built-in row emitted. */
function ask(
  effects: unknown[],
  opts: {
    doc?: CharacterDoc;
    held?: EffectInput[];
    at?: EffectOrigin;
    classLevel?: number;
    className?: string;
    ctx?: EngineContext;
  } = {},
) {
  const col = new Collector(opts.doc ?? character(), opts.ctx ?? makeTestContext());
  for (const e of opts.held ?? []) col.add(e);
  const before = col.effects.length;
  emitRuleRows(
    col,
    builtIn(effects),
    opts.at ?? origin,
    undefined,
    opts.classLevel,
    opts.className,
  );
  for (const fn of col.afterAll.splice(0)) fn();
  return { col, added: col.effects.slice(before) };
}

const held: EffectOrigin = { label: 'Past', uid: 'past|hb', type: 'background' };
const SKILL = { kind: 'skillProf', skill: '{pick}', level: 1 };
const TOOL = { kind: 'toolProf', name: '{pick}' };

describe('reading a stored pick', () => {
  const one = (x: unknown) => readStoredEffects([x]);

  it("files a player's id under pick-, and keeps the code rows' ids for the app's own sets", () => {
    const read = one({ kind: 'pick', id: 'favoured-tool', ask: 'tool', gives: [TOOL] });
    expect(read.problems).toEqual([]);
    expect(read.effects[0]?.pick?.id).toBe('pick-favoured-tool');
    // A code row's fixed word is a player's slug like any other, never the engine's id.
    const ancestor = one({ kind: 'pick', id: 'ancestor', ask: 'damage', gives: [] });
    expect(ancestor.effects[0]?.pick?.id).toBe('pick-ancestor');
    // A player's file cannot write a code row's id, which could share an engine answer.
    expect(
      one({ kind: 'pick', id: 'skill:{feature}', ask: 'skill', gives: [SKILL] }).problems[0],
    ).toMatch(/"id" is a short name/);
    expect(
      one({ kind: 'pick', id: 'Ancestor', ask: 'option', options: [{ id: 'a', label: 'A' }] })
        .problems[0],
    ).toMatch(/"id" is a short name/);
    const set = builtIn([{ kind: 'pick', id: 'skill:{feature}', ask: 'skill', gives: [SKILL] }]);
    expect(set[0]?.effects[0]?.pick?.id).toBe('skill:{feature}');
  });

  it('refuses two picks under one id, a pick inside a pick, and a while', () => {
    const twice = readStoredEffects([
      { kind: 'pick', id: 'x', ask: 'skill', gives: [SKILL] },
      { kind: 'pick', id: 'x', ask: 'tool', gives: [TOOL] },
    ]);
    expect(twice.effects).toHaveLength(1);
    expect(twice.problems[0]).toMatch(/effect 2 \(pick\): asks "pick-x" again/);
    const nested = one({
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      gives: [{ kind: 'pick', id: 'y', ask: 'skill', gives: [SKILL] }],
    });
    expect(nested.problems[0]).toMatch(/"gives": effect 1 \(pick\): a pick gives no pick/);
    expect(
      one({ kind: 'pick', id: 'x', ask: 'skill', gives: [SKILL], while: 'raging' }).problems[0],
    ).toMatch(/holds no "while"/);
  });

  it('refuses a field its ask does not read, and a pick that gives nothing', () => {
    expect(
      one({ kind: 'pick', id: 'x', ask: 'tool', classSkills: true, gives: [TOOL] }).problems[0],
    ).toMatch(/"classSkills" goes with a pick that asks for skill/);
    expect(
      one({ kind: 'pick', id: 'x', ask: 'damage', inPlaceOf: ['fire'], gives: [] }).problems[0],
    ).toMatch(/"inPlaceOf" goes with a pick that asks for skill or tool or save/);
    expect(one({ kind: 'pick', id: 'x', ask: 'skill' }).problems[0]).toMatch(/"gives" says/);
    expect(one({ kind: 'pick', id: 'x', ask: 'spell', gives: [] }).problems[0]).toMatch(
      /"spells" is missing/,
    );
    expect(
      one({ kind: 'pick', id: 'x', ask: 'skill', always: [SKILL], gives: [SKILL] }).problems[0],
    ).toMatch(/"always" goes with "inPlaceOf"/);
  });

  it('checks what each pick gives with an answer filled in', () => {
    // A save's answer is an ability, which an AC formula cannot add as a number.
    const bad = one({
      kind: 'pick',
      id: 'x',
      ask: 'save',
      gives: [{ kind: 'acBonus', amount: '{pick}' }],
    });
    expect(bad.problems[0]).toMatch(/"gives": effect 1 \(acBonus\): "amount" needs a number/);
    // An app's own set names a field it does not read, even inside what a pick gives.
    const strict = readRuleSet({
      type: RULE_SET_TYPE,
      v: 1,
      rows: [
        {
          part: 'curated',
          keys: ['lantern|hb'],
          effects: [{ kind: 'pick', id: 'x', ask: 'skill', gives: [{ ...SKILL, lvl: 2 }] }],
        },
      ],
    });
    expect(strict.problems[0]).toMatch(/"lvl" is not a field/);
  });

  it("reads weapon masteries, a spell row for slots alone, and filter words in the app's own sets", () => {
    expect(one({ kind: 'weaponMastery', name: 'longsword' }).problems).toEqual([]);
    const grant = one({ kind: 'grantSpell', spell: 'Fire Bolt|XPHB', slotsOnly: true });
    expect(grant.effects[0]?.effect).toMatchObject({ slotsOnly: true });
    expect(one({ kind: 'weaponProfFilter', filter: 'type=martial weapon' }).problems[0]).toMatch(
      /own rule sets only/,
    );
    const rows = builtIn([
      { kind: 'weaponProfFilter', filter: 'type=martial weapon|property=!heavy' },
    ]);
    expect(rows[0]?.effects[0]?.effect).toMatchObject({
      filter: 'type=martial weapon|property=!heavy',
    });
    const words = readRuleSet({
      type: RULE_SET_TYPE,
      v: 1,
      rows: [
        {
          part: 'curated',
          keys: ['a|b'],
          effects: [{ kind: 'weaponProfFilter', filter: 'martial' }],
        },
      ],
    });
    expect(words.problems[0]).toMatch(/is filter words/);
  });

  it('reads a sense "or more" than one held, with a plain range only', () => {
    expect(one({ kind: 'sense', sense: 'darkvision', range: 60, orMore: 60 }).problems).toEqual([]);
    expect(
      one({ kind: 'sense', sense: 'darkvision', range: { f: 'prof' }, orMore: 60 }).problems[0],
    ).toMatch(/needs a plain "range"/);
    expect(
      one({ kind: 'sense', sense: 'darkvision', range: 60, orMoreFrom: 'race' }).problems[0],
    ).toMatch(/goes with "orMore"/);
  });

  it('keeps a pick and an "or more" sense out of play', () => {
    const [pick] = one({ kind: 'pick', id: 'x', ask: 'skill', gives: [SKILL] }).effects;
    expect(pick && inPlayRefusal(pick, 'A spell')).toMatch(/asks nothing/);
    expect(
      storedInPlay([{ kind: 'pick', id: 'x', ask: 'skill', gives: [SKILL] }]).problems,
    ).toHaveLength(1);
    const sense = storedInPlay([{ kind: 'sense', sense: 'darkvision', range: 60, orMore: 60 }]);
    expect(sense.problems[0]?.why).toMatch(/plain range, with no "orMore"/);
  });
});

describe('asking a stored pick', () => {
  it('names a pick with no label by what it asks and how many, as the code rows did', () => {
    const label = (what: string, count: number) =>
      ask([
        {
          kind: 'pick',
          id: `${what}:{feature}`,
          ask: what,
          count,
          ...(what === 'weapon' ? { from: ['longsword'] } : {}),
          gives: [],
        },
      ]).col.pending[0]?.label;
    expect(label('skill', 1)).toBe('Skill proficiency');
    expect(label('skill', 2)).toBe('Skill proficiencies');
    expect(label('tool', 1)).toBe('Tool proficiency');
    expect(label('tool', 2)).toBe('Tool proficiencies');
    expect(label('weapon', 1)).toBe('Weapon proficiency');
    expect(label('weapon', 2)).toBe('Weapon proficiencies');
  });

  it("asks under the code rows' id and gives what the answer fills", () => {
    const pick = {
      kind: 'pick',
      id: 'skill:{feature}',
      ask: 'skill',
      from: ['arcana', 'History'],
      gives: [SKILL],
    };
    const asked = ask([pick]);
    expect(asked.col.pending[0]).toMatchObject({
      id: 'feat:lantern|hb:skill:lantern',
      kind: 'skill',
      label: 'Skill proficiency',
      count: 1,
    });
    expect(asked.col.pending[0]?.options.map((o) => o.id)).toEqual(['Arcana', 'History']);
    const answered = ask([pick], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:skill:lantern'] = ['History'];
      }),
    });
    expect(answered.added).toMatchObject([{ kind: 'skillProf', skill: 'History', level: 1 }]);
    expect(answered.col.pickOf.get(answered.added[0] as EffectInput)).toBe(
      'feat:lantern|hb:skill:lantern',
    );
  });

  it('offers a held tool disabled, and gives a tool by the name the sheet shows', () => {
    const pick = { kind: 'pick', id: 'kit', ask: 'tool', from: ["artisan's tools"], gives: [TOOL] };
    const smith = { kind: 'toolProf', name: "Smith's Tools", origin: held } as EffectInput;
    const asked = ask([pick], { held: [smith] });
    const option = asked.col.pending[0]?.options.find((o) => o.label === "Smith's Tools");
    expect(option?.disabled?.reason).toBe("You already have Smith's Tools");
    const id = asked.col.pending[0]?.options.find((o) => o.label === "Mason's Tools")?.id ?? '';
    const answered = ask([pick], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-kit'] = [id];
      }),
    });
    expect(answered.added).toMatchObject([{ kind: 'toolProf', name: "Mason's Tools" }]);
  });

  it('gives what is not held, and asks in place of what is, after "always"', () => {
    const envoy = {
      kind: 'pick',
      id: 'skill:{feature}',
      ask: 'skill',
      from: ['Insight', 'Performance'],
      label: 'Skill in place of {held}',
      inPlaceOf: ['Persuasion'],
      always: [{ kind: 'skillProf', skill: 'Persuasion', level: 2 }],
      gives: [SKILL],
    };
    const free = ask([envoy]);
    expect(free.col.pending).toEqual([]);
    expect(free.added.map((e) => e.kind === 'skillProf' && [e.skill, e.level])).toEqual([
      ['Persuasion', 1],
      ['Persuasion', 2],
    ]);
    const persuasion = {
      kind: 'skillProf',
      skill: 'Persuasion',
      level: 1,
      origin: held,
    } as EffectInput;
    const taken = ask([envoy], { held: [persuasion] });
    expect(taken.added.map((e) => e.kind === 'skillProf' && [e.skill, e.level])).toEqual([
      ['Persuasion', 2],
    ]);
    expect(taken.col.pending[0]).toMatchObject({ label: 'Skill in place of Persuasion', count: 1 });
    // Two held: as many picks, named together.
    const both = ask([{ ...envoy, inPlaceOf: ['Persuasion', 'Arcana'], always: undefined }], {
      held: [persuasion, { ...persuasion, skill: 'Arcana' } as EffectInput],
    });
    expect(both.col.pending[0]).toMatchObject({
      label: 'Skill in place of Persuasion and Arcana',
      count: 2,
    });
  });

  it('leaves a held save out of a save pick, and asks nothing when none is left', () => {
    const pick = {
      kind: 'pick',
      id: 'save:{feature}',
      ask: 'save',
      from: ['int', 'cha'],
      inPlaceOf: ['wis'],
      gives: [{ kind: 'saveProf', ability: '{pick}' }],
    };
    const save = (ability: string) => ({ kind: 'saveProf', ability, origin: held }) as EffectInput;
    const asked = ask([pick], { held: [save('wis'), save('cha')] });
    expect(asked.col.pending[0]).toMatchObject({ label: 'Lantern: saving throw' });
    expect(asked.col.pending[0]?.options).toEqual([{ id: 'int', label: 'INT' }]);
    expect(ask([pick], { held: [save('wis'), save('cha'), save('int')] }).col.pending).toEqual([]);
    // With no `from`, every ability it lacks (Unfettered Mind's row).
    const any = ask([{ ...pick, from: undefined, inPlaceOf: ['int'] }], {
      held: [save('int'), save('wis')],
    });
    expect(any.col.pending[0]?.options.map((o) => o.id)).toEqual(['str', 'dex', 'con', 'cha']);
  });

  it('names damage types, gives each option its own effects, and counts by level or column', () => {
    const damage = ask([
      { kind: 'pick', id: 'x', ask: 'damage', gives: [{ kind: 'resist', damageType: '{pick}' }] },
    ]);
    expect(damage.col.pending[0]?.options).toHaveLength(13);
    expect(damage.col.pending[0]?.options[0]).toEqual({ id: 'acid', label: 'Acid' });
    const option = {
      kind: 'pick',
      id: 'soul',
      ask: 'option',
      options: [
        {
          id: 'swim',
          label: 'Swimming',
          gives: [{ kind: 'moveSpeed', mode: 'swim', speed: 'walk' }],
        },
        { id: 'jump', label: 'Jumping' },
      ],
    };
    const swim = ask([option], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-soul'] = ['swim'];
      }),
    });
    expect(swim.added).toMatchObject([{ kind: 'moveSpeed', mode: 'swim', speed: 'walk' }]);
    const byLevel = {
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      count: { byLevel: { '1': 1, '10': 2 } },
      gives: [SKILL],
    };
    expect(ask([byLevel], { classLevel: 9 }).col.pending[0]?.count).toBe(1);
    expect(ask([byLevel], { classLevel: 10 }).col.pending[0]?.count).toBe(2);
    const column = {
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      count: { tableColumn: 'Nothing here', else: 3 },
      gives: [SKILL],
    };
    expect(ask([column], { at: classOrigin }).col.pending[0]?.count).toBe(3);
    // The column of the giving class's table, at its level (the Warrior is 4).
    const base = makeTestContext();
    const withTable: EngineContext = {
      ...base,
      get: (type, name, source) => {
        const e = base.get(type, name, source);
        if (type !== 'class' || name !== 'Warrior' || e === undefined) return e;
        const rows = [['2'], ['2'], ['3'], ['4'], ['4']];
        return { ...e, classTableGroups: [{ colLabels: ['Old Lore Count'], rows }] };
      },
    };
    const lore = { ...column, count: { tableColumn: 'old lore', else: 3 } };
    expect(ask([lore], { at: classOrigin, ctx: withTable }).col.pending[0]?.count).toBe(4);
  });

  it("offers the giving class's skill list, and languages beside skills", () => {
    const pick = {
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      from: ['Arcana'],
      classSkills: true,
      gives: [SKILL],
    };
    const asked = ask([pick], { at: classOrigin, className: 'Warrior' });
    expect(asked.col.pending[0]?.options.map((o) => o.id)).toEqual([
      'Arcana',
      'Athletics',
      'Intimidation',
      'Survival',
    ]);
    const lang = {
      kind: 'pick',
      id: 'y',
      ask: 'skill',
      from: ['Insight'],
      orLanguage: true,
      gives: [SKILL],
    };
    const spoken = ask([lang], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-y'] = ['Elvish'];
      }),
    });
    expect(spoken.added).toMatchObject([{ kind: 'language', name: 'Elvish' }]);
  });

  it("fills a spell's name, its slug and its title, and every pick at once", () => {
    const pick = {
      kind: 'pick',
      id: 'sig',
      ask: 'spell',
      count: 2,
      spells: { levels: [3], classes: ['Wizard'] },
      gives: [
        { kind: 'resource', key: 'sig-{pick.slug}', label: '{pick.title}', max: 1, reset: 'short' },
        { kind: 'grantSpell', spell: '{pick}', usage: 'prepared', slotsOnly: true },
      ],
      givesAll: [{ kind: 'spellDamageBonus', amount: 1, spells: '{picks}' }],
    };
    const asked = ask([pick]);
    expect(asked.col.pending[0]).toMatchObject({ kind: 'spell', options: [], count: 2 });
    expect(asked.col.pending[0]?.spellQuery).toMatchObject({ levels: [3], classes: ['Wizard'] });
    const answered = ask([pick], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-sig'] = ["leomund's tiny hut|phb", 'Fireball|XPHB'];
      }),
    });
    expect(answered.added).toMatchObject([
      { kind: 'resource', key: 'sig-leomund-s-tiny-hut', label: "Leomund's Tiny Hut" },
      { kind: 'grantSpell', spell: { name: "leomund's tiny hut", source: 'phb' }, slotsOnly: true },
      { kind: 'resource', key: 'sig-fireball', label: 'Fireball' },
      { kind: 'grantSpell', spell: { name: 'Fireball', source: 'XPHB' } },
      { kind: 'spellDamageBonus', spells: ["leomund's tiny hut", 'fireball'] },
    ]);
  });

  it('says on the sheet when an answer does not read into what it gives', () => {
    const pick = {
      kind: 'pick',
      id: 'x',
      ask: 'spell',
      spells: { levels: [0] },
      gives: [
        { kind: 'resource', key: 'x-{pick.slug}', label: '{pick.title}', max: 1, reset: 'long' },
      ],
    };
    // The sample spell's name fits a key; a homebrew spell's long name does not.
    const long = `${'Very '.repeat(30)}Long Light|HB`;
    const answered = ask([pick], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-x'] = [long];
      }),
    });
    expect(answered.added).toEqual([]);
    expect(answered.col.warnings).toEqual([
      expect.stringMatching(/^Lantern: effect 1 \(resource\): "key" is at most \d+ characters/),
    ]);
  });

  it('asks a pick once the build is in, and one id once a derive', () => {
    const late = { kind: 'pick', id: 'x', ask: 'skill', afterBuild: true, gives: [SKILL] };
    const col = new Collector(character(), makeTestContext());
    emitRuleRows(col, builtIn([late]), origin);
    expect(col.pending).toEqual([]);
    expect(col.afterAll).toHaveLength(1);
    for (const fn of col.afterAll) fn();
    expect(col.pending.map((p) => p.id)).toEqual(['feat:lantern|hb:pick-x']);
    // A pack's patch and the entry's own effects can each ask "x" on one origin.
    const twice = new Collector(character(), makeTestContext());
    const own = readStoredEffects([{ kind: 'pick', id: 'x', ask: 'skill', gives: [SKILL] }]);
    emitRuleRows(
      twice,
      [{ part: 'curated', keys: ['a'], scan: 'replace', effects: own.effects }],
      origin,
    );
    emitRuleRows(
      twice,
      [{ part: 'curated', keys: ['a'], scan: 'replace', effects: own.effects }],
      origin,
    );
    expect(twice.pending).toHaveLength(1);
    expect(twice.warnings).toEqual(['Lantern: asks its pick "x" twice; the second is left out.']);
  });

  it('adds a sense or more than the same sense held so far', () => {
    const owl = { kind: 'sense', sense: 'darkvision', range: 60, orMore: 60 };
    const range = (e: EffectInput | undefined) => (e?.kind === 'sense' ? e.range : undefined);
    expect(range(ask([owl]).added[0])).toBe(60);
    const race: EffectOrigin = { label: 'Elf', uid: 'elf|hb', type: 'race' };
    const seen = { kind: 'sense', sense: 'Darkvision', range: 60, origin: race } as EffectInput;
    const fromClass = { ...seen, range: 90, origin: held } as EffectInput;
    expect(range(ask([owl], { held: [seen] }).added[0])).toBe(120);
    const fromRace = { ...owl, orMore: 30, orMoreFrom: 'race' };
    expect(range(ask([fromRace], { held: [seen, fromClass] }).added[0])).toBe(90);
    const added = ask([fromRace], { held: [fromClass] }).added[0];
    expect(range(added)).toBe(60);
    expect(added).not.toHaveProperty('orMore');
  });
});

describe('a pick a player writes', () => {
  const one = (x: unknown) => readStoredEffects([x]);

  it('shares an id across rules versions, where only one is ever asked', () => {
    const by = (edition?: string) => ({
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      gives: [SKILL],
      ...(edition === undefined ? {} : { edition }),
    });
    expect(readStoredEffects([by('2014'), by('2024')]).problems).toEqual([]);
    expect(readStoredEffects([by('2014'), by('2014')]).problems[0]).toMatch(/again/);
    expect(readStoredEffects([by(), by('2024')]).problems[0]).toMatch(/again/);
  });

  it('asks each copy of a repeatable feat its own pick, under that copy', () => {
    const boon: DataEntity = {
      name: 'Boon',
      source: 'HB',
      repeatable: true,
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'pick',
            id: 'dmg',
            ask: 'damage',
            gives: [{ kind: 'resist', damageType: '{pick}' }],
          },
        ],
      },
    };
    const doc = character((d) => {
      d.choices['feat:boon|hb:a:pick-dmg'] = ['fire'];
      d.choices['feat:boon|hb:b:pick-dmg'] = ['cold'];
    });
    const col = new Collector(doc, makeTestContext());
    collectFeatEntity(col, boon, 'boon|hb', 'a');
    collectFeatEntity(col, boon, 'boon|hb', 'b');
    expect(col.warnings).toEqual([]);
    const resists = col.effects.flatMap((e) => (e.kind === 'resist' ? [e.damageType] : []));
    expect(resists).toEqual(['fire', 'cold']);
  });

  it('names its weapons one way, with filter words the pick reads', () => {
    const weapon = (more: Record<string, unknown>) =>
      one({
        kind: 'pick',
        id: 'x',
        ask: 'weapon',
        gives: [{ kind: 'weaponProf', name: '{pick}' }],
        ...more,
      });
    expect(weapon({}).problems[0]).toMatch(/in "from" or "weapons", one of them/);
    expect(
      weapon({ from: ['whip'], weapons: { filter: 'type=melee weapon' } }).problems[0],
    ).toMatch(/one of them/);
    expect(weapon({ weapons: { filter: 'type=martial weapon;ranged weapon' } }).problems).toEqual(
      [],
    );
    for (const filter of ['foo=bar', 'type=melee weapon|property=light', 'type=foo weapon']) {
      expect(weapon({ weapons: { filter } }).problems[0], filter).toMatch(/"type=" and simple/);
    }
  });

  it('refuses a "from" its ask does not read', () => {
    const asks = [
      { ask: 'option', options: [{ id: 'a', label: 'A' }] },
      { ask: 'weaponMastery', gives: [{ kind: 'weaponMastery', name: '{pick}' }] },
      { ask: 'spell', spells: { levels: [0] }, gives: [] },
    ];
    for (const a of asks) {
      expect(one({ kind: 'pick', id: 'x', from: ['a'], ...a }).problems[0], a.ask).toMatch(
        /"from" goes with/,
      );
    }
  });

  it('gives a homebrew skill as a skill, and a language as spoken', () => {
    const pick = {
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      from: ['Cooking'],
      orLanguage: true,
      gives: [SKILL],
    };
    const cooked = ask([pick], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-x'] = ['Cooking'];
      }),
    });
    expect(cooked.added).toMatchObject([{ kind: 'skillProf', skill: 'Cooking' }]);
  });

  it('takes two option ids that differ in case as one', () => {
    const options = [
      { id: 'Swim', label: 'Swim' },
      { id: 'swim', label: 'Climb' },
    ];
    expect(one({ kind: 'pick', id: 'x', ask: 'option', options }).problems[0]).toMatch(
      /"swim" is offered twice/,
    );
  });

  it('keeps a "$" in a name or an answer as it is written', () => {
    const glory: EffectOrigin = { label: 'Gold $& Glory', uid: 'glory|hb', type: 'feat' };
    const pick = {
      kind: 'pick',
      id: 'skill:{feature}',
      ask: 'skill',
      label: '{feature}',
      gives: [SKILL],
    };
    const asked = ask([pick], { at: glory });
    expect(asked.col.pending[0]).toMatchObject({
      id: 'feat:glory|hb:skill:gold $& glory',
      label: 'Gold $& Glory',
    });
    const spell = {
      kind: 'pick',
      id: 'x',
      ask: 'spell',
      spells: { levels: [1] },
      gives: [{ kind: 'note', text: 'Cast {pick.title}' }],
    };
    const paid = ask([spell], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-x'] = ['Pay$$ Up|HB'];
      }),
    });
    expect(paid.added).toMatchObject([{ kind: 'note', text: 'Cast Pay$$ Up' }]);
  });

  it('fills "{picks}" only in what the picks give together, and a tool by the name the sheet shows', () => {
    const inGives = {
      kind: 'pick',
      id: 'x',
      ask: 'spell',
      spells: { levels: [0] },
      gives: [{ kind: 'spellDamageBonus', amount: 1, spells: '{picks}' }],
    };
    expect(one(inGives).problems[0]).toMatch(/"gives": effect 1 \(spellDamageBonus\)/);
    const tools = {
      kind: 'pick',
      id: 'x',
      ask: 'tool',
      from: ["artisan's tools"],
      gives: [TOOL],
      givesAll: [{ kind: 'note', text: 'With {pick}' }],
    };
    const asked = ask([tools]);
    const id = asked.col.pending[0]?.options.find((o) => o.label === "Smith's Tools")?.id ?? '';
    const answered = ask([tools], {
      doc: character((d) => {
        d.choices['feat:lantern|hb:pick-x'] = [id];
      }),
    });
    expect(answered.added.at(-1)).toMatchObject({ kind: 'note', text: "With Smith's Tools" });
  });

  it("offers a skill once when it is in both the list and the class's", () => {
    const pick = {
      kind: 'pick',
      id: 'x',
      ask: 'skill',
      from: ['Athletics'],
      classSkills: true,
      gives: [SKILL],
    };
    const asked = ask([pick], { at: classOrigin, className: 'Warrior' });
    expect(asked.col.pending[0]?.options.map((o) => o.id)).toEqual([
      'Athletics',
      'Intimidation',
      'Survival',
    ]);
  });
});

describe("the app's own picks", () => {
  // The longest names, and the ones with a colon or a letter outside a to z.
  const SPELLS = [
    "Mordenkainen's Magnificent Mansion|XPHB",
    "Elminster's Effulgent Spheres|FRHoF",
    'Sylunè’s Viper|FRHoF',
    "Sylunè's Viper|FRHoF",
    'Shadow Word: Pain|WoW',
    'Fire Bolt|XPHB',
  ];
  const WEAPONS = ['Longsword', 'Hand Crossbow', 'Double-Bladed Scimitar', 'Whip'];

  /** Every answer a pick can take, as the asker fills it. */
  function fills(ask: string, options: readonly { id: string }[] = []): PickFill[] {
    switch (ask) {
      case 'skill':
        return SKILLS.map((s) => ({ pick: s.name }));
      case 'tool':
        return toolOptions().map((o) => ({ pick: o.label }));
      case 'weapon':
      case 'weaponMastery':
        return WEAPONS.map((w) => ({ pick: w.toLowerCase() }));
      case 'save':
        return ABILITIES.map((a) => ({ pick: a }));
      case 'damage':
        return DAMAGE_TYPES.map((d) => ({ pick: d }));
      case 'option':
        return options.map((o) => ({ pick: o.id }));
      default:
        return SPELLS.flatMap((s) => spellFill(s) ?? []);
    }
  }

  it('read every answer into what they give', () => {
    let filled = 0;
    for (const set of [curated, standing]) {
      const read = readRuleSet(set);
      expect(read.problems).toEqual([]);
      for (const row of read.rows) {
        for (const t of row.effects) {
          const rule = t.pick;
          if (rule === undefined) continue;
          const all = fills(rule.ask, rule.options);
          for (const fill of all) {
            if (rule.gives === undefined) continue;
            expect(rule.gives(fill).problems, `${row.keys[0]}: ${fill.pick}`).toEqual([]);
            filled++;
          }
          if (rule.givesAll !== undefined) {
            const picks = all.map((f) => f.pick.split('|')[0]?.toLowerCase() ?? '');
            expect(rule.givesAll({ pick: picks[0] ?? '', picks }).problems).toEqual([]);
          }
        }
      }
    }
    expect(filled).toBeGreaterThan(0);
  });
});
