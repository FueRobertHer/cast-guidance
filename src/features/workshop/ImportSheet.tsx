/**
 * The Workshop's one Import sheet (ADR-002 D1; the One Workshop canvas,
 * board 7): a file, a link or pasted text, each read into the same preview,
 * which lands it as a collection or updates the one it is (ADR-002 D4,
 * through `commitHomebrewImport`). Nothing is written until the preview's
 * Import or Update.
 *
 * Text that is no file (the words of one spell, item or feat) opens the
 * editor instead, with the words in Text, as Make your own's From text does.
 *
 * The home opens it with `?import` and closes it by taking that off, so its
 * Import links stay links. While a file is read the sheet shows how far, and
 * the newest read wins: a slow one never swaps its preview in over a newer.
 */
import { FileUp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ConversionReport } from '@/convert/types';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import type { PackAppliesTo } from '@/engine/castGuidance';
import HomebrewImportPreview, {
  buildHomebrewPreview,
  commitHomebrewImport,
  type PreparedImport,
  prepareHomebrewImport,
} from '@/features/homebrew/HomebrewImportPreview';
import { REFUSED_HOST_REASON } from '@/features/homebrew/homebrewUrl';
import type { HomebrewPreview } from '@/features/homebrew/importPreview';
import {
  ImportCancelledError,
  NothingToImportError,
  type ParsedImport,
  parseImportFile,
  parseImportPaste,
  pastedKind,
} from '@/features/homebrew/importText';
import { fetchHomebrewFromUrl, HomebrewUrlRefusedError } from '@/features/homebrew/importUrl';
import { textToEntries } from '@/lib/entriesText';
import { IMPORT_LIMITS } from '@/lib/guards';
import { safeExternalHref } from '@/lib/url';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { errorText, notifyFailure } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { DialogFrame } from '@/ui/dialogs';
import { formatBytes } from '@/ui/ImportPreview';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { fieldClass } from '@/ui/TextField';
import { kindOf } from './yours';

type Way = 'file' | 'link' | 'text';
const WAYS: ReadonlyArray<{ value: Way; label: string }> = [
  { value: 'file', label: 'A file' },
  { value: 'link', label: 'A link' },
  { value: 'text', label: 'Text' },
];

/** The kinds whose words the editor keeps in Text, as Make your own's From text offers them. */
const WORD_KINDS = ['spell', 'item', 'feat', 'race', 'background', 'condition', 'optionalfeature'];

const NOTE = 'text-caption text-ink-muted';
const LINK =
  'inline-flex min-h-tap items-center font-semibold text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink';

/** What a read gives: the file, what to call it and where it came from. */
interface Read extends ParsedImport {
  fileName: string;
  url?: string;
  bytes: number;
  limitBytes?: number;
}

/** A file read and previewed, waiting for Import or Cancel. */
interface Pending {
  prepared: PreparedImport;
  preview: HomebrewPreview;
  conversion?: ConversionReport;
}

/** Why a link was refused, and what to do instead. */
const refusedText = (reason: string) =>
  reason === REFUSED_HOST_REASON
    ? `${reason} For other sites, open the file, save it to this device, and bring it in as a file.`
    : reason;

