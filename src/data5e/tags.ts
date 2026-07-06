/**
 * Lexer for 5etools inline tags: `{@tag body|arg|arg}` with nested braces.
 * Pure string -> token list; rendering decisions live in entries/.
 */

export interface TagToken {
  kind: 'tag';
  tag: string;
  /** Pipe-split args (respecting nested braces); args[0] is the body. */
  args: string[];
}

export interface TextToken {
  kind: 'text';
  text: string;
}

export type EntryToken = TagToken | TextToken;

/** Split on `|` at brace depth 0 (pipes inside nested tags don't split). */
export function splitArgs(s: string): string[] {
  if (s === '') return [];
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '|' && depth === 0) {
      args.push(s.slice(start, i));
      start = i + 1;
    }
  }
  args.push(s.slice(start));
  return args;
}

export function tokenizeEntryText(s: string): EntryToken[] {
  const out: EntryToken[] = [];
  let i = 0;
  let textStart = 0;
  while (i < s.length) {
    if (s[i] === '{' && s[i + 1] === '@') {
      let depth = 0;
      let j = i;
      for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= s.length) break; // unbalanced — treat the rest as text
      if (textStart < i) out.push({ kind: 'text', text: s.slice(textStart, i) });
      const inner = s.slice(i + 2, j);
      const sp = inner.indexOf(' ');
      const tag = sp === -1 ? inner : inner.slice(0, sp);
      const rest = sp === -1 ? '' : inner.slice(sp + 1);
      out.push({ kind: 'tag', tag, args: splitArgs(rest) });
      i = j + 1;
      textStart = i;
    } else {
      i++;
    }
  }
  if (textStart < s.length) out.push({ kind: 'text', text: s.slice(textStart) });
  return out;
}

/** Entity-ref args: `name|source|displayText` (display falls back to name). */
export interface EntityRefParts {
  name: string;
  source?: string;
  display: string;
}

export function parseEntityRef(args: string[]): EntityRefParts {
  const name = args[0] ?? '';
  const source = args[1] !== undefined && args[1] !== '' ? args[1] : undefined;
  const last = args[args.length - 1];
  const display = args.length >= 3 && last !== undefined && last !== '' ? last : name;
  return { name, source, display };
}
