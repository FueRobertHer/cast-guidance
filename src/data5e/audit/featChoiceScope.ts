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
import { hasChosenSpell } from '../../engine/effects/additionalSpells';
import { Collector } from '../../engine/effects/base';
import { collectFeatEntity } from '../../engine/effects/feat';
import { type CharacterDoc, type ChoicePrompt, newCharacterDoc } from '../../engine/types';
import { CHOICE_WORDING } from './branches';
import type { JudgeSet, JudgeSubject, JudgmentFile } from './judgments';
import { type ByType, NO_DATA, readableEntries, textHash } from './proseSubjects';
import {
  type Answered,
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

type Kind = (typeof KINDS)[number];

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
  /** The kinds of pick those prompts take care of. Not in `state`, so free to change. */
  covers: Kind['id'][];
  /** The data has the player choose a spell. Not in `state` either. */
  choosesSpell: boolean;
}

/** How a prompt reads to someone who cannot see its options. */
function describePrompt(prompt: ChoicePrompt, name: string): string {
  // A branch prompt's own label says "spell option", but its options are lists
  // to pick from (a class's spells, an alignment), and what follows is its own prompt.
  if (prompt.id.endsWith(':branch')) {
    return `one of ${prompt.options.map((option) => option.label).join(', ')}`;
  }
  // One word for every spell pick. This is in `state`, so a label reworded for the
  // player, or a list that differs by branch, must not re-key a feat's answers.
  if (prompt.kind === 'spell') return 'spells';
  const lead = `${name}: `;
  return prompt.label.startsWith(lead) ? prompt.label.slice(lead.length) : prompt.label;
}

/** The kinds of pick a prompt takes care of. A branch is a list, so never a spell itself. */
function kindsCovered(prompt: ChoicePrompt): Kind['id'][] {
  if (prompt.id.endsWith(':branch')) return ['pickClass', 'pickOther'];
  switch (prompt.kind) {
    case 'skill':
    case 'expertise':
      return ['pickSkill'];
    case 'tool':
      return ['pickTool'];
    case 'ability':
    case 'abilityWeighted':
      return ['pickAbility'];
    case 'spell':
      return ['pickSpell'];
    case 'skillOrTool':
      return ['pickSkill', 'pickTool'];
    case 'damageType':
      return ['pickDamageType'];
    default:
      // Languages, weapons and armor, and the resistance prompt, which is generic too.
      return prompt.label === 'Damage resistance' ? ['pickDamageType'] : ['pickOther'];
  }
}

/**
 * What the engine asks a player who takes this feat, at any level. A pick can lead
 * to another (a list of spells, then that list's spellcasting ability), and the
 * collector holds the next back until the first is answered, so each prompt is
 * answered with its first option and the feat collected again until nothing new
 * appears. Every option of a branch is walked: only some may lead to a spell pick.
 */
function appPrompts(feat: Parameters<typeof collectFeatEntity>[1], name: string) {
  const offered = new Set<string>();
  const covers = new Set<Kind['id']>();
  const walk = (choices: CharacterDoc['choices']) => {
    const doc = newCharacterDoc('audit', 'audit', 'audit');
    doc.classes = [{ ref: { name: 'audit', source: 'audit' }, levels: 20, hp: [] }];
    doc.choices = choices;
    const col = new Collector(doc, NO_DATA);
    collectFeatEntity(col, feat, `${name}|${String(feat.source)}`.toLowerCase(), 'audit');
    const fresh = col.pending.filter((prompt) => choices[prompt.id] === undefined);
    if (fresh.length === 0) return;
    const answered = { ...choices };
    for (const prompt of fresh) {
      offered.add(describePrompt(prompt, name));
      for (const kind of kindsCovered(prompt)) covers.add(kind);
      answered[prompt.id] = prompt.options[0]?.id ?? '';
    }
    const branch = fresh.find((prompt) => prompt.id.endsWith(':branch'));
    if (branch === undefined) {
      walk(answered);
      return;
    }
    for (const option of branch.options) walk({ ...answered, [branch.id]: option.id });
  };
  walk({});
  return { offered: [...offered], covers: [...covers] };
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
    const { offered, covers } = appPrompts(feat, name);
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
      covers,
      choosesSpell: hasChosenSpell(feat.additionalSpells),
    });
  }
  return [...byKey.values()];
}

/**
 * Rows a person has read and found need no picker, whatever Jev says. Asking again
 * would only spend credit: the kinds it named are the ones already offered. By
 * label, not by answer key, so this outlives a change to `state`.
 */
const READ_NO_PICKER: Record<string, string> = {
  'Harper Agent (feat|FRHoF)': 'its only pick is the instrument, offered already',
  'Metamagic Adept (feat|TCE)': 'its only pick is the metamagic, offered already',
  'Touch of Death (feat|RHW)': 'its spell is fixed, and its only pick is the ability',
};

/** Backlog rows left unsupported on purpose, and why. Same keys as above. */
const LEFT_UNSUPPORTED: Record<string, string> = {
  'Rune Shaper (feat|BGG)':
    'runes number half the proficiency bonus and are swappable; the app grants every rune spell at 1/day and offers no pick',
};

type Verdict = 'backlog' | 'offered' | 'duringPlay' | 'noPick' | 'unclear' | 'read';
type Row = Answered<FeatChoiceSubject>;

