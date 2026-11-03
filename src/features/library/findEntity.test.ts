import { describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { findEntity } from './findEntity';

const phb = { name: "Player's Handbook (2014)", id: 'PHB', source: 'PHB' };
const kaladesh = { name: 'Plane Shift: Kaladesh', id: 'PS-K', source: 'PSK' };
const brewBook = { name: 'My Brew', source: 'MyBrew' };
const berserker = {
  name: 'Path of the Berserker',
  shortName: 'Berserker',
  source: 'PHB',
  className: 'Barbarian',
  classSource: 'PHB',
};
const berserker2024 = { ...berserker, source: 'XPHB', classSource: 'XPHB' };
const brewSubclass = {
  name: 'Oathless',
  source: 'MyBrew',
  className: 'Paladin',
  classSource: 'PHB',
};

function registry(): EntityRegistry {
  const reg = new EntityRegistry();
  reg.addAll('book', [phb, kaladesh, brewBook]);
  reg.addAll('subclass', [berserker, berserker2024, brewSubclass]);
  reg.addAll('spell', [{ name: 'Fireball', source: 'PHB' }]);
  return reg;
}

describe('findEntity', () => {
  it('finds an entity by the name|source the Library links with', () => {
    expect(findEntity(registry(), 'book', "player's handbook (2014)|phb")).toBe(phb);
    expect(findEntity(registry(), 'subclass', 'path of the berserker|xphb')).toBe(berserker2024);
    expect(findEntity(registry(), 'spell', 'fireball')?.name).toBe('Fireball');
  });

  it('finds a book by the id a {@book} tag names it by, which can differ from its source', () => {
    expect(findEntity(registry(), 'book', 'phb')).toBe(phb);
    expect(findEntity(registry(), 'book', 'ps-k')).toBe(kaladesh);
    expect(findEntity(registry(), 'book', 'PS-K')).toBe(kaladesh);
  });

  it('finds a book with no id by its source', () => {
    expect(findEntity(registry(), 'book', 'mybrew')).toBe(brewBook);
  });

  it('takes a book by its id before a book that is only named like it', () => {
    const reg = registry();
    const namedPhb = { name: 'PHB', source: 'Brew' };
    reg.addAll('book', [namedPhb]);
    expect(findEntity(reg, 'book', 'phb')).toBe(phb);
    expect(findEntity(reg, 'book', 'phb|brew')).toBe(namedPhb);
  });

  it("finds a subclass by a {@subclass} tag's short name, class and sources", () => {
    expect(findEntity(registry(), 'subclass', 'berserker|barbarian|phb|phb')).toBe(berserker);
    expect(findEntity(registry(), 'subclass', 'berserker|barbarian|xphb|xphb')).toBe(berserker2024);
    // A subclass with no short name goes by its name.
    expect(findEntity(registry(), 'subclass', 'oathless|paladin|phb|mybrew')).toBe(brewSubclass);
  });

  it('finds nothing for a subclass of another class or source', () => {
    expect(findEntity(registry(), 'subclass', 'berserker|fighter|phb|phb')).toBeUndefined();
    expect(findEntity(registry(), 'subclass', 'berserker|barbarian|phb|xphb')).toBeUndefined();
  });

  it('reads the 5etools forms only for the type that uses them', () => {
    expect(findEntity(registry(), 'spell', 'phb')).toBeUndefined();
    expect(findEntity(registry(), 'book', 'berserker|barbarian|phb|phb')).toBeUndefined();
  });
});
