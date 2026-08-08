/**
 * Which books the player wants to pick from.
 *
 * This is a browsing preference and nothing more. It narrows the lists a player
 * chooses *from*; it never touches the registry, so a character already built
 * on a since-hidden book still derives exactly as it did. Hiding a book cannot
 * break a sheet.
 *
 * Two shapes, because the two ways people use this pull in opposite
 * directions:
 *
 * - `all` is "everything except these". It is the default, and it is what
 *   individual toggles produce. A book added later (a data-tag bump, a freshly
 *   imported homebrew file) shows up on its own rather than silently going
 *   missing because it wasn't on a list written months ago.
 * - `only` is "just these". It is what the presets produce, and it is the only
 *   shape that can honestly mean "core rules only": a block list would have to
 *   name every book that exists, including the ones this device hasn't
 *   downloaded yet, and would quietly spring a leak the first time one arrived.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import type { SearchSourceFilter } from './search/protocol';
import { knownSources, type SourceGroup, sourceGroup } from './sourceNames';

export type SourcePolicy =
  | { mode: 'all'; except: readonly string[] }
  | { mode: 'only'; sources: readonly string[] };

/** The default: nothing hidden. */
export const ALLOW_ALL: SourcePolicy = { mode: 'all', except: [] };

export function policyAllows(policy: SourcePolicy, source: string): boolean {
  return policy.mode === 'all' ? !policy.except.includes(source) : policy.sources.includes(source);
}

/** True when the policy hides anything, i.e. when it is worth mentioning in the UI. */
export function isPolicyNarrowed(policy: SourcePolicy): boolean {
  return policy.mode === 'only' || policy.except.length > 0;
}

/** Flip one source, staying in whichever shape the policy is already in. */
export function withSource(policy: SourcePolicy, source: string, enabled: boolean): SourcePolicy {
  if (policy.mode === 'all') {
    const except = new Set(policy.except);
    if (enabled) except.delete(source);
    else except.add(source);
    return { mode: 'all', except: [...except].sort() };
  }
  const sources = new Set(policy.sources);
  if (enabled) sources.add(source);
  else sources.delete(source);
  return { mode: 'only', sources: [...sources].sort() };
}

/** Every source in the shipped table belonging to one of the given groups. */
export function sourcesInGroups(groups: readonly SourceGroup[]): string[] {
  return knownSources()
    .filter((s) => groups.includes(sourceGroup(s)))
    .sort();
}

export const SOURCE_PRESETS: ReadonlyArray<{
  id: string;
  label: string;
  detail: string;
  policy: () => SourcePolicy;
}> = [
  {
    id: 'all',
    label: 'Everything',
    detail: 'Every book, plus any homebrew you import.',
    policy: () => ALLOW_ALL,
  },
  {
    id: 'core-2024',
    label: '2024 core only',
    detail: "The 2024 Player's Handbook, Dungeon Master's Guide, and Monster Manual.",
    policy: () => ({ mode: 'only', sources: ['XDMG', 'XMM', 'XPHB'] }),
  },
  {
    id: 'core-2014',
    label: '2014 core only',
    detail: "The 2014 Player's Handbook, Dungeon Master's Guide, and Monster Manual.",
    policy: () => ({ mode: 'only', sources: ['DMG', 'MM', 'PHB'] }),
  },
  {
    id: 'core-plus',
    label: 'Core + supplements',
    detail: 'Both core sets and the rules expansions, without setting or adventure content.',
    policy: () => ({ mode: 'only', sources: sourcesInGroups(['core', 'supplement']) }),
  },
];

// ---------------------------------------------------------------------------
// Persistence

const KEY = 'sourcePolicy';

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/** Coerce whatever is in storage into a usable policy; anything odd means "allow all". */
export function parsePolicy(value: unknown): SourcePolicy {
  if (value === null || typeof value !== 'object') return ALLOW_ALL;
  const o = value as Record<string, unknown>;
  // An 'only' policy with no usable list would hide the entire app. A stored
  // value that malformed is corruption, never an intent, so it reads as the
  // default rather than as "hide everything".
  if (o.mode === 'only') {
    if (!Array.isArray(o.sources)) return ALLOW_ALL;
    return { mode: 'only', sources: stringList(o.sources) };
  }
  if (o.mode === 'all') return { mode: 'all', except: stringList(o.except) };
  return ALLOW_ALL;
}

export async function readSourcePolicy(): Promise<SourcePolicy> {
  return parsePolicy((await db.settings.get(KEY))?.value);
}

export async function writeSourcePolicy(policy: SourcePolicy): Promise<void> {
  await db.settings.put({ key: KEY, value: policy });
}

/**
 * Read-modify-write in one transaction. Toggling from a value captured at
 * render time loses updates: two quick taps both start from the same policy and
 * the second write drops the first one's change.
 */
export async function updateSourcePolicy(
  edit: (current: SourcePolicy) => SourcePolicy,
): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    await writeSourcePolicy(edit(await readSourcePolicy()));
  });
}

/**
 * Live policy. Reads as "allow all" until the first query resolves, so lists
 * render complete on mount and narrow a frame later rather than the reverse:
 * an item appearing is a much cheaper surprise than one vanishing mid-tap.
 */
export function useSourcePolicy(): SourcePolicy {
  return useLiveQuery(() => readSourcePolicy(), []) ?? ALLOW_ALL;
}

// ---------------------------------------------------------------------------
// Applying it

/**
 * Drop entities from hidden sources, with an escape hatch for entries that must
 * survive regardless: a character already holding a pick has to keep seeing it,
 * or the picker would look like it lost the choice.
 */
export function applySourcePolicy<T>(
  entities: readonly T[],
  policy: SourcePolicy,
  sourceOf: (e: T) => string,
  keep?: (e: T) => boolean,
): T[] {
  if (!isPolicyNarrowed(policy)) return [...entities];
  return entities.filter((e) => policyAllows(policy, sourceOf(e)) || keep?.(e) === true);
}

/**
 * Force sources visible without widening anything else. Called when homebrew
 * arrives: under a preset (an allow list) a newly imported file would otherwise
 * be invisible everywhere with nothing to explain why, and under a block list a
 * re-import would come back still hidden from a previous removal.
 */
export async function ensureSourcesVisible(sources: readonly string[]): Promise<void> {
  if (sources.length === 0) return;
  await updateSourcePolicy((current) =>
    sources.reduce((policy, source) => withSource(policy, source, true), current),
  );
}

/**
 * Plain-data form for the search worker, which filters before it truncates.
 * Restated rather than passed straight through so the worker bundle never
 * imports this module (and with it Dexie). `undefined` means "no filtering",
 * which lets the worker skip the work entirely.
 */
export function policyForSearch(policy: SourcePolicy): SearchSourceFilter | undefined {
  if (!isPolicyNarrowed(policy)) return undefined;
  return policy.mode === 'all'
    ? { mode: 'all', except: [...policy.except] }
    : { mode: 'only', sources: [...policy.sources] };
}
