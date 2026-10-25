/**
 * 5etools `_copy` / `_mod` / `_versions` resolution.
 *
 * Tolerance is the design rule: unknown ops or unresolvable targets emit a
 * warning and leave the entity partially resolved — never throw. The dev-only
 * audit script (scripts/data-audit.ts) quantifies exactly what falls through
 * against the real pinned dataset.
 */

export type Entity = Record<string, unknown>;

export interface CopyModWarning {
  entity: string;
  message: string;
}

/** `name|source`, lowercased — the 5etools identity convention. */
export function uidOf(e: Entity): string {
  return `${String(e.name ?? '?')}|${String(e.source ?? '?')}`.toLowerCase();
}

/** Meta keys that do NOT carry over from a copy target unless `_preserve`d. */
const DELETE_ON_COPY = [
  'reprintedAs',
  '_versions',
  'srd',
  'srd52',
  'basicRules',
  'basicRules2024',
  'hasFluff',
  'hasFluffImages',
  'soundClip',
  'otherSources',
  'page',
  'alias',
] as const;

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function entryName(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const n = (e as { name?: unknown }).name;
  return typeof n === 'string' ? n : undefined;
}

// ---------------------------------------------------------------------------
// replaceTxt: patterns that come from the data
// ---------------------------------------------------------------------------
//
// A `replaceTxt` pattern is written by whoever wrote the file, homebrew
// included, and runs on the main thread over every string of the entity on
// every registry rebuild. A regex cannot be interrupted once it starts, so a
// pattern that backtracks catastrophically (`(a+)+$` against a long run of
// "a") would freeze the app on every launch. The checks below refuse the
// shapes that backtrack badly and bound how much text any one pattern sees.
// They are a heuristic, not a proof; the text budget is the backstop.

/** Longest `replaceTxt` pattern accepted. Official data uses `Goblins`. */
export const MAX_MOD_PATTERN_LENGTH = 256;
/** Unbounded quantifiers (`*`, `+`, `{n,}`) one pattern may use. */
export const MAX_MOD_UNBOUNDED_QUANTIFIERS = 3;
/** Strings longer than this are left as they are rather than searched. */
export const MAX_REPLACE_STRING_LENGTH = 8192;
/** Characters one `replaceTxt` operation may search in total. */
export const MAX_REPLACE_TOTAL_CHARS = 1_000_000;
/** Entities one base may expand into through `_versions`. Official max: 10. */
export const MAX_VERSIONS_PER_ENTITY = 64;

const MOD_FLAGS = 'gimsuy';

interface GroupFrame {
  /** Any quantifier anywhere inside, nested groups included. */
  quantified: boolean;
  /** Any `|` anywhere inside, nested groups included. */
  alternates: boolean;
}

/**
 * Why `pattern` is unsafe to run on the main thread, or undefined if it is
 * not. Tokenizes rather than pattern-matching the source so escapes and
 * character classes are read as what they are: `\(\d+\)` is a literal
 * parenthesis around one quantifier, not a quantified group.
 */
