// @vitest-environment jsdom
// UX-002: a first-time user can tell from the roster when the app is safe to
// use offline and how to protect their data. The card is guidance, not a
// gate: inline, never a dialog, never taking focus on its own, and it reads
// live state rather than promising it.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataStatusStore } from '@/stores/dataStatus';
import { ONBOARDING_KEY, onboardingStore } from '@/stores/onboarding';
import { swStatusStore } from '@/stores/swStatus';
import { namelessControls } from '../../../tests-fixtures/a11y';

const loader = vi.hoisted(() => ({
  verifyFullOffline: vi.fn(() => Promise.resolve({ cached: 48, total: 48 })),
}));
vi.mock('@/data5e/loader', () => loader);

import { GettingStarted } from './GettingStarted';
import { SHELL_STALL_MS } from './useOfflineReadiness';

function stub(name: 'serviceWorker' | 'storage', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true });
}

/**
 * A worker container whose registration lookup answers `active`. `controlled`
 * is whether this tab was loaded through the worker, which a first visit is
 * not.
 */
function workerContainer(active: boolean, controlled = true) {
  return {
    controller: controlled ? {} : null,
    getRegistration: () => Promise.resolve(active ? { active: {} } : undefined),
  };
}

/** The roster's heading and the card, as the roster places them. */
function Roster() {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <main>
      <h1 ref={heading} tabIndex={-1}>
        Characters
      </h1>
      <GettingStarted onDismiss={() => heading.current?.focus()} />
    </main>
  );
}

function renderCard() {
  return render(
    <MemoryRouter>
      <Roster />
    </MemoryRouter>,
  );
}

/** The checklist's region, named by its heading, which says how far along it is. */
const CHECKLIST = /^Ready for the table/;

/** A checklist item, found by its title. */
function item(title: string): HTMLElement {
  const li = screen.getByRole('heading', { name: title }).closest('li');
  if (li === null) throw new Error(`no item ${title}`);
  return li;
}

/** The live offline line. */
const offlineItem = () => item('Works offline');

/**
 * Where an item stands, as a screen reader hears it: the icon beside it is
 * decoration, so the word is what says it. Undefined while it has no answer.
 */
function state(li: HTMLElement): 'done' | 'todo' | undefined {
  if (within(li).queryByText('Done') !== null) return 'done';
  if (within(li).queryByText('To do') !== null) return 'todo';
  return undefined;
}

beforeEach(() => {
  // A production build, so the worker counts; tests that want dev say so.
  vi.stubEnv('DEV', false);
  stub('serviceWorker', workerContainer(false));
  stub('storage', undefined);
  swStatusStore.setState({ state: 'ready' });
  dataStatusStore.setState({ phase: 'working', filesDone: 0, filesTotal: 0, error: undefined });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  localStorage.clear();
  onboardingStore.setState({ dismissed: false });
  swStatusStore.setState({ state: 'pending' });
  dataStatusStore.setState({ phase: 'idle', filesDone: 0, filesTotal: 0, failedTag: undefined });
  loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(navigator, 'storage');
});

