import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { exhaustionInfo } from './exhaustion';

/**
 * Exhaustion's −/+: a 32px raised circle in a 44px target, `ink-faint` when it
 * cannot go further. That is `aria-disabled` rather than `disabled`: the press
 * that takes the level to 0 or 6 would otherwise disable the button it was
 * made on, and focus would drop out of the open sheet to the page.
 */
const EX_STEP = 'tap rounded-full text-ink aria-disabled:text-ink-faint';

/**
 * Exhaustion: leveled (0 to 6), so a real −/+ stepper rather than a toggle, with
 * what the level does in the character's edition under it, and at 6 a
 * person-triggered drop to 0 HP (never automatic). In the condition picker,
 * and in Exhaustion's own sheet, where a level can be stepped down.
 */
export function ExhaustionStepper({
  level,
  edition,
  onSet,
  onDeath,
}: {
  level: number;
  edition: '2014' | '2024';
  onSet: (level: number) => void;
  onDeath: () => void;
}) {
  const info = exhaustionInfo(level, edition);
  return (
    <div className="@container flex flex-col gap-2">
      {/* Wraps the stepper under the name, at the right, where both do not
          fit (large text), and the count grows with its text rather than
          push the + out of the sheet (A11Y-003). Where even the stepper
          does not fit on a line (8.5rem), the count goes above its two
          buttons; DOM order stays −, count, +. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-strong">Exhaustion</span>
        <div className="-my-2 ml-auto flex flex-wrap items-center justify-center @min-[8.5rem]:flex-nowrap">
          <button
            type="button"
            aria-label="Decrease exhaustion"
            onClick={() => level > 0 && onSet(level - 1)}
            aria-disabled={level === 0}
            className={EX_STEP}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised">
              <Minus size={16} />
            </span>
          </button>
          <span className="order-first min-w-10 basis-full whitespace-nowrap text-center text-body-strong tabular-nums @min-[8.5rem]:order-none @min-[8.5rem]:basis-auto">
            {level} / 6
          </span>
          <button
            type="button"
            aria-label="Increase exhaustion"
            onClick={() => level < 6 && onSet(level + 1)}
            aria-disabled={level >= 6}
            className={EX_STEP}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised">
              <Plus size={16} />
            </span>
          </button>
        </div>
      </div>
      {info.lines.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-caption text-guide">
          {info.lines.map((l) => (
            <li key={l} className="flex items-center gap-1">
              <AlertTriangle size={14} className="shrink-0" /> {l}
            </li>
          ))}
        </ul>
      )}
      {info.dead && (
        <button
          type="button"
          onClick={onDeath}
          className="min-h-8 self-start rounded-control px-3 py-1 text-danger text-label ring-1 ring-line-strong ring-inset transition-colors duration-120 hover:bg-danger-soft"
        >
          Apply death: drop to 0 HP
        </button>
      )}
    </div>
  );
}
