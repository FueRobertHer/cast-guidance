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

/** The live offline line: its item, found by its heading. */
function offlineItem(): HTMLElement {
  const item = screen.getByRole('heading', { name: 'Works offline' }).closest('li');
  if (item === null) throw new Error('no offline item');
  return item;
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
    const section = screen.getByRole('region', { name: 'Getting started' });
    expect(within(section).getByRole('heading', { level: 2 }).textContent).toBe('Getting started');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(namelessControls()).toEqual([]);
  });

  it('says Not yet while the download runs and Ready once it is done', () => {
    renderCard();
    const line = offlineItem();
    expect(line.getAttribute('aria-live')).toBe('polite');
    // Atomic, so the update is read with the lead that says what it is about.
    expect(line.getAttribute('aria-atomic')).toBe('true');
    expect(line.getAttribute('role')).toBeNull();
    expect(within(line).getByText('Not yet')).toBeTruthy();
    expect(within(line).getByText(/Keep the app open/)).toBeTruthy();

    act(() => dataStatusStore.setState({ phase: 'done' }));
    expect(within(offlineItem()).getByText('Ready')).toBeTruthy();
    expect(within(offlineItem()).getByText(/without a connection/)).toBeTruthy();
  });

  it('needs the shell as well as the data before it says Ready', async () => {
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(await within(offlineItem()).findByText('Not yet')).toBeTruthy();
    expect(within(offlineItem()).queryByText('Ready')).toBeNull();
  });

  it('says "next time" when everything is cached but this tab is not controlled', () => {
    // A first visit: the install finished, but without clientsClaim this tab
    // still fetches screens it has not opened from the network.
    stub('serviceWorker', workerContainer(true, false));
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(within(offlineItem()).getByText('Ready next time')).toBeTruthy();
    expect(within(offlineItem()).getByText(/next time you open the app\. Reload now/)).toBeTruthy();
    expect(within(offlineItem()).queryByText('Ready')).toBeNull();
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
    expect(within(offlineItem()).getByText('Ready next time')).toBeTruthy();
    cleanup();

    // And the registration lookup a pending shell makes is guarded too.
    swStatusStore.setState({ state: 'pending' });
    renderCard();
    expect(await within(offlineItem()).findByText('Not yet')).toBeTruthy();
  });

  it('shows no offline state, and is not live, until both sides have answered', async () => {
    // A warm boot: before the first registration lookup and before the boot
    // routine has said anything, "Not yet" would be a guess, and changing it a
    // moment later would announce on every launch.
    stub('serviceWorker', workerContainer(true));
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'idle' });
    renderCard();
    expect(offlineItem().getAttribute('aria-live')).toBeNull();
    expect(within(offlineItem()).queryByText('Not yet')).toBeNull();
    const download = screen.getByRole('heading', { name: 'Game data' }).closest('li');
    expect(download?.textContent).not.toContain('In progress');

    act(() => dataStatusStore.setState({ phase: 'done' }));
    expect(await within(offlineItem()).findByText('Ready')).toBeTruthy();
    expect(offlineItem().getAttribute('aria-live')).toBe('polite');
  });

  it('does not call a complete release stopped because an update to another failed', async () => {
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 500', failedTag: 'v2.33.0' });
    renderCard();
    const download = () => screen.getByRole('heading', { name: 'Game data' }).closest('li');
    await waitFor(() => expect(download()?.textContent).toContain('Done'));
    expect(download()?.textContent).not.toContain('Stopped');
    expect(within(offlineItem()).getByText('Ready')).toBeTruthy();
    cleanup();

    // The same failure over a release that is itself incomplete is a stop.
    loader.verifyFullOffline.mockResolvedValueOnce({ cached: 31, total: 48 });
    renderCard();
    await waitFor(() => expect(download()?.textContent).toContain('Stopped'));
  });

  it('answers a warm boot from the existing registration', async () => {
    stub('serviceWorker', workerContainer(true));
    swStatusStore.setState({ state: 'pending' });
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    await waitFor(() => expect(within(offlineItem()).getByText('Ready')).toBeTruthy());
  });

  it('says plainly when this browser cannot open the app offline', () => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(within(offlineItem()).getByText('Not available')).toBeTruthy();
    expect(within(offlineItem()).getByText(/needs a connection to open/)).toBeTruthy();
  });

  it('treats a dev build as having no worker, whatever the store says', () => {
    vi.stubEnv('DEV', true);
    dataStatusStore.setState({ phase: 'done' });
    renderCard();
    expect(within(offlineItem()).getByText('Not available')).toBeTruthy();
  });

  it('suggests a reload when the worker fails or never finishes installing', () => {
    swStatusStore.setState({ state: 'error' });
    const { unmount } = renderCard();
    expect(within(offlineItem()).getByText(/could not install/)).toBeTruthy();
    unmount();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    swStatusStore.setState({ state: 'pending' });
    renderCard();
    expect(within(offlineItem()).queryByText(/Reload the page/)).toBeNull();
    act(() => vi.advanceTimersByTime(SHELL_STALL_MS));
    expect(within(offlineItem()).getByText(/has not finished installing/)).toBeTruthy();
  });

  it('points a stopped download at Retry', () => {
    dataStatusStore.setState({ phase: 'error', error: 'HTTP 500' });
    renderCard();
    const item = screen.getByRole('heading', { name: 'Game data' }).closest('li');
    expect(item?.textContent).toContain('Stopped');
    expect(item?.textContent).toContain('Retry');
  });

  it('leaves the progress count and bar to the banner', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 3, filesTotal: 10 });
    renderCard();
    const section = screen.getByRole('region', { name: 'Getting started' });
    expect(within(section).getByText('In progress')).toBeTruthy();
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
    const ask = await screen.findByRole('button', { name: 'Ask the browser to keep my data' });
    expect(persist).not.toHaveBeenCalled();
    fireEvent.click(ask);
    expect(await screen.findByText('Protected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask the browser to keep my data' })).toBeNull();
  });

  it('keeps focus while asking, then hands it to the answer instead of the body', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const persist = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    stub('storage', { persisted: () => Promise.resolve(false), persist });
    renderCard();
    const ask = await screen.findByRole('button', { name: 'Ask the browser to keep my data' });
    ask.focus();
    fireEvent.click(ask);
    // Disabled for real, the button would drop focus while the prompt is up.
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(ask);
    fireEvent.click(ask);
    expect(persist).toHaveBeenCalledOnce();

    await act(async () => answer(true));
    const status = screen.getByText('Protected');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });

  it('leaves focus where the player moved it while the prompt was open', async () => {
    let answer: (yes: boolean) => void = () => undefined;
    const persist = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    stub('storage', { persisted: () => Promise.resolve(false), persist });
    renderCard();
    const ask = await screen.findByRole('button', { name: 'Ask the browser to keep my data' });
    ask.focus();
    fireEvent.click(ask);
    const hide = screen.getByRole('button', { name: 'Got it, hide this' });
    hide.focus();

    await act(async () => answer(true));
    expect(await screen.findByText('Protected')).toBeTruthy();
    expect(document.activeElement).toBe(hide);
  });

  it('after a refusal, says the browser decides and points at backups', async () => {
    stub('storage', {
      persisted: () => Promise.resolve(false),
      persist: () => Promise.resolve(false),
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the browser to keep my data' }));
    expect(await screen.findByText('Not protected')).toBeTruthy();
    const item = screen.getByRole('heading', { name: 'Protect your data' }).closest('li');
    expect(item?.textContent).toContain('Your browser decides this itself');
    expect(item?.textContent).toContain('choose Export');
    // One pointer at backups, not "Back up instead:" and then the same again.
    expect(item?.textContent?.match(/Back up/g)).toHaveLength(1);
    expect(item?.textContent).toContain('Home Screen app has its own storage');
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
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
    expect(localStorage.getItem(ONBOARDING_KEY)).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Characters' }));

    unmount();
    renderCard();
    expect(screen.queryByRole('region', { name: 'Getting started' })).toBeNull();
  });
});
