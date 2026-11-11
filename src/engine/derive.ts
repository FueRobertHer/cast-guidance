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
import { calcResources, costOnSheet, slotsAndDice } from './calc/resources';
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
import { CAST_GUIDANCE_LIMITS, EARLY_KINDS } from './castGuidance';
import { homebrewConditionsInForce } from './conditions';
import { collectAddedSpells } from './effects/addedSpells';
import { settleInheritedAbilities } from './effects/additionalSpells';
import { collectBackground } from './effects/background';
import { Collector } from './effects/base';
import { collectClasses } from './effects/class';
import { collectFeats } from './effects/feat';
import { markHeldPicks } from './effects/heldPicks';
import { collectItems, isArmor, isShield, lookupItem } from './effects/item';
import { subjectsWithMoments } from './effects/mechanics';
import { collectRace } from './effects/race';
import { noteSkillSources } from './effects/skillSources';
import { Formula } from './formula';
import { collectMoments, momentsInForce } from './moments';
import { sheetRulesField } from './rules';
import type {
  Ability,
  ActiveEffect,
  BonusAmount,
  CharacterDoc,
  ChoicePrompt,
  DerivedSheet,
  EffectInput,
  EngineContext,
  FormulaScope,
  FormulaSlot,
  NotCounted,
  RollRider,
  SpellDamageBonus,
} from './types';
import { ABILITIES, refUid } from './types';

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
  collectAddedSpells(col);
  for (const custom of doc.customEffects) col.add(custom);
  // Picks that read the whole build, now that it is in.
  for (const ask of col.afterAll) ask();
  // Only now is every skill grant known, including ones collected after the
  // pick they overlap.
  noteSkillSources(col);
  markHeldPicks(col);
  settleInheritedAbilities(col);
  // Effects in play come last: they reach numbers and rolls, never a pick.
  let effectsNotCounted: NotCounted[] = [];
  let played: ActiveEffect[] = [];
  if (options.active !== false) {
    const read = readActiveEffects(doc.play.activeEffects);
    played = read.effects;
    const problems = read.problems;
    for (const problem of problems) col.warn(problem);
    // A homebrew condition in force counts as an effect in play does (H5),
    // unless an immunity collected so far, or one in play, holds it off.
    const early = new PlayStates(doc, ctx, played);
    const brew = homebrewConditionsInForce(doc.play.conditions, ctx, doc.rulesVersion, () =>
      effectsOf(
        [...col.effects.filter((e) => early.hold(e, undefined)), ...countingEffects(played).inputs],
        'conditionImmune',
      ).map((e) => ({ condition: e.condition, origin: e.origin.label })),
    );
    for (const problem of brew.problems) col.warn(problem);
    const counting = countingEffects([...played, ...brew.effects]);
    for (const e of counting.inputs) col.add(e);
    effectsNotCounted = counting.notCounted;
  }

  const collected = col.effects;

  // 2. Fold in fixed order. The proficiency bonus needs only the level, so it
  // comes first: formulas read it.
  const totalLevel = doc.classes.reduce((sum, c) => sum + c.levels, 0);
  const pbBase = totalLevel > 0 ? 2 + Math.floor((totalLevel - 1) / 4) : 2;
  const profBonus = withOverride(
    dv([{ label: `Level ${totalLevel}`, amount: pbBase }]),
    doc.overrides.profBonus,
  );

  // Formulas fill their numbers stage by stage, as what they read becomes known
  // (each kind reads only names known by its stage), and effects held `while` a
  // state count only while it holds (H10). Bloodied needs the hit point maximum,
  // which the kinds folded before it never hold while.
  const scope: FormulaScope = {
    level: totalLevel,
    classLevel: totalLevel,
    prof: profBonus.value,
    hp: 0,
    maxHp: 0,
    mod: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    score: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  };
  const budget = { left: CAST_GUIDANCE_LIMITS.formulaStepsPerDerive, warned: false };
  const states = new PlayStates(doc, ctx, played);
  fillFormulas(col, (k) => k === 'abilityBonus' || k === 'abilityMin', scope, budget);
  const early = collected.filter((e) => states.hold(e, undefined));
  const abilities = calcAbilities(doc, early);
  for (const a of ABILITIES) {
    scope.mod[a] = abilities[a].mod;
    scope.score[a] = abilities[a].value;
  }
  fillFormulas(col, (k) => k === 'hpPerLevel' || k === 'maxHpBonus', scope, budget);
  const { maxHp, hitDice } = calcMaxHp(doc, col, early, abilities.con.mod);
  scope.maxHp = maxHp.value;
  scope.hp = doc.play.hpInitialized === false ? maxHp.value : doc.play.currentHp;
  fillFormulas(col, (k) => !EARLY_KINDS.has(k), scope, budget);
  const effects = collected.filter((e) => states.hold(e, scope));
  // What reads the collector from here on (spellcasting) sees only these too.
  if (effects.length !== col.effects.length) col.effects.splice(0, col.effects.length, ...effects);

  const saves = calcSaves(doc, effects, abilities, profBonus.value);
  const checks = calcChecks(effects, abilities, profBonus.value);
  const skills = calcSkills(doc, effects, abilities, profBonus.value, fromBackground);
  const passivePerception = calcPassivePerception(doc, skills, effects);
  const speedWalk = calcWalkSpeed(doc, col, effects);
  const {
    ac,
    label: acFormulaLabel,
    notCounted: acNotCounted,
    heavyArmor,
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
  // A maneuver's DC takes Strength or Dexterity, the player's choice: the higher.
  const saveDc = (from: Ability | 'strOrDex' | 'spell' | undefined) =>
    from === 'spell'
      ? spellcasting[1]
        ? undefined
        : spellcasting[0]?.saveDc.value
      : from === 'strOrDex'
        ? 8 + Math.max(abilities.str.mod, abilities.dex.mod) + profBonus.value
        : from && 8 + abilities[from].mod + profBonus.value;
  const pays = slotsAndDice(spellcasting, hitDice);
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
    cost: costOnSheet(e.cost, resources, pays),
    buyBack: costOnSheet(e.buyBack, resources, pays),
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

  // Moments (H9): the entries' own and the packs applied to this character.
  const readMoments = collectMoments(subjectsWithMoments(col), ctx, doc.id);
  for (const problem of readMoments.problems) col.warn(problem);
  const moments = momentsInForce(
    readMoments,
    { abilities, profBonus, totalLevel, maxHp, resources },
    scope.hp,
  );

  // Table rules (H2): on the sheet only when one differs from as written.
  const tableRules = sheetRulesField(doc, ctx);
  for (const problem of tableRules.problems) col.warn(problem);

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
    ...(heavyArmor === undefined ? {} : { heavyArmor }),
    initiative,
    speedWalk,
    speedMultiplier: calcSpeedMultiplier(effects),
    otherSpeeds: calcOtherSpeeds(effects, speedWalk.value),
    maxHp,
    hitDice,
    totalLevel,
    classLabel,
    senses: longestSenses(effectsOf(effects, 'sense')),
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
    rollRiders: rollRiders(effects, (a) => bonusAmount(a, abilities, profBonus.value)),
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
    spellDamageBonuses: sameNamedOnce(
      effectsOf(effects, 'spellDamageBonus').map((e) => ({
        amount: bonusAmount(e.amount, abilities, profBonus.value),
        origin: e.origin.label,
        ...(e.spells === undefined ? {} : { spells: e.spells }),
        ...(e.className === undefined ? {} : { className: e.className }),
        ...(e.cantrips === true ? { cantrips: true as const } : {}),
        ...(e.school === undefined ? {} : { school: e.school }),
        ...(e.oneRoll === true ? { oneRoll: true as const } : {}),
      })),
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
    ...(moments === undefined ? {} : { moments }),
    ...(tableRules.rules === undefined ? {} : { rules: tableRules.rules }),
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
      doc.classes,
    ),
    warnings: dedupeWarnings(col.warnings),
    classDataMissing: doc.classes.some(
      (c) => ctx.get('class', c.ref.name, c.ref.source) === undefined,
    ),
    classVariantCount: col.classVariants.size,
    pending: col.pending,
    resolvedChoices: col.resolved,
  };
}

