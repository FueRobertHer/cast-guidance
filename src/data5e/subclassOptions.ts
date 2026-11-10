import type { Entity } from './copyMod';
import { filterByRulesVersion, type RulesVersion } from './rulesVersion';

interface Ref {
  name: string;
  source: string;
}

/**
 * The subclasses a picker offers for one class: that class's subclasses,
 * deduped for the rules version, with the character's current pick kept
 * whatever its edition (GAME-009). A class copied in the Workshop (`copied`,
 * its `castGuidance.basedOn`) also offers its original's: their features name
 * that class, and the sheet finds a subclass by its own name and book.
 *
 * 5etools copies each legacy subclass onto the 2024 class (classSource XPHB),
 * and the copy keeps the original's `reprintedAs` through `_preserve`, so the
 * declared link covers both rows once its four-segment uid is read as a
 * subclass uid. Nothing is hidden on inference: a legacy subclass with no 2024
 * printing stays on the 2024 list, where it is a valid carry-over.
 */
export function subclassOptions(
  all: readonly Entity[],
  classRef: Ref,
  version: RulesVersion,
  held?: Ref,
  copied?: Ref,
): Entity[] {
  const of = (r: Ref) => (s: Entity) =>
    String(s.className).toLowerCase() === r.name.toLowerCase() &&
    String(s.classSource).toLowerCase() === r.source.toLowerCase();
  const own = of(classRef);
  const original = copied === undefined ? () => false : of(copied);
  const list = all.filter((s) => own(s) || original(s));
  // Within one class's list, name|source is unique, so it names the pick.
  const heldUid = held === undefined ? undefined : `${held.name}|${held.source}`.toLowerCase();
  return filterByRulesVersion(list, version, {
    holderType: 'subclass',
    keep: (e) =>
      heldUid !== undefined && `${String(e.name)}|${String(e.source)}`.toLowerCase() === heldUid,
  });
}
