/**
 * 5etools `additionalSpells` — innate / always-known / always-prepared spells
 * granted by races, feats, subraces, and subclasses. Format (simplified):
 *   [{ ability: "cha" | { choose: [...] },
 *      known:    { "1": ["thaumaturgy"], "_": [...] },
 *      innate:   { "3": { daily: { "1": ["hellish rebuke"] } } },  // 1/day
 *      prepared: { "1": ["bless", "cure wounds"] },   // domain/oath/circle
 *      expanded: { "1": ["armor of agathys"] } }]     // warlock patron
 * Level keys gate by character level. `prepared` spells are always prepared and
 * cast with the class's own slots; `expanded` merely widens what you can learn,
 * so (lacking a picker) it surfaces as a note. `{ choose: "..." }` filter grants
 * likewise surface as a note.
 */
import { ABILITIES, type Ability, type DataEntity, type EffectOrigin } from '../types';
import { asEntityArray, type Collector, str } from './base';

function totalLevelOf(col: Collector): number {
  return col.doc.classes.reduce((s, c) => s + c.levels, 0);
}

const slugName = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

function parseSpellRef(s: string): { name: string; source: string } {
  // 5etools appends a cast-level hint like "hellish rebuke#2" or "guidance#c".
  const [namePart, source] = s.split('|');
  const name = (namePart ?? s).split('#')[0]?.trim() ?? s;
  return { name, source: source ?? '' };
}

/** How many times a granted spell can be cast, and what refills it. */
interface SpellLimit {
  uses: number;
  resetOn: 'short' | 'long';
}

/** Push plain spell-name strings, skipping `{choose}` filter objects. */
function collectStrings(val: unknown, out: string[], sawChoose: { v: boolean }): void {
  if (typeof val === 'string') {
    out.push(val);
  } else if (Array.isArray(val)) {
    for (const v of val) collectStrings(v, out, sawChoose);
  } else if (val !== null && typeof val === 'object') {
    if ('choose' in val) {
      sawChoose.v = true;
      return;
    }
    for (const v of Object.values(val)) collectStrings(v, out, sawChoose);
  }
}

function gatherByLevel(
  map: unknown,
  totalLevel: number,
  out: string[],
  sawChoose: { v: boolean },
  includeSpellLevels = false,
) {
  if (map === null || typeof map !== 'object') return;
  for (const [key, val] of Object.entries(map)) {
    // "_" is always ungated. Spell-level buckets ("s1", "s2", … — any `sN`)
    // appear only on `expanded` lists that organize additions by spell level
    // rather than character level, so include them there; without this an
    // entire expanded list (e.g. Witherbloom/Lorehold Student) parses to NaN
    // and silently vanishes. Numeric keys gate by character level.
    const ungated = key === '_' || (includeSpellLevels && /^s\d+$/i.test(key));
    const gate = ungated ? 0 : Number.parseInt(key, 10);
    if (!Number.isNaN(gate) && gate <= totalLevel) collectStrings(val, out, sawChoose);
  }
}

/** The spells in one innate bucket, and how their uses are counted. */
interface InnateGroup {
  names: string[];
  limit: SpellLimit | undefined;
  /** The count covers the bucket as a whole rather than each spell in it. */
  shared: boolean;
}

/**
 * Walk one `innate` value, which is either a bare list or a bucket object:
 * `{ will: [...], daily: { "1": [...], "1e": [...] }, rest: { "2": [...] } }`.
 * The bucket key is the count, and the "e" suffix is what "each" is written
 * with: `daily: { "1": ["a", "b"] }` is one cast a day between the two, and
 * `"1e"` is one cast of each, so the suffix decides how many pools to open.
 */
function walkInnateValue(
  val: unknown,
  sawChoose: { v: boolean },
  emit: (group: InnateGroup) => void,
): void {
  const unlimited = (v: unknown) => {
    const names: string[] = [];
    collectStrings(v, names, sawChoose);
    if (names.length > 0) emit({ names, limit: undefined, shared: false });
  };
  if (typeof val === 'string' || Array.isArray(val)) {
    unlimited(val);
    return;
  }
  if (val === null || typeof val !== 'object') return;
  // A `{choose}` filter can stand where a bucket object would. It names no
  // spell, so it belongs to `collectStrings`, which turns it into the note the
  // player reads; walking it as a bucket would grant "level=1" as a spell.
  if ('choose' in val) {
    unlimited(val);
    return;
  }
  for (const [bucket, spells] of Object.entries(val)) {
    if (bucket !== 'daily' && bucket !== 'rest') {
      // "will" is at-will, and an unknown bucket is better granted without a
      // limit than dropped: the spell is the part the sheet can't invent.
      unlimited(spells);
      continue;
    }
    if (spells === null || typeof spells !== 'object') continue;
    const resetOn: SpellLimit['resetOn'] = bucket === 'daily' ? 'long' : 'short';
    for (const [countKey, list] of Object.entries(spells)) {
      const uses = Number.parseInt(countKey, 10);
      const names: string[] = [];
      collectStrings(list, names, sawChoose);
      if (names.length === 0) continue;
      const limit: SpellLimit | undefined =
        Number.isNaN(uses) || uses <= 0 ? undefined : { uses, resetOn };
      emit({ names, limit, shared: limit !== undefined && !/e$/i.test(countKey) });
    }
  }
}

