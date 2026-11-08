import type { Ability, BonusAmount, DerivedAbility, DerivedValue, EffectInput } from '../types';

/** Build a DerivedValue from labeled parts. */
export function dv(parts: Array<{ label: string; amount: number }>): DerivedValue {
  const value = parts.reduce((sum, p) => sum + p.amount, 0);
  return { value, base: value, overridden: false, parts };
}

/** Apply an override: keeps parts for the breakdown, marks the value. */
export function withOverride(v: DerivedValue, override?: { value: number }): DerivedValue {
  if (override === undefined) return v;
  return { ...v, value: override.value, overridden: true };
}

/**
 * Add parts after any override: an effect in play is not part of the build an
 * override corrects, so a hand-set AC still takes Shield of Faith's +2.
 */
export function onTop(
  v: DerivedValue,
  parts: ReadonlyArray<{ label: string; amount: number }>,
): DerivedValue {
  if (parts.length === 0) return v;
  const sum = parts.reduce((s, p) => s + p.amount, 0);
  return { ...v, value: v.value + sum, base: v.base + sum, parts: [...v.parts, ...parts] };
}

/**
 * Raise a value to a floor with a part of its own, so its parts still sum to
 * the computed number the breakdown shows.
 */
export function atLeast(v: DerivedValue, min: number, label: string): DerivedValue {
  return v.value >= min ? v : onTop(v, [{ label, amount: min - v.value }]);
}

/** An effect from something in play (Bless, Rage) rather than from the build. */
export function inPlay(e: EffectInput): boolean {
  return e.origin.type === 'active';
}

/** Resolve a {@link BonusAmount} against the final ability modifiers and proficiency bonus. */
export function bonusAmount(
  amount: BonusAmount,
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): number {
  if (typeof amount === 'number') return amount;
  if (amount === 'profBonus' || amount === 'equalToProfBonus') return profBonus;
  const [form, ability] = amount.split(':') as [string, Ability];
  const mod = abilities[ability].mod;
  if (form === 'abilityModMin1') return Math.max(1, mod);
  return form === 'abilityModMin0' ? Math.max(0, mod) : mod;
}

export function effectsOf<K extends EffectInput['kind']>(
  effects: readonly EffectInput[],
  kind: K,
): Array<Extract<EffectInput, { kind: K }>> {
  return effects.filter((e): e is Extract<EffectInput, { kind: K }> => e.kind === kind);
}
