import { useRef } from 'react';
import { announce } from '@/stores/announcer';
import {
  type CharacterSessionState,
  type ConflictOutcome,
  characterSessionStore,
  type SaveConflict,
  useCharacterSession,
} from '@/stores/characterSession';
import { notifyFailure } from '@/stores/notices';

/** What a screen reader hears once a conflict is resolved, by what came of it. */
export const CONFLICT_RESOLVED_TEXT: Readonly<Record<ConflictOutcome, string>> = {
  reloaded: 'Stored version loaded',
  discarded: 'Your edits were discarded',
  kept: 'Your version saved',
};

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
 * either way: Reload puts this tab's edits in History, and Keep mine puts the
 * stored copy there (unless it already is) before saving over it.
 * Reload is the main action, since Keep mine replaces changes the person has
 * not seen.
 *
 * Announced the way the save-error banner is (A11Y-002): `role="alert"`,
 * inserted with its text, which stays the same for as long as the conflict
 * lasts, so it is said once and not again. Focus stays where it is when it
 * appears, since the person may be mid-edit; edits made meanwhile are kept,
 * just not saved. The outcome is said once through the announcer, because the
 * banner that could say it is what goes away, and focus moves to the heading
 * for the same reason, whenever the banner goes, whatever came of the choice.
 * While another refused save still waits, nothing is said over its alert and
 * focus stays on the banner, which now asks about that one.
 */
export function SaveConflictBanner({
  resolve = (id, choice) => characterSessionStore.getState().resolveConflict(id, choice),
}: {
  resolve?: CharacterSessionState['resolveConflict'];
}) {
  const conflicts = useCharacterSession((state) => state.saveConflicts);
  const banner = useRef<HTMLDivElement>(null);
  const entries = Object.entries(conflicts);
  const [first] = entries;
  if (first === undefined) return null;
  const [id, conflict] = first;
  const deleted = conflict.kind === 'deleted';

  /** After a choice settles, however it went. */
  const settle = (outcome: ConflictOutcome | undefined) => {
    if (Object.keys(characterSessionStore.getState().saveConflicts).length > 0) {
      // A conflict still needs an answer (this one again, or the next): its
      // alert is what is said, and focus stays with its buttons.
      requestAnimationFrame(() => banner.current?.querySelector('button')?.focus());
      return;
    }
    if (outcome !== undefined) {
      announce(CONFLICT_RESOLVED_TEXT[outcome], { key: 'save-conflict', repeat: true });
    }
    focusHeading();
  };

  const choose = (choice: 'reload' | 'overwrite') => {
    void resolve(id, choice).then(settle, (error: unknown) => {
      notifyFailure(choice === 'overwrite' ? 'Keep mine' : 'Reload', error);
      settle(undefined);
    });
  };

  return (
    // Keyed by character, so the next refused save is a new alert, said anew.
    <div
      key={id}
      ref={banner}
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
