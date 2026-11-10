/**
 * The formula language (ADR-001, option C): a strict subset of JavaScript
 * expressions, parsed here and never by `eval`, so a formula reads the same in
 * any later runtime. Numbers; `+ - * /`; `min max floor ceil`; comparisons;
 * `&& || !`; `? :`; and read-only names (`level`, `classLevel`, `prof`, `hp`,
 * `maxHp`, `mod.str` to `mod.cha`, `score.str` to `score.cha`). Level tables are
 * data (`{ "byLevel": { "1": 2, "9": 3 } }`), not nested conditions.
 *
 * It parses in one pass over at most 200 characters into a tree at most 32
 * levels deep, so it runs in bounded time and stack. It has no clock and no
 * randomness. Dividing by zero gives 0, and a fraction left at the end rounds
 * down, so `classLevel / 2` is half rounded down and `ceil(classLevel / 2)` half
 * rounded up. Formulas are parsed once, when their entry is first read, and
 * worked out at fold time (`derive.ts`), once abilities and hit points exist.
 */
import { type FormulaName, isRecord, CAST_GUIDANCE_LIMITS as LIMITS, own } from './castGuidance';
import type { Ability, FormulaLike, FormulaScope } from './types';

type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '==='
  | '!='
  | '!=='
  | '&&'
  | '||';

type Node =
  | { k: 'num'; v: number }
  | { k: 'name'; name: FormulaName }
  | { k: 'neg' | 'not'; a: Node }
  | { k: 'bin'; op: BinaryOp; a: Node; b: Node }
  | { k: 'if'; c: Node; a: Node; b: Node }
  | { k: 'call'; fn: 'min' | 'max' | 'floor' | 'ceil'; args: Node[] }
  | { k: 'table'; rows: ReadonlyArray<readonly [number, number]> };

/** A parsed formula: what an effect's number becomes at fold time. */
export class Formula implements FormulaLike {
  /** As written, for the Workshop and for problems. */
  readonly text: string;
  /** How many steps working it out takes, for the per-derive budget. */
  readonly cost: number;
  private readonly root: Node;

  constructor(text: string, root: Node, cost: number) {
    this.text = text;
    this.root = root;
    this.cost = cost;
  }

  /** The whole number it comes to, rounded down and held within the amount limit. */
  evaluate(scope: FormulaScope): number {
    const v = Math.floor(run(this.root, scope));
    if (!Number.isFinite(v)) return 0;
    return Math.max(-LIMITS.amountLimit, Math.min(LIMITS.amountLimit, v));
  }
}

