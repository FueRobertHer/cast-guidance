// @vitest-environment jsdom
// A11Y-001: the floating toggle shows DIS/N/ADV, which a screen reader spells
// out letter by letter, and its only sign of the current mode was colour.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { advModeStore } from '@/stores/advMode';
import { AdvToggle } from './AdvToggle';

afterEach(() => {
  cleanup();
  advModeStore.getState().set('normal');
});

describe('AdvToggle', () => {
  it('names each mode in full and says which one is on', () => {
    render(<AdvToggle />);
    expect(screen.getByRole('button', { name: 'Normal', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Advantage', pressed: false }));
    expect(screen.getByRole('button', { name: 'Advantage', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Normal', pressed: false })).toBeTruthy();
  });

  it('labels the set as a whole', () => {
    render(<AdvToggle />);
    expect(screen.getByRole('group', { name: 'Roll mode for every d20 roll' })).toBeTruthy();
  });
});
