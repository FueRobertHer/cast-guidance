import type { TableRuleChoices } from '../castGuidance';
import type { Collector } from '../effects/base';
import {
  isArmor,
  isShield,
  itemTypeCode,
  lookupItem,
  magicWorks,
  parseBonus,
} from '../effects/item';
import type {
  Ability,
  ArmorCategory,
  CharacterDoc,
  DataEntity,
  DerivedAbility,
  DerivedSheet,
  DerivedValue,
  EffectInput,
} from '../types';
import { atLeast, dv, effectsOf, inPlay, onTop, withOverride } from './core';

interface AcCandidate {
  label: string;
  parts: Array<{ label: string; amount: number }>;
}

function armorCandidate(
  e: DataEntity,
  itemLabel: string,
  dexMod: number,
  attuned: boolean,
): AcCandidate | undefined {
  const ac = typeof e.ac === 'number' ? e.ac : undefined;
  if (ac === undefined) return undefined;
  const type = String(e.type ?? '').split('|')[0];
  const parts = [{ label: itemLabel, amount: ac }];
  if (type === 'LA') {
    parts.push({ label: 'DEX modifier', amount: dexMod });
  } else if (type === 'MA') {
    parts.push({ label: 'DEX modifier (max 2)', amount: Math.min(dexMod, 2) });
  } // HA: no dex
  const bonus = magicWorks(e, attuned) ? parseBonus(e.bonusAc) : 0;
  if (bonus !== 0) parts.push({ label: 'Magic bonus', amount: bonus });
  return { label: itemLabel, parts };
}

const sumOf = (c: AcCandidate) => c.parts.reduce((s, p) => s + p.amount, 0);

/**
 * Armor Class: one way of working it out counts, the best of the armor worn and
 * every formula (Unarmored Defense, Mage Armor); then the shield and every
 * bonus; then the highest floor (Barkskin), which nothing can go under. An
 * override replaces the build's number; bonuses and floors from effects in play
 * still count on top of it, and a formula from one is set aside.
 */
