import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { type HomebrewFile, type HomebrewReadError, homebrewRepo } from '@/db/homebrewRepo';
import { usePageTitle } from '@/lib/usePageTitle';
import { errorText, notify } from '@/stores/notices';
import { Button, buttonClass } from '@/ui/Button';
import { DecodeBoundary } from '@/ui/DecodeBoundary';
import { listClass } from '@/ui/surfaces';

type Json = Record<string, unknown>;

/** What the file read resolves to; `undefined` from the hook is still loading. */
interface HomebrewRead {
  file?: HomebrewFile;
  error?: HomebrewReadError;
}

/**
 * The kinds a collection of your own lists here. Each opens in the Workshop,
 * whose editors read and write the same standard fields this page's forms did.
 */
const BUILDABLE = [
  ['item', 'Item'],
  ['feat', 'Feat'],
  ['spell', 'Spell'],
] as const;
type BuildType = (typeof BUILDABLE)[number][0];

/** Where the Workshop edits an entry, by the name and book it is saved under. */
export function workshopEditUrl(type: string, name: string, source: string): string {
  return `/workshop/edit/${type}/${encodeURIComponent(`${name}|${source}`)}`;
}

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * What a record is called, or `undefined` when it has no usable name.
 *
 * The file is data the app did not write: an entity can be missing, a string,
 * a list, or an object whose `name` is a number. `String(e.name)` turned every
 * one of those into a plausible-looking label ("undefined", "[object Object]")
 * that then acted as identity for saves and deletes. A record without a name
 * is identified by its position instead, and says so on screen.
 */
function entityName(e: unknown): string | undefined {
  return isRecord(e) && typeof e.name === 'string' ? e.name : undefined;
}

/** What the slot holds, for a value the builder cannot show as an entry. */
function describeValue(v: unknown): string {
  if (v === null || v === undefined) return 'the entry is empty';
  if (Array.isArray(v)) return 'it holds a list, not an entry';
  return `it holds a ${typeof v}, not an entry`;
}

/**
 * How a row or an open form says which record it is about.
 *
 * A name survives the file moving underneath; a position does not, and a
 * record with no name has nothing else. So a nameless record carries the value
 * the row was showing as well, and that is what the position is checked
 * against.
 */
interface EntityRef {
  /** Where the record was when the row rendered or the form opened. */
  index?: number;
  /** What it was called, when the file gives it a usable name. */
  name?: string;
  /** What the slot held. Read only when there is no name to match on. */
  value: unknown;
}

/**
 * Structural equality for two values that came out of the same JSON file.
 * `JSON.stringify` is enough here because that is what these are: data read
 * from IndexedDB and copied with `structuredClone`, both of which keep key
 * order, and neither of which can produce a cycle.
 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Where a record lives now. The row list is a live query, so a position
 * captured when a form or a row was opened can point at a different record by
 * the time the write happens: the position is right in the ordinary case and
 * is checked first, the name is what settles it when the file changed
 * underneath us.
 *
 * With no name, content is the identity and the rule is otherwise the same: a
 * position that still holds *some* nameless record is not the same as one that
 * still holds *this* record. Two unreadable entries side by side, an entry
 * removed ahead of them, and a delete aimed at the first would take the
 * second. So the slot has to hold what the row was showing, and if it does not
 * the record is looked for where it moved to. Records with identical content
 * are indistinguishable, so matching either of them is the same write.
 */
function entityIndex(arr: unknown[], ref: EntityRef): number {
  if (ref.name === undefined) {
    const matches = (e: unknown) => entityName(e) === undefined && sameJson(e, ref.value);
    if (ref.index !== undefined && ref.index < arr.length && matches(arr[ref.index])) {
      return ref.index;
    }
    return arr.findIndex(matches);
  }
  if (ref.index !== undefined && entityName(arr[ref.index]) === ref.name) return ref.index;
  return arr.findIndex((e) => entityName(e) === ref.name);
}

/** What a record is called in a message about it. */
function refLabel(ref: EntityRef): string {
  if (ref.name !== undefined) return ref.name;
  return isRecord(ref.value) ? 'that unnamed entry' : 'that unreadable entry';
}

/**
 * The file's display name: its declared source title, else the file name. The
 * title is read from an imported file too, so it is used only if it is text.
 */
function fileTitle(file: HomebrewFile): string {
  const full = (file.json._meta as { sources?: Array<{ full?: unknown }> } | undefined)
    ?.sources?.[0]?.full;
  return typeof full === 'string' && full.trim() !== ''
    ? full
    : file.fileName.replace(/\.json$/, '');
}

