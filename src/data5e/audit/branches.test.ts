import { describe, expect, it } from 'vitest';
import type { Entity } from '../copyMod';
import { normalizeDataset } from '../normalize';
import { branchNames, findBranchBlocks } from './branches';

const registry = (files: Record<string, unknown>) =>
  normalizeDataset(new Map(Object.entries(files)));

describe('findBranchBlocks', () => {
  it('flags a two-name block whose prose does not say it is a choice', () => {
    const reg = registry({
      'class/class-druid.json': {
        subclass: [
          {
            name: 'Circle of Test',
            source: 'HB',
            additionalSpells: [
              { name: 'Arctic', prepared: { '3': ['hold person'] } },
              { name: 'Coast', prepared: { '3': ['mirror image'] } },
            ],
          },
        ],
      },
    });
    expect(findBranchBlocks(reg)).toEqual([
      {
        uid: 'circle of test|hb',
        key: 'subclass',
        names: ['Arctic', 'Coast'],
        choiceWording: false,
      },
    ]);
  });

  it('marks a block whose own prose offers the choice', () => {
    const reg = registry({
      'feats.json': {
        feat: [
          {
            name: 'Test Initiate',
            source: 'HB',
            entries: [{ type: 'entries', entries: ['Pick one of the colleges below.'] }],
            additionalSpells: [
              { name: 'Lorehold', known: { _: ['light'] } },
              { name: 'Prismari', known: { _: ['fire bolt'] } },
              { name: 'Prismari', known: { _: ['prestidigitation'] } },
            ],
          },
        ],
      },
    });
    expect(findBranchBlocks(reg)).toEqual([
      {
        uid: 'test initiate|hb',
        key: 'feat',
        names: ['Lorehold', 'Prismari'],
        choiceWording: true,
      },
    ]);
  });

  it('reads prose a _copy brought in, as the app does', () => {
    // Raw, the copy's entries are only inside `_copy`; the registry has them.
    const reg = registry({
      'races.json': {
        race: [
          { name: 'Elf', source: 'PHB', entries: ['Choose a lineage from the table.'] },
          {
            name: 'Elf',
            source: 'HB',
            _copy: { name: 'Elf', source: 'PHB' },
            additionalSpells: [{ name: 'Lorwyn' }, { name: 'Shadowmoor' }],
          },
        ],
      },
    });
    expect(findBranchBlocks(reg)).toEqual([
      { uid: 'elf|hb', key: 'race', names: ['Lorwyn', 'Shadowmoor'], choiceWording: true },
    ]);
  });

  it('ignores single-name and unnamed blocks', () => {
    const reg = registry({
      'feats.json': {
        feat: [
          {
            name: 'Fey Touched',
            source: 'HB',
            additionalSpells: [{ name: 'Only', known: { _: ['misty step'] } }, { known: {} }],
          },
          { name: 'Unnamed', source: 'HB', additionalSpells: [{ known: {} }, { name: '' }] },
          { name: 'None', source: 'HB' },
        ],
      },
    });
    expect(findBranchBlocks(reg)).toEqual([]);
  });
});

describe('branchNames', () => {
  it('keeps distinct non-empty string names in file order', () => {
    const block: Entity[] = [
      { name: 'B' },
      { name: 'A' },
      { name: 'B' },
      { name: 3 },
      { name: '' },
    ];
    expect(branchNames([...block, null, 'x'])).toEqual(['B', 'A']);
    expect(branchNames(undefined)).toEqual([]);
  });
});
