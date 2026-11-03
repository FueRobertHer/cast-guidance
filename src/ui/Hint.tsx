import { Info, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

/** The `cast-guidance:` prefix is what `resetAppData` sweeps. */
export const TIP_KEY_PREFIX = 'cast-guidance:tip:';

/** Anything unreadable counts as not dismissed: a tip shown twice costs a tap. */
function readDismissed(id: string): boolean {
  try {
    return localStorage.getItem(TIP_KEY_PREFIX + id) !== null;
  } catch {
    return false;
  }
}

/**
 * A one-time tip's state (DS-001 Hint): shown until dismissed, then never
 * again on this device. Also dismissed by using what it explains ("dismissed
 * for good once used"), which is why the caller holds it. When storage
 * refuses the write, the dismissal holds for the rest of the visit.
 */
export function useTip(id: string): { shown: boolean; dismiss: () => void } {
  const [dismissed, setDismissed] = useState(() => readDismissed(id));
  return {
    shown: !dismissed,
    dismiss: () => {
      if (dismissed) return;
      setDismissed(true);
      try {
        localStorage.setItem(TIP_KEY_PREFIX + id, new Date().toISOString());
      } catch {
        // Remembered in memory only; it shows again next visit.
      }
    },
  };
}

/**
 * A neutral how-to tip (DS-001 Hint): `surface-raised` with an Info icon, at
 * most two sentences, and a dismiss button. The guide's own voice
 * (`guide-soft`, Lightbulb) is for advice, not for how a control works.
 */
export function Tip({ children, onDismiss }: { children: ReactNode; onDismiss: () => void }) {
  return (
    <div className="flex gap-3 rounded-control bg-surface-raised py-3 pr-2 pl-3 text-ink">
      <Info size={18} aria-hidden="true" className="mt-px shrink-0 text-ink-muted" />
      <p className="min-w-0 flex-1 text-[0.875rem] leading-5">{children}</p>
      {/* A 44px target whose margins keep the tip one line tall. */}
      <button
        type="button"
        aria-label="Dismiss tip"
        onClick={onDismiss}
        className="-my-3 -mr-2 flex size-tap shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-120 hover:text-ink"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
