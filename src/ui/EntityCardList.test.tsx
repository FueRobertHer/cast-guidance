// @vitest-environment jsdom
// UX-004: re-tapping the already-selected card must not re-fire onSelect (which
// for race/class/background re-runs pruneChoicesFor and silently wipes picks).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityCardList } from './EntityCardList';

const entities: Entity[] = [
  { name: 'Human', source: 'PHB' },
  { name: 'Elf', source: 'PHB' },
];

afterEach(cleanup);

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
});