function unsafeModPattern(pattern: string): string | undefined {
  if (pattern.length > MAX_MOD_PATTERN_LENGTH) {
    return `pattern longer than ${MAX_MOD_PATTERN_LENGTH} characters`;
  }
  const stack: GroupFrame[] = [{ quantified: false, alternates: false }];
  const top = (): GroupFrame => stack[stack.length - 1] as GroupFrame;
  // The group that just closed, while the next token could still quantify it.
  let closed: GroupFrame | undefined;
  let unbounded = 0;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '\\') {
      const next = pattern[i + 1] ?? '';
      if (/[1-9]/.test(next) || (next === 'k' && pattern[i + 2] === '<')) {
        return 'backreference';
      }
      closed = undefined;
      i += 2;
      continue;
    }
    if (c === '[') {
      // A class is one atom whatever is inside; it ends at the first `]` that
      // is not escaped.
      i++;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      closed = undefined;
      i++;
      continue;
    }
    if (c === '(') {
      stack.push({ quantified: false, alternates: false });
      closed = undefined;
      i++;
      // Group prefixes are not quantifiers: `(?:`, `(?=`, `(?!`, `(?<=`,
      // `(?<!` and `(?<name>`.
      if (pattern[i] === '?') {
        i++;
        if (pattern[i] === '<' && pattern[i + 1] !== '=' && pattern[i + 1] !== '!') {
          while (i < pattern.length && pattern[i] !== '>') i++;
        } else if (pattern[i] === '<') {
          i++;
        }
        i++;
      }
      continue;
    }
    if (c === ')') {
      if (stack.length === 1) return 'unbalanced parenthesis';
      const frame = stack.pop() as GroupFrame;
      const parent = top();
      parent.quantified ||= frame.quantified;
      parent.alternates ||= frame.alternates;
      closed = frame;
      i++;
      continue;
    }
    if (c === '|') {
      top().alternates = true;
      closed = undefined;
      i++;
      continue;
    }
    const brace = c === '{' ? /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i)) : null;
    if (c === '*' || c === '+' || c === '?' || brace !== null) {
      // The most times the atom may match: `?` once, `{n}` n times, `{n,m}`
      // m times, `*`, `+` and `{n,}` without limit.
      let max = 1;
      if (c === '*' || c === '+') max = Number.POSITIVE_INFINITY;
      else if (brace !== null) {
        if (brace[2] === undefined) max = Number(brace[1]);
        else max = brace[3] === '' ? Number.POSITIVE_INFINITY : Number(brace[3]);
      }
      // Only a group that can match more than once multiplies the ways a run
      // can be split between its inner and outer repeats.
      if (max > 1 && closed !== undefined && (closed.quantified || closed.alternates)) {
        return 'quantified group containing a quantifier or alternation';
      }
      if (max === Number.POSITIVE_INFINITY && ++unbounded > MAX_MOD_UNBOUNDED_QUANTIFIERS) {
        return `more than ${MAX_MOD_UNBOUNDED_QUANTIFIERS} unbounded quantifiers`;
      }
      top().quantified = true;
      closed = undefined;
      i += brace !== null ? brace[0].length : 1;
      // A lazy suffix belongs to this quantifier.
      if (pattern[i] === '?') i++;
      continue;
    }
    closed = undefined;
    i++;
  }
  return stack.length === 1 ? undefined : 'unbalanced parenthesis';
}

/**
 * Compile a `replaceTxt` pattern, or say why it was refused. Flags follow
 * 5etools (`DataUtil.generic._getRegexFromReplaceModInfo`): the replacement is
 * always global, with the file's own flags added, filtered to the ones a
 * replace can use and de-duplicated so `"gi"` cannot become an invalid `"ggi"`.
 */
export function compileModRegex(pattern: string, flags?: unknown): RegExp | { reason: string } {
  const reason = unsafeModPattern(pattern);
  if (reason !== undefined) return { reason };
  const wanted = typeof flags === 'string' ? flags : '';
  const kept = [...MOD_FLAGS].filter((f) => f === 'g' || wanted.includes(f)).join('');
  try {
    return new RegExp(pattern, kept);
  } catch (err) {
    return { reason: String(err) };
  }
}

interface ReplaceBudget {
  left: number;
  skippedLong: number;
  exhausted: boolean;
}

function replaceTextDeep(v: unknown, re: RegExp, w: string, budget: ReplaceBudget): unknown {
  if (typeof v === 'string') {
    if (v.length > MAX_REPLACE_STRING_LENGTH) {
      budget.skippedLong++;
      return v;
    }
    if (v.length > budget.left) {
      budget.exhausted = true;
      return v;
    }
    budget.left -= v.length;
    return v.replace(re, w);
  }
  if (Array.isArray(v)) return v.map((x) => replaceTextDeep(x, re, w, budget));
  if (typeof v === 'object' && v !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = replaceTextDeep(val, re, w, budget);
    return out;
  }
  return v;
}

