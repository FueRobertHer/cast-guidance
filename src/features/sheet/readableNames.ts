/**
 * Names as a person reads them, for the places the engine's lowercase
 * `name|source` keys reach the page: a carried item whose entry is gone, and
 * the Build tab's notes ("Item not found: sunblade aegis|myhomebrew").
 */

/** Small words a title keeps lowercase, after its first word. */
const SMALL = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * "sunblade aegis" as "Sunblade Aegis", "potion of healing" as "Potion of
 * Healing". A name with any capital is its author's spelling, kept as it is.
 */
export function readableName(name: string): string {
  if (name !== name.toLowerCase()) return name;
  return name.replace(/[^\s/(-]+/g, (word, at: number) =>
    at > 0 && SMALL.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
  );
}

/**
 * A key the engine writes in a note (`name|source`, or a feature's longer
 * `name|class|source|level|...`): after "not found: ", or inside the curly
 * quotes a saved choice is named in. Its name stops at a quote, a colon or a
 * pipe; its keys at a space. A rule pack's problems say the format in straight
 * quotes (`"basedOn" is "name|source"`), which stays as it is.
 */
const KEY = /(not found: |“)([^|:“”"\n]+?)((?:\|[^|\s“”"]*)+)/g;

/** A note with each `name|source` key read as its name: "Item not found: Sunblade Aegis". */
export function readableNote(note: string): string {
  return note.replace(
    KEY,
    (_all, before: string, name: string) => `${before}${readableName(name)}`,
  );
}
