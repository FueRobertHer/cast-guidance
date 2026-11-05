/**
 * Scoping for "Check and initiative bonuses in prose" (FUTURE_WORK.md). A regex
 * finds the word "initiative" but cannot tell a bonus from Advantage, or a half
 * proficiency bonus added to a check from one that sets a spell slot's level.
 * So the net is wide and Jev sorts it: the report lists the uncurated hits by
 * type, each with the sentence that put it in the net, which makes it the source
 * of phrasings to teach `proseScanFeature` and of positive and negative test
 * cases for them.
 *
 * Curated features are asked about too. Their wording is what the scanner has to
 * learn, and they are a check on how far to trust the answers for the rest.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import type { JudgeSet, JudgmentFile } from './judgments';
import { type ByType, type ProseSubject, proseSubjects } from './proseSubjects';
import {
  type Answered,
  type Answers,
  answeredSubjects,
  pOf,
  reportHead,
  reportSection,
  type Scope,
  saysYes,
  showP,
  YES_MEANS,
} from './scoping';

export const BONUS_SET: JudgeSet = {
  id: 'bonus',
  version: 1,
  questions: [
    {
      id: 'flat',
      instructions:
        'Does this feature add a fixed number, such as +2 or +5, to the initiative rolls, ability checks or passive scores of the character who has it? A die such as a d4 does not count.',
    },
    {
      id: 'proficiency',
      instructions:
        'Does this feature add the Proficiency Bonus, or half or double it, to the initiative rolls or ability checks of the character who has it? Gaining proficiency in a skill or tool does not count.',
    },
    {
      id: 'abilityMod',
      instructions:
        'Does this feature add an ability modifier, such as the Wisdom modifier, to the initiative rolls or ability checks of the character who has it?',
    },
    {
      id: 'advantage',
      instructions:
        'Does this feature give the character who has it Advantage on initiative rolls or ability checks?',
    },
    {
      id: 'notBonus',
      instructions:
        'Does this feature leave the initiative rolls, ability checks and passive scores of the character who has it unchanged, adding nothing to them and giving no Advantage on them?',
    },
    {
      // The FUTURE_WORK row keeps these out until rolls can take a toggled
      // bonus, so the report has to tell them from what can be taught now. "Any"
      // because a feature can have a standing benefit and a gated one.
      id: 'triggered',
      instructions:
        'Does any bonus or Advantage this feature gives on initiative rolls or ability checks apply only for a while or in limited circumstances, such as after spending a use, taking an action or meeting a trigger? A bonus that always applies to a named skill is not limited in this sense.',
    },
  ],
};

const TYPES = [
  { id: 'flat', title: 'Flat bonus' },
  { id: 'proficiency', title: 'Proficiency-based bonus' },
  { id: 'abilityMod', title: 'Ability-modifier bonus' },
  { id: 'advantage', title: 'Advantage, not a bonus' },
] as const;

const hasType = (answers: Answers) => TYPES.some((t) => saysYes(answers, t.id));

/** Words one sentence must all have to put a feature in the net. */
const NET: ReadonlyArray<readonly RegExp[]> = [
  [/\binitiative\b/i],
  [/\bbonus\b/i, /\bchecks?\b/i],
  // A passive score is not a check, and the FUTURE_WORK row names one.
  [/\bbonus\b/i, /\bpassive\b/i],
  [/\bhalf\b/i, /\bproficiency\b/i],
  // "Add your Wisdom modifier to the check" never says "bonus".
  [/\badds?\b/i, /\bmodifier\b/i, /\bchecks?\b/i],
];

/** The sentences of `state` that put it in the net. */
export function bonusCues(state: string): string[] {
  return state
    .split(/(?<=[.!?:;])\s+|\n/)
    .filter((sentence) => NET.some((words) => words.every((word) => word.test(sentence))));
}

export function bonusSubjects(registry: ByType): ProseSubject[] {
  return proseSubjects(registry).filter((s) => bonusCues(s.state).length > 0);
}

/** A hit and the words that put it there. The words stay out of any saved file. */
function row(subject: ProseSubject, lead: string): string {
  return `${lead}\n      ${bonusCues(subject.state).join(' / ')}`;
}

/** What can be taught now comes first, then the likeliest. */
function typeRows(rows: readonly Answered<ProseSubject>[], id: string): string[] {
  const triggered = (a: Answers) => (saysYes(a, 'triggered') ? 1 : 0);
  return rows
    .filter(({ answers }) => saysYes(answers, id))
    .sort(
      (a, b) =>
        triggered(a.answers) - triggered(b.answers) ||
        pOf(b.answers, id) - pOf(a.answers, id) ||
        a.subject.label.localeCompare(b.subject.label),
    )
    .map(({ subject, answers }) => {
      const trigger = saysYes(answers, 'triggered')
        ? `  needs a trigger (${showP(pOf(answers, 'triggered'))})`
        : '';
      return row(subject, `${showP(pOf(answers, id))}  ${subject.label}${trigger}`);
    });
}

export function bonusReport(registry: ByType, file: JudgmentFile): string {
  const subjects = bonusSubjects(registry);
  const answered = answeredSubjects(BONUS_SET, subjects, file);
  const open = answered.filter(({ subject }) => !subject.curated);
  const curated = answered.filter(({ subject }) => subject.curated);

  const byLabel = (a: Answered<ProseSubject>, b: Answered<ProseSubject>) =>
    a.subject.label.localeCompare(b.subject.label);
  const negative = open
    .filter(({ answers }) => !hasType(answers) && saysYes(answers, 'notBonus'))
    .sort((a, b) => pOf(b.answers, 'notBonus') - pOf(a.answers, 'notBonus') || byLabel(a, b))
    .map(({ subject, answers }) =>
      row(subject, `${showP(pOf(answers, 'notBonus'))}  ${subject.label}`),
    );
  const unclear = open
    .filter(({ answers }) => !hasType(answers) && !saysYes(answers, 'notBonus'))
    .sort(byLabel)
    .map(({ subject }) => row(subject, subject.label));
  const known = curated
    .filter(({ answers }) => hasType(answers))
    .sort(byLabel)
    .map(({ subject, answers }) => {
      const types = TYPES.filter((t) => saysYes(answers, t.id))
        .map((t) => `${t.id} ${showP(pOf(answers, t.id))}`)
        .join(', ');
      return row(subject, `${subject.label}: ${types}`);
    });
  const denied = curated
    .filter(({ answers }) => !hasType(answers))
    .sort(byLabel)
    .map(({ subject }) => row(subject, subject.label));

  return [
    reportHead(BONUS_SET, 'check and initiative bonuses', subjects.length, answered.length),
    `${YES_MEANS} Quotes rules text, so keep this output out of the repository.`,
    '',
    ...TYPES.map((t) => reportSection(`${t.title}, uncurated`, typeRows(open, t.id))),
    reportSection('Not a bonus, uncurated (negative test cases)', negative),
    reportSection('Unclear, uncurated (read these)', unclear),
    reportSection('Curated already (wording the scanner should learn)', known),
    reportSection('Curated, no bonus found (a miss if its entry adds one)', denied),
  ].join('\n');
}

export const BONUS_SCOPE: Scope = {
  set: BONUS_SET,
  subjects: bonusSubjects,
  report: bonusReport,
};
