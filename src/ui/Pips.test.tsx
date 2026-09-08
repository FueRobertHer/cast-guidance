// @vitest-environment jsdom
// Pips drain from the right, so what is left stays under the label it belongs
// to. Getting the direction wrong is invisible in a screenshot and obvious at
// the table, so the arithmetic is pinned here.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pips } from './Pips';

afterEach(cleanup);

function renderPips(total: number, spent: number) {
  const onChange = vi.fn();
  render(
    <Pips
      total={total}
      spent={spent}
      onChange={onChange}
      label={(use) => `Rage use ${use}`}
      tone="border-accent bg-accent"
    />,
  );
  // In DOM order, which is left to right on screen.
  const pips = screen.getAllByRole('button');
  return { onChange, pips };
}

const pressed = (pips: HTMLElement[]) => pips.map((p) => p.getAttribute('aria-pressed') === 'true');

describe('Pips', () => {
  it('lights every pip when nothing is spent', () => {
    const { pips } = renderPips(3, 0);
    expect(pressed(pips)).toEqual([false, false, false]);
  });

  it('paints the lit run, not just the labels', () => {
    // `aria-pressed` and the fill come off the same boolean, so asserting only
    // the former would pass with the colours inverted, which is the exact bug
    // this component exists to fix.
    const { pips } = renderPips(3, 1);
    expect(pips.map((p) => p.className.includes('bg-accent'))).toEqual([true, true, false]);
    expect(pips.map((p) => p.className.includes('bg-surface-2'))).toEqual([false, false, true]);
  });

  it('empties from the right, leaving what remains on the left', () => {
    const { pips } = renderPips(5, 2);
    expect(pressed(pips)).toEqual([false, false, false, true, true]);
  });

  it('spends one when the rightmost lit pip is tapped', () => {
    const { onChange, pips } = renderPips(3, 0);
    fireEvent.click(pips[2] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('gives the use back when the same pip is tapped again', () => {
    const { onChange, pips } = renderPips(3, 1);
    // With one spent, the rightmost pip is the spent one.
    fireEvent.click(pips[2] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('spends a pip and everything to its right in one tap', () => {
    const { onChange, pips } = renderPips(5, 0);
    fireEvent.click(pips[1] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('restores a spent pip and everything to its left in one tap', () => {
    const { onChange, pips } = renderPips(5, 4);
    fireEvent.click(pips[3] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('numbers uses in the order they are spent', () => {
    // Use 1 is the first one you burn, so it sits at the right-hand end.
    const { pips } = renderPips(3, 0);
    expect(pips.map((p) => p.getAttribute('aria-label'))).toEqual([
      'Rage use 3',
      'Rage use 2',
      'Rage use 1',
    ]);
  });

  it('survives a pool that shrank under a stored count', () => {
    // A build change can lower a maximum before the clamp offer is accepted,
    // leaving more spent than the pool now holds (GAME-007). Every pip reads
    // as spent, and a tap has to land back inside the pool rather than
    // preserving the overage or going negative.
    const { onChange, pips } = renderPips(3, 5);
    expect(pressed(pips)).toEqual([true, true, true]);
    for (const pip of pips) fireEvent.click(pip);
    for (const [next] of onChange.mock.calls) {
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(3);
    }
  });

  it('reaches both ends of the pool without leaving it', () => {
    // The leftmost lit pip is the last use you have, so tapping it spends the
    // lot; the rightmost spent one is the first you burned, so tapping it
    // hands the lot back. Neither can push the count past the pool.
    const full = renderPips(4, 0);
    fireEvent.click(full.pips[0] as HTMLElement);
    expect(full.onChange).toHaveBeenCalledWith(4);
    cleanup();
    const empty = renderPips(4, 4);
    fireEvent.click(empty.pips[3] as HTMLElement);
    expect(empty.onChange).toHaveBeenCalledWith(0);
  });
});
