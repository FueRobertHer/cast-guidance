/**
 * Tagged text as the words it reads as, for what keeps a string rather than
 * rendering entries. No React here: the engine stores names read through this.
 */
import { parseEntityRef, tokenizeEntryText } from '../tags';
import { DISPLAY_ARG, LINKED_TYPES, PLAIN_REF_TAGS } from './inlineTags';

/**
 * How deep tags inside tags get read, one pass over the text each. A homebrew
 * string can nest thousands deep, which recursion would overflow on and a pass
 * per level would freeze on; anything past this stays as written.
 */
const MAX_NESTING = 4;

/**
 * A reference by the display text the renderer shows, any other tag by its body.
 * The body of `{@dc 15}` and `{@chance 10}` is a bare number, so they read with
 * the word the renderer adds: "a 15 Dexterity saving throw" is not what the page says.
 */
function tagWords(tag: string, args: string[]): string {
  if (PLAIN_REF_TAGS.has(tag) || Object.hasOwn(LINKED_TYPES, tag)) {
    return parseEntityRef(args, DISPLAY_ARG.get(tag)).display;
  }
  const body = args[0] ?? '';
  if (tag === 'dc') return `DC ${body}`;
  if (tag === 'chance') return `${body} percent`;
  return body;
}

/** `three {@item musical instrument|PHB|musical instruments}` -> `three musical instruments`. */
export function plainEntryText(text: string): string {
  let plain = text;
  for (let depth = 0; depth < MAX_NESTING && plain.includes('{@'); depth++) {
    plain = tokenizeEntryText(plain)
      .map((t) => (t.kind === 'text' ? t.text : tagWords(t.tag, t.args)))
      .join('');
  }
  return plain;
}