function gatherInnate(
  map: unknown,
  totalLevel: number,
  sawChoose: { v: boolean },
  emit: (group: InnateGroup) => void,
): void {
  if (map === null || typeof map !== 'object') return;
  for (const [key, val] of Object.entries(map)) {
    const gate = key === '_' ? 0 : Number.parseInt(key, 10);
    if (!Number.isNaN(gate) && gate <= totalLevel) walkInnateValue(val, sawChoose, emit);
  }
}

/** Title Case for a resource card, since spell refs are written lowercase. */
function spellTitle(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Grant an entry's known/innate/prepared spells + surface expanded/choose notes. */
function grantSpellEntry(
  col: Collector,
  entry: DataEntity,
  origin: EffectOrigin,
  totalLevel: number,
  ability: Ability | undefined,
): void {
  const sawChoose = { v: false };

  // Innate first, then always-known: a spell listed in both is the same spell,
  // and the innate listing is the one carrying its limit.
  const seen = new Set<string>();
  gatherInnate(entry.innate, totalLevel, sawChoose, (group) => {
    const spells = group.names.map(parseSpellRef).filter((spell) => {
      const dedupe = `${spell.name}|${spell.source}`.toLowerCase();
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    });
    if (spells.length === 0) return;
    if (group.limit === undefined) {
      for (const spell of spells) col.add({ kind: 'grantSpell', spell, ability, origin });
      return;
    }
    const { uses, resetOn } = group.limit;
    const per = resetOn === 'long' ? 'day' : 'rest';
    // A shared count is one pool the whole bucket draws from; "each" opens one
    // per spell. Either way the origin is in the key, so a wand's misty step
    // and a cloak's are never the same pool.
    const pools = group.shared ? [spells] : spells.map((spell) => [spell]);
    for (const pool of pools) {
      const key = `spell:${origin.uid}:${pool.map((s) => slugName(s.name)).join('+')}`;
      col.add({
        kind: 'resource',
        key,
        label: pool.map((s) => spellTitle(s.name)).join(', '),
        max: uses,
        resetOn,
        // Two copies of the same wand are two grants of one use each, not one
        // grant repeated: the pool they share should hold both.
        stack: true,
        origin,
      });
      for (const spell of pool) {
        col.add({
          kind: 'grantSpell',
          spell,
          ability,
          usage: `${uses}/${per}`,
          resourceKey: key,
          origin,
        });
      }
    }
  });

  const known: string[] = [];
  gatherByLevel(entry.known, totalLevel, known, sawChoose);
  for (const name of known) {
    const spell = parseSpellRef(name);
    const dedupe = `${spell.name}|${spell.source}`.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    col.add({ kind: 'grantSpell', spell, ability, origin });
  }

  // Always-prepared (Cleric domain, Paladin oath, Druid circle): cast with the
  // class's own slots and never counted against the prepared limit.
  const prepared: string[] = [];
  gatherByLevel(entry.prepared, totalLevel, prepared, sawChoose);
  for (const name of new Set(prepared)) {
    col.add({ kind: 'grantSpell', spell: parseSpellRef(name), ability, usage: 'prepared', origin });
  }

  // Expanded spell list (Warlock patron): widens what you can learn rather than
  // granting anything. Without a picker we surface it so the option is visible.
  const expanded: string[] = [];
  gatherByLevel(entry.expanded, totalLevel, expanded, { v: false }, true);
  const expandedNames = [...new Set(expanded)].map((n) => parseSpellRef(n).name);
  if (expandedNames.length > 0) {
    col.warn(`${origin.label}: expands your spell options — ${expandedNames.join(', ')}.`);
  }

  if (sawChoose.v) {
    col.warn(`${origin.label}: also lets you choose a spell — see the trait text.`);
  }
}

/**
 * Apply one additionalSpells entry. When its `ability` is a `{choose}` list the
 * spellcasting ability is the player's pick, so surface an ability picker and
 * grant with the chosen ability rather than silently defaulting to the first
 * option. As with the branch choice, the grant waits on the pick — a pending
 * choice applies no effects — so nothing is granted with a guessed ability.
 */
function processSpellEntry(
  col: Collector,
  entry: DataEntity,
  origin: EffectOrigin,
  totalLevel: number,
  defaultAbility: Ability | undefined,
  abilityChoiceId: string,
): void {
  const ab = entry.ability;
  if (typeof ab === 'string' && (ABILITIES as readonly string[]).includes(ab)) {
    grantSpellEntry(col, entry, origin, totalLevel, ab as Ability);
    return;
  }
  if (
    ab !== null &&
    typeof ab === 'object' &&
    Array.isArray((ab as { choose?: unknown[] }).choose)
  ) {
    const opts = (ab as { choose: unknown[] }).choose
      .map(String)
      .filter((o): o is Ability => (ABILITIES as readonly string[]).includes(o));
    if (opts.length === 1) {
      // A single valid option is not a real choice — treat it like a fixed
      // ability and grant immediately, matching the plain-string path.
      grantSpellEntry(col, entry, origin, totalLevel, opts[0]);
      return;
    }
    if (opts.length > 1) {
      col.choice(
        {
          id: abilityChoiceId,
          origin,
          kind: 'ability',
          label: `${origin.label}: spellcasting ability`,
          count: 1,
          options: opts.map((a) => ({ id: a, label: a.toUpperCase() })),
        },
        (selected) => {
          const picked = selected[0];
          // Only grant once a valid ability is picked — an unanswered or
          // invalid/stale pick grants nothing (as the branch choice does),
          // rather than granting with no ability while re-prompting.
          if (picked === undefined || !(ABILITIES as readonly string[]).includes(picked)) return;
          grantSpellEntry(col, entry, origin, totalLevel, picked as Ability);
        },
      );
      return;
    }
    // Malformed choose (no valid abilities) — fall back and explain.
    col.warn(`${origin.label}: spellcasting ability is your choice — see the trait text.`);
  }
  grantSpellEntry(col, entry, origin, totalLevel, defaultAbility);
}

/**
 * @param idBase namespace for the branch choice's stable id (defaults to the
 *   origin uid). Callers with a per-instance base (repeatable feats) pass it so
 *   two instances keep separate branch picks.
 */
export function collectAdditionalSpells(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  defaultAbility?: Ability,
  idBase?: string,
): void {
  const entries = asEntityArray(raw);
  if (entries.length === 0) return;
  const totalLevel = totalLevelOf(col);
  const base = idBase ?? `spells:${origin.uid}`;

  // Entries carrying a distinct `name` are mutually-exclusive branches (the
  // 5etools convention) — e.g. Strixhaven Initiate's colleges. The character
  // picks ONE; granting every branch at once is wrong (Strixhaven Initiate
  // would grant ~a dozen cantrips instead of two). Unnamed entries always apply.
  const branches = new Map<string, DataEntity[]>();
  const order: string[] = [];
  const unnamed: DataEntity[] = [];
  for (const entry of entries) {
    const name = str(entry.name);
    if (name === undefined || name === '') {
      unnamed.push(entry);
      continue;
    }
    const group = branches.get(name);
    if (group === undefined) {
      branches.set(name, [entry]);
      order.push(name);
    } else {
      group.push(entry);
    }
  }

  // Each entry's choose-ability picker (if any) needs a stable, collision-free
  // id; `prefix` namespaces it by group and the index keeps sibling entries apart.
  const applyEntries = (group: DataEntity[], prefix: string) => {
    for (let i = 0; i < group.length; i++) {
      const entry = group[i];
      if (entry !== undefined) {
        processSpellEntry(col, entry, origin, totalLevel, defaultAbility, `${prefix}:${i}`);
      }
    }
  };

  // `u`/`b` prefixes keep the unnamed and branch namespaces disjoint, so an
  // (only theoretically possible) branch literally named "u" can't collide.
  applyEntries(unnamed, `${base}:ability:u`);

  if (branches.size <= 1) {
    // No real choice — collect the lone (or zero) named group as before.
    for (const name of order) {
      applyEntries(branches.get(name) ?? [], `${base}:ability:b:${name.toLowerCase()}`);
    }
    return;
  }

  col.choice(
    {
      id: `${base}:branch`,
      origin,
      kind: 'generic',
      label: `${origin.label}: choose a spell option`,
      count: 1,
      options: order.map((name) => ({ id: name.toLowerCase(), label: name })),
    },
    (selected) => {
      const pick = selected[0];
      const name = pick !== undefined ? order.find((n) => n.toLowerCase() === pick) : undefined;
      if (name === undefined) return;
      applyEntries(branches.get(name) ?? [], `${base}:ability:b:${name.toLowerCase()}`);
    },
  );
}
