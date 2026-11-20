import { describe, expect, it } from 'vitest';
import { describeSpellQuery, parseSpellFilter, spellFitsQuery } from './spellQuery';
import type { SpellQuery } from './types';

const query = (over: Partial<SpellQuery>): SpellQuery => ({
  levels: [],
  classes: [],
  schools: [],
  ritual: false,
  attacks: [],
  ...over,
});

describe('parseSpellFilter', () => {
  it('reads every part the data writes', () => {
    expect(parseSpellFilter('level=1;2|class=Bard;cleric|school=e;D|spell attack=M;r')).toEqual({
      levels: [1, 2],
      classes: ['Bard', 'cleric'],
      schools: ['E', 'D'],
      ritual: false,
      attacks: ['m', 'r'],
    });
    expect(parseSpellFilter('level=1|components & miscellaneous=ritual')?.ritual).toBe(true);
  });

  it.each([
    ['a key it does not know', 'level=1|sparkle=yes'],
    ['a level that is not a number', 'level=low'],
    ['a miscellaneous item a spell does not carry', 'components & miscellaneous=legacy'],
    ['a miscellaneous item 5etools does not have', 'components & miscellaneous=sparkly'],
    ['an area style it does not know', 'area style=X'],
    ['a creature type that is not a standard one', 'affects creature types=vehicle'],
    ['an ability check by its short name', 'ability check=str'],
    ['a tag ruled out, which it cannot read', 'area style=!C'],
    ['a part with no value', 'level='],
    ['a book ruled out with no name', 'source=EGW;!'],
  ])('gives up on %s, rather than offer spells the data rules out', (_what, filter) => {
    expect(parseSpellFilter(filter)).toBeUndefined();
  });

  it("reads 5etools' tag filters by their keys, in any case", () => {
    expect(
      parseSpellFilter(
        'level=1|area style=c;st|affects creature types=Undead|ability check=Strength|components & miscellaneous=HL;royalty;Concentration',
      ),
    ).toEqual({
      ...query({ levels: [1] }),
      areas: ['C', 'ST'],
      creatureTypes: ['undead'],
      checks: ['strength'],
      misc: ['hl', 'royalty', 'concentration'],
    });
    // Ritual alone stays the ritual flag; with others it is one of them.
    expect(parseSpellFilter('components & miscellaneous=ritual')).toEqual(query({ ritual: true }));
    expect(parseSpellFilter('components & miscellaneous=ritual;ritual')).toEqual(
      query({ ritual: true }),
    );
    expect(parseSpellFilter('components & miscellaneous=ritual;hl')).toEqual({
      ...query({}),
      misc: ['ritual', 'hl'],
    });
  });

  it('reads the books a spell is printed in, and the ones it is not', () => {
    // Chronurgy and Graviturgy's expanded lists.
    expect(parseSpellFilter('source=EGW;!xge')).toEqual(
      query({ sources: ['EGW'], notSources: ['XGE'] }),
    );
  });

  it('reads an empty filter as ruling nothing out', () => {
    expect(parseSpellFilter('')).toEqual(query({}));
  });
});