export function calcAc(
  doc: CharacterDoc,
  col: Collector,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  /** The `armorTraining` table rule; off, untrained armor costs nothing here. */
  armorTraining: TableRuleChoices['armorTraining'] = 'off',
): {
  ac: DerivedValue;
  label: string;
  notCounted: DerivedSheet['acNotCounted'];
  heavyArmor?: string;
  untrained: DerivedSheet['untrainedArmor'];
} {
  const dexMod = abilities.dex.mod;
  const override = doc.overrides.ac;
  const notCounted: DerivedSheet['acNotCounted'] = [];
  const candidates: AcCandidate[] = [
    {
      label: 'Unarmored',
      parts: [
        { label: 'Base', amount: 10 },
        { label: 'DEX modifier', amount: dexMod },
      ],
    },
  ];
  const formulas = new Set<AcCandidate>();

  for (const f of effectsOf(effects, 'acFormula')) {
    // One in play goes by its effect's name, as the strip shows it.
    const label = inPlay(f) ? f.origin.label : f.label;
    const parts = [{ label: `${label} base`, amount: f.base }];
    for (const a of f.addAbilities) {
      const mod =
        f.dexMax !== undefined && a === 'dex'
          ? Math.min(abilities[a].mod, f.dexMax)
          : abilities[a].mod;
      parts.push({ label: `${a.toUpperCase()} modifier`, amount: mod });
    }
    const candidate = { label, parts };
    if (inPlay(f) && override !== undefined) {
      notCounted.push({ label: candidate.label, value: sumOf(candidate), why: 'override' });
      continue;
    }
    formulas.add(candidate);
    candidates.push(candidate);
  }

  let shield: { label: string; amount: number } | undefined;
  let heavyArmor: string | undefined;
  const armorProfs = effectsOf(effects, 'armorProf').map((p) => p.name);
  const untrained: DerivedSheet['untrainedArmor'] = [];
  for (const entry of doc.equipment) {
    if (!entry.equipped || entry.ref === undefined) continue;
    const e = lookupItem(col, entry.ref.name, entry.ref.source);
    if (e === undefined) continue;
    const label = String(e.name ?? entry.ref.name);
    const lacks = untrainedArmor(e, armorProfs);
    if (lacks !== undefined) untrained.push({ id: entry.id, name: label, category: lacks });
    if (isArmor(e)) {
      if (itemTypeCode(e) === 'HA') heavyArmor ??= label;
      const c = armorCandidate(e, label, dexMod, entry.attuned);
      if (c !== undefined) candidates.push(c);
    } else if (isShield(e)) {
      const ac = typeof e.ac === 'number' ? e.ac : 2;
      const bonus = magicWorks(e, entry.attuned) ? parseBonus(e.bonusAc) : 0;
      const worn = { label, amount: ac + bonus };
      // 2024: a shield without training gives no AC (as written, the rule on).
      if (lacks !== undefined && doc.rulesVersion === '2024' && armorTraining === 'applied') {
        notCounted.push({ label, value: worn.amount, why: 'untrained' });
      } else {
        shield = worn;
      }
    }
  }

  let best = candidates[0] as AcCandidate;
  let bestValue = sumOf(best);
  for (const c of candidates.slice(1)) {
    const v = sumOf(c);
    if (v > bestValue) {
      best = c;
      bestValue = v;
    }
  }
  for (const c of formulas) {
    if (c !== best) notCounted.push({ label: c.label, value: sumOf(c), why: 'lower' });
  }

  const parts = [...best.parts];
  if (shield !== undefined) parts.push(shield);
  const bonuses = effectsOf(effects, 'acBonus');
  for (const b of bonuses) {
    if (!inPlay(b)) parts.push({ label: b.origin.label, amount: b.amount });
  }

  // The highest floor raises what is there with a part of its own, so the
  // parts still sum to the computed number the breakdown shows. A floor from
  // the build comes before an override, as the build's minimums do; one in
  // play comes after it, like the bonuses in play.
  const floors = effectsOf(effects, 'acMin');
  const raised = new Set<(typeof floors)[number]>();
  const raise = (v: DerivedValue, inPlayFloors: boolean): DerivedValue => {
    const top = floors
      .filter((f) => inPlay(f) === inPlayFloors)
      .reduce<(typeof floors)[number] | undefined>(
        (hi, f) => (hi === undefined || f.min > hi.min ? f : hi),
        undefined,
      );
    if (top === undefined || v.value >= top.min) return v;
    raised.add(top);
    return atLeast(v, top.min, `${top.origin.label} (minimum)`);
  };

  const ac = raise(
    onTop(
      withOverride(raise(dv(parts), false), override),
      bonuses.filter(inPlay).map((b) => ({ label: b.origin.label, amount: b.amount })),
    ),
    true,
  );
  for (const f of floors) {
    if (!raised.has(f)) notCounted.push({ label: f.origin.label, value: f.min, why: 'floor' });
  }
  return {
    ac,
    label: best.label,
    notCounted,
    ...(heavyArmor === undefined ? {} : { heavyArmor }),
    untrained,
  };
}

export type { ArmorCategory };

const CATEGORY: Readonly<Record<string, ArmorCategory>> = {
  LA: 'light',
  MA: 'medium',
  HA: 'heavy',
  S: 'shield',
};

/** Words by which armor makes its wearer count as proficient with it, whatever they lack. */
const WEARER_PROFICIENT =
  /considered proficient with this armor|even if you lack (proficiency|training)|you have training with this armor/i;

/** The category an item asks training in, when it is armor or a shield. */
export function armorCategory(e: DataEntity): ArmorCategory | undefined {
  return CATEGORY[itemTypeCode(e) ?? ''];
}

/**
 * The category of armor or shield the character wears without training
 * (proficiency, in 2014), read from their armor proficiencies as the books
 * word them: a category ("light", "shields", "all armor") or the armor by
 * name. Undefined when it is no armor, or they have the training. What it
 * costs is the `armorTraining` table rule's (`calcAc`, `untrainedPenalty`).
 */
export function untrainedArmor(
  e: DataEntity,
  armorProfs: readonly string[],
): ArmorCategory | undefined {
  const category = armorCategory(e);
  if (category === undefined) return undefined;
  // Armor that makes its wearer count as proficient (Elven Chain).
  if (WEARER_PROFICIENT.test(JSON.stringify(e.entries ?? ''))) return undefined;
  const name = String(e.name ?? '').toLowerCase();
  const trained = armorProfs.some((raw) => {
    const p = raw.toLowerCase();
    return (
      p.includes(category) ||
      (category !== 'shield' && p.includes('all armor')) ||
      (name !== '' && p === name)
    );
  });
  return trained ? undefined : category;
}
