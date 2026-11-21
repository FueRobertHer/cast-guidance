/**
 * Where a character's skill proficiencies come from, so a skill pick can say
 * which of its options the build already grants ("Already proficient from
 * Acolyte (background)") instead of letting a pick be spent on a duplicate.
 */
import {
  type ChoiceOption,
  type ChoicePrompt,
  type EffectInput,
  type EffectOrigin,
  SKILLS,
} from '../types';
import type { Collector } from './base';
import { skillOptions } from './readers';

/** What a player calls each origin type. Custom and curated rows go unnamed. */
const ORIGIN_NOUN: Partial<Record<EffectOrigin['type'], string>> = {
  race: 'species',
  background: 'background',
  class: 'class',
  subclass: 'subclass',
  feat: 'feat',
  item: 'item',
};

/** "Acolyte (background)": an origin as the player would recognize it. */
export function originName(origin: EffectOrigin): string {
  const noun = ORIGIN_NOUN[origin.type];
  return noun !== undefined ? `${origin.label} (${noun})` : origin.label;
}

/** "Elf (species) and Acolyte (background)"; three or more as "a, b and c". */
export function originList(origins: readonly EffectOrigin[]): string {
  const names = origins.map(originName);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Every origin that grants each skill, keyed by lowercase skill name, once per
 * origin, in collection order. Proficiency only unless `expertise`: expertise
 * is built on a proficiency the character already has, so counting it would
 * call the pick it rests on a duplicate. `skip` leaves out effects that should
 * not count, such as a pick's own grants.
 */
export function skillSources(
  effects: readonly EffectInput[],
  {
    skip = () => false,
    expertise = false,
  }: { skip?: (e: EffectInput) => boolean; expertise?: boolean } = {},
): Map<string, EffectOrigin[]> {
  const out = new Map<string, EffectOrigin[]>();
  for (const e of effects) {
    if (e.kind !== 'skillProf' || e.level < 1 || (e.level > 1 && !expertise) || skip(e)) continue;
    const key = e.skill.toLowerCase();
    const list = out.get(key) ?? [];
    if (!list.some((o) => o.type === e.origin.type && o.label === e.origin.label)) {
      list.push(e.origin);
    }
    out.set(key, list);
  }
  return out;
}

/** One skill pick, its options marked where another source already grants them. */
function noted(col: Collector, prompt: ChoicePrompt): ChoicePrompt {
  if (prompt.kind !== 'skill' && prompt.kind !== 'skillOrTool') return prompt;
  const others = skillSources(col.effects, { skip: (e) => col.pickOf.get(e) === prompt.id });
  let changed = false;
  const options = prompt.options.map((o): ChoiceOption => {
    const from = others.get(o.id.toLowerCase());
    if (from === undefined) return o;
    changed = true;
    const note = `Already proficient from ${originList(from)}.`;
    return { ...o, advisory: o.advisory !== undefined ? `${o.advisory} ${note}` : note };
  });
  return changed ? { ...prompt, options } : prompt;
}

/** Where a replacement for a skill granted twice is saved, by the skill's lowercase name. */
export const OVERLAP_PICK = 'skill:overlap:';

/**
 * The sources the rule is written for, those a character is made from: its
 * species, background and class. A subclass feature or a feat that grants a
 * skill held already says what it does instead (Survivalist doubles it), and
 * an item or a custom effect is not part of the build.
 */
const BUILD_ORIGINS = new Set<EffectOrigin['type']>(['race', 'background', 'class']);

/** The creator's order: class, then species, then background (`features/creator/steps.ts`). */
const CREATOR_ORDER: readonly EffectOrigin['type'][] = ['class', 'race', 'background'];

/** Of a skill's sources, the one whose creator step comes last. */
function lastInCreator(from: readonly EffectOrigin[]): EffectOrigin {
  const rank = (o: EffectOrigin) => CREATOR_ORDER.indexOf(o.type);
  return from.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

/**
 * Under the 2014 rules, a character who would gain the same skill from two
 * sources can choose a different skill instead (PHB, Backgrounds,
 * Proficiencies): a Sage Wizard who takes Arcana from both gets another skill.
 * One pick per skill granted twice or more, of any skill, one for each source
 * past the first. It goes to the source the creator comes to last, so it shows
 * on the step where the overlap appears (Background for a Sage Wizard). It is
 * saved by the skill, so it holds while the overlap does, whatever brings it.
 * The 2024 rules have no such swap.
 *
 * The sources are counted before any replacement is granted, so a replacement
 * that lands on a skill held already makes no overlap of its own; the cue
 * below says so.
 */
function offerOverlapReplacements(col: Collector): void {
  if (col.doc.rulesVersion !== '2014') return;
  const sources = skillSources(col.effects, { skip: (e) => !BUILD_ORIGINS.has(e.origin.type) });
  for (const { name } of SKILLS) {
    const from = sources.get(name.toLowerCase());
    if (from === undefined || from.length < 2) continue;
    const last = lastInCreator(from);
    col.choice(
      {
        id: `${OVERLAP_PICK}${name.toLowerCase()}`,
        origin: last,
        kind: 'skill',
        label: `${name} from ${originList(from)}: choose ${from.length > 2 ? `${from.length - 1} other skills` : 'another skill'} in its place`,
        count: from.length - 1,
        options: skillOptions().filter((o) => o.id.toLowerCase() !== name.toLowerCase()),
      },
      (picked) => {
        for (const skill of picked) col.add({ kind: 'skillProf', skill, level: 1, origin: last });
      },
    );
  }
}

/**
 * Offer a replacement for each skill granted twice, where the rules allow one,
 * then mark every skill pick, made or not, with what the rest of the build
 * already grants. Runs once everything is collected, because a source can come
 * after the pick it overlaps (a background's fixed skill against a class pick).
 * A cue, not a block: the option stays selectable, since the overlap may not
 * have existed when it was picked, and a 2014 duplicate can be replaced.
 */
export function noteSkillSources(col: Collector): void {
  offerOverlapReplacements(col);
  col.pending.forEach((p, i) => {
    col.pending[i] = noted(col, p);
  });
  col.resolved.forEach((r, i) => {
    const prompt = noted(col, r.prompt);
    if (prompt !== r.prompt) col.resolved[i] = { ...r, prompt };
  });
}