/**
 * Fill the numbers formulas give the effects of the kinds `stage` takes, in
 * place: each effect with formulas is a fresh copy made for this derive
 * (`mechanicsOf`). Past the per-derive budget, a formula counts as 0.
 */
function fillFormulas(
  col: Collector,
  stage: (kind: EffectInput['kind']) => boolean,
  scope: FormulaScope,
  budget: { left: number; warned: boolean },
): void {
  for (const e of col.effects) {
    // Only `formula.ts` makes a Formula; a slot read from a stored document never counts.
    if (!Array.isArray(e.formulas) || !stage(e.kind)) continue;
    for (const slot of e.formulas as readonly unknown[]) {
      if (typeof slot !== 'object' || slot === null) continue;
      if (!((slot as Partial<FormulaSlot>).formula instanceof Formula)) continue;
      const { field, formula, classLevel } = slot as FormulaSlot;
      let value = 0;
      if (budget.left >= formula.cost) {
        budget.left -= formula.cost;
        value = formula.evaluate({ ...scope, classLevel });
      } else if (!budget.warned) {
        budget.warned = true;
        col.warn('This character has too many formulas to work out; the rest count as 0.');
      }
      // Only an amount may be below zero: a penalty. A range, a speed or a maximum may not.
      (e as Record<string, unknown>)[field] = field === 'amount' ? value : Math.max(0, value);
    }
  }
}

