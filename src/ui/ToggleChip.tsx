import type { LucideIcon } from 'lucide-react';

/**
 * Turns one lasting state on or off, and says which in words (DS-001), so
 * the state never rests on colour alone (WCAG 1.4.1). Off is an outline with
 * the word Off; on fills with the state's tint and says On: Inspiration in
 * `guide` (a gift from the DM is guidance), Concentration in `arcane`.
 *
 * The label names the state, and may name what caused it ("Concentrating:
 * Bless"). The spec draws Off in `ink-faint`; here it is `ink-muted`, since
 * the word is the state itself and `ink-faint` is under 4.5:1 by design.
 */
export type ToggleTone = 'guide' | 'arcane';

const ON: Record<ToggleTone, string> = {
  guide: 'bg-guide-soft text-guide',
  arcane: 'bg-arcane-soft text-arcane',
};

export function ToggleChip({
  label,
  icon: Icon,
  on,
  onChange,
  tone,
  onWord = 'On',
  offWord = 'Off',
  disabled,
}: {
  label: string;
  icon?: LucideIcon;
  on: boolean;
  onChange: (on: boolean) => void;
  tone: ToggleTone;
  onWord?: string;
  offWord?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex min-h-tap items-center justify-center gap-2 rounded-control px-4 text-label transition-colors duration-120 unavailable:cursor-default unavailable:text-ink-faint ${
        on ? ON[tone] : 'text-ink-muted ring-1 ring-line-strong ring-inset hover:text-ink'
      }`}
    >
      {Icon !== undefined && <Icon size={16} aria-hidden="true" />}
      {label}
      <span className={on ? 'font-bold' : 'font-normal'}>{on ? onWord : offWord}</span>
    </button>
  );
}
