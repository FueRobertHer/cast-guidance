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
const ABILITY_NAME = Object.keys(ABILITY_WORDS).join('|');
const USES_BY_ABILITY = new RegExp(
  `number of times equal to (1 \\+ )?your (${ABILITY_NAME}) modifier`,
);

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
 * always grants must not read them. `skipNamed` drops every named node, leaving
 * only the words that are not under any benefit's name.
 */
function entryStrings(
  entries: unknown,
  opts: { skipNamedOptions?: boolean; skipNamed?: boolean } = {},
): string[] {
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
      if (
        typeof o.name === 'string' &&
        (opts.skipNamed || (opts.skipNamedOptions && inChoiceList))
      ) {
        return;
      }
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
  opts: { skipNamedOptions?: boolean; skipNamed?: boolean } = {},
): string {
  return entryStrings(entries, opts).join(' ');
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

const totalLevelOf = (col: Collector) => col.doc.classes.reduce((s, c) => s + c.levels, 0);

const sentencesOf = (text: string) => text.split(/(?<=\.) /);

/**
 * The wordings the release uses for one use between rests, and no others: a verb
 * missing here costs a tracker, where a loose match would read "you can't charm it
 * again" as a pool when it only spares that target. Each names what ends the wait:
 * "until you start your next turn" is no limit between rests.
 */
const ONCE_BETWEEN_RESTS =
  /once per (?:short|long) rest|you can'?t (?:(?:use (?:it|the (?:action|feature)|this (?:trait|feature|benefit|ability))|do so(?: in this way)?|create it|enter) again|[a-z]+ another one with it) until you (?:(?:finish|complete|start)\b[^.,;]*\b(?:rests?|another)\b|roll initiative)|can'?t do so again until he or she (?:finishes|completes)\b[^.,;]*\brests?\b|can'?t be used again until (?:the next )?dawn|must (?:then )?(?:finish|complete) a (?:short or long|short|long) rest (?:before you can use|to use)/;
/**
 * A free cast of one spell, in a sentence of its own: "you can cast it once, and you
 * regain the ability to cast it", or "you must finish a long rest before you can cast
 * it". The rest and the "you" are required: a lost ability that returns when a stun
 * ends is no pool, and a target's wait is not yours. A limit on each of several ("cast
 * either spell", "each spell"), said here or in the sentence before, is left out: a
 * count of one would be wrong, and `additionalSpells` is what opens one pool per spell.
 */
const FREE_CAST =
  /regain the ability to (?:cast it|do so)\b[^.]*\b(?:rests?|dawn)\b|you must (?:then )?(?:finish|complete) a (?:short or long|short|long) rest (?:(?:before you can|to) cast (?:it|the spell)|before you can do so)\b|you can'?t cast it in this way again until you (?:finish|complete)\b[^.,;]*\brests?\b/;
const EACH_OF_SEVERAL =
  /\b(?:each|either|both|any) of\b|\b(?:each|either|both) (?:spell|these|those)/;
/**
 * Words that put what follows on a later level. A race's spell waits for that level,
 * when `additionalSpells` counts it, so reading it here would show a tracker for a
 * spell the character does not have yet. A class's feature opens on "at 3rd level,"
 * or "starting at 3rd level," and only reaches the sheet then, so those still count
 * as now: only a later sentence is a later level.
 */
const LATER_LEVEL =
  /\b(?:(?:when|once) you reach|(?:starting|beginning) at) (?:\d+(?:st|nd|rd|th) level|(?:character )?levels? \d)/;
const LEVEL_OPENER = /^(?:starting|beginning) at (?:\d+(?:st|nd|rd|th) level|level \d)/;

/** Does this prose give one spell a free cast, with no later level before it? */
function statesFreeCast(text: string): boolean {
  let before = '';
  for (const sentence of sentencesOf(text.replace(LEVEL_OPENER, ''))) {
    if (LATER_LEVEL.test(sentence)) return false;
    if (FREE_CAST.test(sentence) && !EACH_OF_SEVERAL.test(`${before} ${sentence}`)) return true;
    before = sentence;
  }
  return false;
}

/** Prose saying a thing can be done once between rests. */
function statesOnceLimit(text: string): boolean {
  return ONCE_BETWEEN_RESTS.test(text) || statesFreeCast(text);
}

/**
 * A rest that only says when something else happens: "when you finish a short
 * rest, you can cast ...", "a ceremony can be held during a short or long rest".
 */
const REST_AS_OCCASION =
  /when you finish a short rest, you can [^.,;]*|(?<=^|[.,;] )[^.,;]*during a short or long rest[^.,;]*/g;
/**
 * The words that make a short rest the reset. The two looser ones must end a limit
 * ("until you finish a rest"), so one that only says when something else happens
 * ("when you finish a rest, you can") leaves a long rest's limit alone.
 */
const SHORT_REST_RESET =
  /short or long rest|(?:finish(?:es)?|completes?|start) a short rest|until you (?:roll initiative or )?finish a (?:rest\b|long rest or short rest)/;
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
  /^once you (?:cast ([^,;]+)|use this (?:benefit|feature|trait)), you can'?t (?:do so(?: in this way)?|use (?:it|this (?:trait|feature))) again until you (?:finish|complete) a (?:short or long|short|long) rest(?:,? unless [^;]*)?\.?$/;
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
 * any other kind elsewhere in the prose. The one exception is a free cast, which can
 * only be a spell's limit: those count for any spell the origin counts, picks too,
 * since feats that say "this feat's spell" would otherwise show every use twice.
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
    const before = sentences.slice(0, at);
    if (
      FREE_CAST.test(sentence) &&
      /\b(?:can|may|to) cast\b/.test(`${before.at(-1) ?? ''} ${sentence}`)
    ) {
      found = true;
      continue;
    }
    const limit = sentence.match(ONE_LIMIT);
    if (limit === null) return false;
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
  const abilityUses = text.match(USES_BY_ABILITY);
  if (abilityUses?.[2]) {
    // The pattern admits nothing else but an ability's name.
    const ability = ABILITY_WORDS[abilityUses[2]] as Ability;
    return abilityUses[1] ? `abilityModPlus1:${ability}` : `abilityMod:${ability}`;
  }
  if (ONCE_BETWEEN_RESTS.test(text)) return 1;
  const used = (times: string) =>
    new RegExp(
      `(?<!can'?t )use (?:this (?:trait|feature|ability)|it|your [\\w\\s]{1,30}?) ${times}(?! (?:per|each|in an?) (?:turn|round))`,
    ).test(text);
  const held = text.match(
    /(?:^|[.,;] )you have (one|two|three) uses? of this (?:ability|feature|trait)\b/,
  )?.[1];
  if (held === 'one') return 1;
  if (used('twice') || held === 'two') return 2;
  if (used('three times') || held === 'three') return 3;
  // Last, since "you regain the ability to do so" leaves a count stated above standing.
  return statesFreeCast(text) ? 1 : undefined;
}