/** Apply a `_mod` block to `target` in place. */
export function applyMod(
  target: Entity,
  mod: Record<string, unknown>,
  warn: (message: string) => void,
): void {
  const isOp = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && typeof (v as { mode?: unknown }).mode === 'string';

  for (const [prop, rawOps] of Object.entries(mod)) {
    if (prop === '*') {
      warn('unsupported wildcard _mod prop "*"');
      continue;
    }
    // A value that isn't an op (or an array of ops) is a plain property set.
    const ops = Array.isArray(rawOps) ? rawOps : [rawOps];
    if (!ops.every(isOp)) {
      target[prop] = rawOps;
      continue;
    }
    for (const o of ops) {
      const mode = o.mode as string;
      const arr = (): unknown[] => {
        const cur = target[prop];
        if (Array.isArray(cur)) return cur;
        const fresh: unknown[] = [];
        target[prop] = fresh;
        return fresh;
      };
      switch (mode) {
        case 'appendArr':
          arr().push(...asArray(o.items));
          break;
        case 'prependArr':
          arr().unshift(...asArray(o.items));
          break;
        case 'insertArr': {
          const a = arr();
          const idx = typeof o.index === 'number' ? o.index : a.length;
          a.splice(idx, 0, ...asArray(o.items));
          break;
        }
        case 'removeArr': {
          const a = arr();
          if (o.names !== undefined) {
            const names = new Set(asArray(o.names).map(String));
            for (let i = a.length - 1; i >= 0; i--) {
              const n = entryName(a[i]);
              if (n !== undefined && names.has(n)) a.splice(i, 1);
            }
          } else if (o.items !== undefined) {
            // rare form: remove by exact item (string entries)
            const items = new Set(asArray(o.items).map((x) => JSON.stringify(x)));
            for (let i = a.length - 1; i >= 0; i--) {
              if (items.has(JSON.stringify(a[i]))) a.splice(i, 1);
            }
          } else if (typeof o.index === 'number') {
            a.splice(o.index, 1);
          } else {
            warn(`removeArr without names/items/index on "${prop}"`);
          }
          break;
        }
        case 'replaceArr': {
          const a = arr();
          const replace = o.replace;
          let idx = -1;
          if (typeof replace === 'string') {
            idx = a.findIndex((e) => entryName(e) === replace || e === replace);
          } else if (
            typeof replace === 'object' &&
            replace !== null &&
            typeof (replace as { index?: unknown }).index === 'number'
          ) {
            idx = (replace as { index: number }).index;
          }
          if (idx >= 0 && idx < a.length) {
            a.splice(idx, 1, ...asArray(o.items));
          } else {
            warn(`replaceArr target not found on "${prop}": ${JSON.stringify(replace)}`);
          }
          break;
        }
        case 'replaceTxt': {
          const re = compileModRegex(String(o.replace), o.flags);
          if (!(re instanceof RegExp)) {
            warn(`replaceTxt unsafe regex on "${prop}" (${re.reason}); left unchanged`);
            break;
          }
          const budget: ReplaceBudget = {
            left: MAX_REPLACE_TOTAL_CHARS,
            skippedLong: 0,
            exhausted: false,
          };
          target[prop] = replaceTextDeep(target[prop], re, String(o.with ?? ''), budget);
          if (budget.skippedLong > 0) {
            warn(
              `replaceTxt skipped ${budget.skippedLong} string(s) over ${MAX_REPLACE_STRING_LENGTH} characters on "${prop}"`,
            );
          }
          if (budget.exhausted) {
            warn(`replaceTxt stopped after ${MAX_REPLACE_TOTAL_CHARS} characters on "${prop}"`);
          }
          break;
        }
        default:
          warn(`unknown _mod mode "${mode}" on "${prop}"`);
      }
    }
  }
}

export interface CopyRef extends Entity {
  name?: string;
  source?: string;
  _mod?: Record<string, unknown>;
  _preserve?: Record<string, unknown>;
}

function applyCopy(e: Entity, target: Entity, warnings: CopyModWarning[], label: string): void {
  const copy = e._copy as CopyRef;
  const preserve = (copy._preserve ?? {}) as Record<string, unknown>;
  const base = structuredClone(target);
  for (const key of DELETE_ON_COPY) {
    if (!preserve[key] && !preserve['*']) delete base[key];
  }
  const own: Entity = { ...e };
  delete own._copy;
  const merged: Entity = { ...base, ...own };
  if (copy._mod && typeof copy._mod === 'object') {
    applyMod(merged, copy._mod, (message) =>
      warnings.push({ entity: uidOf(e), message: `${label}: ${message}` }),
    );
  }
  // Replace contents in place so references held elsewhere stay valid.
  for (const k of Object.keys(e)) delete e[k];
  Object.assign(e, merged);
}

