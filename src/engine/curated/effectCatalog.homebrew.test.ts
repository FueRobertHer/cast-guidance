import { describe, expect, it } from 'vitest';
import { readActiveEffects } from '../activeEffects';
import {
  catalogFor,
  type EntriesByType,
  homebrewCatalog,
  homebrewLanding,
  landEntry,
  searchCatalog,
} from './effectCatalog';

const DIS_ATTACKS = { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } };

/** A homebrew spell like Bless: a die on attacks for a minute, with concentration. */
const valor = (onTarget: unknown, more: Record<string, unknown> = {}) => ({
  name: 'Valor Hymn',
  source: 'MyHomebrew',
  level: 1,
  school: 'E',
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['You sing, and up to three creatures {@dice 1d4} braver. They add it to attacks.'],
  castGuidance: { v: 1, onTarget },
  ...more,
});

const DIE_ON_ATTACKS = { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } };

const data = (types: Record<string, unknown[]>): EntriesByType => ({
  byType: (type) => types[type] ?? [],
});

describe('homebrewLanding', () => {
  it('reads a spell that puts an effect on a target as a + Effect entry', () => {
    const { entry, problems } = homebrewLanding(valor({ effects: [DIE_ON_ATTACKS] }), 'spell');
    expect(problems).toEqual([]);
    expect(entry).toMatchObject({
      id: 'homebrew:spell:valor hymn|myhomebrew',
      name: 'Valor Hymn',
      what: 'Spell, 1st level',
      sum: 'You sing, and up to three creatures 1d4 braver.',
      lasts: { minutes: 1, concentration: true },
      lastsSay: 'Concentration, up to 1 minute',
      asks: [],
    });
    expect(entry?.self).toBeUndefined();
  });

  it('lands as an ordinary effect in play, read whole, its parts its own each time', () => {
    const { entry } = homebrewLanding(valor({ effects: [DIE_ON_ATTACKS] }), 'spell');
    if (entry === undefined) throw new Error('no entry');
    const one = landEntry(entry, {}, 'a').effect;
    const two = landEntry(entry, {}, 'b').effect;
    expect(one).toEqual({
      id: 'a',
      name: 'Valor Hymn',
      parts: [DIE_ON_ATTACKS],
      lasts: { minutes: 1, concentration: true },
    });
    expect(readActiveEffects([one]).effects).toEqual([one]);
    expect(one.parts[0]).not.toBe(two.parts[0]);
  });

  it('takes its own duration, chip name and self over the spell’s', () => {
    const { entry } = homebrewLanding(
      valor({
        effects: [{ kind: 'acBonus', amount: 5 }],
        lasts: { minutes: 10 },
        name: 'Hymn ward',
        self: true,
      }),
      'spell',
    );
    if (entry === undefined) throw new Error('no entry');
    expect(entry.lasts).toEqual({ minutes: 10 });
    expect(entry.self).toBe(true);
    expect(landEntry(entry, {}, 'x').effect.name).toBe('Hymn ward');
  });

  it('reads an item, and calls a potion one', () => {
    const potion = homebrewLanding(
      {
        name: 'Draught of Grit',
        source: 'MyHomebrew',
        type: 'P',
        entries: ['You feel tough.'],
        castGuidance: { v: 1, onTarget: { effects: [{ kind: 'maxHpBonus', amount: 5 }] } },
      },
      'item',
    );
    expect(potion.entry?.what).toBe('Potion');
    expect(potion.entry?.lasts).toEqual({});
    expect(potion.entry?.lastsSay).toBe('Until you end it');
    const ring = homebrewLanding(
      {
        name: 'Ring of Nerve',
        source: 'MyHomebrew',
        type: 'RG',
        castGuidance: { v: 1, onTarget: { effects: [DIS_ATTACKS], self: true } },
      },
      'item',
    );
    expect(ring.entry?.what).toBe('Item');
    expect(ring.entry?.self).toBeUndefined();
    expect(ring.entry?.sum).toBe('What its maker says it does');
  });

  it('offers only what an effect in play holds, and says why the rest is left out', () => {
    const { entry, problems } = homebrewLanding(
      valor({
        effects: [
          DIE_ON_ATTACKS,
          { kind: 'skillProf', skill: 'Stealth', level: 1 },
          { kind: 'acBonus', amount: { f: 'prof' } },
        ],
      }),
      'spell',
    );
    expect(landEntry(entry ?? (undefined as never), {}, 'x').effect.parts).toEqual([
      DIE_ON_ATTACKS,
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^Valor Hymn: effect 2 does not count: an effect on a target/);
  });

  it('offers nothing with nothing to land, and nothing from a newer or unversioned file', () => {
    expect(homebrewLanding(valor({ effects: [] }), 'spell').entry).toBeUndefined();
    expect(
      homebrewLanding(valor({ effects: [{ kind: 'language', name: 'x' }] }), 'spell').entry,
    ).toBeUndefined();
    const newer = valor({ effects: [DIE_ON_ATTACKS] });
    newer.castGuidance = { ...newer.castGuidance, v: 9 };
    expect(homebrewLanding(newer, 'spell')).toEqual({
      problems: ['Valor Hymn: made with a newer Cast Guidance: update to use its mechanics.'],
    });
    expect(homebrewLanding(valor(undefined), 'spell')).toEqual({ problems: [] });
  });

  describe('hostile input', () => {
    const nested = (depth: number) => {
      let x: Record<string, unknown> = { end: true };
      for (let i = 0; i < depth; i++) x = { next: x };
      return x;
    };

    it('never throws and offers nothing it cannot read', () => {
      for (const bad of [
        null,
        'spell',
        { name: 7, castGuidance: { v: 1, onTarget: { effects: [DIE_ON_ATTACKS] } } },
        valor('all of it'),
        valor({ effects: 'all' }),
        valor({ effects: [nested(100_000)] }),
        valor(nested(100_000)),
        valor({ effects: [DIE_ON_ATTACKS] }, { duration: nested(100_000), entries: nested(10) }),
      ]) {
        expect(() => homebrewLanding(bad, 'spell')).not.toThrow();
      }
      expect(homebrewLanding(valor({ effects: [nested(100_000)] }), 'spell').entry).toBeUndefined();
    });

    it('builds parts from known fields only, and keeps a long text short', () => {
      const { entry } = homebrewLanding(
        valor(
          { effects: [{ ...DIE_ON_ATTACKS, evil: nested(100_000) }], lasts: { minutes: 1, x: 1 } },
          { entries: ['word '.repeat(500)] },
        ),
        'spell',
      );
      expect(landEntry(entry ?? (undefined as never), {}, 'x').effect.parts).toEqual([
        DIE_ON_ATTACKS,
      ]);
      expect(entry?.lasts).toEqual({ minutes: 1 });
      expect(entry?.sum.length).toBeLessThanOrEqual(160);
    });

    it('never reads an inherited castGuidance', () => {
      const inherited = Object.assign(
        Object.create({ castGuidance: { v: 1, onTarget: { effects: [DIE_ON_ATTACKS] } } }),
        { name: 'Ghost', source: 'X' },
      );
      expect(homebrewLanding(inherited, 'spell').entry).toBeUndefined();
    });
  });
});

describe('homebrewCatalog', () => {
  it('lists homebrew spells and items that put an effect on a target, and nothing else', () => {
    const { entries } = homebrewCatalog(
      data({
        spell: [
          valor({ effects: [DIE_ON_ATTACKS] }),
          { name: 'Fireball', source: 'PHB', level: 3 },
          valor({ effects: [DIE_ON_ATTACKS] }, { name: 'valor hymn', source: 'Other' }),
        ],
        item: [
          {
            name: 'Draught of Grit',
            source: 'MyHomebrew',
            type: 'P',
            castGuidance: { v: 1, onTarget: { effects: [{ kind: 'maxHpBonus', amount: 5 }] } },
          },
          { name: 'Longsword', source: 'PHB', castGuidance: { v: 1, effects: [] } },
        ],
      }),
    );
    expect(entries.map((e) => `${e.what}: ${e.name}`)).toEqual([
      'Spell, 1st level: Valor Hymn',
      'Potion: Draught of Grit',
    ]);
  });

  it('is found by + Effect’s search beside the built-in catalog', () => {
    const { entries } = homebrewCatalog(data({ spell: [valor({ effects: [DIE_ON_ATTACKS] })] }));
    const all = [...catalogFor('2024'), ...entries];
    expect(searchCatalog(all, 'valor').map((e) => e.name)).toEqual(['Valor Hymn']);
    expect(searchCatalog(all, 'homebrew').map((e) => e.name)).toEqual(['Valor Hymn']);
  });

  it('lists nothing without data', () => {
    expect(homebrewCatalog(null)).toEqual({ entries: [], problems: [] });
    expect(homebrewCatalog(data({}))).toEqual({ entries: [], problems: [] });
  });
});
