import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Download, FileUp, Hammer, LinkIcon, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import { type HomebrewFile, homebrewRepo } from '@/db/homebrewRepo';
import { downloadJson } from '@/lib/download';
import { errorText, notifyFailure } from '@/stores/notices';
import { DecodeBoundary } from '@/ui/DecodeBoundary';
import { askConfirm, askText } from '@/ui/dialogs';

export function Component() {
  const navigate = useNavigate();
  // Through the read boundary (REL-006): a row the app cannot read is reported
  // here, on the one screen that can remove it, rather than reaching the
  // registry and taking the compendium down with it.
  const read = useLiveQuery(() => homebrewRepo.listSafe(), []);
  const rows = read?.files;
  const readErrors = read?.errors ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<string>();

  const importFile = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const row = await homebrewRepo.importJson(raw, file.name);
      invalidateRegistry();
      // Imported content the player cannot see is worse than useless, and a
      // preset (allow list) would hide it by default.
      await ensureSourcesVisible(row.sourceIds);
      setStatus(
        `Imported "${row.fileName}" (${
          Object.entries(row.counts)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ') || 'no recognized entities'
        })`,
      );
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const importUrl = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw: unknown = await res.json();
      const name = url.split('/').pop() ?? 'homebrew.json';
      const row = await homebrewRepo.importJson(raw, decodeURIComponent(name), url);
      invalidateRegistry();
      await ensureSourcesVisible(row.sourceIds);
      setStatus(`Imported "${row.fileName}"`);
      setUrl('');
    } catch (err) {
      setStatus(
        `URL import failed (${err instanceof Error ? err.message : String(err)}). If this is a CORS error, download the file and import it instead.`,
      );
    }
  };

  /**
   * Removing a file, from a row the page can render and from one it cannot.
   * An unreadable file is the one file you most want gone, so it gets the same
   * delete as any other: the id is all a delete needs, and the boundary hands
   * that over even when it refuses everything else about the row.
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
        Import 5etools-format homebrew JSON. Imported content appears everywhere — creator, library,
        search — alongside official content.
      </p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
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
          className="flex items-center justify-center gap-2 rounded-lg border border-purple-300/40 px-4 py-2.5 text-sm font-semibold text-purple-300"
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
            if (url.trim() !== '') void importUrl();
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or paste a raw JSON URL (GitHub raw, gist)"
            className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
          />
          <button type="submit" className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold">
            <LinkIcon size={16} />
          </button>
        </form>
        {status !== undefined && <p className="text-xs text-amber-300">{status}</p>}
      </div>

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
              <button
                type="button"
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
                  title="Edit in the builder"
                  className="shrink-0 rounded p-1.5 text-purple-300 hover:text-purple-200"
                >
                  <Pencil size={15} />
                </Link>
              )}
              <button
                type="button"
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
