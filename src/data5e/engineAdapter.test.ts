import { describe, expect, it } from 'vitest';
import { engineContextFor, entityLookup } from './engineAdapter';
import { EntityRegistry } from './normalize';

describe('engineContextFor', () => {
  it('delegates get/byType to the registry', () => {
    const reg = new EntityRegistry();
    reg.addAll('spell', [
      { name: 'Fireball', source: 'PHB' },
      { name: 'Shield', source: 'PHB' },
    ]);
    const ctx = engineContextFor(reg);

    expect(ctx.get('spell', 'Fireball', 'PHB')).toMatchObject({ name: 'Fireball' });
    expect(ctx.get('spell', 'Missing', 'PHB')).toBeUndefined();
    expect(ctx.byType('spell')).toHaveLength(2);
    expect(ctx.byType('feat')).toEqual([]);
  });
});

describe('entityLookup', () => {
  it('is one object per registry, reading it as it is now', () => {
    const reg = new EntityRegistry();
    const lookup = entityLookup(reg);
    expect(entityLookup(reg)).toBe(lookup);
    expect(entityLookup(new EntityRegistry())).not.toBe(lookup);
    reg.addAll('item', [{ name: 'Rod of Sparks', source: 'HB' }]);
    expect(lookup.get('item', 'Rod of Sparks', 'HB')).toMatchObject({ name: 'Rod of Sparks' });
    expect(lookup.byType('item')).toHaveLength(1);
  });
});
