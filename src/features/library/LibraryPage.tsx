import { ArrowLeft, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
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
import { DEFAULT_QUERY_LIMIT } from '@/data5e/search/protocol';
import { applySourcePolicy, policyForSearch, useSourcePolicy } from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import { useBack } from '@/lib/useBack';
import { useOnReconnect } from '@/lib/useOnline';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { useDbLifecycle } from '@/stores/dbLifecycle';
import { Button } from '@/ui/Button';
import { useFailureAlert } from '@/ui/failureAlert';
import { SourceBadge } from '@/ui/SourceBadge';
import { cardClass, listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { VirtualList } from '@/ui/VirtualList';
import { bookContents, bookIndex } from './books';
import { BROWSE_TYPES, TYPE_LABELS } from './browseTypes';
import { headerFacts } from './fmt';

function nameOf(e: Entity): string {
  return typeof e.name === 'string' ? e.name : '?';
}
function sourceOf(e: Entity): string {
  return typeof e.source === 'string' ? e.source : '?';
}
function uidOf(e: Entity): string {
  return `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();
}
/** Source codes compare case-insensitively; only their display keeps the case. */
function sourceKey(e: Entity): string {
  return sourceOf(e).toLowerCase();
}

/**
 * The page's text styles that are not a control (DS-001): a link in a line of
 * text, as the design's `cg-link`, and a status line in place of a list.
 */
const LINK =
  'text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
const NOTE = 'text-body text-ink-muted';
/** An icon-only way back, as the sheet header's. */
const BACK_ICON = 'tap rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
/** A tile on the library home and a book's index: a card that is a link. */
const TILE =
  'flex flex-col gap-1 rounded-card bg-surface p-3 shadow-card ring-1 ring-line ring-inset transition-colors duration-120 hover:bg-surface-raised';
/** A search or filter box: the design's search field, a leading Search icon. */
const SEARCH_ICON = 'pointer-events-none absolute top-3.5 left-3.5 text-ink-muted';
const SEARCH_FIELD = `${fieldClass} pl-10.5`;
/** A failure panel: the design's `danger` hint, with its one action. */
const PROBLEM = 'flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-3 py-2';

/**
 * The list's rows sit in one card, divided by `line` hairlines. Each row draws
 * the line above it, and the first one drawn makes its own transparent: the
 * card's edge is already there, and a transparent line keeps every row the
 * same height, which the estimate below relies on.
 */
const ROWS = `${listClass} [&_li:first-child>a]:border-t-transparent`;

function EntityRow({ type, e }: { type: string; e: Entity }) {
  return (
    <Link
      to={`/library/${type}/${encodeURIComponent(uidOf(e))}`}
      className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 transition-colors duration-120 hover:bg-surface-raised"
    >
      <span className="truncate">{nameOf(e)}</span>
      <SourceBadge source={sourceOf(e)} />
    </Link>
  );
}

/**
 * An {@link EntityRow}'s height in px at the current root font size: its
 * `py-3` (1.5rem), one line of body text (1.375rem, DS-001) and the 1 px
 * line above it, rounded as a measured height is. The source badge is as tall
 * as the line (1.375rem), so it never sets the height. The list's restored
 * scroll offset depends on this being exact (see `VirtualList`), so a class
 * change to the row has to change this too; `library-scale.spec.ts` compares
 * it to the rendered row.
 * jsdom reports the root font as "medium", hence the fallback.
 */
export function entityRowHeight(): number {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Math.round(2.875 * (Number.isNaN(px) ? 16 : px) + 1);
}

// ---------------------------------------------------------------------------

/** How long the query has to stay put before its result count is said (A11Y-002). */
export const SEARCH_SETTLE_MS = 750;

/** "30 or more" for a page the search cut short, since it stops at its limit. */
function countSpeech(n: number): string {
  return n >= DEFAULT_QUERY_LIMIT ? `${n} or more` : String(n);
}

/** A search's outcome as a screen reader hears it, matching what the page lists. */
export function searchSpeech(query: string, result: SearchResult): string {
  const { hits, hiddenCount } = result;
  const hidden =
    hiddenCount > 0 ? `${countSpeech(hiddenCount)} more in sources you have hidden` : '';
  if (hits.length === 0)
    return hidden === '' ? `No matches for "${query}"` : `No matches. ${hidden}`;
  const shown = `${countSpeech(hits.length)} result${hits.length === 1 ? '' : 's'}`;
  return hidden === '' ? shown : `${shown}, and ${hidden}`;
}

function GlobalSearch() {
  const { registry, status: regStatus, error: regError, retry: retryRegistry } = useRegistryState();
  const { status: searchStatus, retry: retrySearch, indexVersion } = useSearchState(registry);
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
  // The query whose count was last said. A rebuild of the index asks the same
  // query again as files land, and that is not news: only a query or source
  // change the person made is.
  const spokenFor = useRef<string | null>(null);
  // Leaving the library drops a count still settling: it is about a page
  // nobody is on any more.
  useEffect(() => () => cancelAnnouncement('search'), []);

  // The index rebuilds behind a `ready` status as a download lands files, so
  // `indexVersion` asks the query again whenever one of those finishes:
  // otherwise the results on screen stay those of the index that was current
  // when the query was typed, missing everything that has arrived since.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourcesKey stands in for the sources object; indexVersion re-asks after a rebuild
  useEffect(() => {
    if (!ready || trimmed.length < 2) {
      setResult({ hits: [], hiddenCount: 0 });
      // A count still waiting to be said is for a query that is gone.
      cancelAnnouncement('search');
      spokenFor.current = null;
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void searchAll(trimmed, { sources }).then((res) => {
        if (!alive) return;
        setResult(res);
        const asked = `${trimmed}\n${sourcesKey}`;
        if (spokenFor.current === asked) return;
        spokenFor.current = asked;
        // Settled, so typing a word is one count, for the word, not one per
        // letter. A repeat, because a new query with the same count ("30 or
        // more results" twice) is a new answer; `spokenFor` already keeps a
        // rebuild behind the same query quiet.
        announce(searchSpeech(trimmed, res), {
          key: 'search',
          settleMs: SEARCH_SETTLE_MS,
          repeat: true,
        });
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trimmed, ready, sourcesKey, indexVersion]);

  // A new query starts back inside the player's chosen sources.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetting on query change is the point
  useEffect(() => {
    setShowHidden(false);
  }, [trimmed]);

  // A closed database (TEST-002) gets no raw error and no dead Retry; the
  // shell's banner explains it.
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  // Distinguish error / preparing / ready so a failure isn't an endless spinner.
  const failed = regStatus === 'error' || searchStatus === 'error';
  const placeholder = failed
    ? 'Search unavailable'
    : ready
      ? 'Search everything…'
      : 'Preparing search…';

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search size={20} aria-hidden="true" className={SEARCH_ICON} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search everything"
          placeholder={placeholder}
          disabled={failed}
          className={SEARCH_FIELD}
        />
      </div>
      {failed && !dbOpen && <p className={DB_CLOSED_NOTE}>Reload this tab to search.</p>}
      {failed && dbOpen && (
        <div className={PROBLEM} role="alert">
          <span className="min-w-0 flex-1 truncate text-caption">
            Couldn&rsquo;t prepare search
            {regStatus === 'error' && regError !== null ? `: ${regError}` : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => {
              if (regStatus === 'error') retryRegistry();
              else retrySearch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {ready && trimmed.length >= 2 && result.hits.length === 0 && result.hiddenCount === 0 && (
        <p className="px-1 text-caption text-ink-muted">No matches for “{trimmed}”.</p>
      )}
      {result.hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden(true)}
          className={`px-1 text-left ${LINK}`}
        >
          {result.hiddenCount === 30 ? '30+' : result.hiddenCount} more in sources you&rsquo;ve
          hidden. Show them
        </button>
      )}
      {result.hits.length > 0 && (
        <div className={listClass}>
          {result.hits.map((h) => (
            <Link
              key={h.id}
              to={`/library/${h.type}/${encodeURIComponent(h.uid)}`}
              className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors duration-120 hover:bg-surface-raised"
              onClick={() => setQ('')}
            >
              <span className="truncate">{h.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-caption text-ink-muted">
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
  usePageTitle('Library');
  const counts = registry?.counts() ?? {};
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-title-page">Library</h1>
      </header>
      <GlobalSearch />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BROWSE_TYPES.map(({ type, label }) => (
          <Link key={type} to={`/library/${type}`} className={TILE}>
            {/* Breaks a long word (Backgrounds) rather than run off the card
                and the screen when the text is set large (A11Y-003). */}
            <span className="text-body-strong break-words">{label}</span>
            <span className="text-caption text-ink-muted tabular-nums">{counts[type] ?? '…'}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    // Ghost, as navigation is; pulled into the gutter so the arrow lines up
    // with the title under it.
    <Button variant="ghost" size="sm" className="-ml-3 self-start" onClick={onClick}>
      <ArrowLeft size={16} aria-hidden /> Back
    </Button>
  );
}

/**
 * What a library panel says in place of its failure once the database is
 * closed: the design's neutral hint, something to know.
 */
const DB_CLOSED_NOTE = 'rounded-control bg-surface-raised px-3 py-2 text-caption text-ink-muted';

/**
 * Why this section has nothing to show, and what to press about it.
 *
 * One panel for both the list and the detail view, because both fail for the
 * same three reasons and the answer is the same in each: the compendium could
 * not be built, this type's files could not be downloaded, or the download
 * cannot even start because the device is offline.
 */
function SectionProblem({ reg, packs }: { reg: RegistryState; packs: TypePacksState }) {
  const dbOpen = useDbLifecycle((s) => s.state === 'open');
  // Mounted with the failure. A visual while the shell's DataBanner alerts
  // the same outage (A11Y-002).
  const alerts = useFailureAlert();
  // `error`, not `status`: a registry already in hand keeps the status 'ready'
  // so pages that can still render do, but the failed rebuild behind it is
  // exactly what this panel exists to say.
  const regFailed = reg.error !== null;
  const packsFailed = packs.status === 'error';
  const retry = () => {
    if (regFailed) reg.retry();
    if (packsFailed) packs.retry();
  };
  // "You're offline" is read at the moment of failure, so back online it
  // would go on saying so; trying again then is what makes it true or gone.
  useOnReconnect(() => {
    if (dbOpen) retry();
  });
  // Another tab deleted or upgraded the database (TEST-002): the failure here
  // is "Database has been closed" and a Retry cannot fix it. The shell's
  // banner says what happened and offers the reload.
  if (!dbOpen) return <p className={DB_CLOSED_NOTE}>Reload this tab to see this section.</p>;
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
    <div className={PROBLEM} role={alerts ? 'alert' : undefined}>
      <p className="min-w-0 flex-1 text-caption">
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
      <Button variant="outline" size="sm" className="shrink-0" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

/** Sentinel values for the source dropdown, which is otherwise source codes. */
const MY_SOURCES = '';
const EVERY_SOURCE = '*';

function TypeList({ type, reg }: { type: EntityType; reg: RegistryState }) {
  const [filter, setFilter] = useState('');
  // In the URL rather than in state, so a book's index can link straight to
  // "the spells in this book" and so that scope survives a reload or a share.
  const [params, setParams] = useSearchParams();
  const pickedSource = params.get('source') ?? MY_SOURCES;
  const setPickedSource = (next: string) => {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === MY_SOURCES) out.delete('source');
        else out.set('source', next);
        return out;
      },
      // Replace: working the dropdown is refining one screen, not a trail of
      // screens to walk back through on the way out of the section.
      { replace: true },
    );
  };
  const policy = useSourcePolicy();
  const packs = useTypePacks(type, reg.retry);
  const refreshing = useRegistryRefreshing();
  const registry = reg.registry;
  const failed = reg.error !== null || packs.status === 'error';
  usePageTitle(TYPE_LABELS.get(type) ?? type, 'Library');
  const headingId = useId();

  const { items, sources, hiddenBySettings, hiddenPick, selected } = useMemo(() => {
    const all = [...(registry?.byType(type) ?? [])].sort((a, b) =>
      nameOf(a).localeCompare(nameOf(b)),
    );
    const mine = applySourcePolicy(all, policy, sourceOf);

    // Tallied case-insensitively, the way identity works everywhere else here
    // (`registry.get`, `uidOf`): a homebrew file writes its own source code by
    // hand, and one that spells it `MyBrew` in its book entry and `mybrew` in
    // its spells must still count as one book on both sides of a link.
    const tally = (list: readonly Entity[]) => {
      const out = new Map<string, { code: string; count: number }>();
      for (const e of list) {
        const row = out.get(sourceKey(e));
        if (row === undefined) out.set(sourceKey(e), { code: sourceOf(e), count: 1 });
        else row.count += 1;
      }
      return out;
    };

    // The dropdown offers the books this type actually has, so it never lists a
    // source that would come back empty. Built from `mine` so the settings stay
    // the default frame; "everything" is a deliberate step outside it.
    const counts = tally(mine);
    const everyCount = tally(all);

    // Resolve first: a source can stop being offered when data updates or the
    // policy changes, and filtering on the raw state would leave the dropdown
    // reading "My sources" over a list scoped to a source it no longer lists.
    // A hidden book still resolves, because the scope now also arrives by link
    // (a book's index), and following one into a book that settings hide
    // should show that book rather than silently widening to everything.
    const known = everyCount.get(pickedSource.toLowerCase());
    // The data's own casing, not the link's, so the value matches an option.
    const picked =
      pickedSource === MY_SOURCES || pickedSource === EVERY_SOURCE
        ? pickedSource
        : (known?.code ?? MY_SOURCES);

    // An option the settings hide is not on the list above, and a `select`
    // whose value names no option renders blank over a list that is scoped. It
    // is named as hidden where it is offered, so a book the player took off
    // their shelf turning up in the dropdown reads as this link's doing rather
    // than as the setting having failed.
    const hiddenPick =
      picked !== MY_SOURCES && picked !== EVERY_SOURCE && !counts.has(picked.toLowerCase())
        ? picked
        : null;
    const offered = [...counts.values()];
    if (hiddenPick !== null) offered.push({ code: hiddenPick, count: known?.count ?? 0 });
    const sources = offered
      .map(({ code, count }): [string, number] => [code, count])
      .sort((a, b) => sourceName(a[0]).localeCompare(sourceName(b[0])));

    const scoped =
      picked === MY_SOURCES
        ? mine
        : picked === EVERY_SOURCE
          ? all
          : all.filter((e) => sourceKey(e) === picked.toLowerCase());
    const f = filter.trim().toLowerCase();
    return {
      items: f === '' ? scoped : scoped.filter((e) => nameOf(e).toLowerCase().includes(f)),
      sources,
      hiddenBySettings: all.length - mine.length,
      hiddenPick,
      selected: picked,
    };
  }, [registry, type, filter, policy, pickedSource]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4">
      <header className="flex items-center gap-2">
        <Link to="/library" aria-label="Back to the library" className={`-ml-3 ${BACK_ICON}`}>
          <ArrowLeft size={20} aria-hidden />
        </Link>
        {/* The count on the title's baseline: centred, it rode up like a footnote mark. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 id={headingId} className="font-display text-title-page">
            {TYPE_LABELS.get(type) ?? type}
          </h1>
          <span className="text-caption text-ink-muted tabular-nums">{items.length}</span>
        </div>
      </header>
      {/* An empty list and a failed download used to look identical here. */}
      {failed && <SectionProblem reg={reg} packs={packs} />}
      <div className="relative">
        <Search size={20} aria-hidden="true" className={SEARCH_ICON} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={`Filter ${TYPE_LABELS.get(type)?.toLowerCase() ?? type}`}
          placeholder={`Filter ${TYPE_LABELS.get(type)?.toLowerCase() ?? type}…`}
          className={SEARCH_FIELD}
        />
      </div>
      <div className="relative">
        <select
          aria-label="Source"
          value={selected}
          onChange={(e) => setPickedSource(e.target.value)}
          className={`${fieldClass} appearance-none pr-9`}
        >
          <option value={MY_SOURCES} className="bg-surface-raised text-ink">
            {hiddenBySettings > 0 ? 'My sources' : 'All sources'}
          </option>
          {sources.map(([s, n]) => (
            <option key={s} value={s} className="bg-surface-raised text-ink">
              {sourceName(s)} ({n}){s === hiddenPick ? ' · hidden in settings' : ''}
            </option>
          ))}
          {hiddenBySettings > 0 && (
            <option value={EVERY_SOURCE} className="bg-surface-raised text-ink">
              Everything, including {hiddenBySettings} hidden in settings
            </option>
          )}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
        />
      </div>
      {items.length === 0 && !failed && (
        <p className={NOTE}>
          {/* The registry is what the list reads, so "nothing here" is only
              true once it has finished catching up with the files on disk. */}
          {packs.status === 'loading' || registry === null || refreshing
            ? 'Downloading this section…'
            : filter.trim() !== ''
              ? `Nothing here matches “${filter.trim()}”.`
              : 'Nothing here yet.'}
        </p>
      )}
      {/* The card only around rows: an empty one would draw an empty frame. */}
      <div className={items.length > 0 ? ROWS : undefined}>
        <VirtualList
          items={items}
          estimateSize={entityRowHeight}
          getKey={uidOf}
          labelledBy={headingId}
          renderRow={(e) => <EntityRow type={type} e={e} />}
        />
      </div>
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
        <section className="flex flex-col gap-2">
          <h3 className="text-heading">Subclasses</h3>
          <div className="flex flex-wrap gap-2">
            {subclasses.map((s) => (
              <Link
                key={uidOf(s)}
                to={`/library/subclass/${encodeURIComponent(uidOf(s))}`}
                className="inline-flex min-h-tap items-center gap-2 rounded-control bg-surface px-3 text-label shadow-card ring-1 ring-line ring-inset transition-colors duration-120 hover:bg-surface-raised"
              >
                {nameOf(s)} <SourceBadge source={sourceOf(s)} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {byLevel.size > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-heading">Features by level</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
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

/**
 * A book entry is a way into the compendium, not something to read: the data
 * carries the chapter listing and the metadata, while the chapters themselves
 * live in files the app never downloads. So the index comes first (the book's
 * own entries, by section, each link landing on that section already scoped to
 * this book), and the contents below it say what the book covers.
 */
function BookExtras({ registry, entity }: { registry: EntityRegistry; entity: Entity }) {
  const source = sourceOf(entity);
  const sections = bookIndex(registry, source);
  const chapters = bookContents(entity);
  return (
    <div className="flex flex-col gap-4">
      {sections.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-heading">In this book</h3>
          {/* Spells and items stream in after boot, so a book opened early can
              honestly hold more than this says. */}
          <p className="text-caption text-ink-muted">
            What has downloaded to this device from {sourceName(source)}.
          </p>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sections.map((s) => (
              <Link
                key={s.type}
                to={`/library/${s.type}?source=${encodeURIComponent(source)}`}
                className={TILE}
              >
                <span className="text-body-strong">{s.label}</span>
                <span className="text-caption text-ink-muted tabular-nums">{s.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {chapters.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-heading">Contents</h3>
          <ol className="flex flex-col gap-2">
            {chapters.map((c) => (
              <li key={c.id} className="flex flex-col">
                <span>
                  {c.ordinal !== undefined && <span className="text-ink-muted">{c.ordinal}. </span>}
                  {c.name}
                </span>
                {c.headers.length > 0 && (
                  <span className="text-caption text-ink-muted">{c.headers.join(' · ')}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function EntityDetail({ type, uid, reg }: { type: EntityType; uid: string; reg: RegistryState }) {
  const back = useBack(`/library/${type}`);
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

  const typeLabel = TYPE_LABELS.get(type) ?? type;
  const failed = reg.error !== null || packs.status === 'error';
  const settled = registry !== null && packs.status !== 'loading' && !refreshing;
  usePageTitle(
    entity !== undefined ? nameOf(entity) : !failed && settled ? 'Not found' : null,
    typeLabel,
    'Library',
  );

  // Having the entity outranks everything else that could be said. A download
  // that failed for the rest of the section is not this page's problem when
  // this page's subject is already in hand.
  if (entity === undefined) {
    // A failure comes before a spinner. Both of these used to render "Loading…"
    // for as long as the page was open: `useRegistry` swallowed the registry's
    // error, and the pack download was started with a bare `void`, so neither
    // had anywhere to report to.
    if (failed) {
      return (
        <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
          <BackLink onClick={back} />
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
      return (
        <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
          <BackLink onClick={back} />
          <p className={NOTE}>Loading…</p>
        </main>
      );
    }
  }

  if (entity === undefined) {
    // Everything this type needs has downloaded, so "it may not have arrived
    // yet" is no longer an available excuse: either the link is wrong, or what
    // did arrive is not what it should be. The second is the one the ordinary
    // retry cannot fix, because nothing is missing for it to fetch.
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <BackLink onClick={back} />
        <p className={NOTE}>
          Nothing in {TYPE_LABELS.get(type)?.toLowerCase() ?? type} is called{' '}
          <span className="font-semibold text-ink">{decoded}</span>. The link may be from an older
          version of the app, or from a homebrew file that is no longer installed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" onClick={packs.repair}>
            Download this section again
          </Button>
          <Link to={`/library/${type}`} className={LINK}>
            Browse {TYPE_LABELS.get(type)?.toLowerCase() ?? type}
          </Link>
        </div>
      </main>
    );
  }

  const facts = headerFacts(type, entity);
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <BackLink onClick={back} />
      <header className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="font-display text-title-page">{nameOf(entity)}</h1>
          <span className="flex shrink-0 items-center gap-1.5 pt-1.5 text-caption text-ink-muted">
            <SourceBadge source={sourceOf(entity)} titleShownNearby />
            {typeof entity.page === 'number' && <span>p. {entity.page}</span>}
          </span>
        </div>
        {/* Spelled out here because a tooltip is a desktop-only affordance. */}
        <p className="text-caption text-ink-muted">{sourceName(sourceOf(entity))}</p>
      </header>
      {facts.length > 0 && (
        <dl className={`${cardClass} grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body`}>
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
      {type === 'book' && registry !== null && <BookExtras registry={registry} entity={entity} />}
    </main>
  );
}

function NoSuchSection({ type }: { type: string }) {
  usePageTitle('No such section', 'Library');
  return (
    <main className="flex flex-1 flex-col gap-3 px-4 pt-5 pb-4">
      <p className={NOTE}>
        There is no <span className="font-semibold text-ink">{type}</span> section in the library.
      </p>
      <Link to="/library" className={LINK}>
        Back to the library
      </Link>
    </main>
  );
}

export function Component() {
  const { type, uid } = useParams();
  const reg = useRegistryState();

  // The `:type` segment came out of a URL, so it is a string until checked.
  // Casting it used to produce a section with a plausible heading and nothing
  // in it, which reads as "the app lost my data" rather than "no such page".
  if (type !== undefined && !isEntityType(type)) return <NoSuchSection type={type} />;

  if (type !== undefined && uid !== undefined) {
    return <EntityDetail type={type} uid={uid} reg={reg} />;
  }
  if (type !== undefined) return <TypeList type={type} reg={reg} />;
  return <LibraryHome registry={reg.registry} />;
}
