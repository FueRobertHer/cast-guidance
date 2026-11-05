/**
 * Scoping for "Feat sub-choices" (FUTURE_WORK.md). The word "choose" cannot tell
 * a pick made when a feat is taken from a decision made during play, and a
 * structured field does not mean the player gets a picker: the engine reads
 * some fields and only warns about others. So each subject tells Jev what the
 * app really prompts for, taken from the feat collector itself, and asks what
 * the prose wants beyond that. The report is the backlog for the feat-picker row.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import { Collector } from '../../engine/effects/base';
import { collectFeatEntity } from '../../engine/effects/feat';
import { type ChoicePrompt, newCharacterDoc } from '../../engine/types';
import { CHOICE_WORDING } from './branches';
import type { JudgeSet, JudgeSubject, JudgmentFile } from './judgments';
import { type ByType, NO_DATA, readableEntries, textHash } from './proseSubjects';
import {
  type Answered,
  type Answers,
  answeredSubjects,
  pOf,
  reportHead,
  reportSection,
  type Scope,
  saysNo,
  saysYes,
  showP,
  YES_MEANS,
} from './scoping';

const KINDS = [
  { id: 'pickSkill', name: 'skill', what: 'one or more skills' },
  { id: 'pickTool', name: 'tool', what: 'one or more tools' },
  { id: 'pickSpell', name: 'spell', what: 'one or more spells' },
  { id: 'pickClass', name: 'class', what: 'a class, such as whose spell list the feat draws from' },
  { id: 'pickDamageType', name: 'damage type', what: 'a damage type' },
  { id: 'pickAbility', name: 'ability', what: 'an ability score' },
  {
    id: 'pickOther',
    name: 'other',
    what: 'something that is not a skill, tool, spell, class, damage type or ability score, such as a language, a weapon, a fighting style or a maneuver',
  },
] as const;

/** The line of a subject that tells Jev what is already covered. */
const OFFERED_LEAD = 'Picks the app offers';

/** Some feats let a pick be swapped later, and it still needs a picker. */
const WHEN_TAKEN =
  'Count it even if the feat lets them swap the pick later. A decision made each time they use the feat does not count.';

export const FEATCHOICE_SET: JudgeSet = {
  id: 'featchoice',
  version: 1,
  questions: [
    {
      id: 'pickOnTaking',
      instructions: `When the character takes this feat, do they make a pick from options, such as a skill, a spell, a damage type or an ability score? ${WHEN_TAKEN}`,
    },
    {
      id: 'pickDuringPlay',
      instructions:
        'Does this feat let the character make a fresh decision during play each time it comes up, such as whether to take a penalty or which creatures to affect?',
    },
    ...KINDS.map(({ id, what }) => ({
      id,
      instructions: `When the character takes this feat, do they pick ${what}?`,
    })),
    {
      id: 'beyondOffered',
      instructions: `The line starting "${OFFERED_LEAD}" lists the picks the character is already asked to make when taking this feat, or says none. Does the rest of the text ask for a pick when the feat is taken that this line does not cover? ${WHEN_TAKEN}`,
    },
  ],
};

export interface FeatChoiceSubject extends JudgeSubject {
  /** What the app prompts for on this feat, in the order it asks. */
  offered: string[];
}

/** How a prompt reads to someone who cannot see its options. */
function describePrompt(prompt: ChoicePrompt, name: string): string {
  // A branch prompt's own label says "spell option", but its options are lists
  // to pick from (a class's spells, an alignment), and no spell picker follows.
  if (prompt.id.endsWith(':branch')) {
    return `one of ${prompt.options.map((option) => option.label).join(', ')}`;
  }
  const lead = `${name}: `;
  return prompt.label.startsWith(lead) ? prompt.label.slice(lead.length) : prompt.label;
}

/**
 * What the engine asks a player who takes this feat. A pick can lead to another
 * (a list of spells, then that list's spellcasting ability), and the collector
 * holds the next back until the first is answered, so each prompt is answered
 * with its first option and the feat collected again until nothing new appears.
 * Other options of a branch are not walked: the printings seen ask the same of
 * each.
 */
