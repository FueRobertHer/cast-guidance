/**
 * A Fight Club 5e `<feat>` into a 5etools feat. Feats are mostly prose, which
 * the engine's prose scanner already reads; what is lifted out here is what a
 * picker needs: the 2024 category (from an `Origin:` name prefix), the
 * prerequisite, ability increases, and the proficiencies its tags and its
 * sentences in the book's own words grant ({@link proficiencySentence}), with
 * the resistances and immunities it states for good ({@link standingDefenses}).
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childElements, childText, childTexts, textContent, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import {
  ABILITIES,
  type AbilityKey,
  abilityKey,
  addGrant,
  dropTagPicks,
  entryName,
  grantLines,
  type ProficiencyGrant,
  plainText,
  proficiencySentence,
  readArmor,
  readLanguages,
  readProficiencies,
  readText,
  readTools,
  readWeapons,
  resistChoice,
  standingDefenses,
  tableDamageTypes,
  withRolls,
} from './text';

export const CATEGORIES: Record<string, string> = {
  origin: 'O',
  general: 'G',
  'fighting style': 'FS',
  'epic boon': 'EB',
  'dark gift': 'DG',
};

/** `Origin: Alert` into the name and the 5etools category code. */
export function featCategory(name: string): { name: string; category?: string } {
  const m = /^(Origin|General|Fighting Style|Epic Boon|Dark Gift)(?: Feats?)?:\s*(.+)$/i.exec(name);
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
  // The 2024 Ability Score Improvement: +2 to one, or +1 to two.
  if (
    /Increase one ability score of your choice by 2,? or increase two ability scores of your choice by 1/i.test(
      prose,
    )
  ) {
    const from = Object.values(ABILITIES);
    return [{ choose: { from, amount: 2 } }, { choose: { from, count: 2 } }];
  }
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
    `Increase your (${ABILITY_WORD}(?:(?:,\\s*(?:or\\s+)?|\\s+or\\s+)${ABILITY_WORD})*)(?: scores?)? by (\\d)`,
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

/**
 * Whether a choice in a feat's text covers what its modifiers fix: Fight Club
 * writes "Increase your Intelligence, Wisdom, or Charisma score by 1" with an
 * `intelligence +1` modifier, one pick of the choice.
 */
function choiceCovers(
  fixed: Partial<Record<AbilityKey, number>>,
  prose: Record<string, unknown>[] | undefined,
): boolean {
  const choose =
    prose?.length === 1 ? (prose[0]?.choose as Record<string, unknown> | undefined) : undefined;
  if (choose === undefined || !Array.isArray(choose.from)) return false;
  const from = choose.from as string[];
  const amount = typeof choose.amount === 'number' ? choose.amount : 1;
  const count = typeof choose.count === 'number' ? choose.count : 1;
  const keys = Object.keys(fixed) as AbilityKey[];
  return keys.length <= count && keys.every((k) => from.includes(k) && fixed[k] === amount);
}

/**
 * A feat's proficiencies: its tags first, then its sentences. Skills add up
 * (a skill a choice names is not also fixed: the tag holds Fight Club's pick);
 * the other kinds come from a tag, or else every sentence's join (weapons:
 * the first sentence that grants them).
 */
function featProficiencies(
  el: XmlElement,
  grants: ProficiencyGrant[],
  edition: RulesVersion,
  reasons: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const skillEntry: Record<string, unknown> = {};
  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    for (const s of skills) skillEntry[s] = true;
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }
  const lists: Record<string, unknown>[] = [];
  const tagSkills = Object.keys(skillEntry);
  const chosen = new Set<string>();
  const named = new Set<string>();
  for (const { skills } of grants) {
    if (skills === undefined) continue;
    const choose = skills.choose as { from?: string[] } | undefined;
    if (choose !== undefined) {
      lists.push(skills);
      for (const f of choose.from ?? []) chosen.add(f);
      continue;
    }
    for (const [k, v] of Object.entries(skills)) {
      if (k === 'any') skillEntry.any = Number(skillEntry.any ?? 0) + Number(v);
      else {
        skillEntry[k] = v;
        named.add(k);
      }
    }
  }
  dropTagPicks(skillEntry, tagSkills, chosen, named);
  if (Object.keys(skillEntry).length > 0) lists.unshift(skillEntry);
  if (lists.length > 0) out.skillProficiencies = lists;

  // Armor, tools and languages from every sentence join; a weapon list is the first one's.
  const joined: ProficiencyGrant = {};
  for (const { armor, tools, languages } of grants) addGrant(joined, { armor, tools, languages });
  const fromProse = {
    weapons: grants.find((g) => g.weapons !== undefined)?.weapons,
    armor: joined.armor,
    tools: joined.tools,
    languages: joined.languages,
  };
  const tags = [
    ['weapons', 'weaponProficiencies', (raw: string) => readWeapons(raw, edition)],
    ['armor', 'armorProficiencies', readArmor],
    ['tools', 'toolProficiencies', readTools],
    ['languages', 'languageProficiencies', readLanguages],
  ] as const;
  for (const [tag, field, read] of tags) {
    const raw = childText(el, tag);
    const fromTag = raw === undefined ? undefined : read(raw);
    if (raw !== undefined && fromTag === undefined)
      reasons.push(`its ${tag} "${raw}" are kept as text`);
    const prose =
      tag === 'weapons'
        ? fromProse.weapons === undefined
          ? undefined
          : readWeapons(fromProse.weapons, edition)
        : fromProse[tag];
    const found = fromTag ?? prose;
    if (found !== undefined) out[field] = [found];
  }
  // Skilled: three skills or tools in any mix.
  const mixed = grants.find((g) => g.skillsOrTools !== undefined)?.skillsOrTools;
  if (mixed !== undefined) {
    out.skillToolLanguageProficiencies = [
      { choose: [{ from: ['anySkill', 'anyTool'], count: mixed }] },
    ];
  }
  return out;
}

