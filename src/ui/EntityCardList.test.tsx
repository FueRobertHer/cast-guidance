// @vitest-environment jsdom
// UX-004: re-tapping the already-selected card must not re-fire onSelect (which
// for race/class/background re-runs pruneChoicesFor and silently wipes picks).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import type { SourcePolicy } from '@/data5e/sourceFilter';
import { EntityCardList } from './EntityCardList';

// Only the Dexie-backed hook is stubbed; the filtering logic under test is real.
const policyState = vi.hoisted(() => ({
  current: { mode: 'all', except: [] } as SourcePolicy,
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/sourceFilter')>()),
  useSourcePolicy: () => policyState.current,
}));

const entities: Entity[] = [
  { name: 'Human', source: 'PHB' },
  { name: 'Elf', source: 'PHB' },
];

afterEach(cleanup);
beforeEach(() => {
  policyState.current = { mode: 'all', except: [] };
});

describe('EntityCardList selection', () => {
  it('selects an unselected card', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elf' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: 'Elf' });
  });

  it('deselects (not re-selects) when tapping the current pick with onDeselect', () => {
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    render(
      <EntityCardList
        entities={entities}
        selectedUid="human|phb"
        onSelect={onSelect}
        onDeselect={onDeselect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is a no-op when re-tapping the current pick with no onDeselect (no silent wipe)', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} selectedUid="human|phb" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still selects a different card while one is selected', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} selectedUid="human|phb" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elf' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: 'Elf' });
  });
});

describe('EntityCardList source filtering', () => {
  // Over ten entries so the text-filter input renders.
  const mixed: Entity[] = [
    { name: 'Human', source: 'PHB' },
    { name: 'Elf', source: 'PHB' },
    ...Array.from({ length: 9 }, (_, i) => ({ name: `Filler ${String(i)}`, source: 'PHB' })),
    { name: 'Aarakocra', source: 'EEPC' },
    { name: 'Elfling', source: 'EEPC' },
  ];

  it('hides entities from sources the player turned off', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Human' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).toBeNull();
  });

  it('never hides the current pick, even from a hidden source', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} selectedUid="aarakocra|eepc" onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
  });

  it('offers to reveal hidden entries, and to go back', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText(/2 hidden by your source settings/));
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
    fireEvent.click(screen.getByText('Back to your chosen sources'));
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).toBeNull();
  });

  it('counts hidden entries against the text filter, not the whole list', () => {
    // Regression: the count was taken before the text filter, so searching
    // "elf" advertised every hidden entry in the list, including the ones that
    // revealing them would not have shown.
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'elf' } });
    expect(screen.queryByText(/2 hidden by your source settings/)).toBeNull();
    expect(screen.queryByText(/1 hidden by your source settings/)).not.toBeNull();
  });

  it('says nothing about hidden sources when the filter matches only visible entries', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'human' } });
    expect(screen.queryByText(/hidden by your source settings/)).toBeNull();
  });

  it('shows everything when no policy is set', () => {
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
    expect(screen.queryByText(/hidden by your source settings/)).toBeNull();
  });
});