/** A link in a line of text, as the design's `cg-link` (DS-001). */
const LINK =
  'text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';

/** An icon-only way back, as the sheet header's, pulled into the gutter. */
const BACK_ICON =
  '-ml-3 tap self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

/** The way out, on every state of this page: it sits outside the app nav. */
function BackToHomebrew() {
  return (
    <Link to="/homebrew" aria-label="Back to homebrew" className={BACK_ICON}>
      <ArrowLeft size={20} aria-hidden />
    </Link>
  );
}

export function Component() {
  const { fileId } = useParams();
  // The raw read this replaced returned `undefined` both for "not loaded yet"
  // and for "no such file", so a file deleted in another tab left this page
  // loading forever.
  const read = useLiveQuery<HomebrewRead>(
    async () => (fileId === undefined ? {} : homebrewRepo.getSafe(fileId)),
    [fileId],
  );
  const [busy, setBusy] = useState(false);
  /**
   * The last write that was refused. `retryDelete` is a description of the
   * work, not a closure over it: a stored closure would keep writing the
   * document as it looked when the write failed, so a Retry pressed after the
   * page moved on would quietly undo whatever happened in between.
   */
  const [failure, setFailure] = useState<{
    text: string;
    hint: string;
    retryDelete?: { type: BuildType; ref: EntityRef };
  }>();

  usePageTitle(
    ...(read === undefined
      ? ['Homebrew editor']
      : read.file === undefined
        ? [read.error === undefined ? 'Homebrew file not found' : 'Homebrew file could not be read']
        : [fileTitle(read.file), read.file.editable ? 'Homebrew editor' : 'Homebrew']),
  );

  if (read === undefined) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <BackToHomebrew />
        <p className="text-body text-ink-muted">Loading…</p>
      </main>
    );
  }
  const row = read.file;
  if (row === undefined) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <BackToHomebrew />
        <p className="text-body text-ink-muted" role="alert">
          {read.error === undefined
            ? 'This homebrew file is no longer on this device.'
            : `This homebrew file could not be read: ${read.error.message}. You can remove it from the homebrew list.`}
        </p>
        {/* Both ways: a file that is gone is a dead link (a bookmark, a
            history entry), and the list is the nearest page that has
            anything on it. The icon above is easy to miss as the only way. */}
        <Link to="/homebrew" className={LINK}>
          Go to the homebrew list
        </Link>
      </main>
    );
  }
  if (!row.editable) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <BackToHomebrew />
        <p className="text-body text-ink-muted">
          This file was imported, not built here. Only in-app creations are editable.
        </p>
      </main>
    );
  }

  const json = row.json;
  const sourceId = row.sourceIds[0] ?? 'HB';
  const retryDelete = failure?.retryDelete;

  /**
   * Every edit goes through one write, and the write is awaited.
   *
   * Both editors used to fire the save and move on: the form closed, the row
   * disappeared, and a rejected write took the edit with it in silence. What
   * makes that worse than a lost keystroke is that the screen still showed the
   * change, so the only way to find out was to come back later and find the
   * entity as it was. Now a failure keeps the work on screen, says what went
   * wrong, and offers the same write again.
   */
  const write = async (
    next: Json,
    opts: {
      done: string;
      failed: string;
      hint: string;
      retryDelete?: { type: BuildType; ref: EntityRef };
    },
  ) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await homebrewRepo.saveEditable(row.id, next);
      invalidateRegistry();
      notify({ title: opts.done, tone: 'good' });
    } catch (err) {
      setFailure({
        text: `${opts.failed}: ${errorText(err)}`,
        hint: opts.hint,
        retryDelete: opts.retryDelete,
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteEntity = async (type: BuildType, ref: EntityRef) => {
    const next = structuredClone(json);
    const arr = Array.isArray(next[type]) ? (next[type] as unknown[]) : [];
    const at = entityIndex(arr, ref);
    const label = refLabel(ref);
    if (at === -1) {
      // Either it is gone, or the file moved and a nameless record can no
      // longer be told apart from its neighbours. Both end here: doing nothing
      // is the only answer that cannot destroy the wrong record. The failure
      // that offered this retry is over either way.
      setFailure(undefined);
      notify({
        title:
          ref.name === undefined ? 'That entry can no longer be found' : `${label} is already gone`,
        tone: 'info',
      });
      return;
    }
    arr.splice(at, 1);
    next[type] = arr;
    await write(next, {
      done: `Deleted ${label}`,
      failed: `Could not delete ${label}`,
      hint: 'Nothing was changed on this device.',
      retryDelete: { type, ref },
    });
  };

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <header className="flex items-center gap-2">
        <BackToHomebrew />
        <div className="min-w-0">
          <h1 className="font-display text-title-page">{fileTitle(row)}</h1>
          <p className="text-caption text-ink-muted">
            source: {sourceId}. Everything in it is usable on characters at once, and exports as a
            standard homebrew file. Each entry opens in the Workshop.
          </p>
        </div>
      </header>

      {failure !== undefined && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-3 py-2"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-caption">
            {failure.text}
            <span className="block text-ink-muted">{failure.hint}</span>
          </p>
          {retryDelete !== undefined && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void deleteEntity(retryDelete.type, retryDelete.ref)}
              className="shrink-0"
            >
              {busy ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      )}

      {BUILDABLE.map(([type, label]) => {
        // Whatever the file holds, not whatever the type says it holds: these
        // entries come back from IndexedDB and were only ever checked for
        // `_meta`, so a slot can hold null, a string, or a list.
        const entities: unknown[] = Array.isArray(json[type]) ? (json[type] as unknown[]) : [];
        const lower = label.toLowerCase();
        return (
          <section key={type} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 pl-1">
              <h2 className="text-heading">
                {label}s{' '}
                <span className="font-normal text-caption text-ink-muted tabular-nums">
                  {entities.length}
                </span>
              </h2>
              <Link
                to={`/workshop/new/${type}?file=${encodeURIComponent(row.id)}`}
                className={buttonClass({ variant: 'outline', size: 'sm' })}
              >
                <Plus size={16} aria-hidden /> New {lower}
              </Link>
            </div>
            {/* The card only around rows: an empty one would draw an empty frame. */}
            <div className={entities.length > 0 ? listClass : undefined}>
              {entities.map((e, i) => {
                const name = entityName(e);
                const ref: EntityRef = { index: i, name, value: e };
                const remove = (
                  <button
                    type="button"
                    aria-label={`Delete ${name ?? `unnamed ${lower}`}`}
                    title="Delete"
                    disabled={busy}
                    onClick={() => void deleteEntity(type, ref)}
                    className="tap shrink-0 rounded-control text-ink-muted transition-colors duration-120 enabled:hover:bg-surface-raised enabled:hover:text-danger disabled:cursor-default disabled:text-ink-faint"
                  >
                    <Trash2 size={18} />
                  </button>
                );
                const key = `${name ?? 'unnamed'}-${String(i)}`;
                // A slot that isn't an object has nothing to open, name, or
                // link to. It is still in the user's file, so it gets a row
                // that says so and offers the one action that helps.
                if (!isRecord(e)) {
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 bg-danger-soft py-1 pr-1 pl-4"
                    >
                      <p className="min-w-0 flex-1 text-caption">
                        This {lower} could not be read ({describeValue(e)}). Deleting it leaves the
                        rest of the file alone.
                      </p>
                      {remove}
                    </div>
                  );
                }
                return (
                  // One bad record fails in its own row rather than taking the
                  // file's other entities, and the delete, down with it.
                  <DecodeBoundary
                    key={key}
                    // The keys here are positional, so a record removed ahead
                    // of this one hands its boundary to a different record.
                    resetKey={entities.length}
                    label={`This ${lower}`}
                    action={remove}
                  >
                    <div className="flex items-center gap-1 pr-1">
                      {name !== undefined ? (
                        <Link
                          to={workshopEditUrl(
                            type,
                            name,
                            typeof e.source === 'string' ? e.source : sourceId,
                          )}
                          aria-label={`Edit ${name}`}
                          className="flex min-h-tap min-w-0 flex-1 items-center truncate py-2 pl-4 decoration-line-strong underline-offset-3 hover:underline"
                        >
                          {name}
                        </Link>
                      ) : (
                        // Nothing to find it by in the Workshop: a name is how it is opened.
                        <span className="min-w-0 flex-1 truncate py-2 pl-4 text-ink-muted">
                          Unnamed {lower}
                        </span>
                      )}
                      {name !== undefined && (
                        <Link
                          to={`/library/${type}/${encodeURIComponent(`${name}|${sourceId}`.toLowerCase())}`}
                          aria-label={`View ${name} in the library`}
                          className="inline-flex min-h-tap shrink-0 items-center px-2 font-semibold text-caption text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink"
                        >
                          view
                        </Link>
                      )}
                      {remove}
                    </div>
                  </DecodeBoundary>
                );
              })}
            </div>
          </section>
        );
      })}

      <p className="text-caption text-ink-muted">
        Species, backgrounds and other options are made in the{' '}
        <Link to="/workshop" className={LINK}>
          Workshop
        </Link>
        . Classes and subclasses: import them as JSON for now.
      </p>
    </main>
  );
}
