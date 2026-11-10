import { parseDice } from './parse';
import type {
  CritDamage,
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

/**
 * The open character's critical damage rule (`TABLE_RULES.critDamage`), which
 * a critical roll follows unless it names its own. The sheet sets it while a
 * character is open; as written, the dice count twice.
 */
let tableCrit: CritDamage = 'doubleDice';

export function setTableCrit(rule: CritDamage): void {
  tableCrit = rule;
}

/**
 * One term's value. On a critical hit its dice count twice: rolled again, or
 * (`maxPlusRoll`) at their maximum and then rolled.
 */
function evaluateTerm(
  term: TermAst,
  rng: (sides: number) => number,
  crit?: 'doubleDice' | 'maxPlusRoll',
): { value: number; detail: DiceRollDetail | ModDetail } {
  if (term.kind === 'mod') {
    const value = term.sign * term.value;
    return { value, detail: { kind: 'mod', value } };
  }
  const count = crit !== undefined ? term.count * 2 : term.count;
  const maxed = crit === 'maxPlusRoll' ? term.count : 0;
  const values: number[] = [];
  for (let i = 0; i < count; i++) values.push(i < maxed ? term.sides : rng(term.sides));
  const kept = keptFlags(values, { ...term, count });
  const detail: DiceRollDetail = {
    kind: 'dice',
    sign: term.sign,
    sides: term.sides,
    rolls: values.map((v, idx) => ({ v, kept: kept[idx] ?? true })),
    ...(maxed > 0 ? { maxed } : {}),
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
  const critRule = opts.critical === true ? (opts.crit ?? tableCrit) : undefined;
  // Doubling the total rolls the dice once and doubles the sum after.
  const termCrit = critRule === 'doubleTotal' ? undefined : critRule;

  for (const term of ast.terms) {
    const evaluated = evaluateTerm(term, rng, termCrit);
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
    const factor = evaluateTerm(ast.multiplier, rng, termCrit);
    total *= factor.value;
    terms.push({ kind: 'multiplier', value: factor.value, detail: factor.detail });
  }
  if (critRule === 'doubleTotal') {
    total *= 2;
    terms.push({ kind: 'multiplier', value: 2, detail: { kind: 'mod', value: 2 } });
  }

  const meta: RollResult['meta'] =
    opts.advantage || opts.critical || d20Natural !== undefined
      ? {
          ...(opts.advantage ? { advantage: opts.advantage } : {}),
          ...(opts.critical ? { critical: true } : {}),
          ...(critRule === 'maxPlusRoll' || critRule === 'doubleTotal' ? { critRule } : {}),
          ...(d20Natural !== undefined ? { d20: { natural: d20Natural } } : {}),
        }
      : undefined;

  return {
    expr: ast.expr,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.origin ? { origin: opts.origin } : {}),
    ...(opts.kind ? { kind: opts.kind } : {}),
    total,
    at: Date.now(),
    terms,
    ...(meta ? { meta } : {}),
  };
}
