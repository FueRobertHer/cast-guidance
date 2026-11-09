/**
 * Fight Club 5e text into 5etools `entries`, and the naming conventions the
 * format's files share.
 *
 * Fight Club stores prose two ways: one `<text>` per paragraph (with empty
 * `<text/>` as spacers), or one `<text>` holding newlines. Both read the same
 * here: every non-blank line is a paragraph. On top of that, files carry
 * tables as `a | b` lines under a `Caption:` line, bullets as `• item`, a
 * `Source: Book p. 12` line, and 5etools-style lead-ins written as plain text
 * (`Repeatable. You can…`, `Versatile: A Versatile weapon…`). Each becomes
 * the 5etools shape the app renders: a table, a list, a named entry.
 *
 * Dice in prose become roll chips: `{@damage 2d6}` when a damage type follows,
 * `{@dice 2d6}` otherwise, which is what the sheet's roll parser reads.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childElements, textContent, type XmlElement } from '../xml';

export type Entry = string | Record<string, unknown>;

/** The damage types 5etools spells and the roll parser name in prose. */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export const ABILITIES = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
} as const;

export type AbilityKey = (typeof ABILITIES)[keyof typeof ABILITIES];

/** `Str`, `strength`, `STR` to `str`; undefined for anything else. */
export function abilityKey(word: string): AbilityKey | undefined {
  const w = word.trim().toLowerCase();
  for (const [full, key] of Object.entries(ABILITIES)) {
    if (w === full || w === key) return key;
  }
  return undefined;
}

export const SKILLS = [
  'acrobatics',
  'animal handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight of hand',
  'stealth',
  'survival',
] as const;

/** Split a comma list ("Insight, Religion", "a, b, and c"), trimmed, blanks dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/,|;|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * A Fight Club proficiency list into its skills (lowercased, 5etools keys) and
 * whatever else it named (saving throws, unknown words), so a caller can say
 * what it could not place.
 */
export function readProficiencies(text: string): { skills: string[]; other: string[] } {
  const skills: string[] = [];
  const other: string[] = [];
  for (const part of splitList(text)) {
    const lower = part.toLowerCase();
    if ((SKILLS as readonly string[]).includes(lower)) skills.push(lower);
    else other.push(part);
  }
  return { skills, other };
}

/**
 * A table lookup by a key read from the file, which sees only the table's own
 * keys: `constructor` or `__proto__` in a file is not a match.
 */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * "Fighter (Eldritch Knight)" into the name and what its final parentheses
 * hold, or undefined. A scan rather than a pattern such as
 * `^(.+?)\s*\((.+)\)$`, which backtracks over a long run of `(`.
 */
export function parenthetical(text: string): { base: string; inner: string } | undefined {
  if (!text.endsWith(')')) return undefined;
  const open = text.indexOf('(', 1);
  if (open === -1 || open === text.length - 1) return undefined;
  const inner = text.slice(open + 1, -1);
  return inner === '' ? undefined : { base: text.slice(0, open).trim(), inner: inner.trim() };
}

/**
 * The last bracketed group of a name and what comes before it, matching
 * brackets from the end: `Acrobat (UA) (Proficient)` is `Acrobat (UA)` and
 * `Proficient`. Undefined when the name does not end in one, or either side
 * is empty.
 */
export function lastGroup(text: string): { base: string; inner: string } | undefined {
  if (!text.endsWith(')')) return undefined;
  let depth = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if (ch === ')') depth += 1;
    else if (ch === '(') {
      depth -= 1;
      if (depth === 0) {
        const inner = text.slice(i + 1, -1).trim();
        const base = text.slice(0, i).trim();
        return inner === '' || base === '' ? undefined : { base, inner };
      }
    }
  }
  return undefined;
}

/**
 * The books and kinds of book Fight Club writes into a name, lowercased:
 * `Changeling (UA)`, `Aarakocra (Legacy)`, `Bullywug (DMG NPC)`, `Dead (HB)`,
 * `Arcane Focus (Generic Variant)`, `Airship (Vehicle)`. Its `Source:` line
 * names the book in full, so the tag only keeps the name from matching.
 */
const BOOK_TAGS = new Set([
  'legacy',
  'dmg',
  'dmg npc',
  'wgte',
  'ua',
  'tp',
  'hb',
  'vd',
  'ai',
  'generic variant',
  'vehicle',
]);

/**
 * A name without the book tags among its trailing brackets, wherever they sit
 * in the run: `Dragon Fear (Charisma) (HB)` is `Dragon Fear (Charisma)`, and
 * `Acrobat (UA) (Proficient)` is `Acrobat (Proficient)`. `legacy` says the
 * entry is the 2014 one.
 */
export function stripBookTags(raw: string): { name: string; tags: string[] } {
  const kept: string[] = [];
  const tags: string[] = [];
  let name = raw;
  // No real name ends in more than a few brackets; the rest stay in the name.
  for (let n = 0; n < MAX_TRAILING_GROUPS; n += 1) {
    const group = lastGroup(name);
    if (group === undefined) break;
    const tag = group.inner.toLowerCase();
    if (BOOK_TAGS.has(tag)) tags.push(tag);
    else kept.push(group.inner);
    name = group.base;
  }
  if (tags.length === 0) return { name: raw, tags };
  tags.reverse();
  kept.reverse();
  return { name: [name, ...kept.map((k) => `(${k})`)].join(' '), tags };
}

/** How many trailing brackets {@link stripBookTags} looks at. */
const MAX_TRAILING_GROUPS = 8;

/** Wider than any table a rules entry has; see `readText`. */
const MAX_TABLE_COLUMNS = 24;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

