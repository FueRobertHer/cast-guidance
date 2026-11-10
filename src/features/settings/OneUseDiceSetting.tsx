import { useId } from 'react';
import { ONE_USE_DICE_WHY, setOneUseDice, useOneUseDice } from '@/lib/oneUseDice';
import { SegmentedControl } from '@/ui/SegmentedControl';

const CHOICES = [
  { value: 'after', label: 'After too' },
  { value: 'before', label: 'Before only' },
] as const;

/**
 * The house rule for one-use dice (the rolls canvas, one-use dice B): the roll
 * prompt offers them before the d20, and as written (the default) any left
 * come back after it; a table can say before only. One choice for the app; a
 * character can keep its own on Build. Bless has nothing to set, and says so,
 * since a player will look for it here.
 */
export function OneUseDiceSetting() {
  const choice = useOneUseDice();
  const why = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-body-strong">Guidance and Bardic Inspiration</span>
        <SegmentedControl
          label="Guidance and Bardic Inspiration"
          options={CHOICES}
          value={choice}
          onChange={setOneUseDice}
          block
          describedBy={why}
        />
        <p id={why} className="text-caption text-ink-muted">
          {ONE_USE_DICE_WHY[choice]}
        </p>
        <p className="text-caption text-ink-muted">
          Under 2024 rules Guidance is not one use, and Bardic Inspiration waits for a failed roll,
          so neither is offered before the roll.
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-body-strong">Bless</span>
        <p className="text-caption text-ink-muted">
          Rolls in with every attack and save, and the roll prompt shows it, where you can leave it
          out of one roll. There is nothing to set.
        </p>
      </div>
    </div>
  );
}
