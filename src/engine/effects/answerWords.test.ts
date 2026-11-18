import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { storedInPlay } from '../activeEffects';
import { CAST_GUIDANCE_LIMITS as L, RULE_SET_TYPE } from '../castGuidance';
import { readMoments } from '../moments';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import { collectFeatEntity } from './feat';
import { emitRuleRows, readRuleSet, readStoredEffects } from './mechanics';

// Invented rows: what the reader and the emitter do with an answer table is the point.

const origin: EffectOrigin = { label: 'Lantern', uid: 'lantern|hb', type: 'feat' };
const sub: EffectOrigin = { label: 'Gift', uid: 'the genie|hb', type: 'subclass' };

const KIND = {
  kind: 'pick',
  id: 'kind',
  ask: 'option',
  options: [
    { id: 'storm', label: 'Storm' },
    { id: 'flame', label: 'Flame' },
  ],
};
const byKind = { byAnswer: 'kind', values: { storm: 'lightning', flame: 'fire' } };

function character(choices: Record<string, string[]> = {}): CharacterDoc {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
  d.choices = { ...choices };
  return d;
}

/** A player's effects, read and emitted as an entry's own are, after `held`. */
function emitted(
  effects: unknown[],
  opts: { choices?: Record<string, string[]>; held?: EffectInput[]; at?: EffectOrigin } = {},
) {
  const read = readStoredEffects(effects);
  expect(read.problems).toEqual([]);
  const col = new Collector(character(opts.choices), makeTestContext());
  for (const e of opts.held ?? []) col.add(e);
  const before = col.effects.length;
  emitRuleRows(
    col,
    [{ part: 'curated', keys: ['a'], scan: 'replace', effects: read.effects }],
    opts.at ?? origin,
  );
  return col.effects.slice(before);
}

/** Built-in rows, read as the app's own rule sets are. */
function builtIn(effects: unknown[]) {
  return readRuleSet({
    type: RULE_SET_TYPE,
    v: 1,
    name: 'Built-in rules',
    rows: [{ part: 'standing', keys: ['gift|the genie'], effects }],
  });
}

const resisted = (effects: EffectInput[]) =>
  effects.flatMap((e) => (e.kind === 'resist' ? [e.damageType] : []));

describe('words by an answer', () => {
  it("gives a resistance by the entry's own pick, and none before it is answered", () => {
    const resist = { kind: 'resist', damageType: byKind };
    expect(resisted(emitted([KIND, resist]))).toEqual([]);
    const answered = (a: string) =>
      resisted(emitted([KIND, resist], { choices: { 'feat:lantern|hb:pick-kind': [a] } }));
    expect(answered('flame')).toEqual(['fire']);
    expect(answered('storm')).toEqual(['lightning']);
    // Answers compare as the pick's ids do, trimmed and without case.
    expect(answered(' Flame ')).toEqual(['fire']);
    // An answer the table does not name gives nothing: the field is one the kind needs.
    expect(answered('frost')).toEqual([]);
    // The pick may come after the effect that reads it: answers are read as saved.
    expect(
      resisted(emitted([resist, KIND], { choices: { 'feat:lantern|hb:pick-kind': ['storm'] } })),
    ).toEqual(['lightning']);
  });

  it('gives a vulnerability by an answer, as the other defenses', () => {
    const vulnerable = { kind: 'vulnerable', damageType: byKind };
    const given = emitted([KIND, vulnerable], {
      choices: { 'feat:lantern|hb:pick-kind': ['storm'] },
    });
    expect(given.flatMap((e) => (e.kind === 'vulnerable' ? [e.damageType] : []))).toEqual([
      'lightning',
    ]);
    expect(emitted([KIND, vulnerable]).some((e) => e.kind === 'vulnerable')).toBe(false);
  });

  it('reads the first answer of a pick of more than one', () => {
    const two = { ...KIND, count: 2 };
    const resist = { kind: 'resist', damageType: byKind };
    const choices = { 'feat:lantern|hb:pick-kind': ['storm', 'flame'] };
    expect(resisted(emitted([two, resist], { choices }))).toEqual(['lightning']);
  });

  it('leaves out a note with no answer, and keeps the action', () => {
    const action = {
      kind: 'action',
      economy: 'none',
      label: 'Flare',
      note: { byAnswer: 'kind', values: { storm: 'a crack of thunder' } },
    };
    const notes = (choices?: Record<string, string[]>) =>
      emitted([KIND, action], { ...(choices === undefined ? {} : { choices }) }).flatMap((e) =>
        e.kind === 'action' ? [[e.label, e.note]] : [],
      );
    expect(notes()).toEqual([['Flare', undefined]]);
    expect(notes({ 'feat:lantern|hb:pick-kind': ['flame'] })).toEqual([['Flare', undefined]]);
    expect(notes({ 'feat:lantern|hb:pick-kind': ['storm'] })).toEqual([
      ['Flare', 'a crack of thunder'],
    ]);
  });

  it('reads each copy of a repeatable feat by its own answer, filed as its pick is', () => {
    const boon: DataEntity = {
      name: 'Boon',
      source: 'HB',
      repeatable: true,
      castGuidance: { v: 1, effects: [KIND, { kind: 'resist', damageType: byKind }] },
    };
    const col = new Collector(
      character({
        'feat:boon|hb:a:pick-kind': ['storm'],
        'feat:boon|hb:b:pick-kind': ['flame'],
      }),
      makeTestContext(),
    );
    collectFeatEntity(col, boon, 'boon|hb', 'a');
    collectFeatEntity(col, boon, 'boon|hb', 'b');
    expect(col.warnings).toEqual([]);
    expect(resisted(col.effects)).toEqual(['lightning', 'fire']);
  });

  it("reads a built-in row's engine prompt, the spell option of a subclass", () => {
    const set = builtIn([
      { kind: 'resist', damageType: { byAnswer: 'branch', values: { dao: 'bludgeoning' } } },
    ]);
    expect(set.problems).toEqual([]);
    const col = new Collector(
      character({ 'subclass:the genie|hb:branch': ['Dao'] }),
      makeTestContext(),
    );
    emitRuleRows(col, set.rows, sub);
    expect(resisted(col.effects)).toEqual(['bludgeoning']);
  });
});

