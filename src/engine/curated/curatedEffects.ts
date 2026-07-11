/**
 * Curated mechanics for high-frequency features whose numbers exist only in
 * prose (verified against the dataset: e.g. Alert's +5 initiative has no
 * structured field). Keys:
 *   - feats / optional features: `name|source` (entity uid, lowercased)
 *   - class/subclass features:   `featureName|classLabel` (lowercased)
 * These are facts of the game rules — fine to commit.
 */
import type { Collector } from '../effects/base';
import type { EffectOrigin } from '../types';

type CuratedFn = (col: Collector, origin: EffectOrigin) => void;

function classLevel(col: Collector, className: string): number {
  const entry = col.doc.classes.find((c) => c.ref.name.toLowerCase() === className.toLowerCase());
  return entry?.levels ?? 0;
}

function rageUses(level: number): number {
  if (level >= 20) return 99;
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
    col.add({
      kind: 'resource',
      key: 'superiority-die',
      label: 'Superiority Die',
      max: 1,
      resetOn: 'short',
      origin,
    });
    col.add({
      kind: 'note',
      text: 'Martial Adept: one superiority die (d6); learn two maneuvers.',
      origin,
    });
  },
  'healer|phb': (col, origin) => {
    col.add({ kind: 'action', economy: 'action', label: 'Healer (kit)', roll: '1d6+4', origin });
  },
  'healer|xphb': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Healer (kit)', roll: '1d6+4', origin });
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
    col.add({ kind: 'note', text: 'Defense: +1 AC applies only while wearing armor.', origin });
  },
  'defense|xphb': (col, origin) => {
    col.add({ kind: 'acBonus', amount: 1, origin });
    col.add({ kind: 'note', text: 'Defense: +1 AC applies only while wearing armor.', origin });
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
      text: 'Dueling: +2 damage applies while wielding a single one-handed weapon.',
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
  'rage|barbarian': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'rage',
      label: 'Rage',
      max: rageUses(classLevel(col, 'Barbarian')),
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Rage', origin });
  },
  'second wind|fighter': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'second-wind',
      label: 'Second Wind',
      max: 1,
      resetOn: 'short',
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'bonus',
      label: 'Second Wind',
      roll: `1d10+${classLevel(col, 'Fighter')}`,
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

  // --- Racial traits (keyed `trait:<traitName>`, race-agnostic mechanics) ---
  'trait:relentless endurance': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'relentless-endurance',
      label: 'Relentless Endurance',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({
      kind: 'note',
      text: 'Relentless Endurance: when reduced to 0 HP (not killed outright), drop to 1 HP instead. Once per long rest.',
      origin,
    });
  },
  'trait:breath weapon': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'breath-weapon',
      label: 'Breath Weapon',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'action', label: 'Breath Weapon', origin });
  },
  "trait:stone's endurance": (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'stones-endurance',
      label: "Stone's Endurance",
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
    col.add({
      kind: 'action',
      economy: 'reaction',
      label: "Stone's Endurance (reduce damage)",
      roll: '1d12',
      origin,
    });
  },
  'trait:healing hands': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'healing-hands',
      label: 'Healing Hands',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'action', label: 'Healing Hands', origin });
  },
  'trait:fey step': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'fey-step',
      label: 'Fey Step',
      max: 1,
      resetOn: 'short',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Fey Step (teleport 30 ft)', origin });
  },
  'trait:celestial revelation': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'celestial-revelation',
      label: 'Celestial Revelation',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Celestial Revelation', origin });
  },
  'trait:adrenaline rush': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'adrenaline-rush',
      label: 'Adrenaline Rush',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Adrenaline Rush (Dash)', origin });
  },
  'trait:hidden step': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'hidden-step',
      label: 'Hidden Step',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Hidden Step (invisibility)', origin });
  },
  'trait:fury of the small': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'fury-of-the-small',
      label: 'Fury of the Small',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
  },
  'trait:nimble escape': (col, origin) => {
    col.add({ kind: 'action', economy: 'bonus', label: 'Nimble Escape (Disengage/Hide)', origin });
  },
  'trait:dwarven toughness': (col, origin) => {
    col.add({ kind: 'hpPerLevel', amount: 1, origin });
  },
  'trait:surprise attack': (col, origin) => {
    col.add({
      kind: 'action',
      economy: 'action',
      label: 'Surprise Attack (+2d6, first round)',
      roll: '2d6',
      origin,
    });
  },
  'trait:large form': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'large-form',
      label: 'Large Form',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Large Form (become Large)', origin });
  },
  'trait:draconic flight': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'draconic-flight',
      label: 'Draconic Flight',
      max: 1,
      resetOn: 'long',
      origin,
    });
    col.add({ kind: 'action', economy: 'bonus', label: 'Draconic Flight (wings, 10 min)', origin });
  },
  'trait:giant ancestry': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'giant-ancestry',
      label: 'Giant Ancestry',
      max: 'profBonus',
      resetOn: 'long',
      origin,
    });
  },
  'trait:radiant soul': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'radiant-soul',
      label: 'Radiant Soul',
      max: 1,
      resetOn: 'long',
      origin,
    });
  },
  'trait:necrotic shroud': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'necrotic-shroud',
      label: 'Necrotic Shroud',
      max: 1,
      resetOn: 'long',
      origin,
    });
  },
  'trait:radiant consumption': (col, origin) => {
    col.add({
      kind: 'resource',
      key: 'radiant-consumption',
      label: 'Radiant Consumption',
      max: 1,
      resetOn: 'long',
      origin,
    });
  },
};

/** Racial traits live in `race.entries` by name — key them `trait:<name>`. */
export function emitCuratedTrait(col: Collector, traitName: string, origin: EffectOrigin): void {
  CURATED[`trait:${traitName.toLowerCase()}`]?.(col, origin);
}

export function emitCuratedEffects(col: Collector, key: string, origin: EffectOrigin): void {
  CURATED[key]?.(col, origin);
}
