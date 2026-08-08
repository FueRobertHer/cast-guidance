import { describe, expect, it } from 'vitest';
import { EntityRegistry } from './normalize';

function registryWith(entries: Array<[type: string, name: string, source: string]>) {
  const reg = new EntityRegistry();
  for (const [type, name, source] of entries) {
    // biome-ignore lint/suspicious/noExplicitAny: EntityType is a closed union; tests build arbitrary ones
    reg.addAll(type as any, [{ name, source }]);
  }
  return reg;
}

describe('EntityRegistry.sourceCounts', () => {
  it('tallies pickable entries per source', () => {
    const counts = registryWith([
      ['race', 'Human', 'PHB'],
      ['race', 'Elf', 'PHB'],
      ['spell', 'Fireball', 'PHB'],
      ['feat', 'Alert', 'XPHB'],
    ]).sourceCounts();
    expect(counts.get('PHB')).toBe(3);
    expect(counts.get('XPHB')).toBe(1);
  });

  it('ignores class and subclass features, which come with the class', () => {
    // Left uncounted because they are not chosen and they outnumber everything
    // else severalfold, which would turn the settings number into noise.
    const counts = registryWith([
      ['class', 'Fighter', 'PHB'],
      ['classFeature', 'Second Wind', 'PHB'],
      ['subclassFeature', 'Improved Critical', 'PHB'],
    ]).sourceCounts();
    expect(counts.get('PHB')).toBe(1);
  });

  it('counts languages, skills, and senses', () => {
    // The 2024 Monster Manual reaches this app as languages and nothing else,
    // because no bestiary is loaded. Leaving these types out made XMM impossible
    // to list in settings even though a preset names it, so it could be hidden
    // with no way to bring it back.
    const counts = registryWith([
      ['language', 'Common', 'XMM'],
      ['skill', 'Athletics', 'XPHB'],
      ['sense', 'Darkvision', 'XPHB'],
    ]).sourceCounts();
    expect(counts.get('XMM')).toBe(1);
    expect(counts.get('XPHB')).toBe(2);
  });

  it('skips entries with no source rather than inventing a bucket', () => {
    const reg = new EntityRegistry();
    reg.addAll('race', [{ name: 'Nameless' }]);
    expect(reg.sourceCounts().size).toBe(0);
  });

  it('is empty for an empty registry', () => {
    expect(new EntityRegistry().sourceCounts().size).toBe(0);
  });
});
