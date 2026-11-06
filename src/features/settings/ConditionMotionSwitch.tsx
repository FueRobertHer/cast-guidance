import { setAnimateConditions, useAnimateConditions } from '@/lib/conditionMotion';
import { ToggleChip } from '@/ui/ToggleChip';

/**
 * "Animate condition effects" (WCAG 2.2.2): the one thing in the app that moves
 * at rest can be stopped here, whatever the device's reduced-motion setting
 * says. The colours and marks stay in their still poses.
 */
export function ConditionMotionSwitch() {
  const on = useAnimateConditions();
  return (
    <div className="flex flex-col items-start gap-1">
      <ToggleChip
        label="Animate condition effects"
        on={on}
        onChange={setAnimateConditions}
        tone="guide"
      />
      <p className="text-caption text-ink-muted">
        Conditions keep moving on your attack chips. Off keeps their colours and marks, held still.
      </p>
    </div>
  );
}
