import type { Collector } from '../effects/base';
import { str } from '../effects/base';
import { lookupItem, parseBonus } from '../effects/item';
import type {
  Ability,
  AttackRow,
  CharacterDoc,
  DataEntity,
  DerivedAbility,
  EffectInput,
} from '../types';
import { effectsOf } from './core';

const PROPERTY_LABELS: Record<string, string> = {
  A: 'ammunition',
  F: 'finesse',
  H: 'heavy',
  L: 'light',
  LD: 'loading',
  R: 'reach',
  T: 'thrown',
  '2H': 'two-handed',
  V: 'versatile',
  S: 'special',
  RLD: 'reload',
  BF: 'burst fire',
};

const DMG_TYPE_LABELS: Record<string, string> = {
  A: 'acid',
  B: 'bludgeoning',
  C: 'cold',
  F: 'fire',
  O: 'force',
  L: 'lightning',
  N: 'necrotic',
  P: 'piercing',
  I: 'poison',
  Y: 'psychic',
  R: 'radiant',
  S: 'slashing',
  T: 'thunder',
};

function propertyCodes(e: DataEntity): string[] {
  if (!Array.isArray(e.property)) return [];
  return e.property
    .map((p) => (typeof p === 'string' ? p : (str((p as DataEntity).uid) ?? '')))
    .map((p) => p.split('|')[0] ?? '')
    .filter((p) => p !== '');
}

function isRangedWeapon(e: DataEntity): boolean {
  const type = String(e.type ?? '').split('|')[0];
  return type === 'R' || type === 'AF';
}

function isWeapon(e: DataEntity): boolean {
  if (e.weapon === true || e.weaponCategory !== undefined) return true;
  const type = String(e.type ?? '').split('|')[0];
  return type === 'M' || type === 'R' || type === 'AF';
}

function isProficient(e: DataEntity, weaponProfs: string[]): boolean {
  const category = str(e.weaponCategory)?.toLowerCase(); // 'simple' | 'martial'
  const name = str(e.name)?.toLowerCase() ?? '';
  for (const prof of weaponProfs) {
    const p = prof.toLowerCase();
    if (category !== undefined && p.startsWith(category)) return true; // "simple", "martial weapons"
    if (p.replace(/s$/, '') === name || p === name) return true; // named weapon profs
  }
  return false;
}

export function calcAttacks(
  doc: CharacterDoc,
  col: Collector,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
  weaponProfs: string[],
): AttackRow[] {
  const rows: AttackRow[] = [];
  const attackBonuses = effectsOf(effects, 'attackBonus');
  const damageBonuses = effectsOf(effects, 'damageBonus');

  const buildRow = (
    label: string,
    ability: Ability,
    proficient: boolean,
    magicBonus: number,
    ranged: boolean,
    damageDice: string | undefined,
    damageType: string | undefined,
    versatile: string | undefined,
    properties: string[],
    range: string | undefined,
    origin: string,
  ): AttackRow => {
    const mod = abilities[ability].mod;
    const parts = [{ label: `${ability.toUpperCase()} modifier`, amount: mod }];
    if (proficient) parts.push({ label: 'Proficiency', amount: profBonus });
    if (magicBonus !== 0) parts.push({ label: 'Magic bonus', amount: magicBonus });
    for (const b of attackBonuses) {
      if (b.scope === 'all' || (b.scope === 'ranged') === ranged) {
        parts.push({ label: b.origin.label, amount: b.amount });
      }
    }
    const toHit = parts.reduce((s, p) => s + p.amount, 0);

    let dmgMod = mod + magicBonus;
    for (const b of damageBonuses) {
      if (b.scope === 'all' || (b.scope === 'ranged') === ranged) dmgMod += b.amount;
    }
    const dmgSuffix = dmgMod !== 0 ? (dmgMod > 0 ? `+${dmgMod}` : `${dmgMod}`) : '';
    return {
      label,
      toHit: { value: toHit, base: toHit, overridden: false, parts },
      damage: damageDice !== undefined ? `${damageDice}${dmgSuffix}` : `${Math.max(1, 1 + dmgMod)}`,
      damageType,
      versatileDamage: versatile !== undefined ? `${versatile}${dmgSuffix}` : undefined,
      properties,
      range,
      origin,
    };
  };

  for (const entry of doc.equipment) {
    if (!entry.equipped) continue;
    if (entry.custom?.attack !== undefined) {
      const a = entry.custom.attack;
      rows.push({
        label: entry.custom.name,
        toHit: {
          value: a.toHitBonus,
          base: a.toHitBonus,
          overridden: false,
          parts: [{ label: 'Custom bonus', amount: a.toHitBonus }],
        },
        damage: a.damage,
        damageType: a.damageType,
        properties: [],
        origin: 'custom',
      });
      continue;
    }
    if (entry.ref === undefined) continue;
    const e = lookupItem(col, entry.ref.name, entry.ref.source);
    if (e === undefined || !isWeapon(e)) continue;

    const props = propertyCodes(e);
    const ranged = isRangedWeapon(e);
    const finesse = props.includes('F');
    const ability: Ability = ranged
      ? 'dex'
      : finesse
        ? abilities.dex.mod > abilities.str.mod
          ? 'dex'
          : 'str'
        : 'str';
    const range = str(e.range);
    rows.push(
      buildRow(
        str(e.name) ?? entry.ref.name,
        ability,
        isProficient(e, weaponProfs),
        parseBonus(e.bonusWeapon),
        ranged,
        str(e.dmg1),
        str(e.dmgType) !== undefined
          ? (DMG_TYPE_LABELS[String(e.dmgType)] ?? String(e.dmgType))
          : undefined,
        str(e.dmg2),
        props.map((p) => PROPERTY_LABELS[p] ?? p),
        range !== undefined ? `${range} ft.` : undefined,
        str(e.name) ?? '',
      ),
    );
  }

  // Unarmed strike is always available.
  rows.push(
    buildRow(
      'Unarmed Strike',
      'str',
      true,
      0,
      false,
      undefined,
      'bludgeoning',
      undefined,
      [],
      undefined,
      'unarmed',
    ),
  );
  return rows;
}
