import { CircleCheck, CircleDashed } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router';
import { GAME_DATA_DOWNLOAD_SIZE } from '@/data5e/downloadSize';
import { type PersistState, usePersistentStorage } from '@/lib/persistentStorage';
import { showsDataBanner, useDataStatus } from '@/stores/dataStatus';
import { onboardingStore, useOnboarding } from '@/stores/onboarding';
import type { OfflineReadiness } from '@/stores/swStatus';
import { Button } from '@/ui/Button';
import { cardClass } from '@/ui/surfaces';
import { PERSIST_DENIED_TEXT, STORAGE_DETAILS_ID } from './Status';
import { type CompendiumState, type ShellStatus, useOfflineReadiness } from './useOfflineReadiness';

/** Where an item stands; `undefined` while its answer is still on the way. */
type Done = boolean | undefined;

/** One item's state and its one line of why. */
type Line = [done: Done, why: string | undefined];

function Item({
  title,
  done,
  why,
  whyRef,
  action,
  live = false,
}: {
  title: string;
  done: Done;
  why?: string;
  /** Where focus goes once the item's action has its answer. */
  whyRef?: (el: HTMLElement | null) => void;
  /** The one control that gets a to-do item done, as an outline button. */
  action?: ReactNode;
  /**
   * Announce changes politely, and atomically so the title is read with the
   * update and it says what it is about.
   */
  live?: boolean;
}) {
  return (
    <li
      className="flex gap-3 py-3 first:pt-0 last:pb-0"
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
    >
      {/* As tall as the title's first line, so the icon sits beside it at
          any text size. Held empty until the answer is in, so neither a
          dashed circle nor a check is a guess, and nothing shifts when it
          lands. */}
      <span aria-hidden="true" className="flex h-5.5 w-5 shrink-0 items-center">
        {done === true && <CircleCheck size={20} className="text-heal" />}
        {done === false && <CircleDashed size={20} className="text-ink-faint" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <h3 className="text-body-strong">{title}</h3>
        {done !== undefined && <span className="sr-only">{done ? 'Done' : 'To do'}</span>}
        {why !== undefined && (
          <p
            ref={whyRef}
            tabIndex={whyRef === undefined ? undefined : -1}
            className="text-caption text-ink-muted"
          >
            {why}
          </p>
        )}
        {done === false && action}
      </div>
    </li>
  );
}

/** The game data item: the phase only, since the count and the bar are the banner's job. */
function downloadLine(compendium: CompendiumState, bannerShowing: boolean): Line {
  switch (compendium) {
    case 'complete':
      return [true, 'Downloaded and kept on this device.'];
    case 'downloading':
      return [
        false,
        `A one-time download of about ${GAME_DATA_DOWNLOAD_SIZE}.${
          bannerShowing ? ' The bar at the top shows how far along it is.' : ''
        }`,
      ];
    case 'stopped':
      return [false, 'The download stopped. Use Retry at the top, or try again from Settings.'];
    default:
      return [undefined, `A one-time download of about ${GAME_DATA_DOWNLOAD_SIZE}.`];
  }
}

/**
 * The offline item, and whether a reload is what would finish it. A tab that
 * opened before the worker took over is not offline yet, whatever is cached:
 * a screen it has not opened would still need the network.
 */
function offlineLine(
  settled: boolean,
  shell: ShellStatus,
  compendium: CompendiumState,
  offline: OfflineReadiness,
): [...Line, reload: boolean] {
  if (!settled) return [undefined, undefined, false];
  if (offline === 'now') return [true, 'Open the app anywhere, no signal needed.', false];
  if (offline === 'next-launch') {
    return [
      false,
      'Ready next time you open the app. Reload now to use it offline in this tab.',
      true,
    ];
  }
  if (shell === 'unsupported') {
    return [
      false,
      'This browser needs a connection to open the app. Your saved data stays on the device either way.',
      false,
    ];
  }
  if (shell === 'error') {
    return [false, 'Offline support could not install. Reload the page to try again.', true];
  }
  if (shell === 'stalled') {
    return [
      false,
      'Offline support has not finished installing. Reload the page to try again.',
      true,
    ];
  }
  if (compendium === 'stopped') {
    return [false, 'The game data download stopped. Finish it to go offline.', false];
  }
  return [false, 'Keep the app open until the download finishes.', false];
}

function persistLine(state: PersistState): Line {
  switch (state) {
    case 'persisted':
      return [true, 'Your browser will keep your characters when space runs low.'];
    case 'best-effort':
      return [false, 'Ask the browser not to clear your characters when space runs low.'];
    case 'denied':
      return [false, PERSIST_DENIED_TEXT];
    case 'unsupported':
      return [false, 'This browser cannot be asked to keep your data.'];
    default:
      return [undefined, undefined];
  }
}

/**
 * Getting started on the roster, as a checklist (DS-001): the three things
 * that make the app safe to rely on at the table, each done or not, with the
 * one action that does it. The longer why (Safari's seven-day rule, backups)
 * is behind Storage details in Settings. Inline rather than a modal so it never
 * stands between someone and their first character, and so it can show live
 * state, which is the part a one-off intro cannot do.
 *
 * It never takes focus on its own; screen readers meet it in reading order.
 * `onDismiss` is where focus goes when the button that had it disappears.
 */
export function GettingStarted({ onDismiss }: { onDismiss?: () => void }) {
  const dismissed = useOnboarding((s) => s.dismissed);
  const { shell, compendium, offline, settled } = useOfflineReadiness();
  const bannerShowing = useDataStatus(showsDataBanner);
  const persist = usePersistentStorage();

  // On screen, so the offline notice leaves the news to this card.
  useEffect(() => (dismissed ? undefined : onboardingStore.getState().cardShown()), [dismissed]);

  if (dismissed) return null;

  const [downloaded, downloadWhy] = downloadLine(compendium, bannerShowing);
  const [offlineDone, offlineWhy, reload] = offlineLine(settled, shell, compendium, offline);
  const [kept, keptWhy] = persistLine(persist.state);
  const states = [downloaded, offlineDone, kept];
  // Counted once every item has answered, so a warm boot never says
  // "0 of 3" for the moment before it says "3 of 3".
  const count = states.every((s) => s !== undefined)
    ? states.filter((s) => s === true).length
    : undefined;

  return (
    <section
      aria-labelledby="getting-started-heading"
      className={`${cardClass} flex flex-col gap-3`}
    >
      {/* The heading says the state in words. */}
      <h2
        id="getting-started-heading"
        className="flex flex-wrap items-baseline justify-between gap-x-2 text-heading"
      >
        Ready for the table
        {count !== undefined && (
          <span className="text-caption font-normal text-ink-muted tabular-nums">
            {/* The space sits outside the span: some name computations trim a
                child's trailing space, which ran the words together. */}
            <span className="sr-only">,</span> {count} of {states.length}
          </span>
        )}
      </h2>

      <ul className="flex flex-col divide-y divide-line">
        <Item title="Game data saved" done={downloaded} why={downloadWhy} />

        {/* Live, but polite and not role="status": it changes rarely, and
            the roster's undo bar owns the status role. Until both sides have
            answered it shows no state at all and is not yet live, so a warm
            boot neither flashes a to-do nor announces on every launch. */}
        <Item
          title="Works offline"
          done={offlineDone}
          why={offlineWhy}
          live={settled}
          action={
            reload && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="-ml-1"
              >
                Reload
              </Button>
            )
          }
        />

        {/* The ask button goes once the browser answers, so focus goes to
            the line that gives the answer. */}
        <Item
          title="Keep your data safe"
          done={kept}
          why={keptWhy}
          whyRef={(el) => {
            persist.statusRef.current = el;
          }}
          action={
            persist.state === 'best-effort' && (
              // Its tap border pulls it in by 4px to line up with the text.
              <Button
                variant="outline"
                size="sm"
                aria-disabled={persist.requesting}
                onClick={() => void persist.request()}
                className="-ml-1"
              >
                Keep my data
              </Button>
            )
          }
        />
      </ul>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="ghost"
          onClick={() => {
            onboardingStore.getState().dismiss();
            onDismiss?.();
          }}
          className="-ml-4"
        >
          Got it, hide this
        </Button>
        <Link
          to={`/settings#${STORAGE_DETAILS_ID}`}
          className="inline-flex min-h-tap items-center text-ink-muted underline underline-offset-3 hover:text-ink"
        >
          Storage details
        </Link>
      </div>
      <p className="text-caption text-ink-muted">You can reopen this from Settings.</p>
    </section>
  );
}
