// @vitest-environment jsdom
// useAppRules reads the registry itself once the stored rows are known, so a
// shared registry read before a pack changed never decides the rules, and it
// is not ready until that read is in (the U9 review's mount race).
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULE_PACK_TYPE } from '@/engine/castGuidance';
import type { DataEntity } from '@/engine/types';

const registryOf = (packs: DataEntity[]) => ({
  byType: (type: string) => (type === RULE_PACK_TYPE ? packs : []),
});
/** Gritty rests for every character, as the registry lists an applied pack. */
const gritty = {
  name: 'Gritty',
  source: 'Gritty',
  castGuidance: { v: 1, tableRules: { restLength: 'gritty' } },
  appliesTo: { characters: [], appDefault: true },
} as unknown as DataEntity;

// The shared registry, read before Gritty was applied, and the one read now.
const stale = registryOf([]);
const reads = vi.hoisted(() => [] as Array<(r: unknown) => void>);
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => stale }));
vi.mock('@/data5e/registry', () => ({
  invalidateRegistry: vi.fn(),
  getRegistry: () =>
    new Promise((resolve) => {
      reads.push(resolve);
    }),
}));

import { homebrewRepo } from '@/db/homebrewRepo';
import { useAppRules } from './HouseRulesSection';

function Probe() {
  const { rules, packs, ready } = useAppRules();
  return (
    <p data-testid="probe">
      {ready ? 'ready' : 'reading'} {rules.restLength} {packs.restLength ?? 'none'}
    </p>
  );
}

afterEach(() => {
  cleanup();
  reads.length = 0;
});

describe('useAppRules', () => {
  it('reads the registry itself, and is not ready on a shared one alone', async () => {
    render(<Probe />);
    const probe = () => screen.getByTestId('probe').textContent;
    expect(probe()).toBe('reading standard none');
    // The rows are read (nothing changes in them), and the hook asks for the registry.
    await waitFor(() => expect(reads).toHaveLength(1));
    expect(probe()).toBe('reading standard none');
    reads[0]?.(registryOf([gritty]));
    await waitFor(() => expect(probe()).toBe('ready gritty Gritty'));
  });

  it('keeps the last read started when an older one lands after it', async () => {
    render(<Probe />);
    const probe = () => screen.getByTestId('probe').textContent;
    await waitFor(() => expect(reads).toHaveLength(1));
    // A stored file changes, so the hook reads again while the first read is out.
    await homebrewRepo.importJson(
      { _meta: { sources: [{ json: 'Gritty', full: 'Gritty' }] } },
      'gritty.json',
    );
    await waitFor(() => expect(reads).toHaveLength(2));
    reads[1]?.(registryOf([gritty]));
    await waitFor(() => expect(probe()).toBe('ready gritty Gritty'));
    reads[0]?.(registryOf([]));
    await new Promise((r) => setTimeout(r, 50));
    expect(probe()).toBe('ready gritty Gritty');
  });
});
