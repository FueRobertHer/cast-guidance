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
 * so (lacking a picker) it surfaces as a note. A `{ choose: "..." }` is the
 * player's pick: a prompt on a feat, and still a note on anything else.
 */
import { describeSpellQuery, parseSpellFilter, spellFitsQuery } from '../spellQuery';
import {
  ABILITIES,
  type Ability,
  type ChoiceOption,
  type ChoicePrompt,
  type DataEntity,
  type EffectOrigin,
  type SpellQuery,
} from '../types';
import { asEntityArray, type Collector, num, str } from './base';

function totalLevelOf(col: Collector): number {
  return col.doc.classes.reduce((s, c) => s + c.levels, 0);
}

const slugName = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

/**
 * Read one spell ref. 5etools appends a cast-level hint ("hellish rebuke#2",
 * "guidance#c"), and in its own data the hint comes after the source:
 * "thaumaturgy|xphb#c" is the XPHB Thaumaturgy. The hint is cut from every
 * part, not just the name. Left on the source, it named a printing that does
 * not exist ("xphb#c"), and every link to the spell led to a missing page.
 * Cutting it per part also reads a hint written before the source.
 */
export function parseSpellRef(s: string): { name: string; source: string } {
  const [name = '', source = ''] = s.split('|').map((part) => (part.split('#')[0] ?? '').trim());
  return { name, source };
}

/** How many times a granted spell can be cast, and what refills it. */
interface SpellLimit {
  uses: number;
  resetOn: 'short' | 'long';
}

/**
 * Sort a spell list's items: plain spell names go in `out`, and the `{choose}`
 * objects, which name no spell, in `chooses`.
 */
function collectStrings(val: unknown, out: string[], chooses: DataEntity[]): void {
  if (typeof val === 'string') {
    out.push(val);
  } else if (Array.isArray(val)) {
    for (const v of val) collectStrings(v, out, chooses);
  } else if (val !== null && typeof val === 'object') {
    if ('choose' in val) {
      chooses.push(val as DataEntity);
      return;
    }
    for (const v of Object.values(val)) collectStrings(v, out, chooses);
  }
}

/**
 * Whether an `additionalSpells` list has the player choose a spell anywhere: in
 * any entry, at any level, whatever a character took or has reached. An expanded
 * list only widens what can be learned, and a choice of `ability` is not a choice
 * of spell, so neither counts.
 */
export function hasChosenSpell(raw: unknown): boolean {
  const chooses: DataEntity[] = [];
  for (const { innate, known, prepared } of asEntityArray(raw)) {
    collectStrings([innate, known, prepared], [], chooses);
  }
  return chooses.length > 0;
}

/** The parts of a level-keyed map this character has reached. */
function reachedLevels(
  map: unknown,
  totalLevel: number,
  includeSpellLevels = false,
): Array<[levelKey: string, value: unknown]> {
  if (map === null || typeof map !== 'object') return [];
  return Object.entries(map).filter(([key]) => {
    // "_" is always ungated. Spell-level buckets ("s1", "s2", … — any `sN`)
    // appear only on `expanded` lists that organize additions by spell level
    // rather than character level, so include them there; without this an
    // entire expanded list (e.g. Witherbloom/Lorehold Student) parses to NaN
    // and silently vanishes. Numeric keys gate by character level.
    const ungated = key === '_' || (includeSpellLevels && /^s\d+$/i.test(key));
    const gate = ungated ? 0 : Number.parseInt(key, 10);
    return !Number.isNaN(gate) && gate <= totalLevel;
  });
}

/** The spells in one bucket, and how their uses are counted. */
interface SpellGroup {
  names: string[];
  /** The `{choose}` objects in the bucket: picks, cast as its named spells are. */
  chooses: DataEntity[];
  limit: SpellLimit | undefined;
  /** The count covers the bucket as a whole rather than each spell in it. */
  shared: boolean;
  /** Named as at will, not just listed with no limit. */
  atWill: boolean;
}

/**
 * Walk one level's value, which is either a bare list or a bucket object:
 * `{ will: [...], daily: { "1": [...], "1e": [...] }, rest: { "2": [...] } }`.
 * The bucket key is the count, and the "e" suffix is what "each" is written
 * with: `daily: { "1": ["a", "b"] }` is one cast a day between the two, and
 * `"1e"` is one cast of each, so the suffix decides how many pools to open.
 */
