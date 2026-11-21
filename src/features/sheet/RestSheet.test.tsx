// @vitest-environment jsdom
// The rest sheet on its own: a short rest's hit points, hit dice to spend one
// tap at a time and what it gives back, the effects list only with effects in
// play, and a long rest's sheet as it was.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('says so when the character has no hit dice at all', () => {
    const { sheet } = shortSheet(view({ hitDice: [] }));
    expect(sheet.getByText('No Hit Dice to spend.')).toBeTruthy();
    expect(sheet.queryByText(/A long rest gives some back/)).toBeNull();
  });

  it('works out what comes back afresh at each opening', async () => {
    const props = {
      rest: 'short' as const,
      effects: [],
      onOpenChange: () => undefined,
      onRest: () => undefined,
    };
    const { rerender } = render(<RestSheet {...props} open short={view()} />);
    expect(screen.getByText('Gives back Ki and pact slots.')).toBeTruthy();
    rerender(<RestSheet {...props} open={false} short={view({ restores: [] })} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(<RestSheet {...props} open short={view({ restores: ['Second Wind'] })} />);
    const sheet = within(await screen.findByRole('dialog', { name: 'Short rest' }));
    expect(sheet.getByText('Gives back Second Wind.')).toBeTruthy();
  });

  it('lists the effects in play only when there are some, and rests with those ticked', () => {
    const none = shortSheet(view());
    expect(none.sheet.queryByRole('group', { name: 'Ends, by what each one lasts' })).toBeNull();
    expect(none.sheet.queryByText('Untick what your table says stays.')).toBeNull();
    fireEvent.click(none.sheet.getByRole('button', { name: 'Take the short rest' }));
    expect(none.onRest).toHaveBeenCalledWith('short', new Set(), new Map());
    cleanup();

    const some = shortSheet(view(), [bless]);
    const list = some.sheet.getByRole('group', { name: 'Ends, by what each one lasts' });
    expect(within(list).getByRole('checkbox', { name: /Bless/ })).toBeTruthy();
    fireEvent.click(some.sheet.getByRole('button', { name: 'Take the short rest' }));
    expect(some.onRest).toHaveBeenCalledWith('short', new Set(['bless']), new Map());
  });
});

describe('slots back as the short rest ends', () => {
  const arcane = { key: 'arcane-recovery', label: 'Arcane Recovery', levels: 3, below: 6 };
  const spent = [
    { level: 1, spent: 2 },
    { level: 2, spent: 1 },
    { level: 6, spent: 1 },
  ];
  const more = (scope: ReturnType<typeof within>, level: string, pool = 'Arcane Recovery') =>
    scope.getByRole('button', {
      name: `One more ${level}-level slot back, ${pool}`,
    }) as HTMLButtonElement;

  it('steps each spent level under the cap within the level budget, and rests with the picks', () => {
    const { sheet, onRest } = shortSheet(view({ recoveries: [arcane], spentSlots: spent }));
    const pool = within(sheet.getByRole('region', { name: 'Arcane Recovery' }));
    expect(pool.getByText(/up to 3 levels in all, none 6th level or higher/)).toBeTruthy();
    // The 6th-level slot is over the cap: no row for it.
    expect(pool.queryByText(/6th-level slots/)).toBeNull();
    expect(pool.getByText('3 of 3 levels left')).toBeTruthy();

    fireEvent.click(more(pool, '2nd'));
    expect(pool.getByText('1 of 3 levels left')).toBeTruthy();
    // Only one 2nd-level slot is spent, and a second would pass the budget anyway.
    expect(more(pool, '2nd').disabled).toBe(true);
    fireEvent.click(more(pool, '1st'));
    expect(pool.getByText('0 of 3 levels left')).toBeTruthy();
    expect(more(pool, '1st').disabled).toBe(true);
    fireEvent.click(
      pool.getByRole('button', { name: 'One fewer 1st-level slot back, Arcane Recovery' }),
    );
    expect(more(pool, '1st').disabled).toBe(false);
    fireEvent.click(more(pool, '1st'));

    fireEvent.click(sheet.getByRole('button', { name: 'Take the short rest' }));
    expect(onRest).toHaveBeenCalledWith(
      'short',
      new Set(),
      new Map([['arcane-recovery', { 1: 1, 2: 1 }]]),
    );
  });

  it('drops "nothing comes back" when a recovery pool can give slots back', () => {
    const offered = shortSheet(
      view({ restores: [], recoveries: [arcane], spentSlots: [{ level: 1, spent: 1 }] }),
    ).sheet;
    expect(offered.queryByText('Nothing spent comes back on a short rest.')).toBeNull();
    cleanup();
    const none = shortSheet(view({ restores: [] })).sheet;
    expect(none.getByText('Nothing spent comes back on a short rest.')).toBeTruthy();
  });

  it('shares the spent slots between two pools, and says when none can come back', () => {
    const land = { key: 'natural-recovery', label: 'Natural Recovery', levels: 2, below: 6 };
    const { sheet } = shortSheet(
      view({ recoveries: [arcane, land], spentSlots: [{ level: 1, spent: 1 }] }),
    );
    const a = within(sheet.getByRole('region', { name: 'Arcane Recovery' }));
    const b = within(sheet.getByRole('region', { name: 'Natural Recovery' }));
    fireEvent.click(more(a, '1st'));
    expect(more(b, '1st', 'Natural Recovery').disabled).toBe(true);
    cleanup();

    const none = shortSheet(view({ recoveries: [arcane], spentSlots: [{ level: 6, spent: 1 }] }));
    const pool = within(none.sheet.getByRole('region', { name: 'Arcane Recovery' }));
    expect(pool.getByText('No spent slots it can give back.')).toBeTruthy();
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
