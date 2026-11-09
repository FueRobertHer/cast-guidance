/**
 * What importing a homebrew file would do, shown before anything is written
 * (IMP-002). It explains and never refuses: Import is always offered, because
 * a file the old flow imported straight away must still import. The words
 * come from the pure preview (`previewHomebrewImport`, its `notes` and
 * `describeCollision`), so what this says about a clash is what the registry
 * does with it.
 *
 * The Homebrew page loads this module once an import starts, so the preview,
 * its gathering and its commit stay out of the page's first load and out of
 * the entry chunk.
 */
import { type ReactNode, useState } from 'react';
import { type ConversionReport, convertedTotal, type EntryNote, notesWith } from '@/convert/types';
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import type { HomebrewFileRow } from '@/db/db';
import { sameBookCopy } from '@/db/homebrewBooks';
import { homebrewRepo } from '@/db/homebrewRepo';
import { jsonByteSize } from '@/lib/byteSize';
import { QUOTA_GUIDANCE, storageErrorText } from '@/lib/storageErrors';
import { freeStorage } from '@/lib/storageRoom';
import { notifyFailure } from '@/stores/notices';
import {
  countsText,
  formatBytes,
  ImportPreviewDialog,
  PreviewFacts,
  PreviewList,
  PreviewSection,
  StatusItem,
  sizeText,
  type Tone,
} from '@/ui/ImportPreview';
import {
  type BookChoice,
  type Dependency,
  describeCollision,
  type HomebrewPreview,
  type OfficialCoverage,
  previewHomebrewImport,
  WINNER_POLICY,
} from './importPreview';
import { loadOfficialIndex } from './loadOfficialIndex';

/**
 * Everything a preview reads, for a prepared file: the files here, the
 * official data and the roster. The registry can take a while during a first
 * download (the page shows a Checking line meanwhile); one that cannot be read
 * at all gives a note in the preview, not a failure.
 */
export async function buildHomebrewPreview(
  prepared: PreparedImport,
  bytes: number,
  limitBytes?: number,
): Promise<HomebrewPreview> {
  const [here, official, roster] = await Promise.all([
    homebrewRepo.listSafe(),
    loadOfficialIndex(),
    characterRepo.listSafe().catch(() => ({ characters: [] })),
  ]);
  return previewHomebrewImport({
    row: prepared.row,
    ...(prepared.books === undefined ? {} : { books: prepared.books }),
    bytes,
    ...(limitBytes === undefined ? {} : { limitBytes }),
    existing: here.files,
    official,
    characters: roster.characters,
  });
}

/**
 * What an import would store: a file whole, or (a converted compendium) a
 * book at a time, `row` then being the whole file for the preview alone.
 */
export interface PreparedImport {
  row: HomebrewFileRow;
  books?: HomebrewFileRow[];
}

