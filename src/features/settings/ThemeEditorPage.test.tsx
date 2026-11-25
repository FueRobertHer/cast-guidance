// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { computeAccessibleDescription } from 'dom-accessibility-api';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  customChoice,
  readSavedThemes,
  readThemeChoice,
  saveTheme,
  setThemeChoice,
} from '@/lib/theme';
import { DRAFT_KEY, draftFromBuiltIn, keepDraft } from '@/theme/draft';
import type { ThemeFile } from '@/theme/file';
import { Component as ThemeEditorPage } from './ThemeEditorPage';

const askConfirm = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock('@/ui/dialogs', () => ({ askConfirm }));
// Vitest blanks stylesheets, `?raw` included; the build serves the file's text.
vi.mock('@/styles/themes.css?raw', async () => {
  const { readFileSync } = await import('node:fs');
  const { THEMES_CSS_PATH } = await import('../../../tests-fixtures/themeCss');
  return { default: readFileSync(THEMES_CSS_PATH, 'utf8') };
});

function open(path = '/settings/theme') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/theme/:id?" element={<ThemeEditorPage />} />
        <Route path="/settings" element={<h1>Settings</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sample = () => document.querySelector('[data-theme-sample]') as HTMLElement;
const row = (token: string) => document.querySelector(`[data-token-row="${token}"]`) as HTMLElement;

function typeHex(token: string, hex: string) {
  const field = within(row(token)).getByRole('textbox', { name: /hex code/ });
  fireEvent.change(field, { target: { value: hex } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  setThemeChoice('parchment');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the theme editor', () => {
  it('makes a copy of the theme in use, drawn in the sample and nowhere else', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Make a theme' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Parchment copy');
    expect(sample().getAttribute('data-theme')).toBe('parchment');
    typeHex('bg', '#1d2b3a');
    expect(sample().style.getPropertyValue('--cg-bg')).toBe('#1d2b3a');
    // The page around it keeps the theme in use.
    expect(document.documentElement.style.getPropertyValue('--cg-bg')).toBe('');
    expect(document.documentElement.dataset.theme).toBe('parchment');
  });

  it('says what a token follows, and lets it have its own', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('brand', '#5ee0c8');
    expect(within(row('brand')).getByRole('button', { name: /^Reset/ })).toBeTruthy();
    const hover = row('brand-hover');
    expect(hover.textContent).toContain('Follows Action');
    fireEvent.click(within(hover).getByRole('button', { name: /^Set its own/ }));
    expect(row('brand-hover').textContent).not.toContain('Follows');
    fireEvent.click(within(row('brand')).getByRole('button', { name: /^Reset/ }));
    expect(within(row('brand')).queryByRole('button', { name: /^Reset/ })).toBeNull();
  });

  it('says why an entry is refused, and keeps the draft as it was', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('bg', '#10203080');
    expect(row('bg').textContent).toContain('must be opaque');
    expect(sample().style.getPropertyValue('--cg-bg')).toBe('');
  });

  it('takes back the last change', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveProperty('disabled', true);
    typeHex('bg', '#1d2b3a');
    typeHex('ink', '#f2efe6');
    fireEvent.click(undo);
    expect(sample().style.getPropertyValue('--cg-ink')).toBe('');
    expect(sample().style.getPropertyValue('--cg-bg')).toBe('#1d2b3a');
  });

  it('saves a new theme with what was set by hand, chooses it, and goes back', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('brand', '#5ee0c8');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Tide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    const [theme] = readSavedThemes();
    expect(theme?.file).toMatchObject({ name: 'Tide', base: 'parchment' });
    expect(theme?.file.tokens['brand-hover']).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme?.own).toEqual(['brand']);
    expect(readThemeChoice()).toBe(customChoice(theme?.id ?? ''));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('edits a saved theme in place, or saves it as a copy', async () => {
    const file: ThemeFile = {
      castGuidanceTheme: 1,
      name: 'Tide',
      base: 'dark',
      tokens: { bg: '#0b1d2a' },
    };
    const { theme } = saveTheme(file, ['bg']);
    open(`/settings/theme/${theme.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Edit theme' })).toBeTruthy();
    typeHex('bg', '#102030');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(readSavedThemes().map((t) => [t.id, t.file.tokens.bg])).toEqual([[theme.id, '#102030']]);
    cleanup();

    open(`/settings/theme/${theme.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Edit theme' });
    typeHex('bg', '#203040');
    fireEvent.click(screen.getByRole('button', { name: 'Save as a copy' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(readSavedThemes().map((t) => t.file.tokens.bg)).toEqual(['#102030', '#203040']);
  });

  it('asks before leaving with changes, and only then', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('bg', '#1d2b3a');
    askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { level: 1, name: 'Make a theme' })).toBeTruthy();
    // Kept on the device meanwhile.
    expect(localStorage.getItem(DRAFT_KEY)).toContain('#1d2b3a');
    askConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    cleanup();

    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(askConfirm).toHaveBeenCalledTimes(2);
  });

  it('offers to pick up a draft the tab lost, or start over', async () => {
    keepDraft(null, { ...draftFromBuiltIn('parchment'), own: { bg: '#1d2b3a' } });
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    expect(screen.getByText(/did not save it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pick it up' }));
    expect(sample().style.getPropertyValue('--cg-bg')).toBe('#1d2b3a');
    cleanup();

    keepDraft(null, { ...draftFromBuiltIn('parchment'), own: { bg: '#1d2b3a' } });
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(sample().style.getPropertyValue('--cg-bg')).toBe('');
  });

  it('saves a theme deleted meanwhile as a new one, rather than lose it', async () => {
    const file: ThemeFile = {
      castGuidanceTheme: 1,
      name: 'Tide',
      base: 'dark',
      tokens: { bg: '#0b1d2a' },
    };
    const { theme } = saveTheme(file, ['bg']);
    open(`/settings/theme/${theme.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Edit theme' });
    typeHex('bg', '#102030');
    // Another tab deletes it.
    localStorage.setItem('cast-guidance:themes', '[]');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    const [saved] = readSavedThemes();
    expect(saved?.file.tokens.bg).toBe('#102030');
    expect(saved?.id).not.toBe(theme.id);
    expect(readThemeChoice()).toBe(customChoice(saved?.id ?? ''));
  });

  it('saves a copy when asked, even renamed and otherwise the same', async () => {
    const file: ThemeFile = {
      castGuidanceTheme: 1,
      name: 'Tide',
      base: 'dark',
      tokens: { bg: '#0b1d2a' },
    };
    const { theme } = saveTheme(file, ['bg']);
    open(`/settings/theme/${theme.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Edit theme' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Tide II' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save as a copy' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    expect(readSavedThemes().map((t) => t.file.name)).toEqual(['Tide', 'Tide II']);
  });

  it('drops the kept draft once every change is taken back', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('bg', '#1d2b3a');
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it('says a stepped value before it is changed, as an edge has no slider to say it', async () => {
    setThemeChoice('dark');
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    const more = within(row('border')).getByRole('button', { name: 'More Edges' });
    expect(computeAccessibleDescription(more)).toBe('1 px');
    fireEvent.click(more);
    expect(computeAccessibleDescription(more)).toBe('1.5 px');
    const less = within(row('border')).getByRole('button', { name: 'Less Edges' });
    expect(computeAccessibleDescription(less)).toBe('1.5 px');
  });

  it('steps corners, rounds pills, and picks shadows and weights', async () => {
    setThemeChoice('dark');
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    // Each tap is its own change to take back.
    fireEvent.click(within(row('radius-card')).getByRole('button', { name: 'More Cards' }));
    fireEvent.click(within(row('radius-card')).getByRole('button', { name: 'More Cards' }));
    expect(sample().style.getPropertyValue('--cg-radius-card')).toBe('18px');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(sample().style.getPropertyValue('--cg-radius-card')).toBe('17px');

    const roundEnds = within(row('radius-pill')).getByRole('checkbox', { name: 'Round ends' });
    expect(roundEnds).toHaveProperty('checked', true);
    fireEvent.click(roundEnds);
    expect(sample().style.getPropertyValue('--cg-radius-pill')).toBe('6px');

    const shadow = within(row('shadow-card')).getByRole('combobox');
    fireEvent.change(shadow, { target: { value: 'outline' } });
    expect(sample().style.getPropertyValue('--cg-shadow-card')).toMatch(/^0px 0px 0px 1px #/);
    fireEvent.change(shadow, { target: { value: 'base' } });
    expect(sample().style.getPropertyValue('--cg-shadow-card')).toBe('');

    // Atkinson has 400, 600 and 700; Inter more.
    const weights = () =>
      within(row('weight-bold'))
        .getAllByRole('option')
        .map((o) => o.textContent);
    expect(weights()).toEqual(['400', '600', '700']);
    fireEvent.change(within(row('font-sans')).getByRole('combobox'), {
      target: { value: 'inter' },
    });
    expect(weights()).toEqual(['300', '400', '500', '600', '700', '800']);
  });

  it('keeps a clear scrim clear when its hue changes', async () => {
    setThemeChoice('dark');
    open();
    await screen.findByRole('heading', { level: 1, name: 'Make a theme' });
    typeHex('scrim', '#00000000');
    fireEvent.change(row('scrim').querySelector('input[type="color"]') as HTMLInputElement, {
      target: { value: '#ff0000' },
    });
    expect(sample().style.getPropertyValue('--cg-scrim')).toBe('#ff000000');
  });

  it('says so for a theme not on this device', async () => {
    open('/settings/theme/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Theme not found' })).toBeTruthy();
  });
});
