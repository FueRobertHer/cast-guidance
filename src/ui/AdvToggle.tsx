import { useScrollHidden } from '@/lib/useScrollHidden';
import { ADV_MODES, type AdvMode, useAdvMode } from '@/stores/advMode';

const LABELS: Record<AdvMode, string> = { dis: 'DIS', normal: 'N', adv: 'ADV' };

/** Spoken names: the abbreviations above read as letters, and each is inside its word. */
const FULL: Record<AdvMode, string> = {
  dis: 'Disadvantage',
  normal: 'Normal',
  adv: 'Advantage',
};

const ACTIVE: Record<AdvMode, string> = {
  dis: 'text-accent border-accent',
  normal: 'text-ink border-ink',
  adv: 'text-emerald-300 border-emerald-300',
};

/**
 * Always-visible advantage toggle, stacked above the dice FAB. Applies to
 * every d20 roll made anywhere until switched back. Hidden by scroll, focus
 * inside brings it back, so the keyboard never lands on an invisible button.
 */
export function AdvToggle() {
  const mode = useAdvMode((s) => s.mode);
  const set = useAdvMode((s) => s.set);
  const hidden = useScrollHidden();

  return (
    // A fieldset (min-w-0 undoes its min-content width) so the buttons are
    // announced as one labelled set.
    <fieldset
      className={`fixed right-4 bottom-[calc(8.25rem+env(safe-area-inset-bottom))] z-20 flex min-w-0 overflow-hidden rounded-full border bg-surface shadow-lg transition-all duration-200 lg:bottom-20 ${
        hidden
          ? 'pointer-events-none translate-x-32 opacity-0 has-focus-visible:pointer-events-auto has-focus-visible:translate-x-0 has-focus-visible:opacity-100'
          : ''
      } ${
        mode === 'adv'
          ? 'border-emerald-300/60'
          : mode === 'dis'
            ? 'border-accent/60'
            : 'border-surface-2'
      }`}
      title="Advantage / disadvantage for every d20 roll"
    >
      <legend className="sr-only">Roll mode for every d20 roll</legend>
      {ADV_MODES.map((m) => (
        <button
          key={m}
          type="button"
          aria-label={FULL[m]}
          aria-pressed={mode === m}
          onClick={() => set(m)}
          className={`px-2.5 py-1.5 text-[11px] font-bold ${
            mode === m ? ACTIVE[m] : 'text-ink-muted'
          }`}
        >
          {LABELS[m]}
        </button>
      ))}
    </fieldset>
  );
}
