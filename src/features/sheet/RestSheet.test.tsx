// @vitest-environment jsdom
// The rest sheet on its own: a short rest's hit points, hit dice to spend one
// tap at a time and what it gives back, the effects list only with effects in
// play, and a long rest's sheet as it was.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffect } from '@/engine/types';
import { RestSheet, type ShortRestView } from './RestSheet';

afterEach(cleanup);

/** One minute, so a short rest ends it. */
const bless: ActiveEffect = {
  id: 'bless',
  name: 'Bless',
  parts: [],
  lasts: { concentration: true, minutes: 1 },
};

const view = (over: Partial<ShortRestView> = {}): ShortRestView => ({
  hp: { current: 12, max: 27, temp: 0 },
  hitDice: [
    { die: 'd10', left: 0, total: 2 },
    { die: 'd8', left: 3, total: 3 },
  ],
  onSpendHitDie: () => undefined,
  restores: ['Ki', 'pact slots'],
  ...over,
});

function shortSheet(short: ShortRestView, effects: readonly ActiveEffect[] = []) {
  const onRest = vi.fn();
  const utils = render(
    <RestSheet
      rest="short"
      open
      effects={effects}
      short={short}
      onOpenChange={() => undefined}
      onRest={onRest}
    />,
  );
  const sheet = within(screen.getByRole('dialog', { name: 'Short rest' }));
  return { ...utils, sheet, onRest };
}

describe('the short rest sheet', () => {
  it('shows hit points, each size of hit die with a button to spend one, and what comes back', () => {
    const spend = vi.fn();
    const { sheet } = shortSheet(view({ onSpendHitDie: spend }));
    expect(sheet.getByRole('heading', { name: 'Hit Dice' })).toBeTruthy();
    expect(sheet.getByText('HP 12 of 27')).toBeTruthy();
    expect(sheet.getByText('Gives back Ki and pact slots.')).toBeTruthy();

    const d8 = sheet.getByRole('button', { name: 'Spend a d8 hit die, 3 left' });
    fireEvent.click(d8);
    fireEvent.click(d8);
    expect(spend.mock.calls).toEqual([['d8'], ['d8']]);
    // A size with none left stays listed, its button off.
    const d10 = sheet.getByRole('button', { name: 'Spend a d10 hit die, 0 left' });
    expect((d10 as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(d10);
    expect(spend).toHaveBeenCalledTimes(2);
  });

  it('follows the hit points and dice left as they are spent, keeping what comes back as it opened', () => {
    const { sheet, rerender } = shortSheet(view());
    rerender(
      <RestSheet
        rest="short"
        open
        effects={[]}
        short={view({
          hp: { current: 18, max: 27, temp: 3 },
          hitDice: [
            { die: 'd10', left: 0, total: 2 },
            { die: 'd8', left: 2, total: 3 },
          ],
          restores: [],
        })}
        onOpenChange={() => undefined}
        onRest={() => undefined}
      />,
    );
    expect(sheet.getByText('HP 18 of 27, plus 3 temporary')).toBeTruthy();
    expect(sheet.getByRole('button', { name: 'Spend a d8 hit die, 2 left' })).toBeTruthy();
    expect(sheet.getByText('Gives back Ki and pact slots.')).toBeTruthy();
  });

  it('says when no hit dice are left, and when nothing spent comes back', () => {
    const { sheet } = shortSheet(
      view({
        hitDice: [{ die: 'd8', left: 0, total: 3 }],
        restores: [],
      }),
    );
    expect(sheet.getByText('No Hit Dice left to spend. A long rest gives some back.')).toBeTruthy();
    expect(sheet.queryByRole('button', { name: /^Spend a/ })).toBeNull();
    expect(sheet.getByText('Nothing spent comes back on a short rest.')).toBeTruthy();
  });

  it('lists the effects in play only when there are some, and rests with those ticked', () => {
    const none = shortSheet(view());
    expect(none.sheet.queryByRole('group', { name: 'Ends, by what each one lasts' })).toBeNull();
    expect(none.sheet.queryByText('Untick what your table says stays.')).toBeNull();
    fireEvent.click(none.sheet.getByRole('button', { name: 'Take the short rest' }));
    expect(none.onRest).toHaveBeenCalledWith('short', new Set());
    cleanup();

    const some = shortSheet(view(), [bless]);
    const list = some.sheet.getByRole('group', { name: 'Ends, by what each one lasts' });
    expect(within(list).getByRole('checkbox', { name: /Bless/ })).toBeTruthy();
    fireEvent.click(some.sheet.getByRole('button', { name: 'Take the short rest' }));
    expect(some.onRest).toHaveBeenCalledWith('short', new Set(['bless']));
  });
});

describe('the long rest sheet', () => {
  it('says what the rest does and lists the effects, with no hit dice to spend', () => {
    render(
      <RestSheet
        rest="long"
        open
        effects={[bless]}
        detail="Regain all hit points."
        onOpenChange={() => undefined}
        onRest={() => undefined}
      />,
    );
    const sheet = within(screen.getByRole('dialog', { name: 'Long rest' }));
    expect(sheet.getByText('Regain all hit points.')).toBeTruthy();
    expect(sheet.getByRole('group', { name: 'Ends, by what each one lasts' })).toBeTruthy();
    expect(sheet.queryByRole('heading', { name: 'Hit Dice' })).toBeNull();
    expect(sheet.queryByText(/comes back|Gives back/)).toBeNull();
    expect(sheet.getByRole('button', { name: 'Take the long rest' })).toBeTruthy();
  });
});
