/**
 * Curated mechanics for high-frequency features whose numbers exist only in
 * prose (verified against the dataset: e.g. Alert's +5 initiative has no
 * structured field). Keys:
 *   - feats / optional features: `name|source` (entity uid, lowercased)
 *   - class/subclass features:   `featureName|classLabel` (lowercased)
 * These are facts of the game rules — fine to commit.
 */
import { countedSpells, parseSpellRef } from '../effects/additionalSpells';
import { asEntityArray, type Collector } from '../effects/base';
import { basedOn } from '../effects/mechanics';
import {
  LANGUAGE_OPTIONS,
  markKnownLanguages,
  skillOptions,
  toolOptions,
  weaponOptions,
} from '../effects/readers';
import { reskinOf } from '../effects/reskin';
import {
  ABILITIES,
  type Ability,
  type ChoiceOption,
  type DataEntity,
  type EffectOrigin,
  refUid,
  SKILLS,
} from '../types';

/**
 * `from` is the printing of the feature itself, lowercase, where it can differ from
 * the card's: a class or subclass feature (see `printedIn`).
 */
type CuratedFn = (col: Collector, origin: EffectOrigin, from?: string) => void;

const proficient = (col: Collector, skill: string, origin: EffectOrigin) =>
  col.add({ kind: 'skillProf', skill, level: 1, origin });

/**
 * A skill a feature both grants and doubles. The proficiency is its own effect,
 * since that is what tells another pick the skill is already taken.
 */
function skillAtExpertise(col: Collector, skill: string, origin: EffectOrigin): void {
  proficient(col, skill, origin);
  col.add({ kind: 'skillProf', skill, level: 2, origin });
}

/**
 * A feature's pick among skills (every skill when `from` is empty), under its
 * class or subclass, so removing the class or swapping the subclass clears it.
 */
function featureSkillPick(
  col: Collector,
  origin: EffectOrigin,
  count: number,
  from: readonly string[],
  grant = (skill: string) => proficient(col, skill, origin),
  label = count > 1 ? 'Skill proficiencies' : 'Skill proficiency',
  extra: ChoiceOption[] = [],
): void {
  col.choice(
    {
      id: `${origin.type}:${origin.uid}:skill:${origin.label.toLowerCase()}`,
      origin,
      kind: 'skill',
      label,
      count,
      options: [...skillOptions(from), ...extra],
    },
    (selected) => selected.forEach(grant),
  );
}

/**
 * Armor, weapons and tools a feature grants in prose, named as the class lists
 * name them ("heavy", "martial"), so the sheet's list shows each once and an
 * attack finds its category. `filter` is a weapon grant no category or name can
 * say: the words the sheet shows, and the filter attacks match.
 */
interface Kit {
  armor?: string[];
  weapons?: string[];
  tools?: string[];
  filter?: [shown: string, filter: string];
}

function grantKit(col: Collector, origin: EffectOrigin, kit: Kit): void {
  for (const name of kit.armor ?? []) col.add({ kind: 'armorProf', name, origin });
  for (const name of kit.weapons ?? []) col.add({ kind: 'weaponProf', name, origin });
  for (const name of kit.tools ?? []) col.add({ kind: 'toolProf', name, origin });
  if (kit.filter !== undefined) {
    col.add({ kind: 'weaponProf', name: kit.filter[0], origin });
    col.add({ kind: 'weaponProfFilter', filter: kit.filter[1], origin });
  }
}

/** Each of a feature's parts, in order. */
const all =
  (...parts: CuratedFn[]): CuratedFn =>
  (col, origin) => {
    for (const fn of parts) fn(col, origin);
  };

/** A kit, then whatever else the feature does. */
const kit = (grants: Kit, ...rest: CuratedFn[]): CuratedFn =>
  all((col, origin) => grantKit(col, origin, grants), ...rest);

/** Unarmored AC: `base` plus the abilities' modifiers, labelled with the feature. */
const unarmored =
  (base: number, ...abilities: Ability[]): CuratedFn =>
  (col, origin) =>
    col.add({ kind: 'acFormula', label: origin.label, base, addAbilities: abilities, origin });

const heldTools = (col: Collector) =>
  new Set(col.effects.flatMap((e) => (e.kind === 'toolProf' ? [e.name.toLowerCase()] : [])));

/**
 * A pick of tools, among `from` (category words such as "artisan's tools" expand).
 * A tool collected so far is offered disabled, since the pick is for one the
 * character lacks.
 */
function featureToolPick(
  col: Collector,
  origin: EffectOrigin,
  count: number,
  from: readonly string[],
  label = count > 1 ? 'Tool proficiencies' : 'Tool proficiency',
): void {
  const held = heldTools(col);
  const options = toolOptions(from).map((o) =>
    held.has(o.id.toLowerCase())
      ? { ...o, disabled: { reason: `You already have ${o.label}` } }
      : o,
  );
  col.choice(
    {
      id: `${origin.type}:${origin.uid}:tool:${origin.label.toLowerCase()}`,
      origin,
      kind: 'tool',
      label,
      count,
      options,
    },
    (selected) => {
      for (const id of selected) {
        const name = options.find((o) => o.id === id)?.label ?? id;
        col.add({ kind: 'toolProf', name, origin });
      }
    },
  );
}

const toolPick =
  (count: number, from: readonly string[]): CuratedFn =>
  (col, origin) =>
    featureToolPick(col, origin, count, from);

/**
 * The artificer subclasses' tools: each one the character already has turns into
 * a pick of another artisan's tool. Like Royal Envoy, only what is collected so far
 * counts (species, background, an earlier class, and a feat from any of this
 * class's ability score improvements, which are all collected before the
 * subclass); the artificer's own "one type of artisan's tools of your choice" is
 * words in the class data, not a pick, so it never does.
 */
const toolsOrAnother =
  (...tools: string[]): CuratedFn =>
  (col, origin) => {
    const held = heldTools(col);
    const known = tools.filter((t) => held.has(t.toLowerCase()));
    for (const name of tools) {
      if (!known.includes(name)) col.add({ kind: 'toolProf', name, origin });
    }
    if (known.length > 0) {
      featureToolPick(
        col,
        origin,
        known.length,
        ["artisan's tools"],
        `Tool in place of ${known.join(' and ')}`,
      );
    }
  };

