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

describe('usePickSourcePolicy with collection switches (ADR-002 E2)', () => {
  it('keeps the same policy for equal switches, and changes it for different ones', () => {
    const { result, rerender } = renderHook(({ switches }) => usePickSourcePolicy([], switches), {
      initialProps: { switches: { off: ['MyHomebrew'] } as unknown },
    });
    const first = result.current;
    expect(first).toEqual({ policy: { mode: 'all', except: ['MyHomebrew'] }, scope: 'character' });

    rerender({ switches: { off: ['MyHomebrew'] } });
    expect(result.current).toBe(first);

    rerender({ switches: { on: ['MyHomebrew'] } });
    expect(result.current).toEqual({ policy: ALLOW_ALL, scope: 'device' });
  });

  it('changes the policy when only the switches turned on change', () => {
    const { result, rerender } = renderHook(
      ({ switches }) => usePickSourcePolicy(['PHB'], switches),
      { initialProps: { switches: { on: ['KIB'] } as unknown } },
    );
    expect(result.current.policy).toEqual({ mode: 'only', sources: ['PHB', 'KIB'] });
    rerender({ switches: { on: ['KIB', 'XGE'] } });
    expect(result.current.policy).toEqual({ mode: 'only', sources: ['PHB', 'KIB', 'XGE'] });
  });
});
