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
import type { ReactNode } from 'react';
import { type ConversionReport, convertedTotal, type EntryNote, notesWith } from '@/convert/types';
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { storageErrorText } from '@/lib/storageErrors';
import { notifyFailure } from '@/stores/notices';
import {
  countsText,
  ImportPreviewDialog,
  PreviewFacts,
  PreviewList,
  PreviewSection,
  StatusItem,
  sizeText,
  type Tone,
} from '@/ui/ImportPreview';
import {
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
  row: HomebrewFileRow,
  bytes: number,
): Promise<HomebrewPreview> {
  const [here, official, roster] = await Promise.all([
    homebrewRepo.listSafe(),
    loadOfficialIndex(),
    characterRepo.listSafe().catch(() => ({ characters: [] })),
  ]);
  return previewHomebrewImport({
    row,
    bytes,
    existing: here.files,
    official,
    characters: roster.characters,
  });
}

/**
 * Import pressed: store the file the preview described, and say what
 * happened. The commit decides again inside its transaction, so a copy another
 * tab imported meanwhile is reported rather than written twice.
 */
export async function commitHomebrewImport(
  prepared: HomebrewFileRow,
): Promise<{ ok: boolean; message: string }> {
  let committed: Awaited<ReturnType<typeof homebrewRepo.commit>>;
  try {
    committed = await homebrewRepo.commit(prepared);
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

/**
 * What carried over from another app's file. Every entry keeps its full
 * text; the lists say what the sheet will not apply for the player, so a
 * partial conversion is never silent.
 */
function ConversionSection({ report }: { report: ConversionReport }) {
  const installed = notesWith(report, 'installed').length;
  const duplicate = notesWith(report, 'duplicate').length;
  return (
    <PreviewSection heading={`Converted from ${report.formatName}`}>
      <PreviewList>
        <StatusItem tone="good" status="Converted:">
          {entries(convertedTotal(report))}, each with its full text.
        </StatusItem>
        {installed > 0 && (
          <StatusItem tone="info" status="Left out:">
            {entries(installed)} your game data already has. Its copy is the one used.
          </StatusItem>
        )}
        {duplicate > 0 && (
          <StatusItem tone="info" status="Left out:">
            {entries(duplicate)} the file has more than once. The first of each is kept.
          </StatusItem>
        )}
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
  onImport: () => void;
  onCancel: () => void;
  /** For an exact duplicate: close and leave the file already here as it is. */
  onKeepExisting: () => void;
}) {
  const p = preview;
  const dup = p.duplicateOf;
  const hasClashes = p.entityCollisions.length > 0 || p.sourceCollisions.length > 0;

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
          : [
              { label: 'Cancel', onClick: onCancel },
              { label: 'Import', onClick: onImport, primary: true },
            ]
      }
    >
      <PreviewFacts
        facts={[
          ['Contents', countsText(p.counts)],
          ['Size', sizeText(p.bytes, p.limitBytes)],
          [
            p.sources.length === 1 ? 'Source' : 'Sources',
            p.sources.length === 0
              ? 'None declared'
              : p.sources.map((s) => (s.full === s.id ? s.id : `${s.full} (${s.id})`)).join(', '),
          ],
        ]}
      />

      {conversion !== undefined && dup === undefined && <ConversionSection report={conversion} />}

      {dup !== undefined && (
        <PreviewSection heading="Already on this device">
          <PreviewList>
            <StatusItem tone="good" status="Already imported">
              on {new Date(dup.addedAt).toLocaleDateString()}. This is the same file, so importing
              it again would add nothing.
            </StatusItem>
            {!dup.enabled && (
              <StatusItem tone="warn" status="Turned off.">
                It is in your list below. Turn it on there to use it.
              </StatusItem>
            )}
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
