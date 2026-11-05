/**
 * 2014/2024 reprint pairs, classified as groundwork for GAME-003. A pair is one
 * `reprintedAs` link from a 2014-rules printing to a 2024-rules printing. It is
 * read twice, and `labelReprint` joins the two readings into one label:
 *
 *   - structured fields (a spell's school, a weapon's damage) are diffed here,
 *     because they are facts in the data and need no judge;
 *   - prose goes to Jev as yes/no questions (`bun run data:judge -- --set
 *     reprint`), and only when code cannot settle it: prose that reads the same
 *     costs nothing to compare.
 *
 * Three things the links do not say on their own, measured against v2.39.1:
 *
 *   - Not every link crosses editions. `Aarakocra|EEPC` points at
 *     `Aarakocra|MPMM`, a 2014-rules book, and calling that a "2024 printing"
 *     would be false. Those links are counted and left out.
 *   - Subclass links exist too, in the four-segment uid form, but a subclass's
 *     own `entries` are empty and its rules live in its features, so comparing
 *     them is a larger job left for its own step. Subraces are left out because
 *     their target is the whole 2024 race, not a printing of the subrace.
 *   - A class's own `entries` are empty as well, so its text here is its
 *     features' text. Reading only `entries` would call every class unchanged.
 *
 * Nothing here reaches the app. The audit reports counts; whether a file of
 * labels should ship is an open question for the owner (LEGAL-001).
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import type { Entity } from '../copyMod';
import { plainEntryText } from '../entries/plainText';
import { ENTITY_TYPES, type EntityRegistry, type EntityType } from '../normalize';
import { editionOf, reprintTargets } from '../rulesVersion';
import { answersFor, type JudgeSet, type JudgeSubject, type JudgmentFile } from './judgments';
import { CONFIDENT_NO, CONFIDENT_YES } from './proseChecks';
import { readableEntries, textHash } from './proseSubjects';

export const REPRINT_TYPES = [
  'item',
  'spell',
  'baseitem',
  'race',
  'optionalfeature',
  'feat',
  'condition',
  'background',
  'class',
] as const satisfies readonly EntityType[];

export type ReprintType = (typeof REPRINT_TYPES)[number];

/**
 * - `same`: nothing differs, settled in code.
 * - `wording`: the prose differs, and Jev is confident only the wording does.
 * - `changed`: a structured field differs, or Jev is confident a mechanic does.
 * - `different`: Jev is confident it is a different feature.
 * - `uncertain`: below the confidence thresholds, contradictory, or not judged.
 */
export type ReprintLabel = 'same' | 'wording' | 'changed' | 'different' | 'uncertain';

export const REPRINT_LABELS: readonly ReprintLabel[] = [
  'same',
  'wording',
  'changed',
  'different',
  'uncertain',
];

/** Each question names the printings the way the subject's state labels them. */
export const REPRINT_SET: JudgeSet = {
  id: 'reprint',
  version: 1,
  questions: [
    {
      id: 'sameRules',
      instructions:
        'Do the 2014 printing and the 2024 printing describe the same rules, so that a character using either one could do the same things with the same results?',
    },
    {
      id: 'wordingOnly',
      instructions:
        'Are the differences between the 2014 printing and the 2024 printing only wording, with the same mechanics?',
    },
    {
      id: 'changesNumber',
      instructions:
        'Does the 2024 printing change a number from the 2014 printing, such as damage, range, duration or number of uses?',
    },
    {
      id: 'differentFeature',
      instructions:
        'Is the 2024 printing really a different feature from the 2014 printing, rather than a revised version of the same one?',
    },
  ],
};

/**
 * Tagged text as a rules reader needs it. `plainEntryText` shows a tag by its
 * display text, but keeps a scaling tag's base roll where the page shows its
 * per-step add (`{@scaledamage 8d6|3-9|1d6}` reads as "1d6"), and a bare number
 * for a DC. A comparison of rules turns on exactly those numbers.
 */
