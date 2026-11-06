/**
 * Generic prose scanner — broad automation for the long tail of traits and
 * features whose mechanics exist only in text. Detects limited-use wording
 * ("once per long rest", "a number of times equal to your proficiency bonus"),
 * action economy ("as a bonus action"), per-level HP riders, and standing bonuses
 * to checks and initiative, then emits the matching effects. The curated table
 * stays the precision override: call this only when no curated entry handled the
 * feature.
 */
import { plainEntryText } from '../../data5e/entries/plainText';
import {
  type Ability,
  type BonusAmount,
  type EffectInput,
  type EffectOrigin,
  SKILLS,
} from '../types';
import type { Collector } from './base';

const DAMAGE_TYPES =
  'acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder';
const ABILITY_WORDS: Record<string, Ability> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

/**
 * Where prose says a dice roll deals damage, by the wordings the data uses. A
 * roll that says neither is plain dice rather than damage, so a word missing
 * here costs a chip's colour, where a loose match would call a die damage that
 * reduces it ("you take 1d6 less damage").
 *
 * After the dice: "2d6 damage", "2d8 lightning or thunder damage", "1d6 acid,
 * cold, or fire damage", "1d6 + your Strength modifier piercing damage".
 */
const DAMAGE_AFTER_DICE = new RegExp(
  `^ *(?:(?:\\+|plus) your [a-z]+ modifier )?(?:extra |additional )?(?:(?:${DAMAGE_TYPES})(?:, or |, | or | ))*damage\\b`,
);
/** Before the dice: "cold damage equal to 1d8", "this damage increases by 1d10". */
const DAMAGE_BEFORE_DICE = /damage (?:equal to|increases (?:to|by)) $/;

/**
 * An entries tree as its strings, in plain lowercase, reading each tag as the
 * words it displays: 2024 prose writes "proficiency bonus" as
 * `{@variantrule Proficiency|XPHB|Proficiency Bonus}`, and the patterns below
 * match what the player reads. Each string is read on its own, so one unclosed
 * tag cannot leave the tags in the strings after it unread.
 *
 * `skipNamedOptions` drops named items nested in a list or options node. Those
 * are the alternatives a player picks between (a Shifter's Longtooth bite, a
 * Totem Warrior's animal), so a scan that wants only what the trait itself
 * always grants must not read them.
 */
function entryStrings(entries: unknown, opts: { skipNamedOptions?: boolean } = {}): string[] {
  const parts: string[] = [];
  const walk = (v: unknown, inChoiceList: boolean): void => {
    if (typeof v === 'string') {
      parts.push(plainEntryText(v).replaceAll('’', "'").toLowerCase());
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, inChoiceList);
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      if (opts.skipNamedOptions === true && inChoiceList && typeof o.name === 'string') return;
      const nested = inChoiceList || o.type === 'list' || o.type === 'options';
      walk(o.entries, nested);
      walk(o.entry, nested);
      walk(o.items, nested);
    }
  };
  walk(entries, false);
  return parts;
}

/** An entries tree flattened to one string of plain lowercase text. */
export function flattenEntries(
  entries: unknown,
  opts: { skipNamedOptions?: boolean } = {},
): string {
  return entryStrings(entries, opts).join(' ');
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

/** Prose saying a thing can be done once between rests. */
function statesOnceLimit(text: string): boolean {
  return (
    /once per (?:short|long) rest/.test(text) ||
    /you can'?t (?:use (?:it|this (?:trait|feature))|do so) again until you (?:finish|complete)/.test(
      text,
    ) ||
    /must (?:then )?(?:finish|complete) a (?:short or long|short|long) rest (?:before you can use|to use)/.test(
      text,
    )
  );
}

const sentencesOf = (text: string) => text.split(/(?<=\.) /);

/**
 * A rest that only says when something else happens: "when you finish a short
 * rest, you can cast ...", "a ceremony can be held during a short or long rest".
 */
const REST_AS_OCCASION =
  /when you finish a short rest, you can [^.,;]*|(?<=^|[.,;] )[^.,;]*during a short or long rest[^.,;]*/g;
