/**
 * The rule sets the app ships (`src/rules/`, format in `docs/rule-sets.md`).
 * Each file is a dynamic `import()`, so the build gives it a lazy chunk of its
 * own (`assets/rule-set-*.js`, with a budget line of its own): out of the entry
 * chunk, precached by the service worker like any other chunk, so it works
 * offline. Bun scripts and tests load the same files the same way.
 *
 * The registry holds them (`EntityRegistry.setRuleSets`), so every engine
 * context made from it (`engineContextFor`) hands them to the seam.
 */
// Relative, not `@/`: Bun scripts run this module without the app's path alias.
import type { Entity } from './copyMod';
import type { EntityRegistry } from './normalize';

/** Every built-in rule set file, in the order their rows apply: a later file's row wins. */
const FILES: ReadonlyArray<() => Promise<{ default: unknown }>> = [
  () => import('../rules/cast-guidance/curated.json'),
];

export interface BuiltInRules {
  sets: readonly Entity[];
  /** A file could not be loaded: no set counts, and every sheet says so. */
  failed: boolean;
}

let loading: Promise<BuiltInRules> | undefined;

/**
 * The built-in rule sets, loaded once. A failed load is tried again on the next
 * call, though a browser may keep the failed chunk until the page reloads, which
 * is what the sheet's warning asks for.
 */
export function loadBuiltInRules(): Promise<BuiltInRules> {
  loading ??= Promise.all(FILES.map((load) => load())).then(
    (modules): BuiltInRules => ({
      sets: modules.map((m) => m.default as Entity),
      failed: false,
    }),
    (err: unknown): BuiltInRules => {
      loading = undefined;
      console.warn('The built-in rules did not load:', err);
      return { sets: [], failed: true };
    },
  );
  return loading;
}

/** Give a registry the built-in rule sets, so its engine contexts read them. */
export function attachBuiltInRules(registry: EntityRegistry, rules: BuiltInRules): void {
  registry.setRuleSets(rules.sets, rules.failed);
}

/**
 * The built-in rule sets, for a script whose numbers mean nothing without them
 * (the audit, the judge): it throws when they did not load.
 */
export async function requireBuiltInRules(): Promise<readonly Entity[]> {
  const rules = await loadBuiltInRules();
  if (rules.failed) throw new Error('The built-in rules did not load (see the warning above).');
  return rules.sets;
}

/** Load the built-in rule sets and give them to a registry: for scripts and tests. */
export async function withBuiltInRules(registry: EntityRegistry): Promise<EntityRegistry> {
  attachBuiltInRules(registry, await loadBuiltInRules());
  return registry;
}
