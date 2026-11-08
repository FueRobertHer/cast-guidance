/**
 * The derivation pipeline: CharacterDoc + EngineContext -> DerivedSheet.
 * Pure — no React, no persistence. Collect effects (resolving stored
 * choices, surfacing pending ones), fold them into derived values in a
 * fixed order, then apply overrides last.
 */
import { countingEffects, readActiveEffects } from './activeEffects';
import { calcAbilities } from './calc/abilities';
import { calcAc } from './calc/ac';
import { calcAttacks } from './calc/attacks';
import { bonusAmount, dv, effectsOf, inPlay, onTop, withOverride } from './calc/core';
import { calcMaxHp } from './calc/hp';
import { calcResources, costOnSheet } from './calc/resources';
import {
  calcChecks,
  calcPassivePerception,
  calcSaves,
  calcSkills,
  checkBonusParts,
  halfProfPart,
} from './calc/skills';
import { calcSpellcasting } from './calc/slots';
import { calcOtherSpeeds, calcSpeedMultiplier, calcWalkSpeed } from './calc/speed';
import { settleInheritedAbilities } from './effects/additionalSpells';
import { collectBackground } from './effects/background';
import { Collector } from './effects/base';
import { collectClasses } from './effects/class';
import { collectFeats } from './effects/feat';
import { markHeldPicks } from './effects/heldPicks';
import { collectItems } from './effects/item';
import { collectRace } from './effects/race';
import { noteSkillSources } from './effects/skillSources';
import type {
  Ability,
  CharacterDoc,
  ChoicePrompt,
  DerivedSheet,
  EffectInput,
  EngineContext,
  NotCounted,
  RollRider,
} from './types';

export interface DeriveOptions {
  /**
   * Whether effects in play (`play.activeEffects`) count; true when absent.
   * False gives the build alone, to compare against or to show on Build.
   */
  active?: boolean;
}

