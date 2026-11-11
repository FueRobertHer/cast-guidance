import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import { rollEffects } from '../playRules';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { emitRollAdvantages, ROLL_ADVANTAGES } from './rollAdvantages';

const empty: EngineContext = { get: () => undefined, byType: () => [] };
const origin: EffectOrigin = { label: 'Feature', uid: 'feature|tst', type: 'feat' };

function emit(keys: string[], level?: number) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
  const found = emitRollAdvantages(col, keys, origin, level);
  return {
    found,
    rows: col.effects.filter(
      (e): e is Extract<EffectInput, { kind: 'rollAdvantage' }> => e.kind === 'rollAdvantage',
    ),
  };
}

describe('the roll advantage table', () => {
  it('words every situation as the prompt reads it, and keys every row in lowercase', () => {
    for (const [key, rows] of Object.entries(ROLL_ADVANTAGES)) {
      expect(key).toBe(key.toLowerCase());
      for (const row of rows) {
        if (row.when === undefined) continue;
        expect(row.when, key).toMatch(/^Only /);
        expect(row.when, key).not.toMatch(/[–—.]$/);
      }
    }
  });

  it('adds nothing, and says so, for keys it has no row for', () => {
    expect(emit(['nothing|tst'])).toEqual({ found: false, rows: [] });
  });

  it('stops at the first key that has rows', () => {
    expect(emit(['brave|phb', 'feral instinct|barbarian|phb']).rows.map((r) => r.on)).toEqual([
      { rolls: ['save'] },
    ]);
  });

  it('reads the first key that has rows, as advantage from the origin', () => {
    const { found, rows } = emit([
      'shifting feature|beasthide|erlw',
      'feral instinct|barbarian|phb',
    ]);
    expect(found).toBe(true);
    expect(rows).toEqual([
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['check'], initiative: true },
        origin,
      },
    ]);
  });

  it('carries when it holds, and a state it holds while', () => {
    expect(emit(['brave|phb']).rows[0]).toMatchObject({
      on: { rolls: ['save'] },
      when: 'Only against being Frightened',
    });
    expect(emit(['purple dragon commandant|frhof']).rows[0]).toMatchObject({
      on: { rolls: ['attack'] },
      while: [{ state: 'bloodied' }],
    });
  });

  it('tells option features of one name apart by their level', () => {
    const bear = (level: number) => emit(['bear|path of the totem warrior|phb'], level).rows;
    expect(bear(3)).toEqual([]);
    expect(bear(6)).toHaveLength(1);
    expect(bear(14)).toEqual([]);
  });
});

