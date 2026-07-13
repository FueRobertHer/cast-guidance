/**
 * How the active conditions limit what a character can do — surfaced as visual
 * warnings on the Play tab (never a hard block; the player still decides). Each
 * field lists the conditions responsible, so the UI can explain *why*.
 */
export interface ConditionLimits {
  /** Incapacitated: can't take actions or reactions. */
  noActions: string[];
  /** Can't speak — spells with a verbal component can't be cast normally. */
  noVerbal: string[];
  /** Disadvantage on attack rolls. */
  attackDisadvantage: string[];
}

// Conditions that make you Incapacitated (can't take actions or reactions).
const INCAPACITATING = new Set([
  'Incapacitated',
  'Paralyzed',
  'Petrified',
  'Stunned',
  'Unconscious',
]);
// Conditions under which you can't speak (Stunned speaks "only falteringly").
const CANT_SPEAK = new Set(['Paralyzed', 'Petrified', 'Stunned', 'Unconscious']);
// Conditions giving disadvantage on your attack rolls.
const ATTACK_DISADVANTAGE = new Set(['Blinded', 'Frightened', 'Poisoned', 'Prone', 'Restrained']);

export function conditionLimits(conditions: ReadonlyArray<{ id: string }>): ConditionLimits {
  const noActions: string[] = [];
  const noVerbal: string[] = [];
  const attackDisadvantage: string[] = [];
  for (const { id } of conditions) {
    if (INCAPACITATING.has(id)) noActions.push(id);
    if (CANT_SPEAK.has(id)) noVerbal.push(id);
    if (ATTACK_DISADVANTAGE.has(id)) attackDisadvantage.push(id);
  }
  return { noActions, noVerbal, attackDisadvantage };
}
