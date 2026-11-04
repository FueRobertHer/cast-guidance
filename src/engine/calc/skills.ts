import { skillSources } from '../effects/skillSources';
import {
  ABILITIES,
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  type DerivedSheet,
  type DerivedValue,
  type EffectInput,
  type ProfLevel,
  SKILLS,
} from '../types';
import { bonusAmount, effectsOf, withOverride } from './core';

type Part = { label: string; amount: number };

/**
 * Half proficiency for a check of `ability` that adds no proficiency bonus of
 * its own, or undefined when nothing grants it there. `skill` says whether the
 * check uses a skill (the 2024 Jack of All Trades reaches only those). Two
 * sources never stack, since each reaches only a check without the bonus and
 * the first one adds half of it, so the larger wins: a Bard/Champion takes
 * Remarkable Athlete's rounding up.
 */
export function halfProfPart(
  effects: readonly EffectInput[],
  ability: Ability,
  profBonus: number,
  skill: boolean,
): Part | undefined {
  let best: Part | undefined;
  for (const e of effectsOf(effects, 'halfProf')) {
    if (e.skillsOnly === true && !skill) continue;
    if (e.abilities !== undefined && !e.abilities.includes(ability)) continue;
    const amount = e.round === 'up' ? Math.ceil(profBonus / 2) : Math.floor(profBonus / 2);
    if (best === undefined || amount > best.amount) best = { label: e.origin.label, amount };
  }
  return best;
}

/** Bonuses to a check of `ability`, using `skill` when there is one, each under its source. */
export function checkBonusParts(
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
  ability: Ability,
  skill?: string,
): Part[] {
  const out: Part[] = [];
  for (const e of effectsOf(effects, 'checkBonus')) {
    const reaches =
      'ability' in e
        ? e.ability === ability
        : skill !== undefined && e.skills.some((s) => s.toLowerCase() === skill.toLowerCase());
    if (reaches) {
      out.push({ label: e.origin.label, amount: bonusAmount(e.amount, abilities, profBonus) });
    }
  }
  return out;
}

export function calcSaves(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): DerivedSheet['saves'] {
  const profs = new Set(effectsOf(effects, 'saveProf').map((e) => e.ability));
  const out = {} as DerivedSheet['saves'];
  for (const a of ABILITIES) {
    const profOverride = doc.overrides[`save.${a}.prof`];
    const prof = profOverride !== undefined ? profOverride.value > 0 : profs.has(a);
    const parts = [{ label: `${a.toUpperCase()} modifier`, amount: abilities[a].mod }];
    if (prof) parts.push({ label: 'Proficiency', amount: profBonus });
    const value = parts.reduce((s, p) => s + p.amount, 0);
    out[a] = { total: { value, base: value, overridden: false, parts }, prof };
  }
  return out;
}

/** `fromBackground`: the effects the background step collected, feats included. */
export function calcSkills(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
  fromBackground: ReadonlySet<EffectInput> = new Set(),
): DerivedSheet['skills'] {
  const skillProfs = new Map<string, { level: ProfLevel; label: string }>();
  for (const e of effectsOf(effects, 'skillProf')) {
    const key = e.skill.toLowerCase();
    const existing = skillProfs.get(key);
    if (existing === undefined || e.level > existing.level) {
      skillProfs.set(key, { level: e.level, label: e.origin.label });
    }
  }
  const sources = skillSources(effects, { expertise: true });
  const besideBackground = skillSources(effects, { skip: (e) => fromBackground.has(e) });

  const out: DerivedSheet['skills'] = {};
  for (const { name, ability } of SKILLS) {
    const key = name.toLowerCase();
    const profBase: ProfLevel = skillProfs.get(key)?.level ?? 0;
    let prof: ProfLevel = profBase;
    const profOverride = doc.overrides[`skill.${name}.prof`];
    if (profOverride !== undefined)
      prof = Math.max(0, Math.min(2, profOverride.value)) as ProfLevel;

    const parts = [{ label: `${ability.toUpperCase()} modifier`, amount: abilities[ability].mod }];
    // Name the source when the build grants it, so the breakdown says why.
    const grantedBy = prof === profBase ? skillProfs.get(key)?.label : 'Set manually';
    if (prof === 1) parts.push({ label: grantedBy ?? 'Proficiency', amount: profBonus });
    if (prof === 2) {
      parts.push({
        label: grantedBy !== undefined ? `${grantedBy} (expertise)` : 'Expertise',
        amount: profBonus * 2,
      });
    }
    const half = prof === 0 ? halfProfPart(effects, ability, profBonus, true) : undefined;
    if (half !== undefined) parts.push(half);
    parts.push(...checkBonusParts(effects, abilities, profBonus, ability, name));
    const base = parts.reduce((s, p) => s + p.amount, 0);
    const total = withOverride(
      { value: base, base, overridden: false, parts },
      doc.overrides[`skill.${name}.bonus`],
    );
    out[name] = {
      total,
      prof,
      profBase,
      halfProf: half !== undefined,
      sources: sources.get(key) ?? [],
      sourcesBesideBackground: besideBackground.get(key) ?? [],
      ability,
    };
  }
  return out;
}

/** Plain ability checks: no skill, so no proficiency, but half proficiency can reach them. */
export function calcChecks(
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): DerivedSheet['checks'] {
  const out = {} as DerivedSheet['checks'];
  for (const a of ABILITIES) {
    const parts: Part[] = [{ label: `${a.toUpperCase()} modifier`, amount: abilities[a].mod }];
    const half = halfProfPart(effects, a, profBonus, false);
    if (half !== undefined) parts.push(half);
    parts.push(...checkBonusParts(effects, abilities, profBonus, a));
    const value = parts.reduce((s, p) => s + p.amount, 0);
    out[a] = {
      total: { value, base: value, overridden: false, parts },
      halfProf: half !== undefined,
    };
  }
  return out;
}

export function calcPassivePerception(
  doc: CharacterDoc,
  skills: DerivedSheet['skills'],
  effects: readonly EffectInput[],
): DerivedValue {
  const perception = skills.Perception;
  const parts = [
    { label: 'Base', amount: 10 },
    { label: 'Perception', amount: perception?.total.value ?? 0 },
  ];
  for (const e of effectsOf(effects, 'passivePerceptionBonus')) {
    parts.push({ label: e.origin.label, amount: e.amount });
  }
  const base = parts.reduce((s, p) => s + p.amount, 0);
  return withOverride(
    { value: base, base, overridden: false, parts },
    doc.overrides.passivePerception,
  );
}
