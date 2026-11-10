/**
 * A Fight Club 5e `<race>` into a 5etools race (a species, in 2024 words).
 * Size, speed, ability bonuses and skills have fields of their own; traits
 * become named entries, which is where the engine looks for its curated trait
 * mechanics and its prose scan. Darkvision is read from a trait of that name.
 * Fight Club has no subraces: each one is a race of its own here too, and the
 * installed check finds an official subrace under its name (`officialNames`).
 *
 * Its tags for weapons, armor, tools, condition immunities and other speeds
 * have 5etools fields too. A trait's rules are read from its text only where
 * the wording is the book's own and leaves nothing out ({@link traitRules}):
 * "You can speak, read, and write Common and Elvish", "You have proficiency
 * with the longsword, shortsword, shortbow, and longbow", "You have a
 * swimming speed of 30 feet", "Two different ability scores of your choice
 * increase by 1". A tag says the same thing better, so it wins. Resistances
 * and immunities a trait states for good add to the tags' ({@link standingDefenses}).
 */
import { childElements, childText, childTexts, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import {
  ABILITIES,
  type AbilityKey,
  abilityKey,
  addDefenses,
  addGrant,
  countWord,
  DAMAGE_TYPES,
  type Defenses,
  dropTagPicks,
  type Entry,
  entryName,
  grantLines,
  own,
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
  splitList,
  standingDefenses,
  tableDamageTypes,
  withRolls,
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

/** The conditions 5etools names in `conditionImmune`, by the words Fight Club uses. */
const CONDITIONS: Record<string, string> = {
  blinded: 'blinded',
  charmed: 'charmed',
  deafened: 'deafened',
  disease: 'disease',
  diseases: 'disease',
  exhaustion: 'exhaustion',
  frightened: 'frightened',
  grappled: 'grappled',
  incapacitated: 'incapacitated',
  invisible: 'invisible',
  paralyzed: 'paralyzed',
  petrified: 'petrified',
  poisoned: 'poisoned',
  prone: 'prone',
  restrained: 'restrained',
  stunned: 'stunned',
  unconscious: 'unconscious',
};

/** "poisoned, disease" into 5etools condition names, and the words that are none ("asleep"). */
export function conditionList(raw: string): { known: string[]; other: string[] } {
  const known: string[] = [];
  const other: string[] = [];
  for (const word of splitList(raw)) {
    const name = own(CONDITIONS, word.toLowerCase());
    if (name === undefined) other.push(word);
    else if (!known.includes(name)) known.push(name);
  }
  return { known, other };
}

const MOVES: Record<string, string> = {
  walk: 'walk',
  fly: 'fly',
  flying: 'fly',
  swim: 'swim',
  swimming: 'swim',
  climb: 'climb',
  climbing: 'climb',
  burrow: 'burrow',
  burrowing: 'burrow',
};

/** "swim 30 ft., fly 50 ft." into 5etools speeds; undefined when anything else is said. */
export function otherSpeeds(raw: string): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const part of splitList(raw)) {
    const m = /^([a-z]{1,10}) (\d{1,3}) ?(?:ft\.?|feet)$/i.exec(part);
    const mode = m === null ? undefined : own(MOVES, (m[1] ?? '').toLowerCase());
    if (m === null || mode === undefined) return undefined;
    out[mode] = Number(m[2]);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The first sentence of a trait, lowercased, its full stop dropped; spaces made single. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/\.(?:\s|$)/);
  return (stop === -1 ? flat : flat.slice(0, stop)).toLowerCase();
}

const ALL_ABILITIES: AbilityKey[] = Object.values(ABILITIES);

/**
 * The choices of a race's Ability Score Increase traits (a race and its
 * subrace may each have one): "Two different ability scores of your choice
 * increase by 1", "One ability score of your choice increases by 2, and two
 * other ability scores of your choice increase by 1 each", with the fixed
 * bonuses ("Your Charisma score increases by 2") they say beside them.
 * Undefined when there is no choice, or any sentence that changes a score is
 * not read.
 */
