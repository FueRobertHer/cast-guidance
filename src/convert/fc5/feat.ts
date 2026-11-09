/**
 * A Fight Club 5e `<feat>` into a 5etools feat. Feats are mostly prose, which
 * the engine's prose scanner already reads; what is lifted out here is what a
 * picker needs: the 2024 category (from an `Origin:` name prefix), the
 * prerequisite, ability increases and skill proficiencies.
 */
import { childElements, childText, childTexts, textContent, type XmlElement } from '../xml';
import type { Fc5Context, Fc5Result } from './context';
import {
  ABILITIES,
  type AbilityKey,
  abilityKey,
  plainText,
  readProficiencies,
  readText,
  sourceLineEdition,
  splitName,
} from './text';

const CATEGORIES: Record<string, string> = {
  origin: 'O',
  general: 'G',
  'fighting style': 'FS',
  'epic boon': 'EB',
};

/** `Origin: Alert` into the name and the 5etools category code. */
export function featCategory(name: string): { name: string; category?: string } {
  const m = /^(Origin|General|Fighting Style|Epic Boon)(?: Feats?)?:\s*(.+)$/i.exec(name);
  const code = m === null ? undefined : CATEGORIES[(m[1] ?? '').toLowerCase()];
  if (m === null || code === undefined) return { name };
  return { name: (m[2] ?? name).trim(), category: code };
}

const ABILITY_WORD = '(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)';

/** "Level 4+", "4th level". No `\b` after the `+`, which has no word boundary to find. */
const LEVEL_PREREQ = /\b(?:level\s+(\d+)\+?|(\d+)(?:st|nd|rd|th)[- ]level\b)/i;
/** "Strength or Dexterity 13+", "Strength 13+ or Dexterity 13+". */
const EITHER_ABILITY = new RegExp(
  `\\b(${ABILITY_WORD})(?:\\s+(\\d+)\\+?)?\\s+or\\s+(${ABILITY_WORD})\\s+(\\d+)(?:\\+|\\s+or\\s+higher)`,
  'i',
);
const ONE_ABILITY = new RegExp(`\\b(${ABILITY_WORD})\\s+(\\d+)(?:\\+|\\s+or\\s+higher)`, 'i');

/**
 * A prerequisite line into 5etools shape. Levels and ability minimums are
 * enforced by the sheet; anything else is kept as `other` text, which the
 * sheet shows and treats as met. The engine ANDs the abilities in one set and
 * ORs the sets, so "Strength or Dexterity 13+" is two sets, one per ability.
 */
export function readPrerequisite(raw: string): Record<string, unknown>[] {
  const base: Record<string, unknown> = {};
  let rest = raw;
  const level = LEVEL_PREREQ.exec(rest);
  if (level !== null) {
    base.level = Number(level[1] ?? level[2]);
    rest = rest.replace(level[0], '');
  }
  let alternatives: Record<string, number>[] = [];
  const either = EITHER_ABILITY.exec(rest);
  const one = either === null ? ONE_ABILITY.exec(rest) : null;
  if (either !== null) {
    const a = abilityKey(either[1] ?? '');
    const b = abilityKey(either[3] ?? '');
    const min = Number(either[4]);
    if (a !== undefined && b !== undefined) {
      alternatives = [{ [a]: Number(either[2] ?? min) }, { [b]: min }];
      rest = rest.replace(either[0], '');
    }
  } else if (one !== null) {
    const key = abilityKey(one[1] ?? '');
    if (key !== undefined) {
      alternatives = [{ [key]: Number(one[2]) }];
      rest = rest.replace(one[0], '');
    }
  }
  if (rest.replace(/[\s,;.]|\band\b|\bcharacter\b/gi, '') !== '') base.other = raw.trim();
  return alternatives.length === 0
    ? [base]
    : alternatives.map((ability) => ({ ...base, ability: [ability] }));
}

/** "Increase your Strength or Dexterity score by 1" into a 5etools ability block. */
export function abilityFromProse(prose: string): Record<string, unknown>[] | undefined {
  const anyChoice = /Increase one ability score of your choice by (\d)(?!,? or increase two)/i.exec(
    prose,
  );
  if (anyChoice !== null && !/increase two ability scores/i.test(prose)) {
    const amount = Number(anyChoice[1]);
    const choose: Record<string, unknown> = { from: Object.values(ABILITIES) };
    if (amount !== 1) choose.amount = amount;
    return [{ choose }];
  }
  const named = new RegExp(
    `Increase your (${ABILITY_WORD}(?:(?:,\\s*(?:or\\s+)?|\\s+or\\s+)${ABILITY_WORD})*) scores? by (\\d)`,
    'i',
  ).exec(prose);
  if (named === null) return undefined;
  const from = (named[1] ?? '')
    .split(/,|\bor\b/i)
    .map((w) => abilityKey(w))
    .filter((k): k is AbilityKey => k !== undefined);
  const amount = Number(named[2]);
  if (from.length === 0) return undefined;
  const [only] = from;
  if (from.length === 1 && only !== undefined) return [{ [only]: amount }];
  const choose: Record<string, unknown> = { from };
  if (amount !== 1) choose.amount = amount;
  return [{ choose }];
}

export function convertFeat(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = splitName(rawName);
  const { name, category } = featCategory(named.name);
  const text = readText(childTexts(el, 'text'));
  const edition =
    named.edition ??
    (text.sourceLine === undefined ? undefined : sourceLineEdition(text.sourceLine)) ??
    ctx.fileEdition;

  const feat: Record<string, unknown> = { name, source: ctx.source };
  if (edition === '2024') feat.edition = 'one';
  if (category !== undefined) feat.category = category;

  const prerequisite = childText(el, 'prerequisite');
  if (prerequisite !== undefined) feat.prerequisite = readPrerequisite(prerequisite);

  const fixed: Partial<Record<AbilityKey, number>> = {};
  for (const mod of childElements(el, 'modifier')) {
    const raw = textContent(mod).trim();
    const m = /^(\w+)(?:\s+score)?\s*([+-]\s*\d+)$/i.exec(raw);
    const key = m === null ? undefined : abilityKey(m[1] ?? '');
    if ((mod.attrs.category ?? '').toLowerCase() === 'ability score' && key !== undefined) {
      fixed[key] = (fixed[key] ?? 0) + Number((m?.[2] ?? '0').replace(/\s+/g, ''));
    } else reasons.push(`the modifier "${raw}" is kept as text`);
  }
  const prose = plainText(text.entries);
  if (Object.keys(fixed).length > 0) feat.ability = [fixed];
  else {
    const ability = abilityFromProse(prose);
    if (ability !== undefined) feat.ability = ability;
  }

  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    if (skills.length > 0) {
      feat.skillProficiencies = [Object.fromEntries(skills.map((s) => [s, true]))];
    }
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }

  if (/(?:^|\n)Repeatable\b/.test(prose)) feat.repeatable = true;
  feat.entries = text.entries;
  if (text.sourceLine !== undefined) {
    (feat.entries as unknown[]).push(`{@i Source: ${text.sourceLine}}`);
  }
  return { kind: 'feat', name, edition: edition ?? '2014', entity: feat, reasons };
}
