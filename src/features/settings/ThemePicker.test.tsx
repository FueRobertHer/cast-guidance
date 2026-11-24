// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY } from '@/lib/theme';
import { ThemePicker } from './ThemePicker';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemePicker (DS-001)', () => {
  it('offers System and every built-in theme as one radio group, Dark chosen by default', () => {
    render(<ThemePicker />);
    const group = screen.getByRole('group', { name: 'Theme' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => computeAccessibleName(r))).toEqual([
      'System',
      'Light',
      'Dark',
      'Parchment',
      'Modern',
      'High contrast',
    ]);
    expect(group.contains(radios[0] ?? null)).toBe(true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveProperty('checked', true);
  });

  it('applies and remembers a choice', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveProperty('checked', true);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('draws each miniature in its own theme', () => {
    render(<ThemePicker />);
    const themes = (name: string) =>
      Array.from(
        screen.getByRole('radio', { name }).closest('label')?.querySelectorAll('[data-theme]') ??
          [],
        (el) => el.getAttribute('data-theme'),
      );
    expect(themes('System')).toEqual(['dark', 'light']);
    expect(themes('Light')).toEqual(['light']);
    expect(themes('Dark')).toEqual(['dark']);
    expect(themes('Parchment')).toEqual(['parchment']);
    expect(themes('High contrast')).toEqual(['contrast']);
  });

  it('picks a reskin and draws the page in it', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Parchment' }));
    expect(document.documentElement.dataset.theme).toBe('parchment');
    expect(localStorage.getItem(THEME_KEY)).toBe('parchment');
  });
});
