/**
 * FIX-001's residual check. `collectAdditionalSpells` treats entries of an
 * `additionalSpells` block that carry distinct `name`s as mutually exclusive
 * branches, and asks the player to pick one. That is right when the content
 * really is a choice and wrong when it means "you get all of these". This
 * finds every block the heuristic acts on, so each one is either explained by
 * its own wording or listed, with a verdict, in the audit budget.
 *
 * Relative imports only: `scripts/data-audit.ts` loads this under plain Bun.
 */
import type { Entity } from '../copyMod';
import { ENTITY_TYPES, type EntityType } from '../normalize';

export interface BranchBlock {
  /** `name|source`, lowercased, as the registry keys it. */
  uid: string;
  /** The entity type that carries the block, e.g. `race` or `subclass`. */
  key: string;
  /** The distinct branch names, in file order. */
  names: string[];
  /** Whether the entity's own `entries` say it is a choice. */
  choiceWording: boolean;
}

/** Words that, in an entity's own prose, mark its spell options as a choice. */
export const CHOICE_WORDING = /\b(choose|choice|one of|select|pick|either)\b/i;

/** Anything a registry can list by type. */
export interface ByType {
  byType(type: EntityType): readonly Entity[];
}

function textIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const child of value) textIn(child, out);
  else if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) textIn(child, out);
  }
  return out;
}

/**
 * The distinct non-empty string `name`s in a block, by the same rule as
 * `collectAdditionalSpells`: an entry whose name is missing or empty always
 * applies, so it is not a branch.
 */
export function branchNames(additionalSpells: unknown): string[] {
  if (!Array.isArray(additionalSpells)) return [];
  const names: string[] = [];
  for (const entry of additionalSpells) {
    if (entry === null || typeof entry !== 'object') continue;
    const name = (entry as Entity).name;
    if (typeof name !== 'string' || name === '' || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Every entity, across every type in the normalized registry, whose
 * `additionalSpells` has two or more branch names. Running over the registry
 * rather than raw files means `_copy` and `_versions` results are checked as
 * the app sees them.
 */
export function findBranchBlocks(registry: ByType): BranchBlock[] {
  const out: BranchBlock[] = [];
  const seen = new Set<string>();
  for (const key of ENTITY_TYPES) {
    for (const entity of registry.byType(key)) {
      const names = branchNames(entity.additionalSpells);
      if (names.length < 2) continue;
      const uid = `${String(entity.name)}|${String(entity.source)}`.toLowerCase();
      const id = `${key}:${uid}:${names.join('|')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        uid,
        key,
        names,
        choiceWording: CHOICE_WORDING.test(textIn(entity.entries).join(' ')),
      });
    }
  }
  return out;
}
