import { useScrollHidden } from '@/lib/useScrollHidden';
import { ADV_MODES, type AdvMode, useAdvMode } from '@/stores/advMode';

const LABELS: Record<AdvMode, string> = { dis: 'DIS', normal: 'N', adv: 'ADV' };

/** Spoken names: the abbreviations above read as letters, and each is inside its word. */
const FULL: Record<AdvMode, string> = {
  dis: 'Disadvantage',
  normal: 'Normal',
  adv: 'Advantage',
};

/**
 * Always-visible advantage toggle: the dice dock (DS-001), one capsule above
 * the tab bar holding the roll mode for every d20 roll made anywhere until
 * switched back, and at its end the dice tray's button, which DiceTray draws
 * into the room left for it here. The mode in use is an `ink` pill, as
 * selection is everywhere, so it reads without colour.
 *
 * Each mode is a 44px tap with its pill 40px inside it, as the dice button
 * is. Hidden by scroll, focus inside brings it back, so the keyboard never
 * lands on an invisible button. `data-dice-dock` lets the roll toast rise
 * above it.
 */
export function AdvToggle() {
  const mode = useAdvMode((s) => s.mode);
  const set = useAdvMode((s) => s.set);
  const hidden = useScrollHidden();

  return (
    // A fieldset (min-w-0 undoes its min-content width) so the buttons are
    // announced as one labelled set.
    <fieldset
      data-dice-dock=""
      className={`fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex h-dock min-w-0 items-center gap-0.5 rounded-full bg-surface p-0.5 pr-11.5 shadow-float ring-1 ring-line ring-inset transition-all duration-200 lg:bottom-6 ${
        hidden
          ? 'pointer-events-none translate-x-20 opacity-0 has-focus-visible:pointer-events-auto has-focus-visible:translate-x-0 has-focus-visible:opacity-100'
          : ''
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
          className="h-11 min-w-12 rounded-full border-2 border-transparent bg-clip-padding px-2 font-bold text-[0.75rem] text-ink-muted tracking-[0.02em] transition-colors duration-120 [--tap-inset:2px] not-aria-pressed:hover:text-ink aria-pressed:bg-ink aria-pressed:text-bg"
        >
          {LABELS[m]}
        </button>
      ))}
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-line" />
    </fieldset>
  );
}