export default function ImportSheet({
  onClose,
  onDone,
}: {
  /** Closed with nothing to report (swiped away, or Close). */
  onClose: () => void;
  /** Closed with an outcome for the home to show: imported, kept, canceled. */
  onDone: (message: string, failed: boolean) => void;
}) {
  const navigate = useNavigate();
  const [way, setWay] = useState<Way>('file');
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('spell');
  const [status, setStatusState] = useState<{ text: string; failed: boolean }>();
  const [refused, setRefused] = useState<{ url: string; reason: string }>();
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<Pending>();
  const reading = useRef<AbortController>(undefined);
  // Which read is the newest: an older one that finishes late is dropped.
  const latest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = useId();

  // A read no one will see the end of is stopped.
  useEffect(() => () => reading.current?.abort(), []);

  /** A message in the sheet, said once (A11Y-002); a check's line has a key of its own. */
  const setStatus = (words: string, failed = false, key = 'import') => {
    setStatusState({ text: words, failed });
    if (key !== 'import-check') cancelAnnouncement('import-check');
    announce(words, { key, repeat: true });
  };

  const words = way === 'text' && pastedKind(text) === 'words';
  const ready =
    !checking &&
    (way === 'file' ? file !== undefined : way === 'link' ? url.trim() !== '' : text.trim() !== '');

  /** Read what was given, the same way whichever it is, and preview it. */
  const read = async () => {
    if (!ready) return;
    reading.current?.abort();
    const run = new AbortController();
    reading.current = run;
    latest.current += 1;
    const request = latest.current;
    const from = way;
    setRefused(undefined);
    setChecking(true);
    setStatus(
      from === 'file' && file !== undefined
        ? `Checking "${file.name}"…`
        : from === 'link'
          ? 'Checking the file at that link…'
          : 'Checking the text…',
      false,
      'import-check',
    );
    const onProgress = (done: number, total: number) => {
      if (request !== latest.current || total <= 0) return;
      setStatusState({
        text: `Converting… ${Math.min(99, Math.floor((done / total) * 100))}%`,
        failed: false,
      });
    };
    try {
      let got: Read;
      if (from === 'file' && file !== undefined) {
        const parsed = await parseImportFile(file, { onProgress, signal: run.signal });
        got = {
          ...parsed,
          fileName: file.name,
          bytes: file.size,
          // A converted file came in under the limit for XML, which is higher.
          ...(parsed.conversion === undefined
            ? {}
            : { limitBytes: IMPORT_LIMITS.maxXmlImportBytes }),
        };
      } else if (from === 'link') {
        const fetched = await fetchHomebrewFromUrl(url.trim());
        got = fetched;
      } else {
        got = await parseImportPaste(text, { onProgress, signal: run.signal });
      }
      const prepared = await prepareHomebrewImport(got.raw, got.fileName, got.conversion, got.url);
      const preview = await buildHomebrewPreview(prepared, got.bytes, got.limitBytes);
      if (request !== latest.current) return;
      cancelAnnouncement('import-check');
      setStatusState(undefined);
      setPending({
        prepared,
        preview,
        ...(got.conversion === undefined ? {} : { conversion: got.conversion }),
      });
    } catch (err) {
      if (request !== latest.current) return;
      if (err instanceof NothingToImportError) {
        setStatus(`${err.message} Nothing was added.`, !err.allInstalled);
      } else if (err instanceof ImportCancelledError) {
        setStatus('Stopped. Nothing was added.');
      } else if (err instanceof HomebrewUrlRefusedError) {
        // Refused before any request: say why and offer the way that works.
        setStatusState(undefined);
        cancelAnnouncement('import-check');
        setRefused({ url: err.url, reason: err.message });
        announce(refusedText(err.message), { key: 'import', repeat: true });
      } else if (from === 'link') {
        // `fetch` rejects with a bare TypeError for a host that is down and
        // one that does not let the app read the file alike.
        const advice =
          err instanceof TypeError
            ? ' The site may be down or may not let the app read the file: download it and bring it in as a file.'
            : '';
        setStatus(`That link could not be read (${errorText(err)}).${advice}`, true);
      } else if (from === 'text' && err instanceof SyntaxError) {
        setStatus(`That text is not a homebrew file: ${err.message}`, true);
      } else {
        setStatus(`Import failed: ${errorText(err)}`, true);
      }
    } finally {
      if (request === latest.current) {
        setChecking(false);
        reading.current = undefined;
      }
    }
  };

  /** Import or Update pressed: store what the preview showed, through the one path. */
  const confirm = async (chosen?: ReadonlySet<string>, applyTo?: PackAppliesTo) => {
    const p = pending;
    if (p === undefined) return;
    setPending(undefined);
    const result = await commitHomebrewImport(p.prepared, chosen, applyTo);
    // A failure keeps the sheet and what was given, so it can be tried again.
    if (result.ok) onDone(result.message, false);
    else setStatus(result.message, true);
  };

  const keepExisting = () => {
    const p = pending;
    if (p === undefined) return;
    setPending(undefined);
    onDone(
      `Kept the existing "${p.preview.duplicateOf?.fileName ?? p.prepared.row.fileName}". Nothing was added.`,
      false,
    );
    // The file the player meant to bring in is not left hidden by a preset.
    void ensureSourcesVisible(p.prepared.row.sourceIds).catch((err: unknown) =>
      notifyFailure('Show sources', err),
    );
  };

  if (pending !== undefined) {
    return (
      <HomebrewImportPreview
        preview={pending.preview}
        {...(pending.conversion === undefined ? {} : { conversion: pending.conversion })}
        onImport={(chosen, applyTo) => void confirm(chosen, applyTo)}
        onCancel={() => {
          setPending(undefined);
          onDone('Import canceled. Nothing was added.', false);
        }}
        onKeepExisting={keepExisting}
        listedAt="under Collections"
      />
    );
  }

  const refusedHref = refused === undefined ? undefined : safeExternalHref(refused.url);
  /** Words for one entry: the editor takes them, in Text. */
  const openEditor = () =>
    navigate(`/workshop/new/${kind}`, { state: { seed: { entries: textToEntries(text) } } });

  return (
    <DialogFrame title="Import" onDismiss={onClose}>
      <form
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (words) openEditor();
          else void read();
        }}
      >
        <SegmentedControl label="Bring in" block options={WAYS} value={way} onChange={setWay} />

        {way === 'file' && (
          <div className="flex flex-col gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json,.xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f !== undefined) setFile(f);
                e.target.value = '';
              }}
            />
            <Button variant="outline" block onClick={() => fileInput.current?.click()}>
              <FileUp size={18} aria-hidden />
              {file === undefined ? 'Choose a file' : 'Choose another file'}
            </Button>
            {file !== undefined && (
              <p className="text-body break-words">
                <span className="text-body-strong">{file.name}</span>
                <span className="text-ink-muted">, {formatBytes(file.size)}</span>
              </p>
            )}
            <p className={NOTE}>
              A JSON homebrew file, with one book in it or many, or a Fight Club 5e compendium
              (XML), whose books each become a source in one collection.
            </p>
          </div>
        )}

        {way === 'link' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-link`} className="text-label text-ink-muted">
              Link to a JSON homebrew file
            </label>
            <input
              id={`${ids}-link`}
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="A GitHub, gist or jsDelivr link"
              className={fieldClass}
            />
            <p className={NOTE}>
              Bring in the same link again later and it updates the collection.
            </p>
          </div>
        )}

        {way === 'text' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-text`} className="text-label text-ink-muted">
              Paste a homebrew file, or one entry&rsquo;s words
            </label>
            <textarea
              id={`${ids}-text`}
              value={text}
              rows={8}
              onChange={(e) => setText(e.target.value)}
              className={`${fieldClass} min-h-48 py-3`}
            />
            {words ? (
              <>
                <label htmlFor={`${ids}-kind`} className="pt-2 text-label text-ink-muted">
                  These words are
                </label>
                <select
                  id={`${ids}-kind`}
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className={fieldClass}
                >
                  {WORD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {`A new ${kindOf(k).toLowerCase()}`}
                    </option>
                  ))}
                </select>
                <p className={NOTE}>
                  The editor opens with them in Text, and reads what it can. Check it before you
                  save.
                </p>
              </>
            ) : (
              <p className={NOTE}>
                A homebrew file&rsquo;s JSON lands as a collection. The words of one spell, item or
                feat open in the editor.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Button type="submit" variant="brand" block aria-disabled={!ready} aria-busy={checking}>
            {words ? 'Open in the editor' : 'Read it'}
          </Button>
          <p className={NOTE}>Nothing is saved yet.</p>
        </div>

        {/* Every message here is said through the announcer, so this is no live region. */}
        <div data-import-status="" className="flex flex-col gap-1.5 text-caption">
          {status !== undefined && (
            <p className={status.failed ? 'text-danger' : 'text-ink-muted'}>{status.text}</p>
          )}
          {checking && way !== 'link' && (
            <button type="button" onClick={() => reading.current?.abort()} className={LINK}>
              Stop reading
            </button>
          )}
          {refused !== undefined && (
            <>
              <p className="text-danger">{refusedText(refused.reason)}</p>
              <div className="flex flex-wrap gap-x-4">
                {refusedHref !== undefined && (
                  <a href={refusedHref} target="_blank" rel="noopener noreferrer" className={LINK}>
                    Open the file
                  </a>
                )}
                <button type="button" onClick={() => setWay('file')} className={LINK}>
                  Bring it in as a file
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </DialogFrame>
  );
}
