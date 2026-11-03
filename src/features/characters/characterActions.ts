import { characterRepo } from '@/db/characterRepo';
import { homebrewRepo } from '@/db/homebrewRepo';
import type { CharacterDoc } from '@/engine/types';
import { downloadJson } from '@/lib/download';
import { CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { characterSessionStore } from '@/stores/characterSession';
import { askConfirm } from '@/ui/dialogs';

/**
 * What you can do to a whole character from both the roster's row actions and
 * the sheet header's overflow menu, kept here so the two say and do the same.
 */

export async function exportCharacter(doc: CharacterDoc): Promise<void> {
  // Embed only the homebrew this character depends on, as a minimal public DTO
  // (no local-only fields). That keeps exports self-contained without shipping all
  // of the user's unrelated homebrew. Loaded on use, as the import preview
  // shares it: a static import would split it into a chunk of its own that
  // the entry chunk has to list for this page.
  const [{ homebrewForExport }, enabled] = await Promise.all([
    import('./homebrewExport'),
    homebrewRepo.enabledSafe(),
  ]);
  const homebrew = homebrewForExport(doc, enabled.files);
  const payload = { $format: CHARACTER_EXPORT_FORMAT, character: doc, homebrew };
  downloadJson(doc.name.replaceAll(/[^\w-]+/g, '_') || 'character', payload);
}

/** Asks before a delete, which cannot be undone. Resolves true on Delete. */
export function confirmDeleteCharacter(name: string): Promise<boolean> {
  return askConfirm({
    title: `Delete ${name}?`,
    detail: 'This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
}

/**
 * Deletes a character and its history. The session lets go of it first, so an
 * edit still waiting to save (or a failed save kept for Retry) is not written
 * after the row has gone, which would raise "deleted in another tab".
 */
export async function deleteCharacter(id: string): Promise<void> {
  await characterSessionStore.getState().forget(id);
  await characterRepo.delete(id);
}
