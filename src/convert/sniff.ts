/**
 * Which way a file goes, from its first character, without loading any
 * converter: the converters are their own chunk, fetched only for XML.
 */
export function looksLikeXml(text: string): boolean {
  // `\s` covers a byte order mark, and the search stops at the first
  // character that is not space, however much leads it.
  const first = text.search(/\S/);
  return first !== -1 && text[first] === '<';
}
