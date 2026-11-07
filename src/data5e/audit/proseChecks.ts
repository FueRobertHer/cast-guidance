/**
 * The prose scanner checked against saved judgments ("Prose automation" in
 * FUTURE_WORK.md). For every scanned trait and feature, Jev answers the same
 * yes/no questions the scanner's output implies an answer to; a confident
 * answer the scanner contradicts is a disagreement:
 *
 *   - `missed`: Jev is confident the prose says yes (p >= 0.8) and the
 *     scanner drew nothing for it, a likely false negative;
 *   - `extra`: Jev is confident it says no (p <= 0.2) and the scanner drew it
 *     anyway, a likely false positive.
 *
 * Answers in between are too uncertain to count either way. A disagreement is
 * a lead, not a verdict: the audit counts them against a ceiling, and a person
 * either fixes the scanner or records why it is right (`proseAllow`).
 *
 * A `missed` the sheet already answers from structured data is not one: the scanner's
 * silence costs the sheet nothing (`answeredElsewhere`). A pool that refills on a rest
 * the prose contradicts is not that answer, so its limit still counts.
 *
 * Relative imports only: `scripts/data-audit.ts` loads this under plain Bun.
 */
import type { EffectInput } from '../../engine/types';
import { answersFor, type JudgeSet, type JudgmentFile } from './judgments';
import type { ProseSubject } from './proseSubjects';

/** At or above: the prose says yes. */
export const CONFIDENT_YES = 0.8;
/** At or below: the prose says no. */
export const CONFIDENT_NO = 0.2;

type Effect = EffectInput;
type Action = Extract<Effect, { kind: 'action' }>;
type Resource = Extract<Effect, { kind: 'resource' }>;

const actions = (fx: readonly Effect[]) => fx.filter((e): e is Action => e.kind === 'action');
const resource = (fx: readonly Effect[]) => fx.find((e): e is Resource => e.kind === 'resource');

/** How a confident answer contradicts what was found, if it does. */
const contradiction = (found: boolean, p: number): DisagreementKind | undefined => {
  if (!found && p >= CONFIDENT_YES) return 'missed';
  if (found && p <= CONFIDENT_NO) return 'extra';
  return undefined;
};

interface ProseCheck {
  id: string;
  /** The question, phrased so that "yes" means the feature has the property. */
  instructions: string;
  /**
   * What the scanner's output says, or undefined when it says nothing either
   * way (a reset policy only means something once uses were found).
   */
  scanner: (effects: readonly Effect[]) => boolean | undefined;
  /**
   * The sheet has this from somewhere the scanner does not read, so its silence
   * misses nothing. It says nothing of what the scanner drew, so no `extra` comes of it.
   */
  answeredElsewhere?: (
    subject: Pick<ProseSubject, 'structuredLimit' | 'structuredShortRest'>,
    answers: Readonly<Record<string, number>>,
  ) => boolean;
}

