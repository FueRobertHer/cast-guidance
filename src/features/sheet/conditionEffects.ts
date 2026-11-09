/**
 * How the active conditions limit what a character can do — surfaced as visual
 * warnings on the Play tab (never a hard block; the player still decides). Each
 * field lists the conditions responsible, so the UI can explain *why*. What
 * they do to rolls, speed and hit points is the engine's
 * (`engine/conditions.ts`), which applies it.
 */
export interface ConditionLimits {
  /** Incapacitated: can't take actions or reactions. */
  noActions: string[];
  /** Can't speak — spells with a verbal component can't be cast normally. */
  noVerbal: string[];
}

// Conditions that make you Incapacitated (can't take actions or reactions).
const INCAPACITATING = new Set([
  'Incapacitated',
  'Paralyzed',
  'Petrified',
  'Stunned',
  'Unconscious',
]);
// Conditions under which you can't speak in 2014 (Stunned speaks "only
// falteringly"). In 2024 Incapacitated is Speechless, so every one that
// makes you Incapacitated does.
const CANT_SPEAK_2014 = new Set(['Paralyzed', 'Petrified', 'Stunned', 'Unconscious']);

/**
 * The conditions a character can be put under, in the picker's order.
 * Exhaustion is leveled, so it gets its own stepper rather than a toggle.
 */
export const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const;

type Edition = '2014' | '2024';

/**
 * What each condition does, in a line: to the character's own rolls and
 * actions, and to attacks against them. A summary over the full rules text,
 * which still follows it; where the two editions differ, each has its own.
 */
const EFFECTS: Record<(typeof CONDITIONS)[number], string | Record<Edition, string>> = {
  Blinded:
    'Disadvantage on your attack rolls; attack rolls against you have advantage. You fail any check that needs sight.',
  Charmed:
    "You can't attack the charmer or target it with harmful abilities or magic, and it has advantage on social checks against you.",
  Deafened: 'You fail any check that needs hearing.',
  Frightened:
    "Disadvantage on ability checks and attack rolls while the source is in sight; you can't willingly move closer to it.",
  Grappled: {
    '2014': 'Your speed is 0.',
    '2024':
      'Your speed is 0, and you have disadvantage on attack rolls against anyone but the grappler.',
  },
  Incapacitated: {
    // The condition's own text names actions and reactions; the bonus action
    // (PHB p. 189) and concentration (p. 203) follow from it elsewhere.
    '2014': "You can't take actions, bonus actions or reactions, and your concentration breaks.",
    '2024':
      "You can't take actions, bonus actions or reactions, or speak; you have disadvantage on initiative, and your concentration breaks.",
  },
  Invisible: {
    '2014': 'Advantage on your attack rolls; attack rolls against you have disadvantage.',
    '2024':
      'Advantage on initiative and on your attack rolls; attack rolls against you have disadvantage.',
  },
  Paralyzed:
    "Incapacitated, and you can't move or speak. You fail Strength and Dexterity saves; attacks against you have advantage, and hits from within 5 feet are critical.",
  Petrified:
    "Incapacitated, and you can't move or speak. You fail Strength and Dexterity saves, attacks against you have advantage, and you resist all damage.",
  Poisoned: 'Disadvantage on attack rolls and ability checks.',
  Prone:
    'Disadvantage on your attack rolls. Attacks against you have advantage from within 5 feet, disadvantage from farther. Crawl, or spend half your speed to stand.',
  Restrained:
    'Your speed is 0. Disadvantage on your attack rolls and Dexterity saves; attacks against you have advantage.',
  Stunned: {
    '2014':
      "Incapacitated, you can't move, and you speak only falteringly. You fail Strength and Dexterity saves; attacks against you have advantage.",
    '2024':
      'Incapacitated. You fail Strength and Dexterity saves; attacks against you have advantage.',
  },
  Unconscious:
    "Incapacitated and prone, and you can't move or speak. You fail Strength and Dexterity saves; attacks against you have advantage, and hits from within 5 feet are critical.",
};

/** A condition's line in the character's edition; undefined for one the app does not know. */
export function conditionEffect(id: string, edition: Edition): string | undefined {
  const effect = (EFFECTS as Record<string, string | Record<Edition, string> | undefined>)[id];
  return typeof effect === 'object' ? effect[edition] : effect;
}

export function conditionLimits(
  conditions: ReadonlyArray<{ id: string; ignored?: boolean }>,
  edition: Edition,
): ConditionLimits {
  const noActions: string[] = [];
  const noVerbal: string[] = [];
  const cantSpeak = edition === '2024' ? INCAPACITATING : CANT_SPEAK_2014;
  // A condition switched off on its sheet warns of nothing either.
  for (const { id, ignored } of conditions) {
    if (ignored === true) continue;
    if (INCAPACITATING.has(id)) noActions.push(id);
    if (cantSpeak.has(id)) noVerbal.push(id);
  }
  return { noActions, noVerbal };
}
