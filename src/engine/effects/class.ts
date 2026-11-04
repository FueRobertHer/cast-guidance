import { plainEntryText } from '../../data5e/entries/plainText';
import { calcAbilities } from '../calc/abilities';
import { classSpellcastingMode } from '../calc/slots';
import { emitCuratedEffects as emitCurated } from '../curated/curatedEffects';
import { summarizeEntries } from '../summarize';
import {
  ABILITIES,
  type Ability,
  type ChoiceOption,
  type DataEntity,
  type EffectOrigin,
  refUid,
} from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asEntityArray, type Collector, str } from './base';
import { collectFeatEntity } from './feat';
import { proseScanFeature } from './proseScan';
import { expertiseOptions, readProficiencyList, skillOptions } from './readers';

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
// Prerequisite evaluation (advisory — GAME-005)
//
// Whether a feat/optional-feature prerequisite is *likely* met by the character
// so far. This drives an advisory cue, never a block: "guidance, not
// gatekeeping" means a table-approved pick must stay selectable. So the
// evaluator is deliberately conservative — it only flags a requirement it can
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
  for (const e of col.effects) {
    if (e.kind === 'skillProf') proficiencies.add(e.skill.toLowerCase());
    else if (e.kind === 'toolProf' || e.kind === 'armorProf' || e.kind === 'weaponProf') {
      proficiencies.add(e.name.toLowerCase());
    }
  }

  // Spellcasting can come from the base class (full/half/pact) OR the subclass
  // (Eldritch Knight, Arcane Trickster) — check both so a subclass caster is not
  // falsely flagged as unable to take a spellcasting-gated feat.
  const hasSpellcasting = doc.classes.some((c) => {
    if (classSpellcastingMode(col.ctx.get('class', c.ref.name, c.ref.source)) !== 'none') {
      return true;
    }
    const sub = c.subclass;
    return (
      sub !== undefined &&
      classSpellcastingMode(col.ctx.get('subclass', sub.name, sub.source)) !== 'none'
    );
  });

  return {
    abilityScores,
    totalLevel: doc.classes.reduce((s, c) => s + c.levels, 0),
    raceName: `${doc.race?.name ?? ''} ${doc.subrace?.name ?? ''}`.trim(),
    featNames,
    backgroundName: doc.background?.name.toLowerCase(),
    proficiencies,
    hasSpellcasting,
  };
}

