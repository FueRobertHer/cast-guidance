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

/**
 * Recursively flatten an entries tree to plain lowercase text.
 *
 * `skipNamedOptions` drops named items nested in a list or options node. Those
 * are the alternatives a player picks between (a Shifter's Longtooth bite, a
 * Totem Warrior's animal), so a scan that wants only what the trait itself
 * always grants must not read them.
 */
export function flattenEntries(
  entries: unknown,
  opts: { skipNamedOptions?: boolean } = {},
): string {
  const parts: string[] = [];
  const walk = (v: unknown, inChoiceList: boolean): void => {
    if (typeof v === 'string') {
      parts.push(v);
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
    // Two paren forms: 2024 "levels 5 (2d10)" and FTD "5th level (2d10)".
    for (const m of text.matchAll(/(\d+)(?:st|nd|rd|th)?(?: level)? \((\d+d\d+)\)/g)) {
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
    // 2024 phrasings: "replace one of your attacks" (Attack-action riders) and
    // "as a Magic action" (the action to use a magical trait, e.g. Healing Hands).
    /as an action|use your action|replace one of your attacks|as a magic action/.test(text)
  ) {
    col.add({ kind: 'action', economy: 'action', label: name, roll, note, save, origin });
  }

  const hp = text.match(
    /hit point maximum increases by (\d+)[^.]*?(?:every time|whenever|when) you gain a level/,
  );
  if (hp?.[1] !== undefined) {
    col.add({ kind: 'hpPerLevel', amount: Number(hp[1]), origin });
  }

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