describe('roll advantages on a derived sheet', () => {
  const FEATS: DataEntity[] = [
    { name: 'War Caster', source: 'PHB', entries: ['Placeholder text.'] },
    { name: 'Durable', source: 'XPHB', entries: ['Placeholder text.'] },
    { name: 'Purple Dragon Commandant', source: 'FRHoF', entries: ['Placeholder text.'] },
  ];
  const trait = (name: string) => ({ name, type: 'entries', entries: ['Placeholder text.'] });
  const RACES: DataEntity[] = [
    { name: 'Halfling', source: 'PHB', entries: [trait('Brave')] },
    // Two traits of one name in one book: only the Reborn's gives advantage.
    { name: 'Reborn', source: 'VRGR', entries: [trait('Deathless Nature')] },
    { name: 'Dhampir', source: 'VRGR', entries: [trait('Deathless Nature')] },
    // A Brave of the book's, with a row of its own race's beside it.
    { name: 'Kithkin', source: 'PHB', entries: [trait('Brave')] },
  ];
  const world = makeTestContext();
  const find = (list: DataEntity[], name: string, source?: string) =>
    list.find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    );
  const ctx: EngineContext = {
    get: (type, name, source) =>
      type === 'feat'
        ? find(FEATS, name, source)
        : type === 'race'
          ? (find(RACES, name, source) ?? world.get(type, name, source))
          : world.get(type, name, source),
    byType: (type) =>
      type === 'feat'
        ? FEATS
        : type === 'race'
          ? [...world.byType(type), ...RACES]
          : world.byType(type),
  };

  // Rows for the synthetic world's own class feature (at the level it comes)
  // and fighting style, so the class and optional feature walks are read
  // through the table as real data is, and one for a race beside its book's.
  const ADDED = {
    'grit|warrior|tst': [{ on: { rolls: ['check' as const], initiative: true }, level: 1 }],
    'archery|phb': [{ on: { rolls: ['attack' as const] }, when: 'Only at range' }],
    'brave|kithkin|phb': [{ on: { rolls: ['check' as const], initiative: true } }],
  };
  beforeAll(() => {
    Object.assign(ROLL_ADVANTAGES, ADDED);
  });
  afterAll(() => {
    for (const key of Object.keys(ADDED)) Reflect.deleteProperty(ROLL_ADVANTAGES, key);
  });

  const warrior = (edit: (doc: CharacterDoc) => void = () => undefined) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    edit(doc);
    return doc;
  };
  const withFeat = (name: string, source: string) =>
    warrior((doc) => {
      doc.feats = [{ ref: { name, source }, instanceId: 'f0' }];
    });
  const ofRace = (name: string, source: string) =>
    warrior((doc) => {
      doc.race = { name, source };
    });

  it('reads a class feature, named for the feature', () => {
    const sheet = deriveSheet(warrior(), ctx);
    expect(rollEffects(sheet, { kind: 'initiative' }).advantage).toEqual(['Grit']);
    expect(rollEffects(sheet, { kind: 'check', ability: 'dex' }).advantage).toEqual([]);
  });

  it('reads a picked optional feature', () => {
    const doc = warrior();
    const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Combat Stance')?.id;
    expect(id).toBeDefined();
    doc.choices[id ?? ''] = ['archery|phb'];
    expect(rollEffects(deriveSheet(doc, ctx), { kind: 'attack' }).declare).toEqual([
      { source: 'Combat Stance: Archery', mode: 'adv', when: 'Only at range' },
    ]);
  });

  it('gives War Caster to concentration saves and no other Constitution save', () => {
    const sheet = deriveSheet(withFeat('War Caster', 'PHB'), ctx);
    const concentrating = { kind: 'save', ability: 'con', purpose: 'concentration' } as const;
    expect(rollEffects(sheet, concentrating).advantage).toEqual(['War Caster']);
    expect(rollEffects(sheet, { kind: 'save', ability: 'con' }).advantage).toEqual([]);
  });

  it('gives 2024 Durable to death saves alone', () => {
    const sheet = deriveSheet(withFeat('Durable', 'XPHB'), ctx);
    expect(rollEffects(sheet, { kind: 'save', purpose: 'death' }).advantage).toEqual(['Durable']);
    expect(rollEffects(sheet, { kind: 'save', ability: 'con' }).advantage).toEqual([]);
  });

  it('holds a Bloodied advantage only while the character is Bloodied', () => {
    const at = (hp: number) => {
      const doc = withFeat('Purple Dragon Commandant', 'FRHoF');
      doc.play.hpInitialized = true;
      doc.play.currentHp = hp;
      return rollEffects(deriveSheet(doc, ctx), { kind: 'attack' }).advantage;
    };
    expect(at(1)).toEqual(['Purple Dragon Commandant']);
    expect(at(999)).toEqual([]);
  });

  it('offers a species trait to claim, named for the trait, and not on a death save', () => {
    const sheet = deriveSheet(ofRace('Halfling', 'PHB'), ctx);
    expect(rollEffects(sheet, { kind: 'save', ability: 'wis' }).declare).toEqual([
      { source: 'Brave', mode: 'adv', when: 'Only against being Frightened' },
    ]);
    expect(rollEffects(sheet, { kind: 'save', purpose: 'death' }).declare).toBeUndefined();
  });

  it('reads a trait by its race before its book', () => {
    const death = (name: string) =>
      rollEffects(deriveSheet(ofRace(name, 'VRGR'), ctx), { kind: 'save', purpose: 'death' });
    expect(death('Reborn').advantage).toEqual(['Deathless Nature']);
    expect(death('Dhampir').advantage).toEqual([]);
    // The race's row wins over the book's Brave, and stops there.
    const kithkin = deriveSheet(ofRace('Kithkin', 'PHB'), ctx);
    expect(rollEffects(kithkin, { kind: 'initiative' }).advantage).toContain('Brave');
    expect(rollEffects(kithkin, { kind: 'save', ability: 'wis' }).declare).toBeUndefined();
  });
});
