/**
 * Optional class features: the ones the data marks `isClassFeatureVariant`,
 * which are Tasha's optional features on 2014 classes and a book's variant
 * features on 2024 ones (World of Warcraft's Pet Specialization). They are a
 * table's choice, so a character has none unless its `optionalClassFeatures`
 * rule is on. On, each one is a pick, as a pick-one feature is: "Favored
 * Enemy or Favored Foe" where the variant's text names a feature it replaces,
 * taken or not where it names none. Unpicked, the class stays as printed.
 *
 * A variant always sits beside the feature it replaces: in a class's or
 * subclass's own list, or among the refs inside one feature (the 2014 Beast
 * Master's Ranger's Companion and Primal Companion). So the gate works on one
 * list of siblings at a time.
 */
import { plainEntryText } from '../../data5e/entries/plainText';
import { summarizeEntries } from '../summarize';
import type { ChoiceOption, DataEntity, EffectOrigin } from '../types';
import type { Collector } from './base';

export const isClassFeatureVariant = (feature: DataEntity | undefined): boolean =>
  feature?.isClassFeatureVariant === true;

/** One feature in a list of siblings, found in the data. */
export interface Sibling {
  /** The ledger key it is collected under. */
  key: string;
  name: string;
  level: number;
  entity: DataEntity;
}

/**
 * The feature a variant's opening line says it replaces: "which replaces the
 * Favored Enemy feature" (Tasha's), "This feature replaces the Roving feature
 * for a Hunter" (World of Warcraft).
 */
export function replacedFeatureName(variant: DataEntity): string | undefined {
  const entries = Array.isArray(variant.entries) ? variant.entries : [];
  const first = entries.find((e): e is string => typeof e === 'string');
  if (first === undefined) return undefined;
  return /\breplaces the (.+?) feature\b/i.exec(plainEntryText(first))?.[1]?.trim();
}

/**
 * The features an improvement improves, by lowercased name: "Natural Explorer
 * improvement" improves Natural Explorer, "Favored Enemy and Natural Explorer
 * improvements" both. Undefined for a name that is not an improvement.
 */
function improvedNames(name: string): string[] | undefined {
  const base = /^(.+?)\s+improvements?$/i.exec(name.trim())?.[1];
  return base?.split(/\s+and\s+/i).map((n) => n.toLowerCase());
}

/** A variant and the feature it replaces, if its list has that feature. */
interface Pair {
  variant: Sibling;
  original?: Sibling;
  id: string;
  /** The variant's option id. */
  optionId: string;
  asked: boolean;
  taken: boolean;
}

const NOT_TAKEN = 'not taken';

/**
 * What an option in a variant's pick does: its text after an opening note
 * that says nothing the pick's label does not. Tasha's opens its variants, and
 * the subclass features it prints, with an italic line ("3rd-level rogue
 * optional feature", "8th-level Twilight Domain feature"); a variant may
 * instead open by naming what it replaces ("This feature replaces the Roving
 * feature for a Hunter").
 */
export function optionSummary(entity: DataEntity): string {
  const entries = entity.entries;
  const first: unknown = Array.isArray(entries) ? entries[0] : undefined;
  if (!Array.isArray(entries) || entries.length < 2 || typeof first !== 'string') {
    return summarizeEntries(entries);
  }
  const t = first.trim();
  const note =
    (t.startsWith('{@i ') && t.endsWith('}')) ||
    (isClassFeatureVariant(entity) && replacedFeatureName(entity) !== undefined);
  return summarizeEntries(note ? entries.slice(1) : entries);
}

function option(s: Sibling): ChoiceOption {
  return {
    id: s.name.toLowerCase(),
    label: s.name,
    description: optionSummary(s.entity),
    entries: s.entity.entries,
  };
}

/**
 * Which features of one list of siblings are collected. Each variant's pick is
 * asked the first time a member of its pair is reached, so it sits in the
 * list's own order among the other picks.
 *
 * Improvements go with what they improve: a variant named for another variant
 * ("Deft Explorer Improvement") is taken with it and asks nothing, and a
 * printed improvement ("Favored Enemy improvement") leaves once every feature
 * it names is replaced.
 */
export class VariantGate {
  private readonly col: Collector;
  private readonly origin: EffectOrigin;
  private readonly on: boolean;
  private readonly pairsOf = new Map<string, Pair[]>();
  private readonly follows = new Map<string, () => boolean>();

