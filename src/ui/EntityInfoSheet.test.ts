import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { type ChangedEntry, type ChangeLayer, EntityRegistry } from '@/data5e/normalize';
import { changedBy } from './EntityInfoSheet';

// ADR-002 U11: the Changed note names the change the sheet shows. The shared
// registry keeps a pack applied to some characters among an entry's layers
// without applying it (E3); a character's view applies each layer it keeps.
describe('changedBy', () => {
  const aid = { name: 'Aid', source: 'XPHB' } as Entity;
  const reg = new EntityRegistry();
  reg.setRulePacks([
    { name: 'Pack A', source: 'PA' } as Entity,
    { name: 'Pack B', source: 'PB' } as Entity,
  ]);
  const layer = (source: string, shared: boolean, characters: string[]): ChangeLayer => ({
    from: {
      kind: 'pack',
      fileId: source,
      source,
      reach: { characters, appDefault: shared },
    },
    entry: aid,
    below: aid,
    shared,
    needsLook: [],
  });
  const record = (layers: ChangeLayer[]): ChangedEntry => ({
    type: 'spell',
    base: aid,
    layers,
    placed: { ...aid },
  });
  // Pack A applies to everyone; Pack B to Hild alone, above it.
  const both = record([layer('PA', true, []), layer('PB', false, ['hild'])]);

  it('names the top change applied, not one the shared registry only lists', () => {
    // Bram's sheet reads the shared registry: Pack B is listed there, not applied.
    expect(changedBy(reg, both)).toBe('the rule pack Pack A');
    expect(changedBy(reg, both, { id: 'bram' })).toBe('the rule pack Pack A');
  });

  it('names a pack applied to this character alone on that character’s sheet', () => {
    expect(changedBy(reg, both, { id: 'hild' })).toBe('the rule pack Pack B');
  });

  it('names Changes to the books when they are on top', () => {
    const changes: ChangeLayer = {
      from: { kind: 'changes', fileId: 'c', source: 'MyChanges' },
      entry: aid,
      below: aid,
      shared: true,
      needsLook: [],
    };
    expect(changedBy(reg, record([layer('PA', true, []), changes]))).toBe('Changes to the books');
  });
});
