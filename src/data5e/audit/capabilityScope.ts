/**
 * Scoping for more entries in `COMBAT_CAPABILITIES`: the features that show up
 * nowhere on the Play tab today, ranked by how likely each is to be always
 * available in combat. Whether a player could forget one is left to the owner, who
 * writes the one-liners for the top of the list, since Jev cannot write text.
 *
 * The table is keyed by name, so one line serves every printing of a name, and
 * the report ranks names rather than printings. It shows the lowest score among
 * a name's printings too: a wide spread means one line may not suit them all.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import { COMBAT_CAPABILITIES, capabilityKey } from '../../features/sheet/combatCapabilities';
import type { JudgeSet, JudgmentFile } from './judgments';
import { type ByType, type ProseSubject, proseSubjects } from './proseSubjects';
import {
  type Answers,
  answeredSubjects,
  pOf,
  reportHead,
  reportSection,
  type Scope,
  showP,
} from './scoping';

const IN_COMBAT = 'inCombat';
const ALWAYS_ON = 'alwaysOn';

/**
 * Two facts, combined by the report. One question asking for both plus "could a
 * player forget it" put 5 of 8 known non-combat features above its cutoff, while
 * these put 17 of the 18 features already in the table above all 8.
 */
export const CAPABILITY_SET: JudgeSet = {
  id: 'capability',
  version: 1,
  questions: [
    {
      id: IN_COMBAT,
      instructions:
        'Does this change what the character can do, or how well they do it, in combat?',
    },
    {
      id: ALWAYS_ON,
      instructions: 'Does it work every round, with no limit on uses per rest or per day?',
    },
  ],
};

const FEATURE_TYPES: ReadonlySet<ProseSubject['type']> = new Set([
  'race',
  'subrace',
  'classFeature',
  'subclassFeature',
]);

/** Race traits that only describe a character: about one subject in eight, none a candidate. */
const FILLER: ReadonlySet<string> = new Set([
  'age',
  'alignment',
  'creature type',
  'language',
  'languages',
  'size',
]);

/**
 * Class features, subclass features and race traits that the scanner draws
 * nothing from and that have neither a curated entry nor a capability line.
 */
export function capabilitySubjects(registry: ByType): ProseSubject[] {
  return proseSubjects(registry).filter((s) => {
    const key = capabilityKey(s.name);
    return (
      FEATURE_TYPES.has(s.type) &&
      !s.curated &&
      s.effects.length === 0 &&
      !FILLER.has(key) &&
      !Object.hasOwn(COMBAT_CAPABILITIES, key)
    );
  });
}

const score = (answers: Answers) => pOf(answers, IN_COMBAT) * pOf(answers, ALWAYS_ON);

/**
 * Names below this are counted, not listed: there are hundreds of them. On one
 * printing of each, 17 of 18 names in the table reached it and none of 8 controls
 * did. A name ranks by its best printing, so some controls still reach it on another.
 */
const LISTED_FROM = 0.4;

interface NameRow {
  /** The printing that scored highest, and its answers. */
  label: string;
  answers: Answers;
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
    const p = score(answers);
    const seen = byName.get(key);
    if (seen === undefined) {
      byName.set(key, { label: subject.label, answers, best: p, lowest: p, printings: 1 });
      continue;
    }
    seen.printings++;
    seen.lowest = Math.min(seen.lowest, p);
    if (p > seen.best) {
      seen.best = p;
      seen.label = subject.label;
      seen.answers = answers;
    }
  }
  const ranked = [...byName.values()].sort(
    (a, b) => b.best - a.best || a.label.localeCompare(b.label),
  );
  const listed = ranked.filter((r) => r.best >= LISTED_FROM);
  const rows = listed.map((r) => {
    const facts = `in combat ${showP(pOf(r.answers, IN_COMBAT))}, every round ${showP(pOf(r.answers, ALWAYS_ON))}`;
    const spread = r.printings > 1 ? `  ${r.printings} printings, lowest ${showP(r.lowest)}` : '';
    return `${showP(r.best)}  ${r.label}  ${facts}${spread}`;
  });
  return [
    reportHead(CAPABILITY_SET, 'combat capability candidates', subjects.length, answered.length),
    'The score is the two answers multiplied. Whether a player could forget it is yours to judge.',
    '',
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
