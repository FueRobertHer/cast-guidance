/** Multiclass prerequisite reading (`multiclassing.requirements`). */
import { ABILITIES, type Ability, type DataEntity } from './types';

type Requirements = Partial<Record<Ability, number>> & {
  or?: Array<Partial<Record<Ability, number>>>;
};

function reqOf(cls: DataEntity | undefined): Requirements | undefined {
  const mc = cls?.multiclassing as DataEntity | undefined;
  const req = mc?.requirements;
  return req !== null && typeof req === 'object' ? (req as Requirements) : undefined;
}

function partText(part: Partial<Record<Ability, number>>): string {
  return ABILITIES.filter((a) => typeof part[a] === 'number')
    .map((a) => `${a.toUpperCase()} ${part[a]}`)
    .join(' and ');
}

/** e.g. "STR 13 or DEX 13", undefined when the class declares none. */
export function multiclassRequirementText(cls: DataEntity | undefined): string | undefined {
  const req = reqOf(cls);
  if (req === undefined) return undefined;
  const parts: string[] = [];
  const base = partText(req);
  if (base !== '') parts.push(base);
  for (const alt of req.or ?? []) {
    const t = partText(alt);
    if (t !== '') parts.push(t);
  }
  return parts.length > 0 ? parts.join(' or ') : undefined;
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
  const req = reqOf(cls);
  if (req === undefined) return true;
  const partOk = (part: Partial<Record<Ability, number>>): boolean =>
    ABILITIES.every((a) => {
      const min = part[a];
      return typeof min !== 'number' || scores[a] >= min;
    });
  const alternatives = req.or !== undefined ? req.or : [];
  const baseHasReqs = ABILITIES.some((a) => typeof req[a] === 'number');
  if (alternatives.length > 0) {
    return (baseHasReqs ? partOk(req) : false) || alternatives.some(partOk);
  }
  return partOk(req);
}
