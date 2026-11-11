import { appTableRules, setAppTableRule } from '@/stores/tableRules';

/**
 * Whether a one-use die that lets you wait for the d20 (2014 Guidance and
 * Bardic Inspiration) is still offered after the roll. The roll prompt offers
 * it before the d20 either way (the rolls canvas, one-use dice B): as both are
 * written and the default, one you leave comes back in the result; under a
 * table's house rule ("before"), you add it first or not at all. A die that
 * waits for a failed roll (2024 Bardic) is offered after the roll either way,
 * and so is a feature's own die (Precision Attack), which is not one of these.
 *
 * One of the app's table rules (`stores/tableRules`, the `oneUseDice` rule),
 * kept here under the names its readers use. A character at a table with
 * other rules keeps its own on Build (`CharacterDoc.oneUseDice`), which wins
 * over this.
 */
export type OneUseDice = 'after' | 'before';

export const ONE_USE_DICE_KEY = 'cast-guidance:one-use-dice';

/** What each choice means, as the buffs canvas words it (Dice, the Settings mock). */
export const ONE_USE_DICE_WHY: Record<OneUseDice, string> = {
  after:
    'As written: the roll prompt offers them, and any you leave come back after the roll, since both let you wait until you see the d20. Bardic must still be used before the DM says how it went.',
  before:
    'House rule: add them in the roll prompt or not at all. A die you add is spent even on a natural 1 or 20.',
};

/** The app's choice in Settings, read now: as written ("after") when none was made. */
export function oneUseDiceSetting(): OneUseDice {
  return appTableRules().oneUseDice ?? 'after';
}

/**
 * Choose for the app. As written ("after") is stored as chosen too, so it
 * outranks a rule pack made the app's default (`engine/rules.ts`).
 */
export function setOneUseDice(choice: OneUseDice): void {
  setAppTableRule('oneUseDice', choice);
}
