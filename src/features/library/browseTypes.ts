/**
 * The library's browsable sections, in the order the home grid lists them.
 *
 * Its own module because both the library pages and the per-book index read
 * it, and a book's index is "these sections, scoped to one source".
 */
import type { EntityType } from '@/data5e/normalize';

export const BROWSE_TYPES: ReadonlyArray<{ type: EntityType; label: string }> = [
  { type: 'class', label: 'Classes' },
  { type: 'subclass', label: 'Subclasses' },
  { type: 'race', label: 'Species / Races' },
  { type: 'background', label: 'Backgrounds' },
  { type: 'feat', label: 'Feats' },
  { type: 'spell', label: 'Spells' },
  { type: 'item', label: 'Items' },
  { type: 'baseitem', label: 'Basic equipment' },
  { type: 'optionalfeature', label: 'Optional features' },
  { type: 'condition', label: 'Conditions' },
  { type: 'action', label: 'Actions' },
  { type: 'skill', label: 'Skills' },
  { type: 'language', label: 'Languages' },
  { type: 'sense', label: 'Senses' },
  { type: 'variantrule', label: 'Rules' },
  { type: 'disease', label: 'Diseases' },
  { type: 'book', label: 'Books' },
];

export const TYPE_LABELS: ReadonlyMap<string, string> = new Map(
  BROWSE_TYPES.map((t) => [t.type as string, t.label]),
);
