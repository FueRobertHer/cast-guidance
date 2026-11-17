/**
 * A homebrew class or subclass feature's `<modifier>` tags as the engine's
 * effects, in the feature's own `castGuidance`: `bonus` `speed +10` is a
 * walking speed bonus, `ability score` `strength +2` a score bonus, and so on.
 * An official feature's are left alone: its curated row or its text gives what
 * the tags would, and Fight Club spreads some across other features (the 2024
 * Monk's speed +5 on Empowered Strikes), which would count twice.
 *
 * Only the tags whose meaning is plain become effects. Fight Club's `+%0` (the
 * proficiency bonus) means proficiency on one feature and expertise on the next,
 * its `hp +1` once in all and once a level, so those stay as text with a reason.
 */
import { CAST_GUIDANCE_LIMITS, CAST_GUIDANCE_VERSION } from '../../engine/castGuidance';
import { childElements, textContent, type XmlElement } from '../xml';
import { abilityKey } from './text';

type Effect = Record<string, unknown>;

/** What a feature's tags give: its effects, and the tags kept as text. */
export interface FeatureModifiers {
  effects: Effect[];
  kept: string[];
}

/** An amount: a number, or the proficiency bonus (`+%0`, `+ proficiency bonus`). */
type Amount = number | 'prof';

/** `speed +10`, `initiative + proficiency bonus`: what it changes and by how much. */
function parse(raw: string): { what: string; amount: Amount } | undefined {
  const at = Math.max(raw.lastIndexOf('+'), raw.lastIndexOf('-'));
  if (at <= 0) return undefined;
  const what = raw.slice(0, at).trim().toLowerCase();
  const tail = raw
    .slice(at + 1)
    .replace(/ /g, '')
    .toLowerCase();
  if (what === '') return undefined;
  if (tail === '%0' || tail === 'proficiencybonus' || tail === 'prof') {
    return raw[at] === '+' ? { what, amount: 'prof' } : undefined;
  }
  if (tail.length === 0 || tail.length > 3) return undefined;
  for (const c of tail) if (c < '0' || c > '9') return undefined;
  const n = Number(tail);
  return { what, amount: raw[at] === '-' ? -n : n };
}

/**
 * The highest a score may go, when the feature's words raise it: "to a maximum
 * of 22", "Your maximum for those scores is now 24". A hit point maximum is
 * no score's.
 */
function statedMaximum(prose: string): number | undefined {
  for (let at = prose.indexOf('maximum'); at >= 0; at = prose.indexOf('maximum', at + 1)) {
    const before = prose.slice(Math.max(0, at - 11), at);
    if (before.endsWith('hit point ') || before.endsWith('hit points ')) continue;
    let digits = '';
    for (let i = at + 'maximum'.length; i < prose.length && i < at + 60; i++) {
      const c = prose[i] ?? '';
      if (c >= '0' && c <= '9') digits += c;
      else if (digits !== '' || c === '.') break;
    }
    const n = Number(digits);
    if (digits !== '' && n > 20 && n <= 30) return n;
  }
  return undefined;
}

/** The words before "wearing" that hold a bonus back while one wears it. */
const NOT_WEARING = ["n't ", 'n’t ', 'not ', 'unless you are ', "unless you're ", 'unless you’re '];

/**
 * Whether the words hold a bonus back while one wears what `phrase` names
 * ("while you aren't wearing heavy armor"): `no` when they never name it, `yes`
 * when each time they do it is held back, `unclear` otherwise ("your speed is
 * not reduced by wearing heavy armor").
 */
function heldBack(prose: string, phrase: string): 'yes' | 'no' | 'unclear' {
  let found = false;
  for (let at = prose.indexOf(phrase); at >= 0; at = prose.indexOf(phrase, at + 1)) {
    found = true;
    const before = prose.slice(Math.max(0, at - 16), at);
    if (!NOT_WEARING.some((w) => before.endsWith(w))) return 'unclear';
  }
  return found ? 'yes' : 'no';
}

const ABILITY_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Whether the words offer a choice of scores ("Strength or Dexterity"), whose
 * tag is Fight Club's pick of it, as on a feat.
 */
function choosesAbility(prose: string): boolean {
  for (const name of ABILITY_NAMES) {
    const word = `or ${name}`;
    for (let at = prose.indexOf(word); at >= 0; at = prose.indexOf(word, at + 1)) {
      const c = at === 0 ? ' ' : (prose[at - 1] ?? ' ');
      if (c === ' ' || c === ',') return true;
    }
  }
  return false;
}

/** What a feature's words say that its tags' meaning turns on, read once for all its tags. */
interface Words {
  heavyArmor: 'yes' | 'no' | 'unclear';
  armorOrShield: 'yes' | 'no' | 'unclear';
  /** "heavy armor or wielding a shield": a condition no field holds. */
  heavyArmorOrShield: boolean;
  wearing: boolean;
  maximum: number | undefined;
  choosesAbility: boolean;
}

function wordsOf(prose: string): Words {
  return {
    heavyArmor: heldBack(prose, 'wearing heavy armor'),
    armorOrShield: heldBack(prose, 'wearing armor or wielding a shield'),
    heavyArmorOrShield: prose.includes('heavy armor or'),
    wearing: prose.includes('wearing'),
    maximum: statedMaximum(prose),
    choosesAbility: choosesAbility(prose),
  };
}

