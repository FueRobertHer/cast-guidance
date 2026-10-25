// @vitest-environment jsdom
// UX-002: "Ready to use offline" is said once per device, when it becomes
// true, to someone who is not looking at the card that already says so. A
// device that was ready before this visit hears nothing, and a notice that is
// still on screen is not replaced.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataStatusStore } from '@/stores/dataStatus';
import { NOTICE_MS, noticeStore, notify } from '@/stores/notices';
import { onboardingStore } from '@/stores/onboarding';
import { swStatusStore } from '@/stores/swStatus';
import { OFFLINE_ANNOUNCED_KEY, OfflineReadyNotice } from './OfflineReadyNotice';

const READY_TITLE = 'Ready to use offline';

function stubController(controller: object | null) {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { controller },
    configurable: true,
  });
}

/** Every notice title pushed since the test began, in order. */
let pushed: string[] = [];
let unsubscribe: () => void = () => undefined;

/** The download finishing, having fetched files this run. */
function finishDownload() {
  act(() => dataStatusStore.setState({ phase: 'done', filesDone: 12, filesTotal: 12 }));
}

beforeEach(() => {
  vi.stubEnv('DEV', false);
  stubController(null);
  onboardingStore.setState({ dismissed: true });
  swStatusStore.setState({ state: 'ready' });
  dataStatusStore.setState({ phase: 'working', filesDone: 0, filesTotal: 0 });
  noticeStore.setState({ notice: null, seq: 0 });
  pushed = [];
  unsubscribe = noticeStore.subscribe((s, prev) => {
    if (s.seq !== prev.seq && s.notice !== null) pushed.push(s.notice.title);
  });
});

afterEach(() => {
  cleanup();
  unsubscribe();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  localStorage.clear();
  onboardingStore.setState({ dismissed: false });
  swStatusStore.setState({ state: 'pending' });
  dataStatusStore.setState({ phase: 'idle', filesDone: 0, filesTotal: 0 });
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('OfflineReadyNotice', () => {
  it('announces once when the device becomes ready, and never again', () => {
    const { unmount } = render(<OfflineReadyNotice />);
    expect(pushed).toEqual([]);

    finishDownload();
    expect(pushed).toEqual([READY_TITLE]);
    expect(noticeStore.getState().notice?.tone).toBe('good');
    expect(localStorage.getItem(OFFLINE_ANNOUNCED_KEY)).not.toBeNull();

    // Another run finishing, then a fresh boot: both already announced.
    act(() => dataStatusStore.setState({ phase: 'working' }));
    finishDownload();
    unmount();
    render(<OfflineReadyNotice />);
    finishDownload();
    expect(pushed).toEqual([READY_TITLE]);
  });

  it('waits for the shell as well as the data', () => {
    swStatusStore.setState({ state: 'pending' });
    render(<OfflineReadyNotice />);
    finishDownload();
    expect(pushed).toEqual([]);
    act(() => swStatusStore.getState().markReady());
    expect(pushed).toEqual([READY_TITLE]);
  });

  it('stays quiet while the getting-started card is showing Ready itself', () => {
    onboardingStore.setState({ dismissed: false });
    render(<OfflineReadyNotice />);
    finishDownload();
    expect(pushed).toEqual([]);
    // Settled, so hiding the card later does not announce a stale change.
    expect(localStorage.getItem(OFFLINE_ANNOUNCED_KEY)).not.toBeNull();
  });

  it('records a device that was already ready without a word', () => {
    stubController({});
    render(<OfflineReadyNotice />);
    // A warm boot: launched under a worker, nothing left to fetch.
    act(() => dataStatusStore.setState({ phase: 'done', filesDone: 0, filesTotal: 0 }));
    expect(pushed).toEqual([]);
    expect(localStorage.getItem(OFFLINE_ANNOUNCED_KEY)).not.toBeNull();
  });

  it('still announces a warm shell that finished the download this visit', () => {
    stubController({});
    render(<OfflineReadyNotice />);
    finishDownload();
    expect(pushed).toEqual([READY_TITLE]);
  });

  it('never announces in a dev build, which has no worker', () => {
    vi.stubEnv('DEV', true);
    render(<OfflineReadyNotice />);
    finishDownload();
    expect(pushed).toEqual([]);
    expect(localStorage.getItem(OFFLINE_ANNOUNCED_KEY)).toBeNull();
  });

  it('waits for a notice on screen to finish instead of replacing it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    render(<OfflineReadyNotice />);
    act(() => notify({ title: 'Long rest', tone: 'info' }));
    finishDownload();
    expect(noticeStore.getState().notice?.title).toBe('Long rest');

    act(() => vi.advanceTimersByTime(NOTICE_MS - 1));
    expect(noticeStore.getState().notice?.title).toBe('Long rest');
    act(() => vi.advanceTimersByTime(1));
    expect(pushed).toEqual(['Long rest', READY_TITLE]);
  });
});