/** A count of books, in words. */
const booksText = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`;

/** Every count in `rows`, added up. */
function totalCounts(rows: readonly HomebrewFileRow[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of rows)
    for (const [k, n] of Object.entries(r.counts)) total[k] = (total[k] ?? 0) + n;
  return total;
}

/**
 * Why the browser clearly has no room for `rows`, or undefined. Asked before
 * writing a byte: a compendium runs to tens of megabytes, and a write that
 * fails part way costs the wait for nothing. "Clearly": only what comes in
 * new is counted, not a file already here or a book that takes the place of
 * its own older copy, and a browser that cannot say how much room it has is
 * never refused.
 */
async function roomProblem(rows: readonly HomebrewFileRow[]): Promise<string | undefined> {
  const free = await freeStorage();
  if (free === undefined) return undefined;
  const stored = (await homebrewRepo.listMetaSafe()).files;
  const ids = new Set(stored.map((r) => r.id));
  let need = 0;
  for (const r of rows) {
    if (ids.has(r.id) || stored.some((s) => sameBookCopy(s, r))) continue;
    need += jsonByteSize(r.json);
  }
  if (need <= free) return undefined;
  return `It needs about ${formatBytes(need)}, and the browser has ${formatBytes(free)} left for the app. ${QUOTA_GUIDANCE}`;
}

/**
 * Store the books the player chose, and say what happened. A file of one
 * book is named as a file is; of several, by how many books came in.
 */
async function commitBooks(
  prepared: PreparedImport & { books: HomebrewFileRow[] },
  chosen: ReadonlySet<string> | undefined,
): Promise<{ ok: boolean; message: string }> {
  const books = prepared.books.filter((b) => chosen?.has(b.id) ?? true);
  const { fileName } = prepared.row;
  let committed: Awaited<ReturnType<typeof homebrewRepo.commitBooks>>;
  try {
    const noRoom = await roomProblem(books);
    if (noRoom !== undefined) return { ok: false, message: `Import failed: ${noRoom}` };
    committed = await homebrewRepo.commitBooks(books);
  } catch (err) {
    return { ok: false, message: `Import failed: ${storageErrorText(err)}` };
  }
  const { added, replaced } = committed;
  if (added.length > 0) invalidateRegistry();
  await ensureSourcesVisible(books.flatMap((b) => b.sourceIds)).catch((err: unknown) =>
    notifyFailure('Show sources', err),
  );
  if (added.length === 0) {
    return {
      ok: true,
      message:
        prepared.books.length === 1
          ? `"${fileName}" was already on this device, so nothing was added.`
          : `Those books from "${fileName}" were already on this device, so nothing was added.`,
    };
  }
  const what =
    prepared.books.length === 1 ? `"${fileName}"` : `${booksText(added.length)} from "${fileName}"`;
  const replacing = replaced > 0 ? `, replacing ${booksText(replaced)} imported before` : '';
  return { ok: true, message: `Imported ${what} (${countsText(totalCounts(added))})${replacing}` };
}

/**
 * Import pressed: store the file the preview described, and say what
 * happened. The commit decides again inside its transaction, so a copy another
 * tab imported meanwhile is reported rather than written twice. For a file
 * stored a book at a time, `chosen` holds the books ticked; left out, all.
 */
export async function commitHomebrewImport(
  prepared: PreparedImport,
  chosen?: ReadonlySet<string>,
): Promise<{ ok: boolean; message: string }> {
  if (prepared.books !== undefined)
    return commitBooks({ ...prepared, books: prepared.books }, chosen);
  let committed: Awaited<ReturnType<typeof homebrewRepo.commit>>;
  try {
    const noRoom = await roomProblem([prepared.row]);
    if (noRoom !== undefined) return { ok: false, message: `Import failed: ${noRoom}` };
    committed = await homebrewRepo.commit(prepared.row);
  } catch (err) {
    return { ok: false, message: `Import failed: ${storageErrorText(err)}` };
  }
  const { row, duplicate } = committed;
  // The row is stored, so the registry must see it even if showing its
  // sources fails below.
  if (!duplicate) invalidateRegistry();
  // Imported content the player cannot see is worse than useless, and a
  // preset (allow list) would hide it by default. A file already here gets
  // the same, as the old flow gave it. A failure here does not undo the
  // import, so it is reported on its own.
  await ensureSourcesVisible(row.sourceIds).catch((err: unknown) =>
    notifyFailure('Show sources', err),
  );
  if (duplicate) {
    return {
      ok: true,
      message: `"${row.fileName}" was already on this device, so nothing was added.`,
    };
  }
  return { ok: true, message: `Imported "${row.fileName}" (${countsText(row.counts)})` };
}

const DEPENDENCY: Record<
  Exclude<Dependency['status'], 'not-downloaded'>,
  { tone: Tone; text: string }
> = {
  official: { tone: 'good', text: 'is official content, available on this device.' },
  homebrew: { tone: 'good', text: 'is in your homebrew, available on this device.' },
  disabled: {
    tone: 'warn',
    text: 'is in a homebrew file that is turned off. Turn that file on to use the entries that need it.',
  },
  missing: {
    tone: 'warn',
    text: 'is not on this device. Entries that need it may be incomplete until you import it.',
  },
};

/**
 * A source not found while some official data was not checked. True whether
 * the download is running, stopped or not started: it says only what is
 * known. With no game data read at all, it matches the preview's note.
 */
function dependencyLine(status: Dependency['status'], coverage: OfficialCoverage) {
  if (status !== 'not-downloaded') return DEPENDENCY[status];
  return {
    tone: 'info' as const,
    text:
      coverage === 'unavailable'
        ? 'could not be checked against official content, because game data could not be read.'
        : 'is not found yet. Not all game data is on this device yet, so it may arrive with the rest.',
  };
}

/** How many converted entries the preview names one by one, per list. */
export const MAX_LISTED_NOTES = 10;

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** Notes keyed by kind and name, counted, since a name can repeat across editions. */
function keyedNotes(notes: EntryNote[]): { key: string; note: EntryNote }[] {
  const seen = new Map<string, number>();
  return notes.map((note) => {
    const base = `${note.kind}:${note.name}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { key: `${base}#${count}`, note };
  });
}

