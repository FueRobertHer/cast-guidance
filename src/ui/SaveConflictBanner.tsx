import { announce } from '@/stores/announcer';
import {
  type CharacterSessionState,
  characterSessionStore,
  type SaveConflict,
  useCharacterSession,
} from '@/stores/characterSession';
import { notifyFailure } from '@/stores/notices';

/** What a screen reader hears once a conflict is resolved, by what was chosen. */
export const CONFLICT_RESOLVED_TEXT = {
  reload: 'Stored version loaded',
  discard: 'Your edits were discarded',
  overwrite: 'Your version saved',
} as const;

/** The banner's words for one refused save. */
export function conflictText({ kind, name }: SaveConflict, affected: number): string {
  const who = name.trim() || 'This character';
  const what =
    kind === 'deleted'
      ? `${who} was deleted in another tab. Your edits here have not been saved.`
      : `${who} was changed in another tab. Your edits here have not been saved. Both versions stay in History.`;
  return affected > 1 ? `${what} (${affected} characters affected)` : what;
}

/**
 * Where focus goes once the banner, and the button that had it, are gone: the
 * sheet's heading, or the page's own focusable heading when no sheet is open.
 */
function focusHeading(): void {
  requestAnimationFrame(() => {
    const heading =
      document.getElementById('sheet-title') ?? document.querySelector<HTMLElement>('h1[tabindex]');
    heading?.focus({ preventScroll: true });
  });
}

/**
 * A save this tab was refused because another tab changed or deleted the
 * character first (REL-007, #98), and the two ways out of it. Nothing is lost
 * either way: Reload puts this tab's edits in History, and Keep mine saves
 * them over the stored copy, which the other tab's save already put there.
 * Reload is the main action, since Keep mine replaces changes the person has
 * not seen.
 *
 * Announced the way the save-error banner is (A11Y-002): `role="alert"`,
 * inserted with its text, which stays the same for as long as the conflict
 * lasts, so it is said once and not again. Focus stays where it is when it
 * appears, since the person may be mid-edit; edits made meanwhile are kept,
 * just not saved. The outcome is said once through the announcer, because the
 * banner that could say it is what goes away, and focus moves to the heading
 * for the same reason.
 */
export function SaveConflictBanner({
  resolve = (id, choice) => characterSessionStore.getState().resolveConflict(id, choice),
}: {
  resolve?: CharacterSessionState['resolveConflict'];
}) {
  const conflicts = useCharacterSession((state) => state.saveConflicts);
  const entries = Object.entries(conflicts);
  const [first] = entries;
  if (first === undefined) return null;
  const [id, conflict] = first;
  const deleted = conflict.kind === 'deleted';

  const choose = (choice: 'reload' | 'overwrite') => {
    void resolve(id, choice).then(
      (resolved) => {
        if (!resolved) return;
        const said = choice === 'overwrite' ? 'overwrite' : deleted ? 'discard' : 'reload';
        announce(CONFLICT_RESOLVED_TEXT[said], { key: 'save-conflict', repeat: true });
        focusHeading();
      },
      (error: unknown) => notifyFailure(choice === 'overwrite' ? 'Keep mine' : 'Reload', error),
    );
  };

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-accent-deep px-3 py-1.5 text-xs"
      role="alert"
    >
      <p className="min-w-0">{conflictText(conflict, entries.length)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => choose('reload')}
          className="min-h-11 shrink-0 rounded bg-accent-fill px-3 font-semibold"
        >
          {deleted ? 'Discard my edits' : 'Reload stored version'}
        </button>
        <button
          type="button"
          onClick={() => choose('overwrite')}
          className="min-h-11 shrink-0 rounded border border-accent px-3 font-semibold"
        >
          {deleted ? 'Keep mine (restore it)' : 'Keep mine (overwrite)'}
        </button>
      </div>
    </div>
  );
}
