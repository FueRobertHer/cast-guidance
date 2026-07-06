import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import type { CharacterDoc } from '@/engine/types';

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
    </main>
  );
}