const ABILITIES: readonly string[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const FUNCTIONS = new Set(['min', 'max', 'floor', 'ceil']);
const PLAIN_NAMES = new Set(['level', 'classLevel', 'prof', 'hp', 'maxHp']);

/** Longest first, so `<=` is not read as `<` then `=`. */
const OPERATORS = [
  '===',
  '!==',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '!',
  '?',
  ':',
  '(',
  ')',
  ',',
];

type Token = { t: 'num'; v: number; at: number } | { t: 'id' | 'op'; v: string; at: number };

class FormulaError extends Error {}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(text.slice(i, i + 40));
    if (num !== null) {
      out.push({ t: 'num', v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?/.exec(text.slice(i, i + 40));
    if (id !== null) {
      out.push({ t: 'id', v: id[0], at: i });
      i += id[0].length;
      continue;
    }
    // JavaScript reads these as increments, which a formula has none of.
    if (text.startsWith('--', i) || text.startsWith('++', i)) {
      throw new FormulaError(`"${text.slice(i, i + 2)}" is not part of a formula`);
    }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op === undefined) throw new FormulaError(`"${ch}" is not part of a formula`);
    out.push({ t: 'op', v: op, at: i });
    i += op.length;
  }
  return out;
}

/** Recursive descent, lowest precedence first, as JavaScript ranks these operators. */
class Parser {
  private i = 0;
  private readonly tokens: Token[];
  private readonly allowed: ReadonlySet<FormulaName>;
  private readonly why: string | undefined;

  constructor(tokens: Token[], allowed: ReadonlySet<FormulaName>, why: string | undefined) {
    this.tokens = tokens;
    this.allowed = allowed;
    this.why = why;
  }

  parse(): Node {
    const node = this.conditional();
    const next = this.tokens[this.i];
    if (next !== undefined) throw new FormulaError(`"${next.v}" was not expected`);
    return node;
  }

  private peek(op: string): boolean {
    const t = this.tokens[this.i];
    return t?.t === 'op' && t.v === op;
  }

  private take(op: string): boolean {
    if (!this.peek(op)) return false;
    this.i++;
    return true;
  }

  private expect(op: string): void {
    if (!this.take(op)) throw new FormulaError(`"${op}" is missing`);
  }

  private conditional(): Node {
    const c = this.binary(0);
    if (!this.take('?')) return c;
    const a = this.conditional();
    this.expect(':');
    const b = this.conditional();
    return { k: 'if', c, a, b };
  }

  private static readonly LEVELS: ReadonlyArray<readonly BinaryOp[]> = [
    ['||'],
    ['&&'],
    ['==', '===', '!=', '!=='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/'],
  ];

  private binary(level: number): Node {
    const ops = Parser.LEVELS[level];
    if (ops === undefined) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.tokens[this.i];
      const op = t?.t === 'op' ? ops.find((o) => o === t.v) : undefined;
      if (op === undefined) return left;
      this.i++;
      left = { k: 'bin', op, a: left, b: this.binary(level + 1) };
    }
  }

  private unary(): Node {
    if (this.take('-')) return { k: 'neg', a: this.unary() };
    if (this.take('!')) return { k: 'not', a: this.unary() };
    return this.primary();
  }

  private primary(): Node {
    const t = this.tokens[this.i];
    if (t === undefined) throw new FormulaError('it ends too soon');
    this.i++;
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'op') {
      if (t.v !== '(') throw new FormulaError(`"${t.v}" was not expected`);
      const inner = this.conditional();
      this.expect(')');
      return inner;
    }
    if (FUNCTIONS.has(t.v)) return this.call(t.v as 'min' | 'max' | 'floor' | 'ceil');
    return { k: 'name', name: this.name(t.v) };
  }

  private call(fn: 'min' | 'max' | 'floor' | 'ceil'): Node {
    this.expect('(');
    const args: Node[] = [];
    if (!this.peek(')')) {
      do args.push(this.conditional());
      while (this.take(','));
    }
    this.expect(')');
    const one = fn === 'floor' || fn === 'ceil';
    if (one ? args.length !== 1 : args.length === 0) {
      throw new FormulaError(one ? `${fn} takes one number` : `${fn} needs at least one number`);
    }
    return { k: 'call', fn, args };
  }

  private name(raw: string): FormulaName {
    const [head, ability] = raw.split('.');
    const known =
      ability === undefined
        ? PLAIN_NAMES.has(raw)
        : (head === 'mod' || head === 'score') && ABILITIES.includes(ability);
    if (!known) throw new FormulaError(`"${raw}" is not a name a formula can read`);
    const name = raw as FormulaName;
    if (!this.allowed.has(name)) {
      throw new FormulaError(`"${raw}" cannot be read here${this.why ? `: ${this.why}` : ''}`);
    }
    return name;
  }
}

/** Levels in a tree, and its steps, both without recursion past what the parser built. */
function measure(root: Node): { depth: number; steps: number } {
  let steps = 0;
  let depth = 0;
  const stack: Array<[Node, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [node, d] = stack.pop() as [Node, number];
    steps++;
    depth = Math.max(depth, d);
    if (node.k === 'neg' || node.k === 'not') stack.push([node.a, d + 1]);
    else if (node.k === 'bin') stack.push([node.a, d + 1], [node.b, d + 1]);
    else if (node.k === 'if') stack.push([node.c, d + 1], [node.a, d + 1], [node.b, d + 1]);
    else if (node.k === 'call') for (const a of node.args) stack.push([a, d + 1]);
  }
  return { depth, steps };
}

/**
 * Parse a formula that may read only `allowed` names (`formulaNamesFor`), or
 * say why it cannot count. `why` explains a name it may not read.
 */
export function parseFormula(
  text: string,
  allowed: ReadonlySet<FormulaName>,
  why?: string,
): Formula | { problem: string } {
  if (text.length > LIMITS.formulaLength) {
    return { problem: `a formula is at most ${LIMITS.formulaLength} characters` };
  }
  if (text.trim() === '') return { problem: 'the formula is empty' };
  try {
    const root = new Parser(tokenize(text), allowed, why).parse();
    const { depth, steps } = measure(root);
    if (depth > LIMITS.formulaDepth) {
      return { problem: `a formula is at most ${LIMITS.formulaDepth} levels deep` };
    }
    return new Formula(text, root, steps);
  } catch (err) {
    if (err instanceof FormulaError) return { problem: `formula "${text}": ${err.message}` };
    // A parse this deep runs out of stack only past the length limit; say so plainly.
    return { problem: `formula "${text}" could not be read` };
  }
}