/** Bladesinging (TCE): one kind of one-handed melee weapon, from the base items. */
const oneHandedMeleePick: CuratedFn = (col, origin) => {
  const twoHanded = new Set(
    col.ctx
      .byType('baseitem')
      .filter((e) =>
        (Array.isArray(e.property) ? e.property : []).some(
          (p) => String(typeof p === 'string' ? p : (p as DataEntity).uid).split('|')[0] === '2H',
        ),
      )
      .map((e) => String(e.name).toLowerCase()),
  );
  col.choice(
    {
      id: `${origin.type}:${origin.uid}:weapon:${origin.label.toLowerCase()}`,
      origin,
      kind: 'generic',
      label: 'Weapon proficiency',
      count: 1,
      options: weaponOptions(col.ctx)(undefined, 'type=melee weapon').filter(
        (o) => !twoHanded.has(o.id.toLowerCase()),
      ),
    },
    (selected) => {
      for (const name of selected) col.add({ kind: 'weaponProf', name, origin });
    },
  );
};

/** Fixed grants of plain proficiency. Having a skill already asks for nothing in its place. */
const skills =
  (...names: string[]): CuratedFn =>
  (col, origin) => {
    for (const skill of names) proficient(col, skill, origin);
  };

/** A pick of `count` plain proficiencies, among `from` or every skill. */
const skillPick =
  (count: number, from: readonly string[] = []): CuratedFn =>
  (col, origin) =>
    featureSkillPick(col, origin, count, from);

/**
 * The character's class of this name, or else the class reskinning or copying
 * it (a Warrior for "Fighter", a Workshop copy of the Fighter), whose features
 * are that class's and read its level as theirs.
 */
function classEntry(col: Collector, className: string) {
  const name = className.toLowerCase();
  return (
    col.doc.classes.find((c) => c.ref.name.toLowerCase() === name) ??
    col.doc.classes.find((c) => {
      // Both count, not the first found: a copy of the Demon Hunter is a Demon
      // Hunter, for the rows written under that name, and the Ranger it reskins.
      const cls = col.ctx.get('class', c.ref.name, c.ref.source);
      return [reskinOf(cls), basedOn(cls)].some((r) => r?.name.toLowerCase() === name);
    })
  );
}

function classLevel(col: Collector, className: string): number {
  return classEntry(col, className)?.levels ?? 0;
}

/** "The skills available to Fighters at level 1": that class's own list, in the printing taken. */
function classSkillList(col: Collector, className: string): string[] {
  const entry = classEntry(col, className);
  const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
  const lists = (cls?.startingProficiencies as DataEntity | undefined)?.skills;
  return asEntityArray(lists).flatMap((s) => {
    const from = (s.choose as DataEntity | undefined)?.from;
    return Array.isArray(from) ? from.map(String) : [];
  });
}

/**
 * Whether a class or subclass feature comes from the printing in `source`. Its
 * origin uid is the class's or subclass's (`bard|xphb`, `champion|phb`), and a
 * 2014 subclass kept under a 2024 class still carries its own 2014 source. `from`
 * is the feature's own printing, which says it for a book that lends another's
 * features: a reskinned class (`warrior|wow`) or a subclass copied from a 2024 one
 * (`champion|wow`) holds the 2024 features as printed.
 */
function printedIn(origin: EffectOrigin, source: string, from?: string): boolean {
  return origin.uid.endsWith(`|${source}`) || from === source;
}

/**
 * A spell a class feature lets you cast without a slot, `max` times a long rest,
 * beside the copy the class always has prepared. Its pool keeps the key and label
 * the prose scan gave it, so uses already marked carry over. A class whose own data
 * counts those casts (a Death Knight's Rune Strike) has them from there instead.
 */
const freeCast =
  (spellRef: string, key: string, label: string, max: (col: Collector) => number): CuratedFn =>
  (col, origin) => {
    const entry = col.doc.classes.find((c) => refUid(c.ref) === origin.uid);
    const cls = entry && col.ctx.get('class', entry.ref.name, entry.ref.source);
    const spell = parseSpellRef(spellRef);
    if (countedSpells(cls?.additionalSpells).has(spell.name)) return;
    const ability = String(cls?.spellcastingAbility);
    col.add({ kind: 'resource', key, label, max: max(col), resetOn: 'long', origin });
    col.add({
      kind: 'grantSpell',
      spell,
      ...((ABILITIES as readonly string[]).includes(ability)
        ? { ability: ability as Ability }
        : {}),
      usage: `${max(col)}/day`,
      resourceKey: key,
      origin,
    });
  };

/** 2024 Favored Enemy: free Hunter's Mark casts by Ranger level (2, then 3 to 6 at 5, 9, 13 and 17). */
const favoredEnemyCasts = (col: Collector): number => {
  const level = classLevel(col, 'Ranger');
  return level >= 17 ? 6 : level >= 13 ? 5 : level >= 9 ? 4 : level >= 5 ? 3 : 2;
};

/**
 * The 2014 and FRHoF printings share this pick. FRHoF adds a kind of artisan's
 * tools; the 2014 printing's two languages stay in the card's prose.
 */
const blessingsOfKnowledge: CuratedFn = (col, origin, from) => {
  if (printedIn(origin, 'frhof', from)) featureToolPick(col, origin, 1, ["artisan's tools"]);
  featureSkillPick(
    col,
    origin,
    2,
    ['Arcana', 'History', 'Nature', 'Religion'],
    (skill) => skillAtExpertise(col, skill, origin),
    'Skills with expertise',
  );
};

/** Cavalier and Samurai: one of the listed skills, or a language instead, in one pick. */
const skillOrLanguage =
  (from: readonly string[]): CuratedFn =>
  (col, origin) =>
    featureSkillPick(
      col,
      origin,
      1,
      from,
      (pick) =>
        SKILLS.some((s) => s.name === pick)
          ? proficient(col, pick, origin)
          : col.add({ kind: 'language', name: pick, origin }),
      'Skill or language',
      markKnownLanguages(col, LANGUAGE_OPTIONS),
    );

/** Superior Technique fighting style: one d6 superiority die (stacks) + a maneuver. */
const superiorTechnique: CuratedFn = (col, origin) => {
  col.add({
    kind: 'resource',
    key: 'superiority-dice',
    label: 'Superiority Dice (d6)',
    max: 1,
    resetOn: 'short',
    stack: true,
    origin,
  });
  col.add({
    kind: 'note',
    text: 'Superior Technique: learn one maneuver and gain one d6 superiority die.',
    origin,
  });
};

/** 2024: one back on a short rest, all on a long rest. 2014: all back on either. */
function recovery(is2024: boolean) {
  return is2024
    ? ({ resetOn: 'long', regainOnShort: 1 } as const)
    : ({ resetOn: 'short' } as const);
}

/**
 * Psionic Energy Dice, a pool per subclass: "use only the dice from this subclass".
 * 2024 prints a table and regains one on a short rest. 2014 regains one with a bonus
 * action, once per short or long rest. A 2014 character with both subclasses gets one
 * shared chip, which refills the first pool: the other is a pip tap.
 */