/**
 * The states effects may hold `while` (H10), read from play once per derive.
 * `effect` reads the effects in play as `readActiveEffects` read them (none
 * when the derive leaves them out); the rest are the character's state
 * whatever is in play.
 */
class PlayStates {
  private readonly doc: CharacterDoc;
  private readonly ctx: EngineContext;
  private readonly played: readonly ActiveEffect[];
  private seen?: {
    conditions: Set<string>;
    effects: Set<string>;
    armor: boolean;
    shield: boolean;
  };

  constructor(doc: CharacterDoc, ctx: EngineContext, played: readonly ActiveEffect[]) {
    this.doc = doc;
    this.ctx = ctx;
    this.played = played;
  }

  /** Whether every state `e` holds while holds; `hp` is unknown before the maximum is. */
  hold(e: EffectInput, hp: { hp: number; maxHp: number } | undefined): boolean {
    if (!Array.isArray(e.while)) return true;
    return (e.while as readonly unknown[]).every((w) => this.holds(w, e.kind, hp));
  }

  private holds(
    w: unknown,
    kind: EffectInput['kind'],
    hp: { hp: number; maxHp: number } | undefined,
  ): boolean {
    if (typeof w !== 'object' || w === null) return false;
    const state = w as Partial<Record<'state' | 'name' | 'condition', unknown>>;
    const play = this.doc.play;
    switch (state.state) {
      case 'bloodied':
        return hp !== undefined && !EARLY_KINDS.has(kind) && hp.maxHp > 0 && hp.hp <= hp.maxHp / 2;
      case 'zeroHp':
        return play.hpInitialized !== false && play.currentHp <= 0;
      case 'concentrating':
        return play.concentratingOn !== undefined && play.concentratingOn !== null;
      case 'noArmor':
        return !this.read().armor;
      case 'shield':
        return this.read().shield;
      case 'effect':
        return typeof state.name === 'string' && this.read().effects.has(state.name.toLowerCase());
      case 'condition':
        return (
          typeof state.condition === 'string' &&
          this.read().conditions.has(state.condition.toLowerCase())
        );
      default:
        return false;
    }
  }

  private read(): NonNullable<PlayStates['seen']> {
    if (this.seen !== undefined) return this.seen;
    const play = this.doc.play;
    const worn = this.doc.equipment.flatMap((entry) => {
      if (!entry.equipped || entry.ref === undefined) return [];
      const item = lookupItem({ ctx: this.ctx }, entry.ref.name, entry.ref.source);
      return item === undefined ? [] : [item];
    });
    // Stored play is not checked on load: read only what is the shape it should be.
    const conditions: unknown[] = Array.isArray(play.conditions) ? play.conditions : [];
    this.seen = {
      conditions: new Set(
        conditions.flatMap((c) => {
          const { id, ignored } = (typeof c === 'object' && c !== null ? c : {}) as {
            id?: unknown;
            ignored?: unknown;
          };
          return typeof id === 'string' && ignored !== true ? [id.toLowerCase()] : [];
        }),
      ),
      effects: new Set(
        this.played
          .filter((x) => x.off !== true)
          .flatMap((x) => [x.name, x.same ?? x.name].map((n) => n.toLowerCase())),
      ),
      armor: worn.some(isArmor),
      shield: worn.some(isShield),
    };
    return this.seen;
  }
}

