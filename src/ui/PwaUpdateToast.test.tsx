// @vitest-environment jsdom
// UX-002: the toast owns the app's only service worker registration, so the
// offline-readiness line knows only what it reports. A warm boot reports
// through the registration, a first install through onOfflineReady.
import { cleanup, render } from '@testing-library/react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ options: undefined as RegisterSWOptions | undefined }));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    captured.options = options;
    return { needRefresh: [false, () => undefined], updateServiceWorker: () => undefined };
  },
}));

import { swStatusStore } from '@/stores/swStatus';
import { PwaUpdateToast } from './PwaUpdateToast';

function registered(): RegisterSWOptions {
  render(<PwaUpdateToast />);
  if (captured.options === undefined) throw new Error('useRegisterSW was not called');
  return captured.options;
}

afterEach(() => {
  cleanup();
  captured.options = undefined;
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