const CHECKS: readonly ProseCheck[] = [
  {
    id: 'bonusAction',
    instructions:
      'Can the character use this feature, or something it lets them do, as a Bonus Action?',
    scanner: (fx) => actions(fx).some((a) => a.economy === 'bonus'),
  },
  {
    id: 'reaction',
    instructions:
      'Can the character use this feature, or something it lets them do, as a Reaction?',
    scanner: (fx) => actions(fx).some((a) => a.economy === 'reaction'),
  },
  {
    id: 'action',
    instructions:
      "Does using this feature take the character's action, a Magic action, or one of their attacks?",
    // The scanner shows plain actions only for limited-use features (anything
    // else would put a chip on every "as an action" in the game), so the
    // answer is only comparable once it found uses and no faster economy.
    scanner: (fx) =>
      resource(fx) !== undefined && !actions(fx).some((a) => a.economy !== 'action')
        ? actions(fx).some((a) => a.economy === 'action')
        : undefined,
  },
  {
    id: 'limitedUses',
    instructions:
      'Can the character use this feature only a limited number of times before they must finish a rest to use it again?',
    scanner: (fx) => resource(fx) !== undefined,
    // A pool on the wrong rest gives the wrong uses, and nothing else shows it:
    // `shortRest` says nothing without a resource the scanner drew.
    answeredElsewhere: (subject, { shortRest }) =>
      subject.structuredLimit &&
      (shortRest === undefined ||
        contradiction(subject.structuredShortRest, shortRest) === undefined),
  },
  {
    id: 'usesProficiency',
    instructions:
      'Is the number of times the character can use this feature equal to their Proficiency Bonus?',
    scanner: (fx) => {
      const r = resource(fx);
      return r === undefined ? undefined : r.max === 'profBonus';
    },
  },
  {
    id: 'shortRest',
    instructions:
      'Does the character regain the uses of this feature when they finish a Short Rest?',
    scanner: (fx) => {
      const r = resource(fx);
      return r === undefined ? undefined : r.resetOn === 'short';
    },
  },
  {
    id: 'healing',
    instructions: "Does this feature's dice roll restore Hit Points, rather than deal damage?",
    scanner: (fx) => {
      const rolled = actions(fx).filter((a) => a.roll !== undefined);
      return rolled.length === 0 ? undefined : rolled.some((a) => a.heals === true);
    },
  },
  {
    id: 'forcesSave',
    instructions: 'Does this feature force another creature to make a saving throw?',
    scanner: (fx) => {
      const acts = actions(fx);
      return acts.length === 0 ? undefined : acts.some((a) => a.save !== undefined);
    },
  },
];

export const PROSE_SET: JudgeSet = {
  id: 'prose',
  version: 1,
  questions: CHECKS.map(({ id, instructions }) => ({ id, instructions })),
};

export type DisagreementKind = 'missed' | 'extra';

export interface ProseDisagreement {
  /** The subject's prose hash. */
  key: string;
  label: string;
  check: string;
  kind: DisagreementKind;
  /** Jev's probability of "yes". */
  p: number;
}

export interface ProseAudit {
  /** Subjects the engine really scans (curated ones excluded). */
  subjects: number;
  /** Of those, how many have a saved judgment. */
  judged: number;
  disagreements: ProseDisagreement[];
  /** Disagreements per check and kind, e.g. `limitedUses: missed`. */
  byCheck: Record<string, number>;
}

/** One subject's disagreements with its saved answers. */
export function disagreementsFor(
  subject: Pick<
    ProseSubject,
    'key' | 'label' | 'effects' | 'structuredLimit' | 'structuredShortRest'
  >,
  answers: Readonly<Record<string, number>>,
): ProseDisagreement[] {
  const out: ProseDisagreement[] = [];
  for (const check of CHECKS) {
    const p = answers[check.id];
    const said = check.scanner(subject.effects);
    if (p === undefined || said === undefined) continue;
    const kind = contradiction(said, p);
    if (kind === undefined) continue;
    if (kind === 'missed' && check.answeredElsewhere?.(subject, answers) === true) continue;
    out.push({ key: subject.key, label: subject.label, check: check.id, kind, p });
  }
  return out;
}

export function auditProse(
  subjects: readonly ProseSubject[],
  judgments: JudgmentFile | undefined,
): ProseAudit {
  const scanned = subjects.filter((s) => !s.curated);
  const audit: ProseAudit = { subjects: scanned.length, judged: 0, disagreements: [], byCheck: {} };
  if (judgments === undefined) return audit;
  for (const subject of scanned) {
    const answers = answersFor(judgments, PROSE_SET, subject.key);
    if (answers === undefined) continue;
    audit.judged++;
    for (const d of disagreementsFor(subject, answers)) {
      audit.disagreements.push(d);
      const group = `${d.check}: ${d.kind}`;
      audit.byCheck[group] = (audit.byCheck[group] ?? 0) + 1;
    }
  }
  audit.disagreements.sort(
    (a, b) =>
      a.check.localeCompare(b.check) ||
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label),
  );
  return audit;
}