export function deriveSheet(
  doc: CharacterDoc,
  ctx: EngineContext,
  options: DeriveOptions = {},
): DerivedSheet {
  const col = new Collector(doc, ctx);

  // 1. Collect effects in origin order
  collectRace(col);
  const backgroundStart = col.effects.length;
  collectBackground(col);
  // Its granted feat is collected inline, so this span holds the feat's too.
  const fromBackground = new Set(col.effects.slice(backgroundStart));
  collectClasses(col);
  collectFeats(col);
  collectItems(col);
  for (const custom of doc.customEffects) col.add(custom);
  // Only now is every skill grant known, including ones collected after the
  // pick they overlap.
  noteSkillSources(col);
  markHeldPicks(col);
  settleInheritedAbilities(col);
  // Effects in play come last: they reach numbers and rolls, never a pick.
  let effectsNotCounted: NotCounted[] = [];
  if (options.active !== false) {
    const { effects: played, problems } = readActiveEffects(doc.play.activeEffects);
    for (const problem of problems) col.warn(problem);
    const counting = countingEffects(played);
    for (const e of counting.inputs) col.add(e);
    effectsNotCounted = counting.notCounted;
  }

  const effects = col.effects;

  // 2. Fold in fixed order
  const abilities = calcAbilities(doc, effects);

  const totalLevel = doc.classes.reduce((sum, c) => sum + c.levels, 0);
  const pbBase = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 2;
  const profBonus = withOverride(
    dv([{ label: `Level ${totalLevel}`, amount: pbBase }]),
    doc.overrides.profBonus,
  );

  const saves = calcSaves(doc, effects, abilities, profBonus.value);
  const checks = calcChecks(effects, abilities, profBonus.value);
  const skills = calcSkills(doc, effects, abilities, profBonus.value, fromBackground);
  const passivePerception = calcPassivePerception(doc, skills, effects);
  const speedWalk = calcWalkSpeed(doc, col, effects);
  const { maxHp, hitDice } = calcMaxHp(doc, col, effects, abilities.con.mod);
  const {
    ac,
    label: acFormulaLabel,
    notCounted: acNotCounted,
  } = calcAc(doc, col, effects, abilities);

  const initiativeParts = [{ label: 'DEX modifier', amount: abilities.dex.mod }];
  const initiativeOnTop: typeof initiativeParts = [];
  // The proficiency bonus goes on a roll once, however many features add it
  // (2024 Alert beside a Harengon's Hare-Trigger). A bonus that only equals it
  // (Aura of the Sentinel) is not that bonus, so it counts for neither limit.
  let addsProf = false;
  for (const b of effectsOf(effects, 'initiativeBonus')) {
    if (b.amount === 'profBonus') {
      if (addsProf) continue;
      addsProf = true;
    }
    // One from something in play counts over a hand-set initiative too.
    (inPlay(b) ? initiativeOnTop : initiativeParts).push({
      label: b.origin.label,
      amount: bonusAmount(b.amount, abilities, profBonus.value),
    });
  }
  // Initiative is a Dexterity check: what reaches every DEX check reaches it,
  // and half proficiency does too unless the bonus itself is already there.
  const initiativeHalf = addsProf
    ? undefined
    : halfProfPart(effects, 'dex', profBonus.value, false);
  if (initiativeHalf !== undefined) initiativeParts.push(initiativeHalf);
  const build = effects.filter((e) => !inPlay(e));
  initiativeParts.push(...checkBonusParts(build, abilities, profBonus.value, 'dex'));
  initiativeOnTop.push(
    ...checkBonusParts(effects.filter(inPlay), abilities, profBonus.value, 'dex'),
  );
  const initiative = onTop(
    withOverride(dv(initiativeParts), doc.overrides.initiative),
    initiativeOnTop,
  );

  const weaponProfs = uniqueNames(effectsOf(effects, 'weaponProf').map((e) => e.name));
  const attacks = calcAttacks(doc, col, effects, abilities, profBonus.value, weaponProfs);
  const spellcasting = calcSpellcasting(doc, col, abilities, profBonus.value);
  const resources = calcResources(doc, effects, abilities, profBonus.value);

  // Same-named actions collapse to one; the printing with the most mechanics
  // wins (a subrace's typed Breath Weapon beats the base race's generic one).
  const actionByKey = new Map<string, (typeof effects)[number] & { kind: 'action' }>();
  for (const e of effectsOf(effects, 'action')) {
    const key = `${e.economy}:${e.label}`;
    const cur = actionByKey.get(key);
    if (cur === undefined || richness(e) > richness(cur)) actionByKey.set(key, e);
  }
  // "Your spell save DC" is only one number with one caster's block to read it from.
  const saveDc = (from: Ability | 'spell' | undefined) =>
    from === 'spell'
      ? spellcasting[1]
        ? undefined
        : spellcasting[0]?.saveDc.value
      : from && 8 + abilities[from].mod + profBonus.value;
  const actions = [...actionByKey.values()].map((e) => ({
    economy: e.economy,
    label: e.label,
    roll: e.roll,
    heals: e.heals,
    plainDice: e.plainDice,
    origin: e.origin.label,
    note: e.note,
    save:
      e.save !== undefined
        ? { targetAbility: e.save.targetAbility, dc: saveDc(e.save.dcAbility) }
        : undefined,
    cost: costOnSheet(e.cost, resources),
    buyBack: costOnSheet(e.buyBack, resources),
    regains: e.regains,
    ...(e.spendsNoUse === true ? { spendsNoUse: true } : {}),
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
    checks,
    skills,
    passivePerception,
    ac,
    acFormulaLabel,
    acNotCounted,
    initiative,
    speedWalk,
    speedMultiplier: calcSpeedMultiplier(effects),
    otherSpeeds: calcOtherSpeeds(effects, speedWalk.value),
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
      ...(e.note !== undefined ? { note: e.note } : {}),
    })),
    immunities: effectsOf(effects, 'immune').map((e) => ({
      damageType: e.damageType,
      origin: e.origin.label,
      ...(e.note !== undefined ? { note: e.note } : {}),
    })),
    vulnerabilities: effectsOf(effects, 'vulnerable').map((e) => ({
      damageType: e.damageType,
      origin: e.origin.label,
    })),
    conditionImmunities: effectsOf(effects, 'conditionImmune').map((e) => ({
      condition: e.condition,
      origin: e.origin.label,
      ...(e.note !== undefined ? { note: e.note } : {}),
    })),
    rollRiders: rollRiders(effects),
    extraActions: effectsOf(effects, 'extraAction').map((e) => ({
      label: e.label,
      ...(e.note !== undefined ? { note: e.note } : {}),
      origin: e.origin.label,
    })),
    critRange: effectsOf(effects, 'critRange').reduce<DerivedSheet['critRange']>(
      (best, e) =>
        best === undefined || e.min < best.min ? { min: e.min, origin: e.origin.label } : best,
      undefined,
    ),
    tempHpEachTurn: effectsOf(effects, 'tempHpEachTurn').reduce<DerivedSheet['tempHpEachTurn']>(
      (best, e) =>
        best === undefined || e.amount > best.amount
          ? { amount: e.amount, origin: e.origin.label }
          : best,
      undefined,
    ),
    cues: effectsOf(effects, 'cue').map((e) => ({
      tone: e.tone,
      text: e.text,
      origin: e.origin.label,
    })),
    effectsNotCounted,
    languages: [...new Set(effectsOf(effects, 'language').map((e) => e.name))],
    armorProfs: uniqueNames(effectsOf(effects, 'armorProf').map((e) => e.name)),
    weaponProfs,
    toolProfs: uniqueNames(effectsOf(effects, 'toolProf').map((e) => e.name)),
    attacks,
    spellcasting,
    actions,
    resources,
    features: col.features,
    // A half caster's first level has a spellcasting block with no slots in it.
    grantedSpells: dedupeGrantedSpells(
      effects,
      spellcasting.some((sc) => sc.pactSlots !== undefined || sc.slots.some((n) => n > 0)),
    ),
    warnings: dedupeWarnings(col.warnings),
    classDataMissing: doc.classes.some(
      (c) => ctx.get('class', c.ref.name, c.ref.source) === undefined,
    ),
    pending: col.pending,
    resolvedChoices: col.resolved,
  };
}