function walkBuckets(val: unknown, emit: (group: SpellGroup) => void): void {
  const unlimited = (v: unknown, atWill: boolean) => {
    const names: string[] = [];
    const chooses: DataEntity[] = [];
    collectStrings(v, names, chooses);
    if (names.length + chooses.length > 0) {
      emit({ names, chooses, limit: undefined, shared: false, atWill });
    }
  };
  if (typeof val === 'string' || Array.isArray(val)) {
    unlimited(val, false);
    return;
  }
  if (val === null || typeof val !== 'object') return;
  // A `{choose}` filter can stand where a bucket object would. It names no
  // spell, so walking it as a bucket would grant "level=1" as a spell.
  if ('choose' in val) {
    unlimited(val, false);
    return;
  }
  for (const [bucket, spells] of Object.entries(val)) {
    if (bucket !== 'daily' && bucket !== 'rest') {
      // "will" is at-will, and an unknown bucket is better granted without a
      // limit than dropped: the spell is the part the sheet can't invent.
      unlimited(spells, bucket === 'will');
      continue;
    }
    if (spells === null || typeof spells !== 'object') continue;
    const resetOn: SpellLimit['resetOn'] = bucket === 'daily' ? 'long' : 'short';
    for (const [countKey, list] of Object.entries(spells)) {
      const uses = Number.parseInt(countKey, 10);
      const names: string[] = [];
      const chooses: DataEntity[] = [];
      collectStrings(list, names, chooses);
      if (names.length + chooses.length === 0) continue;
      const limit: SpellLimit | undefined =
        Number.isNaN(uses) || uses <= 0 ? undefined : { uses, resetOn };
      emit({
        names,
        chooses,
        limit,
        shared: limit !== undefined && !/e$/i.test(countKey),
        atWill: false,
      });
    }
  }
}

