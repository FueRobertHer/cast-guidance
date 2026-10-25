/**
 * What importing a character would do, shown before anything is written
 * (IMP-002): the class, whether it lands as a copy, the homebrew it carries
 * and what is already here, and the sources nothing here provides.
 *
 * The roster loads this module only once an import starts, so neither the
 * preview nor the official-data read behind it is in the entry chunk. It
 * explains and never refuses: Import is always offered, as the old flow
 * imported every file that passed validation.
 */
import {
  characterRepo,
  type ImportSummary,
  type PreparedCharacterImport,
} from '@/db/characterRepo';
import { homebrewRepo } from '@/db/homebrewRepo';
import { loadOfficialIndex } from '@/features/homebrew/loadOfficialIndex';
import { IMPORT_LIMITS } from '@/lib/guards';
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
  type CharacterPreview,
  type EmbeddedFilePreview,
  MISSING_SOURCE_NOTE,
  previewCharacterImport,
} from './importPreview';

/** Everything a character preview reads, gathered once an export is prepared. */
export async function buildCharacterPreview(
  prepared: PreparedCharacterImport,
): Promise<CharacterPreview> {
  const [here, official, existing] = await Promise.all([
    homebrewRepo.listSafe(),
    loadOfficialIndex(),
    characterRepo.get(prepared.doc.id).catch(() => undefined),
  ]);
  return previewCharacterImport({
    prepared,
    characterExists: existing !== undefined,
    existing: here.files,
    official,
  });
}

/** What the roster says once an import is stored. */
export function importSummaryMessage(s: ImportSummary): string {
  const files = (n: number) => `${n} homebrew file${n === 1 ? '' : 's'}`;
  let text = `Imported ${s.name}`;
  if (s.renamed) text += ' as a copy, since a character with the same id was already here';
  if (s.homebrewAdded > 0) text += `. Added ${files(s.homebrewAdded)}`;
  if (s.homebrewSkipped > 0) text += `. ${files(s.homebrewSkipped)} already here`;
  return text;
}

/**
 * Import pressed: store what the preview described and say what happened.
 * The commit decides again inside its transaction, so its summary is the one
 * that counts if another tab changed something after the preview was built.
 */
export async function commitCharacterImport(prepared: PreparedCharacterImport): Promise<string> {
  try {
    return importSummaryMessage(await characterRepo.commitImport(prepared));
  } catch (err) {
    return `Import failed: ${storageErrorText(err)}`;
  }
}

/**
 * The spelling a source id has in the character itself. The preview compares
 * sources lowercased; showing "xphb" for XPHB would read as a typo.
 */
function sourceSpellings(value: unknown, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    for (const v of value) sourceSpellings(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'source' && typeof v === 'string' && !out.has(v.toLowerCase())) {
        out.set(v.toLowerCase(), v);
      } else {
        sourceSpellings(v, out);
      }
    }
  }
  return out;
}

function fileStatus(f: EmbeddedFilePreview): { tone: Tone; status: string; detail: string } {
  const enabledLocal = f.localFiles.filter((l) => l.enabled).map((l) => `"${l.fileName}"`);
  const many = enabledLocal.length > 1;
  switch (f.status) {
    case 'already-here':
      return {
        tone: 'good',
        status: 'Already here.',
        detail: 'The same file is on this device, so it is skipped.',
      };
    case 'other-version':
      return {
        tone: 'warn',
        status: 'Another version is here.',
        detail:
          `${enabledLocal.join(', ')} ${many ? 'declare' : 'declares'} the same source and ` +
          `${many ? 'were' : 'was'} imported first, so ${many ? 'their' : 'its'} entries win where ` +
          'they match. The matching entries in this file are not used until ' +
          `${many ? 'those files are' : 'that file is'} turned off or deleted.`,
      };
    default:
      return { tone: 'new', status: 'New.', detail: 'Importing adds it to your homebrew.' };
  }
}

export default function CharacterImportPreview({
  preview,
  sourceSpellingOf,
  onImport,
  onCancel,
}: {
  preview: CharacterPreview;
  /** The character's own spelling of a lowercased source id. */
  sourceSpellingOf: (lower: string) => string;
  onImport: () => void;
  onCancel: () => void;
}) {
  const p = preview;
  const sources: { id: string; tone: Tone; text: string }[] = [
    ...p.missingSources.map((id) => ({
      id,
      tone: 'warn' as const,
      text: `is not on this device. What the character uses from it ${MISSING_SOURCE_NOTE}.`,
    })),
    ...p.notDownloadedSources.map((id) => ({
      id,
      tone: 'info' as const,
      text:
        'is not here yet. Game data is still downloading, so it may arrive. If it is ' +
        'homebrew, import the file that provides it.',
    })),
    ...p.disabledSources.map((id) => ({
      id,
      tone: 'warn' as const,
      text: 'is in a homebrew file that is turned off. Turn it on in Homebrew to use it here.',
    })),
  ];

  return (
    <ImportPreviewDialog
      title={`Import ${p.name}?`}
      onDismiss={onCancel}
      actions={[
        { label: 'Cancel', onClick: onCancel },
        { label: 'Import', onClick: onImport, primary: true },
      ]}
    >
      <PreviewFacts
        facts={[
          ['Class', p.classLabel === '' ? 'No class yet' : p.classLabel],
          ['Size', sizeText(p.bytes, IMPORT_LIMITS.maxImportBytes)],
        ]}
      />

      {p.importsAsCopy && (
        <PreviewSection heading="Imports as a copy">
          <PreviewList>
            <StatusItem tone="info">
              A character with the same id is already on this device, so this one is added as a copy
              with its own id. The character already here does not change.
            </StatusItem>
          </PreviewList>
        </PreviewSection>
      )}

      {p.files.length > 0 && (
        <PreviewSection heading="Homebrew in this file">
          <PreviewList>
            {p.files.map((f) => {
              const s = fileStatus(f);
              const off = f.localFiles.filter((l) => !l.enabled);
              return (
                <StatusItem key={f.fileName + f.sourceIds.join()} tone={s.tone} status={s.status}>
                  <span className="font-semibold">{f.fileName}</span> ({countsText(f.counts)}).{' '}
                  {s.detail}
                  {off.map((l) => (
                    <span key={l.id}>
                      {' '}
                      "{l.fileName}", which is turned off, declares the same source. If you turn it
                      back on, it wins where the two match.
                    </span>
                  ))}
                </StatusItem>
              );
            })}
          </PreviewList>
        </PreviewSection>
      )}

      {sources.length > 0 && (
        <PreviewSection heading="Sources not available">
          <PreviewList>
            {sources.map((s) => (
              <StatusItem key={s.id} tone={s.tone} status={sourceSpellingOf(s.id)}>
                {s.text}
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
    </ImportPreviewDialog>
  );
}

/** A lookup for {@link CharacterImportPreview}'s `sourceSpellingOf`. */
export function spellingLookup(prepared: PreparedCharacterImport): (lower: string) => string {
  const map = sourceSpellings(prepared.doc);
  for (const dep of prepared.doc.homebrewDeps) {
    if (!map.has(dep.toLowerCase())) map.set(dep.toLowerCase(), dep);
  }
  return (lower) => map.get(lower) ?? lower;
}
