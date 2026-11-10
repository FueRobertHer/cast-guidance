import type { RollMode } from '@/features/sheet/d20Tests';

/**
 * A d20's three modes, worst to best, for the roll prompt and the dice tray's
 * d20, so the two never disagree about which button sits where. Words a new
 * player can read (DS-001), short enough for a segment, and named in full for
 * a screen reader, since "Dis" and "Adv" are not words it knows.
 *
 * Its own small module because the roll toast is in the entry bundle and the
 * dice tray is not (see rollTone.ts).
 */
export const ROLL_MODES = [
  { value: 'dis', label: 'Dis', name: 'Disadvantage' },
  { value: 'normal', label: 'Normal' },
  { value: 'adv', label: 'Adv', name: 'Advantage' },
] as const satisfies ReadonlyArray<{ value: RollMode; label: string; name?: string }>;
