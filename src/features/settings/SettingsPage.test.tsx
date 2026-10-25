// @vitest-environment jsdom
// The data section makes two claims a user acts on: which version is installed
// and whether the compendium is complete. Both can fail, and a failure that
// only reaches the console leaves the page asserting something untrue.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loader = vi.hoisted(() => ({
  dismissRollbackNotice: vi.fn(() => Promise.resolve()),
  downloadAllPacks: vi.fn(() => Promise.resolve()),
  retryDataLayer: vi.fn(),
  getActiveTag: vi.fn(() => 'v2.32.0'),
  listAvailableTags: vi.fn(() => Promise.resolve(['v2.33.0', 'v2.32.0'])),
  updateToTag: vi.fn(() => Promise.resolve()),
  verifyFullOffline: vi.fn(() => Promise.resolve({ cached: 31, total: 48 })),
}));

vi.mock('@/data5e/loader', () => ({
  ...loader,
  CompendiumNotDownloadedError: class extends Error {},
}));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/db/dataCacheRepo', () => ({
  dataCacheRepo: { totalBytes: () => Promise.resolve(0) },
}));
vi.mock('@/db/reset', () => ({ resetAppData: vi.fn() }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true) }));
vi.mock('./SourcesSection', () => ({ SourcesSection: () => null }));

import { flushLanded, noteFileLanded } from '@/data5e/landing';
import { QUOTA_GUIDANCE } from '@/lib/storageErrors';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { dataStatusStore } from '@/stores/dataStatus';
import { OFFLINE_ANNOUNCED_KEY } from '@/stores/offlineReady';
import { onboardingStore } from '@/stores/onboarding';
import { DataBanner } from '@/ui/DataBanner';
import { listenForAnnouncements } from '../../../tests-fixtures/announcements';
import { quotaExceeded } from '../../../tests-fixtures/idbFaults';
import { ABOUT_LINKS, OFFLINE_DOWNLOADED_TEXT, Component as SettingsPage } from './SettingsPage';

/** The failure line under the control that failed, a plain visual now. */
const failureLine = async (text: RegExp) => {
  const line = (await screen.findByText(text)).closest('div');
  if (line === null) throw new Error(`no line for ${text}`);
  return line;
};

/** Walk the version picker as a user does, up to the install attempt. */
async function installVersion(tag: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Check for data updates' }));
  const select = await screen.findByLabelText('Switch version');
  fireEvent.change(select, { target: { value: tag } });
}

afterEach(() => {
  cleanup();
  for (const fn of Object.values(loader)) fn.mockClear();
  loader.updateToTag.mockResolvedValue(undefined);
  loader.downloadAllPacks.mockResolvedValue(undefined);
  loader.verifyFullOffline.mockResolvedValue({ cached: 31, total: 48 });
  dataStatusStore.setState({
    rolledBackFrom: undefined,
    phase: 'idle',
    error: undefined,
    failedTag: undefined,
  });
  resetAnnouncer();
});

