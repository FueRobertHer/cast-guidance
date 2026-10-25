import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileUp, Hammer, LinkIcon, Pencil, Trash2 } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import type { HomebrewFileRow } from '@/db/db';
import { type HomebrewFile, homebrewRepo } from '@/db/homebrewRepo';
import { readFileTextBounded } from '@/lib/boundedRead';
import { downloadJson } from '@/lib/download';
import { IMPORT_LIMITS } from '@/lib/guards';
import { safeExternalHref } from '@/lib/url';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce } from '@/stores/announcer';
import { errorText, notifyFailure } from '@/stores/notices';
import { DecodeBoundary } from '@/ui/DecodeBoundary';
import { askConfirm, askText } from '@/ui/dialogs';
import { REFUSED_HOST_REASON } from './homebrewUrl';
import type { HomebrewPreview } from './importPreview';
import { fetchHomebrewFromUrl, HomebrewUrlRefusedError } from './importUrl';

/**
 * The import preview (IMP-002), its gathering and its commit, loaded once an
 * import starts. Kept out of the page's own chunk, and so out of the entry
 * chunk's list of what each page needs.
 */
const loadImportFlow = () => import('./HomebrewImportPreview');
const HomebrewImportPreview = lazy(loadImportFlow);

/**
 * Why a URL was refused, and what to do instead. The other-sites advice
 * answers a host refusal only; a malformed or http URL, or a GitHub folder
 * page, has its own fix.
 */
function refusedText(reason: string): string {
  return reason === REFUSED_HOST_REASON
    ? `${reason} For other sites, open the file, save it to this device, and use Import file.`
    : reason;
}

/** A file validated and previewed, waiting for the player's answer. */
interface PendingImport {
  row: HomebrewFileRow;
  preview: HomebrewPreview;
  source: 'file' | 'url';
}