/** A walking speed bonus, held back as its words say, or none when they say what no field holds. */
function speedBonus(amount: number, words: Words): Effect | undefined {
  if (words.heavyArmorOrShield) return undefined;
  if (words.heavyArmor === 'yes' && words.armorOrShield === 'no') {
    return { kind: 'speedBonus', amount, unless: 'heavyArmor' };
  }
  if (words.armorOrShield === 'yes' && words.heavyArmor === 'no') {
    return { kind: 'speedBonus', amount, unless: 'armorOrShield' };
  }
  // Light armor or none, or armor that does not hold it back: a condition no field holds.
  if (words.wearing) return undefined;
  return { kind: 'speedBonus', amount };
}

const ATTACKS: Record<string, Effect> = {
  'weapon attack': { attack: 'weapon' },
  'weapon attacks': { attack: 'weapon' },
  'melee attack': { attack: 'weapon', scope: 'melee' },
  'melee attacks': { attack: 'weapon', scope: 'melee' },
  'ranged attack': { attack: 'weapon', scope: 'ranged' },
  'ranged attacks': { attack: 'weapon', scope: 'ranged' },
  'spell attack': { attack: 'spell' },
  'spell attacks': { attack: 'spell' },
};

/** One tag's effect, or none when its meaning is not plain. */
function effectOf(
  category: string,
  what: string,
  amount: Amount,
  words: Words,
): Effect | undefined {
  if (category === 'ability score') {
    const ability = abilityKey(what.endsWith(' score') ? what.slice(0, -' score'.length) : what);
    if (ability === undefined || amount === 'prof' || words.choosesAbility) return undefined;
    const max = words.maximum;
    return { kind: 'abilityBonus', ability, amount, ...(max !== undefined && { max }) };
  }
  if (category !== 'bonus') return undefined;
  if (what === 'initiative') {
    return amount === 'prof'
      ? { kind: 'initiativeBonus', profBonus: true }
      : { kind: 'initiativeBonus', amount };
  }
  if (amount === 'prof') return undefined;
  if (what === 'speed') return speedBonus(amount, words);
  if (what === 'ac' || what === 'armor class') {
    // While wearing armor, or none: a condition no field holds.
    return words.wearing ? undefined : { kind: 'acBonus', amount };
  }
  if (what === 'spell dc' || what === 'spell save dc') return { kind: 'spellDcBonus', amount };
  const attack = Object.hasOwn(ATTACKS, what) ? ATTACKS[what] : undefined;
  if (attack !== undefined) return { kind: 'attackBonus', ...attack, amount };
  return undefined;
}

/** A feature's `<modifier>` tags as effects, read beside its words (`prose`). */
export function readFeatureModifiers(el: XmlElement, prose: string): FeatureModifiers {
  const effects: Effect[] = [];
  const kept: string[] = [];
  const mods = childElements(el, 'modifier');
  // Once for every tag, so a feature's cost stays its words' length plus its tags'.
  const words = mods.length === 0 ? undefined : wordsOf(prose.toLowerCase());
  for (const mod of mods) {
    // One space between words, as the item reader keeps them.
    const raw = textContent(mod).replace(/\s+/g, ' ').trim();
    if (raw === '') continue;
    const category = (mod.attrs.category ?? 'bonus').trim().toLowerCase();
    const parsed = parse(raw);
    const effect =
      parsed === undefined || words === undefined
        ? undefined
        : effectOf(category, parsed.what, parsed.amount, words);
    if (effect === undefined || effects.length >= CAST_GUIDANCE_LIMITS.effectsPerEntry) {
      kept.push(raw);
    } else effects.push(effect);
  }
  return { effects, kept };
}

/**
 * Add to an entry's `castGuidance`, keeping its effects of its own and the
 * kinds it leaves out of what it inherits (`drop`), each kind once. The
 * converter writes no other part of it.
 */
export function addGuidance(
  entity: Record<string, unknown>,
  add: { effects?: readonly Effect[]; drop?: readonly string[] },
): void {
  const had = entity.castGuidance as { effects?: Effect[]; drop?: { kind: string }[] } | undefined;
  const effects = [...(had?.effects ?? []), ...(add.effects ?? [])];
  const kinds = new Set((had?.drop ?? []).map((d) => d.kind));
  for (const k of add.drop ?? []) kinds.add(k);
  const drop = [...kinds].slice(0, CAST_GUIDANCE_LIMITS.dropsPerEntry).map((kind) => ({ kind }));
  entity.castGuidance = {
    v: CAST_GUIDANCE_VERSION,
    ...(effects.length > 0 && { effects }),
    ...(drop.length > 0 && { drop }),
  };
}

/**
 * A feature's tags into its `castGuidance`, each kind given also left out of
 * what the feature inherits, so its prose scan (a "+1 bonus to initiative" in
 * its words) does not count it twice. The tags it keeps as text, for the reason.
 */
export function applyFeatureModifiers(
  entity: Record<string, unknown>,
  el: XmlElement,
  prose: string,
): string[] {
  const read = readFeatureModifiers(el, prose);
  if (read.effects.length > 0) {
    addGuidance(entity, {
      effects: read.effects,
      drop: read.effects.map((e) => String(e.kind)),
    });
  }
  return read.kept;
}
