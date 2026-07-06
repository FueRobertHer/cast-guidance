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
};

export function emitCuratedEffects(col: Collector, key: string, origin: EffectOrigin): void {
  CURATED[key]?.(col, origin);
}