  constructor(
    col: Collector,
    origin: EffectOrigin,
    siblings: readonly Sibling[],
    choicePrefix: string,
  ) {
    this.col = col;
    this.origin = origin;
    this.on = col.doc.optionalClassFeatures === true;
    const variants = siblings.filter((s) => isClassFeatureVariant(s.entity));
    for (const v of variants) col.classVariants.add(v.key);
    if (!this.on || variants.length === 0) return;
    const named = (list: readonly Sibling[], name: string) =>
      list.filter((s) => s.name.toLowerCase() === name);

    const pairsByVariant = new Map<string, Pair>();
    const leaders = new Map<string, Sibling[]>();
    for (const v of variants) {
      const improves = improvedNames(v.name);
      const led = improves?.map((n) => named(variants, n).filter((x) => x !== v));
      if (led?.every((l) => l.length > 0)) {
        leaders.set(v.key, led.flat());
        continue;
      }
      const replaced = replacedFeatureName(v.entity)?.toLowerCase();
      const original =
        replaced === undefined
          ? undefined
          : named(siblings, replaced).find((s) => !isClassFeatureVariant(s.entity));
      const pair: Pair = {
        variant: v,
        original,
        id: `${choicePrefix}:variant:${v.name}:${v.level}`.toLowerCase(),
        optionId: v.name.toLowerCase(),
        asked: false,
        taken: false,
      };
      pairsByVariant.set(v.key, pair);
      for (const member of original === undefined ? [v] : [v, original]) {
        this.pairsOf.set(member.key, [...(this.pairsOf.get(member.key) ?? []), pair]);
      }
    }

    // A variant improving variants is taken when each of them is.
    for (const [key, led] of leaders) {
      const pairs = led.flatMap((l) => pairsByVariant.get(l.key) ?? []);
      this.follows.set(key, () => pairs.length > 0 && pairs.every((p) => this.ask(p)));
    }
    // A printed improvement leaves once every feature it improves is replaced.
    for (const s of siblings) {
      if (isClassFeatureVariant(s.entity)) continue;
      const improves = improvedNames(s.name);
      const pairs = improves?.map((n) =>
        named(siblings, n).flatMap((o) => this.pairsOf.get(o.key) ?? []),
      );
      if (pairs === undefined || !pairs.every((p) => p.length > 0)) continue;
      this.follows.set(s.key, () => !pairs.every((p) => p.some((x) => this.ask(x))));
    }
  }

  /** Whether this sibling is collected. Asks its pick if this is the first member reached. */
  allows(s: Sibling): boolean {
    if (!this.on) return !isClassFeatureVariant(s.entity);
    const follow = this.follows.get(s.key);
    if (follow !== undefined) return follow();
    const pairs = this.pairsOf.get(s.key);
    if (pairs === undefined) return true;
    const taken = pairs.map((p) => this.ask(p));
    return isClassFeatureVariant(s.entity) ? taken.some(Boolean) : !taken.some(Boolean);
  }

  /**
   * The prefix a taken variant's own picks are kept under: its option's, as a
   * picked branch's are, so they clear when the pick is changed.
   */
  choicePrefixFor(s: Sibling, fallback: string): string {
    const pair = this.pairsOf.get(s.key)?.find((p) => p.variant.key === s.key);
    return pair?.taken === true ? `${pair.id}:${pair.optionId}` : fallback;
  }

  /** Ask a pair's pick once; whether the variant is taken. Unanswered keeps the printed class. */
  private ask(pair: Pair): boolean {
    if (pair.asked) return pair.taken;
    pair.asked = true;
    const { variant, original } = pair;
    this.col.choice(
      {
        id: pair.id,
        origin: this.origin,
        kind: 'feature',
        label:
          original === undefined
            ? `Level ${variant.level}: ${variant.name} (optional)`
            : `Level ${variant.level}: ${original.name} or ${variant.name}`,
        count: 1,
        options:
          original === undefined
            ? [
                option(variant),
                {
                  id: NOT_TAKEN,
                  label: 'Not taken',
                  description: 'The class as printed, without this optional feature.',
                },
              ]
            : [option(original), option(variant)],
      },
      (selected) => {
        pair.taken = selected.includes(pair.optionId);
      },
    );
    return pair.taken;
  }
}