function appPrompts(feat: Parameters<typeof collectFeatEntity>[1], name: string): string[] {
  const doc = newCharacterDoc('audit', 'audit', 'audit');
  const offered = new Set<string>();
  for (;;) {
    const col = new Collector(doc, NO_DATA);
    collectFeatEntity(col, feat, `${name}|${String(feat.source)}`.toLowerCase(), 'audit');
    const fresh = col.pending.filter((prompt) => doc.choices[prompt.id] === undefined);
    if (fresh.length === 0) return [...offered];
    for (const prompt of fresh) {
      offered.add(describePrompt(prompt, name));
      doc.choices[prompt.id] = prompt.options[0]?.id ?? '';
    }
  }
}

/**
 * Feats whose prose uses a choice word, one subject per distinct text. The same
 * words mark a branch block's choices, plus "chosen", which some feats only use
 * once they have asked in other words.
 */
export function featChoiceSubjects(registry: ByType): FeatChoiceSubject[] {
  const byKey = new Map<string, FeatChoiceSubject>();
  for (const feat of registry.byType('feat')) {
    const prose = readableEntries(feat.entries);
    if (!CHOICE_WORDING.test(prose) && !/\bchosen\b/i.test(prose)) continue;
    const name = String(feat.name);
    const offered = appPrompts(feat, name);
    const state = [
      name,
      `${OFFERED_LEAD}: ${offered.length > 0 ? offered.join('; ') : 'none'}`,
      prose,
    ].join('\n');
    const key = textHash(state);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      label: `${name} (feat|${String(feat.source)})`,
      state,
      offered,
    });
  }
  return [...byKey.values()];
}

type Verdict = 'backlog' | 'offered' | 'duringPlay' | 'noPick' | 'unclear';

function verdict(answers: Answers): Verdict {
  if (saysYes(answers, 'beyondOffered')) return 'backlog';
  if (saysYes(answers, 'pickOnTaking') && saysNo(answers, 'beyondOffered')) return 'offered';
  // Neither of these may hide an unsure "there is a pick beyond what's offered".
  if (saysNo(answers, 'pickOnTaking') && saysNo(answers, 'beyondOffered')) {
    if (saysYes(answers, 'pickDuringPlay')) return 'duringPlay';
    if (saysNo(answers, 'pickDuringPlay')) return 'noPick';
  }
  return 'unclear';
}

function row({ subject, answers }: Answered<FeatChoiceSubject>, lead: string): string {
  const kinds = KINDS.filter((k) => saysYes(answers, k.id)).map((k) => k.name);
  const offered = subject.offered.length > 0 ? subject.offered.join('; ') : 'none';
  return `${lead}  ${subject.label}  picks: ${kinds.length > 0 ? kinds.join(', ') : '?'}  offers: ${offered}`;
}

export function featChoiceReport(registry: ByType, file: JudgmentFile): string {
  const subjects = featChoiceSubjects(registry);
  const answered = answeredSubjects(FEATCHOICE_SET, subjects, file);
  const having = (wanted: Verdict) => answered.filter((a) => verdict(a.answers) === wanted);
  const ranked = (rows: readonly Answered<FeatChoiceSubject>[], id: string) =>
    [...rows]
      .sort(
        (a, b) =>
          pOf(b.answers, id) - pOf(a.answers, id) || a.subject.label.localeCompare(b.subject.label),
      )
      .map((a) => row(a, showP(pOf(a.answers, id))));

  return [
    reportHead(FEATCHOICE_SET, 'feat sub-choices', subjects.length, answered.length),
    YES_MEANS,
    '',
    reportSection(
      'A pick the app does not offer (the feat-picker backlog)',
      ranked(having('backlog'), 'beyondOffered'),
    ),
    reportSection('Every pick offered already', ranked(having('offered'), 'pickOnTaking')),
    reportSection(
      'A decision during play only (no picker needed)',
      ranked(having('duringPlay'), 'pickDuringPlay'),
    ),
    reportSection(
      'No pick at all (only the wording matched)',
      ranked(having('noPick'), 'pickOnTaking'),
    ),
    reportSection('Unclear (read these)', ranked(having('unclear'), 'beyondOffered')),
  ].join('\n');
}

export const FEATCHOICE_SCOPE: Scope = {
  set: FEATCHOICE_SET,
  subjects: featChoiceSubjects,
  report: featChoiceReport,
};
