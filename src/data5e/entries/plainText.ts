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

/** A reference by the display text the renderer shows, any other tag by its body. */
function tagWords(tag: string, args: string[]): string {
  const isRef = PLAIN_REF_TAGS.has(tag) || Object.hasOwn(LINKED_TYPES, tag);
  return isRef ? parseEntityRef(args, DISPLAY_ARG.get(tag)).display : (args[0] ?? '');
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