/** Title Case for a resource card, since spell refs are written lowercase. */
function spellTitle(name: string): string {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A prompt for one `{choose}`, without what depends on the character. */
function readChoose(
  raw: DataEntity,
): Pick<ChoicePrompt, 'count' | 'spellQuery' | 'options'> | undefined {
  const { choose } = raw;
  if (typeof choose === 'string') {
    const spellQuery = parseSpellFilter(choose);
    if (spellQuery === undefined) return undefined;
    return { count: num(raw.count) ?? 1, spellQuery, options: [] };
  }
  if (choose === null || typeof choose !== 'object') return undefined;
  const { from, count } = choose as { from?: unknown; count?: unknown };
  if (!Array.isArray(from) || from.length === 0) return undefined;
  return {
    count: num(count) ?? num(raw.count) ?? 1,
    options: from
      .map(String)
      .map((ref) => ({ id: ref, label: spellTitle(parseSpellRef(ref).name) })),
  };
}

/**
 * A saved pick as an option, so it resolves without the spell files, which load
 * on demand: a reload must not take a character's spell away until they arrive.
 * What cannot be checked yet is trusted, and what is on file must fit the query.
 */
function savedPicks(col: Collector, id: string, query: SpellQuery): ChoiceOption[] {
  const stored = col.doc.choices[id];
  const picks = Array.isArray(stored) ? stored : stored === undefined ? [] : [stored];
  return picks.map(String).flatMap((pick) => {
    const { name, source } = parseSpellRef(pick);
    if (name === '' || source === '') return [];
    const spell = col.ctx.get('spell', name, source);
    return spell !== undefined && !spellFitsQuery(spell, query) ? [] : [{ id: pick, label: name }];
  });
}

/**
 * Grant an entry's known/innate/prepared spells + surface expanded notes and
 * prompt for its chosen spells. Only a feat prompts for now: the other origins
 * with a `{choose}` are still a note.
 */
function grantSpellEntry(
  col: Collector,
  entry: DataEntity,
  origin: EffectOrigin,
  totalLevel: number,
  ability: Ability | undefined,
  pickBase: string,
): void {
  let unoffered = false;
  const slots = new Map<string, number>();

  /** Prompt for one `{choose}`, and return what has been picked so far. */
  const pick = (raw: DataEntity, slot: string): string[] => {
    const read = origin.type === 'feat' ? readChoose(raw) : undefined;
    if (read === undefined) {
      unoffered = true;
      return [];
    }
    const n = slots.get(slot) ?? 0;
    slots.set(slot, n + 1);
    const id = `${pickBase}:${slot}:${n}`;
    const { count, spellQuery } = read;
    let picked: string[] = [];
    col.choice(
      {
        id,
        origin,
        kind: 'spell',
        label: `${origin.label}: ${
          spellQuery !== undefined
            ? describeSpellQuery(spellQuery, count)
            : `Spell${count > 1 ? 's' : ''} from this list`
        }`,
        count,
        options: spellQuery !== undefined ? savedPicks(col, id, spellQuery) : read.options,
        ...(spellQuery !== undefined ? { spellQuery } : {}),
      },
      (selected) => {
        picked = selected;
      },
    );
    return picked;
  };

  const grant = (
    group: SpellGroup,
    slot: string,
    seen: Set<string>,
    plainUsage: string | undefined,
  ) => {
    const picked = group.chooses.flatMap((raw) => pick(raw, slot));
    const spells = [...group.names, ...picked].map(parseSpellRef).filter((spell) => {
      const dedupe = `${spell.name}|${spell.source}`.toLowerCase();
      if (seen.has(dedupe)) return false;
      seen.add(dedupe);
      return true;
    });
    if (spells.length === 0) return;
    if (group.limit === undefined) {
      const usage = group.atWill ? undefined : plainUsage;
      for (const spell of spells) col.add({ kind: 'grantSpell', spell, ability, usage, origin });
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
        if (plainUsage === 'prepared') {
          col.add({
            kind: 'grantSpell',
            spell,
            ability,
            usage: plainUsage,
            slotsOnly: true,
            origin,
          });
        }
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
  };

  // Innate first, then always-known: a spell listed in both is the same spell,
  // and the innate listing is the one carrying its limit.
  const seen = new Set<string>();
  for (const [levelKey, val] of reachedLevels(entry.innate, totalLevel)) {
    walkBuckets(val, (group) => grant(group, `innate:${levelKey}`, seen, undefined));
  }
  for (const [levelKey, val] of reachedLevels(entry.known, totalLevel)) {
    const names: string[] = [];
    const chooses: DataEntity[] = [];
    collectStrings(val, names, chooses);
    grant(
      { names, chooses, limit: undefined, shared: false, atWill: false },
      `known:${levelKey}`,
      seen,
      undefined,
    );
  }

  // Always-prepared (Cleric domain, Paladin oath, Druid circle): cast with the
  // class's own slots and never counted against the prepared limit. A count on
  // top is free casts besides, so a limited spell gets a row for each way of
  // casting it, and a non-caster keeps only the free casts. Those are always per
  // spell: the release writes "1" on lists whose prose gives each spell its own.
  const seenPrepared = new Set<string>();
  for (const [levelKey, val] of reachedLevels(entry.prepared, totalLevel)) {
    walkBuckets(val, (group) => {
      grant({ ...group, shared: false }, `prepared:${levelKey}`, seenPrepared, 'prepared');
    });
  }

  // Expanded spell list (Warlock patron): widens what you can learn rather than
  // granting anything. Without a picker we surface it so the option is visible.
  const expanded: string[] = [];
  for (const [, val] of reachedLevels(entry.expanded, totalLevel, true)) {
    collectStrings(val, expanded, []);
  }
  const expandedNames = [...new Set(expanded)].map((n) => parseSpellRef(n).name);
  if (expandedNames.length > 0) {
    col.warn(`${origin.label}: expands your spell options: ${expandedNames.join(', ')}.`);
  }

  if (unoffered) {
    col.warn(`${origin.label}: also lets you choose a spell. See the trait text.`);
  }
}

/**
 * Apply one additionalSpells entry. When its `ability` is a `{choose}` list the
 * spellcasting ability is the player's pick, so surface an ability picker and
 * grant with the chosen ability rather than silently defaulting to the first
 * option. As with the branch choice, the grant waits on the pick — a pending
 * choice applies no effects — so nothing is granted with a guessed ability.
 *
 * @returns the ability the entry settled on, if it has one yet. A pick counts as
 *   soon as it is made, whether or not the entry's spells have been picked.
 */
function processSpellEntry(
  col: Collector,
  entry: DataEntity,
  origin: EffectOrigin,
  totalLevel: number,
  defaultAbility: Ability | undefined,
  abilityChoiceId: string,
  pickBase: string,
): Ability | undefined {
  const ab = entry.ability;
  if (typeof ab === 'string' && (ABILITIES as readonly string[]).includes(ab)) {
    grantSpellEntry(col, entry, origin, totalLevel, ab as Ability, pickBase);
    return ab as Ability;
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
      grantSpellEntry(col, entry, origin, totalLevel, opts[0], pickBase);
      return opts[0];
    }
    if (opts.length > 1) {
      let settled: Ability | undefined;
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
          settled = picked as Ability;
          grantSpellEntry(col, entry, origin, totalLevel, settled, pickBase);
        },
      );
      return settled;
    }
    // Malformed choose (no valid abilities) — fall back and explain.
    col.warn(`${origin.label}: spellcasting ability is your choice. See the trait text.`);
  }
  grantSpellEntry(col, entry, origin, totalLevel, defaultAbility, pickBase);
  return defaultAbility;
}

