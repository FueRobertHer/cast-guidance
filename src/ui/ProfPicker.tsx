import type { ProfLevel } from '@/engine/types';
import { ProfDot } from './ProfDot';

const LEVELS: ReadonlyArray<{ level: ProfLevel; label: string }> = [
  { level: 0, label: 'None' },
  { level: 1, label: 'Proficient' },
  { level: 2, label: 'Expertise' },
];

const NAMES: Record<ProfLevel, string> = {
  0: 'not proficient',
  1: 'proficient',
  2: 'expertise',
};

/**
 * Set a proficiency level by hand, for the cases the engine can't know about:
 * a DM's ruling, a homebrew feature, or a printing the data doesn't carry.
 *
 * Picking a level pins it. The pin survives rebuilds, so `base` (what the
 * character's own class/race/background grants) is named on the clear button:
 * it is the thing the player gets back, and without it they cannot tell what
 * they are giving up.
 */
export function ProfPicker({
  value,
  base,
  overridden,
  onChange,
}: {
  value: ProfLevel;
  base: ProfLevel;
  overridden: boolean;
  onChange: (level: ProfLevel | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-muted">Proficiency</span>
      <div className="flex gap-1.5">
        {LEVELS.map(({ level, label }) => (
          <button
            key={level}
            type="button"
            aria-pressed={value === level}
            onClick={() => onChange(level)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${
              value === level
                ? 'border-accent bg-accent-deep/40 font-semibold'
                : 'border-surface-2 text-ink-muted'
            }`}
          >
            <ProfDot level={level} />
            {label}
          </button>
        ))}
      </div>
      {overridden ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="self-start rounded px-1 py-1 text-xs text-ink-muted underline"
        >
          Set manually. Clear to go back to {NAMES[base]}.
        </button>
      ) : (
        <p className="text-xs text-ink-muted">From your class, species, and background.</p>
      )}
    </div>
  );
}
