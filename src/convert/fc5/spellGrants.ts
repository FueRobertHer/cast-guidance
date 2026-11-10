/**
 * The spells an entry's text grants, as 5etools `additionalSpells`: a race's
 * innate spells ("You know the thaumaturgy cantrip. Once you reach 3rd level,
 * you can cast the hellish rebuke spell as a 2nd-level spell..."), a feat's
 * ("You learn the misty step spell and one 1st-level spell of your choice"),
 * and a background's. Fight Club has no field for them, so the sheet had none.
 *
 * Each trait is read on its own, sentence by sentence. A spell is named by a
 * frame (`the X spell`, `the X and Y cantrips`, `one of the following
 * cantrips: X, Y, or Z`), or, where the file or the installed data knows its
 * spells, by name after a verb that grants (`can cast jump or misty step`). A
 * sentence opening with a level (`Starting at 3rd level, you`) gates what it
 * names. How often a spell is cast comes from its sentence or the next one
 * (once per long rest, per short rest, at will, as often as the proficiency
 * bonus), else from the trait; the spellcasting ability from the trait, or
 * the race's own tag. What is not read stays in the text, which every entry
 * keeps.
 *
 * The text is untrusted: every pattern here is linear, with bounded runs.
 */
import { ABILITIES, type AbilityKey, countWord, own } from './text';

/** The spells a file defines or the installed data has, by lowercased name. */
export interface SpellIndex {
  /** The spell's level (0 for a cantrip), `null` for a spell of unknown level, undefined for no spell. */
  level(name: string): number | null | undefined;
}

export type SpellAbility = AbilityKey | 'inherit' | { choose: AbilityKey[] };

type SpellRef = string | { choose: string | { from: string[] }; count?: number };

interface Bucket {
  /** Cast with slots only, beside spells with free casts at the same level. */
  _?: SpellRef[];
  will?: SpellRef[];
  ritual?: SpellRef[];
  daily?: Record<string, SpellRef[]>;
  rest?: Record<string, SpellRef[]>;
}

/** One `additionalSpells` entry. */
export interface SpellBlock {
  name?: string;
  ability?: SpellAbility;
  known?: Record<string, SpellRef[]>;
  innate?: Record<string, SpellRef[] | Bucket>;
  prepared?: Record<string, SpellRef[] | Bucket>;
  /** Spells added to the reader's class lists, by spell level: `s0` for cantrips. */
  expanded?: Record<string, SpellRef[]>;
}

/** What a report says of an entry whose text grants spells this could not read, all or `some`. */
export function spellsKept(some: boolean): string {
  return some ? 'some of its spells are kept as text' : 'its spells are kept as text';
}

/** How often a spell is cast without a slot: at will, or so many times between rests. */
type Frequency = { kind: 'will' | 'ritual' | 'none' } | { kind: 'daily' | 'rest'; count: string };

const SCHOOLS: Record<string, string> = {
  abjuration: 'A',
  conjuration: 'C',
  divination: 'D',
  enchantment: 'E',
  evocation: 'V',
  illusion: 'I',
  necromancy: 'N',
  transmutation: 'T',
};

const CLASSES = new Set([
  'artificer',
  'bard',
  'cleric',
  'druid',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
  'wizard',
]);

/** Words no spell name holds; a frame that catches one caught a clause, not a name. */
const NOT_NAME = new Set([
  'a',
  'an',
  'any',
  'as',
  'both',
  'can',
  'cantrip',
  'cantrips',
  'cast',
  'certain',
  'chosen',
  'each',
  'either',
  'it',
  'its',
  'level',
  'must',
  'following',
  'one',
  'once',
  'same',
  'spell',
  'spells',
  'that',
  'the',
  'these',
  'this',
  'those',
  'three',
  'two',
  'using',
  'you',
  'your',
]);

const MAX_NAME_WORDS = 6;
/** No real trait is longer; a longer one is read only this far. */
const MAX_TEXT = 6000;

/** `{@b Hot}` and `{@spell Hex|FCBook}` as their text, and typographic quotes as plain ones. */
function untag(text: string): string {
  return text
    .replace(/\{@\w{1,20} ([^{}|]{0,200})(?:\|[^{}]{0,200})?\}/g, '$1')
    .replace(/[‘’]/g, "'");
}

/**
 * A trait's sentences, lowercased, without their full stops. A clause that
 * opens on a level of its own is a sentence too: `..., and starting at 5th
 * level, you can also cast wall of water`.
 */
