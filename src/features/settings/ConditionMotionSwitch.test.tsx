// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONDITION_MOTION_KEY, setAnimateConditions } from '@/lib/conditionMotion';
import { ConditionMotionSwitch } from './ConditionMotionSwitch';

const NAME = /^Animate condition effects/;
const pressed = () => screen.getByRole('button', { name: NAME }).getAttribute('aria-pressed');

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  act(() => setAnimateConditions(true));
});

describe('the "Animate condition effects" switch (WCAG 2.2.2)', () => {
  it('is on by default, and says so in words', () => {
    render(<ConditionMotionSwitch />);
    expect(pressed()).toBe('true');
    expect(screen.getByRole('button', { name: NAME }).textContent).toContain('On');
  });

  it('turns off, remembers it, and turns back on leaving nothing stored', () => {
    render(<ConditionMotionSwitch />);
    fireEvent.click(screen.getByRole('button', { name: NAME }));
    expect(pressed()).toBe('false');
    expect(screen.getByRole('button', { name: NAME }).textContent).toContain('Off');
    expect(localStorage.getItem(CONDITION_MOTION_KEY)).toBe('off');

    fireEvent.click(screen.getByRole('button', { name: NAME }));
    expect(pressed()).toBe('true');
    expect(localStorage.getItem(CONDITION_MOTION_KEY)).toBeNull();
  });

  it('starts off where this device chose it', () => {
    localStorage.setItem(CONDITION_MOTION_KEY, 'off');
    render(<ConditionMotionSwitch />);
    expect(pressed()).toBe('false');
  });

  it('follows a choice made in another tab', () => {
    render(<ConditionMotionSwitch />);
    localStorage.setItem(CONDITION_MOTION_KEY, 'off');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CONDITION_MOTION_KEY }));
    });
    expect(pressed()).toBe('false');
  });
});