describe('SettingsPage data section', () => {
  it('offers to retry the install that failed, without asking again', async () => {
    loader.updateToTag.mockRejectedValueOnce(new Error('HTTP 500'));
    render(<SettingsPage />);
    await installVersion('v2.33.0');

    const failure = await failureLine(/Update failed/);
    expect(failure.textContent).toContain('HTTP 500');
    // The old version is still the one in use, and the page says so.
    expect(failure.textContent).toContain('current version is untouched');

    fireEvent.click(screen.getByRole('button', { name: 'Retry install' }));
    await waitFor(() => expect(loader.updateToTag).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Update failed/)).toBeNull());
    expect(screen.getByText(/Now on v2\.33\.0/)).toBeTruthy();
  });

  it('gives the incomplete offline compendium a control that completes it', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    await waitFor(() => expect(loader.downloadAllPacks).toHaveBeenCalledOnce());
    // Once every file is cached the claim is true, so the control retires.
    await waitFor(() => expect(screen.queryByText('31/48 files')).toBeNull());
    expect(screen.getByText('ready ✓')).toBeTruthy();
  });

  it('counts the compendium again when the background download finishes', async () => {
    // Opened mid-drain: the count on mount is a snapshot of a moving target.
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    act(() => dataStatusStore.getState().setPhase('done'));
    expect(await screen.findByText('ready ✓')).toBeTruthy();
  });

  it('counts the compendium again as downloaded files land', async () => {
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);
    expect(await screen.findByText('31/48 files')).toBeTruthy();

    loader.verifyFullOffline.mockResolvedValue({ cached: 40, total: 48 });
    act(() => {
      noteFileLanded();
      flushLanded();
    });
    expect(await screen.findByText('40/48 files')).toBeTruthy();
  });

  it('keeps the newest count when an older one resolves after it', async () => {
    let finishFirst: (v: { cached: number; total: number }) => void = () => undefined;
    loader.verifyFullOffline.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirst = resolve;
      }),
    );
    dataStatusStore.setState({ phase: 'working' });
    render(<SettingsPage />);

    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    act(() => dataStatusStore.getState().setPhase('done'));
    expect(await screen.findByText('ready ✓')).toBeTruthy();

    // The mount's count, taken before the drain finished, arrives last.
    await act(async () => finishFirst({ cached: 13, total: 48 }));
    expect(screen.getByText('ready ✓')).toBeTruthy();
    expect(screen.queryByText('13/48 files')).toBeNull();
  });

  it('says the offline inventory could not be read, and still offers the download', async () => {
    // "…" forever with no error and no control is the dead end this replaces.
    loader.verifyFullOffline.mockRejectedValue(new Error('offline'));
    render(<SettingsPage />);

    expect(await screen.findByText('could not be read')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make available offline' })).toBeTruthy();
  });

  it('announces a failure to list versions as a failure', async () => {
    loader.listAvailableTags.mockRejectedValueOnce(new Error('rate limited'));
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Check for data updates' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not list versions');
    // Nothing to retry an install of, so the only affordance is the check again.
    expect(screen.queryByRole('button', { name: 'Retry install' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check for data updates' })).toBeTruthy();
  });

  it('reports a failed download and turns the same control into a retry', async () => {
    loader.downloadAllPacks.mockRejectedValueOnce(new Error('offline'));
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    expect((await failureLine(/Download failed/)).textContent).toContain('offline');
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    await waitFor(() => expect(loader.downloadAllPacks).toHaveBeenCalledTimes(2));
  });

  // Both failures are shown as text, so a full device is told what to do
  // rather than "The quota has been exceeded." (TEST-002).
  it('words a failed install on a full device as guidance', async () => {
    loader.updateToTag.mockRejectedValueOnce(quotaExceeded());
    render(<SettingsPage />);
    await installVersion('v2.33.0');

    const alert = await failureLine(/Update failed/);
    expect(alert.textContent).toContain(QUOTA_GUIDANCE);
    expect(alert.textContent).not.toContain('quota has been exceeded');
  });

  it('words a failed download on a full device as guidance', async () => {
    loader.downloadAllPacks.mockRejectedValueOnce(quotaExceeded());
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));

    const alert = await failureLine(/Download failed/);
    expect(alert.textContent).toContain(QUOTA_GUIDANCE);
    expect(alert.textContent).not.toContain('quota has been exceeded');
  });

  it('says when the installed version is one the app went back to', () => {
    // The banner can be dismissed; the version line is where someone looking
    // for why their update is gone will look next.
    dataStatusStore.setState({ rolledBackFrom: 'v2.33.0' });
    render(<SettingsPage />);
    expect(screen.getByText(/went back from v2\.33\.0, which could not start/)).toBeTruthy();
  });
});

