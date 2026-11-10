import { plainEntryText } from '../../data5e/entries/plainText';
import { emitCuratedEffects as emitCurated } from '../curated/curatedEffects';
import { linkSpend } from '../curated/spendLinks';
import { emitStandingEffects as emitStanding } from '../curated/standingEffects';
import { summarizeEntries } from '../summarize';
import { ABILITIES, type Ability, type DataEntity, type EffectOrigin, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { asiFeatInstance } from './asiFeatInstance';
import { asEntityArray, type Collector, str } from './base';
import { VariantGate } from './classVariants';
import { collectFeatEntity } from './feat';
import { isRepeatableFeat } from './featPicks';
import { basedOn, mechanicsOf, officialOf } from './mechanics';
import { readOptionalFeatures } from './optionalFeatures';
import { buildPrereqContext, featChoiceOption } from './prerequisites';
import { proseScanFeature } from './proseScan';
import { expertiseOptions, readProficiencyList, skillOptions } from './readers';
import { reskinOf } from './reskin';

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
  /**
   * Other names its curated rows and spend links are found under, tried after
   * `curatedLabel`: the class a reskinned class stands for (`reskinOf`; a
   * Warrior's Second Wind is the Fighter's), on a class's own walk only, and
   * the class or subclass a homebrew copy is `basedOn`.
   */
  curatedAliases: readonly string[];
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
  const { col, cardOrigin, curatedLabel, curatedAliases, ledger } = walk;
  if (ledger.collected.has(key)) return;
  ledger.collected.add(key);
  col.features.push({ name, level, origin: cardOrigin, entries: feature.entries });
  const featureOrigin: EffectOrigin = { ...cardOrigin, label: name };
  const labels = [curatedLabel, ...curatedAliases];
  // The feature's own printing as well as its card's: a reskin or a copied subclass
  // is a book of its own that lends a 2024 class's features. A copy of an official
  // feature (`officialOf`: its `basedOn`, or a converted file's `printingOf`) is
  // that feature as printed, under its name and book.
  const printed = officialOf(feature);
  const printing = (printed?.source ?? String(feature.source)).toLowerCase();
  const names = printed !== undefined && printed.name !== name ? [name, printed.name] : [name];
  const sources =
    printed !== undefined ? [String(feature.source), printed.source] : [String(feature.source)];
  mechanicsOf(col, {
    entry: feature,
    label: name,
    origin: featureOrigin,
    target: `${name}|${curatedLabel}`,
    classLevel: walk.classLevel,
    inherited: () => {
      const curated = names.some((n) =>
        labels.some((label) =>
          emitCurated(col, `${n}|${label}`.toLowerCase(), featureOrigin, printing),
        ),
      );
      if (!curated) proseScanFeature(col, name, feature.entries, featureOrigin, cardOrigin.label);
      names.some((n) =>
        labels.some((label) =>
          emitStanding(col, `${n}|${label}`.toLowerCase(), featureOrigin, printing, level),
        ),
      );
      names.some((n) =>
        labels.some((label) =>
          sources.some((source) => linkSpend(col, `${n}|${label}|${source}`, name, featureOrigin)),
        ),
      );
    },
  });
  const identity = featureIdentity(feature);
  const { refs, picks } = PICK_ONE.has(identity)
    ? { refs: [], picks: [{ count: 1, branches: featureBranches(feature.entries) }] }
    : nestedFeatureRefs(feature.entries);
  // The refs are siblings: an optional feature among them (Primal Companion
  // beside Ranger's Companion) is a pick. A ref the class's or subclass's own
  // list holds is that list's to pair, so it is left out here.
  const nested = refs.flatMap((r) => {
    const target = parseNested(r);
    if (target === undefined || target.level > walk.classLevel) return [];
    if (ledger.claimed.has(target.key) || ledger.collected.has(target.key)) return [];
    const entity = target.find(col);
    return entity === undefined ? [] : [{ target, sibling: { ...target, entity } }];
  });
  const gate = new VariantGate(
    col,
    cardOrigin,
    nested.map((n) => n.sibling),
    choicePrefix,
  );
  for (const { target, sibling } of nested) {
    if (ledger.claimed.has(target.key) || ledger.collected.has(target.key)) continue;
    if (!gate.allows(sibling)) {
      ledger.claimed.add(target.key);
      continue;
    }
    collectNested(walk, target, sibling.entity, gate.choicePrefixFor(sibling, choicePrefix));
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
                const alreadyTaken = !isRepeatableFeat(f) && takenElsewhere.has(optId);
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
            collectFeatEntity(col, feat, uid, asiFeatInstance(col.doc, classUid, level, uid));
          },
        );
      }
    },
  );
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
    const reskin = reskinOf(cls);
    const classBasedOn = basedOn(cls);
    const classWalk: FeatureWalk = {
      col,
      cardOrigin: origin,
      curatedLabel: origin.label,
      curatedAliases: [reskin?.name, classBasedOn?.name].filter((n) => n !== undefined),
      classLevel,
      ledger,
    };
    for (const rawRef of featureRefs) {
      const refStr = typeof rawRef === 'string' ? rawRef : str((rawRef as DataEntity).classFeature);
      const ref = refStr !== undefined ? parseClassFeatureRef(refStr) : undefined;
      if (ref !== undefined && ref.level <= classLevel) ledger.claimed.add(classFeatureKey(ref));
    }
    const rows = featureRefs.flatMap((rawRef) => {
      const refStr = typeof rawRef === 'string' ? rawRef : str((rawRef as DataEntity).classFeature);
      const ref = refStr !== undefined ? parseClassFeatureRef(refStr) : undefined;
      if (refStr === undefined || ref === undefined || ref.level > classLevel) return [];
      const isGainSubclass =
        typeof rawRef === 'object' && rawRef !== null && 'gainSubclassFeature' in rawRef;
      const entity = findClassFeature(col, ref);
      const sibling =
        entity === undefined
          ? undefined
          : { key: classFeatureKey(ref), name: ref.name, level: ref.level, entity };
      return [{ refStr, ref, isGainSubclass, sibling }];
    });
    // An optional feature in the list (Favored Foe beside Favored Enemy) is a pick.
    const classGate = new VariantGate(
      col,
      origin,
      rows.flatMap((r) => r.sibling ?? []),
      `class:${classUid}`,
    );
    // Expertise levels, asked for once the subclass is collected (see below).
    const expertiseAt: number[] = [];
    for (const { refStr, ref, isGainSubclass, sibling } of rows) {
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

      if (sibling === undefined) {
        col.warn(`Class feature not found: ${refStr}`);
        continue;
      }
      if (!classGate.allows(sibling)) continue;

      if (ref.name.startsWith('Ability Score Improvement')) {
        handleAsi(col, origin, classUid, ref.level);
      }
      if (ref.name === 'Expertise') expertiseAt.push(ref.level);
      collectFeatureWithNested(
        classWalk,
        sibling.entity,
        ref.name,
        ref.level,
        sibling.key,
        classGate.choicePrefixFor(sibling, `class:${classUid}`),
      );
    }

    // A spell a class or subclass gives casts with the class's ability by default.
    const classAbility = str(cls.spellcastingAbility);
    const spellAbility =
      classAbility !== undefined && (ABILITIES as readonly string[]).includes(classAbility)
        ? (classAbility as Ability)
        : undefined;

    // The class's own spells: those it always has prepared (a 2024 Ranger's
    // Hunter's Mark) and those it chooses (a 2014 Bard's Magical Secrets).
    collectAdditionalSpells(
      col,
      cls.additionalSpells,
      origin,
      spellAbility,
      `class:${classUid}`,
      classLevel,
    );

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
        // entity (not its features).
        collectAdditionalSpells(
          col,
          sub.additionalSpells,
          subOrigin,
          spellAbility,
          `subclass:${subOrigin.uid}`,
          classLevel,
        );
        // A subclass keeps its own name under a reskin (a Warrior's Champion), so
        // its rows are found by that, and by the subclass a homebrew copy is
        // `basedOn`, whose kept features keep their curated rows.
        const subBasedOn = basedOn(sub);
        const subWalk: FeatureWalk = {
          ...classWalk,
          cardOrigin: subOrigin,
          curatedLabel: subOrigin.label,
          curatedAliases: subBasedOn !== undefined ? [subBasedOn.name] : [],
        };
        // A subclass's own mechanics, beside its features'.
        mechanicsOf(col, {
          entry: sub,
          label: subOrigin.label,
          origin: subOrigin,
          target: subOrigin.uid,
          classLevel,
        });
        const subRefs = Array.isArray(sub.subclassFeatures) ? sub.subclassFeatures : [];
        for (const rawRef of subRefs) {
          if (typeof rawRef !== 'string') continue;
          const ref = parseSubclassFeatureRef(rawRef);
          if (ref !== undefined && ref.level <= classLevel) {
            ledger.claimed.add(subclassFeatureKey(ref));
          }
        }
        const subRows = subRefs.flatMap((rawRef) => {
          const ref = typeof rawRef === 'string' ? parseSubclassFeatureRef(rawRef) : undefined;
          if (ref === undefined || ref.level > classLevel) return [];
          const entity = findSubclassFeature(col, ref);
          const sibling =
            entity === undefined
              ? undefined
              : { key: subclassFeatureKey(ref), name: ref.name, level: ref.level, entity };
          return [{ rawRef: String(rawRef), ref, sibling }];
        });
        // Blessed Strikes beside a 2014 domain's Divine Strike is a pick.
        const subGate = new VariantGate(
          col,
          subOrigin,
          subRows.flatMap((r) => r.sibling ?? []),
          `subclass:${subOrigin.uid}`,
        );
        for (const { rawRef, ref, sibling } of subRows) {
          if (sibling === undefined) {
            col.warn(`Subclass feature not found: ${rawRef}`);
            continue;
          }
          if (!subGate.allows(sibling)) continue;
          collectFeatureWithNested(
            subWalk,
            sibling.entity,
            ref.name,
            ref.level,
            sibling.key,
            subGate.choicePrefixFor(sibling, `subclass:${subOrigin.uid}`),
          );
        }
        // A Battle Master's maneuvers, a Four Elements monk's disciplines, a
        // Champion's second style, which cannot repeat the class's first.
        readOptionalFeatures(col, sub, {
          idBase: `subclass:${subOrigin.uid}`,
          origin: subOrigin,
          level: classLevel,
          distinct: true,
          spellAbility,
        });
      }
    }

    readOptionalFeatures(col, cls, {
      idBase: `class:${classUid}`,
      origin,
      level: classLevel,
      spellAbility,
    });

    // Rogue/Bard "Expertise" is prose-only in the data, so emit the choice. It
    // comes after the subclass, so it can take a skill the subclass grants (a
    // College of Lore bard's three). It also sees skills from the class's later
    // levels, such as a feat taken at an ability score improvement.
    for (const level of expertiseAt) {
      const featOrigin: EffectOrigin = { ...origin, label: `${origin.label} Expertise` };
      col.choice(
        {
          id: `class:${classUid}:expertise:${level}`,
          origin: featOrigin,
          kind: 'expertise',
          label: `Expertise: 2 proficient skills (level ${level})`,
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
    // The class's own row, or the row of the class a homebrew copy is `basedOn`.
    const rowKeys = classBasedOn !== undefined ? [classUid, refUid(classBasedOn)] : [classUid];
    mechanicsOf(col, {
      entry: cls,
      label: origin.label,
      origin,
      target: classUid,
      classLevel,
      inherited: () => {
        rowKeys.some((k) => emitCurated(col, `class:${k}`, origin));
      },
    });
  });
}
