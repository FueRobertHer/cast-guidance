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
/** What `useRegistry` gives now: a test swaps it for a newer shared read, or none yet. */
const shared = { current: stale as ReturnType<typeof registryOf> | null };
/** Heroic rests for every character: what a shared registry read before it was taken off lists. */
const heroic = {
  ...gritty,
  name: 'Heroic',
  castGuidance: { v: 1, tableRules: { restLength: 'heroic' } },
} as unknown as DataEntity;
const reads = vi.hoisted(() => [] as Array<(r: unknown) => void>);
const fails = vi.hoisted(() => [] as Array<(e: unknown) => void>);
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => shared.current }));
vi.mock('@/data5e/registry', () => ({
  invalidateRegistry: vi.fn(),
  getRegistry: () =>
    new Promise((resolve, reject) => {
      reads.push(resolve);
      fails.push(reject);
    }),
}));

import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { HouseRulesSection, useAppRules } from './HouseRulesSection';

function Probe() {
  const { rules, packs, ready } = useAppRules();
  return (
    <p data-testid="probe">
      {ready ? 'ready' : 'reading'} {rules.restLength} {packs.restLength ?? 'none'}
    </p>
  );
}

afterEach(async () => {
  cleanup();
  reads.length = 0;
  fails.length = 0;
  shared.current = stale;
  // A test that stores a file leaves none for the next.
  await db.homebrewFiles.clear();
});

/** The Rest length row's words, as the Rules page shows them; undefined while the list is not shown. */
const restRow = () => screen.queryByRole('button', { name: /^Rest length/ })?.textContent;
/** Whether the list says Loading in place of its rows. */
const loading = () => screen.queryByText('Loading…') !== null;

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

  it('is ready on the choices made when its read fails, not Loading for good', async () => {
    render(<Probe />);
    const probe = () => screen.getByTestId('probe').textContent;
    await waitFor(() => expect(fails).toHaveLength(1));
    fails[0]?.(new Error('no data'));
    await waitFor(() => expect(probe()).toBe('ready standard none'));
  });

  it('reads again when the shared registry changes, not only when the rows do', async () => {
    const { rerender } = render(<Probe />);
    const probe = () => screen.getByTestId('probe').textContent;
    await waitFor(() => expect(reads).toHaveLength(1));
    // A download lands: a newer shared registry, while the first read is out.
    shared.current = registryOf([]);
    rerender(<Probe />);
    await waitFor(() => expect(reads).toHaveLength(2));
    reads[1]?.(registryOf([gritty]));
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

  it('gives the shared registry before its read is in, and is not ready on it', async () => {
    // A shared registry read before Heroic was taken off: the hook gives its
    // values meanwhile, which is why every screen waits for `ready`.
    shared.current = registryOf([heroic]);
    render(<Probe />);
    const probe = () => screen.getByTestId('probe').textContent;
    expect(probe()).toBe('reading heroic Heroic');
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]?.(registryOf([gritty]));
    await waitFor(() => expect(probe()).toBe('ready gritty Gritty'));
  });
});

describe('the table rules list', () => {
  it('says Loading on a cold load, not as written, until its read names the pack', async () => {
    // No shared registry yet: before the read, a rule an every-character pack
    // sets would read as written.
    shared.current = null;
    render(<HouseRulesSection heading="" />);
    expect([loading(), restRow()]).toEqual([true, undefined]);
    await waitFor(() => expect(reads).toHaveLength(1));
    expect([loading(), restRow()]).toEqual([true, undefined]);
    reads[0]?.(registryOf([gritty]));
    await waitFor(() => expect(restRow()).toContain('Short 8 hours, long 7 days · Gritty'));
  });

  it('never shows a stale shared registry’s pack before its own read is in', async () => {
    shared.current = registryOf([heroic]);
    render(<HouseRulesSection heading="" />);
    expect([loading(), restRow()]).toEqual([true, undefined]);
    await waitFor(() => expect(reads).toHaveLength(1));
    expect([loading(), restRow()]).toEqual([true, undefined]);
    reads[0]?.(registryOf([gritty]));
    await waitFor(() => expect(restRow()).toContain('Short 8 hours, long 7 days · Gritty'));
  });

  it('shows the registry in hand once its read fails', async () => {
    shared.current = registryOf([gritty]);
    render(<HouseRulesSection heading="" />);
    await waitFor(() => expect(fails).toHaveLength(1));
    fails[0]?.(new Error('no data'));
    await waitFor(() => expect(restRow()).toContain('Short 8 hours, long 7 days · Gritty'));
  });
});