describe('spellFitsQuery', () => {
  const spell = {
    name: 'Fake',
    source: 'HB',
    level: 1,
    school: 'E',
    meta: { ritual: true },
    spellAttack: ['R'],
  };

  it('holds a spell to every part of the query', () => {
    const all = query({ levels: [1], schools: ['E', 'D'], ritual: true, attacks: ['m', 'r'] });
    expect(spellFitsQuery(spell, all)).toBe(true);
  });

  it.each<[string, Partial<SpellQuery>]>([
    ['level', { levels: [0, 2] }],
    ['school', { schools: ['N'] }],
    ['attack', { attacks: ['m'] }],
  ])('fails on %s', (_part, over) => {
    expect(spellFitsQuery(spell, query(over))).toBe(false);
  });

  it('fails a ritual query for a spell that is no ritual', () => {
    expect(spellFitsQuery({ ...spell, meta: {} }, query({ ritual: true }))).toBe(false);
    expect(spellFitsQuery({ name: 'Plain', source: 'HB' }, query({ ritual: true }))).toBe(false);
  });

  it('holds a spell to the books named, in any case, and keeps it out of the ones ruled out', () => {
    const books = query({ sources: ['EGW'], notSources: ['XGE'] });
    expect(spellFitsQuery({ ...spell, source: 'egw' }, books)).toBe(true);
    expect(spellFitsQuery({ ...spell, source: 'PHB' }, books)).toBe(false);
    expect(spellFitsQuery({ ...spell, source: 'XGE' }, query({ notSources: ['XGE'] }))).toBe(false);
    expect(spellFitsQuery({ ...spell, source: 'PHB' }, query({ notSources: ['XGE'] }))).toBe(true);
  });

  it('fails an attack query for a spell with no attack', () => {
    expect(spellFitsQuery({ name: 'Plain', source: 'HB' }, query({ attacks: ['r'] }))).toBe(false);
  });

  it('leaves the class lists to the caller, since a spell does not carry them', () => {
    expect(spellFitsQuery(spell, query({ classes: ['Nobody'] }))).toBe(true);
  });
});

describe("spellFitsQuery with 5etools' tag filters", () => {
  /** A homebrew spell as the Workshop writes one, with every tag a filter reads. */
  const brew = {
    name: 'Grave Hymn',
    source: 'MyHomebrew',
    level: 1,
    school: 'N',
    range: { type: 'point', distance: { type: 'feet', amount: 60 } },
    components: { v: true, m: { text: 'a silver bell', cost: 500, consume: true }, r: true },
    duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
    areaTags: ['S'],
    affectsCreatureType: ['undead', 'fiend'],
    abilityCheck: ['wisdom'],
    miscTags: ['HL'],
  };
  const fits = (filter: string, s: Record<string, unknown> = brew) => {
    const q = parseSpellFilter(filter);
    if (q === undefined) throw new Error(`unread: ${filter}`);
    return spellFitsQuery(s, q);
  };

  it.each([
    ['area style', 'area style=S', 'area style=C;N'],
    ['affects creature types', 'affects creature types=beast;undead', 'affects creature types=fey'],
    ['ability check', 'ability check=wisdom', 'ability check=strength'],
    ['a misc tag', 'components & miscellaneous=hl', 'components & miscellaneous=smn'],
    ['royalty', 'components & miscellaneous=royalty', 'components & miscellaneous=somatic'],
    [
      'concentration',
      'components & miscellaneous=concentration',
      'components & miscellaneous=ritual;thp',
    ],
    [
      'a material cost and its use',
      'components & miscellaneous=material with cost',
      'components & miscellaneous=material is optionally consumed',
    ],
  ])('lets a spell in by %s, and keeps it out on another value', (_key, inFilter, outFilter) => {
    expect(fits(inFilter)).toBe(true);
    expect(fits(outFilter)).toBe(false);
  });

  it('holds a spell to every key at once', () => {
    expect(fits('level=1|area style=S|ability check=wisdom|components & miscellaneous=hl')).toBe(
      true,
    );
    expect(fits('level=1|area style=S|ability check=charisma')).toBe(false);
  });

  it('reads what 5etools works out beside the tags', () => {
    const plain = { name: 'Plain', source: 'HB', level: 1, duration: [{ type: 'instant' }] };
    // A spell that names no creature types affects every one.
    expect(fits('affects creature types=fey', plain)).toBe(true);
    // A line or an emanation range is that area style, tagged or not.
    expect(fits('area style=L', { ...plain, range: { type: 'line' } })).toBe(true);
    expect(fits('area style=E', { ...plain, range: { type: 'emanation' } })).toBe(true);
    expect(fits('area style=L', plain)).toBe(false);
    // A permanent duration is Permanent Effects, and higher-level text Scaling Effects.
    expect(
      fits('components & miscellaneous=prm', { ...plain, duration: [{ type: 'permanent' }] }),
    ).toBe(true);
    expect(fits('components & miscellaneous=scl', { ...plain, entriesHigherLevel: [{}] })).toBe(
      true,
    );
    expect(fits('components & miscellaneous=prm;scl;hl', plain)).toBe(false);
    // Material without a cost, and consumed only if the caster wishes.
    const optional = { ...plain, components: { m: { text: 'a gem', consume: 'optional' } } };
    expect(fits('components & miscellaneous=material is optionally consumed', optional)).toBe(true);
    expect(fits('components & miscellaneous=material is consumed', optional)).toBe(false);
    expect(fits('components & miscellaneous=material with cost', optional)).toBe(false);
    expect(
      fits('components & miscellaneous=material', { ...plain, components: { m: 'ash' } }),
    ).toBe(true);
    // Ritual among others is one of them.
    expect(fits('components & miscellaneous=ritual;hl', { ...plain, meta: { ritual: true } })).toBe(
      true,
    );
  });
});

