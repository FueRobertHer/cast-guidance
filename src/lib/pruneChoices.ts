import type { CharacterDoc, EntityRef } from '@/engine/types';
import { refUid } from '@/engine/types';

/**
 * Drop choices whose ids belong to an origin the character no longer has.
 * Choice ids are namespaced `<originType>:<name|source>:…`, so swapping a
 * race/background/subrace leaves orphaned picks behind unless we sweep them.
 */
export function pruneChoicesFor(doc: CharacterDoc, originType: string, ref: EntityRef): void {
  const prefix = `${originType}:${refUid(ref)}`;
  for (const key of Object.keys(doc.choices)) {
    if (key.startsWith(prefix)) delete doc.choices[key];
  }
}