export function Component() {
  usePageTitle('Homebrew');
  const navigate = useNavigate();
  // Unreadable files are reported here, the one screen that can remove them.
  const read = useLiveQuery(() => homebrewRepo.listSafe(), []);
  const rows = read?.files;
  const readErrors = read?.errors ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [status, setStatusText] = useState<string>();
  // A URL the import would not fetch, kept so the guidance can link to it.
  const [refused, setRefusedState] = useState<{ url: string; reason: string }>();
  /**
   * The import messages, on screen and said (A11Y-002). The lines below are
   * plain visuals and each message goes through the announcer once: the check
   * in progress, then its outcome (imported, already here, canceled, kept the
   * existing file, failed or refused). Each answers something the person did,
   * so the same words twice are said twice. The check has a key of its own,
   * so its answer is not held behind it by the outcome key's throttle.
   */
  const setStatus = (text: string | undefined, key = 'import') => {
    setStatusText(text);
    if (text !== undefined) announce(text, { key, repeat: true });
  };
  const setRefused = (next: { url: string; reason: string } | undefined) => {
    setRefusedState(next);
    if (next !== undefined) announce(refusedText(next.reason), { key: 'import', repeat: true });
  };
  // An import validated and previewed, waiting for Import or Cancel. Nothing
  // is written until Import.
  const [pending, setPending] = useState<PendingImport>();
  const [checking, setChecking] = useState(false);
  // Which check is the latest. A slow check (a registry read during a first
  // download) must not land after a newer one and swap its preview in, or
  // Import would store a file the dialog no longer showed.
  const latest = useRef(0);
  const begin = (message: string): number => {
    setRefused(undefined);
    setStatus(message, 'import-check');
    setChecking(true);
    latest.current += 1;
    return latest.current;
  };
  const finish = (request: number) => {
    if (request === latest.current) setChecking(false);
  };

  /** Work out what the prepared file would do, then show it if still wanted. */
  const showPreview = async (
    request: number,
    row: HomebrewFileRow,
    bytes: number,
    source: 'file' | 'url',
  ) => {
    const preview = await (await loadImportFlow()).buildHomebrewPreview(row, bytes);
    if (request !== latest.current) return;
    setStatus(undefined);
    setPending({ row, preview, source });
  };

  // Validation and the preview write nothing, so a failure before Import is
  // never a storage one: the error's own message says what went wrong.
  const importFile = async (file: File) => {
    const request = begin(`Checking "${file.name}"…`);
    try {
      const raw: unknown = JSON.parse(
        await readFileTextBounded(file, IMPORT_LIMITS.maxImportBytes),
      );
      const row = await homebrewRepo.prepare(raw, file.name);
      await showPreview(request, row, file.size, 'file');
    } catch (err) {
      if (request === latest.current) setStatus(`Import failed: ${errorText(err)}`);
    } finally {
      finish(request);
    }
  };

  const importUrl = async () => {
    const request = begin('Checking the file at that URL…');
    try {
      const fetched = await fetchHomebrewFromUrl(url);
      const row = await homebrewRepo.prepare(fetched.raw, fetched.fileName, fetched.url);
      await showPreview(request, row, fetched.bytes, 'url');
    } catch (err) {
      if (request !== latest.current) return;
      if (err instanceof HomebrewUrlRefusedError) {
        // Refused before any request: say why and offer the way that works.
        setStatus(undefined);
        setRefused({ url: err.url, reason: err.message });
        return;
      }
      // `fetch` rejects with a bare TypeError for an unreachable host and for
      // one that does not allow cross-site reads alike, so the advice covers
      // both. Anything else (an HTTP status, a file that is not homebrew)
      // already says what went wrong.
      const advice =
        err instanceof TypeError
          ? ' The host may be down or may not allow the app to read the file; download it and use Import file instead.'
          : '';
      setStatus(`URL import failed (${errorText(err)}).${advice}`);
    } finally {
      finish(request);
    }
  };

  /** Starting another import while one is being checked waits for it. */
  const chooseFile = () => {
    if (!checking) fileInput.current?.click();
  };

  /** Import pressed in the preview: store the file the preview described. */
  const confirmImport = async () => {
    const p = pending;
    if (p === undefined) return;
    setPending(undefined);
    const result = await (await loadImportFlow()).commitHomebrewImport(p.row);
    // The URL stays in the field until its file is stored, so a failure can
    // be retried without typing it again.
    if (result.ok && p.source === 'url') setUrl('');
    setStatus(result.message);
  };

  const cancelImport = () => {
    setPending(undefined);
    setStatus('Import canceled. Nothing was added.');
  };

  const keepExisting = () => {
    const p = pending;
    if (p === undefined) return;
    setPending(undefined);
    setStatus(
      `Kept the existing "${p.preview.duplicateOf?.fileName ?? p.row.fileName}". Nothing was added.`,
    );
    // As the old flow did for a file imported twice: its sources are shown,
    // so the file the player meant to bring in is not left hidden by a preset.
    void ensureSourcesVisible(p.row.sourceIds).catch((err: unknown) =>
      notifyFailure('Show sources', err),
    );
  };

  /** Only a plain http(s) URL becomes a link; anything else stays text. */
  const refusedHref = refused === undefined ? undefined : safeExternalHref(refused.url);

  /**
   * Removing a file, from a row the page can render and from one it cannot: an
   * unreadable file is the one you most want gone, and the id is all a delete
   * needs, which the boundary hands over even when it refuses the rest.
   */
  const remove = async (id: string, name: string) => {
    const ok = await askConfirm({
      title: `Remove "${name}"?`,
      detail: 'Characters using it will show warnings.',
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await homebrewRepo.delete(id);
      invalidateRegistry();
    } catch (err) {
      notifyFailure('Remove', err);
    }
  };

  /** Counts are a plain record by the time a file is here: see the boundary. */
  const summary = (r: HomebrewFile) =>
    Object.entries(r.counts)
      .map(([k, v]) => `${String(v)} ${k}`)
      .join(' · ') || 'no recognized entities';

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Homebrew</h1>
      </header>

      <p className="text-sm text-ink-muted">
        Import 5etools-format homebrew JSON. Imported content appears alongside official content
        everywhere: in the creator, the library and search. You see what a file adds before it is
        imported.
      </p>

      <div className="flex flex-col gap-2">
        {/* aria-disabled rather than disabled while a file is checked, so the
            button keeps focus: the preview hands focus back to it. */}
        <button
          type="button"
          onClick={chooseFile}
          aria-disabled={checking}
          aria-busy={checking}
          className="tap gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white aria-disabled:opacity-60"
        >
          <FileUp size={16} /> Import file
        </button>
        <button
          type="button"
          onClick={async () => {
            const name = await askText({
              title: 'Homebrew collection name',
              placeholder: 'e.g. "My Table\'s Brews"',
            });
            if (name === null || name.trim() === '') return;
            const suggested = name
              .split(/\s+/)
              .map((w) => w[0]?.toUpperCase() ?? '')
              .join('')
              .slice(0, 5);
            const abbrev =
              (await askText({
                title: 'Short source id (shown on badges)',
                initial: suggested,
              })) ?? 'HB';
            try {
              const row = await homebrewRepo.createEditable(name.trim(), abbrev.trim() || 'HB');
              invalidateRegistry();
              await ensureSourcesVisible(row.sourceIds);
              void navigate(`/homebrew/edit/${row.id}`);
            } catch (err) {
              // Navigating to a collection the database never got would open an
              // editor onto nothing, so the failure stops here and says so.
              setStatus(`Could not create the collection: ${errorText(err)}`);
            }
          }}
          className="tap gap-2 rounded-lg border border-purple-300/40 px-4 py-2.5 text-sm font-semibold text-purple-300"
        >
          <Hammer size={16} /> Create your own homebrew
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f !== undefined) void importFile(f);
            e.target.value = '';
          }}
        />
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() !== '' && !checking) void importUrl();
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Homebrew JSON URL"
            placeholder="…or paste a GitHub, gist, or jsDelivr JSON URL"
            className="min-h-11 min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
          />
          <button
            type="submit"
            aria-label="Import from URL"
            title="Import from URL"
            aria-disabled={checking}
            aria-busy={checking}
            className="tap rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold aria-disabled:opacity-60"
          >
            <LinkIcon size={16} />
          </button>
        </form>
        {/* Every import message, as a plain visual: `setStatus` and
            `setRefused` say each one through the announcer, so a live role
            here would say it twice (A11Y-002). */}
        <div data-import-status="" className="flex flex-col gap-1.5 text-xs text-amber-300">
          {status !== undefined && <p>{status}</p>}
          {refused !== undefined && (
            <>
              <p>{refusedText(refused.reason)}</p>
              <div className="flex gap-3">
                {refusedHref !== undefined && (
                  <a
                    href={refusedHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    Open file
                  </a>
                )}
                <button type="button" onClick={chooseFile} className="font-semibold underline">
                  Import file
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {pending !== undefined && (
        <Suspense fallback={null}>
          <HomebrewImportPreview
            preview={pending.preview}
            onImport={() => void confirmImport()}
            onCancel={cancelImport}
            onKeepExisting={keepExisting}
          />
        </Suspense>
      )}

      {readErrors.length > 0 && (
        <p className="rounded-lg bg-accent-deep px-3 py-2 text-xs" role="alert">
          {readErrors.length} file{readErrors.length > 1 ? 's' : ''} on this device could not be
          read and {readErrors.length > 1 ? 'are' : 'is'} not in use. The rest of your homebrew is
          unaffected.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {(rows ?? []).map((r) => (
          // A file the list cannot render is exactly the file you came here to
          // remove, so the failure stays in its own row and the rest of the
          // library, and its controls, keep working.
          <DecodeBoundary key={r.id} label="This file">
            <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
              {/* A stable verb for the name, so the state is announced once: by
                  aria-pressed, not again by the flipping visible text. */}
              <button
                type="button"
                aria-label={`Enable ${r.fileName}`}
                aria-pressed={r.enabled}
                onClick={() => {
                  // The label reads from the row, so a rejected write leaves the
                  // badge saying what is actually stored; the toast is what says
                  // the press did not take. Pressing again is the retry.
                  void homebrewRepo
                    .setEnabled(r.id, !r.enabled)
                    .then(invalidateRegistry)
                    .catch((err: unknown) => notifyFailure(r.enabled ? 'Disable' : 'Enable', err));
                }}
                className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                  r.enabled
                    ? 'border-purple-300 text-purple-300'
                    : 'border-surface-2 text-ink-muted'
                }`}
              >
                {r.enabled ? 'enabled' : 'disabled'}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.fileName}</div>
                <div className="truncate text-xs text-ink-muted">{summary(r)}</div>
              </div>
              {r.editable && (
                <Link
                  to={`/homebrew/edit/${r.id}`}
                  aria-label={`Edit ${r.fileName} in the builder`}
                  title="Edit in the builder"
                  className="shrink-0 rounded p-1.5 text-purple-300 hover:text-purple-200"
                >
                  <Pencil size={15} />
                </Link>
              )}
              <button
                type="button"
                aria-label={`Download ${r.fileName}`}
                title="Download"
                onClick={() => {
                  try {
                    downloadJson(r.fileName, r.json);
                  } catch (err) {
                    notifyFailure('Download', err);
                  }
                }}
                className="shrink-0 rounded p-1.5 text-ink-muted hover:text-ink"
              >
                <Download size={15} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${r.fileName}`}
                title="Delete"
                onClick={() => void remove(r.id, r.fileName)}
                className="shrink-0 rounded p-1.5 text-ink-muted hover:text-accent"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </DecodeBoundary>
        ))}
        {readErrors.map((e) => {
          // A local binding, so the id stays narrowed inside the handler.
          const id = e.id;
          return (
            <div
              key={id ?? e.fileName ?? e.message}
              className="flex items-center gap-2 rounded-lg border border-amber-300/40 bg-surface p-3"
            >
              <AlertTriangle size={15} className="shrink-0 text-amber-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {e.fileName ?? 'An unnamed file'}
                </div>
                <div className="truncate text-xs text-ink-muted">{e.message}</div>
              </div>
              {id !== undefined && (
                <button
                  type="button"
                  aria-label={`Delete ${e.fileName ?? 'this unreadable file'}`}
                  title="Delete"
                  onClick={() => void remove(id, e.fileName ?? 'this file')}
                  className="shrink-0 rounded p-1.5 text-ink-muted hover:text-accent"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          );
        })}
        {rows !== undefined && rows.length === 0 && readErrors.length === 0 && (
          <p className="text-sm text-ink-muted">No homebrew imported yet.</p>
        )}
      </div>
    </main>
  );
}
