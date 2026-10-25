import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * localStorage rather than `db.settings`: Dexie answers a tick late, so the
 * getting-started card would pop in after first paint and shove the roster
 * down. The `cast-guidance:` prefix is what `resetAppData` sweeps.
 */
export const ONBOARDING_KEY = 'cast-guidance:onboarding';

/** Bump to show the card again to everyone after a material change to it. */
const VERSION = 1;

export interface OnboardingState {
  dismissed: boolean;
  /**
   * How many getting-started cards are on screen right now. Not persisted: it
   * is what lets the offline notice stay quiet only while a card is there to
   * say the same thing, rather than whenever the card has not been hidden.
   */
  cardsShown: number;
  dismiss(): void;
  reopen(): void;
  /** Count a card as on screen; call the returned function when it leaves. */
  cardShown(): () => void;
}

/**
 * Anything unreadable counts as not seen: showing the card once too often
 * costs a tap, hiding it from someone who never saw it costs the point.
 */
function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && 'v' in parsed && parsed.v === VERSION;
  } catch {
    return false;
  }
}

/**
 * The store holds the answer so the roster card and Settings' "show it again"
 * agree without a reload. When storage refuses the write, the dismissal still
 * holds for the rest of the session.
 */
export function createOnboardingStore() {
  return createStore<OnboardingState>((set) => ({
    dismissed: readDismissed(),
    cardsShown: 0,
    cardShown: () => {
      set((s) => ({ cardsShown: s.cardsShown + 1 }));
      return () => set((s) => ({ cardsShown: s.cardsShown - 1 }));
    },
    dismiss: () => {
      set({ dismissed: true });
      try {
        localStorage.setItem(
          ONBOARDING_KEY,
          JSON.stringify({ v: VERSION, dismissedAt: new Date().toISOString() }),
        );
      } catch {
        // Remembered in memory only; it shows again next visit.
      }
    },
    reopen: () => {
      set({ dismissed: false });
      try {
        localStorage.removeItem(ONBOARDING_KEY);
      } catch {
        // Nothing stored to remove, or nothing that can be.
      }
    },
  }));
}

export const onboardingStore = createOnboardingStore();

export function useOnboarding<T>(selector: (s: OnboardingState) => T): T {
  return useStore(onboardingStore, selector);
}