/**
 * Expertise in a skill the reader picks: "Choose one skill in which you have
 * proficiency. You gain expertise with that skill", in a sentence of its own
 * right after the choice, as Prodigy, Skill Expert and Boon of Skill write
 * it. "That skill" after any other sentence may be a skill the text names.
 * Both are whole sentences: "choose one skill in which you have proficiency
 * while raging" is not the plain pick.
 */
const EXPERTISE = /^you gain expertise (?:with|in) (?:that|the chosen) skill(?:, which means .*)?$/;
const EXPERT_PICK =
  /^(?:in addition, )?choose one (?:skill (?:in which you (?:have proficiency(?: but lack expertise)?|lack expertise)|you have proficiency in)|of your skill proficiencies(?: with which you lack expertise)?)$/;

export function convertFeat(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);
  const { name, category } = featCategory(named.name);
  const text = readText(childTexts(el, 'text'));
  const placement = ctx.place(text.sourceLine, named.edition);

  const feat: Record<string, unknown> = { name };
  placeEntity(feat, placement);
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
  const proseAbility = abilityFromProse(prose);
  if (Object.keys(fixed).length > 0 && !choiceCovers(fixed, proseAbility)) feat.ability = [fixed];
  else if (proseAbility !== undefined) feat.ability = proseAbility;

  // What the feat grants for good, not an option among others ({@link grantLines}).
  const ancestry = tableDamageTypes(text.entries);
  const lines = grantLines(
    text.entries,
    (line) =>
      proficiencySentence(line, 'known') !== undefined ||
      resistChoice(line, ancestry) !== undefined ||
      EXPERT_PICK.test(line) ||
      EXPERTISE.test(line),
  );
  const grants = lines.flatMap((line) => proficiencySentence(line, 'known') ?? []);
  Object.assign(feat, featProficiencies(el, grants, placement.edition, reasons));
  Object.assign(feat, standingDefenses(text.entries));
  const seenPicks = new Set<string>();
  const resistPicks = lines.flatMap((line) => {
    const pick = resistChoice(line, ancestry);
    const key = JSON.stringify(pick);
    if (pick === undefined || seenPicks.has(key)) return [];
    seenPicks.add(key);
    return [pick];
  });
  if (resistPicks.length > 0) feat.resist = [...((feat.resist as unknown[]) ?? []), ...resistPicks];
  if (lines.some((line, i) => EXPERTISE.test(line) && EXPERT_PICK.test(lines[i - 1] ?? ''))) {
    feat.expertise = [{ anyProficientSkill: 1 }];
  }

  if (/(?:^|\n)Repeatable\b/.test(prose)) feat.repeatable = true;
  feat.entries = withRolls(text.entries, el);
  const citation = citationEntry(placement);
  if (citation !== undefined) (feat.entries as unknown[]).push(citation);
  return { kind: 'feat', name, edition: placement.edition, entity: feat, placement, reasons };
}
