/**
 * Each character's own view of the shared registry (ADR-002, D3, question 1).
 *
 * The shared registry keeps both versions of a changed entry (E3): the one
 * below every change and the one in its place. A character's view gives it the
 * version its own collection switches pick:
 *
 * - The player's Changes to the books, unless the character switches that
 *   collection off (its `off` names the collection's source, `MyChanges`).
 * - A rule pack's changes, for the characters its Apply to reaches, as the
 *   engine applies the pack's patches. A pack's switch is its Apply to.
 * - A collection switched off on this device, when the character's `on`
 *   names a source it declares: its switch goes over the device's.
 *
 * A character the shared registry already suits gets the shared registry
 * itself, so most sheets build nothing and every memo keyed on the registry
 * still hits. A view is built once per pick and kept with the registry it was
 * built from, so characters picking alike share one.
 */
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '@/engine/castGuidance';
import { withReplaceBudget } from './copyMod';
import {
  type ChangedEntry,
  type ChangeLayer,
  EntityRegistry,
  type EntityType,
  mergeHomebrew,
  stackChanges,
} from './normalize';
import type { PackLocal } from './rulePack';
import { characterSourceSwitches } from './sourceNames';

/** What a view is picked by: the character, for a pack's Apply to, and its switches. */
export interface ViewCharacter {
  id: string;
  sourceSwitches?: unknown;
}

/** A stored file switched off on this device, which a character's `on` can bring back. */
export interface DeviceOffFile {
  id: string;
  json: Record<string, unknown>;
  pack?: PackLocal;
  role?: 'changes';
}

const OFF_FILES = new WeakMap<EntityRegistry, readonly DeviceOffFile[]>();
/** The views built from each shared registry, by pick. */
const VIEWS = new WeakMap<EntityRegistry, Map<string, EntityRegistry>>();
/** Each view's shared registry, so a view of a view is the same view. */
const SHARED = new WeakMap<EntityRegistry, EntityRegistry>();

/** Called by the registry's build: the files switched off on this device, kept beside it. */
export function setDeviceOffFiles(registry: EntityRegistry, files: readonly DeviceOffFile[]): void {
  OFF_FILES.set(registry, files);
}

const lower = (s: string) => s.toLowerCase();

/** The sources a file declares (`_meta.sources[].json`), which its collection switch names. */
function declared(json: Record<string, unknown>): string[] {
  const meta = json._meta as { sources?: unknown } | undefined;
  const sources = Array.isArray(meta?.sources) ? meta.sources : [];
  return sources.flatMap((s) => (typeof s?.json === 'string' ? [lower(s.json)] : []));
}

/** Whether a change reaches this character. */
function reaches(layer: ChangeLayer, id: string, off: ReadonlySet<string>): boolean {
  if (layer.from.kind === 'changes') return !off.has(lower(layer.from.source));
  const to = layer.from.reach;
  return (
    to !== undefined &&
    (to.appDefault === true || (Array.isArray(to.characters) && to.characters.includes(id)))
  );
}

/** Whether these are the layers the shared registry placed. */
const sameAsShared = (record: ChangedEntry, picked: readonly ChangeLayer[]): boolean =>
  picked.length === record.layers.filter((l) => l.shared).length && picked.every((l) => l.shared);

/**
 * The registry as this character sees it: `registry` itself when its switches
 * pick what the shared registry holds, or when no character is given.
 */
export function registryViewFor(
  registry: EntityRegistry,
  character: ViewCharacter | undefined,
): EntityRegistry {
  if (character === undefined) return registry;
  const shared = SHARED.get(registry) ?? registry;
  const switches = characterSourceSwitches(character.sourceSwitches);
  const off = new Set(switches.off.map(lower));
  const on = new Set(switches.on.map(lower));
  const records = shared.changedEntries();
  const picks = records.map((r) => r.layers.filter((l) => reaches(l, character.id, off)));
  const extras = (OFF_FILES.get(shared) ?? []).filter((f) =>
    declared(f.json).some((s) => on.has(s)),
  );
  if (extras.length === 0 && records.every((r, i) => sameAsShared(r, picks[i] ?? [])))
    return shared;
  const key = [
    ...records.map((r, i) => r.layers.map((l) => (picks[i]?.includes(l) ? 1 : 0)).join('')),
    ...extras.map((f) => f.id),
  ].join(',');
  let views = VIEWS.get(shared);
  if (views === undefined) VIEWS.set(shared, (views = new Map()));
  let view = views.get(key);
  if (view === undefined) {
    view = buildView(shared, records, picks, extras);
    views.set(key, view);
    SHARED.set(view, shared);
  }
  return view;
}

/**
 * A registry holding what `shared` holds, through its own public surface, with
 * each changed entry stacked from the layers picked for it, then the device-off
 * files merged on top. A record with no layer picked leaves its base in place
 * and unrecorded, so the character's sheet shows no change there.
 */
function buildView(
  shared: EntityRegistry,
  records: readonly ChangedEntry[],
  picks: readonly (readonly ChangeLayer[])[],
  extras: readonly DeviceOffFile[],
): EntityRegistry {
  const view = new EntityRegistry();
  const base = new Map(records.map((r) => [r.placed, r.base]));
  const lists = (Object.keys(shared.counts()) as EntityType[]).map(
    (t) => [t, shared.byType(t).map((e) => base.get(e) ?? e), shared.officialCount(t)] as const,
  );
  // Official first and sealed, so `officialCount` reads as the shared one does.
  for (const [t, list, official] of lists) view.addAll(t, list.slice(0, official));
  view.sealOfficial();
  for (const [t, list, official] of lists) {
    if (list.length > official) view.addAll(t, list.slice(official));
  }
  for (const w of shared.warnings) view.warnings.push(w);
  view.rulesBooks = shared.rulesBooks;
  view.setRulePacks(shared.byType(RULE_PACK_TYPE));
  view.setRuleSets(shared.byType(RULE_SET_TYPE), shared.ruleSetsFailed);
  withReplaceBudget(() => {
    records.forEach((r, i) => {
      const layers = picks[i] ?? [];
      if (layers.length === 0) return;
      const placed = sameAsShared(r, layers)
        ? r.placed
        : stackChanges(
            r.type,
            r.base,
            layers.map((l) => l.entry),
            view.warnings,
          );
      view.placeChange({ ...r, layers, placed });
    });
  });
  if (extras.length > 0) {
    const packs = view.byType(RULE_PACK_TYPE);
    mergeHomebrew(
      view,
      // A copy each time: the merge resolves an entry's copy in place.
      new Map(extras.map((f) => [f.id, structuredClone(f.json)])),
      new Map(extras.flatMap((f) => (f.pack === undefined ? [] : [[f.id, f.pack] as const]))),
      new Set(extras.filter((f) => f.role === 'changes').map((f) => f.id)),
    );
    // The merge lists the packs of the files it was given; the device's come first.
    view.setRulePacks([...packs, ...view.byType(RULE_PACK_TYPE)]);
  }
  return view;
}
