// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { computeAccessibleName } from 'dom-accessibility-api';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  customChoice,
  endPreview,
  readPreview,
  readSavedThemes,
  readThemeChoice,
  saveTheme,
  setThemeChoice,
  THEME_KEY,
  TRY_SECONDS,
} from '@/lib/theme';
import { noticeStore } from '@/stores/notices';
import type { ThemeFile } from '@/theme/file';
import { themeHash } from '@/theme/link';
import { ThemeKeepBanner } from '@/ui/ThemeKeepBanner';
import { ThemeFiles } from './ThemeFiles';
import { ThemePicker } from './ThemePicker';

const askText = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock('@/ui/dialogs', () => ({ askText }));
const download = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ downloadJson: download }));
// Vitest blanks stylesheets, `?raw` included; the build serves the file's text.
vi.mock('@/styles/themes.css?raw', async () => {
  const { readFileSync } = await import('node:fs');
  const { THEMES_CSS_PATH } = await import('../../../tests-fixtures/themeCss');
  return { default: readFileSync(THEMES_CSS_PATH, 'utf8') };
});

const MIDNIGHT: ThemeFile = {
  castGuidanceTheme: 1,
  name: 'Midnight',
  author: 'Vela',
  base: 'dark',
  tokens: { bg: '#f4f0e8', ink: '#101418' },
};

let shownAt = '';
function Where() {
  const l = useLocation();
  shownAt = `${l.pathname}${l.search}${l.hash}`;
  return null;
}

function renderAt(path = '/settings') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ThemePicker />
      <ThemeFiles />
      <ThemeKeepBanner />
      <Where />
    </MemoryRouter>,
  );
}

function pickFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], 'midnight.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  setThemeChoice('dark');
  noticeStore.getState().clear();
});

