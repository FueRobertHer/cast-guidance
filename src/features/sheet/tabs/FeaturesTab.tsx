import { useOutletContext } from 'react-router';
import { EntriesView } from '@/data5e/entries/renderEntries';
import type { CharacterSheetState } from '../useCharacterSheet';

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  const sorted = [...sheet.features].sort((a, b) => (a.level ?? 0) - (b.level ?? 0));

  return (
    <div className="flex flex-col gap-4">
      {sheet.pending.length > 0 && (
        <p className="rounded-lg border border-amber-300/40 bg-surface p-3 text-sm text-amber-300">
          {sheet.pending.length} unresolved choice{sheet.pending.length > 1 ? 's' : ''} — finish
          them in the creator or level-up flow.
        </p>
      )}

      {sorted.map((f, i) => (
        <details
          // biome-ignore lint/suspicious/noArrayIndexKey: repeated feature names (e.g. ASI) need the index; list is derivation-stable
          key={`${f.origin.uid}:${f.name}:${i}`}
          className="rounded-lg bg-surface p-3"
          open={i < 3}
        >
          <summary className="cursor-pointer text-sm font-semibold">
            {f.name}
            <span className="ml-2 text-xs font-normal text-ink-muted">
              {f.origin.label}
              {f.level !== undefined ? ` · level ${f.level}` : ''}
            </span>
          </summary>
          <div className="mt-2 text-sm">
            <EntriesView entries={f.entries} />
          </div>
        </details>
      ))}

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink-muted">Notes</h2>
        <textarea
          value={doc.notes}
          onChange={(e) => update((d) => void (d.notes = e.target.value))}
          rows={6}
          placeholder="Session notes, goals, contacts…"
          className="rounded-lg bg-surface p-3 text-sm outline-none placeholder:text-ink-muted"
        />
      </section>
    </div>
  );
}
