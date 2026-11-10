// @vitest-environment jsdom
// The house rule for one-use dice in Settings (the buffs canvas, Dice B).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ONE_USE_DICE_KEY, setOneUseDice } from '@/lib/oneUseDice';
import { OneUseDiceSetting } from './OneUseDiceSetting';

const group = () => screen.getByRole('group', { name: 'Guidance and Bardic Inspiration' });
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const why = () => {
  const id = group().getAttribute('aria-describedby');
  return id === null ? '' : (document.getElementById(id)?.textContent ?? '');
};

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  act(() => setOneUseDice('after'));
});

describe('the one-use dice house rule', () => {
  it('is after the roll by default, as written, and says why', () => {
    render(<OneUseDiceSetting />);
    expect(pressed('After too')).toBe('true');
    expect(pressed('Before only')).toBe('false');
    expect(why()).toMatch(/^As written: the roll prompt offers them/);
  });

  it('switches to before, remembers it, and leaves nothing stored when back to after', () => {
    render(<OneUseDiceSetting />);
    fireEvent.click(screen.getByRole('button', { name: 'Before only' }));
    expect(pressed('Before only')).toBe('true');
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBe('before');
    expect(why()).toMatch(/spent even on a natural 1 or 20/);

    fireEvent.click(screen.getByRole('button', { name: 'After too' }));
    expect(pressed('After too')).toBe('true');
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBeNull();
  });

  it('starts where this device chose, and follows a choice made in another tab', () => {
    localStorage.setItem(ONE_USE_DICE_KEY, 'before');
    render(<OneUseDiceSetting />);
    expect(pressed('Before only')).toBe('true');
    localStorage.removeItem(ONE_USE_DICE_KEY);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: ONE_USE_DICE_KEY }));
    });
    expect(pressed('After too')).toBe('true');
  });

  it('says Bless has nothing to set', () => {
    render(<OneUseDiceSetting />);
    expect(screen.getByText(/There is nothing to set/)).toBeTruthy();
  });
});