function psionicEnergyDice(
  col: Collector,
  origin: EffectOrigin,
  key: string,
  cls: string,
  from?: string,
): void {
  const level = classLevel(col, cls);
  const die = level >= 17 ? 12 : level >= 11 ? 10 : level >= 5 ? 8 : 6;
  const printed2024 = printedIn(origin, 'xphb', from);
  const count2024 = level >= 17 ? 12 : level >= 13 ? 10 : level >= 9 ? 8 : level >= 5 ? 6 : 4;
  col.add({
    kind: 'resource',
    key,
    label: `Psionic Energy Dice (d${die})`,
    max: printed2024 ? count2024 : 'twiceProfBonus',
    resetOn: 'long',
    ...(printed2024 ? { regainOnShort: 1 } : {}),
    origin,
  });
  if (printed2024) return;
  col.add({
    kind: 'resource',
    key: 'psionic-power',
    label: 'Psionic Power',
    max: 1,
    resetOn: 'short',
    origin,
  });
  col.add({
    kind: 'action',
    economy: 'bonus',
    label: 'Psionic Power',
    regains: { resource: key, amount: 1 },
    origin,
  });
}

/** Both printings' Monk table: +10 feet at 2, then 5 more at 6, 10, 14 and 18. */
function unarmoredMovement(level: number): number {
  if (level >= 18) return 30;
  if (level >= 14) return 25;
  if (level >= 10) return 20;
  if (level >= 6) return 15;
  return 10;
}

/** Proficiency in these saving throws (Diamond Soul). */
const saveProfs =
  (...abilities: Ability[]): CuratedFn =>
  (col, origin) => {
    for (const ability of abilities) col.add({ kind: 'saveProf', ability, origin });
  };

/** Two scores up by 4, to a new maximum (Primal Champion, Body and Mind). */
const capstone =
  (abilities: readonly Ability[], max: (printed2024: boolean) => number): CuratedFn =>
  (col, origin, from) => {
    const cap = max(printedIn(origin, 'xphb', from));
    for (const ability of abilities) {
      col.add({ kind: 'abilityBonus', ability, amount: 4, max: cap, origin });
    }
  };

/** 2014's table says Unlimited at 20. 2024's stays at 6. */
function rageUses(level: number, printed2024: boolean): number {
  if (level >= 20 && !printed2024) return 99;
  if (level >= 17) return 6;
  if (level >= 12) return 5;
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}