/**
 * Resolve every `_copy` in `entities` (mutating in place). `lookup` receives
 * the copy ref and must find the target entity — callers own the key scheme
 * (subraces match on raceName/raceSource too, subclasses on className, …).
 * Copy-of-copy chains resolve via fixed-point iteration; cycles and missing
 * targets end up as warnings with `_copy` stripped.
 */
export function resolveCopies(
  entities: Entity[],
  lookup: (copy: CopyRef, self: Entity) => Entity | undefined,
  label: string,
): CopyModWarning[] {
  const warnings: CopyModWarning[] = [];
  const pending = entities.filter((e) => e._copy !== undefined);
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i] as Entity;
      const copy = e._copy as CopyRef;
      const target = lookup(copy, e);
      if (target === undefined || target._copy !== undefined) continue; // retry next pass
      applyCopy(e, target, warnings, label);
      pending.splice(i, 1);
      progress = true;
    }
  }
  for (const e of pending) {
    const c = e._copy as CopyRef;
    warnings.push({
      entity: uidOf(e),
      message: `${label}: unresolved _copy target ${String(c?.name)}|${String(c?.source)}`,
    });
    delete e._copy;
  }
  return warnings;
}

function substituteVariables(template: Entity, vars: Record<string, unknown>): Entity {
  let json = JSON.stringify(template);
  for (const [k, val] of Object.entries(vars)) {
    json = json.split(`{{${k}}}`).join(String(val));
  }
  return JSON.parse(json) as Entity;
}

function buildVersion(base: Entity, v: Entity, warn: (message: string) => void): Entity {
  const clone = structuredClone(base);
  delete clone._versions;
  const overlay: Entity = { ...v };
  delete overlay._mod;
  delete overlay._abstract;
  delete overlay._implementations;
  const merged: Entity = { ...clone, ...overlay, _versionOf: uidOf(base) };
  const mod = v._mod;
  if (mod !== null && typeof mod === 'object') {
    applyMod(merged, mod as Record<string, unknown>, warn);
  }
  return merged;
}

/**
 * Expand `_versions` into standalone selectable entities (e.g. Aasimar's three
 * Celestial Revelations, Dragonborn's `_abstract`/`_implementations` colors).
 * The base entity keeps `_versions` untouched; returned entities carry
 * `_versionOf` pointing at the base uid.
 */
export function expandVersions(base: Entity, warnings: CopyModWarning[]): Entity[] {
  const versions = base._versions;
  if (!Array.isArray(versions)) return [];
  const warn = (message: string) =>
    warnings.push({ entity: uidOf(base), message: `versions: ${message}` });
  const out: Entity[] = [];
  // Each version is a deep copy of the base, so a short file listing many
  // implementations multiplies into far more than its own size. The structural
  // limits bound the file, not that product; this bounds the product.
  if (countVersions(versions) > MAX_VERSIONS_PER_ENTITY) {
    warn(`more than ${MAX_VERSIONS_PER_ENTITY} versions; the rest are ignored`);
  }
  const full = (): boolean => out.length >= MAX_VERSIONS_PER_ENTITY;
  expand: for (const raw of versions) {
    if (raw === null || typeof raw !== 'object') continue;
    if (full()) break;
    const v = raw as Entity;
    if (v._abstract !== undefined && Array.isArray(v._implementations)) {
      const abstract = v._abstract as Entity;
      for (const implRaw of v._implementations) {
        if (implRaw === null || typeof implRaw !== 'object') continue;
        if (full()) break expand;
        const impl = implRaw as Entity;
        const vars = (impl._variables ?? {}) as Record<string, unknown>;
        const materialized = substituteVariables(abstract, vars);
        const overlay: Entity = { ...impl };
        delete overlay._variables;
        out.push(buildVersion(base, { ...materialized, ...overlay }, warn));
      }
    } else {
      out.push(buildVersion(base, v, warn));
    }
  }
  return out;
}

/** How many entities `_versions` asks for, counted without building any. */
function countVersions(versions: unknown[]): number {
  let n = 0;
  for (const raw of versions) {
    if (raw === null || typeof raw !== 'object') continue;
    const v = raw as Entity;
    if (v._abstract !== undefined && Array.isArray(v._implementations)) {
      n += v._implementations.filter((i) => i !== null && typeof i === 'object').length;
    } else {
      n++;
    }
  }
  return n;
}
