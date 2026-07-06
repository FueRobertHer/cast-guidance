/**
 * The derivation pipeline: CharacterDoc + EngineContext -> DerivedSheet.
 * Pure — no React, no persistence. Collect effects (resolving stored
 * choices, surfacing pending ones), fold them into derived values in a
 * fixed order, then apply overrides last.
 */
import { calcAbilities } from './calc/abilities';
import { calcAc } from './calc/ac';
import { calcAttacks } from './calc/attacks';
import { effectsOf, withOverride } from './calc/core';
import { calcMaxHp } from './calc/hp';
import { calcResources } from './calc/resources';
import { calcPassivePerception, calcSaves, calcSkills } from './calc/skills';
import { calcSpellcasting } from './calc/slots';
import { calcWalkSpeed } from './calc/speed';
import { collectBackground } from './effects/background';
import { Collector } from './effects/base';
import { collectClasses } from './effects/class';
import { collectFeats } from './effects/feat';
import { collectItems } from './effects/item';
import { collectRace } from './effects/race';
import type { CharacterDoc, ChoicePrompt, DerivedSheet, EngineContext } from './types';

export function deriveSheet(doc: CharacterDoc, ctx: EngineContext): DerivedSheet {
  const col = new Collector(doc, ctx);

  // 1. Collect effects in origin order
  collectRace(col);
  collectBackground(col);
  collectClasses(col);
  collectFeats(col);
  collectItems(col);
  for (const custom of doc.customEffects) col.add(custom);

  const effects = col.effects;

  // 2. Fold in fixed order
  const abilities = calcAbilities(doc, effects);

  const totalLevel = doc.classes.reduce((sum, c) => sum + c.levels, 0);
  const pbBase = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 2;
  const profBonus = withOverride(
    {
      value: pbBase,
      base: pbBase,
      overridden: false,
      parts: [{ label: `Level ${totalLevel}`, amount: pbBase }],
    },
    doc.overrides.profBonus,
  );

  const saves = calcSaves(doc, effects, abilities, profBonus.value);
  const skills = calcSkills(doc, effects, abilities, profBonus.value);
  const passivePerception = calcPassivePerception(doc, skills);
  const speedWalk = calcWalkSpeed(doc, col, effects);
  const { maxHp, hitDice } = calcMaxHp(doc, col, effects, abilities.con.mod);
  const { ac, label: acFormulaLabel } = calcAc(doc, col, effects, abilities);

  const initiativeParts = [{ label: 'DEX modifier', amount: abilities.dex.mod }];
  for (const b of effectsOf(effects, 'initiativeBonus')) {
    initiativeParts.push({ label: b.origin.label, amount: b.amount });
  }
  const initBase = initiativeParts.reduce((s, p) => s + p.amount, 0);
  const initiative = withOverride(
    { value: initBase, base: initBase, overridden: false, parts: initiativeParts },
    doc.overrides.initiative,
  );

  const weaponProfs = [...new Set(effectsOf(effects, 'weaponProf').map((e) => e.name))];
  const attacks = calcAttacks(doc, col, effects, abilities, profBonus.value, weaponProfs);
  const spellcasting = calcSpellcasting(doc, col, abilities, profBonus.value);
  const resources = calcResources(doc, effects, abilities, profBonus.value);

  const actions = effectsOf(effects, 'action').map((e) => ({
    economy: e.economy,
    label: e.label,
    roll: e.roll,
    origin: e.origin.label,
  }));

  const classLabel = doc.classes
    .map(
      (c) => `${c.ref.name} ${c.levels}${c.subclass !== undefined ? ` (${c.subclass.name})` : ''}`,
    )
    .join(' / ');

  for (const note of effectsOf(effects, 'note')) {
    col.warnings.push(`${note.origin.label}: ${note.text}`);
  }

  return {
    abilities,
    profBonus,
    saves,
    skills,
    passivePerception,
    ac,
    acFormulaLabel,
    initiative,
    speedWalk,
    maxHp,
    hitDice,
    totalLevel,
    classLabel,
    senses: effectsOf(effects, 'sense').map((e) => ({
      sense: e.sense,
      range: e.range,
      origin: e.origin.label,
    })),
    resists: effectsOf(effects, 'resist').map((e) => ({
      damageType: e.damageType,
      origin: e.origin.label,
    })),
    languages: [...new Set(effectsOf(effects, 'language').map((e) => e.name))],
    armorProfs: [...new Set(effectsOf(effects, 'armorProf').map((e) => e.name))],
    weaponProfs,
    toolProfs: [...new Set(effectsOf(effects, 'toolProf').map((e) => e.name))],
    attacks,
    spellcasting,
    actions,
    resources,
    features: col.features,
    warnings: col.warnings,
    pending: col.pending,
  };
}

/** Just the unresolved choices (wizard/level-up drive off this). */
export function pendingChoices(doc: CharacterDoc, ctx: EngineContext): ChoicePrompt[] {
  return deriveSheet(doc, ctx).pending;
}