describe('words by a spell granted', () => {
  const grant = (name: string, uid = origin.uid): EffectInput => ({
    kind: 'grantSpell',
    spell: { name, source: 'XPHB' },
    origin: { label: 'Gift', uid, type: 'feat' },
  });
  const resist = {
    kind: 'resist',
    damageType: { byGrant: { 'chill touch': 'necrotic', 'blade ward': 'poison' } },
  };

  it('gives a resistance by which of the spells the entry granted so far', () => {
    expect(resisted(emitted([resist]))).toEqual([]);
    expect(resisted(emitted([resist], { held: [grant('Chill Touch')] }))).toEqual(['necrotic']);
    // The first granted, as the grants were collected.
    expect(
      resisted(
        emitted([resist], { held: [grant('light'), grant('Blade Ward'), grant('chill touch')] }),
      ),
    ).toEqual(['poison']);
    // Another entry's grant is not this one's.
    expect(resisted(emitted([resist], { held: [grant('chill touch', 'other|hb')] }))).toEqual([]);
  });
});

describe('reading a table of words', () => {
  const one = (x: unknown) => readStoredEffects([KIND, x]);
  const resist = (damageType: unknown) => ({ kind: 'resist', damageType });

  it('holds the first row until it is emitted', () => {
    const read = one(resist(byKind));
    expect(read.problems).toEqual([]);
    expect(read.effects[1]?.effect.damageType).toBe('lightning');
    expect(read.effects[1]?.byAnswer).toEqual([
      {
        field: 'damageType',
        of: 'pick-kind',
        values: [
          ['storm', 'lightning'],
          ['flame', 'fire'],
        ],
        needed: true,
      },
    ]);
  });

  it("refuses a pick the list does not ask, and a player's engine prompt", () => {
    expect(
      readStoredEffects([resist({ byAnswer: 'kind', values: { storm: 'fire' } })]).problems,
    ).toEqual(['effect 1 (resist): reads the answer to "kind", a pick this list does not ask']);
    // "branch" is a player's slug like any other: its own pick, which it does not ask.
    expect(
      readStoredEffects([resist({ byAnswer: 'branch', values: { dao: 'fire' } })]).problems[0],
    ).toMatch(/reads the answer to "branch", a pick this list does not ask/);
    expect(one(resist({ byAnswer: 'Kind!', values: { storm: 'fire' } })).problems[0]).toMatch(
      /"damageType.byAnswer" is a short name/,
    );
    // Inside what a pick gives, the list is the pick's, which asks no pick.
    expect(
      readStoredEffects([
        { ...KIND, options: [{ id: 'storm', label: 'Storm', gives: [resist(byKind)] }] },
      ]).problems[0],
    ).toMatch(/a pick this list does not ask/);
  });

  it('refuses a table that is empty, too long, names a row twice or is both kinds', () => {
    expect(one(resist({ byAnswer: 'kind', values: {} })).problems[0]).toMatch(/names no answer/);
    const many = Object.fromEntries(
      Array.from({ length: L.answerRows + 1 }, (_, i) => [`a${i}`, 'fire']),
    );
    expect(one(resist({ byAnswer: 'kind', values: many })).problems[0]).toMatch(
      new RegExp(`names at most ${L.answerRows} answers`),
    );
    expect(
      one(resist({ byAnswer: 'kind', values: { Storm: 'fire', ' storm': 'cold' } })).problems[0],
    ).toMatch(/names " storm" twice/);
    expect(
      one(resist({ byAnswer: 'kind', values: { storm: 'fire' }, byGrant: { light: 'fire' } }))
        .problems[0],
    ).toMatch(/by an answer or by a spell granted, not both/);
    expect(one(resist({ byAnswer: 'kind' })).problems[0]).toMatch(
      /"damageType.values" is a table of answers and words/,
    );
    expect(one(resist({ byGrant: ['light'] })).problems[0]).toMatch(
      /"damageType.byGrant" is a table of spells and words/,
    );
  });

  it("reads each row's words as the field's own", () => {
    const note = (words: unknown) =>
      one({
        kind: 'action',
        economy: 'none',
        label: 'Flare',
        note: { byAnswer: 'kind', values: { storm: words } },
      });
    expect(note('x'.repeat(L.textLength)).problems).toEqual([]);
    expect(note('x'.repeat(L.textLength + 1)).problems[0]).toMatch(
      /"note.storm" is at most 500 characters/,
    );
    expect(note(3).problems).toHaveLength(1);
  });

  it('names a field a strict reading does not know in the table', () => {
    const set = builtIn([
      { kind: 'resist', damageType: { byGrant: { light: 'fire' }, values: { a: 'b' } } },
    ]);
    expect(set.problems[0]).toMatch(
      /"damageType.values" is not a field a table by the spell granted reads/,
    );
  });

  it('is refused in play, where there is no entry to answer', () => {
    const refused = storedInPlay([resist({ byGrant: { light: 'fire' } })]);
    expect(refused.problems[0]?.why).toMatch(/not by an answer or a spell granted/);
    // Read with the list beside it, a table of a pick it asks is refused for being in play.
    expect(storedInPlay([resist(byKind), KIND]).problems).toEqual([
      {
        place: 1,
        why: 'an effect in play takes words as written, not by an answer or a spell granted',
      },
      {
        place: 2,
        why: 'an effect in play changes only numbers and rolls, not proficiencies, uses or actions',
      },
    ]);
  });

  it("says each effect in play by its place in the list, as the list's reader read it", () => {
    const outcome = (effects: unknown[]) =>
      readMoments(
        [
          {
            at: 'zeroHp',
            do: [{ kind: 'addEffect', name: 'Glow', effects, lasts: { minutes: 1 } }],
          },
        ],
        'Pack',
      );
    const ac = { kind: 'acBonus', amount: 1 };
    const read = outcome([resist(byKind), KIND, ac]);
    expect(read.problems).toEqual([
      'moment 1 (zeroHp), outcome 1: effect 1 (resist): an effect in play takes words as written, not by an answer or a spell granted',
      'moment 1 (zeroHp), outcome 1: effect 2 (pick): an effect in play reaches only numbers and rolls',
    ]);
    const [added] = read.moments[0]?.do ?? [];
    expect(added?.kind === 'addEffect' && added.places).toEqual([3]);
    // A pick asked twice is left out of the list read whole, so the places after it hold.
    const twice = outcome([KIND, KIND, ac]);
    const [kept] = twice.moments[0]?.do ?? [];
    expect(kept?.kind === 'addEffect' && kept.places).toEqual([3]);
  });
});
