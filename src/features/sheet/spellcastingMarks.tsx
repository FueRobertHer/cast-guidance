import { AlertTriangle } from 'lucide-react';
import { RAGE_NO_SPELLS } from '@/engine/curated/namedEffects';
import type { DerivedSheet } from '@/engine/types';
import { Badge } from '@/ui/Badge';
import { Lift } from '@/ui/Lift';

/**
 * Rage says it: spells and concentration are out while it lasts. A warning,
 * never a lock, as the conditions' cues are: the table has the last word.
 */
export const raging = (sheet: Pick<DerivedSheet, 'cues'>) =>
  sheet.cues.some((c) => c.text === RAGE_NO_SPELLS);

/**
 * Over each spellcasting block while raging (the buffs canvas, Edges), on Play
 * and on the Spells tab: spells are out. A warning, not a lock: Cast still works.
 */
export function NoSpellsCue({ className = '' }: { className?: string }) {
  return (
    <p className={`flex gap-1.5 text-caption text-guide ${className}`}>
      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      You cannot cast spells while raging
    </p>
  );
}

/**
 * A casting class's save DC in `arcane`, the colour of what spellcasting
 * spends, ringed when an effect in play raised it (Innate Sorcery's +1) or
 * lowered it (in red), and saying by what. `short` is a spell row's "DC 14";
 * the class's own reads "Save DC 14".
 */
export function SaveDcBadge({
  value,
  raisedBy,
  loweredBy = [],
  short = false,
}: {
  value: number;
  raisedBy: readonly string[];
  loweredBy?: readonly string[];
  short?: boolean;
}) {
  const up = raisedBy.length > 0;
  const down = !up && loweredBy.length > 0;
  return (
    <Lift on={up || down} down={down} className="rounded-chip">
      <Badge tone="arcane">
        {short ? (
          `DC ${value}`
        ) : (
          <>
            Save DC <strong>{value}</strong>
          </>
        )}
        {up && <span className="sr-only">, raised by {raisedBy.join(', ')}</span>}
        {down && <span className="sr-only">, lowered by {loweredBy.join(', ')}</span>}
      </Badge>
    </Lift>
  );
}
