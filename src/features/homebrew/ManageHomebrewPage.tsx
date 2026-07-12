import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileUp, Hammer, LinkIcon, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { db, type HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { askConfirm, askText } from '@/ui/dialogs';

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.endsWith('.json') ? name : `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Component() {
  const navigate = useNavigate();
  const rows = useLiveQuery(
    async () => db.homebrewFiles.orderBy('addedAt').reverse().toArray(),
    [],
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<string>();

  const importFile = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const row = await homebrewRepo.importJson(raw, file.name);
      invalidateRegistry();
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
      setStatus(`Imported "${row.fileName}"`);
      setUrl('');
    } catch (err) {
      setStatus(
        `URL import failed (${err instanceof Error ? err.message : String(err)}). If this is a CORS error, download the file and import it instead.`,
      );
    }
  };

  const summary = (r: HomebrewFileRow) =>
    Object.entries(r.counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ') || 'no recognized entities';

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Homebrew</h1>
        <Link to="/" className="text-sm text-ink-muted hover:text-ink">
          Characters
        </Link>
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
            const row = await homebrewRepo.createEditable(name.trim(), abbrev.trim() || 'HB');
            invalidateRegistry();
            void navigate(`/homebrew/edit/${row.id}`);
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

      <div className="flex flex-col gap-2">
        {(rows ?? []).map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg bg-surface p-3">
            <button
              type="button"
              onClick={() => {
                void homebrewRepo.setEnabled(r.id, !r.enabled).then(invalidateRegistry);
              }}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                r.enabled ? 'border-purple-300 text-purple-300' : 'border-surface-2 text-ink-muted'
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
              onClick={() => downloadJson(r.fileName, r.json)}
              className="shrink-0 rounded p-1.5 text-ink-muted hover:text-ink"
            >
              <Download size={15} />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Remove "${r.fileName}"?`,
                  detail: 'Characters using it will show warnings.',
                  confirmLabel: 'Remove',
                  danger: true,
                });
                if (ok) void homebrewRepo.delete(r.id).then(invalidateRegistry);
              }}
              className="shrink-0 rounded p-1.5 text-ink-muted hover:text-accent"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {rows !== undefined && rows.length === 0 && (
          <p className="text-sm text-ink-muted">No homebrew imported yet.</p>
        )}
      </div>
    </main>
  );
}
