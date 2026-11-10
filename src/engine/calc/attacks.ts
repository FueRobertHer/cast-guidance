import type { Collector } from '../effects/base';
import { str } from '../effects/base';
import { lookupItem, magicWorks, parseBonus } from '../effects/item';
import { masteryNames, weaponFitsTypes } from '../effects/readers';
import type {
  Ability,
  AttackRow,
  CharacterDoc,
  DamageRider,
  DataEntity,
  DerivedAbility,
  EffectInput,
  EngineContext,
} from '../types';
import { dv, effectsOf } from './core';

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

/** A weapon's properties as written: a code and, after a bar, its book ("AF|DMG"). */
function propertyRefs(e: DataEntity): Array<{ code: string; source?: string }> {
  if (!Array.isArray(e.property)) return [];
  return e.property.flatMap((p) => {
    const ref = typeof p === 'string' ? p : (str((p as DataEntity).uid) ?? '');
    const [code = '', source] = ref.split('|');
    return code === '' ? [] : [{ code, source }];
  });
}

function propertyCodes(e: DataEntity): string[] {
  return propertyRefs(e).map((r) => r.code);
}

/**
 * A property's name as the sheet shows it. The common ones are named above;
 * any other comes from the data's own `itemProperty` list, which names each
 * one in `name` or its first entry (the DMG firearms' "AF" is Ammunition,
 * EGW's "Vst" Vestige of Divergence), from the book the weapon gives when
 * there is one. A code the data does not name either is shown as written.
 */
