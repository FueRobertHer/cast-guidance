import { ChevronRight, Lightbulb, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { flattenEntries } from '@/engine/effects/proseScan';
import type { FeatureCard } from '@/engine/types';
import { listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import type { BuildFrom } from '../SheetLayout';
import { SpellInfoSheet } from '../SpellInfoSheet';
import type { CharacterSheetState } from '../useCharacterSheet';

const GROUPS: Array<{ types: Array<FeatureCard['origin']['type']>; title: string }> = [
  { types: ['class', 'subclass'], title: 'Class features' },
  { types: ['race'], title: 'Species / race traits' },
  { types: ['background'], title: 'Background' },
  { types: ['feat'], title: 'Feats' },
  { types: ['item', 'custom', 'curated'], title: 'Other' },
];

/** A section heading inside a screen, as Settings has them. */
const H2 = 'px-1 text-heading';

function FeatureDetails({ f, open }: { f: FeatureCard; open: boolean }) {
  const origin = `${f.origin.label !== f.name ? f.origin.label : ''}${
    f.level !== undefined ? ` · level ${f.level}` : ''
  }`;
  return (
    <details
      className="group rounded-card bg-surface shadow-card ring-1 ring-line ring-inset"
      open={open}
    >
      <summary className="flex min-h-tap cursor-pointer list-none items-baseline gap-2 px-4 py-3 text-body-strong">
        <ChevronRight
          size={16}
          aria-hidden="true"
          className="shrink-0 self-center text-ink-muted transition-transform duration-200 group-open:rotate-90"
        />
        {/* Name and origin wrap as two pieces, so with large text the origin
            drops to its own line instead of pushing past the card. */}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0">{f.name}</span>
          {origin !== '' && (
            <span className="min-w-0 font-normal text-caption text-ink-muted">{origin}</span>
          )}
        </span>
      </summary>
      {/* `wrap-anywhere`: rules text can hold one long unbroken token (a
          raw tag), which at large text would push past the card. */}
      <div className="px-4 pb-4 text-body wrap-anywhere">
        <EntriesView entries={f.entries} />
      </div>
    </details>
  );
}

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const [filter, setFilter] = useState('');
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;

  const f = filter.trim().toLowerCase();
  // Match the card title, the origin, AND the full trait text — so "breath"
  // finds Breath Weapon nested inside the Dragonborn card, not just top-level
  // card names.
  const matches = (card: FeatureCard) =>
    f === '' ||
    card.name.toLowerCase().includes(f) ||
    card.origin.label.toLowerCase().includes(f) ||
    flattenEntries(card.entries).includes(f);
  const grouped = GROUPS.map((g) => ({
    title: g.title,
    cards: sheet.features
      .filter((card) => g.types.includes(card.origin.type) && matches(card))
      .sort((a, b) => (a.level ?? 0) - (b.level ?? 0)),
  })).filter((g) => g.cards.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {sheet.pending.length > 0 && (
        // Choices waiting on the player are guidance (DS-001): `guide-soft`,
        // with the guide's lightbulb.
        // From Features, so Back on Build returns here (SheetLayout's BuildFrom).
        <Link
          to="../build"
          state={{ sheetFrom: 'features' } satisfies BuildFrom}
          className="flex gap-3 rounded-control bg-guide-soft px-3 py-3 text-body text-ink"
        >
          <Lightbulb size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-guide" />
          <span>
            {sheet.pending.length} unresolved choice{sheet.pending.length > 1 ? 's' : ''}. Tap to
            resolve {sheet.pending.length > 1 ? 'them' : 'it'} in Build.
          </span>
        </Link>
      )}

      <div className="relative">
        <Search
          size={20}
          aria-hidden="true"
          className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter features and traits"
          placeholder="Filter features & traits…"
          className={`${fieldClass} pl-10.5`}
        />
      </div>

      {sheet.grantedSpells.length > 0 && f === '' && (
        <section className="flex flex-col gap-2">
          <h2 className={H2}>Innate & granted spells</h2>
          <div className={listClass}>
            {sheet.grantedSpells.map((g) => (
              <SpellInfoSheet
                key={`${g.name}|${g.source}`}
                name={g.name}
                source={g.source}
                version={doc.rulesVersion}
                subtitle={`${g.origin}${g.usage === 'prepared' ? ' · always prepared' : ''}`}
                trigger={
                  <button
                    type="button"
                    className="flex min-h-tap w-full items-center justify-between gap-3 px-4 py-2 text-left text-body transition-colors duration-120 hover:bg-surface-raised"
                  >
                    <span className="capitalize">{g.name}</span>
                    <span className="text-caption text-ink-muted">
                      {g.origin}
                      {g.ability !== undefined ? ` · ${g.ability.toUpperCase()}` : ''}
                    </span>
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {grouped.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h2 className={H2}>{g.title}</h2>
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
        <p className="px-1 text-body text-ink-muted">Nothing matches "{filter}".</p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className={H2}>Notes</h2>
        {/* The field look (`fieldClass`), grown to its rows instead of 48px. */}
        <textarea
          value={doc.notes}
          onChange={(e) => update((d) => void (d.notes = e.target.value))}
          rows={6}
          aria-label="Notes"
          placeholder="Session notes, goals, contacts…"
          className="w-full rounded-control bg-surface-raised px-4 py-3 text-input text-ink ring-inset transition-shadow duration-120 placeholder:text-ink-faint hover:ring-1 hover:ring-line-strong"
        />
      </section>
    </div>
  );
}