export const CURATED: Record<string, CuratedFn> = {
  // --- Feats ---------------------------------------------------------------
  'alert|phb': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 5, origin });
  },
  'alert|xphb': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'profBonus', origin });
  },
  // The +5 reaches passive Investigation too, which the sheet does not show.
  'observant|phb': (col, origin) => {
    col.add({ kind: 'passivePerceptionBonus', amount: 5, origin });
  },
  'tough|phb': (col, origin) => {
    col.add({ kind: 'hpPerLevel', amount: 2, origin });
  },
  'tough|xphb': (col, origin) => {
    col.add({ kind: 'hpPerLevel', amount: 2, origin });
  },
  'mobile|phb': (col, origin) => {
    col.add({ kind: 'speedBonus', amount: 10, origin });
  },
  'speedy|xphb': (col, origin) => {
    col.add({ kind: 'speedBonus', amount: 10, origin });
  },
  'lucky|phb': (col, origin) => {
    col.add({ kind: 'resource', key: 'luck', label: 'Luck', max: 3, resetOn: 'long', origin });
  },
  'lucky|xphb': (col, origin) => {
    // 2024: luck points equal to your proficiency bonus.
    col.add({
      kind: 'resource',
      key: 'luck',
      label: 'Luck Points',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
  },
  'polearm master|phb': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Polearm strike (butt end)',
      roll: '1d4',
      origin,
    });
  },
  'polearm master|xphb': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Polearm strike (butt end)',
      roll: '1d4',
      origin,
    });
  },
  'martial adept|phb': (col, origin) => {
    // Shares the 'superiority-dice' pool so it stacks with Battle Master and
    // Superior Technique instead of showing a separate tracker.
    col.add({
      kind: 'resource',
      key: 'superiority-dice',
      label: 'Superiority Dice (d6)',
      max: 1,
      resetOn: 'short',
      stack: true,
      origin,
    });
    col.add({
      kind: 'note',
      text: 'Martial Adept: one superiority die (d6); learn two maneuvers.',
      origin,
    });
  },
  // Battle Master's superiority dice: 4/5/6 by fighter level, growing d8→d10→d12.
  'combat superiority|battle master': (col, origin) => {
    const lvl = classLevel(col, 'Fighter');
    const count = lvl >= 15 ? 6 : lvl >= 7 ? 5 : 4;
    const die = lvl >= 18 ? 'd12' : lvl >= 10 ? 'd10' : 'd8';
    col.add({
      kind: 'resource',
      key: 'superiority-dice',
      label: `Superiority Dice (${die})`,
      max: count,
      resetOn: 'short',
      stack: true,
      origin,
    });
  },
  // Superior Technique fighting style (TCE): one d6 superiority die + a maneuver.
  'superior technique|tce': superiorTechnique,
  // A maneuver that forces a save the scanner did not read. The maneuver DC lives in
  // Combat Superiority, so the chip names the save alone. Its die is in `SPEND_LINKS`.
  'heroic leap|wow': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Heroic Leap',
      note: 'bludgeoning, the die rolled · creatures within 5 feet of where you land',
      save: { targetAbility: 'str' },
      origin,
    });
  },
  'healer|phb': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'action',
      label: 'Healer (kit)',
      roll: '1d6+4',
      heals: true,
      origin,
    });
  },
  'healer|xphb': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Healer (kit)',
      roll: '1d6+4',
      heals: true,
      origin,
    });
  },
  'crossbow expert|phb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Crossbow Expert bonus attack', origin });
  },
  'crossbow expert|xphb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Crossbow Expert bonus attack', origin });
  },
  'shield master|phb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Shield Master shove', origin });
  },
  'shield master|xphb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Shield Master shove', origin });
  },
  'telekinetic|tce': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Telekinetic shove (5 ft)', origin });
  },
  'telekinetic|xphb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Telekinetic shove (5 ft)', origin });
  },
  'inspiring leader|phb': (col, origin) => {
    col.add({ kind: 'action', economy: 'action', label: 'Inspiring Leader (temp HP)', origin });
  },
  'inspiring leader|xphb': (col, origin) => {
    col.add({ kind: 'action', economy: 'action', label: 'Inspiring Leader (temp HP)', origin });
  },
  'chef|tce': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'chef-treats',
      label: 'Chef Treats',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
  },
  'chef|xphb': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'chef-treats',
      label: 'Chef Treats',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
  },
  'great weapon master|phb': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'GWM bonus attack (on crit or kill)',
      origin,
    });
  },
  'charger|phb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Charge attack (+5 dmg)', origin });
  },

  // --- Fighting styles (2014 optional features; 2024 feats share names) ----
  'defense|phb': (col, origin) => {
    col.add({ kind: 'acBonus', amount: 1, origin });
    col.add({ kind: 'note', text: '+1 AC applies only while wearing armor.', origin });
  },
  'defense|xphb': (col, origin) => {
    col.add({ kind: 'acBonus', amount: 1, origin });
    col.add({ kind: 'note', text: '+1 AC applies only while wearing armor.', origin });
  },
  'archery|phb': (col, origin) => {
    col.add({ kind: 'attackBonus', scope: 'ranged', amount: 2, origin });
  },
  'archery|xphb': (col, origin) => {
    col.add({ kind: 'attackBonus', scope: 'ranged', amount: 2, origin });
  },
  'dueling|phb': (col, origin) => {
    col.add({ kind: 'damageBonus', scope: 'melee', amount: 2, origin });
    col.add({
      kind: 'note',
      text: '+2 damage applies while wielding a single one-handed weapon.',
      origin,
    });
  },
  'dueling|xphb': (col, origin) => {
    col.add({ kind: 'damageBonus', scope: 'melee', amount: 2, origin });
  },

  // --- Class features ------------------------------------------------------
  'unarmored defense|barbarian': (col, origin) => {
    col.add({
      kind: 'acFormula',
      label: 'Unarmored Defense',
      base: 10,
      addAbilities: ['dex', 'con'],
      origin,
    });
  },
  'unarmored defense|monk': (col, origin) => {
    col.add({
      kind: 'acFormula',
      label: 'Unarmored Defense',
      base: 10,
      addAbilities: ['dex', 'wis'],
      origin,
    });
  },
  // --- Standing numbers: speeds, saves, scores and defenses ----------------
  'fast movement|barbarian': (col, origin) => {
    col.add({ kind: 'speedBonus', amount: 10, unless: 'heavyArmor', origin });
  },
  'unarmored movement|monk': (col, origin) => {
    const amount = unarmoredMovement(classLevel(col, 'Monk'));
    col.add({ kind: 'speedBonus', amount, unless: 'armorOrShield', origin });
  },
  // The 2024 feature. Tasha's Roving is a part of Deft Explorer Improvement, not read yet.
  'roving|ranger': (col, origin, from) => {
    if (!printedIn(origin, 'xphb', from)) return;
    col.add({ kind: 'speedBonus', amount: 10, unless: 'heavyArmor', origin });
    col.add({ kind: 'moveSpeed', mode: 'climb', speed: 'walk', origin });
    col.add({ kind: 'moveSpeed', mode: 'swim', speed: 'walk', origin });
  },
  // An ally's aura is an effect in play; this is the paladin's own.
  'aura of protection|paladin': (col, origin) => {
    col.add({ kind: 'saveBonus', amount: 'abilityModMin1:cha', origin });
  },
  'aura of courage|paladin': (col, origin, from) => {
    const note = printedIn(origin, 'xphb', from) ? 'not while incapacitated' : 'while conscious';
    col.add({ kind: 'conditionImmune', condition: 'frightened', note, origin });
  },
  'divine health|paladin': (col, origin) => {
    col.add({ kind: 'conditionImmune', condition: 'disease', origin });
  },
  'purity of body|monk': (col, origin) => {
    col.add({ kind: 'immune', damageType: 'poison', origin });
    col.add({ kind: 'conditionImmune', condition: 'poisoned', origin });
    col.add({ kind: 'conditionImmune', condition: 'disease', origin });
  },
  'slippery mind|rogue': (col, origin, from) => {
    col.add({ kind: 'saveProf', ability: 'wis', origin });
    if (printedIn(origin, 'xphb', from)) col.add({ kind: 'saveProf', ability: 'cha', origin });
  },
  'diamond soul|monk': saveProfs(...ABILITIES),
  'disciplined survivor|monk': saveProfs(...ABILITIES),
  'primal champion|barbarian': capstone(['str', 'con'], (printed2024) => (printed2024 ? 25 : 24)),
  'body and mind|monk': capstone(['dex', 'wis'], () => 25),
  // 2014's Feral Senses is about attacking what you can't see: no number to show.
  'feral senses|ranger': (col, origin, from) => {
    if (printedIn(origin, 'xphb', from)) {
      col.add({ kind: 'sense', sense: 'blindsight', range: 30, origin });
    }
  },
  'rage|barbarian': (col, origin, from) => {
    const printed2024 = printedIn(origin, 'xphb', from);
    col.add({
      kind: 'resource',
      key: 'rage',
      label: 'Rage',
      max: rageUses(classLevel(col, 'Barbarian'), printed2024),
      resetOn: 'long',
      ...(printed2024 ? { regainOnShort: 1 } : {}),
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Rage', origin });
  },
  'second wind|fighter': (col, origin) => {
    // 2024 scales uses (2 → 3 @4 → 4 @10); 2014 is once per rest.
    const lvl = classLevel(col, 'Fighter');
    const uses2024 = lvl >= 10 ? 4 : lvl >= 4 ? 3 : 2;
    const is2024 = col.doc.rulesVersion === '2024';
    col.add({
      kind: 'resource',
      key: 'second-wind',
      label: 'Second Wind',
      max: is2024 ? uses2024 : 1,
      ...recovery(is2024),
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Second Wind',
      roll: `1d10+${classLevel(col, 'Fighter')}`,
      heals: true,
      origin,
    });
  },
  'action surge|fighter': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'action-surge',
      label: 'Action Surge',
      max: classLevel(col, 'Fighter') >= 17 ? 2 : 1,
      resetOn: 'short',
      origin,
    });
  },
  'ki|monk': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'ki',
      label: 'Ki',
      max: classLevel(col, 'Monk'),
      resetOn: 'short',
      origin,
    });
  },
  "monk's focus|monk": (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'focus',
      label: 'Focus',
      max: classLevel(col, 'Monk'),
      resetOn: 'short',
      origin,
    });
  },
  // Stunning Strike states its effect but leaves the DC to the "ki save DC"
  // defined in the Ki/Monk's Focus feature — the prose scanner can't resolve a
  // cross-feature DC, so pin it here: Con save vs 8 + prof + Wis mod. It rides on
  // a hit, so it takes no slot of its own. Its cost is in `SPEND_LINKS`.
  'stunning strike|monk': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'none',
      label: 'Stunning Strike',
      note: 'stunned until your next turn on a failed save',
      save: { targetAbility: 'con', dcAbility: 'wis' },
      origin,
    });
  },
  // 2024 says "you can use Wild Shape twice" in a table the scanner cannot see, so
  // it gave that printing no pool and nothing could spend one.
  'wild shape|druid': (col, origin, from) => {
    const printed2024 = printedIn(origin, 'xphb', from);
    const lvl = classLevel(col, 'Druid');
    col.add({
      kind: 'resource',
      key: 'wild-shape',
      label: 'Wild Shape',
      max: printed2024 ? (lvl >= 17 ? 4 : lvl >= 6 ? 3 : 2) : 2,
      ...recovery(printed2024),
      origin,
    });
    col.add({
      kind: 'action',
      economy: printed2024 ? 'bonus' : 'action',
      label: 'Wild Shape',
      origin,
    });
  },
  'psionic power|psi warrior': (col, origin, from) =>
    psionicEnergyDice(col, origin, 'psi-warrior-dice', 'Fighter', from),
  'psionic power|soulknife': (col, origin, from) =>
    psionicEnergyDice(col, origin, 'soulknife-dice', 'Rogue', from),
  'channel divinity|cleric': (col, origin) => {
    // Scales with cleric level; the prose scanner can't see level gates.
    const lvl = classLevel(col, 'Cleric');
    const is2024 = col.doc.rulesVersion === '2024';
    const uses = is2024 ? (lvl >= 6 ? 3 : 2) : lvl >= 18 ? 3 : lvl >= 6 ? 2 : 1;
    col.add({
      kind: 'resource',
      key: 'channel-divinity',
      label: 'Channel Divinity',
      max: uses,
      ...recovery(is2024),
      origin,
    });
  },
  // 2014 is a flat 4 points on every short rest. 2024 is a choice of up to half the
  // level, once per long rest, so its row counts that one use and the player taps
  // the points back.
  'sorcerous restoration|sorcerer': (col, origin, from) => {
    if (printedIn(origin, 'xphb', from)) {
      col.add({
        kind: 'resource',
        key: 'sorcerous-restoration',
        label: 'Sorcerous Restoration',
        max: 1,
        resetOn: 'long',
        origin,
      });
    } else {
      col.add({ kind: 'resourceRegain', key: 'sorcery-points', amount: 4, origin });
    }
  },
  'advanced artifice|artificer': (col, origin) => {
    col.add({ kind: 'resourceRegain', key: 'flash-of-genius', amount: 1, origin });
  },
  'dread incarnate|scion of the three': (col, origin) => {
    col.add({ kind: 'resourceRegain', key: 'bloodthirst', amount: 1, origin });
  },
  'font of magic|sorcerer': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'sorcery-points',
      label: 'Sorcery Points',
      max: classLevel(col, 'Sorcerer'),
      resetOn: 'long',
      // Adds to Metamagic Adept's two, whichever comes first.
      stack: true,
      origin,
    });
  },
  'metamagic adept|tce': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'sorcery-points',
      label: 'Sorcery Points',
      max: 2,
      resetOn: 'long',
      stack: true,
      // They add to the pool but go only on Metamagic.
      noSlotConversion: 2,
      origin,
    });
  },
  'bardic inspiration|bard': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'bardic-inspiration',
      label: 'Bardic Inspiration',
      max: 'abilityMod:cha', // resolved against final CHA in the resources calc
      resetOn: classLevel(col, 'Bard') >= 5 ? 'short' : 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Bardic Inspiration', origin });
  },
  "paladin's smite|paladin": freeCast(
    'divine smite|xphb',
    'paladin-s-smite',
    "Paladin's Smite",
    () => 1,
  ),
  'faithful steed|paladin': freeCast(
    'find steed|xphb',
    'faithful-steed',
    'Faithful Steed',
    () => 1,
  ),
  'runic smite|death knight': freeCast('rune strike|wow', 'runic-smite', 'Runic Smite', () => 1),
  'contact patron|warlock': freeCast(
    'contact other plane|xphb',
    'contact-patron',
    'Contact Patron',
    () => 1,
  ),
  // The 2014 printing gives no casts, and its prose scan finds nothing either.
  'favored enemy|ranger': (col, origin, from) => {
    if (!printedIn(origin, 'xphb', from)) return;
    freeCast(
      "hunter's mark|xphb",
      'favored-enemy',
      'Favored Enemy',
      favoredEnemyCasts,
    )(col, origin);
  },
  // Lay on Hands is a POOL of hit points (5 x paladin level), not a use count,
  // so the prose scanner's "times per rest" patterns can never see it.
  'lay on hands|paladin': (col, origin) => {
    const is2024 = col.doc.rulesVersion === '2024';
    col.add({
      kind: 'resource',
      key: 'lay-on-hands',
      label: 'Lay on Hands (HP pool)',
      max: classLevel(col, 'Paladin') * 5,
      resetOn: 'long',
      origin,
    });
    col.add({
      kind: 'action',
      economy: is2024 ? 'bonus' : 'action',
      label: 'Lay on Hands',
      note: is2024
        ? 'heal from the pool · 5 points removes Poisoned'
        : 'heal from the pool · 5 points cures a disease or poison',
      origin,
    });
  },
  'channel divinity|paladin': (col, origin) => {
    // 2024 scales with paladin level (2, 3 at 11); 2014 is once per rest.
    // Keyed per class, not shared with the cleric's pool: the 2024 text says
    // "each time you use THIS CLASS'S Channel Divinity", and the 2014 pools are
    // separate features with separate uses. A shared key would also make the
    // max depend on which class the player happened to add first.
    // A Death Knight's pool is this one, named for the class that has it.
    const is2024 = col.doc.rulesVersion === '2024';
    const uses = is2024 ? (classLevel(col, 'Paladin') >= 11 ? 3 : 2) : 1;
    col.add({
      kind: 'resource',
      key: 'channel-divinity-paladin',
      label: `Channel Divinity (${classEntry(col, 'Paladin')?.ref.name ?? 'Paladin'})`,
      max: uses,
      ...recovery(is2024),
      origin,
    });
  },
  'arcane recovery|wizard': (col, origin) => {
    // Recovered ON a short rest but usable once per DAY. The prose scanner
    // reads the 2024 limit, but 2014's "once per day" is no wording it counts,
    // so pin the daily limit here for both.
    col.add({
      kind: 'resource',
      key: 'arcane-recovery',
      label: 'Arcane Recovery',
      max: 1,
      resetOn: 'long',
      origin,
    });
  },
  'sneak attack|rogue': (col, origin) => {
    const dice = Math.ceil(classLevel(col, 'Rogue') / 2);
    col.add({
      kind: 'action',
      economy: 'action',
      label: `Sneak Attack (+${dice}d6 once/turn)`,
      roll: `${dice}d6`,
      origin,
    });
  },
  // Half proficiency where it is not already added. The 2014 wording reaches
  // every check, plain ability checks and initiative included; the 2024 one
  // reaches only skills the bard lacks.
  'jack of all trades|bard': (col, origin, from) => {
    col.add(
      printedIn(origin, 'xphb', from)
        ? { kind: 'halfProf', round: 'down', skillsOnly: true, origin }
        : { kind: 'halfProf', round: 'down', origin },
    );
  },
  // TCE's optional feature (under the 2014 class) picks again at barbarian 10.
  'primal knowledge|barbarian': (col, origin, from) => {
    const count = printedIn(origin, 'phb', from) && classLevel(col, 'Barbarian') >= 10 ? 2 : 1;
    featureSkillPick(col, origin, count, classSkillList(col, 'Barbarian'));
  },
  // The sidekick classes' saving throw stays in the card, and so do the weapons,
  // shields and tools that depend on the creature's stat block.
  'bonus proficiencies|expert sidekick': kit({ armor: ['light'] }, skillPick(5)),
  'bonus proficiencies|spellcaster sidekick': kit(
    { armor: ['light'] },
    skillPick(2, [
      'Arcana',
      'History',
      'Insight',
      'Investigation',
      'Medicine',
      'Performance',
      'Persuasion',
      'Religion',
    ]),
  ),
  'bonus proficiencies|warrior sidekick': kit(
    { armor: ['light', 'medium', 'heavy'] },
    skillPick(2, [
      'Acrobatics',
      'Animal Handling',
      'Athletics',
      'Intimidation',
      'Nature',
      'Perception',
      'Survival',
    ]),
  ),
  // The 2024 Divine Order and Primal Order branches that train for battle.
  'protector|cleric': kit({ armor: ['heavy'], weapons: ['martial'] }),
  'warden|druid': kit({ armor: ['medium'], weapons: ['martial'] }),
  // The 2024 Divine Order and Primal Order branches: WIS on two INT skills.
  'thaumaturge|cleric': (col, origin) => {
    col.add({
      kind: 'checkBonus',
      skills: ['Arcana', 'Religion'],
      amount: 'abilityModMin1:wis',
      origin,
    });
  },
  'magician|druid': (col, origin) => {
    col.add({
      kind: 'checkBonus',
      skills: ['Arcana', 'Nature'],
      amount: 'abilityModMin1:wis',
      origin,
    });
  },
  // The Death Knight's d8s in place of Lay on Hands: one plus the Charisma modifier,
  // at least one, back on a long rest. A use spends as many as the player picks.
  'death coil|death knight': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'death-coil',
      label: 'Death Coil (d8 pool)',
      max: 'abilityModPlus1:cha',
      min: 1,
      resetOn: 'long',
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Death Coil',
      note: 'necrotic, or hit points to an Undead · 60 feet',
      save: { targetAbility: 'con' },
      origin,
    });
  },
  // A totem a bonus action, as often as the Shaman likes. Only the Primal Knowledge
  // Totem waits for a long rest, and a use of Rage buys it back. The scanner read
  // that one limit as every totem's.
  'totems|shaman': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Totems', origin });
    col.add({
      kind: 'resource',
      key: 'primal-knowledge-totem',
      label: 'Primal Knowledge Totem',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Primal Knowledge Totem', origin });
  },

  // --- Subclass features (keyed by the subclass's full name) ---------------
  // 2014 only: half proficiency rounded up on STR, DEX and CON checks. The
  // 2024 feature of the same name grants advantage, which is no sheet number.
  'remarkable athlete|champion': (col, origin, from) => {
    if (printedIn(origin, 'xphb', from)) return;
    col.add({ kind: 'halfProf', round: 'up', abilities: ['str', 'dex', 'con'], origin });
  },
  // These four say "you can", so a negative modifier stays off the roll.
  'dread ambusher|gloom stalker': (col, origin, from) => {
    col.add({ kind: 'initiativeBonus', amount: 'abilityModMin0:wis', origin });
    // A curated entry turns off the prose scan, which is what found the 2024
    // Dreadful Strike's uses ("equal to your Wisdom modifier"); keep them.
    if (printedIn(origin, 'xphb', from)) {
      col.add({
        kind: 'resource',
        key: 'dread-ambusher',
        label: 'Dread Ambusher',
        max: 'abilityMod:wis',
        resetOn: 'long',
        origin,
      });
    }
  },
  'rakish audacity|swashbuckler': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'abilityModMin0:cha', origin });
  },
  'tactical wit|war magic': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'abilityModMin0:int', origin });
  },
  'temporal awareness|chronurgy magic': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'abilityModMin0:int', origin });
  },
  // "A bonus equal to your proficiency bonus", not the bonus itself, so it sits
  // beside Alert or Hare-Trigger, as it does for an ally who has either. Allies
  // within 10 feet get it too; the sheet holds only the paladin's own.
  'aura of the sentinel|oath of the watchers': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'equalToProfBonus', origin });
  },
  // Both printings: the bonus, and one skill of three.
  'otherworldly glamour|fey wanderer': (col, origin) => {
    col.add({ kind: 'checkBonus', ability: 'cha', amount: 'abilityModMin1:wis', origin });
    featureSkillPick(col, origin, 1, ['Deception', 'Performance', 'Persuasion']);
  },
  'elegant courtier|samurai': (col, origin) => {
    col.add({ kind: 'checkBonus', skills: ['Persuasion'], amount: 'abilityMod:wis', origin });
  },
  // One printing, under either the 2014 or the 2024 rogue. Having a skill already
  // asks nothing: it is doubled all the same.
  'survivalist|scout': (col, origin) => {
    skillAtExpertise(col, 'Nature', origin);
    skillAtExpertise(col, 'Survival', origin);
  },
  // Persuasion is doubled however the fighter came by it, and having it already
  // swaps the proficiency for a plain one in another skill. Only what is collected
  // so far can say so: a later class's pick shows its own "already proficient" cue,
  // and a later fixed grant just overlaps.
  'royal envoy|purple dragon knight (banneret)': (col, origin) => {
    if (col.proficientSkills().some((s) => s.toLowerCase() === 'persuasion')) {
      col.add({ kind: 'skillProf', skill: 'Persuasion', level: 2, origin });
      featureSkillPick(
        col,
        origin,
        1,
        ['Animal Handling', 'Insight', 'Intimidation', 'Performance'],
        undefined,
        'Skill in place of Persuasion',
      );
    } else {
      skillAtExpertise(col, 'Persuasion', origin);
    }
  },
  'blessings of knowledge|knowledge domain': blessingsOfKnowledge,
  // The PSA domain refers to the same feature, and the key names the subclass walked.
  'blessings of knowledge|knowledge domain (psa)': blessingsOfKnowledge,
  // The skills, armor, weapons and tools these grant in prose alone. Languages
  // and cantrips beside them stay in the card.
  // XGE picks one. AU grants both, and each one already held turns into a pick
  // from the fighter's list; like Royal Envoy, only what is collected so far counts.
  'arcane archer lore|arcane archer': (col, origin, from) => {
    if (!printedIn(origin, 'au', from))
      return featureSkillPick(col, origin, 1, ['Arcana', 'Nature']);
    const held = col.proficientSkills().map((s) => s.toLowerCase());
    const known = ['Arcana', 'Nature'].filter((s) => held.includes(s.toLowerCase()));
    for (const skill of ['Arcana', 'Nature']) {
      if (!known.includes(skill)) proficient(col, skill, origin);
    }
    if (known.length > 0) {
      featureSkillPick(
        col,
        origin,
        known.length,
        classSkillList(col, 'Fighter'),
        undefined,
        `Skill in place of ${known.join(' and ')}`,
      );
    }
  },
  'bonus proficiency|cavalier': skillOrLanguage([
    'Animal Handling',
    'History',
    'Insight',
    'Performance',
    'Persuasion',
  ]),
  'bonus proficiency|samurai': skillOrLanguage(['History', 'Insight', 'Performance', 'Persuasion']),
  'knightly envoy|banneret': skillPick(1, ['Insight', 'Intimidation', 'Persuasion', 'Performance']),
  // An artisan's tool in both printings; 2024 adds a skill.
  'student of war|battle master': (col, origin, from) => {
    featureToolPick(col, origin, 1, ["artisan's tools"]);
    if (printedIn(origin, 'xphb', from)) {
      featureSkillPick(col, origin, 1, classSkillList(col, 'Fighter'));
    }
  },
  'bonus proficiencies|rune knight': kit({ tools: ["Smith's Tools"] }),
  'bonus proficiencies|assassin': kit({ tools: ['Disguise Kit', "Poisoner's Kit"] }),
  "assassin's tools|assassin": kit({ tools: ['Disguise Kit', "Poisoner's Kit"] }),
  'master of intrigue|mastermind': kit(
    { tools: ['Disguise Kit', 'Forgery Kit'] },
    toolPick(1, ['gaming set']),
  ),
  'hex warrior|the hexblade': kit({ armor: ['medium', 'shield'], weapons: ['martial'] }),
  'bonus proficiencies|college of valor': kit({
    armor: ['medium', 'shield'],
    weapons: ['martial'],
  }),
  'martial training|college of valor': kit({ armor: ['medium', 'shield'], weapons: ['martial'] }),
  'bonus proficiencies|college of swords': kit({ armor: ['medium'], weapons: ['scimitar'] }),
  'channeler|college of spirits': kit({ tools: ['Playing Card Set'] }),
  'unarmored defense|college of dance': unarmored(10, 'dex', 'cha'),
  'bonus proficiency|life domain': kit({ armor: ['heavy'] }),
  'bonus proficiency|nature domain': kit({ armor: ['heavy'] }),
  'bonus proficiency|strength domain (psa)': kit({ armor: ['heavy'] }),
  'bonus proficiency|solidarity domain (psa)': kit({ armor: ['heavy'] }),
  'bonus proficiency|forge domain': kit({ armor: ['heavy'], tools: ["Smith's Tools"] }),
  'bonus proficiencies|tempest domain': kit({ armor: ['heavy'], weapons: ['martial'] }),
  'bonus proficiencies|war domain': kit({ armor: ['heavy'], weapons: ['martial'] }),
  'bonus proficiencies|zeal domain (psa)': kit({ armor: ['heavy'], weapons: ['martial'] }),
  'bonus proficiencies|twilight domain': kit({ armor: ['heavy'], weapons: ['martial'] }),
  'bonus proficiency|death domain': kit({ weapons: ['martial'] }),
  // The artificer subclasses (TCE and EFA share each subclass name).
  'battle ready|battle smith': kit({ weapons: ['martial'] }),
  'tool proficiency|battle smith': toolsOrAnother("Smith's Tools"),
  'tool proficiency|alchemist': toolsOrAnother("Alchemist's Supplies"),
  'tool proficiency|artillerist': toolsOrAnother("Woodcarver's Tools"),
  'tools of the trade|armorer': kit({ armor: ['heavy'] }, toolsOrAnother("Smith's Tools")),
  'tools of the trade|battle smith': toolsOrAnother("Smith's Tools"),
  'tools of the trade|alchemist': toolsOrAnother("Alchemist's Supplies", 'Herbalism Kit'),
  'tools of the trade|artillerist': kit(
    { filter: ['Martial Ranged weapons', 'type=martial weapon|type=ranged weapon'] },
    toolsOrAnother("Woodcarver's Tools"),
  ),
  'tools of the trade|cartographer': toolsOrAnother(
    "Calligrapher's Supplies",
    "Cartographer's Tools",
  ),
  // The scanner read Jolt to Life's uses before this row turned it off; keep them.
  "reanimator's skill set|reanimator": all(toolsOrAnother("Alchemist's Supplies"), (col, origin) =>
    col.add({
      kind: 'resource',
      key: 'reanimator-s-skill-set',
      label: "Reanimator's Skill Set",
      max: 'abilityMod:int',
      resetOn: 'long',
      origin,
    }),
  ),
  // Its kensei weapons, which also become monk weapons, stay in the card.
  'path of the kensei|way of the kensei': toolPick(1, [
    "calligrapher's supplies",
    "painter's supplies",
  ]),
  // The 2014 printing's +1 hit point per level is what the scanner read; keep it.
  'draconic resilience|draconic bloodline': all(unarmored(13, 'dex'), (col, origin) =>
    col.add({ kind: 'hpPerLevel', amount: 1, origin }),
  ),
  'draconic resilience|draconic sorcery': unarmored(10, 'dex', 'cha'),
  // The UA Mystic's orders.
  'armor training|order of the avatar': kit({ armor: ['medium', 'shield'] }),
  'martial training|order of the soul knife': kit({ armor: ['medium'], weapons: ['martial'] }),
  'immortal durability|order of the immortal': unarmored(10, 'dex', 'con'),
  'acolyte of nature|nature domain': skillPick(1, ['Animal Handling', 'Nature', 'Survival']),
  'acolyte of strength|strength domain (psa)': skillPick(1, [
    'Animal Handling',
    'Athletics',
    'Nature',
    'Survival',
  ]),
  'arcane initiate|arcana domain': skills('Arcana'),
  'bonus proficiencies|order domain': kit(
    { armor: ['heavy'] },
    skillPick(1, ['Intimidation', 'Persuasion']),
  ),
  'implement of peace|peace domain': skillPick(1, ['Insight', 'Performance', 'Persuasion']),
  'student of arcana|arcana domain': (col, origin) => {
    featureSkillPick(col, origin, 1, ['Arcana', ...classSkillList(col, 'Cleric')]);
  },
  'bonus proficiencies|college of lore': skillPick(3),
  'primal lore|college of the moon': skillPick(1, [
    'Animal Handling',
    'Insight',
    'Medicine',
    'Nature',
    'Perception',
    'Survival',
  ]),
  'awakened talent|order of the awakened': skillPick(2, [
    'Animal Handling',
    'Deception',
    'Insight',
    'Intimidation',
    'Investigation',
    'Perception',
    'Persuasion',
  ]),
  "hermit's study|order of the wu jen": skillPick(2, [
    'Animal Handling',
    'Arcana',
    'History',
    'Insight',
    'Medicine',
    'Nature',
    'Perception',
    'Religion',
    'Survival',
  ]),
  'implements of mercy|way of mercy': kit(
    { tools: ['Herbalism Kit'] },
    skills('Insight', 'Medicine'),
  ),
  'implements of mercy|warrior of mercy': kit(
    { tools: ['Herbalism Kit'] },
    skills('Insight', 'Medicine'),
  ),
  'bonus proficiencies|way of the drunken master': kit(
    { tools: ["Brewer's Supplies"] },
    skills('Performance'),
  ),
  // Performance, or a Monk skill in its place when it is held already. Like Royal
  // Envoy, only what is collected so far can say so.
  'bonus proficiencies|warrior of mystic brews': kit(
    { tools: ["Brewer's Supplies"] },
    (col, origin) => {
      if (col.proficientSkills().some((s) => s.toLowerCase() === 'performance')) {
        featureSkillPick(
          col,
          origin,
          1,
          classSkillList(col, 'Monk'),
          undefined,
          'Skill in place of Performance',
        );
      } else {
        proficient(col, 'Performance', origin);
      }
    },
  ),
  // Fragments gathered on a long rest: the Wisdom modifier's worth (at least one),
  // one more from level 13 and two from 17. A reaction when an enemy dies takes one
  // back without spending any; what spends them is in `SPEND_LINKS`. The levels are
  // the Demon Hunter's own, not a Ranger's or a Hunter's beside them.
  'soul fragments|demon hunter': (col, origin) => {
    const level = classLevel(col, 'Demon Hunter');
    const fragments = { key: 'soul-fragments', label: 'Soul Fragments', resetOn: 'long' } as const;
    col.add({ kind: 'resource', ...fragments, max: 'abilityMod:wis', origin });
    if (level >= 13) {
      col.add({ kind: 'resource', ...fragments, max: level >= 17 ? 2 : 1, stack: true, origin });
    }
    col.add({
      kind: 'action',
      economy: 'reaction',
      label: 'Soul Fragments',
      note: 'regain one when an enemy you can see within 30 feet dies',
      regains: { resource: 'soul-fragments', amount: 1 },
      spendsNoUse: true,
      origin,
    });
  },
  // One use a long rest, of the rune on the weapon: Blood's reaction, Frost's breath
  // in place of an attack (a Dexterity save against the spell save DC, which the
  // scanner missed) or Unholy's Summon Undead. Each chip spends that one use.
  'runic mastery|oath of the ebon blade': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'runic-mastery',
      label: 'Runic Mastery',
      max: 1,
      resetOn: 'long',
      origin,
    });
    const cost = { resource: 'runic-mastery', amount: 1 } as const;
    col.add({
      kind: 'action',
      economy: 'reaction',
      label: 'Runic Mastery: Blood',
      note: 'an ally hit within 10 feet takes less damage, and you lose as much',
      cost,
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'none',
      label: 'Runic Mastery: Frost',
      roll: '8d6',
      note: 'cold · 30-foot cone, in place of one attack',
      save: { targetAbility: 'dex', dcAbility: 'spell' },
      cost,
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'none',
      label: 'Runic Mastery: Unholy',
      note: 'Summon Undead with no concentration',
      cost,
      origin,
    });
  },
  "genie's splendor|oath of the noble genies": all(
    unarmored(10, 'dex', 'cha'),
    skillPick(1, ['Acrobatics', 'Intimidation', 'Performance', 'Persuasion']),
  ),
  'training in war and song (bladesinging)|bladesinging': kit(
    { armor: ['light'] },
    skills('Performance'),
    oneHandedMeleePick,
  ),
  'training in war and song|bladesinger': kit(
    {
      filter: [
        'Melee Martial weapons without Two-Handed or Heavy',
        'type=martial weapon|type=melee weapon|property=!two-handed;!heavy',
      ],
    },
    skillPick(1, ['Acrobatics', 'Athletics', 'Performance', 'Persuasion']),
  ),
  // The skill picked also takes the bonus.
  'enchanting conversationalist|enchanter': (col, origin) => {
    featureSkillPick(col, origin, 1, ['Deception', 'Intimidation', 'Persuasion'], (skill) => {
      proficient(col, skill, origin);
      col.add({ kind: 'checkBonus', skills: [skill], amount: 'abilityModMin1:int', origin });
    });
  },

  // --- Racial traits (keyed `trait:<traitName>`) ---------------------------
  // Most limited-use traits (Relentless Endurance, Breath Weapon, Fey Step,
  // Stone's Endurance, …) are handled per-source by the prose scanner, which
  // reads each printing's actual wording. Curate here only what prose can't
  // see (passive numbers with no usage phrasing).
  'trait:surprise attack': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'action',
      label: 'Surprise Attack (+2d6, first round)',
      roll: '2d6',
      origin,
    });
  },
  // Warforged, both printings.
  'trait:integrated protection': (col, origin) => {
    col.add({ kind: 'acBonus', amount: 1, origin });
  },
  'trait:hare-trigger': (col, origin) => {
    col.add({ kind: 'initiativeBonus', amount: 'profBonus', origin });
  },
  // Ibis-headed Aven (Plane Shift: Amonkhet).
  "trait:kefnet's blessing": (col, origin) => {
    col.add({ kind: 'halfProf', round: 'down', abilities: ['int'], origin });
  },
};

/**
 * Racial traits live in `race.entries` by name — key them `trait:<name>`.
 * Returns whether a curated entry handled it (callers fall back to prose scan).
 */
export function emitCuratedTrait(col: Collector, traitName: string, origin: EffectOrigin): boolean {
  const fn = CURATED[`trait:${traitName.toLowerCase()}`];
  fn?.(col, origin);
  return fn !== undefined;
}

/** Returns whether a curated entry handled the key (callers fall back to prose scan). */
export function emitCuratedEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from?: string,
): boolean {
  const fn = CURATED[key];
  fn?.(col, origin, from);
  return fn !== undefined;
}
