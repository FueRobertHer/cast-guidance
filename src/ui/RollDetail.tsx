import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';

/**
 * A roll's working, a dropped die struck through (DS-001 RollToast), in the
 * line's own ink: `ink-faint` falls under 4.5:1 at this size, and the strike
 * already says it does not count.
 */
export function RollDetail({ roll }: { roll: RollResult }) {
  return (
    <>
      {rollDetail(roll).map((part, i) =>
        part.dropped === true ? <s key={`dropped-${String(i)}`}>{part.text}</s> : part.text,
      )}
    </>
  );
}