export function abilityChoices(
  texts: readonly string[],
): { fixed: Partial<Record<AbilityKey, number>>; choices: number[] } | undefined {
  const fixed: Partial<Record<AbilityKey, number>> = {};
  const choices: number[] = [];
  const flat = texts.join(' ').replace(/\s+/g, ' ').trim();
  for (const sentence of flat.split(/(?<=\.) /)) {
    if (!/\b(?:increase|decrease)/i.test(sentence)) continue;
    const body = sentence.replace(/\.$/, '').replace(/^in addition, /i, '');
    for (const clause of body.split(/,? and (?=(?:one|two|three|another|your)\b)/i)) {
      const own =
        /^your ([a-z]{3,12})(?: and ([a-z]{3,12}))? scores? (?:each )?increases? by (\d)(?: each)?$/i.exec(
          clause,
        );
      if (own !== null) {
        for (const word of [own[1], own[2]]) {
          if (word === undefined) continue;
          const key = abilityKey(word);
          if (key === undefined) return undefined;
          fixed[key] = (fixed[key] ?? 0) + Number(own[3]);
        }
        continue;
      }
      const choice =
        /^(one|two|three|another)(?: different| other)? ability scores? of your choice (?:each )?increases? by ([12])(?: each)?$/i.exec(
          clause,
        );
      if (choice === null) return undefined;
      const word = (choice[1] ?? '').toLowerCase();
      const count = word === 'another' ? 1 : countWord(word);
      if (count === undefined) return undefined;
      for (let i = 0; i < count; i += 1) choices.push(Number(choice[2]));
    }
  }
  return choices.length > 0 ? { fixed, choices } : undefined;
}

/** Whether two sets of fixed bonuses are the same. */
function sameBonuses(
  a: Partial<Record<AbilityKey, number>>,
  b: Partial<Record<AbilityKey, number>>,
): boolean {
  return ALL_ABILITIES.every((k) => a[k] === b[k]);
}

/** A 5etools ability entry from fixed bonuses and chosen ones ({@link abilityChoices}). */
function abilityEntry(
  fixed: Partial<Record<AbilityKey, number>>,
  choices: number[],
): Record<string, unknown> {
  const from = ALL_ABILITIES.filter((k) => fixed[k] === undefined);
  const choose = choices.every((c) => c === 1)
    ? { from, count: choices.length }
    : { weighted: { from, weights: [...choices].sort((a, b) => b - a) } };
  return { ...fixed, choose };
}

/** What a trait's rules text says, read into 5etools fields ({@link traitRules}). */
interface TraitRules extends ProficiencyGrant {
  languages?: Record<string, unknown>;
  speed?: Record<string, number | true>;
}

/** A trait's tools by any name only in a trait about tools; elsewhere tools of the rules. */
const toolMode = (traitName: string) => (/\btools?\b/i.test(traitName) ? 'any' : 'known');

/**
 * The sentences of a trait that may grant something for good ({@link
 * grantLines}): one that grants a proficiency or a resistance to pick, not
 * an option among others, a table row, or a sentence that hangs on an earlier
 * one. "Natural Affinity. Your fey connection to animals gives you an
 * intuitive bond with them. You therefore have proficiency in one of the
 * following skills of your choice: …" reads its second sentence.
 */
export function traitLines(traitName: string, entries: readonly unknown[]): string[] {
  const tools = toolMode(traitName);
  return grantLines(
    entries,
    // Every damage type stands in for the ancestry table, read once every trait is.
    (line) =>
      proficiencySentence(line, tools) !== undefined ||
      resistChoice(line, DAMAGE_TYPES) !== undefined,
  );
}

/**
 * The rules a race trait states in the book's own words: languages and
 * another speed in its first sentence, and what its `lines` grant
 * ({@link traitLines}): proficiencies, and a language of your choice a later
 * sentence adds. Anything else, or anything not read in full, is left to the
 * text.
 */
