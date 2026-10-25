// @vitest-environment jsdom
// GAME-005: the character store clones the doc on every write, so the picker
// policy has to survive a new-but-equal source list, or every list depending
// on it refilters on an HP tick.
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ALLOW_ALL } from '@/data5e/sourceFilter';
import { usePickSourcePolicy } from './usePickSourcePolicy';

vi.mock('@/data5e/sourceFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/sourceFilter')>()),
  useSourcePolicy: () => ALLOW_ALL,
}));

describe('usePickSourcePolicy', () => {
  it('keeps the same policy for an equal list, and changes it for a different one', () => {
    const { result, rerender } = renderHook(({ sources }) => usePickSourcePolicy(sources), {
      initialProps: { sources: ['PHB', 'XGE'] },
    });
    const first = result.current;
    expect(first).toEqual({
      policy: { mode: 'only', sources: ['PHB', 'XGE'] },
      scope: 'character',
    });

    rerender({ sources: ['PHB', 'XGE'] });
    expect(result.current).toBe(first);

    rerender({ sources: ['PHB'] });
    expect(result.current.policy).toEqual({ mode: 'only', sources: ['PHB'] });
  });
});
