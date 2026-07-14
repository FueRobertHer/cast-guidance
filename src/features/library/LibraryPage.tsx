import { ArrowLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry, useRegistryState, useSearchState } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import type { EntityRegistry, EntityType } from '@/data5e/normalize';
import { searchAll } from '@/data5e/search/client';
import type { SearchDoc } from '@/data5e/search/protocol';
import { SourceBadge } from '@/ui/SourceBadge';
import { VirtualList } from '@/ui/VirtualList';
import { headerFacts } from './fmt';

const BROWSE_TYPES: Array<{ type: EntityType; label: string }> = [
  { type: 'class', label: 'Classes' },
  { type: 'subclass', label: 'Subclasses' },
  { type: 'race', label: 'Species / Races' },
  { type: 'background', label: 'Backgrounds' },
  { type: 'feat', label: 'Feats' },
  { type: 'spell', label: 'Spells' },
  { type: 'item', label: 'Items' },
  { type: 'baseitem', label: 'Basic equipment' },
  { type: 'optionalfeature', label: 'Optional features' },
  { type: 'condition', label: 'Conditions' },
  { type: 'action', label: 'Actions' },
  { type: 'skill', label: 'Skills' },
  { type: 'language', label: 'Languages' },
  { type: 'sense', label: 'Senses' },
  { type: 'variantrule', label: 'Rules' },
  { type: 'disease', label: 'Diseases' },
];

const TYPE_LABELS = new Map(BROWSE_TYPES.map((t) => [t.type as string, t.label]));

function nameOf(e: Entity): string {
  return typeof e.name === 'string' ? e.name : '?';
}
function sourceOf(e: Entity): string {
  return typeof e.source === 'string' ? e.source : '?';
}
function uidOf(e: Entity): string {
  return `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();
}

function EntityRow({ type, e }: { type: string; e: Entity }) {
  return (
    <Link
      to={`/library/${type}/${encodeURIComponent(uidOf(e))}`}
      className="flex items-center justify-between gap-2 border-b border-surface/60 px-1 py-3 hover:bg-surface"
    >
      <span className="truncate">{nameOf(e)}</span>
      <SourceBadge source={sourceOf(e)} />
    </Link>
  );
}

// ---------------------------------------------------------------------------

function GlobalSearch() {
  const { registry, status: regStatus, error: regError, retry: retryRegistry } = useRegistryState();
  const { status: searchStatus, retry: retrySearch } = useSearchState(registry);
  const ready = searchStatus === 'ready';
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchDoc[]>([]);
  const trimmed = q.trim();

  useEffect(() => {
    if (!ready || trimmed.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void searchAll(trimmed).then((res) => {
        if (alive) setHits(res);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trimmed, ready]);

  // Distinguish error / preparing / ready so a failure isn't an endless spinner.
  const failed = regStatus === 'error' || searchStatus === 'error';
  const placeholder = failed
    ? 'Search unavailable'
    : ready
      ? 'Search everything…'
      : 'Preparing search…';

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <Search size={16} className="shrink-0 text-ink-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          disabled={failed}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted disabled:opacity-60"
        />
      </label>
      {failed && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg bg-accent-deep/30 px-3 py-2 text-xs"
          role="alert"
        >
          <span className="truncate">
            Couldn&rsquo;t prepare search{regError !== null ? `: ${regError}` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              if (regStatus === 'error') retryRegistry();
              else retrySearch();
            }}
            className="shrink-0 rounded bg-accent px-2 py-0.5 font-semibold"
          >
            Retry
          </button>
        </div>
      )}
      {ready && trimmed.length >= 2 && hits.length === 0 && (
        <p className="px-1 text-xs text-ink-muted">No matches for “{trimmed}”.</p>
      )}
      {hits.length > 0 && (
        <div className="flex flex-col rounded-lg bg-surface">
          {hits.map((h) => (
            <Link
              key={h.id}
              to={`/library/${h.type}/${encodeURIComponent(h.uid)}`}
              className="flex items-center justify-between gap-2 border-b border-surface-2/50 px-3 py-2.5 last:border-b-0 hover:bg-surface-2"
              onClick={() => setQ('')}
            >
              <span className="truncate text-sm">{h.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                {TYPE_LABELS.get(h.type) ?? h.type}
                <SourceBadge source={h.source} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryHome({ registry }: { registry: EntityRegistry | null }) {
  const counts = registry?.counts() ?? {};
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Library</h1>
      </header>
      <GlobalSearch />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BROWSE_TYPES.map(({ type, label }) => (
          <Link
            key={type}
            to={`/library/${type}`}
            className="flex flex-col gap-1 rounded-lg bg-surface p-3 hover:bg-surface-2"
          >
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-ink-muted">{counts[type] ?? '…'}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function TypeList({ type, registry }: { type: EntityType; registry: EntityRegistry | null }) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void ensureTypePacks(type);
  }, [type]);

  const items = useMemo(() => {
    const list = [...(registry?.byType(type) ?? [])];
    list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const f = filter.trim().toLowerCase();
    return f === '' ? list : list.filter((e) => nameOf(e).toLowerCase().includes(f));
  }, [registry, type, filter]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <header className="flex items-center gap-3">
        <Link to="/library" className="text-ink-muted hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">{TYPE_LABELS.get(type) ?? type}</h1>
        <span className="text-sm text-ink-muted">{items.length}</span>
      </header>
      <label className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <Search size={16} className="shrink-0 text-ink-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${TYPE_LABELS.get(type)?.toLowerCase() ?? type}…`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>
      <VirtualList
        items={items}
        className="min-h-0 flex-1"
        renderRow={(e) => <EntityRow type={type} e={e} />}
      />
    </main>
  );
}