function sentencesOf(text: string): string[] {
  return untag(text.slice(0, MAX_TEXT))
    .split(/\n|(?<=[.;]) |,? and (?=(?:starting|beginning) at \d|(?:when|once) you reach \d)/i)
    .map((s) => s.trim().replace(/[.;]$/, '').toLowerCase())
    .filter((s) => s !== '');
}

function isName(name: string): boolean {
  if (name === '' || name.length > 60) return false;
  const words = name.split(' ');
  if (words.length > MAX_NAME_WORDS) return false;
  return words.every((w) => w !== '' && !NOT_NAME.has(w) && !/^\d/.test(w));
}

/** A phrase's words, a comma one of its own. */
const wordsOf = (text: string) =>
  text
    .replace(/,/g, ' ,')
    .split(' ')
    .filter((w) => w !== '');

/** What may stand between two names: `the animal friendship spell and the speak with animals`. */
const BETWEEN_NAMES = new Set([',', 'or', 'and', 'the', 'spell', 'spells', 'cantrip', 'cantrips']);

/**
 * The spell names the index knows at the start of a run of words, with `,`,
 * `and` and `or` between them, and the word where reading stopped. Each place
 * tries the longest name first, so `detect poison and disease` is one.
 */
function knownRun(words: readonly string[], index: SpellIndex): { names: string[]; end: number } {
  const names: string[] = [];
  let i = 0;
  while (i < words.length) {
    let matched = 0;
    for (let n = Math.min(MAX_NAME_WORDS, words.length - i); n > 0; n -= 1) {
      const name = words.slice(i, i + n).join(' ');
      // Only what could be a name is looked up: not `a spark`, not `jump , or`.
      if (isName(name) && !name.includes(',') && index.level(name) !== undefined) {
        names.push(name);
        matched = n;
        break;
      }
    }
    if (matched > 0) i += matched;
    else if (names.length > 0 && BETWEEN_NAMES.has(words[i] ?? '')) i += 1;
    else break;
  }
  return { names, end: i };
}

/** A frame's catch as spell names: `misty step and tongues`, or one name holding `and`. */
function frameNames(raw: string, plural: boolean, index: SpellIndex | undefined): string[] {
  const whole = raw.trim();
  if (index !== undefined) {
    const words = wordsOf(whole);
    const run = knownRun(words, index);
    if (run.names.length > 0 && run.end === words.length) return run.names;
  }
  const parts = plural ? whole.split(/,? (?:and|or) |, /) : [whole];
  return parts.map((p) => p.trim()).filter(isName);
}

/**
 * Spell names after a verb that grants, by the index: `can cast jump or misty
 * step with this trait`, `can cast animal friendship an unlimited number of
 * times`.
 */
function indexedNames(sentence: string, index: SpellIndex): string[] {
  const out: string[] = [];
  const verb =
    /\b(?:can (?:also )?cast|(?:allows|lets) you (?:to )?cast|you (?:also )?(?:learn|know))\b/g;
  for (let m = verb.exec(sentence); m !== null; m = verb.exec(sentence)) {
    const at = m.index + m[0].length;
    const words = wordsOf(sentence.slice(at, at + 200));
    let i = 0;
    while (['the', 'also', 'either', 'both'].includes(words[i] ?? '')) i += 1;
    out.push(...knownRun(words.slice(i), index).names);
  }
  return out;
}

/** The level a sentence opens with: `Starting at 3rd level, you`, `When you reach character level 5, you`. */
function gateOf(sentence: string): string | undefined {
  const m =
    /(?:^at|\b(?:starting at|beginning at|when you reach|once you reach|upon reaching|after reaching))(?: character)? (?:level (\d{1,2})|(\d{1,2})(?:st|nd|rd|th) level)(?:,| you)/.exec(
      sentence,
    );
  const level = m === null ? undefined : (m[1] ?? m[2]);
  return level === undefined || Number(level) <= 1 ? undefined : String(Number(level));
}

