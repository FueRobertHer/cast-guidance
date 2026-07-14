import { describe, expect, it } from 'vitest';
import { engineContextFor } from './engineAdapter';
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