describe('GettingStarted', () => {
  it('is an inline section with a heading that leaves focus alone', () => {
    renderCard();
    const section = screen.getByRole('region', { name: CHECKLIST });
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toMatch(
      /^Ready for the table/,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(namelessControls()).toEqual([]);
  });

  it('says in its heading how many of the three are done, once all three have answered', async () => {
    stub('storage', { persisted: () => Promise.resolve(true), persist: vi.fn() });
    renderCard();
    // The data is still downloading, and storage has yet to answer: no count.
    const heading = () => screen.getByRole('heading', { level: 2 });
    expect(heading().textContent).toBe('Ready for the table');

    await waitFor(() => expect(state(item('Keep your data safe'))).toBe('done'));
    expect(heading().textContent).toBe('Ready for the table, 1 of 3');
    expect(screen.getByRole('region', { name: 'Ready for the table, 1 of 3' })).toBeTruthy();

    act(() => dataStatusStore.setState({ phase: 'done' }));
    expect(heading().textContent).toBe('Ready for the table, 3 of 3');
  });

  it('marks each item done with a check and to do with a dashed circle', async () => {
    stub('storage', { persisted: () => Promise.resolve(false), persist: vi.fn() });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    await waitFor(() => expect(state(item('Keep your data safe'))).toBe('todo'));
    expect(state(item('Game data saved'))).toBe('done');
    expect(
      item('Game data saved').querySelector('svg.lucide-circle-check.text-heal'),
    ).not.toBeNull();
    const todo = item('Keep your data safe').querySelector('svg.lucide-circle-dashed');
    expect(todo?.classList.contains('text-ink-faint')).toBe(true);
    // Decoration: the word beside it is what is read.
    expect(todo?.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('marks Works offline to do while the download runs, and done once it is', () => {
    renderCard();
    const line = offlineItem();
    expect(line.getAttribute('aria-live')).toBe('polite');
    // Atomic, so the update is read with the title that says what it is about.
    expect(line.getAttribute('aria-atomic')).toBe('true');
    expect(line.getAttribute('role')).toBeNull();
    expect(state(line)).toBe('todo');
    expect(within(line).getByText(/Keep the app open/)).toBeTruthy();

    act(() => dataStatusStore.setState({ phase: 'done' }));
    expect(state(offlineItem())).toBe('done');
    expect(within(offlineItem()).getByText(/no signal needed/)).toBeTruthy();
  });

  it('needs the shell as well as the data before it marks Works offline done', async () => {
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    await waitFor(() => expect(state(offlineItem())).toBe('todo'));
    expect(within(offlineItem()).queryByText(/no signal needed/)).toBeNull();
  });

  it('offers a reload when everything is cached but this tab is not controlled', () => {
    // A first visit: the install finished, but without clientsClaim this tab
    // still fetches screens it has not opened from the network.
    stub('serviceWorker', workerContainer(true, false));
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(state(offlineItem())).toBe('todo');
    expect(within(offlineItem()).getByText(/next time you open the app\. Reload now/)).toBeTruthy();
    expect(within(offlineItem()).getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('survives a worker API that throws, as Firefox does with storage blocked', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    // Not provably controlled, so it does not claim this tab works offline.
    expect(state(offlineItem())).toBe('todo');
    expect(within(offlineItem()).getByText(/next time you open the app/)).toBeTruthy();
    cleanup();

    // And the registration lookup a pending shell makes is guarded too.
    swStatusStore.setState({ state: 'pending' });
    renderCard();
    await waitFor(() => expect(state(offlineItem())).toBe('todo'));
  });

  it('shows no offline state, and is not live, until both sides have answered', async () => {
    // A warm boot: before the first registration lookup and before the boot
    // routine has said anything, a to-do would be a guess, and changing it a
    // moment later would announce on every launch.
    stub('serviceWorker', workerContainer(true));
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'idle' });
    renderCard();
    expect(offlineItem().getAttribute('aria-live')).toBeNull();
    expect(state(offlineItem())).toBeUndefined();
    expect(offlineItem().querySelector('svg')).toBeNull();
    expect(state(item('Game data saved'))).toBeUndefined();

    act(() => dataStatusStore.setState({ phase: 'done' }));
    await waitFor(() => expect(state(offlineItem())).toBe('done'));
    expect(offlineItem().getAttribute('aria-live')).toBe('polite');
  });

  it('does not call a complete release stopped because an update to another failed', async () => {
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 500', failedTag: 'v2.33.0' });
    renderCard();
    const download = () => item('Game data saved');
    await waitFor(() => expect(state(download())).toBe('done'));
    expect(download().textContent).not.toContain('stopped');
    expect(state(offlineItem())).toBe('done');
    cleanup();

    // The same failure over a release that is itself incomplete is a stop.
    loader.verifyFullOffline.mockResolvedValueOnce({ cached: 31, total: 48 });
    renderCard();
    await waitFor(() => expect(download().textContent).toContain('The download stopped'));
    expect(state(download())).toBe('todo');
  });

  it('answers a warm boot from the existing registration', async () => {
    stub('serviceWorker', workerContainer(true));
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    await waitFor(() => expect(state(offlineItem())).toBe('done'));
  });

  it('says plainly when this browser cannot open the app offline', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(state(offlineItem())).toBe('todo');
    expect(within(offlineItem()).getByText(/needs a connection to open/)).toBeTruthy();
    // Nothing a press could fix.
    expect(within(offlineItem()).queryByRole('button')).toBeNull();
  });

  it('treats a dev build as having no worker, whatever the store says', () => {
    vi.stubEnv('DEV', true);
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(state(offlineItem())).toBe('todo');
    expect(within(offlineItem()).getByText(/needs a connection to open/)).toBeTruthy();
  });

  it('suggests a reload when the worker fails or never finishes installing', () => {
    swStatusStore.setState({ state: 'error' });
    const { unmount } = renderCard();
    expect(within(offlineItem()).getByText(/could not install/)).toBeTruthy();
    expect(within(offlineItem()).getByRole('button', { name: 'Reload' })).toBeTruthy();
    unmount();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    swStatusStore.setState({ state: 'pending' });
    renderCard();
    expect(within(offlineItem()).queryByText(/Reload the page/)).toBeNull();
    expect(within(offlineItem()).queryByRole('button', { name: 'Reload' })).toBeNull();
    act(() => vi.advanceTimersByTime(SHELL_STALL_MS));
    expect(within(offlineItem()).getByText(/has not finished installing/)).toBeTruthy();
    expect(within(offlineItem()).getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('points a stopped download at Retry', () => {
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 500' });
    renderCard();
    const download = item('Game data saved');
    expect(state(download)).toBe('todo');
    expect(download.textContent).toContain('The download stopped');
    expect(download.textContent).toContain('Retry');
  });

  it('leaves the progress count and bar to the banner', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 3, filesTotal: 10 });
    renderCard();
    const section = screen.getByRole('region', { name: CHECKLIST });
    expect(state(item('Game data saved'))).toBe('todo');
    expect(section.textContent).not.toMatch(/\b3\s*(\/|of)\s*10\b/);
    expect(within(section).queryByRole('progressbar')).toBeNull();
    // It points at the banner only while the banner is there to point at.
    expect(section.textContent).toContain('The bar at the top');
    act(() => dataStatusStore.setState({ filesTotal: 0, filesDone: 0 }));
    expect(section.textContent).not.toContain('The bar at the top');
  });

  it('asks the browser to keep the data from a click and reports a grant', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stub('storage', { persisted: () => Promise.resolve(false), persist });
    renderCard();
    const ask = await screen.findByRole('button', { name: 'Keep my data' });
    expect(ask.className).toContain('ring-line-strong');
    expect(persist).not.toHaveBeenCalled();
    fireEvent.click(ask);
    await waitFor(() => expect(state(item('Keep your data safe'))).toBe('done'));
    expect(screen.getByText(/Your browser will keep your characters/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep my data' })).toBeNull();
  });

  it('keeps focus while asking, then hands it to the answer instead of the body', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const persist = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    stub('storage', { persisted: () => Promise.resolve(false), persist });
    renderCard();
    const ask = await screen.findByRole('button', { name: 'Keep my data' });
    ask.focus();
    fireEvent.click(ask);
    // Disabled for real, the button would drop focus while the prompt is up.
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(ask);
    fireEvent.click(ask);
    expect(persist).toHaveBeenCalledOnce();

    await act(async () => answer(true));
    const line = screen.getByText(/Your browser will keep your characters/);
    await waitFor(() => expect(document.activeElement).toBe(line));
  });

  it('leaves focus where the player moved it while the prompt was open', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const persist = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    stub('storage', { persisted: () => Promise.resolve(false), persist });
    renderCard();
    const ask = await screen.findByRole('button', { name: 'Keep my data' });
    ask.focus();
    fireEvent.click(ask);
    const hide = screen.getByRole('button', { name: 'Got it, hide this' });
    hide.focus();

    await act(async () => answer(true));
    expect(await screen.findByText(/Your browser will keep your characters/)).toBeTruthy();
    expect(document.activeElement).toBe(hide);
  });

  it('after a refusal, says the browser decides and links to the storage details', async () => {
    stub('storage', {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(false),
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my data' }));
    await waitFor(() =>
      expect(item('Keep your data safe').textContent).toContain('Your browser decides this itself'),
    );
    expect(state(item('Keep your data safe'))).toBe('todo');
    // The longer why (backups, Safari's seven days) is behind Storage details.
    const section = screen.getByRole('region', { name: CHECKLIST });
    expect(section.textContent).not.toContain('Home Screen');
    const details = within(section).getByRole('link', { name: 'Storage details' });
    expect(details.getAttribute('href')).toBe('/settings#storage-details');
  });

  it('counts itself as on screen only while it is shown', () => {
    const { unmount } = renderCard();
    expect(onboardingStore.getState().cardsShown).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Got it, hide this' }));
    expect(onboardingStore.getState().cardsShown).toBe(0);
    act(() => onboardingStore.getState().reopen());
    expect(onboardingStore.getState().cardsShown).toBe(1);
    unmount();
    expect(onboardingStore.getState().cardsShown).toBe(0);
  });

  it('hides on "Got it", remembers it, and hands focus to the roster heading', () => {
    const { unmount } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Got it, hide this' }));
    expect(screen.queryByRole('region', { name: CHECKLIST })).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Characters' }));

    unmount();
    renderCard();
    expect(screen.queryByRole('region', { name: CHECKLIST })).toBeNull();
  });
});
