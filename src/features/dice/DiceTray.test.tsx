// @vitest-environment jsdom
// A11Y-001: the tray's launcher and each log row's remove button were icon or
// glyph only, named by a tooltip that iOS VoiceOver never reads.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { advModeStore } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { DiceTray } from './DiceTray';

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
  rollLogStore.getState().clear();
  advModeStore.getState().set('normal');
});

describe('DiceTray', () => {
  it('names every control, including the launcher and a logged roll', () => {
    render(<DiceTray />);
    expect(namelessControls()).toEqual([]);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(screen.getByRole('button', { name: 'd20' }));
    expect(screen.getByRole('button', { name: /^Remove d20 roll \(\d+\)$/ })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('says which roll mode is on', () => {
    render(<DiceTray />);
    fireEvent.click(screen.getByTitle('Dice tray'));
    fireEvent.click(screen.getByRole('button', { name: 'Disadvantage', pressed: false }));
    expect(screen.getByRole('button', { name: 'Disadvantage', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Normal', pressed: false })).toBeTruthy();
  });
});
