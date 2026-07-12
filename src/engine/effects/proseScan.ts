/**
 * Generic prose scanner — broad automation for the long tail of traits and
 * features whose mechanics exist only in text. Detects limited-use wording
 * ("once per long rest", "a number of times equal to your proficiency bonus"),
 * action economy ("as a bonus action"), and per-level HP riders, then emits
 * the matching effects. The curated table stays the precision override: call
 * this only when no curated entry handled the feature.
 */
import type { Ability, EffectOrigin } from '../types';
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

/** Recursively flatten an entries tree to plain lowercase text. */
export function flattenEntries(entries: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      parts.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>;
      walk(o.entries);
      walk(o.entry);
      walk(o.items);
    }
  };
  walk(entries);
  // {@dice 1d12}, {@spell bless|phb} … → keep the display text
  return parts
    .join(' ')
    .replaceAll(/\{@\w+ ([^}|]*)(?:\|[^}]*)?\}/g, '$1')
    .replaceAll('’', "'")
    .toLowerCase();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');

/**
 * Limited-use wording → how many uses between rests. When several counts are
 * mentioned, the SMALLEST wins: higher counts are level-scaling text
 * ("at 18th level, three times") that doesn't apply at the base level.
 */
function detectUses(text: string): number | 'profBonus' | undefined {
  if (/number of times equal to your proficiency bonus/.test(text)) return 'profBonus';
  const counts: number[] = [];
  if (
    /once per (?:short|long) rest/.test(text) ||
    /you can'?t (?:use (?:it|this (?:trait|feature))|do so) again until you (?:finish|complete)/.test(
      text,
    ) ||
    /must (?:then )?(?:finish|complete) a (?:short or long|short|long) rest (?:before you can use|to use)/.test(
      text,
    )
  ) {
    counts.push(1);
  }
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) twice/.test(text)) counts.push(2);
  if (/use (?:this (?:trait|feature)|it|your [\w\s]{1,30}?) three times/.test(text)) {
    counts.push(3);
  }
  return counts.length > 0 ? Math.min(...counts) : undefined;
}

/**
 * Scan one named trait/feature and emit resource / action / HP effects.
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

  const uses = detectUses(text);
  if (uses !== undefined) {
    const resetOn =
      /short or long rest/.test(text) || /finish a short rest/.test(text) ? 'short' : 'long';
    col.add({ kind: 'resource', key: slug(name), label: name, max: uses, resetOn, origin });
  }

  // Compact, high-signal chips only: bonus/reaction always; plain actions
  // only when limited-use (otherwise every prose "as an action" is noise).
  // Limited-use features also get their first dice expression as a roll chip.
  const dice = uses !== undefined ? text.match(/\b(\d{0,2}d\d{1,3}(?: ?[+-] ?\d+)?)\b/) : null;
  let roll = dice?.[1] !== undefined ? dice[1].replace(/^d/, '1d').replaceAll(' ', '') : undefined;

  // Level-scaled dice — use the biggest step the character's total level has
  // reached. Two phrasings: 2014 "3d6 at 6th level" and 2024 "levels 5 (2d10),
  // 11 (3d10)". Both give absolute dice for a level threshold.
  if (roll !== undefined) {
    const totalLevel = col.doc.classes.reduce((s, c) => s + c.levels, 0);
    const steps: Array<[number, string]> = [];
    for (const m of text.matchAll(/(\d+d\d+(?: ?[+-] ?\d+)?) at (\d+)(?:st|nd|rd|th) level/g)) {
      if (m[1] !== undefined && m[2] !== undefined) steps.push([Number(m[2]), m[1]]);
    }
    for (const m of text.matchAll(/(\d+)(?:st|nd|rd|th)? \((\d+d\d+)\)/g)) {
      if (m[1] !== undefined && m[2] !== undefined) steps.push([Number(m[1]), m[2]]);
    }
    steps.sort((a, b) => a[0] - b[0]);
    for (const [stepLevel, stepDice] of steps) {
      if (totalLevel >= stepLevel) roll = stepDice.replaceAll(' ', '');
    }
  }

  // Mechanics the prose states outright: damage type, area, and save.
  const dmgType = text.match(
    new RegExp(`\\d+d\\d+(?: ?[+-] ?\\d+)? (${DAMAGE_TYPES}) damage`),
  )?.[1];
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

  if (/as a bonus action/.test(text)) {
    col.add({ kind: 'action', economy: 'bonus', label: name, roll, note, save, origin });
  } else if (/as a reaction|use your reaction/.test(text)) {
    col.add({ kind: 'action', economy: 'reaction', label: name, roll, note, save, origin });
  } else if (
    uses !== undefined &&
    // "replace one of your attacks" is the 2024 phrasing for Attack-action riders.
    /as an action|use your action|replace one of your attacks/.test(text)
  ) {
    col.add({ kind: 'action', economy: 'action', label: name, roll, note, save, origin });
  }

  const hp = text.match(
    /hit point maximum increases by (\d+)[^.]*?(?:every time|whenever|when) you gain a level/,
  );
  if (hp?.[1] !== undefined) {
    col.add({ kind: 'hpPerLevel', amount: Number(hp[1]), origin });
  }
}