// A11Y-002: a failure here also reaches the shell's DataBanner, whose alert
// says it. Two alerts for one failure were read back to back, so the page's own
// lines are visual, and an outcome nothing else says goes through the announcer.
describe('SettingsPage data announcements', () => {
  /** The page as the shell shows it, with the banner beside it. */
  const renderInShell = () =>
    render(
      <>
        <DataBanner />
        <SettingsPage />
      </>,
    );

  it('alerts a failed download once, through the banner', async () => {
    // The loader records the failure where the banner reads it, then rejects.
    loader.downloadAllPacks.mockImplementationOnce(() => {
      dataStatusStore.getState().setPhase('error', 'offline');
      return Promise.reject(new Error('offline'));
    });
    renderInShell();
    const download = await screen.findByRole('button', { name: 'Make available offline' });
    const listener = listenForAnnouncements();
    fireEvent.click(download);
    await screen.findByText(/Download failed/);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry download' })).toBeTruthy(),
    );
    listener.stop();

    expect(listener.heard).toHaveLength(1);
    expect(listener.heard[0]).toContain('Game data download failed: offline');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('alerts a failed install once, through the banner', async () => {
    loader.updateToTag.mockImplementationOnce(() => {
      const status = dataStatusStore.getState();
      status.setPhase('error', 'HTTP 500');
      status.setFailedTag('v2.33.0');
      return Promise.reject(new Error('HTTP 500'));
    });
    renderInShell();
    await installVersion('v2.33.0');
    await screen.findByText(/Update failed/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Update to v2.33.0 failed');
  });

  it('decides a failure line is not an alert once, and a banner Retry does not change that', async () => {
    // The line stays on screen through a Retry from the banner. Read from the
    // live phase, it became an alert the moment the retry moved the phase
    // on, and stayed one after the retry worked.
    loader.updateToTag.mockImplementationOnce(() => {
      const status = dataStatusStore.getState();
      status.setPhase('error', 'HTTP 500');
      status.setFailedTag('v2.33.0');
      return Promise.reject(new Error('HTTP 500'));
    });
    let finish: () => void = () => undefined;
    loader.updateToTag.mockImplementationOnce(() => {
      dataStatusStore.getState().beginRun();
      return new Promise<void>((resolve) => {
        finish = () => {
          dataStatusStore.getState().setPhase('done');
          resolve();
        };
      });
    });
    renderInShell();
    await installVersion('v2.33.0');
    const line = (await screen.findByText(/^Update failed: HTTP 500/)).parentElement;
    const roles: Array<string | null> = [line?.getAttribute('role') ?? null];

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(loader.updateToTag).toHaveBeenCalledTimes(2));
    roles.push(line?.getAttribute('role') ?? null);
    await act(async () => finish());
    roles.push(line?.getAttribute('role') ?? null);

    expect(roles).toEqual([null, null, null]);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('decides a download failure line is not an alert once, through a banner Retry', async () => {
    loader.downloadAllPacks.mockImplementationOnce(() => {
      dataStatusStore.getState().setPhase('error', 'offline');
      return Promise.reject(new Error('offline'));
    });
    // The banner's Retry re-arms the background queue.
    loader.retryDataLayer.mockImplementationOnce(() => {
      dataStatusStore.getState().beginRun();
    });
    renderInShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));
    const line = await screen.findByText(/^Download failed: offline/);
    expect(line.getAttribute('role')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(loader.retryDataLayer).toHaveBeenCalledOnce());
    act(() => dataStatusStore.getState().setPhase('done'));
    expect(screen.getByText(/^Download failed: offline/).getAttribute('role')).toBeNull();
  });

  it('keeps a failed version check an alert, since nothing else reports it', async () => {
    loader.listAvailableTags.mockRejectedValueOnce(new Error('rate limited'));
    renderInShell();
    fireEvent.click(screen.getByRole('button', { name: 'Check for data updates' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not list versions');
  });

  it('says once that a requested download finished, on a device past its offline notice', async () => {
    localStorage.setItem(OFFLINE_ANNOUNCED_KEY, 'earlier');
    loader.verifyFullOffline.mockResolvedValueOnce({ cached: 31, total: 48 });
    render(<SettingsPage />);
    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));
    await screen.findByText('ready ✓');
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual([OFFLINE_DOWNLOADED_TEXT]);
    localStorage.removeItem(OFFLINE_ANNOUNCED_KEY);
  });

  it('leaves the news to the one-time offline notice when that is still to come', async () => {
    // Finishing the download is what fires "Ready to use offline"; saying
    // "Game data downloaded" as well would be two lines for one event.
    localStorage.removeItem(OFFLINE_ANNOUNCED_KEY);
    loader.verifyFullOffline.mockResolvedValueOnce({ cached: 31, total: 48 });
    render(<SettingsPage />);
    loader.verifyFullOffline.mockResolvedValue({ cached: 48, total: 48 });
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));
    await screen.findByText('ready ✓');
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('marks the download control busy while it runs, described by the queue count', async () => {
    let finish: () => void = () => undefined;
    loader.downloadAllPacks.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    render(<SettingsPage />);
    const button = await screen.findByRole('button', { name: 'Make available offline' });
    expect(button.getAttribute('aria-busy')).toBe('false');
    const queue = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(queue?.previousElementSibling?.textContent).toBe('Download queue');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Downloading…' }).getAttribute('aria-busy')).toBe(
      'true',
    );
    await act(async () => finish());
  });

  it('keeps a failed install an alert when the banner is not showing it', async () => {
    // Rejected with nothing recorded where the banner reads, as a failure
    // outside the loader's own catch would be.
    loader.updateToTag.mockRejectedValueOnce(new Error('HTTP 500'));
    renderInShell();
    await installVersion('v2.33.0');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Update failed: HTTP 500');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('keeps a failed download an alert when the banner is not showing it', async () => {
    loader.downloadAllPacks.mockRejectedValueOnce(new Error('offline'));
    renderInShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Make available offline' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Download failed: offline');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('says once that an install finished', async () => {
    render(<SettingsPage />);
    await installVersion('v2.33.0');
    await screen.findByText(/Now on v2\.33\.0/);
    expect(getAnnouncerState().messages.map((m) => m.text)).toEqual([
      'Now on v2.33.0. Characters re-derive automatically.',
    ]);
  });
});

describe('SettingsPage data and privacy', () => {
  afterEach(() => {
    onboardingStore.setState({ dismissed: false });
    Reflect.deleteProperty(navigator, 'storage');
  });

  it('brings the getting-started guide back and says where it went', () => {
    // UX-002: reopened in place, with no navigation and no focus jump.
    onboardingStore.setState({ dismissed: true });
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the getting-started guide' }));
    expect(onboardingStore.getState().dismissed).toBe(false);
    expect(screen.getByText('Shown on the Characters page.')).toBeTruthy();
  });

  it('shows whether storage is persistent and asks from a click', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: () => Promise.resolve(false), persist },
      configurable: true,
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Not protected yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the browser to keep my data' }));
    expect(await screen.findByText('Protected')).toBeTruthy();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('keeps focus on the ask while it runs, then moves it to the answer', async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(false) },
      configurable: true,
    });
    render(<SettingsPage />);
    const ask = await screen.findByRole('button', { name: 'Ask the browser to keep my data' });
    ask.focus();
    fireEvent.click(ask);
    expect(ask.getAttribute('aria-disabled')).toBe('true');
    expect(ask.hasAttribute('disabled')).toBe(false);
    const status = await screen.findByText('Not protected');
    await waitFor(() => expect(document.activeElement).toBe(status));
  });
});

