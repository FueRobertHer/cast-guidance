// @vitest-environment jsdom
// UX-002: the toast owns the app's only service worker registration, so the
// offline-readiness line knows only what it reports. A warm boot reports
// through the registration, a first install through onOfflineReady.
import { act, cleanup, render, screen } from '@testing-library/react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  needRefresh: false,
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    captured.options = options;
    return {
      needRefresh: [captured.needRefresh, () => undefined],
      updateServiceWorker: () => undefined,
    };
  },
}));

import { DEDUPE_MS, getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { swStatusStore } from '@/stores/swStatus';
import { PWA_UPDATE_TEXT, PwaUpdateToast } from './PwaUpdateToast';

function registered(): RegisterSWOptions {
  render(<PwaUpdateToast />);
  if (captured.options === undefined) throw new Error('useRegisterSW was not called');
  return captured.options;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetAnnouncer();
  captured.options = undefined;
  captured.needRefresh = false;
  swStatusStore.setState({ state: 'pending' });
});

describe('PwaUpdateToast service worker status', () => {
  it('reports ready on a warm boot, from the active worker in the registration', () => {
    const options = registered();
    options.onRegisteredSW?.('/sw.js', { active: null } as ServiceWorkerRegistration);
    expect(swStatusStore.getState().state).toBe('pending');
    options.onRegisteredSW?.('/sw.js', { active: {} } as ServiceWorkerRegistration);
    expect(swStatusStore.getState().state).toBe('ready');
  });

  it('reports ready when the first install finishes', () => {
    registered().onOfflineReady?.();
    expect(swStatusStore.getState().state).toBe('ready');
  });

  it('reports a failed registration, but never over a shell already installed', () => {
    const options = registered();
    options.onRegisterError?.(new Error('blocked'));
    expect(swStatusStore.getState().state).toBe('error');

    options.onOfflineReady?.();
    options.onRegisterError?.(new Error('update check failed'));
    expect(swStatusStore.getState().state).toBe('ready');
  });
});

// A11Y-002, amendment S10: the offer is a plain visual, said once through the
// announcer under the 'update' key, since a region that mounts with its text is
// announced unreliably.
describe('PwaUpdateToast announcement', () => {
  it('says a waiting version once, however often the toast renders', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { rerender } = render(<PwaUpdateToast />);
    expect(getAnnouncerState().emitted).toBe(0);

    captured.needRefresh = true;
    rerender(<PwaUpdateToast />);
    expect(screen.getByText(PWA_UPDATE_TEXT)).toBeTruthy();
    // Past the de-duplication window, so only the component keeps it to one.
    for (let i = 0; i < 3; i++) {
      act(() => vi.advanceTimersByTime(DEDUPE_MS + 1));
      rerender(<PwaUpdateToast />);
    }

    expect(getAnnouncerState().emitted).toBe(1);
    const toast = screen.getByText(PWA_UPDATE_TEXT);
    expect(toast.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });

  it('is said in the polite region', () => {
    captured.needRefresh = true;
    render(<PwaUpdateToast />);
    expect(getAnnouncerState().messages).toMatchObject([
      { text: PWA_UPDATE_TEXT, politeness: 'polite' },
    ]);
  });
});
