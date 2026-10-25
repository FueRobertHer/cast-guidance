// @vitest-environment jsdom
// UX-002: the getting-started card is shown once and stays hidden after "Got
// it", and nothing about storage may make it crash or stay hidden from
// someone who never saw it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnboardingStore, ONBOARDING_KEY } from './onboarding';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('onboarding store', () => {
  it('starts undismissed, remembers a dismissal, and a fresh store reads it back', () => {
    const store = createOnboardingStore();
    expect(store.getState().dismissed).toBe(false);

    store.getState().dismiss();
    expect(store.getState().dismissed).toBe(true);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEY) ?? 'null')).toMatchObject({ v: 1 });
    // A reload, as far as the store can tell.
    expect(createOnboardingStore().getState().dismissed).toBe(true);
  });

  it('reopen() shows it again and forgets the stored dismissal', () => {
    const store = createOnboardingStore();
    store.getState().dismiss();
    store.getState().reopen();
    expect(store.getState().dismissed).toBe(false);
    expect(localStorage.getItem(ONBOARDING_KEY)).toBeNull();
    expect(createOnboardingStore().getState().dismissed).toBe(false);
  });

  it('still dismisses for the session when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const store = createOnboardingStore();
    expect(() => store.getState().dismiss()).not.toThrow();
    expect(store.getState().dismissed).toBe(true);
  });

  it('treats a malformed or older value, or unreadable storage, as not seen', () => {
    localStorage.setItem(ONBOARDING_KEY, '{not json');
    expect(createOnboardingStore().getState().dismissed).toBe(false);
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ v: 0 }));
    expect(createOnboardingStore().getState().dismissed).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(createOnboardingStore().getState().dismissed).toBe(false);
  });
});
