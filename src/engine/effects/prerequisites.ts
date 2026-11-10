import { calcAbilities } from '../calc/abilities';
import { classSpellcastingMode } from '../calc/slots';
import { summarizeEntries } from '../summarize';
import { ABILITIES, type Ability, type ChoiceOption, type DataEntity, subclassOf } from '../types';
import { type Collector, str } from './base';

/** Name of a race/feat/background prerequisite entry (string `name|source` or object). */
function prereqRefName(x: unknown): string | undefined {
  if (typeof x === 'string') {
    const name = (x.split('#')[0] ?? x).split('|')[0]?.trim();
    return name !== undefined && name !== '' ? name : undefined;
  }
  if (x !== null && typeof x === 'object') {
    const o = x as { name?: unknown; subrace?: unknown; displayEntry?: unknown };
    if (typeof o.displayEntry === 'string' && o.displayEntry !== '') return o.displayEntry;
    if (typeof o.name === 'string' && o.name !== '') {
      // Keep the subrace qualifier so a race gate reads "high elf", not "elf".
      return typeof o.subrace === 'string' && o.subrace !== '' ? `${o.subrace} ${o.name}` : o.name;
    }
  }
  return undefined;
}

/** AND-joined summary of one requirement set (one element of a prerequisite array). */
function summarizeReqSet(r: Record<string, unknown>): string {
  const parts: string[] = [];
  const ability = r.ability;
  if (Array.isArray(ability)) {
    for (const a of ability) {
      if (a !== null && typeof a === 'object') {
        for (const [k, v] of Object.entries(a)) parts.push(`${k.toUpperCase()} ${v}`);
      }
    }
  }
  if (typeof r.level === 'number') parts.push(`level ${r.level}`);
  else if (r.level !== null && typeof r.level === 'object') {
    const lv = (r.level as { level?: number }).level;
    if (typeof lv === 'number') parts.push(`level ${lv}`);
  }
  // Warlock invocation gates: Pact Boon, patron, and known-spell prerequisites.
  if (typeof r.pact === 'string') parts.push(`Pact of the ${r.pact}`);
  if (typeof r.patron === 'string') parts.push(`${r.patron.split('|')[0]} patron`);
  if (Array.isArray(r.spell)) {
    const spells = r.spell
      .map((s) => (typeof s === 'string' ? (s.split('#')[0] ?? s).split('|')[0] : undefined))
      .filter((s): s is string => s !== undefined);
    if (spells.length > 0) parts.push(`knows ${spells.join(' or ')}`);
  }
  // Requirement kinds that were previously dropped entirely (e.g. Prodigy's
  // race gate, Strixhaven Mascot's feat gate).
  if (Array.isArray(r.race)) {
    const names = r.race.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`race ${names.join('/')}`);
  }
  if (Array.isArray(r.feat)) {
    const names = r.feat.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`${names.join('/')} feat`);
  }
  if (Array.isArray(r.background)) {
    const names = r.background.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0) parts.push(`${names.join('/')} background`);
  }
  if (Array.isArray(r.proficiency)) {
    for (const p of r.proficiency) {
      if (p !== null && typeof p === 'object') {
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === 'string') parts.push(`${v} ${k}`);
        }
      }
    }
  }
  if (typeof r.other === 'string') parts.push(r.other);
  if (Array.isArray(r.spellcasting2020) || r.spellcasting === true) parts.push('spellcasting');
  return parts.join(', ');
}

/**
 * "STR 13" / "INT 13, level 4 or WIS 13, level 4" from a feat/entity prerequisite
 * array. Each array element is an alternative requirement SET (OR); fields within
 * a set are all required (AND). Alternatives are joined with " or " rather than
 * flattened into one misleading AND list.
 */
export function summarizePrerequisite(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw
    .filter((req): req is Record<string, unknown> => req !== null && typeof req === 'object')
    .map(summarizeReqSet)
    .filter((s) => s !== '')
    .join(' or ');
}

/**
 * Lowest level at which some alternative prerequisite set can be met (used to
 * gate optional-feature picks). The array is OR across sets, so the gate is the
 * minimum, not the maximum: `[{level: 10}, {level: 3}]` opens at level 3. A set
 * with no numeric level has no level gate at all, so it makes the whole result
 * `undefined`. Other fields stay advisory (`meetsPrerequisite`) and never raise
 * this hard gate.
 */