function propertyName(ctx: EngineContext, code: string, source: string | undefined): string {
  const known = PROPERTY_LABELS[code];
  if (known !== undefined) return known;
  const lower = (v: unknown) => str(v)?.toLowerCase();
  const all = ctx
    .byType('itemProperty')
    .filter((p) => lower(p.abbreviation) === code.toLowerCase());
  const entry =
    all.find((p) => source !== undefined && lower(p.source) === source.toLowerCase()) ?? all[0];
  const entries = entry?.entries ?? entry?.entriesTemplate;
  const first: unknown = Array.isArray(entries) ? entries[0] : undefined;
  const name =
    str(entry?.name) ??
    (typeof first === 'object' && first !== null ? str((first as DataEntity).name) : undefined);
  return name?.toLowerCase() ?? code;
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

/**
 * Whether a proficiency filter ("type=martial weapon|property=light;finesse") covers a
 * weapon. A clause's values are alternatives and every clause must hold, so a curated
 * grant can say "martial and ranged" in two `type` clauses. A property after `!` must
 * be absent ("property=!two-handed;!heavy").
 */
function inProficiencyFilter(e: DataEntity, filter: string): boolean {
  const category = str(e.weaponCategory)?.toLowerCase();
  if (category === undefined) return false;
  const has = propertyCodes(e).map((c) => PROPERTY_LABELS[c]);
  return filter.split('|').every((clause) => {
    const [key = '', values] = clause.split('=');
    const list = values?.split(';').map((t) => t.trim().toLowerCase()) ?? [];
    const name = key.trim().toLowerCase();
    if (name === 'type') return weaponFitsTypes(list, category, isRangedWeapon(e));
    if (name !== 'property') return true;
    const wanted = list.filter((p) => !p.startsWith('!'));
    return (
      list.every((p) => !p.startsWith('!') || !has.includes(p.slice(1))) &&
      (wanted.length === 0 || wanted.some((p) => has.includes(p)))
    );
  });
}

function isProficient(e: DataEntity, weaponProfs: string[], filters: string[]): boolean {
  const category = str(e.weaponCategory)?.toLowerCase(); // 'simple' | 'martial'
  const name = str(e.name)?.toLowerCase() ?? '';
  for (const prof of weaponProfs) {
    const p = prof.toLowerCase();
    // The whole string: "Martial weapons that have the Light property" isn't all of them.
    if (p.replace(/ weapons?$/, '') === category) return true; // "simple", "martial weapons"
    if (p.replace(/s$/, '') === name || p === name) return true; // named weapon profs
  }
  return filters.some((f) => inProficiencyFilter(e, f));
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
  // Spell attacks take theirs in the spellcasting block.
  const attackBonuses = effectsOf(effects, 'attackBonus').filter((b) => b.attack !== 'spell');
  const damageBonuses = effectsOf(effects, 'damageBonus');
  const riderDice = effectsOf(effects, 'damageDie');
  const profFilters = effectsOf(effects, 'weaponProfFilter').map((f) => f.filter);
  /**
   * A bonus's scope reaches this attack, and so do its ability and its weapon,
   * when it names them: one on a weapon reaches only that carried weapon.
   */
  const reaches = (
    b: { scope: 'melee' | 'ranged' | 'all'; ability?: Ability; weapon?: string },
    ranged: boolean,
    ability: Ability,
    weaponId: string | undefined,
  ) =>
    (b.scope === 'all' || (b.scope === 'ranged') === ranged) &&
    (b.ability === undefined || b.ability === ability) &&
    (b.weapon === undefined || b.weapon === weaponId);

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
    weapon?: { id: string; magical: boolean },
  ): AttackRow => {
    const weaponId = weapon?.id;
    const mod = abilities[ability].mod;
    const parts = [{ label: `${ability.toUpperCase()} modifier`, amount: mod }];
    if (proficient) parts.push({ label: 'Proficiency', amount: profBonus });
    if (magicBonus !== 0) parts.push({ label: 'Magic bonus', amount: magicBonus });
    for (const b of attackBonuses) {
      if (reaches(b, ranged, ability, weaponId))
        parts.push({ label: b.origin.label, amount: b.amount });
    }

    let dmgMod = mod + magicBonus;
    const damageFrom: string[] = [];
    const bySource = new Map<string, number>();
    for (const b of damageBonuses) {
      if (!reaches(b, ranged, ability, weaponId)) continue;
      dmgMod += b.amount;
      if (b.amount !== 0 && !damageFrom.includes(b.origin.label)) damageFrom.push(b.origin.label);
      bySource.set(b.origin.label, (bySource.get(b.origin.label) ?? 0) + b.amount);
    }
    const damageAgainst = damageFrom.filter((label) => (bySource.get(label) ?? 0) < 0);
    const riders = [
      ...extraDamage,
      ...riderDice
        .filter((d) => reaches(d, ranged, ability, weaponId))
        .map((d) => ({
          dice: d.dice,
          ...(d.damageType !== undefined ? { damageType: d.damageType } : {}),
          label: d.origin.label,
        })),
    ];
    const dmgSuffix = dmgMod !== 0 ? (dmgMod > 0 ? `+${dmgMod}` : `${dmgMod}`) : '';
    return {
      label,
      toHit: dv(parts),
      damage: damageDice !== undefined ? `${damageDice}${dmgSuffix}` : `${Math.max(1, 1 + dmgMod)}`,
      damageType,
      versatileDamage: versatile !== undefined ? `${versatile}${dmgSuffix}` : undefined,
      ...(damageFrom.length > 0 ? { damageFrom } : {}),
      ...(damageAgainst.length > 0 ? { damageAgainst } : {}),
      // Riders are flat dice: `dmgSuffix` is deliberately not applied. You add
      // your Strength to the sword, not to the flames.
      extraDamage: riders,
      properties,
      range,
      ability,
      ranged,
      origin,
      ...(weapon === undefined ? {} : { weaponId: weapon.id }),
      ...(weapon?.magical === true ? { magical: true } : {}),
    };
  };

  for (const entry of doc.equipment) {
    if (!entry.equipped) continue;
    if (entry.custom?.attack !== undefined) {
      const a = entry.custom.attack;
      rows.push({
        label: entry.custom.name,
        toHit: dv([{ label: 'Custom bonus', amount: a.toHitBonus }]),
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
    // The magic bonus and damage riders wait on attunement when the item asks for it.
    const magic = magicWorks(e, entry.attuned);
    rows.push(
      buildRow(
        str(e.name) ?? entry.ref.name,
        ability,
        isProficient(e, weaponProfs, profFilters),
        magic ? parseBonus(e.bonusWeapon) : 0,
        ranged,
        str(e.dmg1),
        str(e.dmgType) !== undefined
          ? (DMG_TYPE_LABELS[String(e.dmgType)] ?? String(e.dmgType))
          : undefined,
        str(e.dmg2),
        [
          ...propertyRefs(e).map((p) => propertyName(col.ctx, p.code, p.source)),
          // 2024 weapon mastery, e.g. "Sap|XPHB" -> "mastery: sap"
          ...masteryNames(e).map((m) => `mastery: ${m.toLowerCase()}`),
        ],
        range !== undefined ? `${range} ft.` : undefined,
        str(e.name) ?? '',
        magic ? extraDamageOf(e) : [],
        // A magic item's rarity is set; a mundane weapon's is none.
        { id: entry.id, magical: typeof e.rarity === 'string' && e.rarity !== 'none' },
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