export function traitRules(traitName: string, text: string, lines: readonly string[]): TraitRules {
  const sentence = firstSentence(text);
  const out: TraitRules = {};
  const speak =
    /^(?:you|your character) (?:can )?(?:speak, read,? and write|read, speak,? and write) (?:both )?(.{1,160})$/.exec(
      sentence,
    );
  if (speak !== null) {
    const langs = readLanguages(
      (speak[1] ?? '').replace(
        /one extra language of your choosing$/,
        'one extra language of your choice',
      ),
    );
    if (langs !== undefined) out.languages = langs;
  }
  const tools = toolMode(traitName);
  for (const line of lines) addGrant(out, proficiencySentence(line, tools));
  const speed =
    /^you have an? (flying|swimming|climbing|burrowing|fly|swim|climb|burrow) speed (?:of (\d{1,3}) feet|equal to your (?:walking )?speed)$/.exec(
      sentence,
    );
  const mode = speed === null ? undefined : own(MOVES, speed[1] ?? '');
  if (speed !== null && mode !== undefined) {
    out.speed = { [mode]: speed[2] === undefined ? true : Number(speed[2]) };
  }
  return out;
}

/** A Fight Club `<special>` that names a 5etools trait tag. */
const TRAIT_TAGS: Record<string, string> = {
  'powerful build': 'Powerful Build',
  'natural armor': 'Natural Armor',
};

const SIZES = new Set(['T', 'S', 'M', 'L', 'H', 'G']);

