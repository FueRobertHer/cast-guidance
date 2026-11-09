/**
 * A Fight Club 5e `<race>` into a 5etools race (a species, in 2024 words).
 * Size, speed, ability bonuses and skills have fields of their own; traits
 * become named entries, which is where the engine looks for its curated trait
 * mechanics and its prose scan. Darkvision is read from a trait of that name.
 * Fight Club has no subraces: each one is a race of its own here too, and the
 * installed check finds an official subrace under its name (`officialNames`).
 */
import { childElements, childText, childTexts, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import {
  type AbilityKey,
  abilityKey,
  DAMAGE_TYPES,
  type Entry,
  entryName,
  plainText,
  readLanguages,
  readProficiencies,
  readText,
  splitList,
} from './text';

/** "Str 2, Con 1" or "Strength +2, Constitution +1". */
export function raceAbility(raw: string): Partial<Record<AbilityKey, number>> | undefined {
  const out: Partial<Record<AbilityKey, number>> = {};
  for (const part of raw.split(',')) {
    const m = /^\s*([A-Za-z]+)\s*([+-]?\d+)\s*$/.exec(part);
    const key = m === null ? undefined : abilityKey(m[1] ?? '');
    if (m === null || key === undefined) return undefined;
    out[key] = (out[key] ?? 0) + Number(m[2]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** "fire, cold" into damage types; undefined when anything else is said. */
function damageList(raw: string): string[] | undefined {
  const words = splitList(raw).map((w) => w.toLowerCase());
  return words.length > 0 && words.every((w) => (DAMAGE_TYPES as readonly string[]).includes(w))
    ? words
    : undefined;
}

const SIZES = new Set(['T', 'S', 'M', 'L', 'H', 'G']);

export function convertRace(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);

  const entries: Entry[] = [];
  let sourceLine: string | undefined;
  let darkvision: number | undefined;
  for (const trait of childElements(el, 'trait')) {
    const traitName = childText(trait, 'name') ?? '';
    const text = readText(childTexts(trait, 'text'));
    sourceLine = text.sourceLine ?? sourceLine;
    if (traitName === '' || /^description$/i.test(traitName)) {
      entries.push(...text.entries);
      continue;
    }
    entries.push({ type: 'entries', name: traitName, entries: text.entries });
    if (/^(?:superior )?darkvision$/i.test(traitName)) {
      const range = /\b(\d+)\s*(?:feet|ft)/i.exec(plainText(text.entries));
      if (range !== null) darkvision = Number(range[1]);
    }
  }

  const loose = readText(childTexts(el, 'text'));
  sourceLine = loose.sourceLine ?? sourceLine;
  const placement = ctx.place(sourceLine, named.edition);
  const race: Record<string, unknown> = { name: named.name };
  placeEntity(race, placement);

  const size = (childText(el, 'size') ?? '').toUpperCase();
  if (SIZES.has(size)) race.size = [size];
  const speed = Number(childText(el, 'speed'));
  if (Number.isInteger(speed) && speed > 0) race.speed = speed;

  const rawAbility = childText(el, 'ability');
  if (rawAbility !== undefined) {
    const ability = raceAbility(rawAbility);
    if (ability !== undefined) race.ability = [ability];
    else reasons.push(`its ability scores "${rawAbility}" are kept as text`);
  }

  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    if (skills.length > 0) {
      race.skillProficiencies = [Object.fromEntries(skills.map((s) => [s, true]))];
    }
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }

  if (darkvision !== undefined) race.darkvision = darkvision;
  for (const [field, key] of [
    ['resist', 'resist'],
    ['immune', 'immune'],
    ['vulnerable', 'vulnerable'],
  ] as const) {
    const raw = childText(el, field);
    if (raw === undefined) continue;
    const list = damageList(raw);
    if (list !== undefined) race[key] = list;
    else reasons.push(`its ${field} "${raw}" is kept as text`);
  }
  const rawLanguages = childText(el, 'languages');
  if (rawLanguages !== undefined) {
    const langs = readLanguages(rawLanguages);
    if (langs !== undefined) race.languageProficiencies = [langs];
    else reasons.push('its languages are kept as text');
  }
  if (childText(el, 'spellability') !== undefined || childText(el, 'spells') !== undefined) {
    reasons.push('its innate spells are kept as text');
  }
  if (childText(el, 'conditionimmune') !== undefined) {
    reasons.push('its condition immunities are kept as text');
  }
  if (childElements(el, 'modifier').length > 0) reasons.push('its modifiers are kept as text');

  entries.unshift(...loose.entries);
  race.entries = entries;
  const citation = citationEntry(placement);
  if (citation !== undefined) entries.push(citation);
  return {
    kind: 'race',
    name: named.name,
    edition: placement.edition,
    entity: race,
    placement,
    reasons,
  };
}
