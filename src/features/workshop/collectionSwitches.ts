/**
 * Where a collection is on for a character, as its pickers decide, and the
 * switches that make it what a tap on its page asks (ADR-002 D3; E2, E4).
 *
 * Read source by source, through the pickers' own reading (`pickPolicy`), so
 * the page cannot say one thing while the pickers do another:
 * - a character's `off` wins, then its `on`, then its own list of books, or
 *   else the device's choice of what shows, each code compared exactly, as
 *   `pickPolicy` compares them;
 * - a file switched off on this device comes back for a character whose `on`
 *   names a source it declares (E4's view, which ignores case);
 * - Changes to the books stand in the books' place, so no choice of books
 *   hides them: only their own switch does (E4 again, without case);
 * - a row that declares no source has nothing a choice or a switch can name,
 *   so it is on wherever its own switch is.
 */
import {
  characterSourceSwitches,
  pickPolicy,
  policyAllows,
  type SourcePolicy,
} from '@/data5e/sourceFilter';
import type { HomebrewFileMeta } from '@/db/homebrewRepo';
import type { CharacterDoc } from '@/engine/types';

/** Whose pickers: a character, or the device (no list or switch of its own). */
export interface Picker {
  allowedSources?: unknown;
  sourceSwitches?: unknown;
}

const lower = (s: string) => s.toLowerCase();
const named = (list: readonly string[], s: string) => list.some((x) => lower(x) === lower(s));

export const isChanges = (r: HomebrewFileMeta) => r.role === 'changes';

/** Whether `who` picks from source `s` of row `r`. */
export function reachesSource(
  who: Picker,
  r: HomebrewFileMeta,
  s: string,
  device: SourcePolicy,
): boolean {
  const { on, off } = characterSourceSwitches(who.sourceSwitches);
  if (isChanges(r) && named(off, s)) return false;
  if (!r.enabled && !r.sourceIds.some((x) => named(on, x))) return false;
  if (isChanges(r)) return true;
  return policyAllows(pickPolicy(device, who.allowedSources, who.sourceSwitches).policy, s);
}

/** Whether `who` picks from any of a row's sources. */
export const reachesRow = (who: Picker, r: HomebrewFileMeta, device: SourcePolicy): boolean =>
  r.sourceIds.length === 0 ? r.enabled : r.sourceIds.some((s) => reachesSource(who, r, s, device));

/** On for this device: what a character without a list or a switch of its own picks from. */
export const deviceOn = (r: HomebrewFileMeta, device: SourcePolicy): boolean =>
  reachesRow({}, r, device);

/**
 * A character's switches with this collection's sources set so that, after
 * the tap, it picks from every source of the rows this device uses (`true`),
 * from none (`false`), or as the device does (`'device'`). A source it would
 * pick from anyway gets no switch, so a later change on the device still
 * reaches it, and the character's switches for other sources stay as they
 * were. With no row in use here, on reaches the newest copy, or every book.
 * `undefined` is no switches at all.
 *
 * Copies share their sources, so a switch that names one names them all: on
 * for a character whose list leaves the source out also brings in a copy
 * switched off here (`reachesSource` says so, and the page shows it).
 */
export function switchedTo(
  who: Picker,
  rows: readonly HomebrewFileMeta[],
  device: SourcePolicy,
  on: boolean | 'device',
): CharacterDoc['sourceSwitches'] {
  const ours = rows.flatMap((r) => r.sourceIds);
  const now = characterSourceSwitches(who.sourceSwitches);
  const keep = (list: readonly string[]) => list.filter((s) => !named(ours, s));
  const next = { on: keep(now.on), off: keep(now.off) };
  const as: Picker = { allowedSources: who.allowedSources, sourceSwitches: next };
  if (on === true) {
    const used = rows.filter((r) => deviceOn(r, device));
    const newest = rows[0]?.book === undefined ? rows.slice(0, 1) : rows;
    for (const r of used.length > 0 ? used : newest) {
      for (const s of r.sourceIds) if (!reachesSource(as, r, s, device)) next.on.push(s);
    }
  } else if (on === false) {
    for (const r of rows) {
      for (const s of r.sourceIds) if (reachesSource(as, r, s, device)) next.off.push(s);
    }
  }
  const out = {
    ...(next.on.length > 0 ? { on: next.on } : {}),
    ...(next.off.length > 0 ? { off: next.off } : {}),
  };
  return out.on === undefined && out.off === undefined ? undefined : out;
}