/**
 * The kinds a feat asks for that no prompt of the app takes care of: those Jev is
 * sure of, and a spell whenever the data has the player choose one, however unsure
 * Jev is. A confident answer about a kind the app covers would otherwise hide it.
 */
const needed = ({ subject, answers }: Row) =>
  KINDS.filter(
    (k) =>
      !subject.covers.includes(k.id) &&
      (saysYes(answers, k.id) || (k.id === 'pickSpell' && subject.choosesSpell)),
  );

/** Below this Jev is not leaning toward a kind at all. */
const LEANS = 0.5;

/** Kinds no prompt covers that Jev leans toward without being sure, likeliest first. */
function maybes(row: Row): string[] {
  const sure = needed(row);
  return KINDS.filter(
    (k) =>
      !sure.includes(k) && !row.subject.covers.includes(k.id) && pOf(row.answers, k.id) >= LEANS,
  )
    .sort((a, b) => pOf(row.answers, b.id) - pOf(row.answers, a.id))
    .map((k) => `maybe ${k.name} (${showP(pOf(row.answers, k.id))})`);
}

/**
 * `beyondOffered` cannot decide this alone: on the first real run Jev said yes to
 * it for feats whose only pick the offered line already names, as if it read the
 * choice wording in the prose and not that line. Its answers about kinds put the
 * feats FUTURE_WORK.md names on the right side, so they decide when it is sure of
 * any, and `beyondOffered` only speaks for a feat with no confident kind. An unsure
 * kind cannot decide either (it was as high on feats with no such pick), so it is
 * shown on the row for a reader to judge. A chosen spell the data names needs no
 * answer at all: past `needed`, a prompt covers it.
 */
function verdict(row: Row): Verdict {
  const { answers, subject } = row;
  if (READ_NO_PICKER[subject.label] !== undefined) return 'read';
  if (needed(row).length > 0) return 'backlog';
  if (subject.choosesSpell || KINDS.some((k) => saysYes(answers, k.id))) return 'offered';
  if (saysYes(answers, 'beyondOffered')) return 'backlog';
  if (saysYes(answers, 'pickOnTaking') && saysNo(answers, 'beyondOffered')) return 'offered';
  // Neither of these may hide an unsure "there is a pick beyond what's offered".
  if (saysNo(answers, 'pickOnTaking') && saysNo(answers, 'beyondOffered')) {
    if (saysYes(answers, 'pickDuringPlay')) return 'duringPlay';
    if (saysNo(answers, 'pickDuringPlay')) return 'noPick';
  }
  return 'unclear';
}

const offersText = ({ offered }: FeatChoiceSubject) =>
  offered.length > 0 ? offered.join('; ') : 'none';

function pickRow(row: Row, id: string): string {
  const kinds = KINDS.filter((k) => saysYes(row.answers, k.id)).map((k) => k.name);
  const picks = [...kinds, ...maybes(row)].join(', ') || '?';
  return `${showP(pOf(row.answers, id))}  ${row.subject.label}  picks: ${picks}  offers: ${offersText(row.subject)}`;
}

/** How sure the backlog row is: its surest needed kind, else what `beyondOffered` said. */
const needP = (row: Row) =>
  Math.max(0, ...needed(row).map((k) => pOf(row.answers, k.id))) ||
  pOf(row.answers, 'beyondOffered');

function needRow(row: Row): string {
  const needs = [...needed(row).map((k) => k.name), ...maybes(row)].join(', ') || '?';
  const left = LEFT_UNSUPPORTED[row.subject.label];
  return `${showP(needP(row))}  ${row.subject.label}  needs: ${needs}  offers: ${offersText(row.subject)}${left !== undefined ? `  left unsupported: ${left}` : ''}`;
}

/** The picker to build first is the one the most feats wait on. */
function neededTally(rows: readonly Row[]): string {
  const counted = KINDS.map((k) => ({
    name: k.name,
    count: rows.filter((row) => needed(row).includes(k)).length,
  }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count);
  return `Needed, most first: ${counted.length > 0 ? counted.map((k) => `${k.name} ${k.count}`).join(', ') : 'none'}`;
}

export function featChoiceReport(registry: ByType, file: JudgmentFile): string {
  const subjects = featChoiceSubjects(registry);
  const answered = answeredSubjects(FEATCHOICE_SET, subjects, file);
  const having = (wanted: Verdict) => answered.filter((a) => verdict(a) === wanted);
  const byLabel = (a: Row, b: Row) => a.subject.label.localeCompare(b.subject.label);
  const ranked = (rows: readonly Row[], id: string) =>
    [...rows]
      .sort((a, b) => pOf(b.answers, id) - pOf(a.answers, id) || byLabel(a, b))
      .map((row) => pickRow(row, id));

  const backlog = having('backlog');
  return [
    reportHead(FEATCHOICE_SET, 'feat sub-choices', subjects.length, answered.length),
    `${YES_MEANS} ${neededTally(backlog)}`,
    '',
    reportSection(
      'A pick the app does not offer (the feat-picker backlog)',
      [...backlog].sort((a, b) => needP(b) - needP(a) || byLabel(a, b)).map(needRow),
    ),
    reportSection(
      'Read by hand, no picker needed',
      having('read')
        .sort(byLabel)
        .map(({ subject }) => `${subject.label}  ${READ_NO_PICKER[subject.label]}`),
    ),
    reportSection('Every kind of pick offered already', ranked(having('offered'), 'pickOnTaking')),
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