export function requiredLevel(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let need: number | undefined;
  for (const req of raw) {
    if (req === null || typeof req !== 'object') continue;
    const lvRaw = (req as Record<string, unknown>).level;
    const lv =
      typeof lvRaw === 'number'
        ? lvRaw
        : lvRaw !== null && typeof lvRaw === 'object'
          ? (lvRaw as { level?: unknown }).level
          : undefined;
    if (typeof lv !== 'number') return undefined;
    need = need === undefined ? lv : Math.min(need, lv);
  }
  return need;
}

// ---------------------------------------------------------------------------
// Prerequisite evaluation (advisory, GAME-005)
//
// Whether a feat/optional-feature prerequisite is *likely* met by the character
// so far. This drives an advisory cue, never a block: "guidance, not
// gatekeeping" means a table-approved pick must stay selectable. So the
// evaluator is deliberately conservative: it only flags a requirement it can
// affirmatively judge as unmet, and treats anything it can't evaluate (pact,
// patron, known-spell, free-text `other`) as satisfied to avoid false flags.
// Scores come from effects collected up to this point (race/background/earlier
// levels), which is exact for the common case; a later ASI is not yet folded in.
// ---------------------------------------------------------------------------

export interface PrereqContext {
  abilityScores: Record<Ability, number>;
  totalLevel: number;
  /** Combined, lowercased race + subrace name (empty when no race chosen). */
  raceName: string;
  /** Lowercased feat names the character already has (granted, chosen, declared). */
  featNames: Set<string>;
  backgroundName?: string;
  /** Lowercased skill/tool/armor/weapon proficiency names collected so far. */
  proficiencies: Set<string>;
  /**
   * The armor and the weapon names alone, which an `armor` or `weapon` requirement
   * reads, so a weapon named for what it lacks ("... without Two-Handed or Heavy")
   * is not heavy armor.
   */
  armorProfs: Set<string>;
  weaponProfs: Set<string>;
  hasSpellcasting: boolean;
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Lenient two-way token-subset match, biased toward "matches" to avoid false flags. */
function nameMatches(prereqName: string, candidate: string): boolean {
  const p = nameTokens(prereqName);
  const c = nameTokens(candidate);
  if (p.length === 0 || c.length === 0) return true;
  return p.every((t) => c.includes(t)) || c.every((t) => p.includes(t));
}

export function buildPrereqContext(col: Collector): PrereqContext {
  const doc = col.doc;
  const abilities = calcAbilities(doc, col.effects);
  const abilityScores = {} as Record<Ability, number>;
  for (const a of ABILITIES) abilityScores[a] = abilities[a].value;

  const featNames = new Set<string>();
  const addFeatName = (uidOrName: string) => {
    const name = uidOrName.split('|')[0]?.trim().toLowerCase();
    if (name !== undefined && name !== '') featNames.add(name);
  };
  for (const f of doc.feats) addFeatName(f.ref.name);
  for (const uid of col.collectedFeats) addFeatName(uid);
  for (const [key, val] of Object.entries(doc.choices)) {
    if (!key.endsWith(':feat')) continue; // ASI-chosen feats picked at any level
    for (const v of Array.isArray(val) ? val : [val]) {
      if (typeof v === 'string') addFeatName(v);
    }
  }

  const proficiencies = new Set<string>();
  const armorProfs = new Set<string>();
  const weaponProfs = new Set<string>();
  for (const e of col.effects) {
    if (e.kind === 'skillProf') proficiencies.add(e.skill.toLowerCase());
    else if (e.kind === 'toolProf' || e.kind === 'armorProf' || e.kind === 'weaponProf') {
      const name = e.name.toLowerCase();
      proficiencies.add(name);
      if (e.kind === 'armorProf') armorProfs.add(name);
      if (e.kind === 'weaponProf') weaponProfs.add(name);
    }
  }

  // Spellcasting can come from the base class (full/half/pact) OR the subclass
  // (Eldritch Knight, Arcane Trickster), so check both so a subclass caster is not
  // falsely flagged as unable to take a spellcasting-gated feat.
  const hasSpellcasting = doc.classes.some((c) => {
    if (classSpellcastingMode(col.ctx.get('class', c.ref.name, c.ref.source)) !== 'none') {
      return true;
    }
    const sub = subclassOf(col.ctx, c);
    return sub !== undefined && classSpellcastingMode(sub) !== 'none';
  });

  return {
    abilityScores,
    totalLevel: doc.classes.reduce((s, c) => s + c.levels, 0),
    raceName: `${doc.race?.name ?? ''} ${doc.subrace?.name ?? ''}`.trim(),
    featNames,
    backgroundName: doc.background?.name.toLowerCase(),
    proficiencies,
    armorProfs,
    weaponProfs,
    hasSpellcasting,
  };
}

/** Whether a requirement such as `{ armor: "heavy" }` is met, read against its own kind. */
function hasProficiency(kind: string, value: string, ctx: PrereqContext): boolean {
  const v = value.toLowerCase();
  const pool =
    kind === 'armor'
      ? ctx.armorProfs
      : kind === 'weapon' || kind === 'weaponGroup'
        ? ctx.weaponProfs
        : ctx.proficiencies;
  for (const p of pool) {
    if (p === v || p.includes(v) || v.includes(p)) return true;
  }
  return false;
}

/** One requirement set (AND of its fields). Unevaluable fields count as met. */
function meetsReqSet(r: Record<string, unknown>, ctx: PrereqContext): boolean {
  if (Array.isArray(r.ability)) {
    for (const obj of r.ability) {
      if (obj !== null && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          const a = k.toLowerCase();
          if ((ABILITIES as readonly string[]).includes(a) && typeof v === 'number') {
            if ((ctx.abilityScores[a as Ability] ?? 0) < v) return false;
          }
        }
      }
    }
  }
  const lvl =
    typeof r.level === 'number'
      ? r.level
      : r.level !== null && typeof r.level === 'object'
        ? (r.level as { level?: number }).level
        : undefined;
  if (typeof lvl === 'number' && ctx.totalLevel < lvl) return false;

