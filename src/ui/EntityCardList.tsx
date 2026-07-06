import { useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { SourceBadge } from '@/ui/SourceBadge';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

/** Filterable pick-one card grid used by the wizard and the build editor. */
export function EntityCardList({
  entities,
  selectedUid,
  onSelect,
}: {
  entities: readonly Entity[];
  selectedUid?: string;
  onSelect: (e: Entity) => void;
}) {
  const [filter, setFilter] = useState('');
  const list = useMemo(() => {
    const sorted = [...entities].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const f = filter.trim().toLowerCase();
    return f === '' ? sorted : sorted.filter((e) => nameOf(e).toLowerCase().includes(f));
  }, [entities, filter]);
  return (
    <div className="flex flex-col gap-2">
      {entities.length > 10 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
        />
      )}
      <div className="grid max-h-96 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {list.map((e) => (
          <button
            key={uidOf(e)}
            type="button"
            onClick={() => onSelect(e)}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
              selectedUid === uidOf(e)
                ? 'border-accent bg-accent-deep/40 font-semibold'
                : 'border-surface-2 bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="truncate">{nameOf(e)}</span>
            <SourceBadge source={sourceOf(e)} />
          </button>
        ))}
      </div>
    </div>
  );
}
