import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Download, FileUp, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { migrateCharacter } from '@/engine/migrate';
import type { CharacterDoc } from '@/engine/types';
import { assertCharacterExport, CHARACTER_EXPORT_FORMAT } from '@/lib/guards';

async function exportCharacter(doc: CharacterDoc): Promise<void> {
  // Embed all enabled homebrew — files are small and this keeps exports self-contained.
  const homebrew = await homebrewRepo.enabled();
  const payload = { $format: CHARACTER_EXPORT_FORMAT, character: doc, homebrew };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.name.replaceAll(/[^\w-]+/g, '_') || 'character'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importCharacter(file: File): Promise<string> {
  const parsed = assertCharacterExport(JSON.parse(await file.text()));
  const doc = migrateCharacter(parsed.character);
  for (const brew of parsed.homebrew) {
    const existing = await homebrewRepo.get(brew.id);
    if (existing === undefined) {
      await db.homebrewFiles.put({ ...brew, addedAt: Date.now() });
    }
  }
  if (parsed.homebrew.length > 0) invalidateRegistry();
  const existing = await characterRepo.get(doc.id);
  const finalDoc = existing !== undefined ? { ...doc, id: crypto.randomUUID() } : doc;
  await characterRepo.put(finalDoc);
  return finalDoc.name;
}

function classSummary(doc: CharacterDoc): string {
  if (doc.classes.length === 0) return 'No class yet';
  return doc.classes
    .map(
      (c) => `${c.ref.name} ${c.levels}${c.subclass !== undefined ? ` · ${c.subclass.name}` : ''}`,
    )
    .join(' / ');
}

export function Component() {
  const rows = useLiveQuery(async () => db.characters.orderBy('updatedAt').reverse().toArray(), []);
  const characters = (rows ?? []) as unknown as CharacterDoc[];
  const importInput = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string>();

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Characters</h1>
        <nav className="flex gap-3 text-sm text-ink-muted">
          <Link to="/library" className="hover:text-ink">
            Library
          </Link>
          <Link to="/homebrew" className="hover:text-ink">
            Homebrew
          </Link>
          <Link to="/settings" className="hover:text-ink">
            Settings
          </Link>
        </nav>
      </header>

      {characters.length === 0 && rows !== undefined && (
        <p className="text-sm text-ink-muted">No characters yet — create your first hero.</p>
      )}

      <div className="flex flex-col gap-2">
        {characters.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg bg-surface p-3">
            <Link to={`/c/${c.id}`} className="min-w-0 flex-1">
              <div className="truncate font-semibold">{c.name}</div>
              <div className="truncate text-xs text-ink-muted">
                {classSummary(c)}
                {c.race !== undefined ? ` · ${c.race.name}` : ''}
                {` · ${c.rulesVersion}`}
              </div>
            </Link>
            <button
              type="button"
              title="Export"
              onClick={() => void exportCharacter(c)}
              className="rounded p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              title="Duplicate"
              onClick={() => void characterRepo.duplicate(c.id)}
              className="rounded p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => {
                if (window.confirm(`Delete ${c.name}? This cannot be undone.`)) {
                  void characterRepo.delete(c.id);
                }
              }}
              className="rounded p-2 text-ink-muted hover:bg-accent-deep hover:text-ink"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <Link
        to="/create"
        className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-semibold text-white"
      >
        <Plus size={18} /> New character
      </Link>
      <button
        type="button"
        onClick={() => importInput.current?.click()}
        className="flex items-center justify-center gap-2 rounded-lg bg-surface px-4 py-2.5 text-sm font-semibold"
      >
        <FileUp size={16} /> Import character
      </button>
      <input
        ref={importInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) {
            importCharacter(f)
              .then((name) => setImportStatus(`Imported ${name}`))
              .catch((err: unknown) =>
                setImportStatus(
                  `Import failed: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          }
          e.target.value = '';
        }}
      />
      {importStatus !== undefined && <p className="text-xs text-amber-300">{importStatus}</p>}
    </main>
  );
}
