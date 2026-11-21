import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { EntityRegistry } from '@/data5e/normalize';
import {
  ALLOW_ALL,
  isPolicyNarrowed,
  policyAllows,
  SOURCE_PRESETS,
  type SourcePolicy,
  updateSourcePolicy,
  useSourcePolicy,
  withSource,
} from '@/data5e/sourceFilter';
import {
  knownSources,
  SOURCE_GROUP_LABELS,
  SOURCE_GROUPS,
  type SourceGroup,
  sourceGroup,
  sourceName,
} from '@/data5e/sourceNames';
import { notifyFailure } from '@/stores/notices';
import { Chip } from '@/ui/Chip';
import { useRegistryRead } from './registryRead';

/** Every book the source table knows. */
const KNOWN = new Set(knownSources());

interface Row {
  source: string;
  name: string;
  count: number;
  section: SourceGroup;
  enabled: boolean;
}

function SourceToggle({ row, onToggle }: { row: Row; onToggle: (enabled: boolean) => void }) {
  return (
    <label className="flex min-h-tap flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-body hover:bg-surface-raised">
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-4 shrink-0 accent-ink"
      />
      {/* Wraps, never cut off: a long book name, or its code and count past the edge at large text (bug 11). */}
      <span
        className={`min-w-0 flex-1 basis-32 break-words ${row.enabled ? '' : 'text-ink-muted'}`}
      >
        {row.name}
      </span>
      <span className="shrink-0 text-ink-muted text-overline uppercase">{row.source}</span>
      <span className="w-12 shrink-0 text-right text-caption text-ink-muted">{row.count}</span>
    </label>
  );
}

/**
 * The registry and the sources the stored files declare (a collection's,
 * never a book's), read together: the sources are those of the rows the
 * registry was read for, so a collection deleted or added since, here or in
 * another tab, is never told from a book by one and counted by the other.
 * Undefined until both are read, and the registry's own read is in.
 */
function useBooksRead():
  | { registry: EntityRegistry | null; brewSources: Set<string>; failed: boolean }
  | undefined {
  const { registry, rows, ready, failed } = useRegistryRead();
  const brewSources = useMemo(
    () => (rows === undefined ? undefined : new Set(rows.flatMap((r) => r.sourceIds))),
    [rows],
  );
  if (!ready || brewSources === undefined) return undefined;
  return { registry, brewSources, failed };
}

/** How many books show, of how many on the device. */
export interface BooksShown {
  shown: number;
  total: number;
}

/**
 * How many of the books show on this device, as The books lists them
 * (collections left out): Settings' row says it. Undefined until the
 * registry and the collections' sources are read, since before that a book
 * cannot be told from a collection, or the books counted; `failed` when the
 * registry could not be read and there is none in hand.
 */
export function useBooksShown(): BooksShown | 'failed' | undefined {
  const read = useBooksRead();
  const policy = useSourcePolicy();
  if (read === undefined) return undefined;
  const { registry, brewSources, failed } = read;
  if (registry === null) return failed ? 'failed' : undefined;
  const books = [...registry.sourceCounts().keys()].filter((s) => !brewSources.has(s));
  return { shown: books.filter((s) => policyAllows(policy, s)).length, total: books.length };
}

/** Settings' words for which books show ("12 of 119 books show"). */
export function booksShownWords(shown: BooksShown | 'failed' | undefined): string {
  if (shown === undefined) return 'Loading…';
  if (shown === 'failed') return 'Could not read the books';
  if (shown.total === 0) return 'No game data yet';
  if (shown.shown === shown.total) return `All ${shown.total} books show`;
  return `${shown.shown} of ${shown.total} books show`;
}

/**
 * Which books show, on this device, on The books page in the Workshop
 * (ADR-002, D1), which gives it its heading. The collections are left out,
 * since each has its own switch on its page.
 */
