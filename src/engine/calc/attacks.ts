import type { Collector } from '../effects/base';
import { str } from '../effects/base';
import { lookupItem, parseBonus } from '../effects/item';
import type {
  Ability,
  AttackRow,
  CharacterDoc,
  DamageRider,
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

/**
 * Damage riders declared on the item, e.g. a flaming sword's
 *
 *     "extraDamage": [{ "dmg": "1d4", "dmgType": "F" }]
 *
 * 5etools has no field for "and also 1d4 fire on every hit" (published magic
 * weapons say it in prose only), so this is ours: named after the `dmg1` /
 * `dmgType` pair it sits beside, and ignored by anything else reading the file.
 * A lone object is accepted as well as a list: one rider is the common case and
 * hand-written JSON tends to drop the brackets. The type may be a 5etools code
 * or already spelled out, since a homebrew author writes whichever they know.
 */
function extraDamageOf(e: DataEntity): DamageRider[] {
  const raw = e.extraDamage;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const out: DamageRider[] = [];
  for (const r of list) {
    if (typeof r !== 'object' || r === null) continue;
    const { dmg, dmgType } = r as Record<string, unknown>;
    if (typeof dmg !== 'string' || dmg.trim() === '') continue;
    out.push({
      dice: dmg.trim(),
      damageType:
        typeof dmgType === 'string' && dmgType !== ''
          ? (DMG_TYPE_LABELS[dmgType] ?? dmgType)
          : undefined,
    });
  }
  return out;
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
    extraDamage: DamageRider[] = [],
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
      // Riders are flat dice: `dmgSuffix` is deliberately not applied. You add
      // your Strength to the sword, not to the flames.
      extraDamage,
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
        extraDamage: [],
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
        [
          ...props.map((p) => PROPERTY_LABELS[p] ?? p),
          // 2024 weapon mastery, e.g. "Sap|XPHB" -> "mastery: sap"
          ...(Array.isArray(e.mastery)
            ? e.mastery.map((m) => `mastery: ${String(m).split('|')[0]?.toLowerCase()}`)
            : []),
        ],
        range !== undefined ? `${range} ft.` : undefined,
        str(e.name) ?? '',
        extraDamageOf(e),
      ),
    );
  }

  // Natural weapons from race traits (Ram, Cat's Claws, Bite, …) are unarmed
  // strikes with their own die and damage type, so proficiency always applies.
  for (const nw of effectsOf(effects, 'naturalWeapon')) {
    rows.push(
      buildRow(
        nw.label,
        nw.ability,
        true,
        0,
        false,
        nw.dice,
        nw.damageType,
        undefined,
        ['natural weapon'],
        undefined,
        nw.origin.label,
      ),
    );
  }

  // Unarmed strike is always available. Features that only enlarge its die
  // (Unarmed Fighting, Tavern Brawler) replace the flat damage here instead of
  // adding a row; the biggest die wins when a character has more than one, and
  // it is named in the properties so the number is traceable.
  const bestPunch = effectsOf(effects, 'unarmedDamage').reduce<
    { dice: string; label: string } | undefined
  >(
    (best, u) =>
      averageDice(u.dice) > (best === undefined ? 0 : averageDice(best.dice))
        ? { dice: u.dice, label: u.label }
        : best,
    undefined,
  );
  rows.push(
    buildRow(
      'Unarmed Strike',
      'str',
      true,
      0,
      false,
      bestPunch?.dice,
      'bludgeoning',
      undefined,
      bestPunch === undefined ? [] : [bestPunch.label.toLowerCase()],
      undefined,
      'unarmed',
    ),
  );
  return rows;
}

/** Average of an `NdM` expression, for picking the biggest unarmed die. */
function averageDice(expr: string): number {
  const m = /^(\d+)d(\d+)$/.exec(expr);
  if (m?.[1] === undefined || m[2] === undefined) return 0;
  return (Number(m[1]) * (Number(m[2]) + 1)) / 2;
}
