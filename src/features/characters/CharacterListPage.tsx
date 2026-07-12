import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Download, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { DATA_TAG } from '@/data5e/config';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistry } from '@/data5e/hooks';
import { invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import { migrateCharacter } from '@/engine/migrate';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { assertCharacterExport, CHARACTER_EXPORT_FORMAT } from '@/lib/guards';
import { askConfirm, askText } from '@/ui/dialogs';

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

interface Vitals {
  hp: number;
  maxHp: number;
  ac: number;
}

export function Component() {
  const navigate = useNavigate();
  const registry = useRegistry(['essentials']);
  const rows = useLiveQuery(async () => db.characters.orderBy('updatedAt').reverse().toArray(), []);
  const characters = (rows ?? []) as unknown as CharacterDoc[];
  const importInput = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string>();

  // At-a-glance vitals per character (few characters → deriving all is cheap).
  const vitals = useMemo(() => {
    const map = new Map<string, Vitals>();
    if (registry === null) return map;
    const ctx = engineContextFor(registry);
    for (const c of characters) {
      if (c.classes.length === 0) continue;
      try {
        const sheet = deriveSheet(c, ctx);
        map.set(c.id, { hp: c.play.currentHp, maxHp: sheet.maxHp.value, ac: sheet.ac.value });
      } catch {
        // skip a character that can't derive (e.g. missing homebrew)
      }
    }
    return map;
  }, [characters, registry]);

  // New characters open straight in the Build page (the primary editor).
  const createBlank = async () => {
    const doc = newCharacterDoc(crypto.randomUUID(), 'New hero', DATA_TAG);
    await characterRepo.put(doc);
    void navigate(`/c/${doc.id}/build`);
  };

  const rename = async (c: CharacterDoc) => {
    const name = await askText({ title: 'Rename hero', initial: c.name });
    if (name === null || name.trim() === '') return;
    void characterRepo.put({ ...c, name: name.trim(), updatedAt: new Date().toISOString() });
  };

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
              {(() => {
                const v = vitals.get(c.id);
                if (v === undefined) return null;
                const ratio = v.maxHp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 0;
                const color =
                  ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.25 ? 'bg-amber-400' : 'bg-accent';
                return (
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={`block h-full ${color}`}
                        style={{ width: `${ratio * 100}%` }}
                      />
                    </span>
                    <span className="font-mono">
                      {v.hp}/{v.maxHp}
                    </span>
                    <span>AC {v.ac}</span>
                  </div>
                );
              })()}
            </Link>
            <button
              type="button"
              title="Rename"
              onClick={() => void rename(c)}
              className="rounded p-2 text-ink-muted hover:bg-surface-2 hover:text-ink"
            >
              <Pencil size={16} />
            </button>
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
              onClick={async () => {
                const ok = await askConfirm({
                  title: `Delete ${c.name}?`,
                  detail: 'This cannot be undone.',
                  confirmLabel: 'Delete',
                  danger: true,
                });
                if (ok) void characterRepo.delete(c.id);
              }}
              className="rounded p-2 text-ink-muted hover:bg-accent-deep hover:text-ink"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void createBlank()}
        className="flex flex-col items-center rounded-lg bg-accent px-4 py-3 text-white"
      >
        <span className="flex items-center gap-2 font-semibold">
          <Plus size={18} /> New character
        </span>
        <span className="text-xs text-white/75">free-form editor — change anything, anytime</span>
      </button>
      <div className="flex gap-2">
        <Link
          to="/create"
          className="flex flex-1 flex-col items-center rounded-lg bg-surface px-4 py-2.5"
        >
          <span className="text-sm font-semibold">Guided wizard</span>
          <span className="text-[10px] text-ink-muted">step-by-step, good first time</span>
        </Link>
        <button
          type="button"
          onClick={() => importInput.current?.click()}
          className="flex flex-1 flex-col items-center rounded-lg bg-surface px-4 py-2.5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <FileUp size={16} /> Import
          </span>
          <span className="text-[10px] text-ink-muted">from an exported file</span>
        </button>
      </div>
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