afterEach(() => {
  endPreview();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('theme files in Settings', () => {
  it('shows a picked file before anything is saved, with what it left out', async () => {
    renderAt();
    pickFile(JSON.stringify({ ...MIDNIGHT, tokens: { ...MIDNIGHT.tokens, glow: '#fff' } }));
    const sheet = await screen.findByRole('dialog', { name: 'Try “Midnight”?' });
    expect(sheet.textContent).toContain('By Vela');
    expect(sheet.textContent).toContain('Built on Dark. It changes 2 values.');
    expect(sheet.textContent).toContain('glow (not a theme token)');
    expect(readSavedThemes()).toEqual([]);
  });

  it('says why a file is refused', async () => {
    renderAt();
    pickFile('{"castGuidanceTheme": 7}');
    await waitFor(() =>
      expect(noticeStore.getState().notice).toMatchObject({
        title: 'Could not use this theme',
        detail: expect.stringMatching(/newer version/),
        tone: 'warn',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tries a theme in this tab, then keeps it from the banner', async () => {
    renderAt();
    pickFile(JSON.stringify(MIDNIGHT));
    fireEvent.click(await screen.findByRole('button', { name: 'Try this theme' }));
    const [theme] = readSavedThemes();
    expect(theme?.file.name).toBe('Midnight');
    expect(readPreview()).toEqual(theme);
    expect(document.documentElement.style.getPropertyValue('--cg-bg')).toBe('#f4f0e8');
    // Nothing stored yet: a reload would go back.
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    // The picker shows the theme the page is drawn in.
    expect(screen.getByRole('radio', { name: 'Midnight' })).toHaveProperty('checked', true);
    const banner = document.querySelector('[data-theme-keep]');
    expect(banner?.textContent).toMatch(/Keep the theme Midnight\?/);
    // Drawn in the stored choice's own built-in, readable whatever Midnight does.
    expect(banner?.closest('[data-theme]')?.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(localStorage.getItem(THEME_KEY)).toBe(customChoice(theme?.id ?? ''));
    expect(document.querySelector('[data-theme-keep]')).toBeNull();
  });

  it(`goes back by itself after ${TRY_SECONDS} seconds unless kept`, async () => {
    const { theme } = saveTheme(MIDNIGHT);
    vi.useFakeTimers();
    renderAt();
    act(() => {
      import('@/lib/theme').then((m) => m.previewTheme(theme));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(document.querySelector('[data-theme-keep]')?.textContent).toMatch(/Going back in \d+ s/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRY_SECONDS * 1000);
    });
    expect(readPreview()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--cg-bg')).toBe('');
    expect(readThemeChoice()).toBe('dark');
    expect(document.querySelector('[data-theme-keep]')).toBeNull();
  });

  it('opens a theme link on this page, and takes it off the address', async () => {
    renderAt(`/settings?x=1#${await themeHash(MIDNIGHT)}`);
    expect(await screen.findByRole('dialog', { name: 'Try “Midnight”?' })).toBeTruthy();
    expect(shownAt).toBe('/settings?x=1');
  });

  it('reads a pasted link, whole or as its hash', async () => {
    renderAt();
    askText.mockResolvedValueOnce(`https://elsewhere.test/settings#${await themeHash(MIDNIGHT)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a theme link' }));
    expect(await screen.findByRole('dialog', { name: 'Try “Midnight”?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    askText.mockResolvedValueOnce('not a link');
    fireEvent.click(screen.getByRole('button', { name: 'Paste a theme link' }));
    await waitFor(() =>
      expect(noticeStore.getState().notice?.detail).toMatch(/does not carry a theme/),
    );
  });

  it('exports a built-in whole, and a saved theme as its own file', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Export this theme' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [name, file] = download.mock.calls[0] ?? [];
    expect(name).toBe('Dark theme');
    expect(file).toMatchObject({ castGuidanceTheme: 1, name: 'Dark', base: 'dark' });
    expect(Object.keys((file as ThemeFile).tokens).length).toBeGreaterThan(60);

    const { theme } = saveTheme(MIDNIGHT);
    act(() => setThemeChoice(customChoice(theme.id)));
    fireEvent.click(screen.getByRole('button', { name: 'Export this theme' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    expect(download.mock.calls[1]).toEqual(['Midnight theme', MIDNIGHT]);
  });

  it('offers Share and Delete for a theme of one’s own, and Delete can be undone', async () => {
    const { theme } = saveTheme(MIDNIGHT);
    renderAt();
    expect(screen.queryByRole('button', { name: 'Delete this theme' })).toBeNull();
    act(() => setThemeChoice(customChoice(theme.id)));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this theme' }));
    expect(readSavedThemes()).toEqual([]);
    expect(readThemeChoice()).toBe('dark');
    expect(screen.queryByRole('radio', { name: 'Midnight' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo: Theme deleted' }));
    expect(readSavedThemes()).toEqual([theme]);
    expect(readThemeChoice()).toBe(customChoice(theme.id));
  });

  it('copies a share link where there is no share sheet', async () => {
    const { theme } = saveTheme(MIDNIGHT);
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
    setThemeChoice(customChoice(theme.id));
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Share this theme' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]?.[0]).toMatch(/\/settings#theme=1\.[\w-]+$/);
    expect(noticeStore.getState().notice?.title).toBe('Theme link copied');
  });

  it('lists saved themes in the picker, each named and drawn in its own values', () => {
    const { theme } = saveTheme(MIDNIGHT);
    renderAt();
    const radio = screen.getByRole('radio', { name: 'Midnight' });
    expect(computeAccessibleName(radio)).toBe('Midnight');
    const mini = radio.closest('label')?.querySelector('[data-theme]') as HTMLElement;
    expect(mini.getAttribute('data-theme')).toBe('dark');
    expect(mini.style.getPropertyValue('--cg-bg')).toBe('#f4f0e8');
    fireEvent.click(radio);
    expect(localStorage.getItem(THEME_KEY)).toBe(customChoice(theme.id));
  });
});