describe('SettingsPage about', () => {
  it('states the license and links the license, notices and content notice on GitHub', () => {
    render(<SettingsPage />);
    const about = screen.getByRole('heading', { name: 'About' }).closest('section');
    if (!about) throw new Error('no About section');
    expect(about.textContent).toContain('Cast Guidance is open source under the MIT License.');
    const links = Array.from(about.querySelectorAll('a'), (a) => ({
      name: a.textContent,
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }));
    const blob = 'https://github.com/FueRobertHer/cast-guidance/blob/main';
    const opens = { target: '_blank', rel: 'noreferrer noopener' };
    // Said after each name, since each link opens a new tab.
    const tab = ' (opens in a new tab)';
    expect(links).toEqual([
      { name: `License${tab}`, href: `${blob}/LICENSE`, ...opens },
      { name: `Third-party notices${tab}`, href: `${blob}/THIRD_PARTY_NOTICES.md`, ...opens },
      { name: `Content notice${tab}`, href: `${blob}/docs/content-notice.md`, ...opens },
    ]);
    expect(screen.getByRole('link', { name: `License${tab}` })).toBeTruthy();
  });

  // Catches: a link that 404s on GitHub because its file was renamed or never added.
  it('links only files that exist in the repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    for (const link of ABOUT_LINKS) {
      expect(existsSync(path.join(root, link.path)), link.path).toBe(true);
    }
  });
});
