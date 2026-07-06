import type { Collector } from '../effects/base';
import { isArmor, isShield, lookupItem, parseBonus } from '../effects/item';
import type {
  Ability,
  CharacterDoc,
  DataEntity,
  DerivedAbility,
  DerivedValue,
  EffectInput,
} from '../types';
import { effectsOf, withOverride } from './core';

interface AcCandidate {
  label: string;
  parts: Array<{ label: string; amount: number }>;
}

function armorCandidate(e: DataEntity, itemLabel: string, dexMod: number): AcCandidate | undefined {
  const ac = typeof e.ac === 'number' ? e.ac : undefined;
  if (ac === undefined) return undefined;
  const type = String(e.type ?? '').split('|')[0];
  const parts = [{ label: itemLabel, amount: ac }];
  if (type === 'LA') {
    parts.push({ label: 'DEX modifier', amount: dexMod });
  } else if (type === 'MA') {
    parts.push({ label: 'DEX modifier (max 2)', amount: Math.min(dexMod, 2) });
  } // HA: no dex
  const bonus = parseBonus(e.bonusAc);
  if (bonus !== 0) parts.push({ label: 'Magic bonus', amount: bonus });
  return { label: itemLabel, parts };
}

export function calcAc(
  doc: CharacterDoc,
  col: Collector,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
): { ac: DerivedValue; label: string } {
  const dexMod = abilities.dex.mod;
  const candidates: AcCandidate[] = [
    {
      label: 'Unarmored',
      parts: [
        { label: 'Base', amount: 10 },
        { label: 'DEX modifier', amount: dexMod },
      ],
    },
  ];

  for (const f of effectsOf(effects, 'acFormula')) {
    const parts = [{ label: `${f.label} base`, amount: f.base }];
    for (const a of f.addAbilities) {
      const mod =
        f.dexMax !== undefined && a === 'dex'
          ? Math.min(abilities[a].mod, f.dexMax)
          : abilities[a].mod;
      parts.push({ label: `${a.toUpperCase()} modifier`, amount: mod });
    }
    candidates.push({ label: f.label, parts });
  }

  let shield: { label: string; amount: number } | undefined;
  for (const entry of doc.equipment) {
    if (!entry.equipped || entry.ref === undefined) continue;
    const e = lookupItem(col, entry.ref.name, entry.ref.source);
    if (e === undefined) continue;
    const label = String(e.name ?? entry.ref.name);
    if (isArmor(e)) {
      const c = armorCandidate(e, label, dexMod);
      if (c !== undefined) candidates.push(c);
    } else if (isShield(e)) {
      const ac = typeof e.ac === 'number' ? e.ac : 2;
      shield = { label, amount: ac + parseBonus(e.bonusAc) };
    }
  }

  let best = candidates[0] as AcCandidate;
  let bestValue = best.parts.reduce((s, p) => s + p.amount, 0);
  for (const c of candidates.slice(1)) {
    const v = c.parts.reduce((s, p) => s + p.amount, 0);
    if (v > bestValue) {
      best = c;
      bestValue = v;
    }
  }

  const parts = [...best.parts];
  if (shield !== undefined) parts.push(shield);
  for (const b of effectsOf(effects, 'acBonus')) {
    parts.push({ label: b.origin.label, amount: b.amount });
  }
  const base = parts.reduce((s, p) => s + p.amount, 0);
  return {
    ac: withOverride({ value: base, base, overridden: false, parts }, doc.overrides.ac),
    label: best.label,
  };
}