/** A sentence saying a use comes back: "regain one use", "regain it", "uses are restored". */
const USE_COMES_BACK =
  /\b(?:regain|recover|restore)[a-z]*\b[^.,;]*\b(?:uses?\b|(?:it|one|this feature)(?=[.,;]|$))|\buses?\b[^.,;]*\b(?:regained|recovered|restored|returned|returns?)\b|\b(?:recharge|refresh|replenish|reset)/;
/** A clause giving another go: "you can use it again". */
const ANOTHER_GO = /\b(?:again|once more)\b/;

/**
 * Prose without the rests that are only occasions, so none is read as the reset.
 * Only those two wordings come out, and doubt keeps them: words that a use comes
 * back leave the sentence whole, so anything added above can only keep a rest in.
 * If no rest would be left, nothing better says which one it is, so the prose stays.
 */
function withoutRestOccasions(text: string): string {
  const left = sentencesOf(text)
    .map((sentence) =>
      USE_COMES_BACK.test(sentence)
        ? sentence
        : sentence.replaceAll(REST_AS_OCCASION, (clause) =>
            ANOTHER_GO.test(clause) ? clause : '',
          ),
    )
    .join(' ');
  return /\b(?:short|long) rests?\b/.test(left) ? left : text;
}

/** Text as space-padded words, so a spell's name matches whole words only. */
const asWords = (text: string) => ` ${text.replaceAll(/[^a-z0-9']+/g, ' ')} `;

/** A sentence that is one limit and nothing more, naming what it limits in `cast ...`. */
const ONE_LIMIT =
  /^once you (?:cast ([^,;]+)|use this (?:benefit|feature|trait)), you can'?t (?:do so|use (?:it|this (?:trait|feature))) again until you (?:finish|complete) a (?:short or long|short|long) rest(?:, unless [^;]*)?\.?$/;
/** A benefit of its own: something to do, or something to roll, that is not the spell. */
const OWN_BENEFIT =
  /as a bonus action|as a reaction|use your reaction|take a reaction|as an action|use your action|\bd?\d+d\d+\b/;

/** Does "cast it" or "cast this spell", in the limit, mean a spell the origin counts? */
function castsCounted(object: string, before: string, counted: string[]): boolean {
  if (counted.some((name) => asWords(object).startsWith(` ${name} `))) return true;
  const words = asWords(before);
  return (
    /^(?:it|this spell|the spell)\b/.test(object) &&
    counted.some((name) => words.includes(` ${name} `))
  );
}

/** Does "use this feature", in the limit, mean casting a spell the origin counts? */
function usesCounted(before: string[], counted: string[]): boolean {
  const casts = before.findLastIndex((sentence) => {
    const words = asWords(sentence);
    return counted.some(
      (name) => words.includes(` cast ${name} `) || words.includes(` cast the ${name} `),
    );
  });
  return casts !== -1 && !before.slice(casts + 1).some((sentence) => OWN_BENEFIT.test(sentence));
}

/**
 * Is each limit this prose states the limit on casting a spell the origin already
 * counts? Then `additionalSpells` holds those uses, and a tracker read from the
 * same words would be a second count of them, left full by every cast. Doubt
 * keeps the tracker: dropping one loses a benefit's only count, and a spare one
 * only sits there. So a picked spell, which the prose cannot name, keeps it, and
 * so does a limit with any more to it than the plain sentence ("once you use this
 * feature to alter it"), a benefit between the spell and its limit, or a count of
 * any other kind elsewhere in the prose.
 */
function limitsOnlyCountedSpells(text: string, col: Collector, origin: EffectOrigin): boolean {
  const counted = col.effects.flatMap((e) =>
    e.kind === 'grantSpell' && e.resourceKey !== undefined && e.origin.uid === origin.uid
      ? [e.spell.name.toLowerCase()]
      : [],
  );
  if (counted.length === 0) return false;
  const sentences = sentencesOf(text);
  const others: string[] = [];
  let found = false;
  for (const [at, sentence] of sentences.entries()) {
    if (!statesOnceLimit(sentence)) {
      others.push(sentence);
      continue;
    }
    const limit = sentence.match(ONE_LIMIT);
    if (limit === null) return false;
    const before = sentences.slice(0, at);
    const object = limit[1];
    const spells =
      object !== undefined
        ? castsCounted(object, before.join(' '), counted)
        : usesCounted(before, counted);
    if (!spells) return false;
    found = true;
  }
  return found && detectUses(others.join(' ')) === undefined;
}