/**
 * A clause that only ends what the feature started: the verb and a short object, "end
 * it", "dismiss the spectral mind", "extinguish or restore the light". A longer object
 * is something else being ended ("end one effect on yourself"), which can be the
 * feature's whole use.
 */
const ENDS_IT = String.raw`\b(?:end|dismiss|extinguish(?: or restore)?) (?:it|them|(?:this|that|the|your) (?:\w+ )?\w+)`;
/**
 * "As a bonus action", unless it only ends what the feature started: "until you end it
 * as a bonus action" is how a transformation stops, and the slot that starts it is the
 * one to show. "Summon or dismiss it" starts it too.
 */
const AS_BONUS_ACTION = new RegExp(`(?<!(?<! or )${ENDS_IT} )as a bonus action`);
/**
 * The wordings with their subject: "your familiar can take a Reaction" and "each
 * target can then take a Reaction" spend that creature's Reaction, so they are no
 * chip for the character, and "you can't" forbids one. "Using" also needs a clause that
 * spends it: "without using your reaction" keeps it, and "when using" is a trigger.
 */
const REACTION_PHRASE =
  /as a reaction|\buse your reaction|(?<!\b(?:without|of|when|while) )\busing your reaction|you can use a reaction|the sidekick can use its reaction|you (?:can|must) take a reaction|you get a special reaction/;
/**
 * 2024 phrasings: "replace one of your attacks" (Attack-action riders) and "as a
 * Magic action" (the action to use a magical trait, e.g. Healing Hands). A subject is
 * needed for "take a Magic action" and the other "replace" wordings, since "until you
 * take a Magic action to dismiss it" is no use of the feature and "your wolf can replace"
 * is the wolf's. "Using your action" opens its clause, as "you can do so without using
 * your action" does not.
 */
