/**
 * A Fight Club 5e `<background>` into a 5etools background. Fight Club writes
 * a 2024 background's rules into its trait names (`Ability Scores: Intelligence,
 * Wisdom, Charisma`, `Feat: Magic Initiate (Cleric)`, `Tool Proficiency: …`),
 * so those are read back into the fields the character builder uses; every
 * trait also stays as a named entry.
 */
import { childElements, childText, childTexts, type XmlElement } from '../xml';
import type { Fc5Context, Fc5Result } from './context';
import {
  type AbilityKey,
  abilityKey,
  type Entry,
  parenthetical,
  readLanguages,
  readProficiencies,
  readText,
  sourceLineEdition,
  splitList,
  splitName,
} from './text';

/** "Intelligence, Wisdom, Charisma" into the two 2024 arrangements: +2/+1 or +1/+1/+1. */
export function backgroundAbility(list: string): Record<string, unknown>[] | undefined {
  const from = splitList(list.replace(/\bor\b/gi, ','))
    .map((w) => abilityKey(w))
    .filter((k): k is AbilityKey => k !== undefined);
  if (from.length !== 3) return undefined;
  return [
    { choose: { weighted: { from, weights: [2, 1] } } },
    { choose: { weighted: { from, weights: [1, 1, 1] } } },
  ];
}

/** "Magic Initiate (Cleric)" into the grant key the engine reads: `magic initiate; cleric|xphb`. */
export function featGrant(raw: string, ctx: Fc5Context, edition: string): string {
  const { name } = splitName(raw);
  const parts = parenthetical(name);
  const base = (parts?.base ?? name).trim().toLowerCase();
  const option = parts?.inner.toLowerCase();
  const source = ctx.featNames.has(base) ? ctx.source : edition === '2024' ? 'XPHB' : 'PHB';
  return `${option === undefined ? base : `${base}; ${option}`}|${source.toLowerCase()}`;
}

/** The 5etools keys for "one kind of …", which the engine turns into a choice. */
const TOOL_CATEGORIES: Record<string, string> = {
  'gaming set': 'anyGamingSet',
  "artisan's tools": 'anyArtisansTool',
  'musical instrument': 'anyMusicalInstrument',
};

/**
 * A tool line into a 5etools `toolProficiencies` entry: specific tools
 * ("Calligrapher's Supplies") or a category choice ("Choose one kind of Gaming
 * Set"). Undefined for any other kind of choice.
 */
export function readTools(list: string): Record<string, unknown> | undefined {
  const text = list.replace(/’/g, "'");
  const category =
    /\bone (?:kind|type) of (gaming set|artisan's tools|musical instrument)s?\b/i.exec(text);
  const key = category === null ? undefined : TOOL_CATEGORIES[(category[1] ?? '').toLowerCase()];
  if (key !== undefined) return { [key]: 1 };
  if (/\b(?:choice|choose|one kind|one type|any)\b/i.test(text)) return undefined;
  const tools = splitList(text).map((t) => t.toLowerCase());
  return tools.length > 0 ? Object.fromEntries(tools.map((t) => [t, true])) : undefined;
}

export function convertBackground(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = splitName(rawName);

  const entries: Entry[] = [];
  const traitFields: Record<string, unknown> = {};
  let sourceLine: string | undefined;
  let grantedFeat: string | undefined;
  for (const trait of childElements(el, 'trait')) {
    const traitName = childText(trait, 'name') ?? '';
    const text = readText(childTexts(trait, 'text'));
    sourceLine = text.sourceLine ?? sourceLine;
    if (traitName === '' || /^description$/i.test(traitName)) entries.push(...text.entries);
    else entries.push({ type: 'entries', name: traitName, entries: text.entries });

    const label = /^([^:]+):\s*(.+)$/.exec(traitName);
    const key = label?.[1]?.trim().toLowerCase();
    const value = label?.[2]?.trim() ?? '';
    if (key === undefined) continue;
    if (key === 'ability scores' || key === 'ability score') {
      const ability = backgroundAbility(value);
      if (ability !== undefined) traitFields.ability = ability;
      else reasons.push('its ability scores are kept as text');
    } else if (key === 'feat') {
      grantedFeat = value;
    } else if (key === 'tool proficiency' || key === 'tool proficiencies') {
      const tools = readTools(value);
      if (tools !== undefined) traitFields.toolProficiencies = [tools];
      else reasons.push('its tool choice is kept as text');
    } else if (key === 'skill proficiencies' || key === 'skill proficiency') {
      const { skills, other } = readProficiencies(value);
      if (skills.length > 0) {
        traitFields.skillProficiencies = [Object.fromEntries(skills.map((s) => [s, true]))];
      }
      if (other.length > 0) reasons.push(`its skill choice (${other.join(', ')}) is kept as text`);
    } else if (key === 'languages' || key === 'language') {
      const langs = readLanguages(value);
      if (langs !== undefined) traitFields.languageProficiencies = [langs];
      else reasons.push('its language choice is kept as text');
    }
  }
  const loose = readText(childTexts(el, 'text'));
  entries.unshift(...loose.entries);
  sourceLine = loose.sourceLine ?? sourceLine;

  const edition =
    named.edition ??
    (sourceLine === undefined ? undefined : sourceLineEdition(sourceLine)) ??
    ctx.fileEdition;
  const background: Record<string, unknown> = { name: named.name, source: ctx.source };
  if (edition === '2024') background.edition = 'one';
  if (grantedFeat !== undefined) {
    traitFields.feats = [{ [featGrant(grantedFeat, ctx, edition ?? '2014')]: true }];
  }

  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    if (skills.length > 0) {
      background.skillProficiencies = [Object.fromEntries(skills.map((s) => [s, true]))];
    }
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }
  // A `<proficiency>` element is the format's own field, so it wins over a trait name.
  for (const [k, v] of Object.entries(traitFields)) {
    if (background[k] === undefined) background[k] = v;
  }

  background.entries = entries;
  if (sourceLine !== undefined) entries.push(`{@i Source: ${sourceLine}}`);
  return {
    kind: 'background',
    name: named.name,
    edition: edition ?? '2014',
    entity: background,
    reasons,
  };
}
