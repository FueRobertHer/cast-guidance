import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import {
  type RegistryState,
  type TypePacksState,
  useRegistryRefreshing,
  useRegistryState,
  useSearchState,
  useTypePacks,
} from '@/data5e/hooks';
import { type EntityRegistry, type EntityType, isEntityType } from '@/data5e/normalize';
import { type SearchResult, searchAll } from '@/data5e/search/client';
import { applySourcePolicy, policyForSearch, useSourcePolicy } from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
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
  const [result, setResult] = useState<SearchResult>({ hits: [], hiddenCount: 0 });
  const [showHidden, setShowHidden] = useState(false);
  const policy = useSourcePolicy();
  const trimmed = q.trim();

  // The filter goes to the worker, which applies it before truncating to a
  // page. Filtering the returned page here instead would make search emptier
  // the more books you hide: the top 30 overall can be entirely hidden while
  // good matches sit at rank 31.
  const sources = showHidden ? undefined : policyForSearch(policy);
  const sourcesKey = sources === undefined ? '' : JSON.stringify(sources);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sourcesKey stands in for the sources object
  useEffect(() => {
    if (!ready || trimmed.length < 2) {
      setResult({ hits: [], hiddenCount: 0 });
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void searchAll(trimmed, { sources }).then((res) => {
        if (alive) setResult(res);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trimmed, ready, sourcesKey]);

  // A new query starts back inside the player's chosen sources.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on query change is the point
  useEffect(() => {
    setShowHidden(false);
  }, [trimmed]);

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
            Couldn&rsquo;t prepare search
            {regStatus === 'error' && regError !== null ? `: ${regError}` : ''}
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
      {ready && trimmed.length >= 2 && result.hits.length === 0 && result.hiddenCount === 0 && (
        <p className="px-1 text-xs text-ink-muted">No matches for “{trimmed}”.</p>
      )}
      {result.hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden(true)}
          className="px-1 text-left text-xs text-ink-muted underline hover:text-ink"
        >
          {result.hiddenCount === 30 ? '30+' : result.hiddenCount} more in sources you&rsquo;ve
          hidden. Show them
        </button>
      )}
      {result.hits.length > 0 && (
        <div className="flex flex-col rounded-lg bg-surface">
          {result.hits.map((h) => (
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

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit items-center gap-1 text-sm text-ink-muted hover:text-ink"
    >
      <ArrowLeft size={16} /> Back
    </button>
  );
}

function Action({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white"
    >
      {label}
    </button>
  );
}

/**
 * Why this section has nothing to show, and what to press about it.
 *
 * One panel for both the list and the detail view, because both fail for the
 * same three reasons and the answer is the same in each: the compendium could
 * not be built, this type's files could not be downloaded, or the download
 * cannot even start because the device is offline.
 */
function SectionProblem({ reg, packs }: { reg: RegistryState; packs: TypePacksState }) {
  // `error`, not `status`: a registry already in hand keeps the status 'ready'
  // so pages that can still render do, but the failed rebuild behind it is
  // exactly what this panel exists to say.
  const regFailed = reg.error !== null;
  const packsFailed = packs.status === 'error';
  // Both can fail at once, and a retry that fixes one of them leaves the other
  // unmentioned: say both, and let one press attempt both.
  const lines = [
    regFailed && `The compendium couldn't be loaded${reg.error !== null ? `: ${reg.error}` : ''}`,
    packsFailed &&
      (packs.offline
        ? "You're offline, so the rest of this section can't be downloaded yet."
        : `This section couldn't be downloaded${packs.error !== null ? `: ${packs.error}` : ''}`),
  ].filter((l): l is string => l !== false);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-deep px-3 py-2"
      role="alert"
    >
      <p className="min-w-0 flex-1 text-xs">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
        {packsFailed && packs.offline && (
          <span className="block text-ink-muted">
            Anything already downloaded is still here to read.
          </span>
        )}
      </p>
      <Action
        label="Retry"
        onClick={() => {
          if (regFailed) reg.retry();
          if (packsFailed) packs.retry();
        }}
      />
    </div>
  );
}

/** Sentinel values for the source dropdown, which is otherwise source codes. */
const MY_SOURCES = '';
const EVERY_SOURCE = '*';

function TypeList({ type, reg }: { type: EntityType; reg: RegistryState }) {
  const [filter, setFilter] = useState('');
  const [pickedSource, setPickedSource] = useState<string>(MY_SOURCES);
  const policy = useSourcePolicy();
  const packs = useTypePacks(type, reg.retry);
  const refreshing = useRegistryRefreshing();
  const registry = reg.registry;
  const failed = reg.error !== null || packs.status === 'error';

  const { items, sources, hiddenBySettings, selected } = useMemo(() => {
    const all = [...(registry?.byType(type) ?? [])].sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b)),
    );
    const mine = applySourcePolicy(all, policy, sourceOf);

    // The dropdown offers the books this type actually has, so it never lists a
    // source that would come back empty. Built from `mine` so the settings stay
    // the default frame; "everything" is a deliberate step outside it.
    const counts = new Map<string, number>();
    for (const e of mine) counts.set(sourceOf(e), (counts.get(sourceOf(e)) ?? 0) + 1);
    const sources = [...counts.entries()].sort((a, b) =>
      sourceName(a[0]).localeCompare(sourceName(b[0])),
    );

    // Resolve first: a source can stop being offered when data updates or the
    // policy changes, and filtering on the raw state would leave the dropdown
    // reading "My sources" over a list scoped to a source it no longer lists.
    const picked =
      pickedSource === MY_SOURCES || pickedSource === EVERY_SOURCE || counts.has(pickedSource)
        ? pickedSource
        : MY_SOURCES;
    const scoped =
      picked === MY_SOURCES
        ? mine
        : picked === EVERY_SOURCE
          ? all
          : all.filter((e) => sourceOf(e) === picked);
    const f = filter.trim().toLowerCase();
    return {
      items: f === '' ? scoped : scoped.filter((e) => nameOf(e).toLowerCase().includes(f)),
      sources,
      hiddenBySettings: all.length - mine.length,
      selected: picked,
    };
  }, [registry, type, filter, policy, pickedSource]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <header className="flex items-center gap-3">
        <Link to="/library" className="text-ink-muted hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">{TYPE_LABELS.get(type) ?? type}</h1>
        <span className="text-sm text-ink-muted">{items.length}</span>
      </header>
      {/* An empty list and a failed download used to look identical here. */}
      {failed && <SectionProblem reg={reg} packs={packs} />}
      <label className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <Search size={16} className="shrink-0 text-ink-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${TYPE_LABELS.get(type)?.toLowerCase() ?? type}…`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>
      <div className="relative">
        <select
          aria-label="Source"
          value={selected}
          onChange={(e) => setPickedSource(e.target.value)}
          className="w-full appearance-none rounded-lg bg-surface py-2 pr-9 pl-3 text-sm outline-none"
        >
          <option value={MY_SOURCES} className="bg-surface-2 text-ink">
            {hiddenBySettings > 0 ? 'My sources' : 'All sources'}
          </option>
          {sources.map(([s, n]) => (
            <option key={s} value={s} className="bg-surface-2 text-ink">
              {sourceName(s)} ({n})
            </option>
          ))}
          {hiddenBySettings > 0 && (
            <option value={EVERY_SOURCE} className="bg-surface-2 text-ink">
              Everything, including {hiddenBySettings} hidden in settings
            </option>
          )}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-muted"
        />
      </div>
      {items.length === 0 && !failed && (
        <p className="text-sm text-ink-muted">
          {/* The registry is what the list reads, so "nothing here" is only
              true once it has finished catching up with the files on disk. */}
          {packs.status === 'loading' || registry === null || refreshing
            ? 'Downloading this section…'
            : filter.trim() !== ''
              ? `Nothing here matches “${filter.trim()}”.`
              : 'Nothing here yet.'}
        </p>
      )}
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

function EntityDetail({ type, uid, reg }: { type: EntityType; uid: string; reg: RegistryState }) {
  const navigate = useNavigate();
  const packs = useTypePacks(type, reg.retry);
  const refreshing = useRegistryRefreshing();
  const registry = reg.registry;

  const decoded = decodeURIComponent(uid);
  const [name, source] = decoded.split('|');
  const entity =
    registry === null
      ? undefined
      : (registry.get(
          type,
          name ?? '',
          source !== undefined && source !== '' ? source : undefined,
        ) ?? registry.get(type, decoded));

  // Having the entity outranks everything else that could be said. A download
  // that failed for the rest of the section is not this page's problem when
  // this page's subject is already in hand.
  if (entity === undefined) {
    // A failure comes before a spinner. Both of these used to render "Loading…"
    // for as long as the page was open: `useRegistry` swallowed the registry's
    // error, and the pack download was started with a bare `void`, so neither
    // had anywhere to report to.
    if (reg.error !== null || packs.status === 'error') {
      return (
        <main className="flex flex-1 flex-col gap-3 p-4">
          <BackLink onClick={() => navigate(-1)} />
          <SectionProblem reg={reg} packs={packs} />
        </main>
      );
    }

    // `refreshing` is the difference between "not in the data" and "not in the
    // data yet". The registry rebuilds after the files land, so the moment a
    // download finishes there is a window where the packs are ready and the
    // registry is still the older, smaller one. Calling the entity missing in
    // that window offers a re-download for something that just arrived.
    if (registry === null || packs.status === 'loading' || refreshing) {
      return <main className="p-4 text-sm text-ink-muted">Loading…</main>;
    }
  }

  if (entity === undefined) {
    // Everything this type needs has downloaded, so "it may not have arrived
    // yet" is no longer an available excuse: either the link is wrong, or what
    // did arrive is not what it should be. The second is the one the ordinary
    // retry cannot fix, because nothing is missing for it to fetch.
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <BackLink onClick={() => navigate(-1)} />
        <p className="text-sm text-ink-muted">
          Nothing in {TYPE_LABELS.get(type)?.toLowerCase() ?? type} is called{' '}
          <span className="font-semibold text-ink">{decoded}</span>. The link may be from an older
          version of the app, or from a homebrew file that is no longer installed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Action label="Download this section again" onClick={packs.repair} />
          <Link to={`/library/${type}`} className="text-sm text-ink-muted underline hover:text-ink">
            Browse {TYPE_LABELS.get(type)?.toLowerCase() ?? type}
          </Link>
        </div>
      </main>
    );
  }

  const facts = headerFacts(type, entity);
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <BackLink onClick={() => navigate(-1)} />
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">{nameOf(entity)}</h1>
          <span className="flex items-center gap-1.5 pt-1 text-xs text-ink-muted">
            <SourceBadge source={sourceOf(entity)} titleShownNearby />
            {typeof entity.page === 'number' && <span>p. {entity.page}</span>}
          </span>
        </div>
        {/* Spelled out here because a tooltip is a desktop-only affordance. */}
        <p className="text-xs text-ink-muted">{sourceName(sourceOf(entity))}</p>
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
      {/* Non-null wherever an entity came out of it. */}
      {type === 'class' && registry !== null && <ClassExtras registry={registry} entity={entity} />}
    </main>
  );
}

export function Component() {
  const { type, uid } = useParams();
  const reg = useRegistryState();

  // The `:type` segment came out of a URL, so it is a string until checked.
  // Casting it used to produce a section with a plausible heading and nothing
  // in it, which reads as "the app lost my data" rather than "no such page".
  if (type !== undefined && !isEntityType(type)) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <p className="text-sm text-ink-muted">
          There is no <span className="font-semibold text-ink">{type}</span> section in the library.
        </p>
        <Link to="/library" className="text-sm text-ink-muted underline hover:text-ink">
          Back to the library
        </Link>
      </main>
    );
  }

  if (type !== undefined && uid !== undefined) {
    return <EntityDetail type={type} uid={uid} reg={reg} />;
  }
  if (type !== undefined) return <TypeList type={type} reg={reg} />;
  return <LibraryHome registry={reg.registry} />;
}
