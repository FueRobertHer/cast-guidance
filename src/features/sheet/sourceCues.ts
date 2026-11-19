import { characterSourceList, characterSourceSwitches } from '@/data5e/sourceFilter';
import { canonicalSource } from '@/data5e/sourceNames';
import { addedSpellsOf } from '@/engine/effects/addedSpells';
import type { CharacterDoc, DerivedSheet, EntityRef } from '@/engine/types';

export interface OutOfPolicyPick {
  /** Stable React key: slot plus `name|source`, lowercased. */
  key: string;
  /** What the pick is, e.g. "Twilight Domain". */
  label: string;
  /** The book it came from, spelled the way the dataset spells it. */
  source: string;
}

/**
 * Everything already on the character that comes from a book outside its own
 * sources: species, background, classes and subclasses, feats (taken
 * directly or through a choice), optional features, gear and spells. Its own
 * sources are its list, with its switches over it: a source switched off is
 * outside them, one switched on is inside, and with no list every source that
 * is not switched off is inside (the device's settings are not its own).
 *
 * Read-only on purpose. A character's list and switches narrow what it picks
 * from next; they never take back a pick, so this only finds them for the
 * Build page to name. Matching ignores case, because choice ids are stored
 * lowercased while refs keep the dataset's spelling. No list and no switch
 * off restricts nothing, so it returns nothing.
 */
export function outOfPolicyPicks(
  doc: CharacterDoc,
  resolvedChoices: DerivedSheet['resolvedChoices'],
): OutOfPolicyPick[] {
  const lower = (list: readonly string[]) => new Set(list.map((s) => s.toLowerCase()));
  const listed = lower(characterSourceList(doc.allowedSources));
  const switches = characterSourceSwitches(doc.sourceSwitches);
  const on = lower(switches.on);
  const off = lower(switches.off);
  if (listed.size === 0 && off.size === 0) return [];
  const inside = (source: string) => {
    const s = source.toLowerCase();
    if (off.has(s)) return false;
    return on.has(s) || listed.size === 0 || listed.has(s);
  };

  const out = new Map<string, OutOfPolicyPick>();
  const add = (slot: string, name: string, source: string) => {
    if (source === '' || inside(source)) return;
    const key = `${slot}:${name}|${source}`.toLowerCase();
    if (!out.has(key)) out.set(key, { key, label: name, source: canonicalSource(source) });
  };
  const addRef = (slot: string, ref: EntityRef | undefined) => {
    if (ref !== undefined) add(slot, ref.name, ref.source);
  };

  addRef('race', doc.race);
  addRef('subrace', doc.subrace);
  addRef('background', doc.background);
  for (const c of doc.classes) {
    addRef('class', c.ref);
    addRef('subclass', c.subclass);
  }
  for (const f of doc.feats) addRef('feat', f.ref);

  // Feat and optional-feature picks are stored as `name|source` ids. The
  // option label carries the name as the dataset spells it ("Telekinetic
  // (TCE)"), so prefer that over the lowercased id.
  for (const { prompt, selected } of resolvedChoices) {
    if (prompt.kind !== 'feat' && prompt.kind !== 'optionalfeature') continue;
    for (const id of selected) {
      const [name, source] = id.split('|');
      if (name === undefined || source === undefined) continue;
      const label = prompt.options.find((o) => o.id === id)?.label ?? name;
      const suffix = ` (${source})`;
      const shown = label.toLowerCase().endsWith(suffix.toLowerCase())
        ? label.slice(0, -suffix.length)
        : label;
      add('feat', shown, source);
    }
  }

  for (const e of doc.equipment) addRef('item', e.ref);
  for (const sc of Object.values(doc.spellcasting)) {
    for (const ref of [...sc.known, ...sc.prepared]) addRef('spell', ref);
  }
  for (const a of addedSpellsOf(doc)) addRef('spell', a.spell);
  return [...out.values()];
}