/**
 * Limited-use wording → how many uses between rests. When several counts are
 * mentioned, the SMALLEST wins: higher counts are level-scaling text
 * ("at 18th level, three times") that doesn't apply at the base level.
 */
function detectUses(
  text: string,
): number | 'profBonus' | `abilityMod:${Ability}` | `abilityModPlus1:${Ability}` | undefined {
  if (/number of times equal to your proficiency bonus/.test(text)) return 'profBonus';
  // "a number of times equal to [1 +] your Charisma modifier [(a minimum of
  // once)]": Divine Sense, Cleansing Touch, and a long tail of race traits.
  const abilityUses = text.match(
    /number of times equal to (1 \+ )?your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/,
  );
  if (abilityUses?.[2] !== undefined) {
    const ability = ABILITY_WORDS[abilityUses[2]];
    if (ability !== undefined) {
      return abilityUses[1] !== undefined ? `abilityModPlus1:${ability}` : `abilityMod:${ability}`;
    }
  }
  const counts: number[] = [];
  if (statesOnceLimit(text)) counts.push(1);
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) twice/.test(text)) counts.push(2);
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) three times/.test(text)) {
    counts.push(3);
  }
  return counts.length > 0 ? Math.min(...counts) : undefined;
}

/**
 * The phrase that earns a chip, and where it sits. Compact, high-signal chips
 * only: bonus/reaction always; plain actions only when limited-use (otherwise
 * every prose "as an action" is noise).
 */
function chipPhrase(
  text: string,
  limitedUse: boolean,
): { economy: 'bonus' | 'reaction' | 'action'; at: number } | undefined {
  const bonus = text.search(/as a bonus action/);
  if (bonus !== -1) return { economy: 'bonus', at: bonus };
  // 2024 phrasing, with its subject: "your familiar can take a Reaction" and
  // "each target can then take a Reaction" spend that creature's Reaction, so
  // they are no chip for the character, and "you can't" forbids one.
  const reaction = text.search(/as a reaction|use your reaction|you (?:can|must) take a reaction/);
  if (reaction !== -1) return { economy: 'reaction', at: reaction };
  if (!limitedUse) return undefined;
  // 2024 phrasings: "replace one of your attacks" (Attack-action riders) and
  // "as a Magic action" (the action to use a magical trait, e.g. Healing Hands).
  const action = text.search(
    /as an action|use your action|replace one of your attacks|as a magic action/,
  );
  return action === -1 ? undefined : { economy: 'action', at: action };
}

/**
 * Dice a chip can roll. A bare d20 is left out: that names a test the player
 * already makes ("advantage on d20 tests"), not a roll this feature adds.
 */
const DICE = /\b((?:\d{1,2}d\d{1,3}|d(?!20\b)\d{1,3})(?: ?[+-] ?\d+)?)\b/g;
/** A length of time: "charmed for 1d12 hours", "until you finish 1d4 long rests". */
const TIME_AFTER_DICE =
  /^ (?:(?:short |long )?rests?|rounds?|minutes?|hours?|days?|weeks?|months?|years?)\b/;
/**
 * A level step, in the wordings the step loop reads: "5th level (d8)",
 * "levels 5 (2d10), 11 (3d10)", "3d6 at 6th level".
 */
