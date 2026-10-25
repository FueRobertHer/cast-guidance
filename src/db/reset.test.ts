// @vitest-environment jsdom
// UX-002: after "Reset app data" the device is new to the app again, so the
// getting-started flag and the creator draft go with the database, and the
// service worker goes with its cache. Keys the app does not own stay.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ db: { close: vi.fn(), delete: vi.fn(() => Promise.resolve()) } }));

import { resetAppData } from './reset';

function stubServiceWorker(sw: Partial<ServiceWorkerContainer> | undefined) {
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('resetAppData', () => {
  it("clears the app's Web Storage keys and keeps everyone else's", async () => {
    localStorage.setItem('cast-guidance:onboarding', '{"v":1}');
    localStorage.setItem('cast-guidance:offline-ready-announced', 'x');
    localStorage.setItem('someone-else', 'keep');
    sessionStorage.setItem('cast-guidance:creator-draft', '{}');
    sessionStorage.setItem('other', 'keep');

    await resetAppData();

    expect(localStorage.getItem('cast-guidance:onboarding')).toBeNull();
    expect(localStorage.getItem('cast-guidance:offline-ready-announced')).toBeNull();
    expect(sessionStorage.getItem('cast-guidance:creator-draft')).toBeNull();
    expect(localStorage.getItem('someone-else')).toBe('keep');
    expect(sessionStorage.getItem('other')).toBe('keep');
  });

  it('unregisters every service worker', async () => {
    const unregister = vi.fn(() => Promise.resolve(true));
    stubServiceWorker({
      getRegistrations: () =>
        Promise.resolve([{ unregister }, { unregister }] as unknown as ServiceWorkerRegistration[]),
    });
    await resetAppData();
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it('finishes when storage or the worker API throws', async () => {
    localStorage.setItem('cast-guidance:onboarding', '{"v":1}');
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    stubServiceWorker({ getRegistrations: () => Promise.reject(new Error('no')) });
    await expect(resetAppData()).resolves.toBeUndefined();
  });
});
