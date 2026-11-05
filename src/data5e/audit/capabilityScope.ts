/**
 * Scoping for more entries in `COMBAT_CAPABILITIES`: the features that show up
 * nowhere on the Play tab today, ranked by how likely each is to be something a
 * player could forget to use. Jev cannot write text, so the owner writes the
 * one-liners for the top of the list.
 *
 * The table is keyed by name, so one line serves every printing of a name, and
 * the report ranks names rather than printings. It shows the lowest answer among
 * a name's printings too: a wide spread means one line may not suit them all.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import { COMBAT_CAPABILITIES, capabilityKey } from '../../features/sheet/combatCapabilities';
import type { JudgeSet, JudgmentFile } from './judgments';
import { type ByType, type ProseSubject, proseSubjects } from './proseSubjects';
import { answeredSubjects, pOf, reportHead, reportSection, type Scope, showP } from './scoping';

const QUESTION = 'forgettable';

export const CAPABILITY_SET: JudgeSet = {
  id: 'capability',
  version: 1,
  questions: [
    {
      id: QUESTION,
      instructions:
        'Is this an always-available option in combat that a player could forget to use?',
    },
  ],
};

const FEATURE_TYPES: ReadonlySet<ProseSubject['type']> = new Set([
  'race',
  'subrace',
  'classFeature',
  'subclassFeature',
]);

/**
 * Class features, subclass features and race traits that the scanner draws
 * nothing from and that have neither a curated entry nor a capability line.
 */
export function capabilitySubjects(registry: ByType): ProseSubject[] {
  return proseSubjects(registry).filter(
    (s) =>
      FEATURE_TYPES.has(s.type) &&
      !s.curated &&
      s.effects.length === 0 &&
      !Object.hasOwn(COMBAT_CAPABILITIES, capabilityKey(s.name)),
  );
}

/** Names below this are counted, not listed: there are over a thousand of them. */
const LISTED_FROM = 0.5;

interface NameRow {
  /** The printing Jev rated highest. */
  label: string;
  best: number;
  lowest: number;
  printings: number;
}

export function capabilityReport(registry: ByType, file: JudgmentFile): string {
  const subjects = capabilitySubjects(registry);
  const answered = answeredSubjects(CAPABILITY_SET, subjects, file);
  const byName = new Map<string, NameRow>();
  for (const { subject, answers } of answered) {
    const key = capabilityKey(subject.name);
    const p = pOf(answers, QUESTION);
    const seen = byName.get(key);
    if (seen === undefined) {
      byName.set(key, { label: subject.label, best: p, lowest: p, printings: 1 });
      continue;
    }
    seen.printings++;
    seen.lowest = Math.min(seen.lowest, p);
    if (p > seen.best) {
      seen.best = p;
      seen.label = subject.label;
    }
  }
  const ranked = [...byName.values()].sort(
    (a, b) => b.best - a.best || a.label.localeCompare(b.label),
  );
  const listed = ranked.filter((r) => r.best >= LISTED_FROM);
  const rows = listed.map((r) => {
    const spread = r.printings > 1 ? `  ${r.printings} printings, lowest ${showP(r.lowest)}` : '';
    return `${showP(r.best)}  ${r.label}${spread}`;
  });
  return [
    reportHead(CAPABILITY_SET, 'combat capability candidates', subjects.length, answered.length),
    reportSection(`Names at ${LISTED_FROM} or above, likeliest first`, rows),
    `${ranked.length - listed.length} more names below ${LISTED_FROM} are not listed.`,
    '',
  ].join('\n');
}

export const CAPABILITY_SCOPE: Scope = {
  set: CAPABILITY_SET,
  subjects: capabilitySubjects,
  report: capabilityReport,
};
