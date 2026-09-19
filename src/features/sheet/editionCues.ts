import type { Entity } from '@/data5e/copyMod';
import {
  addToPreview,
  type EditionFit,
  type EditionSwitchPreview,
  editionFit,
  editionFitNote,
  emptySwitchPreview,
} from '@/data5e/editionCompat';
import type { EntityType } from '@/data5e/normalize';
import type { EditionRef, RulesVersion } from '@/data5e/rulesVersion';
import type { CharacterDoc, EntityRef } from '@/engine/types';

/** Which of a character's identity picks a cue belongs to, for placing it. */
export type EditionSlot = 'race' | 'subrace' | 'background' | 'class' | 'subclass';

export interface EditionCue {
  slot: EditionSlot;
  /** Stable key for the pick, so a chip finds its own cue: "class:fighter|phb". */
  key: string;
  /** What to call it in a note, e.g. "Fighter" or "Elf's High Elf". */
  label: string;
  fit: EditionFit;
}

/** Looks an entity up by type, as the registry does. Injected so this stays testable. */
export type EntityLookup = (type: EntityType, ref: EntityRef) => Entity | undefined;

export const cueKey = (slot: EditionSlot, ref: EntityRef): string =>
  `${slot}:${ref.name}|${ref.source}`.toLowerCase();

/**
 * Classify every identity pick a character holds against its rules version
 * (GAME-003). Picker filtering only decides what can be chosen next; a
 * character can already hold content from the other edition after a version
 * switch, an import, or a data-tag change, and until now nothing on the sheet
 * said so, though the Build page's own legend promised warnings.
 *
 * Feats and spells are deliberately left out: those come through `doc.choices`
 * and the spell lists, which carry their own source badges, and folding them in
 * here would put a dozen cues on the Identity section of a high-level character.
 */
export function editionCues(
  doc: CharacterDoc,
  version: RulesVersion,
  lookup: EntityLookup,
): EditionCue[] {
  const cues: EditionCue[] = [];
  const add = (slot: EditionSlot, type: EntityType, ref: EntityRef, label: string) => {
    const entity = lookup(type, ref);
    // A pick whose entity is missing is already reported by the engine as "not
    // found"; guessing at its edition from the source alone would add a second,
    // vaguer note about the same broken reference.
    if (entity === undefined) return;
    const fit = editionFit(
      entity,
      version,
      (target: EditionRef) => lookup(type, target) !== undefined,
    );
    cues.push({ slot, key: cueKey(slot, ref), label, fit });
  };

  if (doc.race !== undefined) add('race', 'race', doc.race, doc.race.name);
  if (doc.subrace !== undefined) add('subrace', 'subrace', doc.subrace, doc.subrace.name);
  if (doc.background !== undefined) {
    add('background', 'background', doc.background, doc.background.name);
  }
  for (const entry of doc.classes) {
    add('class', 'class', entry.ref, entry.ref.name);
    if (entry.subclass !== undefined) {
      add('subclass', 'subclass', entry.subclass, `${entry.ref.name}'s ${entry.subclass.name}`);
    }
  }
  return cues;
}

/** Every cue worth showing, as sentences. A matching pick yields nothing. */
export function editionCueNotes(cues: readonly EditionCue[], version: RulesVersion): string[] {
  const notes: string[] = [];
  for (const cue of cues) {
    const note = editionFitNote(cue.label, cue.fit, version);
    if (note !== undefined) notes.push(note);
  }
  return notes;
}

/**
 * What switching to `target` would do to the character as it stands, so the
 * switch can be previewed rather than discovered. Classifying against the
 * target version is the whole trick: the same picks are re-read as if the
 * change had already happened.
 */
export function editionSwitchPreview(
  doc: CharacterDoc,
  target: RulesVersion,
  lookup: EntityLookup,
): EditionSwitchPreview {
  const preview = emptySwitchPreview();
  for (const cue of editionCues(doc, target, lookup)) {
    addToPreview(preview, cue.label, cue.fit);
  }
  return preview;
}
