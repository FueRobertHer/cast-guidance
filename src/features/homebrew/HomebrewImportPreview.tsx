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
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { storageErrorText } from '@/lib/storageErrors';
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
  try {
    const { row, duplicate } = await homebrewRepo.commit(prepared);
    if (duplicate) {
      return {
        ok: true,
        message: `"${row.fileName}" was already on this device, so nothing was added.`,
      };
    }
    invalidateRegistry();
    // Imported content the player cannot see is worse than useless, and a
    // preset (allow list) would hide it by default.
    await ensureSourcesVisible(row.sourceIds);
    return { ok: true, message: `Imported "${row.fileName}" (${countsText(row.counts)})` };
  } catch (err) {
    return { ok: false, message: `Import failed: ${storageErrorText(err)}` };
  }
}

const DEPENDENCY: Record<Dependency['status'], { tone: Tone; text: string }> = {
  official: { tone: 'good', text: 'is official content, available on this device.' },
  homebrew: { tone: 'good', text: 'is in your homebrew, available on this device.' },
  disabled: {
    tone: 'warn',
    text: 'is in a homebrew file that is turned off. Turn that file on to use the entries that need it.',
  },
  'not-downloaded': {
    tone: 'info',
    text: 'is not here yet. Game data is still downloading, so it may arrive.',
  },
  missing: {
    tone: 'warn',
    text: 'is not on this device. Entries that need it may be incomplete until you import it.',
  },
};

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
  onImport,
  onCancel,
  onKeepExisting,
}: {
  preview: HomebrewPreview;
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
              <StatusItem key={d.sourceId} tone={DEPENDENCY[d.status].tone} status={d.sourceId}>
                {DEPENDENCY[d.status].text}
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
                {c.name} copies {c.target}, which is not on this device, so it will be missing what
                it copies.
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
