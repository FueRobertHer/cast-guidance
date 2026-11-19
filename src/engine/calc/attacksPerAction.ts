import type { FeatureCard } from '../types';

/** Named features that give a fixed attack count, keyed by lowercased name. */
const NAMED_ATTACKS: ReadonlyMap<string, number> = new Map([
  ['two extra attacks', 3],
  ['three extra attacks', 4],
  ['extra attack improvement', 3],
  ['thirsting blade', 2],
  ['devouring blade', 3],
]);

/**
 * The attacks one feature name gives on an Attack action, or 0 when the name
 * grants none. "Extra Attack (n)" gives n + 1 (2014 Fighter's "(2)" and "(3)"),
 * and any other parenthetical, or none, gives 2.
 */
function attacksForName(name: string): number {
  const key = name.trim().toLowerCase();
  if (key === 'extra attack') return 2;
  const numbered = /^extra attack \((\d+)\)$/.exec(key);
  if (numbered) return Number(numbered[1]) + 1;
  if (/^extra attack \(.*\)$/.test(key)) return 2;
  return NAMED_ATTACKS.get(key) ?? 0;
}

/**
 * How many attacks one Attack action gives, from the character's feature names:
 * the most any one gives, since Extra Attack never stacks. Races hold their
 * traits as named sub-entries, so those nested inside `entries` and `items`
 * count too. 1 with none.
 */
export function attacksPerAction(features: readonly FeatureCard[]): number {
  let best = 1;

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const o = node as { name?: unknown; entries?: unknown; items?: unknown };
      if (typeof o.name === 'string') best = Math.max(best, attacksForName(o.name));
      walk(o.entries);
      walk(o.items);
    }
  };

  for (const f of features) {
    best = Math.max(best, attacksForName(f.name));
    walk(f.entries);
  }
  return best;
}
