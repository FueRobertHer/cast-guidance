import { useRef, useState } from 'react';
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

/** What a screen reader hears when Keep mine is refused in turn: another tab saved meanwhile. */
export const KEEP_REFUSED_TEXT =
  'Your version was not saved: the character changed again in another tab.';

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
 *
 * While a choice is under way the banner stays as it is, though the session
 * clears the conflict to try Keep mine: if that is refused again, the same
 * alert stays put rather than going and coming back, focus stays on the
 * button pressed, and the refusal is said once through the announcer.
 */
export function SaveConflictBanner({
  resolve = (id, choice) => characterSessionStore.getState().resolveConflict(id, choice),
}: {
  resolve?: CharacterSessionState['resolveConflict'];
}) {
  const conflicts = useCharacterSession((state) => state.saveConflicts);
  const banner = useRef<HTMLDivElement>(null);
  /** The conflict a choice is under way for, shown until the choice settles. */
  const [choosing, setChoosing] = useState<{ id: string; conflict: SaveConflict } | null>(null);
  /** Set from the tap itself, so a second tap in the same render does nothing. */
  const busy = useRef(false);
  const entries = Object.entries(conflicts);
  const shown = entries[0] ?? (choosing === null ? undefined : [choosing.id, choosing.conflict]);
  if (shown === undefined) return null;
  const [id, conflict] = shown;
  const deleted = conflict.kind === 'deleted';

  /** After a choice settles, however it went. */
  const settle = (
    choice: 'reload' | 'overwrite',
    outcome: ConflictOutcome | undefined,
    failed: boolean,
  ) => {
    busy.current = false;
    setChoosing(null);
    const remaining = characterSessionStore.getState().saveConflicts;
    if (Object.keys(remaining).length > 0) {
      // Keep mine refused in turn: the same alert is still up, so it would
      // say nothing new. A failure has its own notice, and a conflict that
      // turned into another (deleted meanwhile) changes the alert's words.
      if (!failed && choice === 'overwrite' && remaining[id]?.kind === conflict.kind) {
        announce(KEEP_REFUSED_TEXT, { key: 'save-conflict', repeat: true });
      }
      // A conflict still needs an answer (this one again, or the next):
      // focus stays with its buttons, and moves only if it was lost.
      requestAnimationFrame(() => {
        const here = banner.current;
        if (here !== null && !here.contains(document.activeElement)) {
          here.querySelector('button')?.focus();
        }
      });
      return;
    }
    if (outcome !== undefined) {
      announce(CONFLICT_RESOLVED_TEXT[outcome], { key: 'save-conflict', repeat: true });
    }
    focusHeading();
  };

  const choose = (choice: 'reload' | 'overwrite') => {
    // A second tap while the first is under way does nothing.
    if (busy.current) return;
    busy.current = true;
    setChoosing({ id, conflict });
    void resolve(id, choice).then(
      (outcome) => settle(choice, outcome, false),
      (error: unknown) => {
        notifyFailure(choice === 'overwrite' ? 'Keep mine' : 'Reload', error);
        settle(choice, undefined, true);
      },
    );
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
