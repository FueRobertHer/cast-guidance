import { type DiceAst, DiceSyntaxError, type KeepMode, type TermAst } from './types';

const MAX_TERMS = 20;
const MAX_COUNT = 100;
const MAX_SIDES = 10_000;

/**
 * Parse a dice expression: terms joined by +/-, each `NdM` (with optional
 * kh/kl/dh/dl keep-drop suffix) or a flat number, optionally followed by one
 * multiplication factor. Examples: "1d20+5", "4d6dl1", "1d4×10",
 * "1d10×1d10", "d8", "-1d4+2".
 */
export function parseDice(expr: string): DiceAst {
  const s = expr;
  let i = 0;

  const peek = () => s[i];
  const skipWs = () => {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  };
  // Explicit annotation so TS control-flow analysis treats calls as `never`.
  const fail: (message: string, pos?: number) => never = (message, pos) => {
    throw new DiceSyntaxError(message, expr, pos ?? i);
  };

  const readInt = (): number | undefined => {
    const start = i;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c < 48 || c > 57) break;
      i++;
    }
    if (i === start) return undefined;
    return Number.parseInt(s.slice(start, i), 10);
  };

  const readKeep = (): { mode: KeepMode; n: number } | undefined => {
    const c = s[i]?.toLowerCase();
    if (c !== 'k' && c !== 'd') return undefined;
    const c2 = s[i + 1]?.toLowerCase();
    if (c2 !== 'h' && c2 !== 'l') {
      // A bare 'd' here is the start of another die only in malformed input like
      // "2d6d8"; a 'k' without h/l is always an error.
      if (c === 'k') fail('expected kh or kl');
      return undefined;
    }
    i += 2;
    const n = readInt() ?? 1;
    const mode = `${c}${c2}` as KeepMode;
    return { mode, n };
  };

  const readTerm = (sign: 1 | -1): TermAst => {
    const start = i;
    const first = readInt();
    if (s[i]?.toLowerCase() === 'd') {
      const afterD = s[i + 1];
      // Distinguish "2d6" from "2dl1" (which is invalid as a term).
      if (afterD !== undefined && afterD >= '0' && afterD <= '9') {
        i++;
        const sides = readInt();
        if (sides === undefined) fail('expected die sides after "d"');
        const count = first ?? 1;
        if (count < 1) fail('die count must be at least 1', start);
        if (count > MAX_COUNT) fail(`die count above ${MAX_COUNT}`, start);
        if (sides < 2) fail('dice need at least 2 sides', start);
        if (sides > MAX_SIDES) fail(`die sides above ${MAX_SIDES}`, start);
        const keep = readKeep();
        if (keep) {
          if (keep.n < 1) fail('keep/drop count must be at least 1', start);
          if ((keep.mode === 'kh' || keep.mode === 'kl') && keep.n > count)
            fail('cannot keep more dice than rolled', start);
          if ((keep.mode === 'dh' || keep.mode === 'dl') && keep.n >= count)
            fail('cannot drop all dice', start);
        }
        return { kind: 'dice', sign, count, sides, ...(keep ? { keep } : {}) };
      }
      if (afterD === undefined) fail('expected die sides after "d"', i);
    }
    if (first === undefined) fail('expected a number or die');
    return { kind: 'mod', sign, value: first };
  };

  const terms: TermAst[] = [];
  let multiplier: TermAst | undefined;
  skipWs();
  if (i >= s.length) fail('empty dice expression');

  let sign: 1 | -1 = 1;
  if (peek() === '+' || peek() === '-') {
    sign = peek() === '-' ? -1 : 1;
    i++;
    skipWs();
  }

  for (;;) {
    terms.push(readTerm(sign));
    if (terms.length > MAX_TERMS) fail(`more than ${MAX_TERMS} terms`);
    skipWs();
    if (i >= s.length) break;
    const op = peek();
    if (op === '×' || op === '*' || op?.toLowerCase() === 'x') {
      i++;
      skipWs();
      if (i >= s.length) fail('expression ends after multiplier');
      multiplier = readTerm(1);
      skipWs();
      if (i < s.length) fail(`unexpected "${peek()}" after multiplier`);
      break;
    }
    if (op !== '+' && op !== '-') fail(`unexpected "${op}"`);
    sign = op === '-' ? -1 : 1;
    i++;
    skipWs();
    if (i >= s.length) fail('expression ends after operator');
  }

  return { expr, terms, ...(multiplier !== undefined ? { multiplier } : {}) };
}
