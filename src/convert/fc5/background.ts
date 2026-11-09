/**
 * A Fight Club 5e `<background>` into a 5etools background. Fight Club writes
 * a 2024 background's rules into its trait names (`Ability Scores: Intelligence,
 * Wisdom, Charisma`, `Feat: Magic Initiate (Cleric)`, `Tool Proficiency: …`),
 * so those are read back into the fields the character builder uses, as are
 * its `<tools>` and `<languages>` and the bullets of a 2014 description
 * (`• Tool Proficiencies: Herbalism kit`). Every trait also stays as a named
 * entry.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childElements, childText, childTexts, type XmlElement } from '../xml';
import {
  citationEntry,
  type Fc5Context,
  type Fc5Result,
  type FeatRef,
  placeEntity,
} from './context';
import {
  type AbilityKey,
  abilityKey,
  countWord,
  type Entry,
  entryName,
  own,
  parenthetical,
  readLanguages,
  readProficiencies,
  readText,
  readTools,
  splitList,
  withRolls,
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

/**
 * A feat's name without the group Fight Club writes before or after it,
 * lowercased: `Dragonmark, Mark of Making`, `Dark Gift: Mist Walker`, `Mist
 * Walker (Dark Gift)`, `Fey Pact (Planar Pact Feat)`. Undefined when it has
 * none.
 */