/** Dice and advantage for rolls, each under its source and, from an effect in play, its id. */
function rollRiders(effects: readonly EffectInput[]): RollRider[] {
  const out: RollRider[] = [];
  for (const e of effects) {
    if (e.kind !== 'rollDie' && e.kind !== 'rollOffer' && e.kind !== 'rollAdvantage') continue;
    const from = {
      on: e.on,
      origin: e.origin.label,
      ...(inPlay(e) ? { effectId: e.origin.uid } : {}),
    };
    if (e.kind === 'rollDie') out.push({ ...from, kind: 'die', dice: e.dice });
    else if (e.kind === 'rollOffer')
      out.push({
        ...from,
        kind: 'offer',
        dice: e.dice,
        ...(e.once !== undefined ? { once: e.once } : {}),
        ...(e.ifFailed !== undefined ? { ifFailed: e.ifFailed } : {}),
      });
    else out.push({ ...from, kind: 'advantage', mode: e.mode });
  }
  return out;
}

/**
 * Proficiency names once each, the first spelling kept: a race's pick keeps the
 * data's "smith's tools" while a subclass grants "Smith's Tools".
 */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Collapse repeated collector notes while preserving the first useful wording. */
function dedupeWarnings(warnings: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const warning of warnings) {
    const clean = warning.replace(/\s+/g, ' ').trim();
    const key = clean.toLocaleLowerCase().replace(/[.!]+$/, '');
    if (clean === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** How much mechanical detail an action effect carries (for dedupe). */
function richness(e: {
  roll?: string;
  note?: string;
  save?: { dcAbility?: unknown };
  cost?: unknown;
  buyBack?: unknown;
}): number {
  // A save with its DC says more than one without, by less than any other mechanic.
  return (
    (e.roll !== undefined ? 1 : 0) +
    (e.note !== undefined ? 2 : 0) +
    (e.save?.dcAbility ? 2.5 : e.save ? 2 : 0) +
    (e.cost !== undefined ? 2 : 0) +
    (e.buyBack !== undefined ? 2 : 0)
  );
}

function dedupeGrantedSpells(
  effects: readonly EffectInput[],
  hasSlots: boolean,
): DerivedSheet['grantedSpells'] {
  const seen = new Set<string>();
  const out: DerivedSheet['grantedSpells'] = [];
  for (const e of effectsOf(effects, 'grantSpell')) {
    if (e.slotsOnly === true && !hasSlots) continue;
    // Two sources granting the same spell collapse to one row, unless each
    // brought its own pool of uses: a wand's 3/day fireball beside a race's
    // 1/day is two rows, or one of the two pools would have nothing to spend it.
    const key = `${e.spell.name}|${e.spell.source}|${e.resourceKey ?? ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: e.spell.name,
      source: e.spell.source,
      ability: e.ability,
      usage: e.usage,
      resourceKey: e.resourceKey,
      origin: e.origin.label,
    });
  }
  return out;
}

/** Just the unresolved choices (wizard/level-up drive off this). */
export function pendingChoices(doc: CharacterDoc, ctx: EngineContext): ChoicePrompt[] {
  return deriveSheet(doc, ctx).pending;
}
