/** Flatten a 5etools `entries` array into a plain one-line summary. */
export function summarizeEntries(entries: unknown, maxLen = 160): string {
  const text = firstString(entries);
  if (text === undefined) return '';
  const plain = stripTagBodies(text)
    .replace(/\{@\w+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > maxLen ? `${plain.slice(0, maxLen - 1)}…` : plain;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /\w/.test(c);

/**
 * `{@tag body|arg|arg}` -> `body`, in one pass over the text.
 *
 * This was `/\{@\w+ ([^|}]+)[^}]*\}/g`, whose two adjacent quantifiers can
 * split the same run of characters many ways: an unclosed tag made every
 * match attempt walk the rest of the string over and over, and a string of
 * them (homebrew text may be 200,000 characters) froze the main thread. The
 * scan below produces what that regex produced but looks at each character a
 * bounded number of times. Bodyless `{@tag}` is left for the caller's regex,
 * which runs on this output as it always did.
 */
function stripTagBodies(text: string): string {
  let out = '';
  let i = 0;
  // The next `}` at or after the current tag; -1 once there are none left.
  let close = 0;
  while (i < text.length) {
    const open = text.indexOf('{@', i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    let nameEnd = open + 2;
    while (isWordChar(text[nameEnd])) nameEnd++;
    // Not `{@name ` (no name, or no space after it): not a tag with a body.
    if (nameEnd === open + 2 || text[nameEnd] !== ' ') {
      out += text.slice(open, nameEnd);
      i = nameEnd;
      continue;
    }
    // Remembered across tags, so a run of tags that never close (or close
    // emptily) does not search for the same brace once each.
    if (close !== -1 && close <= nameEnd) close = text.indexOf('}', nameEnd + 1);
    if (close === -1) {
      // No `}` anywhere after it, so neither this tag nor any later one can
      // close: the rest is text.
      out += text.slice(open);
      break;
    }
    // Only as far as the `}`: an `indexOf` here could walk to the end of the
    // text once per tag.
    let bodyEnd = nameEnd + 1;
    while (bodyEnd < close && text[bodyEnd] !== '|') bodyEnd++;
    if (bodyEnd === nameEnd + 1) {
      // An empty body (`{@tag }`, `{@tag |x}`) never matched; keep it as text.
      out += text.slice(open, nameEnd + 1);
      i = nameEnd + 1;
      continue;
    }
    out += text.slice(nameEnd + 1, bodyEnd);
    i = close + 1;
  }
  return out;
}

function firstString(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const n of node) {
      const s = firstString(n);
      if (s !== undefined) return s;
    }
    return undefined;
  }
  if (node !== null && typeof node === 'object') {
    const o = node as { entries?: unknown; entry?: unknown };
    return firstString(o.entries ?? o.entry);
  }
  return undefined;
}