  if ((r.spellcasting === true || Array.isArray(r.spellcasting2020)) && !ctx.hasSpellcasting) {
    return false;
  }

  // race/feat/background lists are satisfied by ANY match (OR within the list).
  if (Array.isArray(r.race) && ctx.raceName !== '') {
    const names = r.race.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => nameMatches(n, ctx.raceName))) return false;
  }
  if (Array.isArray(r.feat)) {
    const names = r.feat.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => ctx.featNames.has(n.toLowerCase()))) return false;
  }
  if (Array.isArray(r.background) && ctx.backgroundName !== undefined) {
    const names = r.background.map(prereqRefName).filter((s): s is string => s !== undefined);
    if (names.length > 0 && !names.some((n) => nameMatches(n, ctx.backgroundName ?? ''))) {
      return false;
    }
  }
  if (Array.isArray(r.proficiency)) {
    for (const p of r.proficiency) {
      if (p !== null && typeof p === 'object') {
        for (const [k, v] of Object.entries(p)) {
          if (typeof v === 'string' && v !== '' && !hasProficiency(k, v, ctx)) return false;
        }
      }
    }
  }
  // pact / patron / spell / other are intentionally not evaluated (treated as met).
  return true;
}

/** True if the character likely satisfies the prerequisite (OR across sets). */
export function meetsPrerequisite(raw: unknown, ctx: PrereqContext): boolean {
  if (!Array.isArray(raw)) return true;
  const sets = raw.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
  if (sets.length === 0) return true;
  return sets.some((set) => meetsReqSet(set, ctx));
}

/**
 * One feat picker option: label, prereq + effect summary, and either a
 * hard `disabled` (already taken, non-repeatable) or a non-blocking `advisory`
 * when the prerequisite looks unmet. Shared by every feat picker (ASI, origin).
 */
export function featChoiceOption(
  f: DataEntity,
  prereqCtx: PrereqContext,
  opts: { taken?: boolean } = {},
): ChoiceOption {
  const prereq = summarizePrerequisite(f.prerequisite);
  const summary = summarizeEntries(f.entries);
  const unmet = prereq !== '' && !meetsPrerequisite(f.prerequisite, prereqCtx);
  return {
    id: `${str(f.name)}|${str(f.source)}`.toLowerCase(),
    label: `${str(f.name)} (${str(f.source)})`,
    description: prereq !== '' ? `Prereq: ${prereq}. ${summary}` : summary,
    ...(opts.taken === true
      ? { disabled: { reason: 'Already taken (not repeatable)' } }
      : unmet
        ? { advisory: 'You may not meet this prerequisite.' }
        : {}),
  };
}