function ClassExtras({ registry, entity }: { registry: EntityRegistry; entity: Entity }) {
  const name = nameOf(entity);
  const source = sourceOf(entity);
  const subclasses = registry
    .byType('subclass')
    .filter(
      (s) =>
        String(s.className).toLowerCase() === name.toLowerCase() &&
        String(s.classSource).toLowerCase() === source.toLowerCase(),
    );
  const features = registry
    .byType('classFeature')
    .filter(
      (f) =>
        String(f.className).toLowerCase() === name.toLowerCase() &&
        String(f.classSource).toLowerCase() === source.toLowerCase(),
    );
  const byLevel = new Map<number, string[]>();
  for (const f of features) {
    const lvl = typeof f.level === 'number' ? f.level : 0;
    const list = byLevel.get(lvl) ?? [];
    list.push(nameOf(f));
    byLevel.set(lvl, list);
  }
  return (
    <div className="flex flex-col gap-4">
      {subclasses.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Subclasses</h3>
          <div className="flex flex-wrap gap-1.5">
            {subclasses.map((s) => (
              <Link
                key={uidOf(s)}
                to={`/library/subclass/${encodeURIComponent(uidOf(s))}`}
                className="rounded bg-surface px-2 py-1 text-xs hover:bg-surface-2"
              >
                {nameOf(s)} <SourceBadge source={sourceOf(s)} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {byLevel.size > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-semibold">Features by level</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {[...byLevel.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([lvl, names]) => (
                <div key={lvl} className="contents">
                  <dt className="text-ink-muted">Lv {lvl}</dt>
                  <dd>{names.join(', ')}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function EntityDetail({
  type,
  uid,
  registry,
}: {
  type: EntityType;
  uid: string;
  registry: EntityRegistry | null;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    void ensureTypePacks(type);
  }, [type]);

  if (registry === null) {
    return <main className="p-4 text-sm text-ink-muted">Loading…</main>;
  }

  const decoded = decodeURIComponent(uid);
  const [name, source] = decoded.split('|');
  const entity =
    registry.get(type, name ?? '', source !== undefined && source !== '' ? source : undefined) ??
    registry.get(type, decoded);

  if (entity === undefined) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex w-fit items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <p className="text-sm text-ink-muted">
          Not found: {decoded} — it may live in a pack that hasn't downloaded yet.
        </p>
      </main>
    );
  }

  const facts = headerFacts(type, entity);
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex w-fit items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} /> Back
      </button>
      <header className="flex items-start justify-between gap-2">
        <h1 className="text-xl font-bold">{nameOf(entity)}</h1>
        <span className="flex items-center gap-1.5 pt-1 text-xs text-ink-muted">
          <SourceBadge source={sourceOf(entity)} />
          {typeof entity.page === 'number' && <span>p. {entity.page}</span>}
        </span>
      </header>
      {facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface p-3 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <EntriesView entries={entity.entries} />
      {type === 'class' && <ClassExtras registry={registry} entity={entity} />}
    </main>
  );
}

export function Component() {
  const { type, uid } = useParams();
  const registry = useRegistry();

  if (type !== undefined && uid !== undefined) {
    return <EntityDetail type={type as EntityType} uid={uid} registry={registry} />;
  }
  if (type !== undefined) {
    return <TypeList type={type as EntityType} registry={registry} />;
  }
  return <LibraryHome registry={registry} />;
}
