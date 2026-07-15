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
import { ABILITIES, type Ability, type EffectOrigin } from '../types';
import { asEntityArray, type Collector } from './base';

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

function gatherByLevel(map: unknown, totalLevel: number, out: string[], sawChoose: { v: boolean }) {
  if (map === null || typeof map !== 'object') return;
  for (const [key, val] of Object.entries(map)) {
    // "_" and spell-level buckets ("s1"…"s5", used by `expanded` lists that
    // organize additions by spell level rather than character level) are
    // ungated; numeric keys gate by character level. Without the sN case an
    // entire expanded list (e.g. Witherbloom/Lorehold Student) parses to NaN
    // and silently vanishes.
    const ungated = key === '_' || /^s\d+$/i.test(key);
    const gate = ungated ? 0 : Number.parseInt(key, 10);
    if (!Number.isNaN(gate) && gate <= totalLevel) collectStrings(val, out, sawChoose);
  }
}

export function collectAdditionalSpells(
  col: Collector,
  raw: unknown,
  origin: EffectOrigin,
  defaultAbility?: Ability,
): void {
  const entries = asEntityArray(raw);
  if (entries.length === 0) return;
  const totalLevel = totalLevelOf(col);

  for (const entry of entries) {
    let ability: Ability | undefined = defaultAbility;
    const ab = entry.ability;
    if (typeof ab === 'string' && (ABILITIES as readonly string[]).includes(ab)) {
      ability = ab as Ability;
    } else if (
      ab !== null &&
      typeof ab === 'object' &&
      Array.isArray((ab as { choose?: unknown[] }).choose)
    ) {
      const opts = (ab as { choose: unknown[] }).choose.map(String);
      ability = (opts[0] as Ability | undefined) ?? defaultAbility; // default; note the rest
      col.warn(`${origin.label}: spellcasting ability is your choice of ${opts.join('/')}.`);
    }

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
      col.add({
        kind: 'grantSpell',
        spell: parseSpellRef(name),
        ability,
        usage: 'prepared',
        origin,
      });
    }

    // Expanded spell list (Warlock patron): widens what you can learn rather than
    // granting anything. Without a picker we surface it so the option is visible.
    const expanded: string[] = [];
    gatherByLevel(entry.expanded, totalLevel, expanded, { v: false });
    const expandedNames = [...new Set(expanded)].map((n) => parseSpellRef(n).name);
    if (expandedNames.length > 0) {
      col.warn(`${origin.label}: expands your spell options — ${expandedNames.join(', ')}.`);
    }

    if (sawChoose.v) {
      col.warn(`${origin.label}: also lets you choose a spell — see the trait text.`);
    }
  }
}
