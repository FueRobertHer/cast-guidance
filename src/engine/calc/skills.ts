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
import { effectsOf, withOverride } from './core';

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

export function calcSkills(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): DerivedSheet['skills'] {
  const skillProfs = new Map<string, { level: ProfLevel; label: string }>();
  for (const e of effectsOf(effects, 'skillProf')) {
    const key = e.skill.toLowerCase();
    const existing = skillProfs.get(key);
    if (existing === undefined || e.level > existing.level) {
      skillProfs.set(key, { level: e.level, label: e.origin.label });
    }
  }

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
    const base = parts.reduce((s, p) => s + p.amount, 0);
    const total = withOverride(
      { value: base, base, overridden: false, parts },
      doc.overrides[`skill.${name}.bonus`],
    );
    out[name] = { total, prof, profBase, ability };
  }
  return out;
}

export function calcPassivePerception(
  doc: CharacterDoc,
  skills: DerivedSheet['skills'],
): DerivedValue {
  const perception = skills.Perception;
  const parts = [
    { label: 'Base', amount: 10 },
    { label: 'Perception', amount: perception?.total.value ?? 0 },
  ];
  const base = parts.reduce((s, p) => s + p.amount, 0);
  return withOverride(
    { value: base, base, overridden: false, parts },
    doc.overrides.passivePerception,
  );
}