describe('describeSpellQuery', () => {
  it.each<[string, string, number]>([
    ['Wizard cantrip', 'level=0|class=Wizard', 1],
    ['Wizard cantrips', 'level=0|class=wizard', 2],
    ['Level 1 Cleric spell', 'level=1|class=Cleric', 1],
    ['Level 2 to 4 spell', 'level=2;3;4', 1],
    ['Cantrip or level 1 spell', 'level=0;1', 1],
    ['Cantrip or level 2 spell', 'level=0;2', 1],
    ['Cantrip or level 1 or 3 spell', 'level=0;1;3', 1],
    ['Level 1 spell', 'level=1;1', 1],
    ['Cantrip', 'level=0;0', 1],
    ['Cantrip or level 1 to 3 Cleric or Wizard spell', 'level=0;1;2;3|class=Cleric;Wizard', 1],
    ['Level 1 Enchantment or Divination spell', 'level=1|school=E;D', 1],
    ['Level 1 Bard ritual spells', 'level=1|class=Bard|components & miscellaneous=ritual', 2],
    ['Level 1 ritual spells', 'level=1|components & miscellaneous=ritual', 2],
    ['Bard attack cantrip', 'level=0|class=Bard|spell attack=m;r;o', 1],
    ['Level 1 to 7 Abjuration spell', 'level=1;2;3;4;5;6;7|school=A', 1],
    ['Level 1 or 3 spell', 'level=1;3', 1],
    ['Cleric or Wizard Necromancy cantrip', 'level=0|class=Cleric;Wizard|school=N', 1],
    ['EGW spell', 'source=EGW', 1],
    ['EGW spell, not from XGE', 'source=EGW;!XGE', 1],
    ['Level 1 Wizard EGW spells', 'level=1|class=Wizard|source=egw', 2],
    ['Spell, not from XGE', 'source=!XGE', 1],
    ['Any spell', '', 1],
    ['Any spells', '', 2],
    [
      'Level 1 spell, tagged Healing or Royalty',
      'level=1|components & miscellaneous=hl;royalty',
      1,
    ],
    ['Spell, area style Cone or Single Target', 'area style=N;ST', 1],
    ['Spells, affecting Undead or Fiend', 'affects creature types=undead;fiend', 2],
    ['Cantrip, calling for a Strength check', 'level=0|ability check=strength', 1],
    [
      'Level 1 spell, tagged Concentration, area style Sphere, not from XGE',
      'level=1|components & miscellaneous=concentration|area style=S|source=!XGE',
      1,
    ],
  ])('says %s', (expected, filter, count) => {
    const parsed = parseSpellFilter(filter) ?? query({});
    expect(describeSpellQuery(parsed, count)).toBe(expected);
  });
});
