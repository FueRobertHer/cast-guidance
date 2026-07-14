import { parseDice } from './parse';
import type {
  DiceAst,
  DiceRollDetail,
  DiceTermAst,
  ModDetail,
  RollOptions,
  RollResult,
  TermAst,
} from './types';

/** Unbiased die roll via rejection sampling (no modulo bias). */
export function cryptoRng(sides: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0] as number;
  } while (x >= limit);
  return (x % sides) + 1;
}

function applyAdvantage(ast: DiceAst, advantage: 'adv' | 'dis'): DiceAst {
  const first = ast.terms[0];
  if (first?.kind !== 'dice' || first.sides !== 20 || first.count !== 1 || first.keep) {
    return ast;
  }
  const rewritten: DiceTermAst = {
    ...first,
    count: 2,
    keep: { mode: advantage === 'adv' ? 'kh' : 'kl', n: 1 },
  };
  return { ...ast, terms: [rewritten, ...ast.terms.slice(1)] };
}

function keptFlags(values: number[], term: DiceTermAst): boolean[] {
  const keep = term.keep;
  if (!keep) return values.map(() => true);
  // Rank indices by value; ties broken by position for determinism.
  const order = values
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => b.v - a.v || a.idx - b.idx)
    .map((e) => e.idx);
  const kept = new Array<boolean>(values.length).fill(false);
  const mark = (indices: number[]) => {
    for (const idx of indices) kept[idx] = true;
  };
  switch (keep.mode) {
    case 'kh':
      mark(order.slice(0, keep.n));
      break;
    case 'kl':
      mark(order.slice(order.length - keep.n));
      break;
    case 'dh':
      mark(order.slice(keep.n));
      break;
    case 'dl':
      mark(order.slice(0, order.length - keep.n));
      break;
  }
  return kept;
}

function evaluateTerm(
  term: TermAst,
  rng: (sides: number) => number,
  critical: boolean,
): { value: number; detail: DiceRollDetail | ModDetail } {
  if (term.kind === 'mod') {
    const value = term.sign * term.value;
    return { value, detail: { kind: 'mod', value } };
  }
  const count = critical ? term.count * 2 : term.count;
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(rng(term.sides));
  const kept = keptFlags(values, { ...term, count });
  const detail: DiceRollDetail = {
    kind: 'dice',
    sign: term.sign,
    sides: term.sides,
    rolls: values.map((v, idx) => ({ v, kept: kept[idx] ?? true })),
  };
  let sum = 0;
  for (let idx = 0; idx < values.length; idx++) {
    if (kept[idx]) sum += values[idx] as number;
  }
  return { value: term.sign * sum, detail };
}

export function roll(input: string | DiceAst, opts: RollOptions = {}): RollResult {
  let ast = typeof input === 'string' ? parseDice(input) : input;
  if (opts.advantage) ast = applyAdvantage(ast, opts.advantage);

  const rng = opts.rng ?? cryptoRng;
  const terms: RollResult['terms'] = [];
  let total = 0;
  let d20Natural: number | undefined;

  for (const term of ast.terms) {
    const evaluated = evaluateTerm(term, rng, opts.critical === true);
    total += evaluated.value;
    const detail = evaluated.detail;
    terms.push(detail);
    if (
      detail.kind === 'dice' &&
      d20Natural === undefined &&
      term.kind === 'dice' &&
      term.sides === 20 &&
      term === ast.terms[0]
    ) {
      const keptRoll = detail.rolls.find((r) => r.kept);
      if (keptRoll) d20Natural = keptRoll.v;
    }
  }

  if (ast.multiplier !== undefined) {
    const factor = evaluateTerm(ast.multiplier, rng, opts.critical === true);
    total *= factor.value;
    terms.push({ kind: 'multiplier', value: factor.value, detail: factor.detail });
  }

  const meta: RollResult['meta'] =
    opts.advantage || opts.critical || d20Natural !== undefined
      ? {
          ...(opts.advantage ? { advantage: opts.advantage } : {}),
          ...(opts.critical ? { critical: true } : {}),
          ...(d20Natural !== undefined ? { d20: { natural: d20Natural } } : {}),
        }
      : undefined;

  return {
    expr: ast.expr,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
    total,
    at: Date.now(),
    terms,
    ...(meta ? { meta } : {}),
  };
}