function rulesText(text: string): string {
  return plainEntryText(
    text
      .replaceAll(/\{@scale(?:damage|dice) [^|}]*\|[^|}]*\|([^|}]*)[^}]*\}/g, '$1')
      .replaceAll(/\{@dc (\d+)[^}]*\}/g, 'DC $1'),
  );
}

// ---------------------------------------------------------------------------
// Structured fields
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
const records = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter(isRecord) : [];

type Fields = Readonly<Record<string, (e: Entity) => unknown>>;

const plain = (...names: string[]): Fields =>
  Object.fromEntries(names.map((name) => [name, (e: Entity) => e[name]]));

/**
 * 2024 data calls a shape around the caster an Emanation where 2014 data says a
 * radius, a sphere, a hemisphere or plain Self (Detect Magic). All of those are
 * a range of Self. How far the shape reaches is in the prose on both sides, and
 * Jev reads that.
 */
const AREA_AROUND_CASTER = new Set(['radius', 'sphere', 'hemisphere', 'emanation']);
const SELF = { type: 'point', distance: { type: 'self' } };

const SPELL_FIELDS: Fields = {
  level: (e) => e.level,
  school: (e) => e.school,
  // A reaction's trigger is wording, so it goes to Jev with the prose.
  castingTime: (e) => records(e.time).map(({ number, unit }) => ({ number, unit })),
  range: (e) => {
    const range = rec(e.range);
    return AREA_AROUND_CASTER.has(String(range.type)) ? SELF : range;
  },
  // Whether a material is needed, and what it costs. Its description is wording.
  components: (e) => {
    const { v, s, r, m } = rec(e.components);
    const { cost, consume } = rec(m);
    return { v: v === true, s: s === true, r: r === true, m: Boolean(m), cost, consume };
  },
  duration: (e) => records(e.duration).map(({ concentration: _, ...rest }) => rest),
  concentration: (e) => records(e.duration).some((d) => d.concentration === true),
  ritual: (e) => rec(e.meta).ritual === true,
};

/**
 * Fields the data encodes the same way on both sides and the prose does not
 * repeat. Charges and recharge are left out on purpose: most 2014 items state
 * them only in prose, so a missing field there says nothing, and Jev reads it.
 */
const ITEM_FIELDS = plain(
  'rarity',
  'reqAttune',
  'weight',
  'value',
  'ac',
  'strength',
  'stealth',
  'dmg1',
  'dmg2',
  'dmgType',
  'type',
  'weaponCategory',
  'range',
  'property',
  'mastery',
  'bonusWeapon',
  'bonusAc',
  'speed',
  'carryingCapacity',
);

/** The structured lists. `armor` and `tools` beside them can be sentences. */
const STARTING_PROFICIENCIES: Fields = Object.fromEntries(
  ['skills', 'armorProficiencies', 'weapons', 'weaponProficiencies', 'toolProficiencies'].map(
    (key) => [key, (e: Entity) => rec(e.startingProficiencies)[key]],
  ),
);

const STRUCTURED_FIELDS: Readonly<Record<ReprintType, Fields>> = {
  spell: SPELL_FIELDS,
  item: ITEM_FIELDS,
  baseitem: ITEM_FIELDS,
  race: plain('size', 'speed', 'ability', 'darkvision', 'resist'),
  feat: plain('prerequisite', 'repeatable'),
  optionalfeature: plain('prerequisite', 'consumes'),
  background: plain(
    'ability',
    'feats',
    'skillProficiencies',
    'toolProficiencies',
    'languageProficiencies',
  ),
  class: {
    ...plain('hd', 'proficiency', 'spellcastingAbility', 'casterProgression'),
    ...STARTING_PROFICIENCIES,
  },
  condition: {},
};

/**
 * Fields compare only within one schema. A 2014 fighting style has no
 * `prerequisite` because being one implied it, and the feat it became states it,
 * which is the same rule. Items and base items share a schema.
 */
const sameSchema = (type: ReprintType, target: EntityType) =>
  STRUCTURED_FIELDS[type] === (STRUCTURED_FIELDS as Partial<Record<EntityType, Fields>>)[target];