/** A level table (`byLevel`): the value at the highest level reached, 0 below the first. */
function parseTable(raw: Record<string, unknown>): Formula | { problem: string } {
  const entries = Object.entries(raw);
  if (entries.length === 0) return { problem: 'byLevel needs at least one level' };
  if (entries.length > LIMITS.byLevelRows) {
    return { problem: `byLevel has at most ${LIMITS.byLevelRows} levels` };
  }
  const rows: Array<readonly [number, number]> = [];
  for (const [key, value] of entries) {
    if (!/^\d{1,2}$/.test(key)) return { problem: `byLevel: "${key}" is not a level` };
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { problem: `byLevel: level ${key} needs a number` };
    }
    if (Math.abs(value) > LIMITS.amountLimit) return { problem: `byLevel: ${value} is too large` };
    rows.push([Number(key), value]);
  }
  rows.sort((x, y) => x[0] - y[0]);
  return new Formula(
    `byLevel ${rows.map(([l, v]) => `${l}:${v}`).join(' ')}`,
    { k: 'table', rows },
    1,
  );
}

/**
 * A stored number (`StoredAmount`): a plain number as it is, or a formula or
 * level table parsed for fold time, or the problem that keeps it from counting.
 */
export function readAmount(
  raw: unknown,
  allowed: ReadonlySet<FormulaName>,
  why?: string,
): { value: number } | { formula: Formula } | { problem: string } {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { problem: 'needs a number' };
    if (Math.abs(raw) > LIMITS.amountLimit) return { problem: `${raw} is too large` };
    return { value: raw };
  }
  if (isRecord(raw)) {
    const f = own(raw, 'f');
    const table = own(raw, 'byLevel');
    const parsed =
      typeof f === 'string'
        ? parseFormula(f, allowed, why)
        : isRecord(table)
          ? allowed.has('classLevel')
            ? parseTable(table)
            : { problem: `a level table cannot be read here${why ? `: ${why}` : ''}` }
          : undefined;
    if (parsed instanceof Formula) return { formula: parsed };
    if (parsed !== undefined) return parsed;
  }
  return {
    problem: 'needs a number, a formula ({ "f": ... }) or a level table ({ "byLevel": ... })',
  };
}

const truth = (b: boolean) => (b ? 1 : 0);

function run(node: Node, s: FormulaScope): number {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'name':
      return lookup(node.name, s);
    case 'neg':
      return -run(node.a, s);
    case 'not':
      return truth(run(node.a, s) === 0);
    case 'if':
      return run(node.c, s) !== 0 ? run(node.a, s) : run(node.b, s);
    case 'call': {
      const args = node.args.map((a) => run(a, s));
      if (node.fn === 'min') return Math.min(...args);
      if (node.fn === 'max') return Math.max(...args);
      return node.fn === 'floor' ? Math.floor(args[0] ?? 0) : Math.ceil(args[0] ?? 0);
    }
    case 'table': {
      let value = 0;
      for (const [level, v] of node.rows) if (level <= s.classLevel) value = v;
      return value;
    }
    case 'bin':
      return binary(node.op, node.a, node.b, s);
  }
}

function binary(op: BinaryOp, an: Node, bn: Node, s: FormulaScope): number {
  const a = run(an, s);
  // As JavaScript does with numbers: the left side when it decides, else the right.
  if (op === '&&') return a === 0 ? a : run(bn, s);
  if (op === '||') return a !== 0 ? a : run(bn, s);
  const b = run(bn, s);
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? 0 : a / b;
    case '<':
      return truth(a < b);
    case '<=':
      return truth(a <= b);
    case '>':
      return truth(a > b);
    case '>=':
      return truth(a >= b);
    case '==':
    case '===':
      return truth(a === b);
    case '!=':
    case '!==':
      return truth(a !== b);
  }
}

function lookup(name: FormulaName, s: FormulaScope): number {
  switch (name) {
    case 'level':
    case 'classLevel':
    case 'prof':
    case 'hp':
    case 'maxHp':
      return s[name];
  }
  const [head, ability] = name.split('.') as ['mod' | 'score', Ability];
  return s[head][ability];
}