export function featAlias(name: string): string | undefined {
  const lower = name.replace(/\s+/g, ' ').trim().toLowerCase();
  const prefixed = /^[a-z' ]{1,24}[,:] (.{1,80})$/.exec(lower);
  if (prefixed !== null) return prefixed[1];
  const suffixed = /^(.{1,80}) \((?:dark gift|[a-z' ]{1,24} feat)\)$/.exec(lower);
  return suffixed?.[1];
}

/** File a converted feat under its name and its {@link featAlias}. */
export function addFeatSource(map: Map<string, FeatRef[]>, name: string, source: string): void {
  const add = (key: string, alias: boolean) => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [{ name, source, alias }]);
    else list.push({ name, source, alias });
  };
  add(name.toLowerCase(), false);
  const alias = featAlias(name);
  if (alias !== undefined) add(alias, true);
}

/**
 * The grant key of a feat this file converts, by its name or the name without
 * its group ({@link featAlias}): a feat named so before one only under another
 * name, then the background's own book before another. A feat converted whole
 * holds its choices, so the grant names it alone: `dragon fear|fcbook`.
 */
function fileFeat(name: string, ctx: Fc5Context, source: string): string | undefined {
  const lower = name.toLowerCase();
  const alias = featAlias(name);
  const candidates = [
    ...(ctx.featSources.get(lower) ?? []),
    ...(alias === undefined ? [] : (ctx.featSources.get(alias) ?? [])),
  ];
  const pick =
    candidates.find((c) => !c.alias && c.source === source) ??
    candidates.find((c) => !c.alias) ??
    candidates.find((c) => c.source === source) ??
    candidates[0];
  return pick === undefined ? undefined : `${pick.name}|${pick.source}`.toLowerCase();
}

/**
 * The grant key of an installed feat: `alert|xphb`, or for a choice the game
 * data keeps inside one feat, `magic initiate; cleric|xphb`.
 */
function officialGrant(name: string, ctx: Fc5Context, edition: RulesVersion): string | undefined {
  const lookup = ctx.officialFeat;
  if (lookup === undefined) return undefined;
  const whole = lookup(name, edition) ?? lookup(featAlias(name) ?? name, edition);
  if (whole !== undefined) return whole;
  const parts = parenthetical(name);
  const base = parts === undefined ? undefined : lookup(parts.base, edition);
  if (parts === undefined || base === undefined) return undefined;
  const bar = base.lastIndexOf('|');
  return `${base.slice(0, bar)}; ${parts.inner.toLowerCase()}${base.slice(bar)}`;
}

/** {@link fileFeat}, then {@link officialGrant}, for the feat named and then its base. */
function resolveFeat(
  name: string,
  ctx: Fc5Context,
  edition: RulesVersion,
  source: string,
): string | undefined {
  const base = parenthetical(name)?.base;
  return (
    fileFeat(name, ctx, source) ??
    (base === undefined ? undefined : fileFeat(base, ctx, source)) ??
    officialGrant(name, ctx, edition)
  );
}

/**
 * A background's `Feat:` line into the grant key the engine reads: a feat
 * this file converts ({@link fileFeat}), else the installed one
 * ({@link officialGrant}). A choice of feat ("Choose one Planar Pact feat")
 * has no key, and "Survivor or a Dark Gift feat of your choice" grants
 * Survivor; either way the reason says what stays as text.
 */
export function featGrant(
  raw: string,
  ctx: Fc5Context,
  edition: RulesVersion,
  source: string,
): { key?: string; reason?: string } {
  const value = entryName(raw).name.replace(/\s+/g, ' ').trim();
  const either = /^(.{1,60}?) or (an? [a-z' ]{1,30} feat) of your choice$/i.exec(value);
  if (either !== null) {
    const key = resolveFeat(either[1] ?? '', ctx, edition, source);
    if (key === undefined) return { reason: `its feat choice (${value}) is kept as text` };
    return {
      key,
      reason: `the choice of ${either[2] ?? 'another feat'} in its place is kept as text`,
    };
  }
  if (/\bof your choice\b|^choose\b/i.test(value)) {
    return { reason: `its feat choice (${value}) is kept as text` };
  }
  const key = resolveFeat(value, ctx, edition, source);
  return key === undefined
    ? {
        reason: `its feat (${value}) is in neither this file nor the game data, so it is kept as text`,
      }
    : { key };
}

/** What a background's rules line could not be read into, by field, in words. */
const MISSED: Record<string, string> = {
  ability: 'its ability scores are kept as text',
  toolProficiencies: 'its tool choice is kept as text',
  skillProficiencies: 'its skill choice is kept as text',
  languageProficiencies: 'its language choice is kept as text',
};

/**
 * A skill line into a `skillProficiencies` entry and what it could not read:
 * skills by name, "one skill of your choice" as a choice of any, and
 * "Arcana, History, or Religion" as a choice of one of them. The list
 * is read only while it names those, since a later item may belong to a
 * phrase: "Survival, plus one from among Arcana, History, and Religion" is
 * Survival and an unread rest, not three skills.
 */
export function readSkills(value: string): { entry?: Record<string, unknown>; rest: string[] } {
  const entry: Record<string, unknown> = {};
  const parts = splitList(value);
  // "Arcana, History, or Religion" and "Arcana or Religion": one skill of them all.
  if (/^or /i.test(parts.at(-1) ?? '') || (parts.length === 1 && / or /i.test(value))) {
    const from = parts
      .flatMap((p) => p.replace(/^or /i, '').split(/ or /i))
      .map((p) => readProficiencies(p.trim()).skills);
    return from.every((s) => s.length === 1)
      ? { entry: { choose: { from: from.map((s) => s[0] ?? '') } }, rest: [] }
      : { rest: parts };
  }
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    const { skills } = readProficiencies(part);
    const any = /^(one|two|three|four|\d) (?:other |more )?skills? of your choice$/i.exec(part);
    const count = any === null ? undefined : countWord(any[1] ?? '');
    if (skills.length === 1) entry[skills[0] ?? ''] = true;
    else if (count !== undefined) entry.any = Number(entry.any ?? 0) + count;
    else return { ...(Object.keys(entry).length > 0 ? { entry } : {}), rest: parts.slice(i) };
  }
  return Object.keys(entry).length > 0 ? { entry, rest: [] } : { rest: [] };
}

/** A rules line not read in full: the field, why, and what was read of it if anything. */
interface Missed {
  field: string;
  reason: string;
  read?: unknown;
}

/**
 * One rules line, by its label (`Tool Proficiencies`) and what follows, into
 * the field it fills. A line read is set in `fields`; what it does not read
 * goes in `missed`, said only if this line's reading is the one kept.
 */
function readRulesLine(
  label: string,
  value: string,
  fields: Record<string, unknown>,
  missed: Missed[],
): void {
  const key = label.trim().toLowerCase();
  let field: string | undefined;
  let read: unknown;
  let rest: string | undefined;
  if (key === 'ability scores' || key === 'ability score') {
    field = 'ability';
    read = backgroundAbility(value);
  } else if (key === 'tool proficiency' || key === 'tool proficiencies') {
    field = 'toolProficiencies';
    const tools = readTools(value);
    read = tools === undefined ? undefined : [tools];
  } else if (key === 'skill proficiencies' || key === 'skill proficiency') {
    field = 'skillProficiencies';
    const skills = readSkills(value);
    read = skills.entry === undefined ? undefined : [skills.entry];
    if (skills.rest.length > 0)
      rest = `its skill choice (${skills.rest.join(', ')}) is kept as text`;
  } else if (key === 'languages' || key === 'language') {
    field = 'languageProficiencies';
    const langs = readLanguages(value);
    read = langs === undefined ? undefined : [langs];
  }
  if (field === undefined || fields[field] !== undefined) return;
  if (read !== undefined) fields[field] = read;
  const reason = rest ?? (read === undefined ? own(MISSED, field) : undefined);
  if (reason !== undefined)
    missed.push(read === undefined ? { field, reason } : { field, reason, read });
}

/** The bullets of a 2014 background's description: `• Tool Proficiencies: Herbalism kit`. */
const BULLET =
  /^(skill proficienc(?:y|ies)|tool proficienc(?:y|ies)|languages?)\s*:\s*(.{1,200}?)\s*$/i;

export function convertBackground(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);

  const entries: Entry[] = [];
  // The format's own elements win over a 2024 trait name, which wins over a
  // bullet in the description.
  const elementFields: Record<string, unknown> = {};
  const traitFields: Record<string, unknown> = {};
  const bulletFields: Record<string, unknown> = {};
  const missed: Missed[] = [];
  let sourceLine: string | undefined;
  let grantedFeat: string | undefined;
  for (const trait of childElements(el, 'trait')) {
    const traitName = childText(trait, 'name') ?? '';
    const lines = childTexts(trait, 'text');
    const text = readText(lines);
    sourceLine = text.sourceLine ?? sourceLine;
    const traitEntries = withRolls(text.entries, trait);
    if (traitName === '' || /^description$/i.test(traitName)) entries.push(...traitEntries);
    else entries.push({ type: 'entries', name: traitName, entries: traitEntries });

    for (const line of lines) {
      for (const bullet of line.split('•').slice(1)) {
        const m = BULLET.exec(bullet.replace(/\s+/g, ' ').trim());
        if (m !== null) readRulesLine(m[1] ?? '', m[2] ?? '', bulletFields, missed);
      }
    }
    const label = /^([^:]+):\s*(.+)$/.exec(traitName);
    if (label === null) continue;
    if (label[1]?.trim().toLowerCase() === 'feat') grantedFeat = label[2]?.trim();
    else readRulesLine(label[1] ?? '', label[2]?.trim() ?? '', traitFields, missed);
  }
  const loose = readText(childTexts(el, 'text'));
  entries.unshift(...loose.entries);
  sourceLine = loose.sourceLine ?? sourceLine;

  const placement = ctx.place(sourceLine, named.edition);
  const background: Record<string, unknown> = { name: named.name };
  placeEntity(background, placement);
  if (grantedFeat !== undefined) {
    const grant = featGrant(grantedFeat, ctx, placement.edition, placement.source.json);
    if (grant.key !== undefined) traitFields.feats = [{ [grant.key]: true }];
    if (grant.reason !== undefined) reasons.push(grant.reason);
  }

  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    if (skills.length > 0) {
      elementFields.skillProficiencies = [Object.fromEntries(skills.map((s) => [s, true]))];
    }
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }
  const tools = childText(el, 'tools');
  if (tools !== undefined) readRulesLine('tool proficiencies', tools, elementFields, missed);
  const languages = childText(el, 'languages');
  if (languages !== undefined) readRulesLine('languages', languages, elementFields, missed);

  for (const fields of [elementFields, traitFields, bulletFields]) {
    for (const [k, v] of Object.entries(fields)) background[k] ??= v;
  }
  // Said of the reading kept: a line no other line stands in for.
  for (const m of missed) {
    const kept =
      m.read === undefined ? background[m.field] === undefined : background[m.field] === m.read;
    if (kept && !reasons.includes(m.reason)) reasons.push(m.reason);
  }

  background.entries = entries;
  const citation = citationEntry(placement);
  if (citation !== undefined) entries.push(citation);
  return {
    kind: 'background',
    name: named.name,
    edition: placement.edition,
    entity: background,
    placement,
    reasons,
  };
}
