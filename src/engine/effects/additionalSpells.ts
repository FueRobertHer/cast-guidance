/**
 * 5etools `additionalSpells` — innate / always-known / always-prepared spells
 * granted by races, feats, subraces, and subclasses. Format (simplified):
 *   [{ ability: "cha" | { choose: [...] },
 *      known:    { "1": ["thaumaturgy"], "_": [...] },
 *      innate:   { "3": { daily: { "1": ["hellish rebuke"] } } },
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

function parseSpellRef(s: string): { name: string; source: string } {
  // 5etools appends a cast-level hint like "hellish rebuke#2" or "guidance#c".
  const [namePart, source] = s.split('|');
  const name = (namePart ?? s).split('#')[0]?.trim() ?? s;
  return { name, source: source ?? '' };
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

/** Grant an entry's known/innate/prepared spells + surface expanded/choose notes. */
function grantSpellEntry(
  col: Collector,
  entry: DataEntity,
  origin: EffectOrigin,
  totalLevel: number,
  ability: Ability | undefined,
): void {
  const sawChoose = { v: false };

  // Innate / always-known: cast per their own rules or added to spells known.
  const innate: string[] = [];
  gatherByLevel(entry.known, totalLevel, innate, sawChoose);
  gatherByLevel(entry.innate, totalLevel, innate, sawChoose);
  for (const name of new Set(innate)) {
    col.add({ kind: 'grantSpell', spell: parseSpellRef(name), ability, origin });
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
    if (opts.length > 0) {
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
          const ability =
            picked !== undefined && (ABILITIES as readonly string[]).includes(picked)
              ? (picked as Ability)
              : undefined;
          grantSpellEntry(col, entry, origin, totalLevel, ability);
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

  applyEntries(unnamed, `${base}:ability:u`);

  if (branches.size <= 1) {
    // No real choice — collect the lone (or zero) named group as before.
    for (const name of order) {
      applyEntries(branches.get(name) ?? [], `${base}:ability:${name.toLowerCase()}`);
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
      applyEntries(branches.get(name) ?? [], `${base}:ability:${name.toLowerCase()}`);
    },
  );
}
