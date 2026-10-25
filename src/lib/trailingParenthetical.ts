const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * Drop a trailing "(...)" annotation: `"Sneak Attack (+1d6 once/turn)"` ->
 * `"Sneak Attack"`.
 *
 * Does what `s.replace(/\s*\(.*\)\s*$/, '')` did, without the regex. That
 * pattern retried `.*` from every "(" in the string, so a name full of "("
 * that did not end in ")" cost time proportional to the square of its length,
 * and names come from homebrew. Like the regex, the cut is at the first "("
 * on the last line (`.` does not cross a line break) and only when what is
 * left ends in ")"; anything else comes back unchanged.
 */
export function stripTrailingParenthetical(s: string): string {
  const end = s.trimEnd();
  if (!end.endsWith(')')) return s;
  let lineStart = 0;
  for (let i = end.length - 1; i >= 0; i--) {
    if (LINE_BREAK.test(end[i] ?? '')) {
      lineStart = i + 1;
      break;
    }
  }
  const open = end.indexOf('(', lineStart);
  if (open === -1) return s;
  return end.slice(0, open).trimEnd();
}