/**
 * Where an entry written `ability: "inherit"` gets its ability: one the same feat
 * raised, or the choice of the feats it is built on (lowercase names), settled
 * once they have all been collected.
 */
export type SpellInheritance = { ability?: Ability; fromFeats?: readonly string[] };

/**
 * Give each inheriting grant the ability its feat chose. Runs once everything is
 * collected, because a feat can come before the one it is built on (a feat from
 * a class level before one the character simply has). A feat taken more than once
 * has an ability per spell list, so a named list reads its own. Anything still
 * ambiguous, or not chosen yet, names no ability rather than guessing one.
 */
export function settleInheritedAbilities(col: Collector): void {
  for (const { grants, fromFeats, branch } of col.inheritingGrants) {
    const abilities = new Set(
      col.spellAbilities
        .filter(
          (s) =>
            fromFeats.includes(s.feat) &&
            (branch === undefined || s.branch === undefined || s.branch === branch),
        )
        .map((s) => s.ability),
    );
    const [ability] = abilities;
    if (abilities.size !== 1 || ability === undefined) continue;
    for (const grant of grants) grant.ability = ability;
  }
}

/**
 * @param idBase namespace for the branch choice's stable id (defaults to the
 *   origin uid). Callers with a per-instance base (repeatable feats) pass it so
 *   two instances keep separate branch picks.
 * @param inherit where an entry written `ability: "inherit"` gets its ability.
 */
export function collectAdditionalSpells(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  defaultAbility?: Ability,
  idBase?: string,
  inherit?: SpellInheritance,
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

  // Each entry's pickers (if any) need stable, collision-free ids; `group` namespaces
  // them and the index keeps sibling entries apart. A branch's picks are its own, so
  // going back to it finds them where they were.
  const applyEntries = (group: DataEntity[], groupKey: string, branch?: string) => {
    for (let i = 0; i < group.length; i++) {
      const entry = group[i];
      if (entry !== undefined) {
        const inherits = entry.ability === 'inherit';
        const start = col.effects.length;
        const settled = processSpellEntry(
          col,
          entry,
          origin,
          totalLevel,
          inherits ? (inherit?.ability ?? defaultAbility) : defaultAbility,
          `${base}:ability:${groupKey}:${i}`,
          `${base}:spell:${groupKey}:${i}`,
        );
        if (settled !== undefined && origin.type === 'feat') {
          const feat = origin.uid.split('|')[0] ?? origin.uid;
          col.spellAbilities.push({ feat, branch, ability: settled });
        }
        if (inherits && inherit?.fromFeats !== undefined) {
          col.inheritingGrants.push({
            grants: col.effects.slice(start).filter((e) => e.kind === 'grantSpell'),
            fromFeats: inherit.fromFeats,
            branch,
          });
        }
      }
    }
  };

  // `u`/`b` prefixes keep the unnamed and branch namespaces disjoint, so an
  // (only theoretically possible) branch literally named "u" can't collide.
  applyEntries(unnamed, 'u');

  if (branches.size <= 1) {
    // No real choice — collect the lone (or zero) named group as before.
    for (const name of order) {
      applyEntries(branches.get(name) ?? [], `b:${name.toLowerCase()}`, name.toLowerCase());
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
      applyEntries(branches.get(name) ?? [], `b:${name.toLowerCase()}`, name.toLowerCase());
    },
  );
}
