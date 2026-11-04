import { describe, expect, it } from 'vitest';
import {
  compareBooks,
  countTitles,
  groupHits,
  groupTitles,
  type Hit,
  preferredPrinting,
  sourceOf,
  titleKey,
} from './printings';

const fireball2014 = { name: 'Fireball', source: 'PHB', reprintedAs: ['Fireball|XPHB'] };
const fireball2024 = { name: 'Fireball', source: 'XPHB' };

describe('titleKey', () => {
  it('ignores case, since homebrew spells its names by hand', () => {
    expect(titleKey('spell', { name: 'FireBall', source: 'Brew' })).toBe(
      titleKey('spell', fireball2014),
    );
  });

  it('keeps same-named subclasses of different classes apart, as they are different subclasses', () => {
    const fighter = { name: 'Guardian', source: 'Brew', className: 'Fighter' };
    const ranger = { name: 'Guardian', source: 'Brew', className: 'Ranger' };
    expect(titleKey('subclass', fighter)).not.toBe(titleKey('subclass', ranger));
    expect(titleKey('subclass', fighter)).toBe(
      titleKey('subclass', { ...fighter, source: 'XPHB' }),
    );
  });
});

describe('compareBooks', () => {
  it('puts the core books first, each 2014 book before its revision, and homebrew last', () => {
    expect(['MyBrew', 'XGE', 'XPHB', 'PHB', 'DMG'].sort(compareBooks)).toEqual([
      'DMG',
      'PHB',
      'XPHB',
      'XGE',
      'MyBrew',
    ]);
  });
});

describe('preferredPrinting', () => {
  it('opens the printing the others were reprinted as', () => {
    expect(preferredPrinting('spell', [fireball2014, fireball2024])).toBe(fireball2024);
  });

  it('opens the first in book order when nothing says one replaces another', () => {
    const brew = { name: 'Fireball', source: 'MyBrew' };
    const plain = { name: 'Fireball', source: 'PHB' };
    expect(preferredPrinting('spell', [plain, brew])).toBe(plain);
  });

  it('reads a subclass reprint by its four-part uid', () => {
    const old = {
      name: 'Champion',
      shortName: 'Champion',
      source: 'PHB',
      className: 'Fighter',
      reprintedAs: ['Champion|Fighter|XPHB|XPHB'],
    };
    const revised = {
      name: 'Champion',
      shortName: 'Champion',
      source: 'XPHB',
      className: 'Fighter',
    };
    expect(preferredPrinting('subclass', [old, revised])).toBe(revised);
  });

  it('still opens something when hand-written reprint marks go in a circle', () => {
    const a = { name: 'Loop', source: 'BrewA', reprintedAs: ['Loop|BrewB'] };
    const b = { name: 'Loop', source: 'BrewB', reprintedAs: ['Loop|BrewA'] };
    expect(preferredPrinting('spell', [a, b])).toBe(a);
  });
});

describe('groupTitles', () => {
  it('makes one title of every printing, in the order the titles first appear', () => {
    const toll = { name: 'Toll the Dead', source: 'XGE' };
    const titles = groupTitles('spell', [fireball2024, fireball2014, toll]);
    expect(titles.map((t) => t.name)).toEqual(['Fireball', 'Toll the Dead']);
    // Book order, whatever order the list had them in.
    expect(titles[0]?.printings.map(sourceOf)).toEqual(['PHB', 'XPHB']);
    expect(titles[0]?.preferred).toBe(fireball2024);
  });

  it('drops a second entity with a uid already seen, as the registry does', () => {
    const shadow = { name: 'fireball', source: 'phb' };
    const [title] = groupTitles('spell', [fireball2014, shadow]);
    expect(title?.printings).toEqual([fireball2014]);
  });

  it('counts what it would group', () => {
    const list = [fireball2014, fireball2024, { name: 'Toll the Dead', source: 'XGE' }];
    expect(countTitles('spell', list)).toBe(groupTitles('spell', list).length);
  });
});

describe('groupHits', () => {
  const hit = (type: string, name: string, source: string): Hit => ({
    type,
    name,
    source,
    uid: `${name}|${source}`.toLowerCase(),
  });
  const entities = [fireball2014, fireball2024];
  const resolve = (h: Hit) =>
    entities.find((e) => e.name === h.name && e.source === h.source && h.type === 'spell');

  it('makes one row per title, ranked by its best hit, opening the preferred printing', () => {
    const rows = groupHits(
      [
        hit('spell', 'Fireball', 'PHB'),
        hit('item', 'Fire Opal', 'DMG'),
        hit('spell', 'Fireball', 'XPHB'),
      ],
      resolve,
    );
    expect(rows.map((r) => r.name)).toEqual(['Fireball', 'Fire Opal']);
    expect(rows[0]?.sources).toEqual(['PHB', 'XPHB']);
    expect(rows[0]?.uid).toBe('fireball|xphb');
  });

  it('keeps types apart, since a spell and an item of one name are two things', () => {
    const rows = groupHits([hit('spell', 'Shield', 'PHB'), hit('item', 'Shield', 'PHB')], resolve);
    expect(rows).toHaveLength(2);
  });

  it('opens the best-ranked hit when it cannot read every printing', () => {
    const rows = groupHits(
      [hit('spell', 'Fireball', 'MyBrew'), hit('spell', 'Fireball', 'XPHB')],
      resolve,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.uid).toBe('fireball|mybrew');
  });
});
