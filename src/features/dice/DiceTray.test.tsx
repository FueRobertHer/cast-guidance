// @vitest-environment jsdom
// A11Y-001: the tray's launcher and each log row's remove button were icon or
// glyph only, named by a tooltip that iOS VoiceOver never reads.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RollResult } from '@/dice/types';
import { relativeTime } from '@/lib/relativeTime';
import { diceTrayStore } from '@/stores/diceTray';
import { rollLogStore } from '@/stores/rollLog';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { DiceTray, TICK_MS } from './DiceTray';

// jsdom has no matchMedia and the drawer asks for one on mount.
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  rollLogStore.getState().clear();
  diceTrayStore.getState().setMode('normal');
  diceTrayStore.getState().setOpen(false);
});

const tray = () => screen.getByRole('dialog', { name: 'Dice' });
const view = (name: 'Roll' | 'History') =>
  fireEvent.click(within(tray()).getByRole('button', { name }));

const logged = (label: string, at = Date.now(), kind?: RollResult['kind']): RollResult => ({
  expr: '1d8',
  label,
  total: 5,
  at,
  terms: [{ kind: 'dice', sign: 1, sides: 8, rolls: [{ v: 5, kept: true }] }],
  ...(kind === undefined ? {} : { kind }),
});

describe('DiceTray', () => {
  it('names every control, including the launcher and a logged roll', () => {
    render(<DiceTray dock />);
    expect(namelessControls()).toEqual([]);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(screen.getByRole('button', { name: 'd20' }));
    expect(namelessControls()).toEqual([]);
    view('History');
    expect(screen.getByRole('button', { name: /^Remove d20 roll \(\d+\)$/ })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('is the dice button alone, marked for the toasts to rise above', () => {
    render(<DiceTray dock />);
    const button = screen.getByRole('button', { name: 'Dice tray' });
    expect(button.hasAttribute('data-dice-dock')).toBe(true);
    // No roll mode outside the tray: a d20 test asks in its roll prompt.
    expect(screen.queryByRole('button', { name: 'Advantage' })).toBeNull();
  });

  it('says which mode the d20 is in', () => {
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    const modes = within(tray()).getByRole('group', { name: 'd20 roll mode' });
    expect(within(modes).getByRole('button', { name: 'Normal', pressed: true })).toBeTruthy();
    fireEvent.click(within(modes).getByRole('button', { name: 'Disadvantage', pressed: false }));
    expect(within(modes).getByRole('button', { name: 'Disadvantage', pressed: true })).toBeTruthy();
    expect(within(modes).getByRole('button', { name: 'Normal', pressed: false })).toBeTruthy();
  });

  it('rolls the d20 alone under its mode, and keeps the mode while the app is open', () => {
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(within(tray()).getByRole('button', { name: 'Advantage' }));
    fireEvent.click(within(tray()).getByRole('button', { name: 'd20' }));
    const d20 = rollLogStore.getState().rolls[0];
    expect(d20?.meta?.advantage).toBe('adv');
    expect(d20?.terms[0]).toMatchObject({ kind: 'dice', sides: 20 });
    expect(d20?.terms[0]?.kind === 'dice' && d20.terms[0].rolls.length).toBe(2);

    // Every other die, and dice typed in the field, roll as they are.
    fireEvent.click(within(tray()).getByRole('button', { name: 'd6' }));
    expect(rollLogStore.getState().rolls[0]?.meta?.advantage).toBeUndefined();
    const field = screen.getByRole('textbox', { name: 'Dice expression' });
    fireEvent.change(field, { target: { value: '1d20+2' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    const typed = rollLogStore.getState().rolls[0];
    expect(typed?.expr).toBe('1d20+2');
    expect(typed?.meta?.advantage).toBeUndefined();

    act(() => diceTrayStore.getState().setOpen(false));
    fireEvent.click(screen.getByTitle('Dice tray'));
    expect(within(tray()).getByRole('button', { name: 'Advantage', pressed: true })).toBeTruthy();
  });

  it('opens on the dice, with its views in the header', () => {
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    const views = within(tray()).getByRole('group', { name: 'Dice tray view' });
    expect(within(views).getByRole('button', { name: 'Roll', pressed: true })).toBeTruthy();
    expect(within(views).getByRole('button', { name: 'History', pressed: false })).toBeTruthy();
    // The d20 apart, then six dice and the custom tile, four across.
    for (const d of [20, 4, 6, 8, 10, 12, 100]) {
      expect(within(tray()).getByRole('button', { name: `d${d}` })).toBeTruthy();
    }
    expect(within(tray()).getByPlaceholderText('Type dice, like 2d6+3')).toBeTruthy();
  });

  it('moves to the dice field from the custom tile', () => {
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(within(tray()).getByRole('button', { name: 'Custom dice' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Dice expression' }));
  });

  it('logs a d20 as a d20 roll and any other die as damage', () => {
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(within(tray()).getByRole('button', { name: 'd20' }));
    expect(rollLogStore.getState().rolls[0]?.kind).toBe('d20');
    fireEvent.click(within(tray()).getByRole('button', { name: 'd6' }));
    expect(rollLogStore.getState().rolls[0]?.kind).toBe('damage');
  });

  it('shows the latest rolls under the dice and all of them on History', () => {
    for (const label of ['First', 'Second', 'Third', 'Fourth']) {
      rollLogStore.getState().append(logged(label));
    }
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    expect(within(tray()).queryByText('First')).toBeNull();
    expect(within(tray()).getByText('Fourth')).toBeTruthy();
    // Removing and clearing are History's, where every roll is.
    expect(within(tray()).queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(within(tray()).queryByRole('button', { name: 'Clear all' })).toBeNull();

    view('History');
    expect(within(tray()).getByText('First')).toBeTruthy();
    fireEvent.click(within(tray()).getByRole('button', { name: 'Remove Fourth roll (5)' }));
    expect(within(tray()).queryByText('Fourth')).toBeNull();
    fireEvent.click(within(tray()).getByRole('button', { name: 'Clear all' }));
    expect(within(tray()).getByText('No rolls yet.')).toBeTruthy();
  });

  it('colours a heal as a heal, and a roll from before kinds by its dice', () => {
    rollLogStore.getState().append(logged('Cure Wounds healing', Date.now(), 'heal'));
    rollLogStore.getState().append(logged('Old roll'));
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    /** The row's total: every logged roll here comes to 5. */
    const total = (label: string) => {
      const row = within(tray()).getByText(label).parentElement?.parentElement;
      if (row === null || row === undefined) throw new Error(`no row for ${label}`);
      return within(row).getByText('5');
    };
    expect(total('Cure Wounds healing').className).toContain('text-heal');
    expect(total('Old roll').className).toContain('text-danger');
  });

  it('says when each roll was made, and keeps saying it as time passes', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-03T14:03:22Z'));
    rollLogStore.getState().append(logged('Initiative'));
    render(<DiceTray dock />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    const time = tray().querySelector('time');
    expect(time?.getAttribute('dateTime')).toBe('2026-11-03T14:03:22.000Z');
    expect(time?.textContent).toMatch(/^just now \(.+\)$/);
    act(() => vi.advanceTimersByTime(2 * 60_000 + TICK_MS));
    expect(tray().querySelector('time')?.textContent).toMatch(/^2 min ago \(.+\)$/);
  });

  it('opens on History when asked, with no dock button on the page', () => {
    rollLogStore.getState().append(logged('Healing potion', Date.now(), 'heal'));
    render(<DiceTray />);
    expect(screen.queryByTitle('Dice tray')).toBeNull();
    act(() => diceTrayStore.getState().show('history'));
    expect(within(tray()).getByRole('button', { name: 'History', pressed: true })).toBeTruthy();
    expect(
      within(tray()).getByRole('button', { name: 'Remove Healing potion roll (5)' }),
    ).toBeTruthy();
  });

  it('hands focus back to what had it before a toast opened it', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    render(<DiceTray />);
    act(() => diceTrayStore.getState().show('history', opener));
    fireEvent.keyDown(tray(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('falls back to the dock button when that is gone', async () => {
    const opener = document.createElement('button');
    render(<DiceTray dock />);
    act(() => diceTrayStore.getState().show('history', opener));
    fireEvent.keyDown(tray(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTitle('Dice tray')));
  });

  it('closes when the sheet it is on goes', () => {
    const { unmount } = render(<DiceTray />);
    act(() => diceTrayStore.getState().show('history'));
    unmount();
    expect(diceTrayStore.getState()).toMatchObject({ open: false, mounted: 0 });
  });
});

describe('relativeTime', () => {
  const at = Date.UTC(2026, 10, 3, 14, 0, 0);
  it.each([
    [0, 'just now'],
    [59_000, 'just now'],
    [60_000, '1 min ago'],
    [59 * 60_000, '59 min ago'],
    [60 * 60_000, '1 h ago'],
    [23 * 3_600_000, '23 h ago'],
    [24 * 3_600_000, '14:00:00'],
  ])('%i ms later is "%s"', (later, said) => {
    expect(relativeTime(at, at + later, '14:00:00')).toBe(said);
  });
});
