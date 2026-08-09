// @vitest-environment jsdom
// The tray's adv/dis buttons and the floating toggle are two renderings of one
// sticky setting. They drifted once (the tray read normal/adv/dis while the
// toggle read dis/normal/adv), so the order is asserted on both, from the same
// shared constant.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DiceTray } from '@/features/dice/DiceTray';
import { ADV_MODES } from '@/stores/advMode';
import { AdvToggle } from './AdvToggle';

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

afterEach(cleanup);

const orderOf = (labels: readonly string[]) =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => labels.includes(t));

describe('advantage controls', () => {
  it('runs worst to best', () => {
    expect([...ADV_MODES]).toEqual(['dis', 'normal', 'adv']);
  });

  it('orders the floating toggle that way', () => {
    render(<AdvToggle />);
    expect(orderOf(['DIS', 'N', 'ADV'])).toEqual(['DIS', 'N', 'ADV']);
  });

  it('orders the tray copy the same way', () => {
    render(<DiceTray />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    expect(orderOf(['Disadvantage', 'Normal', 'Advantage'])).toEqual([
      'Disadvantage',
      'Normal',
      'Advantage',
    ]);
  });
});
