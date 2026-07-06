import type { DerivedValue, EffectInput } from '../types';

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

export function effectsOf<K extends EffectInput['kind']>(
  effects: readonly EffectInput[],
  kind: K,
): Array<Extract<EffectInput, { kind: K }>> {
  return effects.filter((e): e is Extract<EffectInput, { kind: K }> => e.kind === kind);
}