export function SourcesSection() {
  const read = useBooksRead();
  const registry = read?.registry ?? null;
  const brewSources = read?.brewSources;
  const policy = useSourcePolicy();

  const rows: Row[] = useMemo(() => {
    const counts = registry?.sourceCounts() ?? new Map<string, number>();
    return [...counts.entries()]
      .filter(([source]) => brewSources?.has(source) !== true)
      .map(([source, count]) => ({
        source,
        name: sourceName(source),
        count,
        section: sourceGroup(source),
        enabled: policyAllows(policy, source),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, policy, brewSources]);

  const shown = rows.filter((r) => r.enabled).length;
  const listed = new Set(rows.map((r) => r.source));

  /**
   * The toggles read from the stored policy, so a rejected write leaves them
   * showing what is actually saved; the toast is what says the tap did not
   * take, and tapping again is the retry.
   *
   * Edits re-read inside a transaction rather than starting from the policy
   * captured at render: two quick taps would otherwise both build on the same
   * stale value and the second would drop the first one's change.
   */
  const editPolicy = (edit: (current: SourcePolicy) => SourcePolicy) => {
    void updateSourcePolicy(edit).catch((err: unknown) => notifyFailure('Save sources', err));
  };

  /**
   * A preset is a choice of books alone: each collection stays as it was,
   * since its own page has its switch and this page does not list it. The
   * page waits for the collections' sources before it offers one, so a tap
   * reads them here, in order with the taps before it.
   */
  const choosePreset = (next: SourcePolicy) => {
    const brews = [...(brewSources ?? [])];
    editPolicy((current) =>
      brews.reduce((p, code) => withSource(p, code, policyAllows(current, code)), next),
    );
  };
  /**
   * The books a policy names: a collection's source is its own page's, and a
   * code no book has (a collection deleted since) names nothing.
   */
  const bookPart = (p: SourcePolicy) =>
    (p.mode === 'all' ? p.except : p.sources).filter(
      (s) => brewSources?.has(s) !== true && (KNOWN.has(s) || listed.has(s)),
    );

  const setGroup = (group: SourceGroup, enabled: boolean) => {
    const codes = rows.filter((r) => r.section === group).map((r) => r.source);
    editPolicy((current) => codes.reduce((p, code) => withSource(p, code, enabled), current));
  };

  // Until the collections' sources and the registry read with them are in, a
  // book cannot be told from a collection.
  if (brewSources === undefined) {
    return (
      <section className="flex flex-col gap-2" aria-label="Which books show">
        <p className="px-1 text-caption text-ink-muted">Loading…</p>
      </section>
    );
  }

  const activePreset = SOURCE_PRESETS.find((p) => {
    const target = p.policy();
    if (target.mode !== policy.mode) return false;
    const a = bookPart(target);
    const b = bookPart(policy);
    return a.length === b.length && a.every((s, i) => s === b[i]);
  });

  return (
    <section className="flex flex-col gap-2" aria-label="Which books show">
      <p className="px-1 text-caption text-ink-muted">
        Narrow what you pick from when building a character, and what the library and search show. A
        shorter list is a much easier list. This only affects what you browse: characters already
        built on a book you hide keep working exactly as they are. A character with its own sources
        (set on its Build page) uses those instead.
      </p>

      {/* Chips with a 44px tap from their transparent border, so the row
          pulls in by that border to line up with the text. */}
      <div className="-mx-1.5 flex flex-wrap">
        {SOURCE_PRESETS.map((p) => (
          <Chip
            key={p.id}
            tone="outline"
            pressed={activePreset?.id === p.id}
            title={p.detail}
            onClick={() => choosePreset(p.policy())}
          >
            {p.label}
          </Chip>
        ))}
      </div>

      {/* Spelled out rather than left in a tooltip: on a phone there is no
          hover, and this is the entry point to the whole feature. */}
      <p className="px-1 text-caption text-ink-muted">
        {activePreset?.detail ?? 'Your own selection of books.'}
      </p>

      {shown === 0 && rows.length > 0 ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-guide-soft px-3 py-2 text-caption"
        >
          <span>Nothing is selected, so every list in the app is empty.</span>
          <button
            type="button"
            onClick={() => choosePreset(ALLOW_ALL)}
            className="tap font-bold underline underline-offset-3"
          >
            Show everything
          </button>
        </p>
      ) : (
        <p className="px-1 text-caption text-ink-muted">
          {!isPolicyNarrowed(policy)
            ? `Showing all ${rows.length} downloaded sources.`
            : policy.mode === 'only'
              ? `Showing only the sources you picked (${shown} of ${rows.length} downloaded).`
              : `Showing ${shown} of ${rows.length} downloaded sources.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-1 text-body text-ink-muted">
          {registry === null && read?.failed === true
            ? 'Could not read the books. Reload the app to try again.'
            : 'Waiting for game data to download.'}
        </p>
      ) : (
        SOURCE_GROUPS.filter((s) => rows.some((r) => r.section === s)).map((section) => {
          const group = rows.filter((r) => r.section === section);
          const on = group.filter((r) => r.enabled).length;
          return (
            <details key={section} open={section === 'core'} className="group">
              <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 rounded-control bg-surface px-3 py-2 text-body-strong ring-1 ring-line ring-inset">
                <ChevronRight
                  aria-hidden
                  size={14}
                  className="shrink-0 text-ink-muted transition-transform group-open:rotate-90"
                />
                <span className="min-w-0 flex-1 break-words">{SOURCE_GROUP_LABELS[section]}</span>
                <span className="shrink-0 font-normal text-caption text-ink-muted">
                  {on}/{group.length}
                </span>
              </summary>
              <div className="mt-1 flex flex-col overflow-hidden rounded-control bg-surface ring-1 ring-line ring-inset">
                {/* Full tap height (A11Y-002), with room for the focus ring inside the clipped box. */}
                <div className="flex gap-1 border-line border-b px-2 py-1 text-caption">
                  <button
                    type="button"
                    onClick={() => setGroup(section, true)}
                    className="inline-flex min-h-tap items-center px-1 text-ink-muted underline underline-offset-3 hover:text-ink"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroup(section, false)}
                    className="inline-flex min-h-tap items-center px-1 text-ink-muted underline underline-offset-3 hover:text-ink"
                  >
                    Select none
                  </button>
                </div>
                {group.map((r) => (
                  <SourceToggle
                    key={r.source}
                    row={r}
                    onToggle={(enabled) => editPolicy((p) => withSource(p, r.source, enabled))}
                  />
                ))}
              </div>
            </details>
          );
        })
      )}

      <p className="px-1 text-caption text-ink-muted">
        Books appear here once their data has downloaded, so the list grows as you browse. The
        presets are fixed lists, so they keep meaning the same thing as more data arrives.
      </p>
    </section>
  );
}
