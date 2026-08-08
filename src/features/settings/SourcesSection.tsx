import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useRegistry } from '@/data5e/hooks';
import {
  ALLOW_ALL,
  isPolicyNarrowed,
  policyAllows,
  SOURCE_PRESETS,
  type SourcePolicy,
  updateSourcePolicy,
  useSourcePolicy,
  withSource,
  writeSourcePolicy,
} from '@/data5e/sourceFilter';
import {
  SOURCE_GROUP_LABELS,
  SOURCE_GROUPS,
  type SourceGroup,
  sourceGroup,
  sourceName,
} from '@/data5e/sourceNames';
import { db } from '@/db/db';

/** Homebrew gets its own heading rather than falling into "everything else". */
type Section = SourceGroup | 'homebrew';

const SECTION_LABELS: Record<Section, string> = { ...SOURCE_GROUP_LABELS, homebrew: 'Homebrew' };
const SECTION_ORDER: readonly Section[] = [...SOURCE_GROUPS, 'homebrew'];

interface Row {
  source: string;
  name: string;
  count: number;
  section: Section;
  enabled: boolean;
}

function SourceToggle({ row, onToggle }: { row: Row; onToggle: (enabled: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-surface-2">
      <input
        type="checkbox"
        checked={row.enabled}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-4 shrink-0 accent-accent"
      />
      <span className={`min-w-0 flex-1 truncate ${row.enabled ? '' : 'text-ink-muted'}`}>
        {row.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase text-ink-muted">{row.source}</span>
      <span className="w-12 shrink-0 text-right text-xs text-ink-muted">{row.count}</span>
    </label>
  );
}

export function SourcesSection() {
  const registry = useRegistry();
  const policy = useSourcePolicy();
  const brewSources = useLiveQuery(
    async () => new Set((await db.homebrewFiles.toArray()).flatMap((r) => r.sourceIds)),
    [],
  );

  const rows: Row[] = useMemo(() => {
    const counts = registry?.sourceCounts() ?? new Map<string, number>();
    return [...counts.entries()]
      .map(([source, count]) => ({
        source,
        name: sourceName(source),
        count,
        section: brewSources?.has(source) === true ? ('homebrew' as const) : sourceGroup(source),
        enabled: policyAllows(policy, source),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, policy, brewSources]);

  const shown = rows.filter((r) => r.enabled).length;

  const setPolicy = (next: SourcePolicy) => {
    void writeSourcePolicy(next);
  };

  /**
   * Edits re-read inside a transaction rather than starting from the policy
   * captured at render: two quick taps would otherwise both build on the same
   * stale value and the second would drop the first one's change.
   */
  const editPolicy = (edit: (current: SourcePolicy) => SourcePolicy) => {
    void updateSourcePolicy(edit);
  };

  const setGroup = (group: Section, enabled: boolean) => {
    const codes = rows.filter((r) => r.section === group).map((r) => r.source);
    editPolicy((current) => codes.reduce((p, code) => withSource(p, code, enabled), current));
  };

  const activePreset = SOURCE_PRESETS.find((p) => {
    const target = p.policy();
    if (target.mode !== policy.mode) return false;
    const a = target.mode === 'all' ? target.except : target.sources;
    const b = policy.mode === 'all' ? policy.except : policy.sources;
    return a.length === b.length && a.every((s, i) => s === b[i]);
  });

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Content sources</h2>
      <p className="text-xs text-ink-muted">
        Narrow what you pick from when building a character, and what the library and search show. A
        shorter list is a much easier list. This only affects what you browse: characters already
        built on a book you hide keep working exactly as they are.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {SOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.detail}
            onClick={() => setPolicy(p.policy())}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              activePreset?.id === p.id
                ? 'border-accent bg-accent-deep/40'
                : 'border-surface-2 text-ink-muted hover:text-ink'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Spelled out rather than left in a tooltip: on a phone there is no
          hover, and this is the entry point to the whole feature. */}
      <p className="text-xs text-ink-muted">
        {activePreset?.detail ?? 'Your own selection of books.'}
      </p>

      {shown === 0 && rows.length > 0 ? (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-accent-deep/30 px-3 py-2 text-xs"
        >
          <span>Nothing is selected, so every list in the app is empty.</span>
          <button
            type="button"
            onClick={() => setPolicy(ALLOW_ALL)}
            className="font-semibold underline"
          >
            Show everything
          </button>
        </p>
      ) : (
        <p className="text-xs text-ink-muted">
          {!isPolicyNarrowed(policy)
            ? `Showing all ${rows.length} downloaded sources.`
            : policy.mode === 'only'
              ? `Showing only the sources you picked (${shown} of ${rows.length} downloaded).`
              : `Showing ${shown} of ${rows.length} downloaded sources.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Waiting for game data to download.</p>
      ) : (
        SECTION_ORDER.filter((s) => rows.some((r) => r.section === s)).map((section) => {
          const group = rows.filter((r) => r.section === section);
          const on = group.filter((r) => r.enabled).length;
          return (
            <details
              key={section}
              open={section === 'core' || section === 'homebrew'}
              className="group"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-semibold">
                <ChevronRight
                  aria-hidden
                  size={14}
                  className="shrink-0 text-ink-muted transition-transform group-open:rotate-90"
                />
                <span className="min-w-0 flex-1 truncate">{SECTION_LABELS[section]}</span>
                <span className="shrink-0 text-xs font-normal text-ink-muted">
                  {on}/{group.length}
                </span>
              </summary>
              <div className="mt-1 flex flex-col rounded-lg bg-surface">
                <div className="flex gap-2 border-b border-surface-2/40 px-3 py-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setGroup(section, true)}
                    className="text-ink-muted underline hover:text-ink"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroup(section, false)}
                    className="text-ink-muted underline hover:text-ink"
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

      <p className="text-xs text-ink-muted">
        Books appear here once their data has downloaded, so the list grows as you browse. The
        presets are fixed lists, so they keep meaning the same thing as more data arrives.
      </p>
    </section>
  );
}
