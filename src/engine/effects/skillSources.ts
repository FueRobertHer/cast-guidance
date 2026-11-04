/**
 * Where a character's skill proficiencies come from, so a skill pick can say
 * which of its options the build already grants ("Already proficient from
 * Acolyte (background)") instead of letting a pick be spent on a duplicate.
 */
import type { ChoiceOption, ChoicePrompt, EffectInput, EffectOrigin } from '../types';
import type { Collector } from './base';

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
  if (prompt.kind !== 'skill') return prompt;
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

/**
 * Mark every skill pick, made or not, with what the rest of the build already
 * grants. Runs once everything is collected, because a source can come after
 * the pick it overlaps (a background's fixed skill against a class pick). A
 * cue, not a block: the option stays selectable, since the rules let a
 * duplicate be swapped and the overlap may not have existed when it was picked.
 */
export function noteSkillSources(col: Collector): void {
  col.pending.forEach((p, i) => {
    col.pending[i] = noted(col, p);
  });
  col.resolved.forEach((r, i) => {
    const prompt = noted(col, r.prompt);
    if (prompt !== r.prompt) col.resolved[i] = { ...r, prompt };
  });
}