export function countWord(word: string): number | undefined {
  const w = word.toLowerCase();
  const n = own(NUMBER_WORDS, w) ?? Number(w);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * A language line into a 5etools `languageProficiencies` entry: "Common,
 * Elvish", "Two of your choice", "Common and one extra language of your
 * choice". Undefined when it says something else (a choice from a list).
 */
export function readLanguages(raw: string): Record<string, unknown> | undefined {
  // One space between words, so no pattern below backtracks over a long run.
  const text = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    // "Two of your choice (Celestial or Gith recommended)": advice, not a list.
    .replace(/ \([^()]{0,120}\brecommended\)$/i, '');
  // "Choose one of Elvish, Giant, or Kraul", "Choose either Abyssal or Giant",
  // "Choose one of Elvish, Dwarvish and Gnomish".
  const pick = /^(?:choose (?:one of|either)|one of your choice of) (.+)$/i.exec(text);
  if (pick !== null) {
    const from = (pick[1] ?? '')
      .split(/,|\bor\b|\band\b/i)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (from.length < 2 || !from.every(languageName)) return undefined;
    return { choose: { from: from.map((l) => l.toLowerCase()) } };
  }
  const out: Record<string, unknown> = {};
  const choice =
    /(?:^|,?\s*(?:and|plus)\s+)(?:any\s+)?(one|two|three|four|\d)\s+(?:extra\s+|other\s+|additional\s+|standard\s+)*(?:languages?\s+)?of your choice$/i.exec(
      text,
    );
  let named = text;
  if (choice !== null) {
    const count = countWord(choice[1] ?? '');
    if (count === undefined) return undefined;
    out.anyStandard = count;
    named = text.slice(0, choice.index);
  }
  for (const name of splitList(named)) {
    // `Any 1 language`, `Any two languages`: the tag some files use for a choice.
    const any =
      /^any (one|two|three|four|\d) (?:other |extra |additional |standard )?languages?$/i.exec(
        name,
      );
    if (any !== null) {
      const count = countWord(any[1] ?? '');
      if (count === undefined) return undefined;
      out.anyStandard = Number(out.anyStandard ?? 0) + count;
      continue;
    }
    // "Draconic or Elven", "either Abyssal or Void Speech": one of them.
    const either = /^(?:either )?([^,]{1,40}) or ([^,]{1,40})$/i.exec(name);
    if (either !== null && out.choose === undefined) {
      const from = [either[1] ?? '', either[2] ?? ''].map((l) => l.trim());
      if (!from.every(languageName)) return undefined;
      out.choose = { from: from.map((l) => l.toLowerCase()) };
      continue;
    }
    if (!languageName(name)) return undefined;
    out[name.toLowerCase()] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Whether a list item is a language's name ("Deep Speech", "Thieves' Cant")
 * rather than a phrase about languages: "the languages you knew in life",
 * "you only speak Common", "telepathy 120 ft.", "one racial language".
 */
function languageName(name: string): boolean {
  return (
    /^[A-Za-z][A-Za-z' -]{0,30}$/.test(name) &&
    name.split(' ').length <= 3 &&
    !/^(?:one|two|three|four|an?) /i.test(name) &&
    !/\b(?:choice|choose|any|or|and|either|you|your|the|of|other|though|only|can|speak|know|most|from|all|as|in|through|understand|communicate|languages|telepathy)\b/i.test(
      name,
    )
  );
}

/** The base weapons by their 5etools names, to check a list a file words its own way. */
const WEAPONS = new Set([
  'battleaxe',
  'blowgun',
  'club',
  'dagger',
  'dart',
  'flail',
  'glaive',
  'greataxe',
  'greatclub',
  'greatsword',
  'halberd',
  'hand crossbow',
  'handaxe',
  'heavy crossbow',
  'javelin',
  'lance',
  'light crossbow',
  'light hammer',
  'longbow',
  'longsword',
  'mace',
  'maul',
  'morningstar',
  'net',
  'pike',
  'quarterstaff',
  'rapier',
  'scimitar',
  'shortbow',
  'shortsword',
  'sickle',
  'sling',
  'spear',
  'trident',
  'war pick',
  'warhammer',
  'whip',
]);

/** `Shortswords`, `short bow` into a base weapon's name, or undefined. */
function weaponName(word: string): string | undefined {
  const w = word.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const candidate of [
    w,
    w.replace(/s$/, ''),
    w.replace(/ /g, ''),
    w.replace(/s$/, '').replace(/ /g, ''),
  ]) {
    if (WEAPONS.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * A weapon list into a 5etools `weaponProficiencies` entry: named weapons
 * (`Battleaxe, Handaxe`), a category (`Simple Weapons`), or a choice (`Two
 * martial weapons of your choice`). Undefined when anything is said that is
 * none of those (`Finesse Weapon`, `Improvised Weapons`).
 */
export function readWeapons(
  raw: string,
  edition: RulesVersion,
): Record<string, unknown> | undefined {
  const text = raw.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const choice = /^(one|two|three|four|\d) (martial|simple) weapons? of your choice$/i.exec(text);
  if (choice !== null) {
    const count = countWord(choice[1] ?? '');
    if (count === undefined) return undefined;
    const category = (choice[2] ?? '').toLowerCase();
    return { choose: { fromFilter: `type=${category} weapon|miscellaneous=mundane`, count } };
  }
  const book = edition === '2024' ? 'xphb' : 'phb';
  const out: Record<string, unknown> = {};
  for (const part of splitList(text)) {
    // `improvised` and `firearms` are 5etools keys too (Tavern Brawler, Gunner).
    const category = /^(simple|martial|improvised) weapons?$|^(firearms)$/i.exec(part);
    if (category !== null) {
      out[(category[1] ?? category[2] ?? '').toLowerCase()] = true;
      continue;
    }
    const name = weaponName(part);
    if (name === undefined) return undefined;
    out[`${name}|${book}`] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const ARMOR: Record<string, string> = {
  'light armor': 'light',
  'medium armor': 'medium',
  'heavy armor': 'heavy',
  shield: 'shield',
  shields: 'shield',
};

/** `Light Armor, Medium Armor, Shields` into a 5etools `armorProficiencies` entry. */
export function readArmor(raw: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const part of splitList(raw.replace(/\.$/, ''))) {
    const key = own(ARMOR, part.toLowerCase());
    if (key === undefined) return undefined;
    out[key] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The 5etools keys for "one kind of …", which the engine turns into a choice. */
const TOOL_CATEGORIES: Record<string, string> = {
  'gaming set': 'anyGamingSet',
  "artisan's tools": 'anyArtisansTool',
  "artisan's tool": 'anyArtisansTool',
  'musical instrument': 'anyMusicalInstrument',
};

/** `Gaming Sets`, `artisan's tool` as a {@link TOOL_CATEGORIES} key, or undefined. */
function toolCategory(word: string): string | undefined {
  const w = word.toLowerCase().replace(/’/g, "'").trim();
  return own(TOOL_CATEGORIES, w) ?? own(TOOL_CATEGORIES, w.replace(/s$/, ''));
}

/** Words that make a tool list a sentence rather than names: "Special (see origin below)". */
const NOT_A_TOOL =
  /\b(?:see|special|table|from|choice|choose|any|your|other|type|kind|proficienc[a-z]*|recommended|appropriate)\b/i;

/** Other spellings the files use for a tool of the rules, by that tool's name. */
const TOOL_SPELLINGS: Record<string, string> = {
  "alchemist's tools": "alchemist's supplies",
  "calligrapher's tools": "calligrapher's supplies",
  'forgery tools': 'forgery kit',
  'herbalist kit': 'herbalism kit',
  "herbalist's kit": 'herbalism kit',
  'land vehicles': 'vehicles (land)',
  'land-based vehicles': 'vehicles (land)',
  'thieves tools': "thieves' tools",
  'vehicle (land)': 'vehicles (land)',
  'vehicle (water)': 'vehicles (water)',
  'water vehicles': 'vehicles (water)',
};

/**
 * A tool's own name ("Thieves' tools", "Vehicles (land)"), lowercased, or
 * undefined. A spelling of a tool of the rules ("Disguise kits", "Thieves
 * tools") becomes that tool's name; any other name stays as the file writes it.
 */
function toolName(part: string): string | undefined {
  const name = part.toLowerCase();
  if (!/^[a-z][a-z' -]{0,30}(?: \([a-z]{1,12}\))?$/.test(name)) return undefined;
  if (NOT_A_TOOL.test(name) || /^(?:one|two|three|four|an?|\d) /.test(name)) return undefined;
  const single = name.replace(/s$/, '');
  return own(TOOL_SPELLINGS, name) ?? (KNOWN_TOOLS.has(single) ? single : name);
}

/**
 * One item of a tool list: a kind of tool, which is a choice of that many
 * ("Gaming Set", "One type of gaming set", "One set of artisan's tools", "1
 * Musical Instrument of your choice"), any tool ("Two of your choice", "1 tool
 * of your choice"), or a tool's own name. Undefined for anything else.
 */
function toolPart(part: string): { key: string; count: number } | { name: string } | undefined {
  const anyTool = /^(one|two|three|four|\d) (?:tools? )?of your choice$/i.exec(part);
  const anyCount = anyTool === null ? undefined : countWord(anyTool[1] ?? '');
  if (anyCount !== undefined) return { key: 'any', count: anyCount };
  const counted =
    /^(?:choose )?(?:(one|two|three|four|an?|\d) )?(?:(?:type|kind|set)s? of )?([a-z' ]{0,30}?)(?: of your choice)?$/i.exec(
      part,
    );
  if (counted !== null) {
    const word = (counted[1] ?? '').toLowerCase();
    const count = word === '' || word === 'a' || word === 'an' ? 1 : countWord(word);
    const kind = (counted[2] ?? '').toLowerCase();
    const key =
      kind === '' || /^tools?$/.test(kind) ? (word === '' ? undefined : 'any') : toolCategory(kind);
    if (count !== undefined && key !== undefined) return { key, count };
  }
  const name = toolName(part);
  return name === undefined ? undefined : { name };
}

/**
 * A tool line into a 5etools `toolProficiencies` entry: tools by name and kinds
 * of tool ("One type of gaming set, thieves' tools"), any tool ("Two of your
 * choice"), or one to pick from a list ("Your choice of a gaming set or a
 * musical instrument", "Artisan's tools of your choice: smith's tools,
 * brewer's supplies, or mason's tools", "Disguise kit, forgery kit, or
 * thieves' tools (one of your choice)"). Undefined for anything else, so the
 * line stays as text.
 */
export function readTools(list: string): Record<string, unknown> | undefined {
  const text = list
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '')
    // "One gaming set of your choice (such as playing cards …)": an example, not a list.
    .replace(/ \((?:such as|e\.g\.|one of your choice)[^()]{0,160}\)$/i, '');
  const from = /^(?:[a-z' ]{1,40}) of your choice: (.+)$/i.exec(text);
  const alternatives =
    from?.[1] ??
    (/ or /i.test(text) && !/\band\b/i.test(text)
      ? text.replace(/^your choice of /i, '')
      : undefined);
  if (alternatives !== undefined) {
    const options: string[] = [];
    for (const part of alternatives.split(/,|\bor\b/i)) {
      const trimmed = part.trim().replace(/^(?:one (?:type |kind )?of |an? |one )/i, '');
      if (trimmed === '') continue;
      const category = toolCategory(trimmed);
      const name = category === undefined ? toolName(trimmed) : undefined;
      // A kind of tool in a `from` list is its group's name, which the engine expands.
      const option = category !== undefined ? own(CATEGORY_GROUPS, category) : name;
      if (option === undefined) return undefined;
      options.push(option);
    }
    return options.length >= 2 ? { choose: { from: options } } : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const part of splitList(text)) {
    const read = toolPart(part);
    if (read === undefined) return undefined;
    if ('name' in read) out[read.name] = true;
    else out[read.key] = Number(out[read.key] ?? 0) + read.count;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The tools of the rules, by name: a tool a sentence names must be one of these. */
const KNOWN_TOOLS = new Set([
  "alchemist's supplies",
  "brewer's supplies",
  "calligrapher's supplies",
  "carpenter's tools",
  "cartographer's tools",
  "cobbler's tools",
  "cook's utensils",
  "glassblower's tools",
  "jeweler's tools",
  "leatherworker's tools",
  "mason's tools",
  "painter's supplies",
  "potter's tools",
  "smith's tools",
  "tinker's tools",
  "weaver's tools",
  "woodcarver's tools",
  'bagpipes',
  'drum',
  'dulcimer',
  'flute',
  'horn',
  'lute',
  'lyre',
  'pan flute',
  'shawm',
  'viol',
  'dice set',
  'dragonchess set',
  'playing card set',
  'three-dragon ante set',
  'disguise kit',
  'forgery kit',
  'herbalism kit',
  "navigator's tools",
  "poisoner's kit",
  "thieves' tools",
  'vehicles (land)',
  'vehicles (water)',
]);

/** What a proficiency sentence grants, in 5etools fields ({@link proficiencySentence}). */
export interface ProficiencyGrant {
  skills?: Record<string, unknown>;
  /** A weapon list {@link readWeapons} reads, read once the entry's edition is known. */
  weapons?: string;
  armor?: Record<string, unknown>;
  tools?: Record<string, unknown>;
}

/** Skill names by their 5etools keys, or undefined if any is not a skill. */
function skillNames(list: string[]): string[] | undefined {
  const names = list.map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
  return names.length > 0 && names.every((n) => (SKILLS as readonly string[]).includes(n))
    ? names
    : undefined;
}

/**
 * A sentence that grants proficiency in the book's own words, lowercased and
 * without its full stop: "you gain proficiency in the intimidation skill", "in
 * the acrobatics or athletics skill (your choice)", "in two skills of your
 * choice", "in one of the following skills of your choice: …", "with the
 * longsword, shortsword, shortbow, and longbow", "with light and medium
 * armor", "with cook's utensils if you don't already have it". A tool is read
 * only where `tools` allows: `known` for a tool of the rules or a kind of tool
 * ("one type of artisan's tools of your choice"), `any` for any name, `none`
 * not at all. Undefined for any other sentence, or one not read in full.
 */
export function proficiencySentence(
  sentence: string,
  tools: 'any' | 'known' | 'none',
): ProficiencyGrant | undefined {
  const s = sentence.replace(/ if you don't already have (?:it|this proficiency)$/, '');
  const skill =
    /^you (?:have|gain) proficiency in the (.{1,80}) skills?(?: \(your choice\))?$/.exec(s);
  if (skill !== null) {
    const list = skill[1] ?? '';
    if (/ or /.test(list)) {
      const from = skillNames(list.split(/,|\bor\b/));
      return from === undefined ? undefined : { skills: { choose: { from } } };
    }
    const named = skillNames(splitList(list));
    return named === undefined
      ? undefined
      : { skills: Object.fromEntries(named.map((n) => [n, true])) };
  }
  const anySkill = /^you (?:have|gain) proficiency in (one|two|three) skills? of your choice$/.exec(
    s,
  );
  if (anySkill !== null) {
    const count = countWord(anySkill[1] ?? '');
    return count === undefined ? undefined : { skills: { any: count } };
  }
  const fromSkills =
    /^you (?:have|gain) proficiency (?:in|with) (?:your choice of )?(one|two|three) of the following skills(?: of your choice)?: (.{1,200})$/.exec(
      s,
    );
  if (fromSkills !== null) {
    const count = countWord(fromSkills[1] ?? '');
    const from = skillNames((fromSkills[2] ?? '').split(/,|\band\b|\bor\b/));
    if (count === undefined || from === undefined) return undefined;
    return { skills: { choose: count === 1 ? { from } : { from, count } } };
  }
  const withWhat = /^you (?:have|gain) proficiency (?:with|in) (?:the )?(.{1,160})$/.exec(s);
  if (withWhat === null) return undefined;
  const list = (withWhat[1] ?? '').replace(/\bthe /g, '');
  if (readWeapons(list, '2014') !== undefined) return { weapons: list };
  // Light and medium armor: each kind its own item.
  const armor = readArmor(list.replace(/\b(light|medium|heavy)\b(?! armor)/g, '$1 armor'));
  if (armor !== undefined) return { armor };
  if (tools === 'none') return undefined;
  // Armor, weapons or skills the readers above did not take are no tools.
  if (/\b(?:armor|weapons?|shields?|skills?|saving throws?)\b/.test(list)) return undefined;
  const read = readTools(list);
  if (read === undefined) return undefined;
  const known = Object.keys(read).every(
    (k) => k === 'choose' || k === 'any' || k.startsWith('any') || KNOWN_TOOLS.has(k),
  );
  const choices = (read.choose as { from?: string[] } | undefined)?.from ?? [];
  const knownChoices = choices.every(
    (t) => KNOWN_TOOLS.has(t) || own(CATEGORY_GROUPS_BY_NAME, t) !== undefined,
  );
  return tools === 'any' || (known && knownChoices) ? { tools: read } : undefined;
}

/** Every sentence of an entry's text, lowercased, without its full stop or a bullet. */
export function sentences(prose: string): string[] {
  return prose
    .split(/\n|(?<=\.) /)
    .map((line) =>
      line
        .replace(/^[•·*-] ?/, '')
        .trim()
        .replace(/\.$/, '')
        .toLowerCase(),
    )
    .filter((line) => line !== '');
}

/** What a sentence says its reader resists, is immune or vulnerable to ({@link defenseSentence}). */
export interface Defenses {
  resist?: string[];
  immune?: string[];
  vulnerable?: string[];
  conditionImmune?: string[];
}

const DAMAGE = `(?:${DAMAGE_TYPES.join('|')})`;
/** "fire", "cold and necrotic", "lightning damage and thunder", "bludgeoning, piercing, and slashing". */
const DAMAGE_LIST = `${DAMAGE}(?: damage)?(?:(?:,| and|, and) ${DAMAGE}(?: damage)?){0,12}`;
/** Who a clause is about: "you have", "you are", or a clause joined on with "and". */
const SUBJECT = "(?:^|[ ,])(?:you (?:also )?(?:have|gain) |you(?:'re| are) |and (?:are |have )?)";
const CONDITION =
  '(?:blinded|charmed|deafened|exhaustion|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned)';
const CONDITION_LIST = `${CONDITION}(?:(?:,| and|, and) ${CONDITION}){0,8}`;
/**
 * A clause ends the sentence or gives way to the next one, never "damage from
 * nonmagical attacks", and never partway through its own list: "the charmed
 * and frightened conditions from spells" is not "the charmed".
 */
const CLAUSE_END = `(?=$|,| and )(?!(?:,|,? and)(?: the)? (?:${CONDITION}|${DAMAGE})\\b)`;
const DAMAGE_CLAUSE = new RegExp(
  `${SUBJECT}(resistance|immunity|immune|vulnerable|vulnerability) (?:to|against) (${DAMAGE_LIST}) damage(?: and the (${CONDITION_LIST}) conditions?)?${CLAUSE_END}`,
  'g',
);
const CONDITION_CLAUSE = new RegExp(
  `${SUBJECT}(?:immune|immunity) to (?:the )?(${CONDITION_LIST})(?: conditions?)?(?: and (${DAMAGE_LIST}) damage)?${CLAUSE_END}`,
  'g',
);
const BEING_CLAUSE = new RegExp(
  `${SUBJECT}immune to being (charmed|frightened|paralyzed|petrified|poisoned|knocked prone|stunned)${CLAUSE_END}`,
  'g',
);
/**
 * A word that makes a defense last only a while, or hang on a choice or a
 * proviso, or belong to someone else: "for 1 minute", "when you", "one of the
 * following", "as long as", "your allies", "your familiar", "ignore
 * resistance".
 */
export const NOT_STANDING =
  /\b(?:can|can't|cannot|when|whenever|if|until|unless|once|while|action|reaction|after|each time|minutes?|hours?|rounds?|turns?|choose|chosen|choice|one of|instead|except|half|only|lose|loses|no longer|duration|creatures?|ally|allies|target|within|form|state|rage|raging|as long as|provided|but|familiar|steed|companion|(?:ignor(?:e|es|ing)|bypass(?:es|ing)?) (?:resistance|immunity))\b/;

/**
 * The resistances and immunities a sentence about "you" states in the book's
 * own words, lowercased and without its full stop: "you have resistance to
 * cold damage", "you are immune to necrotic and cold damage and vulnerable to
 * fire and radiant damage", "you gain a +1 bonus to ac and resistance to
 * radiant damage", "you are immune to the poisoned condition". Undefined for a
 * sentence that says none, or says one that lasts only a while or hangs on a
 * choice ({@link NOT_STANDING}). The caller decides when the sentence holds:
 * an item's while you wear it, a race's always.
 */
export function defenseSentence(raw: string): Defenses | undefined {
  const sentence = raw.replace(/’/g, "'");
  if (!/^you\b/.test(sentence) || NOT_STANDING.test(sentence)) return undefined;
  const out: Required<Defenses> = { resist: [], immune: [], vulnerable: [], conditionImmune: [] };
  const add = (list: string[], words: string[]) => {
    for (const w of words) if (!list.includes(w)) list.push(w);
  };
  const words = (list: string, pattern: string) => list.match(new RegExp(pattern, 'g')) ?? [];
  // "Immunity to Poison damage and the Poisoned condition": both kinds in one clause.
  for (const m of sentence.matchAll(DAMAGE_CLAUSE)) {
    const kind = m[1] ?? '';
    const types = words(m[2] ?? '', DAMAGE);
    if (kind === 'resistance') add(out.resist, types);
    else if (kind.startsWith('vulnerab')) add(out.vulnerable, types);
    else {
      add(out.immune, types);
      add(out.conditionImmune, words(m[3] ?? '', CONDITION));
    }
  }
  // "Immunity to the Poisoned condition and Poison damage": both kinds in one clause.
  for (const m of sentence.matchAll(CONDITION_CLAUSE)) {
    add(out.conditionImmune, words(m[1] ?? '', CONDITION));
    add(out.immune, words(m[2] ?? '', DAMAGE));
  }
  for (const m of sentence.matchAll(BEING_CLAUSE)) {
    add(out.conditionImmune, [(m[1] ?? '').replace('knocked ', '')]);
  }
  const found = Object.fromEntries(Object.entries(out).filter(([, v]) => v.length > 0)) as Defenses;
  return Object.keys(found).length > 0 ? found : undefined;
}

/** `b`'s defenses added to `a`'s, each kind without repeats. */
export function addDefenses(a: Defenses, b: Defenses | undefined): Defenses {
  if (b === undefined) return a;
  const out: Defenses = { ...a };
  for (const key of ['resist', 'immune', 'vulnerable', 'conditionImmune'] as const) {
    const more = b[key];
    if (more === undefined) continue;
    out[key] = [...new Set([...(out[key] ?? []), ...more])];
  }
  return out;
}

/** A Fight Club `<roll>`: its dice, and the label its button shows. */
export interface FileRoll {
  description?: string;
  dice: string;
}

/** Dice alone, as a roll tag holds them: "1d20+8", "2d6", "d8". */
const PLAIN_DICE = /^(\d{0,3})d(\d{1,3})([+-]\d{1,3})?$/i;
/** A roll tag in text, its dice in the first group. */
const ANY_ROLL_TAG = /\{@(?:dice|damage|scaledice|scaledamage) ([^}|]{1,40})/g;

/** "d8" and "1d8" as one roll, without spaces. */
function sameDice(dice: string): string {
  return dice.replace(/\s+/g, '').toLowerCase().replace(/^d/, '1d');
}

/**
 * The rolls a Fight Club element lists in `<roll>` that its text never shows
 * as a roll, as one line of roll tags ("{@b Rolls:} Attack Bonus {@dice
 * 1d20+8}"): the file shows each as a button, and a tag is how a roll reaches
 * the sheet. Left out: a roll the text already tags (a table's die column
 * included) or `shown` names (a weapon's damage dice), one without a label to
 * say what it is for, and one that names the caster's modifier or level
 * (`1d8+%0`, `SPELL`).
 */
export function rollLine(
  rolls: readonly FileRoll[],
  entries: readonly Entry[],
  shown: readonly string[] = [],
): string | undefined {
  const tagged = [...JSON.stringify(entries).matchAll(ANY_ROLL_TAG)].map((m) => m[1] ?? '');
  const known = new Set([...tagged, ...shown].map(sameDice));
  const parts: string[] = [];
  for (const roll of rolls) {
    const dice = roll.dice.replace(/\s+/g, '');
    const label = (roll.description ?? '').replace(/[{}]/g, '').trim();
    const core = sameDice(dice).replace(/[+-]\d+$/, '');
    if (label === '' || !PLAIN_DICE.test(dice) || known.has(sameDice(dice)) || known.has(core)) {
      continue;
    }
    const tag = /\bdamage\b/i.test(label) ? `{@damage ${dice}}` : `{@dice ${dice}}`;
    // A roll the file lists twice under one label, once.
    if (!parts.includes(`${label} ${tag}`)) parts.push(`${label} ${tag}`);
  }
  return parts.length > 0 ? `{@b Rolls:} ${parts.join('; ')}` : undefined;
}

/** `entries`, then the {@link rollLine} for the element's own `<roll>`s, if any. */
export function withRolls(
  entries: Entry[],
  el: XmlElement,
  shown: readonly (string | undefined)[] = [],
): Entry[] {
  const rolls = childElements(el, 'roll').map((r) => ({
    description: r.attrs.description,
    dice: textContent(r).trim(),
  }));
  const line = rollLine(
    rolls,
    entries,
    shown.filter((s): s is string => s !== undefined),
  );
  return line === undefined ? entries : [...entries, line];
}

/** A tag's shown text: `{@dice 1d6}` to `1d6`. */
const TAG_TEXT = /\{@\w+ ([^|{}]*)(?:\|[^{}]*)?\}/g;

/**
 * A lead-in to a list whose items all hold: "You gain the following
 * benefits:", "This is represented by the following:".
 */
const FOLLOWING = /\bthe following(?: [a-z]{1,20}){0,3}:$/;
/** Text that offers a choice: what comes after it is one option, not a given. */
const OFFERS_CHOICE = /\b(?:choose|chosen|choice|one of|options?)\b/;

/**
 * The defenses a race trait's or a feat's text grants for good, in the book's
 * own words ({@link defenseSentence}): the first sentence of each paragraph,
 * and of each list item after a lead-in that holds for good too ("You gain the
 * following benefits:", not "While raging, you gain the following benefits:").
 * A later sentence in a paragraph may hang on an earlier one, so it stays text,
 * and once the text offers a choice, nothing after it at that level is read. A
 * named part ("While Raging: …") is read only where its name sets no such
 * terms, and not after a lead-in that does not hold for good ("Your hide adapts
 * to where you live:").
 */
export function standingDefenses(entries: readonly unknown[]): Defenses {
  let out: Defenses = {};
  const lines = (text: string) => sentences(text.replace(TAG_TEXT, '$1'));
  const read = (text: string) => {
    out = addDefenses(out, defenseSentence(lines(text)[0] ?? ''));
  };
  /**
   * Walks one level, and says how its last line leads in to what follows it:
   * a named part's "Choose one of the following options:" leads in to the
   * list after the part, while a choice the part settles itself ("Increase
   * one ability score of your choice") leaves the parts beside it alone.
   */
  const walk = (list: readonly unknown[]): 'none' | 'stands' | 'not' => {
    let lead: 'none' | 'stands' | 'not' = 'none';
    for (const e of list) {
      if (typeof e === 'string') {
        read(e);
        const last = lines(e).at(-1) ?? '';
        lead = !last.endsWith(':')
          ? 'none'
          : FOLLOWING.test(last) && !NOT_STANDING.test(last)
            ? 'stands'
            : 'not';
        if (OFFERS_CHOICE.test(e.toLowerCase())) return lead;
      } else if (e !== null && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        // A lead-in holds over every list after it: Fight Club gives each item its own list.
        if (Array.isArray(o.items)) {
          if (lead === 'stands')
            for (const item of o.items) if (typeof item === 'string') read(item);
        } else if (Array.isArray(o.entries)) {
          const name = typeof o.name === 'string' ? o.name.toLowerCase() : '';
          if (lead === 'not' || NOT_STANDING.test(name) || OFFERS_CHOICE.test(name)) continue;
          lead = walk(o.entries);
        }
      }
    }
    return lead;
  };
  walk(entries);
  return out;
}

/** The names {@link CATEGORY_GROUPS} gives, to check a `choose.from` option. */
const CATEGORY_GROUPS_BY_NAME: Record<string, true> = {
  'gaming set': true,
  "artisan's tools": true,
  'musical instrument': true,
};

/** A {@link TOOL_CATEGORIES} key's group name, as a `choose.from` option. */
const CATEGORY_GROUPS: Record<string, string> = {
  anyGamingSet: 'gaming set',
  anyArtisansTool: "artisan's tools",
  anyMusicalInstrument: 'musical instrument',
};

/**
 * The edition marker a name carries: `Fireball [5.5e]`, `Alert [2024]`. Files
 * built from the SRD 5.2 or by the community converters tag every 2024 entry
 * this way. A bracket that is not a marker (`Sword [Cursed]`) stays in the name.
 */
const NAME_MARKER = /\s*\[([^\]]{1,12})\]\s*$/;

export function markerEdition(marker: string): RulesVersion | undefined {
  if (/^(?:5\.5e?|2024|XPHB|XDMG|XMM|5\.2(?:\.1)?)$/i.test(marker)) return '2024';
  // `Eldritch Invocations [Legacy]`: the 2014 list, in a 5.5e file.
  if (/^(?:5e|5\.0e?|5\.1e?|2014|PHB|DMG|MM|Legacy)$/i.test(marker)) return '2014';
  return undefined;
}

export function splitName(raw: string): { name: string; edition?: RulesVersion } {
  const name = raw.replace(/\s+/g, ' ').trim();
  const m = NAME_MARKER.exec(name);
  const marker = m?.[1];
  if (m === null || marker === undefined) return { name };
  const isMarker =
    /^(?:\d(?:\.\d)*e?|20\d\d|legacy)$/i.test(marker) || /^[A-Z0-9]{2,8}$/.test(marker);
  if (!isMarker) return { name };
  const edition = markerEdition(marker);
  const stripped = name.slice(0, m.index).trim();
  if (stripped === '') return { name };
  return edition === undefined ? { name: stripped } : { name: stripped, edition };
}

/**
 * An entry's name as the converted entry carries it, with what the name says
 * of its edition: the `[5.5e]` marker and the book tags off, `(Legacy)` read
 * as 2014.
 */
export function entryName(raw: string): { name: string; edition?: RulesVersion } {
  const named = splitName(raw);
  // `Hold Person*`: Fight Club's footnote mark for a subclass spell.
  let bare = named.name;
  while (bare.endsWith('*')) bare = bare.slice(0, -1).trimEnd();
  const { name, tags } = stripBookTags(bare || named.name);
  // A marker before a tag: `Spell [5.5e] (UA)`.
  const again = tags.length > 0 && named.edition === undefined ? splitName(name) : { name };
  const edition = named.edition ?? again.edition ?? (tags.includes('legacy') ? '2014' : undefined);
  return edition === undefined ? { name: again.name } : { name: again.name, edition };
}

/** The edition a `Source:` line points at, when it says. */
export function sourceLineEdition(line: string): RulesVersion | undefined {
  if (/\bv?(?:5\.2(?:\.\d)?|2024|5\.5e?)\b/.test(line)) return '2024';
  if (/\bv?(?:5\.0|5\.1|2014)\b/.test(line)) return '2014';
  if (/Player's Handbook \(2024\)|Dungeon Master's Guide \(2024\)/i.test(line)) return '2024';
  return undefined;
}

// ---------------------------------------------------------------------------
// Inline text
// ---------------------------------------------------------------------------

/**
 * Text already holding 5etools tags is left as it is inside those tags. A
 * match stops at the next brace, so a line of `{@` with no `}` is one pass.
 */
const EXISTING_TAG = /(\{@[^{}]*\})/;

const DICE = /\b(\d+d\d+(?:\s?[+-]\s?\d+(?![\dd]))?)\b/g;
const TYPE_WORD = `(?:${DAMAGE_TYPES.join('|')})`;
/**
 * Dice that deal damage: "3d6 fire", "3d8 damage of the type you chose", "1d4
 * extra damage", "2d6 additional lightning or thunder damage", and the "1d4
 * less damage" a shrunken weapon deals, which 5etools tags as damage too.
 */
const DAMAGE_AFTER = new RegExp(
  `^\\s+(?:${TYPE_WORD}\\b|(?:extra |additional |bonus |less )?(?:${TYPE_WORD}(?: or ${TYPE_WORD})? )?damage\\b)`,
  'i',
);
/** "roll a d4", which 5etools tags as `{@dice d4}`. */
const ROLL_A_DIE = /\b(rolls? an? )(d\d{1,3})\b/gi;

function tagDice(text: string): string {
  return text
    .replace(DICE, (match: string, dice: string, offset: number, whole: string) => {
      const after = whole.slice(offset + match.length, offset + match.length + 48);
      const expr = dice.replace(/\s+/g, '');
      return DAMAGE_AFTER.test(after) ? `{@damage ${expr}}` : `{@dice ${expr}}`;
    })
    .replace(ROLL_A_DIE, '$1{@dice $2}');
}

/**
 * One line of prose into 5etools text: HTML emphasis (the community converter
 * writes `<i>`, `<b>`) into `{@i}` and `{@b}`, other HTML tags dropped, dice
 * into roll chips. Text inside existing 5etools tags is not touched.
 */
export function inlineText(line: string): string {
  const withMarkup = line
    // Each match stops at the next tag of its kind, open or close, so a line
    // of unclosed tags is one pass, not a scan to the end per tag.
    .replace(/<(?:b|strong)>((?:(?!<\/?(?:b|strong)>)[\s\S])*)<\/(?:b|strong)>/gi, '{@b $1}')
    .replace(/<(?:i|em)>((?:(?!<\/?(?:i|em)>)[\s\S])*)<\/(?:i|em)>/gi, '{@i $1}')
    // Stops at the next `<` too, for the same reason.
    .replace(/<\/?[a-z][a-z0-9]*\b[^<>]*>/gi, '');
  return withMarkup
    .split(EXISTING_TAG)
    .map((part) => (part.startsWith('{@') ? part : tagDice(part)))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Every word capitalized (or a number, or a small joining word). */
function isTitleCase(words: string[]): boolean {
  return words.every((w, i) => {
    const bare = w.replace(/^[("']+|[)"',]+$/g, '');
    if (bare === '') return true;
    if (/^\d/.test(bare)) return true;
    if (i > 0 && SMALL_WORDS.has(bare.toLowerCase())) return true;
    return /^[A-Z]/.test(bare);
  });
}

/**
 * A lead-in written as text: `Name: rest` (any short label) or `Name. rest`
 * (a Title Case label, as 2024 books set their inline headers). Undefined when
 * the line is ordinary prose.
 */
export function leadIn(line: string): { name: string; rest: string } | undefined {
  const colon = /^([A-Z][^:.!?]{0,48}?):\s+(\S.*)$/.exec(line);
  if (colon !== null) {
    const name = colon[1]?.trim() ?? '';
    const words = name.split(/\s+/);
    if (words.length <= 6 && isTitleCase(words)) return { name, rest: colon[2] ?? '' };
  }
  const period = /^([A-Z][^.:!?]{0,38}?)\.\s+(\S.*)$/.exec(line);
  if (period !== null) {
    const name = period[1]?.trim() ?? '';
    const words = name.split(/\s+/);
    if (words.length <= 5 && isTitleCase(words) && !/^(?:[A-Z]\.?)$/.test(name)) {
      return { name, rest: period[2] ?? '' };
    }
  }
  return undefined;
}

function tableCells(line: string): string[] | undefined {
  if (!line.includes('|')) return undefined;
  const cells = line.split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells.length >= 2 ? cells : undefined;
}

const BULLET = /^[•·*-]\s+(.*)$/;
const SOURCE_LINE = /^Source:\s*(.+)$/i;

export interface ReadText {
  entries: Entry[];
  /** The last `Source:` line, without its label. */
  sourceLine?: string;
}

/**
 * Fight Club `<text>` blocks into 5etools entries. Each block is one element's
 * text; blank lines and empty elements only separate.
 */
export function readText(blocks: readonly string[]): ReadText {
  const lines = blocks.flatMap((b) => b.split(/\r?\n/)).map((l) => l.replace(/\s+/g, ' ').trim());
  const entries: Entry[] = [];
  let sourceLine: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line === '') continue;

    const source = SOURCE_LINE.exec(line);
    if (source !== null) {
      // Some files repeat the label: `Source: Source: Book p. 3`.
      const cited = [(source[1] ?? '').replace(/^(?:Source:\s*)+/i, '').trim()];
      // A list of books runs on to the next line after a comma.
      while ((cited[cited.length - 1] ?? '').endsWith(',') && (lines[i + 1] ?? '') !== '') {
        i += 1;
        cited.push(lines[i] ?? '');
      }
      sourceLine = cited.join(' ').replace(/,$/, '');
      continue;
    }

    // A table: two or more consecutive lines of cells. A header wider than
    // any rules table is text: padding every row out to it would cost its
    // width times the row count.
    const header = tableCells(line);
    if (header !== undefined && header.length <= MAX_TABLE_COLUMNS) {
      const rows: string[][] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const cells = tableCells(lines[j] ?? '');
        if (cells === undefined) break;
        rows.push(cells);
      }
      if (rows.length > 0) {
        const width = header.length;
        const table: Record<string, unknown> = {
          type: 'table',
          // A die column's "d10" is a roll, as 5etools tags it.
          colLabels: header.map((label) =>
            /^d\d{1,3}$/i.test(label.trim()) ? `{@dice ${label.trim()}}` : inlineText(label),
          ),
          rows: rows.map((r) => {
            const cells = r.slice(0, width).map(inlineText);
            while (cells.length < width) cells.push('');
            return cells;
          }),
        };
        const prev = entries[entries.length - 1];
        if (typeof prev === 'string' && prev.endsWith(':') && prev.length <= 80) {
          entries.pop();
          table.caption = prev.slice(0, -1);
        }
        entries.push(table);
        i = j - 1;
        continue;
      }
    }

    // A list: consecutive bullet lines.
    if (BULLET.test(line)) {
      const items: string[] = [];
      let j = i;
      for (; j < lines.length; j += 1) {
        const m = BULLET.exec(lines[j] ?? '');
        if (m === null) break;
        items.push(inlineText(m[1] ?? ''));
      }
      entries.push({ type: 'list', items });
      i = j - 1;
      continue;
    }

    const lead = leadIn(line);
    if (lead !== undefined) {
      entries.push({ type: 'entries', name: lead.name, entries: [inlineText(lead.rest)] });
      continue;
    }
    entries.push(inlineText(line));
  }

  return sourceLine === undefined ? { entries } : { entries, sourceLine };
}

/** All prose in entries, flattened, for the text scans (saves, attacks, mastery). */
export function plainText(entries: readonly Entry[]): string {
  const out: string[] = [];
  const walk = (e: unknown) => {
    if (typeof e === 'string') out.push(e);
    else if (Array.isArray(e)) e.forEach(walk);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (typeof o.name === 'string') out.push(o.name);
      walk(o.entries);
      walk(o.items);
      walk(o.rows);
    }
  };
  walk(entries);
  return out.join('\n');
}
