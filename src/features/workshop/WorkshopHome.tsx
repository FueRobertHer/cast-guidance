/**
 * The Workshop's home (ADR-002, D1; the One Workshop canvas, board 1): the
 * player's own content, their collections and the table's rules, as three
 * shelves under one search.
 *
 * - Yours: what they made, narrowed by kind, each row opening its editor;
 * - Collections: each set of content on this device, the books too;
 * - Rules: the table rules every character plays by, and the rule packs.
 *
 * The search looks in theirs first, then their collections, then the books.
 * The shelf is kept in the address (`?shelf=`), so Back from a collection
 * comes back to Collections.
 *
 * Import opens the one Import sheet (board 7, `ImportSheet`) over the home,
 * kept in the address too (`?import`), so its links stay links. What it lands
 * is a collection: the home says so and shows Collections.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, FileUp, Plus, Search } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useRegistry, useRegistryState, useSearchState } from '@/data5e/hooks';
import { getActiveTag } from '@/data5e/loader';
import { type SearchResult, searchAll } from '@/data5e/search/client';
import { policyForSearch, useSourcePolicy } from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import { type HomebrewFileMeta, homebrewRepo } from '@/db/homebrewRepo';
import { appRulesFor } from '@/engine/rules';
import { usePacksHere } from '@/features/homebrew/PackReviewSheet';
import { choiceTitle, RULE_ORDER, RULE_TITLES } from '@/features/settings/RuleSheet';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { useAppTableRules } from '@/stores/tableRules';
import { Badge } from '@/ui/Badge';
import { buttonClass } from '@/ui/Button';
import { CollectionCard } from '@/ui/CollectionCard';
import { FilterChips } from '@/ui/FilterChips';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { BOOKS_PATH, collectionPath, collectionsOf, holdsOf, madeName } from './collections';
import { copiedFrom } from './copyWriter';
import { editPath, entriesOf, inFile, kindOf, labelOf, type Mine } from './yours';

const NOTE = 'text-body text-ink-muted';
const H2 = 'text-body-strong';
const LINK =
  'font-semibold text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink';
const ROW = `${listRowClass} transition-colors duration-120 hover:bg-surface-raised`;

type Shelf = 'yours' | 'collections' | 'rules';
const SHELVES: ReadonlyArray<{ value: Shelf; label: string }> = [
  { value: 'yours', label: 'Yours' },
  { value: 'collections', label: 'Collections' },
  { value: 'rules', label: 'Rules' },
];
const shelfOf = (v: string | null): Shelf => (v === 'collections' || v === 'rules' ? v : 'yours');

/** The words a search needs before it looks, as the Library's does. */
const MIN_QUERY = 2;

/** A row's title over its caption, with what sits at its end. */
function RowLink({
  to,
  title,
  caption,
  end,
}: {
  to: string;
  title: string;
  caption: string;
  end?: ReactNode;
}) {
  // A badge at the end drops below the name when the two do not fit side by
  // side (large text on a phone), rather than squeezing the name a few letters
  // a line.
  const wraps = end !== undefined;
  return (
    <Link to={to} className={wraps ? `${ROW} flex-wrap` : ROW}>
      <span className={`flex min-w-0 flex-1 flex-col ${wraps ? 'basis-40' : ''}`}>
        <span className="text-body-strong break-words">{title}</span>
        {/* A flex column draws no space between its items; a name read aloud needs one. */}
        <span className="sr-only">,</span>{' '}
        <span className="text-caption text-ink-muted">{caption}</span>
      </span>
      {end ?? <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />}
    </Link>
  );
}

/** One of the player's entries as a row: what it is, where it is kept, what it is based on. */
function mineRow(m: Mine, fileNames: ReadonlyMap<string, string>) {
  const name = String(m.entry.name);
  const from = copiedFrom(m.entry);
  const kept = fileNames.get(m.fileId);
  const caption = [kindOf(m.type), kept].filter((p) => p !== undefined).join(', ');
  return {
    key: `${m.fileId}:${m.type}:${name}|${String(m.entry.source)}`,
    to: `${editPath(m.type, name, String(m.entry.source))}${inFile(m.fileId)}`,
    name,
    caption: from === undefined ? caption : `${caption}. Based on ${from.name}`,
  };
}

/** The Make your own way in, until the Make sheet (U2) opens over this page. */
function MakeLink() {
  return (
    <Link to="/workshop/new" className={buttonClass({ variant: 'brand', size: 'sm' })}>
      <Plus size={16} aria-hidden />
      Make your own
    </Link>
  );
}