const ACTION_PHRASE = new RegExp(
  `as an action|\\buse your action|(?<=^|[.,;] )using your action|replace one of your attacks|you can replace (?:one of the attacks|a single attack)|as a magic action|you can take a magic action(?! to ${ENDS_IT}(?:[.,;]|$))`,
);
/**
 * A bonus action the feature gives, in its looser wordings, with its subject as for a
 * reaction: "when you take a bonus action" only rides on one, and "the paladin can use
 * a bonus action" is the same feature's follow-up. These read after the wordings above,
 * so a chip those give stays where it is. Beside a limited feature's plain action, the
 * first one named is its use: "as an action, you build it" comes before the bonus action
 * that commands it, and the limit is on building it.
 */
const BONUS_GIVEN = new RegExp(
  `(?:you|the sidekick) can (?:use|take) (?:a|the) bonus action(?! to ${ENDS_IT}(?:[.,;]|$))|unless you take a bonus action|follow that attack with a bonus action`,
);
/**
 * A reaction the sentence does not name, since an Opportunity Attack always takes one,
 * unless its own clause says otherwise. It is no phrase of `REACTION_PHRASE`, which also
 * ends what a bonus action's chip reads: a rider with an Opportunity Attack leaves that
 * chip's save its own.
 */
const OPPORTUNITY_ATTACK = /you can make an opportunity attack(?![^.,;]*(?:without|bonus action))/;

/**
 * The phrase that earns a chip, and where it sits. Compact, high-signal chips
 * only: bonus/reaction always; plain actions only when limited-use (otherwise
 * every prose "as an action" is noise). `plainActionForcingSave` reads the one other
 * plain action worth a chip.
 */
