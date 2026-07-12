import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { EntriesView } from '@/data5e/entries/renderEntries';
import type { FeatureCard } from '@/engine/types';
import type { CharacterSheetState } from '../useCharacterSheet';

const GROUPS: Array<{ types: Array<FeatureCard['origin']['type']>; title: string }> = [
  { types: ['class', 'subclass'], title: 'Class features' },
  { types: ['race'], title: 'Species / race traits' },
  { types: ['background'], title: 'Background' },
  { types: ['feat'], title: 'Feats' },
  { types: ['item', 'custom', 'curated'], title: 'Other' },
];

function FeatureDetails({ f, open }: { f: FeatureCard; open: boolean }) {
  return (
    <details className="rounded-lg bg-surface p-3" open={open}>
      <summary className="cursor-pointer text-sm font-semibold">
        {f.name}
        <span className="ml-2 text-xs font-normal text-ink-muted">
          {f.origin.label !== f.name ? f.origin.label : ''}
          {f.level !== undefined ? ` · level ${f.level}` : ''}
        </span>
      </summary>
      <div className="mt-2 text-sm">
        <EntriesView entries={f.entries} />
      </div>
    </details>
  );
}

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const [filter, setFilter] = useState('');
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  const f = filter.trim().toLowerCase();
  const matches = (card: FeatureCard) => f === '' || card.name.toLowerCase().includes(f);
  const grouped = GROUPS.map((g) => ({
    title: g.title,
    cards: sheet.features
      .filter((card) => g.types.includes(card.origin.type) && matches(card))
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
  })).filter((g) => g.cards.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {sheet.pending.length > 0 && (
        <Link
          to="../build"
          className="block rounded-lg border border-amber-300/40 bg-amber-300/10 p-3 text-sm text-amber-200"
        >
          {sheet.pending.length} unresolved choice{sheet.pending.length > 1 ? 's' : ''} — tap to
          resolve in the Build tab.
        </Link>
      )}

      <label className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <Search size={16} className="shrink-0 text-ink-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter features & traits…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>

      {sheet.grantedSpells.length > 0 && f === '' && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink-muted">Innate & granted spells</h2>
          <div className="flex flex-col rounded-lg bg-surface">
            {sheet.grantedSpells.map((g) => (
              <Link
                key={`${g.name}|${g.source}`}
                to={`/library/spell/${encodeURIComponent(`${g.name}|${g.source}`.toLowerCase())}`}
                className="flex items-center justify-between border-b border-surface-2/40 px-3 py-2 text-sm last:border-b-0"
              >
                <span className="capitalize">{g.name}</span>
                <span className="text-xs text-ink-muted">
                  {g.origin}
                  {g.ability !== undefined ? ` · ${g.ability.toUpperCase()}` : ''}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {grouped.map((g) => (
        <section key={g.title} className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-ink-muted">{g.title}</h2>
          {g.cards.map((card, i) => (
            <FeatureDetails
              // biome-ignore lint/suspicious/noArrayIndexKey: repeated feature names (e.g. ASI) need the index; list is derivation-stable
              key={`${card.origin.uid}:${card.name}:${i}`}
              f={card}
              open={f !== ''}
            />
          ))}
        </section>
      ))}
      {grouped.length === 0 && f !== '' && (
        <p className="text-sm text-ink-muted">Nothing matches "{filter}".</p>
      )}

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
