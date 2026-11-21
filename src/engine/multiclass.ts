/** Multiclass prerequisite reading (`multiclassing.requirements`). */
import { ABILITIES, type Ability, type DataEntity } from './types';

/** Scores that are all needed together, as `[ability, minimum]`. */
type Scores = Array<[Ability, number]>;
/** One of its alternatives is needed. */
type Clause = Scores[];

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

function scoresOf(part: Record<string, unknown>): Scores {
  return ABILITIES.flatMap((a): Scores => {
    const min = part[a];
    return typeof min === 'number' ? [[a, min]] : [];
  });
}

/**
 * `multiclassing.requirements`: every score at the top is needed, and one
 * score of each `or` object, as 5etools renders them (the 2014 Fighter's
 * `or: [{ str: 13, dex: 13 }]` is Strength 13 or Dexterity 13). The Workshop
 * and the converter write one-of as one score an object (`or: [{ str: 13 },
 * { dex: 13 }]`), so objects of one score each are one choice of them all.
 */
function requirementClauses(req: Record<string, unknown>): Clause[] {
  const clauses: Clause[] = [];
  const top = scoresOf(req);
  if (top.length > 0) clauses.push([top]);
  const parts = (Array.isArray(req.or) ? req.or : []).flatMap((o) => {
    const part = record(o);
    const scores = part === undefined ? [] : scoresOf(part);
    return scores.length > 0 ? [scores] : [];
  });
  const alternatives = (scores: Scores): Clause => scores.map((s): Scores => [s]);
  if (parts.every((p) => p.length === 1)) {
    if (parts.length > 0) clauses.push(parts.flatMap(alternatives));
  } else clauses.push(...parts.map(alternatives));
  return clauses;
}

/**
 * A 2024 class's `primaryAbility`, which it needs at 13 to multiclass: one of
 * its objects, with every ability marked in it (a Monk's Dexterity and Wisdom,
 * a Fighter's Strength or Dexterity).
 */
function primaryClauses(primary: unknown): Clause[] {
  const alternatives = (Array.isArray(primary) ? primary : []).flatMap((o) => {
    const part = record(o);
    if (part === undefined) return [];
    const scores = ABILITIES.filter((a) => part[a] === true).map((a): [Ability, number] => [a, 13]);
    return scores.length > 0 ? [scores] : [];
  });
  return alternatives.length > 0 ? [alternatives] : [];
}

/**
 * What a class needs to multiclass, every clause of it: its written
 * requirements, else its primary ability. No class in the release has both
 * (some homebrew does, where 5etools shows the primary ability alone); a
 * Workshop copy that writes requirements over a 2024 class means them.
 */
function clausesOf(cls: DataEntity | undefined): Clause[] {
  const req = record(record(cls?.multiclassing)?.requirements);
  const written = req !== undefined ? requirementClauses(req) : [];
  return written.length > 0 ? written : primaryClauses(cls?.primaryAbility);
}

const scoresText = (scores: Scores) =>
  scores.map(([a, min]) => `${a.toUpperCase()} ${min}`).join(' and ');

/** e.g. "STR 13 or DEX 13", undefined when the class declares none. */
export function multiclassRequirementText(cls: DataEntity | undefined): string | undefined {
  const clauses = clausesOf(cls);
  if (clauses.length === 0) return undefined;
  return clauses.map((c) => c.map(scoresText).join(' or ')).join(', and ');
}

/** Class level at which the subclass is chosen (from gainSubclassFeature refs). */
export function subclassUnlockLevel(cls: DataEntity | undefined): number {
  const feats = Array.isArray(cls?.classFeatures) ? cls.classFeatures : [];
  for (const f of feats) {
    if (
      typeof f === 'object' &&
      f !== null &&
      (f as { gainSubclassFeature?: boolean }).gainSubclassFeature === true
    ) {
      const raw = String((f as { classFeature?: unknown }).classFeature ?? '');
      const lvl = Number.parseInt(raw.split('|')[3] ?? '', 10);
      if (!Number.isNaN(lvl)) return lvl;
    }
  }
  return 1;
}

/** Check final ability SCORES (not mods) against the class requirements. */
export function meetsMulticlassRequirements(
  cls: DataEntity | undefined,
  scores: Record<Ability, number>,
): boolean {
  return clausesOf(cls).every((clause) =>
    clause.some((alt) => alt.every(([a, min]) => scores[a] >= min)),
  );
}
