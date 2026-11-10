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
const valor = (effects: unknown, more: Record<string, unknown> = {}) => ({
  name: 'Valor Hymn',
  source: 'MyHomebrew',
  level: 1,
  school: 'E',
  range: { type: 'point', distance: { type: 'feet', amount: 30 } },
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['You sing, and up to three creatures {@dice 1d4} braver. They add it to attacks.'],
  castGuidance: { v: 1, effects },
  ...more,
});

const DIE_ON_ATTACKS = { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } };

/** A homebrew potion that adds to hit points while it lasts. */
const grit = (more: Record<string, unknown> = {}) => ({
  name: 'Draught of Grit',
  source: 'MyHomebrew',
  type: 'P',
  entries: ['You feel tough.'],
  castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount: 5 }] },
  ...more,
});

const data = (types: Record<string, unknown[]>): EntriesByType => ({
  byType: (type) => types[type] ?? [],
});

describe('homebrewLanding', () => {
  it('reads a spell that puts an effect on a target as a + Effect entry', () => {
    const { entry, problems } = homebrewLanding(valor([DIE_ON_ATTACKS]), 'spell');
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
    const { entry } = homebrewLanding(valor([DIE_ON_ATTACKS]), 'spell');
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

  it('lasts as long as the spell says, and lands only on its caster when its range is Self', () => {
    const { entry } = homebrewLanding(
      valor([{ kind: 'acBonus', amount: 5 }], {
        range: { type: 'point', distance: { type: 'self' } },
        duration: [{ type: 'timed', duration: { type: 'hour', amount: 8 } }],
      }),
      'spell',
    );
    expect(entry?.lasts).toEqual({ minutes: 480 });
    expect(entry?.self).toBe(true);
    const instant = homebrewLanding(
      valor([{ kind: 'acBonus', amount: 5 }], { duration: [{ type: 'instant' }] }),
      'spell',
    );
    expect(instant.entry?.lasts).toEqual({});
    expect(instant.entry?.lastsSay).toBe('Until you end it');
  });

  it('reads a potion, until its drinker ends it', () => {
    const { entry } = homebrewLanding(grit(), 'item');
    expect(entry).toMatchObject({
      id: 'homebrew:item:draught of grit|myhomebrew',
      what: 'Potion',
      lasts: {},
      lastsSay: 'Until you end it',
    });
    expect(homebrewLanding(grit({ type: 'P|XDMG' }), 'item').entry?.what).toBe('Potion');
    expect(homebrewLanding(grit({ entries: undefined }), 'item').entry?.sum).toBe(
      'What its maker says it does',
    );
  });

  it('offers no other item, as what one does is what it does while worn', () => {
    for (const type of ['RG', 'RD', 'M', 'LA', undefined, 7]) {
      expect(
        homebrewLanding(
          grit({ name: 'Ring of Nerve', type, castGuidance: { v: 1, effects: [DIS_ATTACKS] } }),
          'item',
        ),
      ).toEqual({ problems: [] });
    }
  });

  it('offers only what an effect in play holds, and says why the rest is left out', () => {
    const { entry, problems } = homebrewLanding(
      valor([
        DIE_ON_ATTACKS,
        { kind: 'skillProf', skill: 'Stealth', level: 1 },
        { kind: 'acBonus', amount: { f: 'prof' } },
      ]),
      'spell',
    );
    expect(landEntry(entry ?? (undefined as never), {}, 'x').effect.parts).toEqual([
      DIE_ON_ATTACKS,
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^Valor Hymn: effect 2 does not count: an effect on a target/);
  });

  it('offers nothing with nothing to land, and nothing from a newer file', () => {
    expect(homebrewLanding(valor([]), 'spell').entry).toBeUndefined();
    expect(
      homebrewLanding(valor([{ kind: 'language', name: 'x' }]), 'spell').entry,
    ).toBeUndefined();
    const newer = valor([DIE_ON_ATTACKS]);
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
        { name: 7, castGuidance: { v: 1, effects: [DIE_ON_ATTACKS] } },
        valor('all of it'),
        valor(nested(100_000)),
        valor([nested(100_000)]),
        valor([DIE_ON_ATTACKS], {
          duration: nested(100_000),
          range: nested(100_000),
          entries: nested(10),
        }),
      ]) {
        expect(() => homebrewLanding(bad, 'spell')).not.toThrow();
      }
      expect(homebrewLanding(valor([nested(100_000)]), 'spell').entry).toBeUndefined();
      expect(homebrewLanding(valor('all of it'), 'spell').entry).toBeUndefined();
    });

    it('builds parts from known fields only, and keeps a long text short', () => {
      const { entry } = homebrewLanding(
        valor([{ ...DIE_ON_ATTACKS, evil: nested(100_000) }], {
          entries: ['word '.repeat(500)],
          duration: [
            { type: 'timed', duration: { type: 'minute', amount: 1, x: 1 }, concentration: 'yes' },
          ],
        }),
        'spell',
      );
      expect(landEntry(entry ?? (undefined as never), {}, 'x').effect.parts).toEqual([
        DIE_ON_ATTACKS,
      ]);
      expect(entry?.lasts).toEqual({ minutes: 1 });
      expect(entry?.sum.length).toBeLessThanOrEqual(160);
    });

    it('never reads a duration unit from an object prototype', () => {
      for (const unit of ['constructor', 'toString', '__proto__', 'valueOf']) {
        const { entry } = homebrewLanding(
          valor([DIE_ON_ATTACKS], {
            duration: [{ type: 'timed', duration: { type: unit, amount: 1 } }],
          }),
          'spell',
        );
        expect(entry?.lasts).toEqual({});
      }
    });

    it('never reads an inherited castGuidance', () => {
      const inherited = Object.assign(
        Object.create({ castGuidance: { v: 1, effects: [DIE_ON_ATTACKS] } }),
        { name: 'Ghost', source: 'X' },
      );
      expect(homebrewLanding(inherited, 'spell').entry).toBeUndefined();
    });
  });
});

describe('homebrewCatalog', () => {
  it('lists homebrew spells and potions that put an effect on a target, and nothing else', () => {
    const { entries } = homebrewCatalog(
      data({
        spell: [
          valor([DIE_ON_ATTACKS]),
          { name: 'Fireball', source: 'PHB', level: 3 },
          valor([DIE_ON_ATTACKS], { name: 'valor hymn', source: 'Other' }),
        ],
        item: [
          grit(),
          {
            name: 'Ring of Nerve',
            source: 'MyHomebrew',
            type: 'RG',
            castGuidance: { v: 1, effects: [DIS_ATTACKS] },
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
    const { entries } = homebrewCatalog(data({ spell: [valor([DIE_ON_ATTACKS])] }));
    const all = [...catalogFor('2024'), ...entries];
    expect(searchCatalog(all, 'valor').map((e) => e.name)).toEqual(['Valor Hymn']);
    expect(searchCatalog(all, 'homebrew').map((e) => e.name)).toEqual(['Valor Hymn']);
  });

  it('lists nothing without data', () => {
    expect(homebrewCatalog(null)).toEqual({ entries: [], problems: [] });
    expect(homebrewCatalog(data({}))).toEqual({ entries: [], problems: [] });
  });
});