/** The address's word for an open Import sheet. */
const IMPORT_PARAM = 'import';

/** The Import sheet, loaded once it is first opened. */
const ImportSheet = lazy(() => import('./ImportSheet'));

/**
 * Where a file comes in: the Import sheet (U7), opened over this page by
 * `?import`, so the way in stays a link and Back leaves the page as before.
 */
function ImportLink({ label }: { label: string }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set(IMPORT_PARAM, '');
  return (
    <Link
      to={{ search: `?${next.toString()}` }}
      replace
      data-import-link=""
      className={buttonClass({ variant: 'outline', block: true })}
    >
      <FileUp size={16} aria-hidden />
      {label}
    </Link>
  );
}

function YoursShelf({
  mine,
  fileNames,
}: {
  mine: readonly Mine[] | undefined;
  fileNames: ReadonlyMap<string, string>;
}) {
  const [kind, setKind] = useState('all');
  if (mine === undefined) return <p className={NOTE}>Loading…</p>;
  if (mine.length === 0) {
    return (
      <section aria-labelledby="workshop-empty" className="flex flex-col gap-3 pt-2">
        <h2 id="workshop-empty" className="font-display text-title-card">
          Make it yours
        </h2>
        <p className={NOTE}>
          Make a spell, an item, a subclass or anything else a character can have, or open an entry
          in the{' '}
          <Link to="/library" className={LINK}>
            Library
          </Link>{' '}
          and make one like it. What you make works on your characters as soon as you save it.
        </p>
        <ImportLink label="Import a file or a link" />
        <p className={NOTE}>
          Someone shared a homebrew file or a Fight Club 5e compendium? Import it, and it lands as a
          collection.
        </p>
      </section>
    );
  }
  const kinds = [...new Set(mine.map((m) => m.type))];
  const shown = kinds.includes(kind) ? kind : 'all';
  const rows = mine.filter((m) => shown === 'all' || m.type === shown);
  return (
    <>
      {kinds.length > 1 && (
        <FilterChips
          label="Show"
          value={shown}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All', count: mine.length },
            ...kinds.map((t) => ({
              value: t,
              label: labelOf(t),
              count: mine.filter((m) => m.type === t).length,
            })),
          ]}
        />
      )}
      <ul className={listClass}>
        {rows.map((m) => {
          const row = mineRow(m, fileNames);
          return (
            <li key={row.key}>
              <RowLink
                to={row.to}
                title={row.name}
                caption={row.caption}
                end={<Badge tone="outline">New</Badge>}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function CollectionsShelf({
  rows,
  unreadable,
  names,
}: {
  rows: readonly HomebrewFileMeta[] | undefined;
  unreadable: number;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <>
      <ImportLink label="Import a file or a link" />
      {/* Until the collection page does it (U6), files are turned off and
          removed on the Homebrew page. */}
      <p className={NOTE}>
        To turn a file off or remove it:{' '}
        <Link to="/homebrew" className={LINK}>
          Import or manage files
        </Link>
      </p>
      {rows === undefined ? (
        <p className={NOTE}>Loading…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {collectionsOf(rows, names).map((c) => (
            <li key={c.id} className="flex flex-col">
              <CollectionCard
                to={collectionPath(c.id)}
                name={c.name}
                from={c.from}
                holds={holdsOf(c)}
              />
            </li>
          ))}
          <li className="flex flex-col">
            <CollectionCard
              to={BOOKS_PATH}
              name="The books"
              from={`Game data ${getActiveTag()}`}
              holds="Choose which books show"
            />
          </li>
        </ul>
      )}
      {unreadable > 0 && (
        <p className={NOTE}>
          {unreadable === 1 ? 'One file' : `${unreadable} files`} here could not be read. The{' '}
          <Link to="/homebrew" className={LINK}>
            Homebrew page
          </Link>{' '}
          says which.
        </p>
      )}
    </>
  );
}

function RulesShelf({ rows }: { rows: readonly HomebrewFileMeta[] | undefined }) {
  const registry = useRegistry();
  const rules = useAppTableRules();
  const packs = usePacksHere(rows);
  const app = appRulesFor(
    { byType: registry === null ? () => [] : (type) => registry.byType(type as never), rules },
    '2024',
  );
  return (
    <>
      <section aria-labelledby="workshop-rules" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 px-1">
          <h2 id="workshop-rules" className={H2}>
            Table rules
          </h2>
          <span className="text-caption text-ink-muted">Every character</span>
        </div>
        <ul className={listClass}>
          {RULE_ORDER.map((id) => (
            <li key={id}>
              <RowLink
                to="/workshop/rules"
                title={RULE_TITLES[id]}
                caption={choiceTitle(id, app.rules[id])}
              />
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="workshop-packs" className="flex flex-col gap-2">
        <h2 id="workshop-packs" className={`${H2} px-1`}>
          Rule packs
        </h2>
        {packs === undefined ? (
          <p className={NOTE}>Loading…</p>
        ) : packs.length === 0 ? (
          <p className={NOTE}>
            None yet. A rule pack is a file that changes rules for the characters it applies to.
          </p>
        ) : (
          <ul className={listClass}>
            {packs.map((p) => (
              <li key={p.id}>
                <RowLink
                  to="/workshop/rules"
                  title={p.review.name}
                  caption={p.enabled ? 'On' : 'Off'}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface Found {
  key: string;
  to: string;
  name: string;
  caption: string;
}

/** A search hit in the Library, where it opens. */
function hitRow(h: SearchResult['hits'][number]): Found {
  return {
    key: h.id,
    to: `/library/${h.type}/${encodeURIComponent(h.uid)}`,
    name: h.name,
    caption: `${kindOf(h.type)}, ${sourceName(h.source)}`,
  };
}

function ResultGroup({ id, head, rows }: { id: string; head: string; rows: readonly Found[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id={id} className={H2}>
          {head}
        </h2>
        <span className="text-caption text-ink-muted">{rows.length}</span>
      </div>
      <ul className={listClass}>
        {rows.map((r) => (
          <li key={r.key}>
            <RowLink to={r.to} title={r.name} caption={r.caption} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * An entry as the index ids it (`type:name|source`, lower case). The id keeps
 * the whole name where a hit's `name` is cut to what is indexed.
 */
const entryKey = (type: string, name: string, source: string) =>
  `${type}:${`${name}|${source}`.toLowerCase()}`;

/**
 * The search: theirs from the files they made, as typed; their collections
 * and the books from the Library's index, once it is ready. Their own entries
 * are in the index too, so its hits for those are left to Yours. Only those:
 * a friend's Workshop file shares the player's source (every device's is
 * `MyHomebrew`), and its entries are a collection's.
 */
function SearchResults({
  query,
  yours,
  own,
  rows,
}: {
  query: string;
  yours: readonly Found[];
  /** Every entry of the player's own, by {@link entryKey}. */
  own: ReadonlySet<string>;
  rows: readonly HomebrewFileMeta[] | undefined;
}) {
  const reg = useRegistryState();
  const { status, indexVersion } = useSearchState(reg.registry);
  const policy = useSourcePolicy();
  const [result, setResult] = useState<{ query: string; found: SearchResult }>();
  const sources = policyForSearch(policy);
  const sourcesKey = sources === undefined ? '' : JSON.stringify(sources);
  const ready = status === 'ready';

  // The index rebuilds behind a `ready` status as game data lands or a
  // collection is turned on, so `indexVersion` asks again after each build,
  // as the Library's search does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sourcesKey stands in for the sources object; indexVersion re-asks after a rebuild
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const t = setTimeout(() => {
      void searchAll(query, { sources }).then((found) => {
        if (alive) setResult({ query, found });
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, ready, sourcesKey, indexVersion]);

  // Any file's sources, the player's included: an entry of theirs the
  // Workshop does not edit is still in one of their collections.
  const brews = useMemo(
    () => new Set((rows ?? []).flatMap((r) => r.sourceIds.map((s) => s.toLowerCase()))),
    [rows],
  );
  const hits = result?.query === query ? result.found.hits : [];
  const others = hits.filter((h) => !own.has(h.id));
  const collected = others.filter((h) => brews.has(h.source.toLowerCase())).map(hitRow);
  const books = others.filter((h) => !brews.has(h.source.toLowerCase())).map(hitRow);
  const settled = result?.query === query || status === 'error' || reg.error !== null;
  const total = yours.length + collected.length + books.length;

  // Said once a query settles. A rebuild behind the same query is not news,
  // so it stays quiet, as in the Library.
  const spokenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!settled) return;
    const asked = `${query}
${sourcesKey}`;
    if (spokenFor.current === asked) return;
    spokenFor.current = asked;
    announce(
      total === 0
        ? `Nothing called ${query}`
        : `${total} ${total === 1 ? 'result' : 'results'} for ${query}`,
      { key: 'workshop-search', settleMs: 750, repeat: true },
    );
  }, [settled, total, query, sourcesKey]);
  useEffect(() => () => cancelAnnouncement('workshop-search'), []);

  return (
    <>
      <ResultGroup id="found-yours" head="Yours" rows={yours} />
      <ResultGroup id="found-collections" head="In your collections" rows={collected} />
      <ResultGroup id="found-books" head="In the books" rows={books} />
      {books.length > 0 && <p className={NOTE}>Open a book&rsquo;s entry to make one like it.</p>}
      {status === 'error' || reg.error !== null ? (
        <p className={NOTE}>Your collections and the books cannot be searched right now.</p>
      ) : !settled ? (
        <p className={NOTE}>Searching your collections and the books…</p>
      ) : (
        total === 0 && (
          <p className={NOTE}>
            Nothing called &ldquo;{query}&rdquo; in your content, your collections or the books. Try
            a shorter word, or make it yourself.
          </p>
        )
      )}
    </>
  );
}

export function Component() {
  usePageTitle('Workshop');
  const [params, setParams] = useSearchParams();
  const shelf = shelfOf(params.get('shelf'));
  const [q, setQ] = useState('');
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const meta = useLiveQuery(() => homebrewRepo.listMetaSafe(), []);
  const mine = useMemo(() => (owned === undefined ? undefined : entriesOf(owned.files)), [owned]);
  const own = useMemo(
    () =>
      new Set(
        (mine ?? []).map((m) => entryKey(m.type, String(m.entry.name), String(m.entry.source))),
      ),
    [mine],
  );
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of owned?.files ?? []) out.set(f.id, madeName(f.json) ?? f.fileName);
    return out;
  }, [owned]);
  // What the last import did, on screen and said once (A11Y-002).
  const [outcome, setOutcome] = useState<string>();
  const importing = params.has(IMPORT_PARAM);
  const page = useRef<HTMLElement>(null);
  const closedImport = useRef(false);
  const closeImport = (shelfAfter?: Shelf) => {
    const next = new URLSearchParams(params);
    next.delete(IMPORT_PARAM);
    if (shelfAfter !== undefined) next.set('shelf', shelfAfter);
    closedImport.current = true;
    setParams(next, { replace: true });
  };
  // The sheet has no trigger of its own to give focus back to, and swaps one
  // dialog for the preview's, so focus goes back to the way in on the shelf
  // it closes to: a keyboard is not left at the top of the page.
  useEffect(() => {
    if (importing || !closedImport.current) return;
    closedImport.current = false;
    page.current?.querySelector<HTMLElement>('[data-import-link]')?.focus({ preventScroll: true });
  }, [importing]);
  const query = q.trim();
  const searching = query.length >= MIN_QUERY;
  const found = searching
    ? (mine ?? [])
        .filter((m) => String(m.entry.name).toLowerCase().includes(query.toLowerCase()))
        .map((m) => {
          const row = mineRow(m, names);
          return { key: row.key, to: row.to, name: row.name, caption: row.caption };
        })
    : [];

  return (
    <main ref={page} className="flex flex-1 flex-col gap-4 px-4 pt-5 pb-4">
      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <h1 className="font-display text-title-page">Workshop</h1>
        <MakeLink />
      </header>
      {/* Said through the announcer when it is set, so this is no live region. */}
      {outcome !== undefined && (
        <p data-import-status="" className="text-caption text-ink-muted">
          {outcome}
        </p>
      )}
      <div className="relative">
        <Search
          size={20}
          aria-hidden
          className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search your content, collections and the books"
          placeholder="Search everything"
          className={`${fieldClass} pl-10.5`}
        />
      </div>
      {searching ? (
        <SearchResults query={query} yours={found} own={own} rows={meta?.files} />
      ) : (
        <>
          <SegmentedControl
            label="Shelf"
            block
            options={SHELVES}
            value={shelf}
            onChange={(next) =>
              setParams(next === 'yours' ? {} : { shelf: next }, { replace: true })
            }
          />
          {shelf === 'yours' && <YoursShelf mine={mine} fileNames={names} />}
          {shelf === 'collections' && (
            <CollectionsShelf
              rows={meta?.files}
              unreadable={meta?.errors.length ?? 0}
              names={names}
            />
          )}
          {shelf === 'rules' && <RulesShelf rows={meta?.files} />}
        </>
      )}
      {importing && (
        <Suspense fallback={null}>
          <ImportSheet
            onClose={() => closeImport()}
            onDone={(text, landed) => {
              setOutcome(text);
              announce(text, { key: 'import', repeat: true });
              // What came in is a collection: the shelf it is on. Nothing else moves the page.
              closeImport(landed ? 'collections' : undefined);
            }}
          />
        </Suspense>
      )}
    </main>
  );
}