export function convertRace(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const reasons: string[] = [];
  const named = entryName(rawName);

  const entries: Entry[] = [];
  let sourceLine: string | undefined;
  let darkvision: number | undefined;
  const prose: TraitRules[] = [];
  const traitTags = new Set<string>();
  const abilityTexts: string[] = [];
  const grantedLines: string[] = [];
  let defenses: Defenses = {};
  for (const trait of childElements(el, 'trait')) {
    const traitName = childText(trait, 'name') ?? '';
    const text = readText(childTexts(trait, 'text'));
    sourceLine = text.sourceLine ?? sourceLine;
    for (const special of childTexts(trait, 'special')) {
      const tag = own(TRAIT_TAGS, special.split(':')[0]?.trim().toLowerCase() ?? '');
      if (tag !== undefined) traitTags.add(tag);
    }
    if (traitName === '' || /^description$/i.test(traitName)) {
      entries.push(...withRolls(text.entries, trait));
      continue;
    }
    entries.push({ type: 'entries', name: traitName, entries: withRolls(text.entries, trait) });
    const plain = plainText(text.entries);
    if (/^(?:superior )?darkvision$/i.test(traitName)) {
      const range = /\b(\d+)\s*(?:feet|ft)/i.exec(plain);
      if (range !== null) darkvision = Number(range[1]);
    }
    if (/^ability score increases?$/i.test(traitName)) abilityTexts.push(plain);
    const lines = traitLines(traitName, text.entries);
    prose.push(traitRules(traitName, plain, lines));
    grantedLines.push(...lines);
    defenses = addDefenses(defenses, standingDefenses(text.entries));
  }

  const loose = readText(childTexts(el, 'text'));
  sourceLine = loose.sourceLine ?? sourceLine;
  const placement = ctx.place(sourceLine, named.edition);
  const race: Record<string, unknown> = { name: named.name };
  placeEntity(race, placement);

  const size = (childText(el, 'size') ?? '').toUpperCase();
  if (SIZES.has(size)) race.size = [size];
  const speed = Number(childText(el, 'speed'));
  const walk = Number.isInteger(speed) && speed > 0 ? speed : undefined;
  const moves: Record<string, number | true> = {};
  for (const rules of prose) Object.assign(moves, rules.speed);
  const rawSpeeds = childText(el, 'speedother');
  if (rawSpeeds !== undefined) {
    const speeds = otherSpeeds(rawSpeeds);
    if (speeds !== undefined) Object.assign(moves, speeds);
    else reasons.push(`its speeds "${rawSpeeds}" are kept as text`);
  }
  delete moves.walk;
  if (Object.keys(moves).length > 0) race.speed = walk === undefined ? moves : { walk, ...moves };
  else if (walk !== undefined) race.speed = walk;

  const abilityProse = abilityChoices(abilityTexts);
  const rawAbility = childText(el, 'ability');
  if (rawAbility !== undefined) {
    const ability = raceAbility(rawAbility);
    if (ability === undefined) reasons.push(`its ability scores "${rawAbility}" are kept as text`);
    // The choices only where the text's fixed bonuses are the tag's: a file
    // whose two disagree says nothing reliable about the rest.
    else if (abilityProse === undefined || !sameBonuses(ability, abilityProse.fixed)) {
      race.ability = [ability];
    } else race.ability = [abilityEntry(ability, abilityProse.choices)];
  } else if (abilityProse !== undefined) {
    race.ability = [abilityEntry(abilityProse.fixed, abilityProse.choices)];
  }

  // The skill tag, with what the traits add: a skill of your choice is in no tag.
  const skillEntry: Record<string, unknown> = {};
  const proficiency = childText(el, 'proficiency');
  if (proficiency !== undefined) {
    const { skills, other } = readProficiencies(proficiency);
    for (const s of skills) skillEntry[s] = true;
    if (other.length > 0) reasons.push(`proficiency in ${other.join(', ')} is kept as text`);
  }
  const skillLists: Record<string, unknown>[] = [];
  const tagSkills = Object.keys(skillEntry);
  const chosen = new Set<string>();
  const namedSkills = new Set<string>();
  for (const rules of prose) {
    const { skills } = rules;
    if (skills === undefined) continue;
    if ('choose' in skills) {
      skillLists.push(skills);
      for (const f of (skills.choose as { from?: string[] }).from ?? []) chosen.add(f);
      continue;
    }
    for (const [k, v] of Object.entries(skills)) {
      if (k === 'any') skillEntry.any = Number(skillEntry.any ?? 0) + Number(v);
      else {
        skillEntry[k] = v;
        namedSkills.add(k);
      }
    }
  }
  dropTagPicks(skillEntry, tagSkills, chosen, namedSkills);
  if (Object.keys(skillEntry).length > 0) skillLists.unshift(skillEntry);
  if (skillLists.length > 0) race.skillProficiencies = skillLists;

  // A tag first; a trait's words where there is none.
  const proseWeapons = prose.find((r) => r.weapons !== undefined)?.weapons;
  const readers = {
    weapons: (raw: string) => readWeapons(raw, placement.edition),
    armor: readArmor,
    tools: (raw: string) => readTools(raw.replace(/^you gain proficiency with /i, '')),
  };
  // Armor and tools from every trait join; a weapon list is the first trait's.
  const joined: ProficiencyGrant = {};
  for (const { armor, tools } of prose) addGrant(joined, { armor, tools });
  const fromProse = {
    weapons: proseWeapons === undefined ? undefined : readWeapons(proseWeapons, placement.edition),
    armor: joined.armor,
    tools: joined.tools,
  };
  for (const [tag, field] of [
    ['weapons', 'weaponProficiencies'],
    ['armor', 'armorProficiencies'],
    ['tools', 'toolProficiencies'],
  ] as const) {
    const raw = childText(el, tag);
    const fromTag = raw === undefined ? undefined : readers[tag](raw);
    if (raw !== undefined && fromTag === undefined)
      reasons.push(`its ${tag} "${raw}" are kept as text`);
    const found = fromTag ?? fromProse[tag];
    if (found !== undefined) race[field] = [found];
  }

  if (darkvision !== undefined) race.darkvision = darkvision;
  // A resistance picked from a list, or from the race's own ancestry table.
  const ancestry = tableDamageTypes(entries);
  const resistPicks: Record<string, unknown>[] = [];
  const seenPicks = new Set<string>();
  for (const line of grantedLines) {
    const pick = resistChoice(line, ancestry);
    const key = JSON.stringify(pick);
    if (pick === undefined || seenPicks.has(key)) continue;
    seenPicks.add(key);
    resistPicks.push(pick);
  }
  for (const [field, key] of [
    ['resist', 'resist'],
    ['immune', 'immune'],
    ['vulnerable', 'vulnerable'],
  ] as const) {
    const raw = childText(el, field);
    const fromTag = raw === undefined ? undefined : damageList(raw);
    if (raw !== undefined && fromTag === undefined)
      reasons.push(`its ${field} "${raw}" is kept as text`);
    // A type a trait offers as a pick is Fight Club's pick when the tag holds
    // it too, and no more of them than the pick allows; a tag that holds more
    // states them itself, and the pick gives way to it.
    const picked = new Set<string>();
    const picks: Record<string, unknown>[] = [];
    for (const pick of key === 'resist' ? resistPicks : []) {
      const choose = pick.choose as { from?: string[]; count?: number } | undefined;
      // A type a trait already gives outright is not the pick's.
      const inTag = (fromTag ?? []).filter(
        (t) => choose?.from?.includes(t) === true && defenses[key]?.includes(t) !== true,
      );
      if (inTag.length > (choose?.count ?? 1)) continue;
      for (const t of inTag) picked.add(t);
      picks.push(pick);
    }
    const list: unknown[] = [
      ...new Set([...(fromTag ?? []).filter((t) => !picked.has(t)), ...(defenses[key] ?? [])]),
      ...picks,
    ];
    if (list.length > 0) race[key] = list;
  }
  const rawLanguages = childText(el, 'languages');
  const tagLanguages = rawLanguages === undefined ? undefined : readLanguages(rawLanguages);
  // Traits' words where the tag says nothing usable: "Common and Elvish" and an
  // Extra Language trait's "one extra language of your choice" together.
  const proseLanguages: Record<string, unknown> = {};
  for (const rules of prose) {
    for (const [k, v] of Object.entries(rules.languages ?? {})) {
      proseLanguages[k] = k === 'anyStandard' ? Number(own(proseLanguages, k) ?? 0) + Number(v) : v;
    }
  }
  // A trait that names the tag's languages and a pick besides ("Common, Elvish,
  // and one extra language of your choice") says what the tag leaves out.
  const addsPick =
    tagLanguages !== undefined &&
    Object.keys(tagLanguages).every((k) => own(proseLanguages, k) !== undefined) &&
    Object.keys(proseLanguages).every(
      (k) => own(tagLanguages, k) !== undefined || k === 'anyStandard' || k === 'choose',
    ) &&
    Object.keys(proseLanguages).length > Object.keys(tagLanguages).length;
  if (tagLanguages !== undefined)
    race.languageProficiencies = [addsPick ? proseLanguages : tagLanguages];
  else if (Object.keys(proseLanguages).length > 0) race.languageProficiencies = [proseLanguages];
  else if (rawLanguages !== undefined) reasons.push('its languages are kept as text');
  if (childText(el, 'spellability') !== undefined || childText(el, 'spells') !== undefined) {
    reasons.push('its innate spells are kept as text');
  }
  const rawConditions = childText(el, 'conditionimmune');
  const conditions = new Set(defenses.conditionImmune);
  if (rawConditions !== undefined) {
    const { known, other } = conditionList(rawConditions);
    for (const c of known) conditions.add(c);
    if (other.length > 0)
      reasons.push(`its condition immunity to ${other.join(', ')} is kept as text`);
  }
  if (conditions.size > 0) race.conditionImmune = [...conditions];
  if (traitTags.size > 0) race.traitTags = [...traitTags];
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