const STEP_BEFORE_DICE = /\d(?:st|nd|rd|th)?(?: level)? \($/;
const STEP_AFTER_DICE = /^ at \d+(?:st|nd|rd|th) level/;

/**
 * The dice a chip's action rolls: the first from the sentence of its phrase on.
 * Later sentences count, since prose often names the damage after the action
 * ("you can take a Reaction to halve it. The attacker takes 2d10 ..."). Earlier
 * ones are taken as another benefit's ("you can roll 1d6 instead of 1d4"), as
 * all of them were in the release this was read against (v2.39.1). A span of
 * time, a level step or a cost to the character ("you take 1d10 force damage if
 * you end your turn inside") is skipped: none is the roll a player taps a chip for.
 */
function actionDice(text: string, phraseAt: number): RegExpExecArray | null {
  const sentenceStart = text.lastIndexOf('.', phraseAt) + 1;
  for (const m of text.matchAll(DICE)) {
    if (m.index < sentenceStart) continue;
    const before = text.slice(Math.max(0, m.index - 16), m.index);
    const after = text.slice(m.index + m[0].length);
    if (TIME_AFTER_DICE.test(after) || STEP_AFTER_DICE.test(after)) continue;
    if (STEP_BEFORE_DICE.test(before)) continue;
    if (/\byou take $/.test(before) && DAMAGE_AFTER_DICE.test(after)) continue;
    return m;
  }
  return null;
}

const ABILITY_NAME = Object.keys(ABILITY_WORDS).join('|');
const SKILL_NAME = SKILLS.map((s) => s.name.toLowerCase()).join('|');
const LIST_SEPARATOR = /, or |, | or /;
const listOf = (item: string) => `(?:${item})(?:(?:, or |, | or )(?:${item}))*`;

/**
 * Openers a sentence may have and still state a standing benefit. The patterns
 * below take the whole sentence, so any other opener or tail ("while raging",
 * "related to dragons") reads as a condition and adds nothing. A sheet number
 * that only sometimes applies is wrong, and rolls cannot take a toggled bonus yet,
 * so a phrasing missing here costs a bonus where a loose match would misstate one.
 */
const LEAD = `(?:(?:(?:starting|beginning) )?(?:at|by) \\d+(?:st|nd|rd|th) level, |in addition, |additionally, |as a result, )*`;
/** The level a matched sentence's opener waits for, if it names one. */
const LEVEL_LEAD = /\b(?:at|by) (\d+)(?:st|nd|rd|th) level, /;
/** Words that open a condition, so what they govern only sometimes applies. */
const CONDITION = `while|when(?:ever)?|if|as long as|until|during|after|for \\d+`;
/** What a bonus equals, and the "(minimum of +1)" that can follow a modifier. */
const SOURCE = `(?<source>proficiency bonus|(?:${ABILITY_NAME}) modifier)(?<min1> \\((?:a )?minimum(?: bonus)? of \\+1\\))?`;
const ROLLS_INITIATIVE = `(?<rolls>when(?:ever)? you(?: and any (?:allies|creatures) (?:of your choice|you choose)(?: within \\d+ feet of you)?)? roll initiative, )?`;
const INITIATIVE = `(?:your )?initiative(?: rolls?)?`;
/** "wisdom", "wisdom (perception)", "intelligence (arcana or nature)" or "perception". */
const CHECK_SUBJECT = `(?:${ABILITY_NAME})(?: \\(${listOf(SKILL_NAME)}\\))?|${listOf(SKILL_NAME)}`;

const HALF_PROF = new RegExp(
  `^${LEAD}you (?:can )?add half your proficiency bonus(?:,? \\(?round(?:ed)? (?<round>up|down)\\)?,?)? to any (?<abilities>ability|${listOf(ABILITY_NAME)}) checks?(?: you make)?(?: that (?<lacking>uses a skill proficiency you lack and that )?doesn't (?:already |otherwise )?(?:include|use|add) your proficiency bonus)?$`,
);
const ADD_TO_INITIATIVE = new RegExp(
  `^${LEAD}${ROLLS_INITIATIVE}you (?<can>can )?add your ${SOURCE} to (?<target>your initiative rolls?|the roll)$`,
);
const FLAT_INITIATIVE = new RegExp(
  `^${LEAD}${ROLLS_INITIATIVE}you (?:gain|have) a \\+(?<amount>\\d+) bonus to ${INITIATIVE}$`,
);
const INITIATIVE_EQUAL_TO = new RegExp(
  `^${LEAD}${ROLLS_INITIATIVE}you (?<can>can give yourself|(?:all )?(?:gain|have)) a bonus to ${INITIATIVE} equal to your ${SOURCE}$`,
);
const CHECK_BONUS = new RegExp(
  `^${LEAD}(?:when(?:ever)? you make an? (?<made>${CHECK_SUBJECT}) check, you (?<can>can give yourself|gain|have) a bonus to the check|(?:you (?<canTo>can give yourself|gain|have)|your (?:(?!\\b(?:${CONDITION})\\b)[^,])+ gives you) a bonus to your (?<named>${CHECK_SUBJECT}) checks)(?: equal to your ${SOURCE})?$`,
);
/** Where a check bonus leaves its size to the next sentence. */
const BONUS_EQUALS = new RegExp(`^the bonus equals your ${SOURCE}$`);
const PASSIVE_BONUS = new RegExp(
  `^${LEAD}you (?:gain|have) a \\+(?<amount>\\d+) bonus to your passive (?:wisdom \\()?perception\\)?(?: and passive (?:intelligence \\()?investigation\\)?)?(?: scores?)?$`,
);

/**
 * A bonus's size. An added proficiency bonus is the bonus itself, which a roll
 * takes once; one "equal to" it only matches its size. "You can" stays off the
 * roll when the modifier is negative, since nobody adds what they can leave off.
 */
function amountFrom(groups: Record<string, string | undefined>, added: boolean): BonusAmount {
  if (groups.source === 'proficiency bonus') return added ? 'profBonus' : 'equalToProfBonus';
  // SOURCE admits nothing else but an ability's modifier.
  const ability = ABILITY_WORDS[groups.source?.replace(' modifier', '') ?? ''] as Ability;
  if (groups.min1 !== undefined) return `abilityModMin1:${ability}`;
  return groups.can?.startsWith('can') === true
    ? `abilityModMin0:${ability}`
    : `abilityMod:${ability}`;
}

/** The skills a check's subject names, or else the ability it names. */
function checkTarget(subject: string): { skills: string[] } | { ability: Ability } | undefined {
  const named = subject.match(/\((.+)\)/)?.[1] ?? subject;
  const skills = named
    .split(LIST_SEPARATOR)
    .flatMap((word) => SKILLS.find((s) => s.name.toLowerCase() === word)?.name ?? []);
  if (skills.length > 0) return { skills };
  const ability = ABILITY_WORDS[subject];
  return ability === undefined ? undefined : { ability };
}

/** The bonus one sentence grants outright, if it does. `next` is the sentence after it. */
function standingBonus(
  sentence: string,
  next: string | undefined,
  origin: EffectOrigin,
): EffectInput | undefined {
  const half = sentence.match(HALF_PROF)?.groups;
  if (half !== undefined) {
    const named = half.abilities === 'ability' ? undefined : half.abilities;
    const abilities = named?.split(LIST_SEPARATOR).flatMap((word) => ABILITY_WORDS[word] ?? []);
    return {
      kind: 'halfProf',
      round: half.round === 'up' ? 'up' : 'down',
      ...(abilities === undefined ? {} : { abilities }),
      ...(half.lacking === undefined ? {} : { skillsOnly: true }),
      origin,
    };
  }

  const added = sentence.match(ADD_TO_INITIATIVE)?.groups;
  // "The roll" means initiative only when the sentence opens by rolling it.
  if (added !== undefined && (added.target !== 'the roll' || added.rolls !== undefined)) {
    return { kind: 'initiativeBonus', amount: amountFrom(added, true), origin };
  }
  const flat = sentence.match(FLAT_INITIATIVE)?.groups;
  if (flat !== undefined) {
    return { kind: 'initiativeBonus', amount: Number(flat.amount), origin };
  }
  const equal = sentence.match(INITIATIVE_EQUAL_TO)?.groups;
  if (equal !== undefined) {
    return { kind: 'initiativeBonus', amount: amountFrom(equal, false), origin };
  }

  const check = sentence.match(CHECK_BONUS)?.groups;
  if (check !== undefined) {
    const target = checkTarget(check.made ?? check.named ?? '');
    const size = check.source !== undefined ? check : next?.match(BONUS_EQUALS)?.groups;
    if (target !== undefined && size !== undefined) {
      const can = check.can ?? check.canTo;
      return {
        kind: 'checkBonus',
        amount: amountFrom({ ...size, can }, false),
        ...target,
        origin,
      };
    }
  }

  const passive = sentence.match(PASSIVE_BONUS)?.groups;
  if (passive !== undefined) {
    return { kind: 'passivePerceptionBonus', amount: Number(passive.amount), origin };
  }
  return undefined;
}

const HAS_CONDITION = new RegExp(`\\b(?:${CONDITION})\\b`);
/** A heading that puts everything after it under a condition or a choice. */
function governsTheRest(sentence: string): boolean {
  if (/^(?:choose|pick|select)\b|\bone of the following\b/.test(sentence)) return true;
  return /:$|\bthe following\b/.test(sentence) && HAS_CONDITION.test(sentence);
}
/** A sentence that puts the ones after it in its string under a condition or an action. */
const GOVERNS_THE_STRING = new RegExp(
  `^${LEAD}(?:${CONDITION})\\b|\\bas an? (?:bonus |magic )?(?:action|reaction)\\b|\\buse your (?:bonus action|action|reaction)\\b`,
);
/** Wordings that make what came before them something to spend or lose. */
const LIMITS = /^once you\b|\bonce per\b|\bthis bonus\b|\bcan't (?:use|do)\b.*\bagain\b/;

/**
 * Standing bonuses to checks, initiative and passive Perception, read a sentence
 * at a time from what the trait always grants. Scope is taken on the safe side, as
 * the patterns above are: a limit anywhere later in the string keeps the bonus off
 * the sheet even if it was about another benefit, a condition keeps the rest of its
 * string out, and a heading with one or a choice keeps the rest of the feature out.
 * Another string is taken as another benefit, so its limit is not this bonus's.
 */
function emitStandingBonuses(col: Collector, entries: unknown, origin: EffectOrigin): void {
  const totalLevel = col.doc.classes.reduce((s, c) => s + c.levels, 0);
  const limits = (sentence: string) => LIMITS.test(sentence) || detectUses(sentence) !== undefined;
  for (const string of entryStrings(entries, { skipNamedOptions: true })) {
    const sentences = string.split(/(?<=[.!?])\s+/).map((s) => s.replace(/[.!?]$/, ''));
    for (const [i, sentence] of sentences.entries()) {
      if (governsTheRest(sentence)) return;
      const bonus = standingBonus(sentence, sentences[i + 1], origin);
      const fromLevel = Number(sentence.match(LEVEL_LEAD)?.[1] ?? 0);
      if (bonus !== undefined && totalLevel >= fromLevel && !sentences.slice(i + 1).some(limits)) {
        col.add(bonus);
      }
      if (GOVERNS_THE_STRING.test(sentence)) break;
    }
  }
}

/**
 * Scan one named trait/feature and emit resource / action / HP / bonus effects.
 * Safe to call on anything — no-ops when no usage wording is found.
 */
export function proseScanFeature(
  col: Collector,
  name: string,
  entries: unknown,
  origin: EffectOrigin,
): void {
  const text = flattenEntries(entries);
  if (text.length === 0) return;

  const detected = detectUses(text);
  const uses = detected === 1 && limitsOnlyCountedSpells(text, col, origin) ? undefined : detected;
  if (uses !== undefined) {
    // The clauses that return uses decide, when there are any, and a short rest
    // that returns even one counts. Any other rest a trait mentions is about
    // something else: Star Map's replacement ritual "during a short or long
    // rest", Mist Walker's drain on "a short rest", or a spell's own free cast
    // ("regain the ability to cast it") when the limit read is another sentence's.
    const returnsUses = text
      .split(/[.,;]/)
      .filter((c) => c.includes('regain') && /\buses?\b/.test(c) && c.includes('when you finish'));
    const notSpells = sentencesOf(text)
      .filter((s) => !/regain the ability to cast/.test(s))
      .join(' ');
    const resetText =
      returnsUses.length > 0
        ? returnsUses.join(' ')
        : withoutRestOccasions(statesOnceLimit(notSpells) ? notSpells : text);
    const resetOn = /short or long rest|finish a short rest/.test(resetText) ? 'short' : 'long';
    col.add({ kind: 'resource', key: slug(name), label: name, max: uses, resetOn, origin });
  }

  const phrase = chipPhrase(text, uses !== undefined);
  // Limited-use features also get a roll chip, from the dice their action rolls.
  const dice = uses !== undefined && phrase !== undefined ? actionDice(text, phrase.at) : null;
  let roll = dice?.[1] !== undefined ? dice[1].replace(/^d/, '1d').replaceAll(' ', '') : undefined;
  const diceAt = dice?.index ?? 0;
  const sentenceEnd = text.indexOf('.', diceAt);
  const diceSentence =
    dice === null
      ? ''
      : text.slice(text.lastIndexOf('.', diceAt) + 1, sentenceEnd === -1 ? undefined : sentenceEnd);
  const afterDice = dice === null ? '' : text.slice(diceAt + dice[0].length);
  const dealsDamage =
    dice !== null &&
    (DAMAGE_AFTER_DICE.test(afterDice) ||
      DAMAGE_BEFORE_DICE.test(text.slice(Math.max(0, diceAt - 30), diceAt)));
  // Other dice in a sentence about regaining hit points are a heal.
  const heals =
    /\b(?:regain(?:s|ing)?|returns? to life)\b/.test(diceSentence) &&
    /\bhit points?\b/.test(diceSentence) &&
    !dealsDamage;
  // Anything left is neither: a bonus die, temporary hit points, damage reduced.
  const plainDice = dice !== null && !dealsDamage && !heals;

  // Level-scaled dice — use the biggest step the character's total level has
  // reached. Two phrasings: 2014 "3d6 at 6th level" and 2024 "levels 5 (2d10),
  // 11 (3d10)". Both give absolute dice for a level threshold.
  if (roll !== undefined) {
    const totalLevel = col.doc.classes.reduce((s, c) => s + c.levels, 0);
    const steps: Array<[number, string]> = [];
    // From the rolled die on: a step before it scales another benefit's die.
    const fromDice = text.slice(diceAt);
    for (const m of fromDice.matchAll(/(\d+d\d+(?: ?[+-] ?\d+)?) at (\d+)(?:st|nd|rd|th) level/g)) {
      if (m[1] !== undefined && m[2] !== undefined) steps.push([Number(m[2]), m[1]]);
    }
    // Two paren forms: 2024 "levels 5 (2d10)" and FTD "5th level (2d10)".
    for (const m of fromDice.matchAll(/(\d+)(?:st|nd|rd|th)?(?: level)? \((\d+d\d+)\)/g)) {
      if (m[1] !== undefined && m[2] !== undefined) steps.push([Number(m[1]), m[2]]);
    }
    steps.sort((a, b) => a[0] - b[0]);
    for (const [stepLevel, stepDice] of steps) {
      if (totalLevel >= stepLevel) roll = stepDice.replaceAll(' ', '');
    }
  }

  // Mechanics the prose states outright: damage type, area, and save. A
  // limited-use chip reads its damage type from the rolled die onward, so one
  // that rolls nothing shows no type from another benefit's die.
  const dmgType = text
    .slice(uses === undefined ? 0 : (dice?.index ?? text.length))
    .match(new RegExp(`\\d+d\\d+(?: ?[+-] ?\\d+)? (${DAMAGE_TYPES}) damage`))?.[1];
  const area = text.match(
    /in a (\d+-foot-wide, \d+-foot-long line|\d+-foot(?:-radius)? (?:cone|line|sphere|cube|radius))/,
  )?.[1];
  const note = [dmgType, area].filter((s) => s !== undefined).join(' · ') || undefined;
  const targetAbility =
    ABILITY_WORDS[
      text.match(
        /must (?:then )?(?:each )?make an? (strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/,
      )?.[1] ?? ''
    ];
  // DC phrasing varies: 2014 "equals 8 + your X modifier + your proficiency
  // bonus"; 2024 "(8 plus your X modifier and proficiency bonus)". Accept both
  // orders of ability/proficiency too.
  const dcAbility =
    ABILITY_WORDS[
      text.match(
        /8 (?:\+|plus) your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier (?:\+|and) (?:your )?proficiency bonus/,
      )?.[1] ??
        text.match(
          /8 (?:\+|plus) your proficiency bonus (?:\+|and) your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/,
        )?.[1] ??
        ''
    ];
  const save =
    targetAbility !== undefined && dcAbility !== undefined
      ? { targetAbility, dcAbility }
      : undefined;

  if (phrase !== undefined) {
    col.add({
      kind: 'action',
      label: name,
      roll,
      heals,
      plainDice,
      note,
      save,
      origin,
      economy: phrase.economy,
    });
  }

  const hp = text.match(
    /hit point maximum increases by (\d+)[^.]*?(?:every time|whenever|when) you gain a level/,
  );
  if (hp?.[1] !== undefined) {
    col.add({ kind: 'hpPerLevel', amount: Number(hp[1]), origin });
  }

  emitStandingBonuses(col, entries, origin);

  // Natural weapons (Ram, Cat's Claws, Bite, …): an unarmed strike with its own
  // damage die and type, stated in one of two phrasings: "you deal bludgeoning
  // damage equal to 1d4 + your Strength modifier" (MOT/VGM) or "deals 1d6 +
  // your Strength modifier bludgeoning damage" (MPMM). Gated on "unarmed
  // strike" so a class feature mentioning dice never becomes a weapon.
  //
  // Read from the trait's own prose, excluding named sub-options: a Shifter's
  // bite belongs to the Longtooth option nested inside Shifting, so scanning
  // the whole subtree would arm every Beasthide and Swiftstride too.
  const ownText = flattenEntries(entries, { skipNamedOptions: true });
  if (/unarmed strike/.test(ownText)) {
    const ability = `(${Object.keys(ABILITY_WORDS).join('|')})`;
    // The modifier is captured from the damage phrase itself, not anywhere in
    // the trait: a Dhampir's bite adds CON while the same trait's save DC also
    // names CON, and Dragon Hide states a DEX-based AC beside a STR bite.
    const typeFirst = ownText.match(
      new RegExp(
        `deal(?:s|ing)? (${DAMAGE_TYPES}) damage equal to (\\d+d\\d+)(?: (?:\\+|plus) your ${ability} modifier)?`,
      ),
    );
    const diceFirst = ownText.match(
      new RegExp(`deals? (\\d+d\\d+) \\+ your ${ability} modifier (${DAMAGE_TYPES}) damage`),
    );
    const dmgDice = typeFirst?.[2] ?? diceFirst?.[1];
    const weaponType = typeFirst?.[1] ?? diceFirst?.[3];
    const weaponAbility = ABILITY_WORDS[typeFirst?.[3] ?? diceFirst?.[2] ?? ''] ?? 'str';
    if (dmgDice !== undefined && weaponType !== undefined) {
      // Two shapes share this wording. A trait that names a body part or calls
      // it a natural weapon (Ram, Claws, Horns) is a distinct attack, and so is
      // one that changes what you deal or what you add, like a Dhampir's bite
      // (piercing, CON). What is left only enlarges the die of an ordinary
      // punch, so it belongs on the Unarmed Strike row rather than beside it as
      // a strictly better copy: Unarmed Fighting and Tavern Brawler.
      const grantsWeapon = /natural weapons?|to make (?:an |your )?unarmed strikes?/.test(ownText);
      const isPlainPunch = weaponType === 'bludgeoning' && weaponAbility === 'str';
      if (!grantsWeapon && isPlainPunch) {
        col.add({ kind: 'unarmedDamage', label: name, dice: dmgDice, origin });
      } else {
        col.add({
          kind: 'naturalWeapon',
          label: name,
          dice: dmgDice,
          damageType: weaponType,
          ability: weaponAbility,
          origin,
        });
      }
    }
  }

  // Natural armor: a fixed base AC stated in prose ("base AC of 17";
  // "13 + [your] Dexterity modifier") or a flat "+3 bonus to Armor Class".
  // Gated to the trait name so unrelated AC mentions don't trigger it;
  // generalizes across Tortle, Lizardfolk, Loxodon, Locathah, Warforged…
  if (/natural armor/.test(name.toLowerCase())) {
    const withMod = text.match(
      /(\d+) \+ (?:your )?(strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/,
    );
    const flat =
      text.match(/base ac (?:of|is|equals|,) (\d+)/) ?? text.match(/ac (?:of|is) (\d+)\b/);
    const bonus = text.match(/\+\s*(\d+) bonus to (?:your )?armor class/);
    if (withMod?.[1] !== undefined && withMod[2] !== undefined) {
      const ability = ABILITY_WORDS[withMod[2]];
      col.add({
        kind: 'acFormula',
        label: name,
        base: Number(withMod[1]),
        addAbilities: ability !== undefined ? [ability] : [],
        origin,
      });
    } else if (flat?.[1] !== undefined) {
      col.add({ kind: 'acFormula', label: name, base: Number(flat[1]), addAbilities: [], origin });
    } else if (bonus?.[1] !== undefined) {
      col.add({ kind: 'acBonus', amount: Number(bonus[1]), origin });
    }
  }
}