function hasProficiency(value: string, ctx: PrereqContext): boolean {
  const v = value.toLowerCase();
  for (const p of ctx.proficiencies) {
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
        for (const v of Object.values(p)) {
          if (typeof v === 'string' && v !== '' && !hasProficiency(v, ctx)) return false;
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

/** "Rage|Barbarian||1" or "...|1|TCE" -> parts. Empty classSource = PHB. */
export interface ClassFeatureRef {
  name: string;
  className: string;
  classSource: string;
  level: number;
  featureSource?: string;
}

export function parseClassFeatureRef(raw: string): ClassFeatureRef | undefined {
  const parts = raw.split('|');
  const [name, className, classSource, levelStr, featureSource] = parts;
  if (name === undefined || className === undefined) return undefined;
  const level = Number.parseInt(levelStr ?? '', 10);
  return {
    name,
    className,
    classSource: classSource !== undefined && classSource !== '' ? classSource : 'PHB',
    level: Number.isNaN(level) ? 1 : level,
    featureSource: featureSource !== undefined && featureSource !== '' ? featureSource : undefined,
  };
}

/** "Name|Class|ClassSource|Short|ShortSource|Level|Source?" for subclasses. */
export function parseSubclassFeatureRef(
  raw: string,
): (ClassFeatureRef & { shortName: string; shortSource: string }) | undefined {
  const parts = raw.split('|');
  const [name, className, classSource, shortName, shortSource, levelStr, featureSource] = parts;
  if (name === undefined || className === undefined || shortName === undefined) return undefined;
  const level = Number.parseInt(levelStr ?? '', 10);
  return {
    name,
    className,
    classSource: classSource !== undefined && classSource !== '' ? classSource : 'PHB',
    shortName,
    shortSource: shortSource !== undefined && shortSource !== '' ? shortSource : 'PHB',
    level: Number.isNaN(level) ? 1 : level,
    featureSource: featureSource !== undefined && featureSource !== '' ? featureSource : undefined,
  };
}

/** A `refClassFeature` / `refSubclassFeature` node, by its ref string. */
interface NestedRef {
  kind: 'class' | 'subclass';
  raw: string;
}

/** One way to take a pick-one feature: its name and the features it grants. */
interface PickBranch {
  name: string;
  refs: NestedRef[];
  /** A branch that groups several refs under a heading keeps that heading's text. */
  entries?: unknown;
}

/** A pick-one list inside a feature: take `count` of the branches. */
interface PickGroup {
  count: number;
  branches: PickBranch[];
}

function asNestedRef(o: Record<string, unknown>): NestedRef | undefined {
  if (o.type === 'refClassFeature' && typeof o.classFeature === 'string') {
    return { kind: 'class', raw: o.classFeature };
  }
  if (o.type === 'refSubclassFeature' && typeof o.subclassFeature === 'string') {
    return { kind: 'subclass', raw: o.subclassFeature };
  }
  return undefined;
}

const refName = (ref: NestedRef) => ref.raw.split('|')[0] ?? ref.raw;

/**
 * Feature refs nested inside a feature's entries tree. Real data routes core
 * mechanics through these: the 2014 paladin's once-per-rest Channel Divinity
 * is a `refClassFeature` inside Sacred Oath, and each oath's Channel Divinity
 * options are `refSubclassFeature`s inside the oath feature. A collector that
 * only reads the class's top-level list never sees them.
 *
 * Refs under a `type: 'options'` node with a `count` are a pick (Blessed
 * Strikes, Hunter's Prey, Totem Spirit): they come back as `picks`, which
 * `collectPick` turns into a `feature` choice, because granting every branch
 * would put abilities on the sheet that the character never chose. An
 * `options` node with no `count` asks for no pick (Psi Warrior's Psionic
 * Power, Genie's Vessel: you have every one), so its refs are granted like
 * any others. Pick-one features the data does not mark this way are listed
 * in {@link PICK_ONE}.
 */
function nestedFeatureRefs(entries: unknown): { refs: NestedRef[]; picks: PickGroup[] } {
  const refs: NestedRef[] = [];
  const picks: PickGroup[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.type === 'options' && typeof o.count === 'number' && o.count >= 1) {
      // Optional-feature refs (fighting styles, maneuvers) and inline text
      // are not feature refs: those come from `optionalfeatureProgression`, or
      // stay as the card's prose.
      const branches: PickBranch[] = [];
      for (const x of Array.isArray(o.entries) ? o.entries : []) {
        const ref = x !== null && typeof x === 'object' ? asNestedRef(x as DataEntity) : undefined;
        if (ref !== undefined) branches.push({ name: refName(ref), refs: [ref] });
      }
      if (branches.length > 0) picks.push({ count: o.count, branches });
      return;
    }
    const ref = asNestedRef(o);
    if (ref !== undefined) {
      refs.push(ref);
      return;
    }
    walk(o.entries);
    walk(o.items);
    walk(o.entry);
  };
  walk(entries);
  return { refs, picks };
}

/** `feature|class|subclass short name`, lowercased: one key for every printing. */
function featureIdentity(feature: DataEntity): string {
  return [feature.name, feature.className, feature.subclassShortName]
    .map((v) => (typeof v === 'string' ? v : ''))
    .join('|')
    .toLowerCase();
}

/**
 * Pick-one features the data does not mark with a counted `options` node.
 * The Armorer's Armor Model lists its models as plain refs (EFA) or as named
 * groups of refs (TCE), so without this every model would be granted.
 */
const PICK_ONE = new Set(['armor model|artificer|armorer']);

/**
 * Picks that take an earlier pick's answer instead of asking again: Storm Soul
 * and Raging Storm use the environment chosen for Storm Aura. Keyed like
 * {@link PICK_ONE}, to the lowercased name of the feature they follow, which
 * is always gained at a lower level, so a feature list (in level order)
 * collects it first.
 */
const FOLLOWS: Record<string, string> = {
  'storm soul|barbarian|storm herald': 'storm aura',
  'raging storm|barbarian|storm herald': 'storm aura',
};

/**
 * The branches of a {@link PICK_ONE} feature: each ref is a branch of its own,
 * unless it sits under a named heading, which makes the heading the branch.
 */
function featureBranches(entries: unknown): PickBranch[] {
  const out: PickBranch[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const ref = asNestedRef(o);
    if (ref !== undefined) {
      out.push({ name: refName(ref), refs: [ref] });
      return;
    }
    if (typeof o.name === 'string') {
      const { refs } = nestedFeatureRefs(o.entries);
      if (refs.length > 0) {
        out.push({ name: o.name, refs, entries: o.entries });
        return;
      }
    }
    walk(o.entries);
    walk(o.items);
    walk(o.entry);
  };
  walk(entries);
  return out;
}

function findClassFeature(col: Collector, ref: ClassFeatureRef): DataEntity | undefined {
  return col.ctx
    .byType('classFeature')
    .find(
      (f) =>
        str(f.name)?.toLowerCase() === ref.name.toLowerCase() &&
        str(f.className)?.toLowerCase() === ref.className.toLowerCase() &&
        str(f.classSource)?.toLowerCase() === ref.classSource.toLowerCase() &&
        f.level === ref.level &&
        (ref.featureSource === undefined ||
          str(f.source)?.toLowerCase() === ref.featureSource.toLowerCase()),
    );
}

/** Identity keys so a feature reachable both by list and by nested ref collects once. */
const classFeatureKey = (r: ClassFeatureRef) =>
  `c:${r.name}|${r.className}|${r.classSource}|${r.level}`.toLowerCase();
const subclassFeatureKey = (r: ClassFeatureRef & { shortName: string; shortSource: string }) =>
  `s:${r.name}|${r.className}|${r.classSource}|${r.shortName}|${r.shortSource}|${r.level}`.toLowerCase();

/**
 * Which features a class entry has already dealt with. `claimed` is pre-seeded
 * with the top-level feature lists so a nested ref never steals a feature the
 * list will collect itself (with its ASI/Expertise handling); `collected` is
 * what actually got collected, which is what stops a second visit.
 */
interface FeatureLedger {
  claimed: Set<string>;
  collected: Set<string>;
  /** Branches picked so far, by `<choice prefix>|<feature name>`, for {@link FOLLOWS}. */
  picked: Map<string, string[]>;
}

/** What stays the same while one class entry's features are collected. */
interface FeatureWalk {
  col: Collector;
  cardOrigin: EffectOrigin;
  curatedLabel: string;
  classLevel: number;
  ledger: FeatureLedger;
}

/** A nested ref, parsed: where it sits and how to find what it points at. */
interface NestedTarget {
  name: string;
  level: number;
  key: string;
  find: (col: Collector) => DataEntity | undefined;
}

function parseNested(nested: NestedRef): NestedTarget | undefined {
  if (nested.kind === 'class') {
    const ref = parseClassFeatureRef(nested.raw);
    if (ref === undefined) return undefined;
    return {
      name: ref.name,
      level: ref.level,
      key: classFeatureKey(ref),
      find: (col) => findClassFeature(col, ref),
    };
  }
  const ref = parseSubclassFeatureRef(nested.raw);
  if (ref === undefined) return undefined;
  return {
    name: ref.name,
    level: ref.level,
    key: subclassFeatureKey(ref),
    find: (col) => findSubclassFeature(col, ref),
  };
}

/**
 * Collect one nested feature unless it is above the class level, belongs to
 * the top-level list, or was collected already. Unresolvable refs are skipped
 * silently: they can point at printings outside the character's packs.
 */
function collectNested(
  walk: FeatureWalk,
  target: NestedTarget,
  entity: DataEntity | undefined,
  choicePrefix: string,
): void {
  const { ledger } = walk;
  if (target.level > walk.classLevel) return;
  if (ledger.claimed.has(target.key) || ledger.collected.has(target.key)) return;
  const found = entity ?? target.find(walk.col);
  if (found === undefined) return;
  collectFeatureWithNested(walk, found, target.name, target.level, target.key, choicePrefix);
}

/**
 * Collect one class/subclass feature (card, curated effects or prose scan),
 * then follow the feature refs nested in its entries, recursively. Picks it
 * holds become choices keyed under `choicePrefix`: the origin's own prefix
 * (`class:<uid>`, `subclass:<uid>`), or a picked branch's choice id, so a
 * pick inside a branch is cleared when that branch is swapped.
 */
function collectFeatureWithNested(
  walk: FeatureWalk,
  feature: DataEntity,
  name: string,
  level: number,
  key: string,
  choicePrefix: string,
): void {
  const { col, cardOrigin, curatedLabel, ledger } = walk;
  if (ledger.collected.has(key)) return;
  ledger.collected.add(key);
  col.features.push({ name, level, origin: cardOrigin, entries: feature.entries });
  const featureOrigin: EffectOrigin = { ...cardOrigin, label: name };
  if (!emitCurated(col, `${name}|${curatedLabel}`.toLowerCase(), featureOrigin)) {
    proseScanFeature(col, name, feature.entries, featureOrigin);
  }
  const identity = featureIdentity(feature);
  const { refs, picks } = PICK_ONE.has(identity)
    ? { refs: [], picks: [{ count: 1, branches: featureBranches(feature.entries) }] }
    : nestedFeatureRefs(feature.entries);
  for (const nested of refs) {
    const target = parseNested(nested);
    if (target !== undefined) collectNested(walk, target, undefined, choicePrefix);
  }
  picks.forEach((pick, index) => {
    collectPick(walk, pick, { name, level, identity, index }, choicePrefix);
  });
}

/**
 * Refs inside a heading's text swapped for the features they point at, so a
 * grouped branch's info sheet reads in full rather than as a list of names.
 */
function expandRefs(entries: unknown, resolved: ReadonlyMap<string, DataEntity>): unknown {
  if (Array.isArray(entries)) return entries.map((x) => expandRefs(x, resolved));
  if (entries === null || typeof entries !== 'object') return entries;
  const o = entries as DataEntity;
  const ref = asNestedRef(o);
  if (ref !== undefined) {
    const entity = resolved.get(ref.raw);
    return entity === undefined
      ? o
      : { type: 'entries', name: refName(ref), entries: entity.entries };
  }
  const out: DataEntity = { ...o };
  for (const k of ['entries', 'items', 'entry'] as const) {
    if (k in o) out[k] = expandRefs(o[k], resolved);
  }
  return out;
}

/**
 * A pick-one list inside a feature, as a `feature` choice: the picked
 * branches are collected like any nested feature (card, curated effects,
 * prose scan) and the others are not. Unpicked, the choice stays pending, so
 * a saved character from before the pick existed sees it open on Build.
 */
function collectPick(
  walk: FeatureWalk,
  pick: PickGroup,
  parent: { name: string; level: number; identity: string; index: number },
  choicePrefix: string,
): void {
  const { col, cardOrigin, ledger } = walk;
  // Resolved up front: an option needs its text, and a branch whose features
  // are all above the class level or outside the character's packs cannot be
  // taken, so it is not offered.
  const branches = pick.branches.flatMap((b) => {
    const targets = b.refs.flatMap((r) => {
      const target = parseNested(r);
      if (target === undefined || target.level > walk.classLevel) return [];
      const entity = target.find(col);
      return entity !== undefined ? [{ target, entity, raw: r.raw }] : [];
    });
    return targets.length > 0 ? [{ ...b, targets }] : [];
  });
  if (branches.length === 0) return;
  // Branch names are the ids: a ref string carries sources a later release
  // can change. A name two branches share is no id at all, so both of those
  // take their first ref's, whatever order they come in.
  const names = branches.map((b) => b.name.toLowerCase());
  const byId = new Map<string, (typeof branches)[number]>();
  branches.forEach((b, i) => {
    const name = names[i] ?? '';
    const shared = names.indexOf(name) !== names.lastIndexOf(name);
    byId.set(shared ? (b.targets[0]?.raw ?? name).toLowerCase() : name, b);
  });

  const take = (optionIds: readonly string[], prefix: (optionId: string) => string) => {
    for (const optionId of optionIds) {
      for (const { target, entity } of byId.get(optionId)?.targets ?? []) {
        collectNested(walk, target, entity, prefix(optionId));
      }
    }
  };

  const leader = FOLLOWS[parent.identity];
  if (leader !== undefined) {
    // Nothing to ask: the leading pick decides, and while it is unmade its
    // own prompt is the open choice.
    take(ledger.picked.get(`${choicePrefix}|${leader}`) ?? [], () => choicePrefix);
    return;
  }

  const id =
    `${choicePrefix}:feature:${parent.name}:${parent.level}${parent.index > 0 ? `:${parent.index}` : ''}`.toLowerCase();
  col.choice(
    {
      id,
      origin: cardOrigin,
      kind: 'feature',
      label: `Level ${parent.level}: ${parent.name}`,
      count: pick.count,
      options: [...byId].map(([optionId, b]) => {
        const single = b.entries === undefined && b.targets.length === 1 ? b.targets[0] : undefined;
        const entries =
          single !== undefined
            ? single.entity.entries
            : expandRefs(b.entries, new Map(b.targets.map((t) => [t.raw, t.entity])));
        return {
          id: optionId,
          label: b.name,
          description: summarizeEntries(entries),
          entries,
        };
      }),
    },
    (selected) => {
      ledger.picked.set(`${choicePrefix}|${parent.name.toLowerCase()}`, selected);
      take(selected, (optionId) => `${id}:${optionId}`);
    },
  );
}

function findSubclassFeature(
  col: Collector,
  ref: ClassFeatureRef & { shortName: string; shortSource: string },
): DataEntity | undefined {
  return col.ctx
    .byType('subclassFeature')
    .find(
      (f) =>
        str(f.name)?.toLowerCase() === ref.name.toLowerCase() &&
        str(f.className)?.toLowerCase() === ref.className.toLowerCase() &&
        str(f.subclassShortName)?.toLowerCase() === ref.shortName.toLowerCase() &&
        str(f.subclassSource)?.toLowerCase() === ref.shortSource.toLowerCase() &&
        f.level === ref.level,
    );
}

/** ASI feature at a class level -> asiOrFeat prompt (+ follow-up prompts). */
function handleAsi(col: Collector, origin: EffectOrigin, classUid: string, level: number): void {
  const baseId = `class:${classUid}:asi:${level}`;
  col.choice(
    {
      id: baseId,
      origin,
      kind: 'asiOrFeat',
      label: `Level ${level}: Ability Score Improvement or Feat`,
      count: 1,
      options: [
        { id: 'asi', label: 'Ability Score Improvement' },
        { id: 'feat', label: 'Feat' },
      ],
    },
    (selected) => {
      if (selected[0] === 'asi') {
        col.choice(
          {
            id: `${baseId}:abilities`,
            origin,
            kind: 'ability',
            label: `Level ${level}: +1 to two abilities (pick the same twice for +2)`,
            count: 2,
            allowRepeat: true,
            options: ABILITIES.map((a) => ({ id: a, label: a.toUpperCase() })),
          },
          (picked) => {
            for (const a of picked) {
              if ((ABILITIES as string[]).includes(a)) {
                col.add({ kind: 'abilityBonus', ability: a as Ability, amount: 1, origin });
              }
            }
          },
        );
      } else if (selected[0] === 'feat') {
        // Feats picked at other ASI levels — a non-repeatable feat shouldn't be
        // offered again (it would be deduped on collection anyway). The current
        // prompt's own pick is excluded so it still reads as selected.
        const takenElsewhere = new Set<string>();
        for (const [key, val] of Object.entries(col.doc.choices)) {
          if (key === `${baseId}:feat` || !key.endsWith(':feat')) continue;
          for (const v of Array.isArray(val) ? val : [val]) {
            if (typeof v === 'string') takenElsewhere.add(v.toLowerCase());
          }
        }
        const prereqCtx = buildPrereqContext(col);
        col.choice(
          {
            id: `${baseId}:feat`,
            origin,
            kind: 'feat',
            label: `Level ${level}: choose a feat`,
            count: 1,
            options: col.ctx
              .byType('feat')
              .filter((f) => str(f.name) !== undefined)
              .map((f) => {
                const optId = `${str(f.name)}|${str(f.source)}`.toLowerCase();
                const alreadyTaken = f.repeatable !== true && takenElsewhere.has(optId);
                return featChoiceOption(f, prereqCtx, { taken: alreadyTaken });
              }),
          },
          (picked) => {
            const uid = picked[0];
            if (uid === undefined) return;
            const [name, source] = uid.split('|');
            const feat = name !== undefined ? col.ctx.get('feat', name, source) : undefined;
            if (feat === undefined) {
              col.warn(`Chosen feat not found: ${uid}`);
              return;
            }
            collectFeatEntity(col, feat, uid, `asi${level}`);
          },
        );
      }
    },
  );
}

function handleOptionalFeatureProgression(
  col: Collector,
  cls: DataEntity,
  origin: EffectOrigin,
  classUid: string,
  classLevel: number,
): void {
  for (const prog of asEntityArray(cls.optionalfeatureProgression)) {
    const name = str(prog.name) ?? 'Optional feature';
    const featureTypes = Array.isArray(prog.featureType) ? prog.featureType.map(String) : [];
    // progression: {"1": 1, "10": 2} or an array indexed by level-1
    let count = 0;
    const progression = prog.progression;
    if (Array.isArray(progression)) {
      for (let lvl = 0; lvl < Math.min(classLevel, progression.length); lvl++) {
        const v = progression[lvl];
        if (typeof v === 'number') count = Math.max(count, v);
      }
    } else if (typeof progression === 'object' && progression !== null) {
      for (const [lvlStr, v] of Object.entries(progression)) {
        const lvl = Number.parseInt(lvlStr, 10);
        if (!Number.isNaN(lvl) && lvl <= classLevel && typeof v === 'number') {
          count = Math.max(count, v);
        }
      }
    }
    if (count === 0) continue;

    const prereqCtx = buildPrereqContext(col);
    const options = col.ctx
      .byType('optionalfeature')
      .filter((of) => {
        const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
        return types.some((t) => featureTypes.includes(t));
      })
      .map((of) => {
        const prereq = summarizePrerequisite(of.prerequisite);
        const summary = summarizeEntries(of.entries);
        // Level is deterministic from this class entry, so disable options the
        // character can't take yet. Other gates (ability/race/feat/proficiency/
        // spellcasting) are advisory: flag them but keep the option selectable.
        const need = requiredLevel(of.prerequisite);
        const disabled =
          need !== undefined && classLevel < need
            ? { reason: `Requires level ${need}` }
            : undefined;
        const unmet =
          disabled === undefined && prereq !== '' && !meetsPrerequisite(of.prerequisite, prereqCtx);
        return {
          id: `${str(of.name)}|${str(of.source)}`.toLowerCase(),
          label: `${str(of.name)} (${str(of.source)})`,
          description: prereq !== '' ? `Prereq: ${prereq}. ${summary}` : summary,
          ...(disabled !== undefined
            ? { disabled }
            : unmet
              ? { advisory: 'You may not meet this prerequisite.' }
              : {}),
        };
      });

    col.choice(
      {
        id: `class:${classUid}:optfeature:${featureTypes.join('+')}`,
        origin,
        kind: 'optionalfeature',
        label: name,
        count,
        options,
      },
      (selected) => {
        for (const uid of selected) {
          const [ofName, ofSource] = uid.split('|');
          const of =
            ofName !== undefined ? col.ctx.get('optionalfeature', ofName, ofSource) : undefined;
          if (of === undefined) {
            col.warn(`Optional feature not found: ${uid}`);
            continue;
          }
          const ofOrigin: EffectOrigin = {
            label: `${name}: ${str(of.name) ?? uid}`,
            uid,
            type: 'class',
          };
          col.features.push({ name: ofOrigin.label, origin: ofOrigin, entries: of.entries });
          if (!emitCurated(col, uid, ofOrigin)) {
            proseScanFeature(col, str(of.name) ?? uid, of.entries, ofOrigin);
          }
        }
      },
    );
  }
}

/**
 * The id of the pick a class waits on until its subclass is chosen. It has no
 * options of its own: the subclass picker beside the class answers it.
 */
export function subclassPromptId(classUid: string): string {
  return `class:${classUid}:subclass`;
}

export function collectClasses(col: Collector): void {
  const doc = col.doc;
  doc.classes.forEach((entry, classIndex) => {
    const cls = col.ctx.get('class', entry.ref.name, entry.ref.source);
    if (cls === undefined) {
      col.warn(`Class not found: ${refUid(entry.ref)}`);
      return;
    }
    const classUid = refUid(entry.ref);
    const origin: EffectOrigin = {
      label: str(cls.name) ?? entry.ref.name,
      uid: classUid,
      type: 'class',
    };
    const isFirstClass = classIndex === 0;
    const classLevel = entry.levels;

    // First class: saving throws + full starting proficiencies.
    // Later classes: the reduced `multiclassing.proficienciesGained` list.
    if (isFirstClass) {
      const saves = Array.isArray(cls.proficiency) ? cls.proficiency.map(String) : [];
      for (const save of saves) {
        if ((ABILITIES as string[]).includes(save)) {
          col.add({ kind: 'saveProf', ability: save as Ability, origin });
        }
      }
    }
    const profSource = isFirstClass
      ? ((cls.startingProficiencies ?? {}) as DataEntity)
      : (((cls.multiclassing as DataEntity | undefined)?.proficienciesGained ?? {}) as DataEntity);
    {
      // These lists tag their names ("{@item longsword|phb|longswords}"). The
      // sheet shows what is stored here and attacks match weapons against it,
      // so it is kept as the words, not the markup.
      const sp = profSource;
      for (const armor of Array.isArray(sp.armor) ? sp.armor : []) {
        const label =
          typeof armor === 'string'
            ? armor
            : (str((armor as DataEntity).proficiency) ?? JSON.stringify(armor));
        col.add({ kind: 'armorProf', name: plainEntryText(label), origin });
      }
      for (const weapon of Array.isArray(sp.weapons) ? sp.weapons : []) {
        const label =
          typeof weapon === 'string'
            ? weapon
            : (str((weapon as DataEntity).proficiency) ?? JSON.stringify(weapon));
        col.add({ kind: 'weaponProf', name: plainEntryText(label), origin });
      }
      // A 2024 Monk's or Rogue's list limits martial weapons in a sentence, which
      // the sheet shows as written; this field is what it means to an attack.
      for (const grant of asEntityArray(sp.weaponProficiencies)) {
        const filter = str((grant.all as DataEntity | undefined)?.fromFilter);
        if (filter !== undefined) col.add({ kind: 'weaponProfFilter', filter, origin });
      }
      for (const tool of Array.isArray(sp.tools) ? sp.tools : []) {
        if (typeof tool === 'string') {
          col.add({ kind: 'toolProf', name: plainEntryText(tool), origin });
        }
      }
      readProficiencyList(
        col,
        sp.skills,
        origin,
        `class:${classUid}:skill`,
        'skill',
        'Class skill proficiency',
        (name) => col.add({ kind: 'skillProf', skill: name, level: 1, origin }),
        skillOptions,
      );
    }

    // Class features up to the current level. Every listed ref is claimed up
    // front so a nested ref can't collect a feature this loop will handle.
    const featureRefs = Array.isArray(cls.classFeatures) ? cls.classFeatures : [];
    const ledger: FeatureLedger = { claimed: new Set(), collected: new Set(), picked: new Map() };
    const classWalk: FeatureWalk = {
      col,
      cardOrigin: origin,
      curatedLabel: origin.label,
      classLevel,
      ledger,
    };
    for (const rawRef of featureRefs) {
      const refStr = typeof rawRef === 'string' ? rawRef : str((rawRef as DataEntity).classFeature);
      const ref = refStr !== undefined ? parseClassFeatureRef(refStr) : undefined;
      if (ref !== undefined && ref.level <= classLevel) ledger.claimed.add(classFeatureKey(ref));
    }
    for (const rawRef of featureRefs) {
      const isGainSubclass =
        typeof rawRef === 'object' && rawRef !== null && 'gainSubclassFeature' in rawRef;
      const refStr = typeof rawRef === 'string' ? rawRef : str((rawRef as DataEntity).classFeature);
      if (refStr === undefined) continue;
      const ref = parseClassFeatureRef(refStr);
      if (ref === undefined || ref.level > classLevel) continue;

      if (isGainSubclass && entry.subclass === undefined) {
        col.pending.push({
          id: subclassPromptId(classUid),
          origin,
          kind: 'generic',
          label: `Choose a ${origin.label} subclass (level ${ref.level})`,
          count: 1,
          options: [],
        });
      }

      const feature = findClassFeature(col, ref);
      if (feature === undefined) {
        col.warn(`Class feature not found: ${refStr}`);
        continue;
      }

      if (ref.name.startsWith('Ability Score Improvement')) {
        handleAsi(col, origin, classUid, ref.level);
      }
      // Rogue/Bard "Expertise" is prose-only in the data — emit the choice.
      if (ref.name === 'Expertise') {
        const featOrigin: EffectOrigin = { ...origin, label: `${origin.label} Expertise` };
        col.choice(
          {
            id: `class:${classUid}:expertise:${ref.level}`,
            origin: featOrigin,
            kind: 'expertise',
            label: `Expertise — 2 proficient skills (level ${ref.level})`,
            count: 2,
            options: expertiseOptions(col),
          },
          (selected) => {
            for (const s of selected) {
              col.add({ kind: 'skillProf', skill: s, level: 2, origin: featOrigin });
            }
          },
        );
      }
      collectFeatureWithNested(
        classWalk,
        feature,
        ref.name,
        ref.level,
        classFeatureKey(ref),
        `class:${classUid}`,
      );
    }

    // Subclass features
    if (entry.subclass !== undefined) {
      const sub = col.ctx.get('subclass', entry.subclass.name, entry.subclass.source);
      if (sub === undefined) {
        col.warn(`Subclass not found: ${refUid(entry.subclass)}`);
      } else {
        const subOrigin: EffectOrigin = {
          label: str(sub.name) ?? entry.subclass.name,
          uid: refUid(entry.subclass),
          type: 'subclass',
        };
        // Domain / oath / circle "always prepared" spells live on the subclass
        // entity (not its features). Default their casting ability to the class's.
        const subAbility = str(cls.spellcastingAbility);
        collectAdditionalSpells(
          col,
          sub.additionalSpells,
          subOrigin,
          subAbility !== undefined && (ABILITIES as readonly string[]).includes(subAbility)
            ? (subAbility as Ability)
            : undefined,
          `subclass:${subOrigin.uid}`,
        );
        const subWalk: FeatureWalk = {
          ...classWalk,
          cardOrigin: subOrigin,
          curatedLabel: subOrigin.label,
        };
        const subRefs = Array.isArray(sub.subclassFeatures) ? sub.subclassFeatures : [];
        for (const rawRef of subRefs) {
          if (typeof rawRef !== 'string') continue;
          const ref = parseSubclassFeatureRef(rawRef);
          if (ref !== undefined && ref.level <= classLevel) {
            ledger.claimed.add(subclassFeatureKey(ref));
          }
        }
        for (const rawRef of subRefs) {
          if (typeof rawRef !== 'string') continue;
          const ref = parseSubclassFeatureRef(rawRef);
          if (ref === undefined || ref.level > classLevel) continue;
          const feature = findSubclassFeature(col, ref);
          if (feature === undefined) {
            col.warn(`Subclass feature not found: ${rawRef}`);
            continue;
          }
          collectFeatureWithNested(
            subWalk,
            feature,
            ref.name,
            ref.level,
            subclassFeatureKey(ref),
            `subclass:${subOrigin.uid}`,
          );
        }
      }
    }

    handleOptionalFeatureProgression(col, cls, origin, classUid, classLevel);
    emitCurated(col, `class:${classUid}`, origin);
  });
}
