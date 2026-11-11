/**
 * A foretelling pool's numbers (Portent) in place of its pips: the character's
 * own d20 tests offer them in the roll prompt, and a tap here uses one on
 * another creature's roll, which the sheet never sees. A pool with uses left
 * and no numbers yet (a character who has not had a long rest since the pool
 * came) has Roll, which rolls a d20 for each use left.
 */
import type { DerivedResource } from '@/engine/types';

const NUMBER =
  'tap rounded-full bg-surface-raised px-3 font-bold text-label tabular-nums leading-none hover:bg-surface-hover';

export function ForetoldNumbers({
  pool,
  used,
  numbers,
  onUse,
  onRoll,
}: {
  pool: Pick<DerivedResource, 'label' | 'max'>;
  used: number;
  /** The numbers not used yet (`PlayState.foretold`); undefined before any are rolled. */
  numbers: readonly number[] | undefined;
  onUse: (v: number) => void;
  onRoll: (count: number) => void;
}) {
  const left = Math.max(0, pool.max - used);
  if (numbers === undefined && left > 0) {
    return (
      <button
        type="button"
        onClick={() => onRoll(left)}
        aria-label={`Roll ${pool.label}: ${left} d20${left === 1 ? '' : 's'} to foretell`}
        className={NUMBER}
      >
        Roll {left}d20
      </button>
    );
  }
  // A use marked spent by hand takes no number with it: none shows past the uses.
  const shown = (numbers ?? []).slice(0, left);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {shown.map((v, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: two foretold numbers can be the same
          key={i}
          type="button"
          onClick={() => onUse(v)}
          aria-label={`Use ${pool.label}'s ${v} on another creature's roll`}
          title="Use it on another creature's roll. Your own rolls offer it before the d20."
          className={NUMBER}
        >
          {v}
        </button>
      ))}
      <span className="pr-2 pl-1 text-caption text-ink-muted tabular-nums">
        {shown.length} of {pool.max}
      </span>
    </div>
  );
}