/** The `|XPHB` the 2024 data adds to values like `property: ["V|XPHB"]`. */
const SOURCE_SUFFIX = /\|[a-z0-9-]+$/i;

/**
 * Keys that differ between the printings without saying anything about the rules:
 * how a prerequisite cites its class, and `upTo`, which 2024 data drops from
 * durations whose words did not change (Thaumaturgy is "up to 1 minute" in both).
 */
const NOISE_KEYS = new Set(['source', 'visibleStats', 'upTo']);

/**
 * Printed on one side only, these say nothing: the DMG gives most magic items no
 * weight and the 2024 book does, so a blank is not a change. The same goes for an
 * item's type, which either side can leave to the base item it inherits from.
 * Printed on both, a difference is a real one.
 */
const COMPARED_ONLY_IF_BOTH_PRINT = new Set(['weight', 'value', 'type']);

/** A form two printings of one value both reduce to, whatever their encoding. */
function canonical(value: unknown): unknown {
  if (typeof value === 'string') {
    return plainEntryText(value)
      .replace(SOURCE_SUFFIX, '')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NOISE_KEYS.has(key))
        .map(([key, item]) => [String(canonical(key)), canonical(item)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  }
  return value;
}

/** The structured fields that differ between two printings, by name. */
export function changedFields(type: ReprintType, from: Entity, to: Entity): string[] {
  return Object.entries(STRUCTURED_FIELDS[type])
    .filter(([name, read]) => {
      const before = read(from);
      const after = read(to);
      if (COMPARED_ONLY_IF_BOTH_PRINT.has(name) && (before === undefined || after === undefined)) {
        return false;
      }
      return JSON.stringify(canonical(before)) !== JSON.stringify(canonical(after));
    })
    .map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

const readable = (entries: unknown) =>
  readableEntries(entries, { tables: true, tagText: rulesText });

/**
 * Everything a printing says in words: its entries, how a spell scales, and the
 * wording that lives in a spell's structured fields.
 */
function printingText(e: Entity): string {
  const material = rec(e.components).m;
  const materialText = typeof material === 'string' ? material : rec(material).text;
  return [
    ...records(e.time).map((t) =>
      typeof t.condition === 'string' ? `Casting trigger: ${rulesText(t.condition)}` : '',
    ),
    typeof materialText === 'string' ? `Material component: ${rulesText(materialText)}` : '',
    readable(e.entries),
    readable(e.entriesHigherLevel),
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** A class's rules, in level order, from its features. */
function classText(features: readonly Entity[]): string {
  return readable(
    [...features]
      .sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0))
      .map((f) => ({ name: `Level ${String(f.level)}: ${String(f.name)}`, entries: f.entries })),
  );
}

/**
 * - `identical`: both printings read the same, or are an item with no text on
 *   either side, where fields are all it has;
 * - `differs`: the words differ, so it takes a reader;
 * - `unreadable`: text is missing where a comparison needs it. A 2014 suit of
 *   armor with a paragraph and its 2024 printing with none cannot be compared.
 */
export type ProseComparison = 'identical' | 'differs' | 'unreadable';

const MAY_HAVE_NO_TEXT = new Set<ReprintType>(['item', 'baseitem']);

const comparable = (text: string) => text.replaceAll(/\s+/g, ' ').trim().toLowerCase();

function compareProse(type: ReprintType, from: string, to: string): ProseComparison {
  const a = comparable(from);
  const b = comparable(to);
  if (a === '' && b === '') return MAY_HAVE_NO_TEXT.has(type) ? 'identical' : 'unreadable';
  if (a === '' || b === '') return 'unreadable';
  return a === b ? 'identical' : 'differs';
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

/** The subject fields are for Jev; only pairs whose prose `differs` are asked about. */
export interface ReprintPair extends JudgeSubject {
  /** The type holding the link. A target can be of another (`Archery` is now a feat). */
  type: ReprintType;
  /** `name|source`, lowercased, as the registry keys them. */
  from: string;
  to: string;
  changedFields: string[];
  prose: ProseComparison;
}

export interface FoundReprints {
  pairs: ReprintPair[];
  skipped: {
    /** Links between two printings of the same rules edition. */
    notAcrossEditions: number;
    /**
     * Links the registry cannot look up by name and source. On v2.39.1 all 13 are
     * magic variants, which keep their source under `inherits`.
     */
    targetNotFound: number;
  };
}

type Registry = Pick<EntityRegistry, 'byType' | 'get'>;

const uid = (e: Entity) => `${String(e.name)}|${String(e.source)}`.toLowerCase();

/**
 * Books with anything marked `edition: "one"`. `editionOf` reads an unmarked
 * entity as 2014 unless its source is a core 2024 book, but 5etools marks only
 * part of a later 2024-rules book: 26 of FRHoF's entities and not its other 80.
 * No book in v2.39.1 carries both `one` and `classic`, so one mark speaks for
 * the book's unmarked entities. An entity's own mark always wins.
 */
function sources2024(registry: Registry): Set<string> {
  const out = new Set<string>();
  for (const type of ENTITY_TYPES) {
    for (const e of registry.byType(type)) {
      if (e.edition === 'one' && typeof e.source === 'string') out.add(e.source);
    }
  }
  return out;
}

/** Every link from a 2014-rules printing to a 2024-rules one, in registry order. */
export function reprintPairs(registry: Registry): FoundReprints {
  const books2024 = sources2024(registry);
  const rules2024 = (e: Entity) =>
    editionOf(e) === '2024' || (e.edition !== 'classic' && books2024.has(String(e.source)));

  const featuresByClass = new Map<string, Entity[]>();
  for (const f of registry.byType('classFeature')) {
    const owner = `${String(f.className)}|${String(f.classSource)}`.toLowerCase();
    featuresByClass.set(owner, [...(featuresByClass.get(owner) ?? []), f]);
  }

  const found: FoundReprints = { pairs: [], skipped: { notAcrossEditions: 0, targetNotFound: 0 } };
  for (const type of REPRINT_TYPES) {
    const textOf = (e: Entity) =>
      type === 'class' ? classText(featuresByClass.get(uid(e)) ?? []) : printingText(e);
    for (const from of registry.byType(type)) {
      for (const ref of reprintTargets(from, type)) {
        const targetType = ref.type ?? type;
        const to = registry.get(targetType, ref.name, ref.source);
        if (to === undefined) {
          found.skipped.targetNotFound++;
          continue;
        }
        if (rules2024(from) || !rules2024(to)) {
          found.skipped.notAcrossEditions++;
          continue;
        }
        const before = textOf(from);
        const after = textOf(to);
        const state = `2014 printing: ${String(from.name)}\n${before}\n\n2024 printing: ${String(to.name)}\n${after}`;
        found.pairs.push({
          key: textHash(state),
          label: `${type} ${String(from.name)}|${String(from.source)} -> ${String(to.name)}|${String(to.source)}`,
          state,
          type,
          from: uid(from),
          to: uid(to),
          changedFields: sameSchema(type, targetType) ? changedFields(type, from, to) : [],
          prose: compareProse(type, before, after),
        });
      }
    }
  }
  return found;
}

/** What Jev is asked about: each distinct comparison code could not settle, once. */
export function reprintSubjects(pairs: readonly ReprintPair[]): JudgeSubject[] {
  const byKey = new Map<string, JudgeSubject>();
  for (const { key, label, state, prose } of pairs) {
    if (prose === 'differs' && !byKey.has(key)) byKey.set(key, { key, label, state });
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * One pair's label, from its structured diff and its saved answers (undefined
 * when it has none). Pure, so the same reading can serve the audit now and a
 * shipped file later.
 *
 * A changed field is a fact, and Jev never sees those fields, so its "only
 * wording" cannot outrank one: the most it can do is raise the pair to
 * `different`. Answers that contradict each other are read as no answer at all.
 */
export function labelReprint(
  pair: { changedFields: readonly string[]; prose: ProseComparison },
  answers: Readonly<Record<string, number>> | undefined,
): ReprintLabel {
  const fieldsChanged = pair.changedFields.length > 0;
  if (pair.prose === 'identical') return fieldsChanged ? 'changed' : 'same';

  const withoutProse: ReprintLabel = fieldsChanged ? 'changed' : 'uncertain';
  if (pair.prose === 'unreadable' || answers === undefined) return withoutProse;

  const yes = (id: string) => (answers[id] ?? 0.5) >= CONFIDENT_YES;
  const no = (id: string) => (answers[id] ?? 0.5) <= CONFIDENT_NO;

  const saysMatch = yes('sameRules') || yes('wordingOnly');
  const saysDiffers = no('sameRules') || yes('changesNumber') || yes('differentFeature');
  if (saysMatch && saysDiffers) return withoutProse;

  if (yes('differentFeature')) return 'different';
  if (saysDiffers) return 'changed';
  // "Not only wording" alone is not "changed": added flavor is not only wording.
  const wordingOnly =
    yes('sameRules') && yes('wordingOnly') && no('changesNumber') && no('differentFeature');
  if (wordingOnly && !fieldsChanged) return 'wording';
  return withoutProse;
}

// ---------------------------------------------------------------------------
// The audit's counts
// ---------------------------------------------------------------------------

export interface ReprintAudit {
  pairs: number;
  byType: Record<string, number>;
  /** Every pair has exactly one, so these add up to `pairs`. */
  labels: Record<ReprintLabel, number>;
  /** Pairs per structured field that differs, e.g. `mastery`. */
  changedFields: Record<string, number>;
  /** Distinct prose comparisons code could not settle, and how many have answers. */
  toJudge: number;
  judged: number;
  /** Of `labels.uncertain` and any `changed`, the pairs still waiting on Jev. */
  notJudged: number;
  skipped: FoundReprints['skipped'];
}

export function auditReprints(
  found: FoundReprints,
  judgments: JudgmentFile | undefined,
): ReprintAudit {
  const labels = Object.fromEntries(REPRINT_LABELS.map((label) => [label, 0])) as Record<
    ReprintLabel,
    number
  >;
  const byType: Record<string, number> = {};
  const fields: Record<string, number> = {};
  const toJudge = new Set<string>();
  const judged = new Set<string>();
  let notJudged = 0;
  for (const pair of found.pairs) {
    byType[pair.type] = (byType[pair.type] ?? 0) + 1;
    for (const field of pair.changedFields) fields[field] = (fields[field] ?? 0) + 1;
    let answers: Record<string, number> | undefined;
    if (pair.prose === 'differs') {
      toJudge.add(pair.key);
      answers = judgments && answersFor(judgments, REPRINT_SET, pair.key);
      if (answers === undefined) notJudged++;
      else judged.add(pair.key);
    }
    labels[labelReprint(pair, answers)]++;
  }
  return {
    pairs: found.pairs.length,
    byType,
    labels,
    changedFields: fields,
    toJudge: toJudge.size,
    judged: judged.size,
    notJudged,
    skipped: found.skipped,
  };
}

const counted = (counts: Record<string, number>, separator: string) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name}${separator}${n}`)
    .join(separator === '=' ? ' ' : ', ');

/** The counts as lines of text, for the printed report and the CLI. */
export function describeReprints(audit: ReprintAudit): string[] {
  const { labels, skipped } = audit;
  return [
    `${audit.pairs} 2014/2024 pairs: ${counted(audit.byType, ' ')}`,
    `labels: ${REPRINT_LABELS.map((label) => `${label}=${labels[label]}`).join(' ')}; pairs waiting on Jev: ${audit.notJudged}`,
    `prose comparisons for Jev: ${audit.judged}/${audit.toJudge} judged`,
    `structured fields that differ: ${counted(audit.changedFields, '=') || 'none'}`,
    `left out: ${skipped.notAcrossEditions} links within one rules edition, ${skipped.targetNotFound} to a target the registry cannot look up, such as a magic variant`,
  ];
}
