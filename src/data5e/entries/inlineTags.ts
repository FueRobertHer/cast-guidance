/**
 * Which `{@tag}` names the entry renderer understands. The renderer draws them
 * and the data audit counts every tag in a release that is in none of these,
 * so the two can only agree if they read the same lists.
 *
 * No imports: `scripts/data-audit.ts` loads this under plain Bun, which does
 * not see the app's `@/` path alias.
 */

/** Tags that link into a Library-browsable entity type (tag -> route type). */
export const LINKED_TYPES: Readonly<Record<string, string>> = {
  spell: 'spell',
  item: 'item',
  condition: 'condition',
  skill: 'skill',
  action: 'action',
  sense: 'sense',
  feat: 'feat',
  race: 'race',
  background: 'background',
  class: 'class',
  subclass: 'subclass',
  language: 'language',
  variantrule: 'variantrule',
  optfeature: 'optionalfeature',
  disease: 'disease',
  status: 'status',
  book: 'book',
};

/** Tags rendered as a styled name only (no target in our registry). */
export const PLAIN_REF_TAGS: ReadonlySet<string> = new Set([
  'creature',
  'deity',
  'hazard',
  'object',
  'trap',
  'card',
  'deck',
  'vehicle',
  'vehupgrade',
  'adventure',
  'table',
  'quickref',
  'filter',
  '5etools',
  'classFeature',
  'subclassFeature',
  'itemProperty',
  'itemMastery',
]);

/**
 * Tags with their own case in the renderer's switch: dice, emphasis, notes and
 * links. A test renders each one and checks it differs from the unknown-tag
 * fallback, so a name here without a case (or a case missing from here) fails.
 */
export const FORMATTING_TAGS: ReadonlySet<string> = new Set([
  'dice',
  'damage',
  'scaledamage',
  'scaledice',
  'hit',
  'd20',
  'dc',
  'chance',
  'atk',
  'b',
  'bold',
  'i',
  'italic',
  'u',
  's',
  'h',
  'note',
  'tip',
  'color',
  'link',
]);

/** Whether the renderer draws this tag as something more than its body text. */
export function isRenderedTag(tag: string): boolean {
  return FORMATTING_TAGS.has(tag) || PLAIN_REF_TAGS.has(tag) || Object.hasOwn(LINKED_TYPES, tag);
}