/** How often a sentence lets its spells be cast, if it says. */
function frequencyIn(sentence: string): Frequency | undefined {
  if (/\bat will\b|\bunlimited number of times\b/.test(sentence)) return { kind: 'will' };
  const pb = /\bnumber of times equal to your proficiency bonus\b/.test(sentence);
  const short = /\bshort (?:or long )?rest\b/.test(sentence);
  const long = /\blong rest\b/.test(sentence);
  if (!pb && !short && !long) {
    // `You can cast the find familiar spell as a ritual`, not `When you cast this spell as a Ritual`.
    return /\bcan cast\b.{0,80}\bas (?:a )?rituals?\b/.test(sentence)
      ? { kind: 'ritual' }
      : undefined;
  }
  const times = /\b(?:(twice)|(one|two|three|four) times)\b/.exec(sentence);
  const count = pb
    ? 'pb'
    : times?.[1] !== undefined
      ? '2'
      : times?.[2] !== undefined
        ? String(countWord(times[2]) ?? 1)
        : '1';
  return { kind: short ? 'rest' : 'daily', count };
}

/** What a sentence says the spellcasting ability is. */
function abilityIn(sentence: string): SpellAbility | undefined {
  if (!/\bspellcasting ability\b/.test(sentence)) return undefined;
  if (
    /\b(?:ability (?:you )?increased by this feat|the one chosen|ability chosen|same as the spellcasting ability|ability you chose)\b/.test(
      sentence,
    )
  ) {
    return 'inherit';
  }
  const found: AbilityKey[] = [];
  const words = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\b/g;
  for (let m = words.exec(sentence); m !== null; m = words.exec(sentence)) {
    const key = own(ABILITIES, m[1] ?? '');
    if (key !== undefined && !found.includes(key)) found.push(key);
  }
  if (found.length === 0) return undefined;
  return found.length === 1 ? (found[0] as AbilityKey) : { choose: found };
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The classes a phrase names: `bard`, `cleric or wizard`, `the cleric, druid, or wizard`. */
function classesIn(text: string): string[] {
  return [...new Set(text.split(/[^a-z]+/).filter((w) => CLASSES.has(w)))].map(capital);
}

/** The schools a sentence names: `the divination or enchantment school`. */
function schoolsIn(text: string): string[] {
  const m = /\b((?:[a-z]+(?:,? (?:or|and) |, )){0,7}[a-z]+) school/.exec(text);
  if (m === null) return [];
  return (m[1] ?? '').split(/,? (?:or|and) |, /).flatMap((w) => {
    const code = own(SCHOOLS, w);
    return code === undefined ? [] : [code];
  });
}

interface Pick {
  cantrip: boolean;
  /** As a filter writes it: `1`, or `1;2;3` for "level 3 or lower". */
  level: string;
  count: number;
  classes: string[];
  schools: string[];
  /** One list of several, kept for the whole feat: Magic Initiate's "from the same list". */
  oneList: boolean;
  /** Only rituals: "the spells you choose must have the ritual tag". */
  ritual: boolean;
}

const SAME_LIST = /\b(?:same|chosen) (?:spell )?list\b/;
/** `from that class's spell list`, after a choice of class this does not read. */
const THAT_CLASS = /\bthat class's spell list\b/;
/** A sentence that offers a pick says so: `choose`, `of your choice`, `learn`. */
const PICK_WORDS = /\b(?:choose|choice|learn|know|always have)\b/;
const THAT_LIST = /\bfrom that (?:spell )?list\b/;

/** `as a 2nd-level spell`: the level a named spell is cast at, not a pick. */
const CAST_AT = /\bas an? (\d)(?:st|nd|rd|th)[- ]level spell\b/;

/** A pick a table decides (`one 1st-level spell based on the college you choose`): not read. */
const TABLED = /^ (?:based on|as (?:specified|shown) (?:in|on))\b/;

/**
 * The spells and cantrips of the reader's choice that a sentence offers, and
 * whether it offers one a table decides, which is not read.
 */
function picksIn(
  sentence: string,
  next: string,
  /** The trait speaks of one list kept for the whole feat ("the same list"). */
  sameList: boolean,
): { picks: Pick[]; tabled: boolean } {
  const picks: Pick[] = [];
  let tabled = false;
  // A swap or a fallback is no grant: `you can replace that cantrip with a
  // different cantrip from the Wizard spell list`, `If you already know it, you
  // learn a different Wizard cantrip`.
  if (/\b(?:replace|instead|if you already know)\b/.test(sentence)) return { picks, tabled };
  // The list of a class chosen elsewhere, which this does not read.
  if (THAT_CLASS.test(sentence)) return { picks, tabled: true };
  const fromList = (text: string) =>
    /\bfrom the ([a-z, ]{1,60}?) spell lists?\b/.exec(text)?.[1] ?? '';
  const ritual = /\britual tag\b|\bmust be rituals?\b/.test(`${sentence} ${next}`);
  const schools = schoolsIn(`${sentence} ${next}`);
  const cantrip =
    /\b(one|two|three|four|a) ((?:[a-z]+,? (?:or )?){0,4})cantrips? of your choice\b/.exec(
      sentence,
    ) ??
    /\b(one|two|three|four|a) ((?:[a-z]+,? (?:or )?){0,4})cantrips?(?= from the [a-z, ]{1,60} spell lists?)/.exec(
      sentence,
    );
  if (cantrip !== null) {
    const classes = classesIn(`${cantrip[2] ?? ''} ${fromList(sentence)}`);
    picks.push({
      cantrip: true,
      level: '0',
      count: cantrip[1] === 'a' ? 1 : (countWord(cantrip[1] ?? '') ?? 1),
      classes,
      schools,
      oneList: classes.length > 1 && sameList,
      ritual: false,
    });
  }
  // Not a slot (`expend a 1st-level spell slot`). `a level 8 or lower spell` is any up to 8.
  const text = sentence.replace(CAST_AT, '');
  const leveled =
    /\b(?:(one|two|a)|choose (?:one|a)) (?:(\d)(?:st|nd|rd|th)[- ]level|level (\d))( or lower)? ((?:[a-z]+,? (?:or )?){0,3})spells?\b(?! slots?\b)/.exec(
      text,
    );
  if (leveled !== null && !PICK_WORDS.test(sentence)) {
    // `Whenever you cast a 1st-level spell, you regain 1 hit point`: no pick.
  } else if (leveled !== null && TABLED.test(text.slice(leveled.index + leveled[0].length))) {
    tabled = true;
  } else if (leveled !== null) {
    // `from that list` after a cantrip's list is the cantrip's.
    const own = classesIn(`${leveled[5] ?? ''} ${fromList(text.slice(leveled.index))}`);
    const top = Number(leveled[2] ?? leveled[3]);
    picks.push({
      cantrip: false,
      level: leveled[4] === undefined ? String(top) : levelsUpTo(top),
      count: leveled[1] === 'two' ? 2 : 1,
      classes: own.length > 0 ? own : classesIn(fromList(`${sentence} ${next}`)),
      schools,
      oneList: false,
      ritual,
    });
  }
  return { picks, tabled };
}

/** `1;2;3` for a spell of level 3 or lower. */
function levelsUpTo(top: number): string {
  return Array.from({ length: Math.max(1, Math.min(top, 9)) }, (_, i) => i + 1).join(';');
}

function pickRef(pick: Pick, classes: readonly string[]): SpellRef {
  const parts = [`level=${pick.level}`];
  if (classes.length > 0) parts.push(`class=${classes.join(';')}`);
  if (pick.schools.length > 0) parts.push(`school=${pick.schools.join(';')}`);
  if (pick.ritual) parts.push('components & miscellaneous=ritual');
  const choose = parts.join('|');
  return pick.count > 1 ? { choose, count: pick.count } : { choose };
}

/** A spell the text names, with where it goes. */
interface Grant {
  ref: SpellRef;
  cantrip: boolean;
  gate: string;
  prepared: boolean;
  frequency: Frequency;
  /** Added to the reader's spell lists, not granted: `gate` is a spell level. */
  expanded?: boolean;
}

/** Whether a sentence speaks of a spell the reader gets (`can cast`, not `when you cast`): what a reason says was not read. */
const GRANT_WORDS =
  /(?<!\b(?:when|whenever|if|unless|while) )\b(?:you (?:can )?(?:also )?(?:know|learn|always have)|you can (?:also )?cast|(?:allows|lets) you (?:to )?cast)\b(?! (?:these|those|this|that|them|it|each|either|both|any|the spells?)\b).{0,120}\b(?:cantrips?|spells?)\b|\bcantrips? of your choice\b/;

/** A verb that grants, earlier in a sentence: what `and the X spell` must follow. */
const GRANTS_BEFORE = /\b(?:know|learn|can (?:also )?cast|to cast|always have)\b/;

/**
 * `the misty step spell`, `the light cantrip`, `the disguise self and hex
 * spells` after a verb that grants: `can cast`, not `When you cast the Find
 * Familiar spell`.
 */
const FRAME =
  /\b(?:(?:know|learn|(?:can (?:also )?|to )cast|always have|knowledge of)(?: the)?|and the) ([a-z][a-z' /-]{0,59}?) (cantrips?|spells?)\b/g;

/** `are added to the spell list of your spellcasting class`: a list widened, not spells granted. */
const ADDS_TO_LIST = /\bare added to (?:the|your|that)\b.{0,60}\bspell lists?\b/;

/** A row of spells by level: `cantrip – friends, message`, `1st | command, ensnaring strike`. */
const LEVEL_ROW = /^(cantrips?|(\d)(?:st|nd|rd|th)(?:[- ]level)?) ?[–—|:-] ?(.{1,300})$/;

/** A row of a table by character level: `level 3 | command`. */
const LEVEL_GATE_ROW = /^level (\d{1,2}) \| (.{1,300})$/;

/** What one sentence names, and where it puts it. */
interface Read {
  gate: string;
  castAt?: string;
  prepared: boolean;
  names: { name: string; cantrip: boolean }[];
  /** Spells set down whole (`one of the following`, `respectively`, `1/day each:`), with their own gates. */
  whole: { ref: SpellRef; cantrip: boolean; gate: string; frequency?: Frequency }[];
  picks: Pick[];
  /** It offers a pick a table decides, which is not read. */
  tabled: boolean;
}

function readSentence(
  sentence: string,
  next: string,
  sameList: boolean,
  index: SpellIndex | undefined,
  prepares: boolean,
  seen: Set<string>,
): Read {
  const read: Read = {
    gate: gateOf(sentence) ?? '_',
    prepared: prepares && /\balways have\b.{0,120}\bprepared\b/.test(`${sentence} ${next}`),
    names: [],
    whole: [],
    picks: [],
    tabled: false,
  };
  const castAt = CAST_AT.exec(sentence)?.[1];
  if (castAt !== undefined) read.castAt = castAt;
  const add = (name: string, cantrip: boolean) => {
    if (seen.has(name)) return;
    seen.add(name);
    read.names.push({ name, cantrip: cantrip || index?.level(name) === 0 });
  };

  // `you learn hellish rebuke and darkness respectively`, after `character levels 3 and 5`.
  const respectively =
    /\bcharacter levels (\d{1,2}) and (\d{1,2}), you (?:learn|gain) (.{1,80}?),? respectively\b/.exec(
      sentence,
    );
  const parts = respectively?.[3]?.split(/,? and /) ?? [];
  if (respectively !== null && parts.length === 2) {
    parts.forEach((part, at) => {
      const name = part.trim();
      if (!isName(name) || seen.has(name)) return;
      seen.add(name);
      const level = Number(respectively[at + 1]);
      read.whole.push({
        ref: name,
        cantrip: index?.level(name) === 0,
        gate: level <= 1 ? '_' : String(level),
      });
    });
    return read;
  }

  // `one of the following cantrips: X, Y, or Z` offers one; `each of the
  // following spells once with this ability: X, Y, and Z` grants them all.
  const following =
    /\b(?:cast|know|learn|choose|gain) (one|each) of the following (cantrips|spells)(?: of your choice| [a-z ]{1,60})?: (.{1,200})$/.exec(
      sentence,
    );
  if (following !== null) {
    const names = (following[3] ?? '')
      .split(/,? (?:or|and) |, /)
      .map((p) => p.trim())
      .filter(isName);
    // `the following spells: light, mage hand` are cantrips when the index says so.
    const cantrip =
      following[2] === 'cantrips' ||
      (names.length > 0 && names.every((n) => index?.level(n) === 0));
    const from = names.map((n) => (cantrip ? `${n}#c` : n));
    if (following[1] === 'one' && from.length > 1) {
      read.whole.push({ ref: { choose: { from } }, cantrip, gate: read.gate });
      return read;
    }
    if (following[1] === 'each' && names.length > 0) {
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        read.whole.push({
          ref: name,
          cantrip: cantrip || index?.level(name) === 0,
          gate: read.gate,
        });
      }
    }
  }

  // A list under "the following spells": `• At will: nondetection (self only)`,
  // `• 1/day each: blindness/deafness, blur, disguise self`.
  const list = /^(?:• ?)?(at will|(\d)\/day(?: each)?): (.{1,200})$/.exec(sentence);
  if (list !== null) {
    const frequency: Frequency =
      list[2] === undefined ? { kind: 'will' } : { kind: 'daily', count: list[2] };
    for (const part of (list[3] ?? '').split(', ')) {
      const name = part.replace(/ \([^()]{0,40}\)$/, '').trim();
      if (!isName(name) || seen.has(name)) continue;
      seen.add(name);
      read.whole.push({ ref: name, cantrip: index?.level(name) === 0, gate: read.gate, frequency });
    }
    return read;
  }

  FRAME.lastIndex = 0;
  for (let m = FRAME.exec(sentence); m !== null; m = FRAME.exec(sentence)) {
    const before = sentence.slice(Math.max(0, m.index - 16), m.index);
    // `When you know the shield spell`, `If you cast`: a condition, not a grant.
    if (/\b(?:when|whenever|if|unless|while) you (?:also )?$/.test(before)) continue;
    // `and the sleep spell can't put you to sleep` grants nothing; `that spell and the misty step spell` does.
    if (m[0].startsWith('and the') && !GRANTS_BEFORE.test(sentence.slice(0, m.index))) continue;
    const kind = m[2] ?? '';
    for (const name of frameNames(m[1] ?? '', kind.endsWith('s'), index)) {
      add(name, kind.startsWith('cantrip'));
    }
  }
  if (index !== undefined) {
    for (const name of indexedNames(sentence, index)) add(name, false);
  }
  const { picks, tabled } = picksIn(sentence, next, sameList);
  read.picks = picks;
  read.tabled = tabled;
  return read;
}

/** The spells one trait grants, read by {@link readSpellGrants}. */
export interface TraitSpells {
  grants: Grant[];
  ability?: SpellAbility;
  /** Picks from one list of several classes: a named block per class. */
  lists?: {
    classes: string[];
    picks: Pick[];
    gate: string;
    prepared: boolean;
    frequency: Frequency;
  };
  /** The trait speaks of granted spells but none was read, or offers a pick a table decides. */
  unread: boolean;
}

/**
 * The spells one trait grants. `prepares` says whether "you always have it
 * prepared" means prepared (a feat or background) or innate (a race, as the
 * data writes them).
 */
export function readTraitSpells(
  text: string,
  index: SpellIndex | undefined,
  prepares: boolean,
): TraitSpells {
  const raw = sentencesOf(text);
  const expands = raw.some((line) => ADDS_TO_LIST.test(line));
  // A lineage's table by character level (`Level 3 | Command`) reads as the
  // prose it stands for: `when you reach character level 3, you learn the
  // command spell`.
  let levelRows = 0;
  const lines = raw.map((line) => {
    const row = expands ? null : LEVEL_GATE_ROW.exec(line);
    if (row === null) return line;
    levelRows += 1;
    const level = Number(row[1]);
    const cell = row[2] ?? '';
    const names = cell.split(/,? (?:and|or) |, /).map((n) => n.trim());
    const said = GRANTS_BEFORE.test(cell)
      ? cell
      : names.every(isName)
        ? `you learn the ${names.join(' and ')} ${names.length > 1 ? 'spells' : 'spell'}`
        : '';
    return level > 1 && said !== '' ? `when you reach character level ${level}, ${said}` : said;
  });
  const sameList = lines.some((line) => SAME_LIST.test(line));
  const seen = new Set<string>();
  // A table row (`Drow | You also know the Dancing Lights cantrip. | ...`) is
  // one option of several, not a grant; only a row of spells by level is read.
  const isRow = (line: string) => line.includes(' | ');
  const reads = lines.map((sentence, i) =>
    isRow(sentence)
      ? readSentence('', '', sameList, index, prepares, seen)
      : readSentence(sentence, lines[i + 1] ?? '', sameList, index, prepares, seen),
  );
  const namesAny = (r: Read | undefined) =>
    r !== undefined && (r.names.length > 0 || r.whole.length > 0 || r.picks.length > 0);
  // How often a sentence's spells are cast: as it says, or as the next one says
  // while that names no spell of its own, or as the trait says anywhere of
  // casting (not of the feat's teleport).
  const traitFrequency = lines
    .filter((line) => /\bcast/.test(line))
    .map(frequencyIn)
    .find((f) => f !== undefined);
  // Once a sentence: a sentence may name many spells.
  const frequencies = new Map<number, Frequency>();
  const frequencyAt = (i: number): Frequency => {
    const known = frequencies.get(i);
    if (known !== undefined) return known;
    const found = frequencyIn(lines[i] ?? '') ??
      (namesAny(reads[i + 1]) ? undefined : frequencyIn(lines[i + 1] ?? '')) ??
      traitFrequency ?? { kind: 'none' };
    frequencies.set(i, found);
    return found;
  };

  const grants: Grant[] = [];
  let ability: SpellAbility | undefined;
  let lists: TraitSpells['lists'];
  let speaks = false;
  let tabled = false;
  let missed = false;
  let lastClasses: string[] = [];
  reads.forEach((read, i) => {
    const sentence = lines[i] ?? '';
    ability = abilityIn(sentence) ?? ability;
    if (!isRow(sentence) && GRANT_WORDS.test(sentence)) {
      speaks = true;
      // `as shown on the table` is read from the table's rows.
      if (!namesAny(read) && !(levelRows > 0 && /\btable\b/.test(sentence))) missed = true;
    }
    tabled ||= read.tabled;
    const often = (cantrip: boolean): Frequency => (cantrip ? { kind: 'none' } : frequencyAt(i));
    for (const w of read.whole) {
      grants.push({
        ref: w.ref,
        cantrip: w.cantrip,
        gate: w.gate,
        prepared: read.prepared && !w.cantrip,
        frequency: w.cantrip ? { kind: 'none' } : (w.frequency ?? often(false)),
      });
    }
    // The spells a sentence names, then the one it lets the reader choose, as the data lists them.
    for (const { name, cantrip } of read.names) {
      grants.push({
        ref: read.castAt !== undefined && !cantrip ? `${name}#${read.castAt}` : name,
        cantrip,
        gate: read.gate,
        prepared: read.prepared && !cantrip,
        frequency: often(cantrip),
      });
    }
    for (const pick of read.picks) {
      // `choose a level 1 spell from that spell list`: the list a pick before named.
      if (pick.classes.length === 0 && THAT_LIST.test(sentence)) pick.classes = lastClasses;
      if (pick.classes.length > 0) lastClasses = pick.classes;
      if (lists !== undefined && SAME_LIST.test(sentence)) {
        // `Choose a level 1 spell from the same list`: one more pick from the list chosen.
        lists.picks.push(pick);
        lists.prepared ||= read.prepared && !pick.cantrip;
        if (!pick.cantrip) lists.frequency = frequencyAt(i);
      } else if (SAME_LIST.test(sentence) && classesIn(sentence).length === 0) {
        // The list another feat chose (`from the same list you selected for the
        // Magic Initiate feat's cantrips`): not this text's to say.
        tabled = true;
      } else if (pick.oneList) {
        lists = {
          classes: pick.classes,
          picks: [pick],
          gate: read.gate,
          prepared: false,
          frequency: { kind: 'none' },
        };
      } else {
        grants.push({
          ref: pickRef(pick, pick.classes),
          cantrip: pick.cantrip,
          gate: read.gate,
          prepared: read.prepared && !pick.cantrip,
          frequency: often(pick.cantrip),
        });
      }
    }
  });
  // `the spells on the Azorius Guild Spells table are added to the spell list
  // of your spellcasting class`, then a row for each spell level.
  let rows = 0;
  for (const line of expands ? lines : []) {
    const row = LEVEL_ROW.exec(line);
    if (row === null) continue;
    rows += 1;
    // A cell lists by commas, so `create or destroy water` and `spare the dying` are whole.
    for (const part of (row[3] ?? '').split(',')) {
      const name = part.trim().replace(/^(?:and|or) /, '');
      const words = name.split(' ');
      const bad =
        name.length > 60 || words.length > MAX_NAME_WORDS || words.some((w) => /^\d/.test(w));
      if (bad || !isName(words[0] ?? '')) continue;
      grants.push({
        ref: name,
        cantrip: false,
        gate: `s${row[2] ?? '0'}`,
        prepared: false,
        frequency: { kind: 'none' },
        expanded: true,
      });
    }
  }
  if (expands && rows === 0) tabled = true;
  const none = grants.length === 0 && lists === undefined;
  const out: TraitSpells = { grants, unread: (speaks && none) || tabled || missed };
  if (ability !== undefined) out.ability = ability;
  if (lists !== undefined) out.lists = lists;
  return out;
}

function pushTo(
  section: Record<string, SpellRef[] | Bucket>,
  gate: string,
  frequency: Frequency,
  ref: SpellRef,
): void {
  const value = section[gate];
  if (frequency.kind === 'none') {
    if (Array.isArray(value)) value.push(ref);
    else if (value === undefined) section[gate] = [ref];
    else (value._ ??= []).push(ref);
    return;
  }
  // Spells with no free cast keep none beside counted ones at one level: `_`, as the data writes it.
  const bucket: Bucket = Array.isArray(value) ? { _: value } : (value ?? {});
  section[gate] = bucket;
  if (frequency.kind === 'daily' || frequency.kind === 'rest') {
    const counts = (bucket[frequency.kind] ??= {});
    (counts[frequency.count] ??= []).push(ref);
    return;
  }
  (bucket[frequency.kind] ??= []).push(ref);
}

/** `"1": [a, b]` is one cast between them; text that gives each its own is `"1e"`. */
function eachOwn(section: Record<string, SpellRef[] | Bucket> | undefined): void {
  for (const value of Object.values(section ?? {})) {
    if (Array.isArray(value)) continue;
    for (const kind of ['daily', 'rest'] as const) {
      const counts = value[kind];
      if (counts === undefined) continue;
      for (const [count, list] of Object.entries(counts)) {
        if (list.length > 1 && /^\d+$/.test(count)) {
          delete counts[count];
          counts[`${count}e`] = list;
        }
      }
    }
  }
}

function blockOf(
  grants: readonly Grant[],
  ability: SpellAbility | undefined,
  firstLevel: string,
): SpellBlock {
  const block: SpellBlock = {};
  if (ability !== undefined) block.ability = ability;
  for (const g of grants) {
    const gate = g.gate === '_' ? firstLevel : g.gate;
    if (g.expanded === true) {
      const expanded = (block.expanded ??= {});
      (expanded[gate] ??= []).push(g.ref);
    } else if (g.cantrip) {
      // A named cantrip is marked one, as the data marks it.
      const ref = typeof g.ref === 'string' && !g.ref.includes('#') ? `${g.ref}#c` : g.ref;
      const known = (block.known ??= {});
      (known[gate] ??= []).push(ref);
    } else if (g.prepared) {
      // Always prepared, with any free casts on top, as the newer books write it.
      pushTo((block.prepared ??= {}), gate, g.frequency, g.ref);
    } else {
      pushTo((block.innate ??= {}), gate, g.frequency, g.ref);
    }
  }
  eachOwn(block.innate);
  eachOwn(block.prepared);
  return block;
}

/**
 * The `additionalSpells` an entry's traits grant, undefined for none, and
 * whether a trait speaks of spells this could not read. `ability` is a race's
 * `<spellAbility>`, for traits that name none. `firstLevel` keys what is had
 * from the start: the data writes `1` on a race, `_` on a feat.
 */
export function readSpellGrants(
  traits: readonly string[],
  index: SpellIndex | undefined,
  opts: { prepares: boolean; firstLevel: '1' | '_'; ability?: AbilityKey },
): { blocks?: SpellBlock[]; unread: boolean } {
  const grants: Grant[] = [];
  let ability: SpellAbility | undefined;
  let anyAbility: SpellAbility | undefined;
  let lists: TraitSpells['lists'];
  let unread = false;
  for (const text of traits) {
    const read = readTraitSpells(text, index, opts.prepares);
    unread ||= read.unread;
    if (read.grants.length > 0 || read.lists !== undefined) ability ??= read.ability;
    anyAbility ??= read.ability;
    grants.push(...read.grants);
    lists ??= read.lists;
  }
  ability ??= anyAbility ?? opts.ability;
  if (lists !== undefined) {
    const { classes, picks, gate, prepared, frequency } = lists;
    const blocks = classes.map((cls) => {
      const fromList: Grant[] = picks.map((pick) => ({
        ref: pickRef(pick, [cls]),
        cantrip: pick.cantrip,
        gate,
        prepared: prepared && !pick.cantrip,
        frequency: pick.cantrip ? { kind: 'none' } : frequency,
      }));
      return {
        name: `${cls} Spells`,
        ...blockOf([...fromList, ...grants], ability, opts.firstLevel),
      };
    });
    return { blocks, unread };
  }
  if (grants.length === 0) return { unread };
  return { blocks: [blockOf(grants, ability, opts.firstLevel)], unread };
}
