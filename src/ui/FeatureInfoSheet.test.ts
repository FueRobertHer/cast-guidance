import { describe, expect, it } from 'vitest';
import type { FeatureCard } from '@/engine/types';
import { findFeatureInfo } from './FeatureInfoSheet';

const rogue: FeatureCard = {
  name: 'Rogue',
  origin: { label: 'Rogue', uid: 'rogue|phb', type: 'class' },
  entries: [{ name: 'Sneak Attack', entries: ['Once per turn, deal extra damage.'] }],
};

describe('findFeatureInfo', () => {
  it('finds a feature by a label carrying a trailing annotation', () => {
    expect(findFeatureInfo([rogue], 'Sneak Attack (+1d6 once/turn)')?.title).toBe('Sneak Attack');
  });

  it('stays linear on a label full of "("', () => {
    // The budget is the test timeout; the old regex took about eleven seconds.
    expect(findFeatureInfo([rogue], `${'('.repeat(120_000)}x`)).toBeUndefined();
  }, 2000);
});