/** The fields that are set, so an optional field is left out rather than undefined. */
function definedOnly<T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/**
 * Dice and advantage for rolls, each under its source and, from an effect in
 * play, its id. A paid extra's bonus is worked out here (`amount`).
 */
function rollRiders(
  effects: readonly EffectInput[],
  amount: (a: BonusAmount) => number,
): RollRider[] {
  const out: RollRider[] = [];
  for (const e of effects) {
    if (
      e.kind !== 'rollDie' &&
      e.kind !== 'rollOffer' &&
      e.kind !== 'rollAdvantage' &&
      e.kind !== 'rollPaid'
    )
      continue;
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
    else if (e.kind === 'rollPaid') {
      const { dice, poolDie, bonus, advantage, after, ifFailed, spentOnSuccess, reaction, when } =
        e;
      out.push({
        ...from,
        kind: 'paid',
        ...definedOnly({
          dice,
          poolDie,
          advantage,
          after,
          ifFailed,
          spentOnSuccess,
          reaction,
          when,
        }),
        ...(bonus !== undefined ? { bonus: amount(bonus) } : {}),
      });
    } else
      out.push({
        ...from,
        kind: 'advantage',
        mode: e.mode,
        ...(e.when !== undefined ? { when: e.when } : {}),
      });
  }
  return out;
}

/**
 * One line a sense: the longest range any source gives it, from that source. A
 * race's darkvision 60 and a feature's 120 read as darkvision 120.
 */
function longestSenses(
  effects: ReadonlyArray<{ sense: string; range: number; origin: { label: string } }>,
): Array<{ sense: string; range: number; origin: string }> {
  const best = new Map<string, { sense: string; range: number; origin: string }>();
  for (const e of effects) {
    const key = e.sense.toLowerCase();
    const had = best.get(key);
    if (had === undefined || e.range > had.range) {
      best.set(key, { sense: e.sense, range: e.range, origin: e.origin.label });
    }
  }
  return [...best.values()];
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

/**
 * One of each spell damage bonus a same-named feature gives, the highest: a 2024
 * Cleric with a 2014 domain can have Potent Spellcasting from Blessed Strikes and
 * from the domain, and the same feature does not add twice.
 */
function sameNamedOnce(bonuses: readonly SpellDamageBonus[]): SpellDamageBonus[] {
  const best = new Map<string, SpellDamageBonus>();
  for (const b of bonuses) {
    const { amount, ...rest } = b;
    const key = JSON.stringify(rest);
    const held = best.get(key);
    if (held === undefined || amount > held.amount) best.set(key, b);
  }
  return [...best.values()];
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
  classes: CharacterDoc['classes'],
): DerivedSheet['grantedSpells'] {
  // A class's and its subclass's grants are that class's spells.
  const classOf = new Map<string, string>();
  for (const c of classes) {
    classOf.set(`class:${refUid(c.ref)}`, c.ref.name);
    if (c.subclass !== undefined) classOf.set(`subclass:${refUid(c.subclass)}`, c.ref.name);
  }
  const seen = new Set<string>();
  const out: DerivedSheet['grantedSpells'] = [];
  for (const e of effectsOf(effects, 'grantSpell')) {
    if (e.slotsOnly === true && !hasSlots) continue;
    // Two sources granting the same spell collapse to one row, unless each
    // brought its own pool of uses: a wand's 3/day fireball beside a race's
    // 1/day is two rows, or one of the two pools would have nothing to spend it.
    // A spell the player added keeps its own row too, where it can be taken off.
    const added = e.origin.type === 'added';
    const key =
      `${e.spell.name}|${e.spell.source}|${e.resourceKey ?? ''}|${added ? 'added' : ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: e.spell.name,
      source: e.spell.source,
      ability: e.ability,
      usage: e.usage,
      resourceKey: e.resourceKey,
      origin: e.origin.label,
      className: classOf.get(`${e.origin.type}:${e.origin.uid}`),
      ...(added ? { added: true as const } : {}),
    });
  }
  return out;
}

/** Just the unresolved choices (wizard/level-up drive off this). */
export function pendingChoices(doc: CharacterDoc, ctx: EngineContext): ChoicePrompt[] {
  return deriveSheet(doc, ctx).pending;
}
