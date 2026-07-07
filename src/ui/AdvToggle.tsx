import { type AdvMode, useAdvMode } from '@/stores/advMode';

const MODES: Array<[AdvMode, string, string]> = [
  ['dis', 'DIS', 'text-accent border-accent'],
  ['normal', 'N', 'text-ink border-ink'],
  ['adv', 'ADV', 'text-emerald-300 border-emerald-300'],
];

/**
 * Always-visible advantage toggle, stacked above the dice FAB. Applies to
 * every d20 roll made anywhere until switched back.
 */
export function AdvToggle() {
  const mode = useAdvMode((s) => s.mode);
  const set = useAdvMode((s) => s.set);

  return (
    <div
      className={`fixed right-4 bottom-[7.5rem] z-20 flex overflow-hidden rounded-full border bg-surface shadow-lg lg:bottom-20 ${
        mode === 'adv'
          ? 'border-emerald-300/60'
          : mode === 'dis'
            ? 'border-accent/60'
            : 'border-surface-2'
      }`}
      title="Advantage / disadvantage for every d20 roll"
    >
      {MODES.map(([m, label, activeCls]) => (
        <button
          key={m}
          type="button"
          onClick={() => set(m)}
          className={`px-2.5 py-1.5 text-[11px] font-bold ${
            mode === m ? activeCls : 'text-ink-muted'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
