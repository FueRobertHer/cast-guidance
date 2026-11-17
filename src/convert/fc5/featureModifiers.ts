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
 * of 22", "Your maximum for those scores is now 24".
 */
function statedMaximum(prose: string): number | undefined {
  const at = prose.indexOf('maximum');
  if (at < 0) return undefined;
  let digits = '';
  for (let i = at + 'maximum'.length; i < prose.length && i < at + 60; i++) {
    const c = prose[i] ?? '';
    if (c >= '0' && c <= '9') digits += c;
    else if (digits !== '' || c === '.') break;
  }
  const n = Number(digits);
  return digits !== '' && n > 20 && n <= 30 ? n : undefined;
}

/** A walking speed bonus, held back as its words say, or none when they say what no field holds. */
function speedBonus(amount: number, prose: string): Effect | undefined {
  if (prose.includes('wearing heavy armor'))
    return { kind: 'speedBonus', amount, unless: 'heavyArmor' };
  if (prose.includes('wearing armor or wielding a shield')) {
    return { kind: 'speedBonus', amount, unless: 'armorOrShield' };
  }
  // Light armor or none: a condition no field holds.
  if (prose.includes('wearing')) return undefined;
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
  prose: string,
): Effect | undefined {
  if (category === 'ability score') {
    const ability = abilityKey(what.endsWith(' score') ? what.slice(0, -' score'.length) : what);
    if (ability === undefined || amount === 'prof') return undefined;
    const max = statedMaximum(prose);
    return { kind: 'abilityBonus', ability, amount, ...(max !== undefined && { max }) };
  }
  if (category !== 'bonus') return undefined;
  if (what === 'initiative') {
    return amount === 'prof'
      ? { kind: 'initiativeBonus', profBonus: true }
      : { kind: 'initiativeBonus', amount };
  }
  if (amount === 'prof') return undefined;
  if (what === 'speed') return speedBonus(amount, prose);
  if (what === 'ac' || what === 'armor class') {
    // While wearing armor, or none: a condition no field holds.
    return prose.includes('wearing') ? undefined : { kind: 'acBonus', amount };
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
  const lower = prose.toLowerCase();
  for (const mod of childElements(el, 'modifier')) {
    // One space between words, as the item reader keeps them.
    const raw = textContent(mod).replace(/\s+/g, ' ').trim();
    if (raw === '') continue;
    const category = (mod.attrs.category ?? 'bonus').trim().toLowerCase();
    const parsed = parse(raw);
    const effect =
      parsed === undefined ? undefined : effectOf(category, parsed.what, parsed.amount, lower);
    if (effect === undefined || effects.length >= CAST_GUIDANCE_LIMITS.effectsPerEntry) {
      kept.push(raw);
    } else effects.push(effect);
  }
  return { effects, kept };
}

/**
 * Add to an entry's `castGuidance`, keeping what it holds: effects of its own,
 * and the kinds it leaves out of what it inherits (`drop`), each kind once.
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
 * what the feature inherits, so its prose scan (Holy Shield's "+2 bonus to your
 * AC") does not count it twice. The tags it keeps as text, for the reason.
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