/** One list of converted entries with what each lost, capped. */
function NoteList({ notes, intro }: { notes: EntryNote[]; intro: string }) {
  if (notes.length === 0) return null;
  return (
    <>
      <p className="text-ink-muted">{intro}</p>
      <PreviewList>
        {keyedNotes(notes.slice(0, MAX_LISTED_NOTES)).map(({ key, note }) => (
          <StatusItem key={key} tone="info" status={`${note.name}:`}>
            {note.reasons.join('; ')}.
          </StatusItem>
        ))}
      </PreviewList>
      {notes.length > MAX_LISTED_NOTES && (
        <p className="text-ink-muted">And {notes.length - MAX_LISTED_NOTES} more.</p>
      )}
    </>
  );
}

/** Entries left out as copies, counted by why, the most common first. */
function leftOut(report: ConversionReport): [why: string, count: number][] {
  const counts = new Map<string, number>();
  for (const note of report.notes) {
    if (note.status !== 'installed' && note.status !== 'duplicate') continue;
    const why =
      note.reasons[0] ??
      (note.status === 'installed'
        ? 'your game data already has it'
        : 'the file has it more than once');
    counts.set(why, (counts.get(why) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

/**
 * What carried over from another app's file. Every entry keeps its full
 * text; the lists say what the sheet will not apply for the player, so a
 * partial conversion is never silent, and what was left out is counted by
 * why.
 */
function ConversionSection({ report }: { report: ConversionReport }) {
  return (
    <PreviewSection heading={`Converted from ${report.formatName}`}>
      <PreviewList>
        <StatusItem tone="good" status="Converted:">
          {entries(convertedTotal(report))}, each with its full text.
        </StatusItem>
        {leftOut(report).map(([why, count]) => (
          <StatusItem key={why} tone="info" status="Left out:">
            {entries(count)}: {why}.
          </StatusItem>
        ))}
        {report.warnings.map((w) => (
          <StatusItem key={w} tone="warn">
            {w}
          </StatusItem>
        ))}
      </PreviewList>
      <NoteList
        notes={notesWith(report, 'partial')}
        intro="Parts of these entries are kept as text only, so the sheet will not apply them for you:"
      />
      <NoteList notes={notesWith(report, 'skipped')} intro="These entries were left out:" />
    </PreviewSection>
  );
}

/** "And 3 more", for a list the preview capped. */
function more(total: number, shown: number, what: string): ReactNode {
  return total > shown ? (
    <p className="text-ink-muted">
      And {total - shown} more {what}, settled the same way.
    </p>
  ) : null;
}

/** What a book would do, under its name in the picker. */
function bookStatus(b: BookChoice): string {
  const counts = countsText(b.counts);
  const also =
    b.alsoIn === undefined
      ? ''
      : ` Also in ${b.alsoIn.map((f) => `"${f}"`).join(', ')}: an entry both have shows once.`;
  if (b.status === 'same') return `${counts}. Already on this device.${also}`;
  if (b.status === 'replaces')
    return `${counts}. Replaces the copy from "${b.replacesFrom}".${also}`;
  return also === '' ? counts : `${counts}.${also}`;
}

/**
 * The books of a file stored a book at a time, each ticked to come in. All
 * are ticked to begin with; a book left out can be imported later by
 * importing the file again.
 */
function BookPicker({
  books,
  chosen,
  onChange,
}: {
  books: BookChoice[];
  chosen: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <PreviewSection heading="Books">
      <p className="text-ink-muted">
        Each book is kept on its own, with its own switch. Untick the ones you do not want.
      </p>
      <div className="flex flex-col overflow-hidden rounded-control bg-surface ring-1 ring-line ring-inset">
        <div className="flex gap-1 border-line border-b px-2 py-1 text-caption">
          <button
            type="button"
            onClick={() => onChange(new Set(books.map((b) => b.id)))}
            className="inline-flex min-h-tap items-center px-1 text-ink-muted underline underline-offset-3 hover:text-ink"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="inline-flex min-h-tap items-center px-1 text-ink-muted underline underline-offset-3 hover:text-ink"
          >
            Select none
          </button>
          <span className="ml-auto inline-flex items-center px-1 text-ink-muted">
            {chosen.size} of {books.length}
          </span>
        </div>
        {books.map((b) => (
          <label
            key={b.id}
            className="flex min-h-tap items-start gap-2.5 px-3 py-2 hover:bg-surface-raised"
          >
            <input
              type="checkbox"
              checked={chosen.has(b.id)}
              onChange={(e) => toggle(b.id, e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-ink"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={chosen.has(b.id) ? '' : 'text-ink-muted'}>{b.full}</span>
              <span className="text-caption text-ink-muted">{bookStatus(b)}</span>
            </span>
          </label>
        ))}
      </div>
    </PreviewSection>
  );
}

export default function HomebrewImportPreview({
  preview,
  conversion,
  onImport,
  onCancel,
  onKeepExisting,
}: {
  preview: HomebrewPreview;
  /** Set for a file converted from another app: what carried over. */
  conversion?: ConversionReport;
  /** Import pressed. For a file stored a book at a time, with the books ticked. */
  onImport: (chosen?: ReadonlySet<string>) => void;
  onCancel: () => void;
  /** For an exact duplicate: close and leave the file already here as it is. */
  onKeepExisting: () => void;
}) {
  const p = preview;
  const dup = p.duplicateOf;
  const hasClashes = p.entityCollisions.length > 0 || p.sourceCollisions.length > 0;
  const books = p.books;
  const [chosen, setChosen] = useState<ReadonlySet<string>>(
    () => new Set(books?.map((b) => b.id) ?? []),
  );
  // What Import would store: ticked books not already here.
  const storing = books?.filter((b) => chosen.has(b.id) && b.status !== 'same').length;
  const picking = books !== undefined && books.length > 1;
  const importAction =
    books === undefined || !picking
      ? { label: 'Import', onClick: () => onImport(), primary: true }
      : {
          label: storing === 0 ? 'Import' : `Import ${booksText(storing ?? 0)}`,
          onClick: () => onImport(chosen),
          primary: true,
          disabled: storing === 0,
        };

  return (
    <ImportPreviewDialog
      title={dup !== undefined ? `"${p.fileName}" is already here` : `Import "${p.fileName}"?`}
      description={
        dup !== undefined
          ? 'Nothing new would be added.'
          : 'Nothing is added until you choose Import.'
      }
      onDismiss={dup !== undefined ? onKeepExisting : onCancel}
      actions={
        dup !== undefined
          ? [{ label: 'Keep the existing file', onClick: onKeepExisting, primary: true }]
          : [{ label: 'Cancel', onClick: onCancel }, importAction]
      }
    >
      <PreviewFacts
        facts={[
          ['Contents', countsText(p.counts)],
          ['Size', sizeText(p.bytes, p.limitBytes)],
          picking
            ? ['Books', `${books.length}, each kept on its own`]
            : [
                p.sources.length === 1 ? 'Source' : 'Sources',
                p.sources.length === 0
                  ? 'None declared'
                  : p.sources
                      .map((s) => (s.full === s.id ? s.id : `${s.full} (${s.id})`))
                      .join(', '),
              ],
        ]}
      />

      {conversion !== undefined && dup === undefined && <ConversionSection report={conversion} />}

      {picking && dup === undefined && (
        <>
          <BookPicker books={books} chosen={chosen} onChange={setChosen} />
          {storing === 0 && (
            <p className="text-ink-muted">
              Tick a book that is not already on this device to import it.
            </p>
          )}
        </>
      )}

      {dup !== undefined && (
        <PreviewSection heading="Already on this device">
          <PreviewList>
            <StatusItem tone="good" status="Already imported">
              on {new Date(dup.addedAt).toLocaleDateString()}. This is the same file, so importing
              it again would add nothing.
            </StatusItem>
            {!dup.enabled &&
              (books !== undefined && dup.booksOff !== undefined && dup.booksOff < books.length ? (
                <StatusItem
                  tone="warn"
                  status={`${dup.booksOff} of ${booksText(books.length)} turned off.`}
                >
                  They are in your list below. Turn them on there to use them.
                </StatusItem>
              ) : (
                <StatusItem tone="warn" status="Turned off.">
                  It is in your list below. Turn it on there to use it.
                </StatusItem>
              ))}
          </PreviewList>
        </PreviewSection>
      )}

      {p.replacesOldImport !== undefined && dup === undefined && (
        <PreviewSection heading="Replaces an earlier import">
          <PreviewList>
            {p.replacesOldImport.map((f) => (
              <StatusItem key={f.id} tone="info" status={`"${f.fileName}"`}>
                {`Imported before as one file${
                  f.sourceIds.length === 1
                    ? `, under the source ${f.sourceIds[0]}`
                    : ` of ${booksText(f.sourceIds.length)}`
                }. Importing replaces it, so each entry shows once, under its book.`}
              </StatusItem>
            ))}
            {(p.oldImportCharacters ?? []).map((c) => (
              <StatusItem key={c.id} tone="warn" status={c.name}>
                Uses entries from that earlier import. They show as missing until picked again from
                their books.
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      {p.dependencies.length > 0 && (
        <PreviewSection heading="Depends on">
          <PreviewList>
            {p.dependencies.map((d) => (
              <StatusItem
                key={d.sourceId}
                tone={dependencyLine(d.status, p.officialCoverage).tone}
                status={d.sourceId}
              >
                {dependencyLine(d.status, p.officialCoverage).text}
                {d.via === 'copy' && ' Entries in this file copy from it.'}
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      {hasClashes && (
        <PreviewSection heading="Clashes">
          <PreviewList>
            {p.sourceCollisions.flatMap((c) =>
              c.files.map((f) => (
                <StatusItem key={`${c.sourceId}:${f.id}`} tone="info">
                  "{f.fileName}"{f.enabled ? '' : ', which is turned off,'} also declares the source{' '}
                  {c.sourceId}.
                </StatusItem>
              )),
            )}
            {p.entityCollisions.map((c) => (
              <StatusItem
                key={`${c.type}:${c.name}|${c.source}:${c.against === 'official' ? '' : c.against.id}`}
                tone="warn"
              >
                {describeCollision(c)}
              </StatusItem>
            ))}
          </PreviewList>
          {more(p.collisionTotal, p.entityCollisions.length, 'clashes')}
        </PreviewSection>
      )}

      {p.disabledClashes.length > 0 && (
        <PreviewSection heading="Clashes with turned-off files">
          <PreviewList>
            {p.disabledClashes.map((c) => (
              <StatusItem key={`${c.type}:${c.name}|${c.source}:${c.against.id}`} tone="info">
                {c.name} ({c.source}) is also in "{c.against.fileName}", which is turned off.
              </StatusItem>
            ))}
          </PreviewList>
          {more(p.disabledClashTotal, p.disabledClashes.length, 'clashes')}
        </PreviewSection>
      )}

      {p.copyIssues.length > 0 && (
        <PreviewSection heading="Copies that will not load in full">
          <PreviewList>
            {p.copyIssues.map((c) => (
              <StatusItem key={`${c.type}:${c.name}:${c.target}`} tone="warn">
                {c.disabledIn === undefined
                  ? `${c.name} copies ${c.target}, which is not on this device, so it will be missing what it copies.`
                  : `${c.name} copies ${c.target}, which is only in "${c.disabledIn.fileName}", a file that is turned off. Until that file is turned on, ${c.name} will be missing what it copies.`}
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      {p.satisfiesCopies.length > 0 && (
        <PreviewSection heading="Copies this file completes">
          <PreviewList>
            {p.satisfiesCopies.map((s) => (
              <StatusItem key={s.file.id} tone="good">
                In "{s.file.fileName}": {s.entries.map((e) => e.name).join(', ')}{' '}
                {s.entries.length === 1 ? 'copies' : 'copy'} from this file and will load in full
                after the import.
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      {p.affectedCharacters.length > 0 && (
        <PreviewSection heading="Characters that use its sources">
          <p className="text-ink-muted">What these sheets show can change after the import.</p>
          <PreviewList>
            {p.affectedCharacters.map((c) => (
              <StatusItem key={c.id} tone="info">
                {c.name}
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      {p.notes.length > 0 && (
        <PreviewSection heading="Notes">
          <PreviewList>
            {p.notes.map((n) => (
              <StatusItem key={n} tone="info">
                {n}
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}

      <PreviewSection heading="Which version wins">
        <p className="text-ink-muted">{WINNER_POLICY}</p>
      </PreviewSection>
    </ImportPreviewDialog>
  );
}