export function chipPhrase(
  text: string,
  limitedUse: boolean,
): { economy: 'bonus' | 'reaction' | 'action'; at: number } | undefined {
  const bonus = text.search(AS_BONUS_ACTION);
  if (bonus !== -1) return { economy: 'bonus', at: bonus };
  const reaction = text.search(REACTION_PHRASE);
  if (reaction !== -1) return { economy: 'reaction', at: reaction };
  const action = limitedUse ? text.search(ACTION_PHRASE) : -1;
  const given = text.search(BONUS_GIVEN);
  if (action !== -1 && (given === -1 || action < given)) return { economy: 'action', at: action };
  if (given !== -1) return { economy: 'bonus', at: given };
  const opportunity = text.search(OPPORTUNITY_ATTACK);
  return opportunity === -1 ? undefined : { economy: 'reaction', at: opportunity };
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

/**
 * A save the feature puts on someone else, in the wordings the data uses. Anything
 * else stays out, so a word missing here costs a chip its save, where a loose match
 * would show the character's own roll ("you make", "you have advantage on", "when
 * you fail", a repeat) as one they force. "You must" is theirs too, unless the
 * "you" only places the targets: "creatures within 10 feet of you must". A clause
 * opening on "when" or "if" is a trigger, not the feature's doing: "when an ally must
 * make ..., you can use your reaction". Groups: a fixed DC, then the ability.
 */
const FORCED_SAVE = new RegExp(
  `(?<!(?:^ ?|[.,;] )(?:when|if)[a-z]* [^.,;]{0,99})(?:(?:(?<=\\b(?:of|on|to|from|see|hear) you )|(?<!you ))must (?:[a-z]+ ){0,2}(?:make|succeed on)|(?:each creature|unless) [^.,;]*?(?:makes|succeeds on)|\\b(?:forc|caus)(?:es?|ing) (?!you\\b|damage)[^.,;]*?to make) an? (dc \\d+ )?(${ABILITY_NAME}) sav(?:e|ing throw)\\b`,
);
/**
 * The first DC the prose names, and what it can be read as: your spell save DC (a
 * first group), or 8 + a named ability + proficiency in either order, 2014 "8 + your
 * X modifier + your proficiency bonus", 2024 "8 plus your X modifier and proficiency
 * bonus". Those follow "DC" with no number or clause between, so an AC or hit points
 * worked out the same way stay out, as does a die ("1d8 + your X modifier") and
 * whatever follows a fixed DC, and they end there, so "+ 2" or "or your Y modifier"
 * is not that number. Any other DC matches with no group.
 */
const DC_NAMED = new RegExp(
  `\\b(?:(?:dc [^.,)\\d]{0,50}?)?(your (?:[a-z]+ )?spell save dc)(?! (?:[-+]|plus |minus ))|dc [^.,)\\d]{0,50}?\\b8 (?:\\+|plus) your (?:proficiency bonus (?:\\+|and) your (${ABILITY_NAME}) modifier|(${ABILITY_NAME}) modifier (?:\\+|and) (?:your )?proficiency bonus)(?=[).;]|$)|dc\\b)`,
);

/**
 * The save a chip's action forces, read from the sentence of its phrase on, as its
 * dice are. Under a benefit's own name the phrase reads only that string, so a
 * neighbouring benefit's save is not this chip's. Otherwise it reads on through the
 * feature's own text, without the named options a player picks between: one season
 * of Fey Step or one Celestial Revelation is not what every use does. A save past
 * the phrase of another action is that action's: a bonus action wins over a reaction
 * in the same feature, and either wins over a plain action.
 *
 * The DC is only what the prose says, the first it names after the save, up to the
 * next save it forces. A named formula gives its ability, and "your spell save DC"
 * is the sheet's to fill in. Anything else ("the ability increased by this feat", a
 * fixed DC, none at all) leaves the DC out.
 */
function chipSave(
  entries: unknown,
  ownText: string,
  phrase: { economy: string; at: number },
): Extract<EffectInput, { kind: 'action' }>['save'] {
  let left = phrase.at;
  const string = entryStrings(entries).find((s) => (left -= s.length + 1) < 0) ?? '';
  const phraseAt = left + string.length + 1;
  const sentenceAt = string.lastIndexOf('.', phraseAt) + 1;
  const tail = string.slice(sentenceAt);
  const read = flattenEntries(entries, { skipNamed: true }).includes(tail)
    ? ownText.slice(ownText.indexOf(tail))
    : tail;
  const forced = read.match(FORCED_SAVE);
  const targetAbility = ABILITY_WORDS[forced?.[2] ?? ''];
  const at = forced?.index ?? 0;
  const past = read.slice(phraseAt - sentenceAt, at);
  if (
    targetAbility === undefined ||
    (phrase.economy === 'bonus' && REACTION_PHRASE.test(past)) ||
    (phrase.economy !== 'action' && ACTION_PHRASE.test(past)) ||
    (phrase.economy === 'action' && BONUS_GIVEN.test(past))
  ) {
    return undefined;
  }
  // A split keeps the groups, so the words after this save are its fourth piece.
  const dc = forced?.[1] ? null : read.slice(at).split(FORCED_SAVE, 4)[3]?.match(DC_NAMED);
  return {
    targetAbility,
    dcAbility: ABILITY_WORDS[dc?.[2] ?? dc?.[3] ?? ''] ?? (dc?.[1] ? 'spell' : undefined),
  };
}

/**
 * How a feature with no limit says a plain action is its own use: a clause opening on
 * it, in the wordings the data uses. Narrower than `ACTION_PHRASE`, since a chip read
 * from here exists only for the save past it: "until you use your action to end it",
 * "you can't use your action", "when you use your action", "your wolf can, as an
 * action" and "you can end it as an action" are no use of the feature.
 */
const PLAIN_USE = new RegExp(
  `(?<=^|[.,;] )(?:as (?:an|a magic) action, (?:you\\b(?!(?: can)? ${ENDS_IT})|choose|the paladin)|you can (?:use your action|take a magic action) to (?!${ENDS_IT})|you (?:can spend|gain the ability to) [^.,;]*as an action)`,
);

/**
 * The plain action a feature with no limit earns a chip by, when `chipSave` reads a
 * save for it. Only prose with no named parts: those are choices or separate benefits,
 * and one's save is not what every use does. A slot the prose names first keeps the
 * chip, and anything less than a save read leaves the feature to `chipPhrase`.
 */
function plainActionForcingSave(entries: unknown, text: string) {
  const at = text.search(PLAIN_USE);
  if (
    at === -1 ||
    text !== flattenEntries(entries, { skipNamed: true }) ||
    AS_BONUS_ACTION.test(text) ||
    REACTION_PHRASE.test(text) ||
    BONUS_GIVEN.test(text.slice(0, at)) ||
    OPPORTUNITY_ATTACK.test(text.slice(0, at)) ||
    !FORCED_SAVE.test(text.slice(at))
  ) {
    return undefined;
  }
  const phrase = { economy: 'action' as const, at };
  return chipSave(entries, text, phrase) && phrase;
}

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
  const initiative = (amount: BonusAmount): EffectInput => ({
    kind: 'initiativeBonus',
    amount,
    origin,
  });
  const half = sentence.match(HALF_PROF)?.groups;
  if (half) {
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
  if (added && (added.target !== 'the roll' || added.rolls !== undefined)) {
    return initiative(amountFrom(added, true));
  }
  const flat = sentence.match(FLAT_INITIATIVE)?.groups;
  if (flat) return initiative(Number(flat.amount));
  const equal = sentence.match(INITIATIVE_EQUAL_TO)?.groups;
  if (equal) return initiative(amountFrom(equal, false));

  const check = sentence.match(CHECK_BONUS)?.groups;
  if (check) {
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
  if (passive) {
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
  const totalLevel = totalLevelOf(col);
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
    const resetOn = SHORT_REST_RESET.test(resetText) ? 'short' : 'long';
    col.add({ kind: 'resource', key: slug(name), label: name, max: uses, resetOn, origin });
  }

  // A limit a counted spell owns still rules this out: the plain action is that casting.
  const phrase =
    (detected === undefined ? plainActionForcingSave(entries, text) : undefined) ??
    chipPhrase(text, uses !== undefined);
  // Limited-use features also get a roll chip, from the dice their action rolls.
  const dice = uses !== undefined && phrase !== undefined ? actionDice(text, phrase.at) : null;
  let roll = dice?.[1] ? dice[1].replace(/^d/, '1d').replaceAll(' ', '') : undefined;
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
    const totalLevel = totalLevelOf(col);
    const steps: Array<[number, string]> = [];
    // From the rolled die on: a step before it scales another benefit's die.
    const fromDice = text.slice(diceAt);
    for (const m of fromDice.matchAll(/(\d+d\d+(?: ?[+-] ?\d+)?) at (\d+)(?:st|nd|rd|th) level/g)) {
      if (m[1] && m[2]) steps.push([Number(m[2]), m[1]]);
    }
    // Two paren forms: 2024 "levels 5 (2d10)" and FTD "5th level (2d10)".
    for (const m of fromDice.matchAll(/(\d+)(?:st|nd|rd|th)?(?: level)? \((\d+d\d+)\)/g)) {
      if (m[1] && m[2]) steps.push([Number(m[1]), m[2]]);
    }
    steps.sort((a, b) => a[0] - b[0]);
    for (const [stepLevel, stepDice] of steps) {
      if (totalLevel >= stepLevel) roll = stepDice.replaceAll(' ', '');
    }
  }

  // Mechanics the prose states outright: damage type and area. A limited-use
  // chip reads its damage type from the rolled die onward, so one that rolls
  // nothing shows no type from another benefit's die.
  const dmgType = text
    .slice(uses === undefined ? 0 : (dice?.index ?? text.length))
    .match(new RegExp(`\\d+d\\d+(?: ?[+-] ?\\d+)? (${DAMAGE_TYPES}) damage`))?.[1];
  const area = text.match(
    /in a (\d+-foot-wide, \d+-foot-long line|\d+-foot(?:-radius)? (?:cone|line|sphere|cube|radius))/,
  )?.[1];
  const note = [dmgType, area].filter((s) => s !== undefined).join(' · ') || undefined;
  const ownText = flattenEntries(entries, { skipNamedOptions: true });

  if (phrase !== undefined) {
    col.add({
      kind: 'action',
      label: name,
      roll,
      heals,
      plainDice,
      note,
      save: chipSave(entries, ownText, phrase),
      origin,
      economy: phrase.economy,
    });
  }

  const hp = text.match(
    /hit point maximum increases by (\d+)[^.]*?(?:every time|whenever|when) you gain a level/,
  );
  if (hp?.[1]) {
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
  if (/unarmed strike/.test(ownText)) {
    const ability = `(${ABILITY_NAME})`;
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
    const withMod = text.match(new RegExp(`(\\d+) \\+ (?:your )?(${ABILITY_NAME}) modifier`));
    const flat =
      text.match(/base ac (?:of|is|equals|,) (\d+)/) ?? text.match(/ac (?:of|is) (\d+)\b/);
    const bonus = text.match(/\+\s*(\d+) bonus to (?:your )?armor class/);
    const base = withMod?.[1] ?? flat?.[1];
    if (base !== undefined) {
      const added = withMod?.[2];
      col.add({
        kind: 'acFormula',
        label: name,
        base: Number(base),
        addAbilities: added === undefined ? [] : [ABILITY_WORDS[added] as Ability],
        origin,
      });
    } else if (bonus?.[1] !== undefined) {
      col.add({ kind: 'acBonus', amount: Number(bonus[1]), origin });
    }
  }
}
