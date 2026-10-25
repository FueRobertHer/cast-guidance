import { VALID_BODIES } from '../../tests-fixtures/dataMirror.ts';

/** The name of generated spell `n` (from 1): "Spell 001", which sorts as it counts. */
export function spellName(n: number): string {
  return `Spell ${String(n).padStart(3, '0')}`;
}

/**
 * The suite's release with its PHB spells replaced by `n` generated ones,
 * "Spell 001" to `spellName(n)`, for the specs about a long library list.
 * Pass it to `mirror.setBodies` as `() => manySpells(n)`.
 */
export function manySpells(n: number): Readonly<Record<string, unknown>> {
  const spell = Array.from({ length: n }, (_, i) => ({
    name: spellName(i + 1),
    source: 'PHB',
    level: i % 10,
  }));
  return { ...VALID_BODIES, 'spells/spells-phb.json': { spell } };
}
