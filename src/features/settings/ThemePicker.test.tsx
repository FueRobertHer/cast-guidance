// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('offers System, Light and Dark as one radio group, Dark chosen by default', () => {
    render(<ThemePicker />);
    const group = screen.getByRole('group', { name: 'Theme' });
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(['System', 'Light', 'Dark']);
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
  });
});
