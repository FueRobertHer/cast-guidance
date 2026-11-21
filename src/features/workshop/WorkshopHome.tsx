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
 *
 * Select on Yours (board 9) turns its rows into checkboxes, and a bar over the
 * tab bar moves, exports or deletes what is picked (`SelectBar`). A delete is
 * offered back with Undo, which puts every entry back in its place.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, FileUp, ListChecks, Plus, Search, X } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useRegistry, useRegistryState, useSearchState } from '@/data5e/hooks';
import { getActiveTag } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { type SearchResult, searchAll } from '@/data5e/search/client';
import { policyForSearch, useSourcePolicy } from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import {
  type HomebrewFileMeta,
  type HomebrewReadError,
  homebrewRepo,
  type Removed,
} from '@/db/homebrewRepo';
import { appRulesFor } from '@/engine/rules';
import { usePacksHere } from '@/features/homebrew/PackReviewSheet';
import { choiceTitle, RULE_ORDER, RULE_TITLES } from '@/features/settings/RuleSheet';
import { usePageTitle } from '@/lib/usePageTitle';
import { useUndoOffer } from '@/lib/useUndoOffer';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { notifyFailure } from '@/stores/notices';
import { useAppTableRules } from '@/stores/tableRules';
import { Badge } from '@/ui/Badge';
import { Button, buttonClass } from '@/ui/Button';
import { CollectionCard } from '@/ui/CollectionCard';
import { FilterChips } from '@/ui/FilterChips';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { UndoBar } from '@/ui/UndoBar';
import { BOOKS_PATH, collectionPath, collectionsOf, holdsOf, madeName } from './collections';
import { copiedFrom } from './copyWriter';
import { editPath, entriesOf, inFile, kindOf, labelOf, type Mine, mineKey } from './yours';

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
    key: mineKey(m),
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

/** The select mode's bar and sheets, loaded once select mode is first opened. */
const SelectBar = lazy(() => import('./SelectBar'));

/** The files' revisions, for Undo to tell whether anything changed since a delete. */
interface Revisions {
  revs: Readonly<Record<string, number>>;
  /** What a delete took out, on the snapshot from before it. */
  removed?: Removed;
}

/**
 * Whether no file `b` names has moved past the revision it says, in `a`. The
 * list can lag the delete's own write for a moment, and an Undo then still
 * counts; the repo's restore checks the revision itself.
 */
const sameRevisions = (a: Revisions, b: Revisions) =>
  Object.entries(b.revs).every(([id, rev]) => {
    const now = a.revs[id];
    return now !== undefined && now <= rev;
  });

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

/** Select mode on Yours: what is picked, and how a row is picked or let go. */
interface Selecting {
  chosen: ReadonlySet<string>;
  toggle: (key: string) => void;
}

function YoursShelf({
  mine,
  fileNames,
  kind,
  onKind,
  selecting,
  onSelect,
}: {
  mine: readonly Mine[] | undefined;
  fileNames: ReadonlyMap<string, string>;
  /** The kind shown, `all` for every one. */
  kind: string;
  onKind: (kind: string) => void;
  /** Select mode, when it is on. */
  selecting?: Selecting;
  onSelect: () => void;
}) {
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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {kinds.length > 1 && (
            <FilterChips
              label="Show"
              value={shown}
              onChange={onKind}
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
        </div>
        {selecting === undefined && (
          <Button variant="ghost" size="sm" data-select-start="" onClick={onSelect}>
            <ListChecks size={16} aria-hidden />
            Select
          </Button>
        )}
      </div>
      <ul className={listClass}>
        {rows.map((m) => {
          const row = mineRow(m, fileNames);
          return (
            <li key={row.key}>
              {selecting === undefined ? (
                <RowLink
                  to={row.to}
                  title={row.name}
                  caption={row.caption}
                  end={<Badge tone="outline">New</Badge>}
                />
              ) : (
                <label className={`${ROW} cursor-pointer`}>
                  <input
                    type="checkbox"
                    checked={selecting.chosen.has(row.key)}
                    onChange={() => selecting.toggle(row.key)}
                    className="size-5 shrink-0 accent-brand"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-strong break-words">{row.name}</span>
                    <span className="sr-only">,</span>{' '}
                    <span className="text-caption text-ink-muted">{row.caption}</span>
                  </span>
                </label>
              )}
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
  unreadable: readonly HomebrewReadError[];
  names: ReadonlyMap<string, string>;
}) {
  return (
    <>
      <ImportLink label="Import a file or a link" />
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
      {unreadable.length > 0 && <Unreadable errors={unreadable} />}
    </>
  );
}

/**
 * The files stored here that could not be read, so none of them is in use.
 * Each opens its collection page, which offers to delete it; one with no id
 * cannot be opened or deleted, so it is named alone.
 */
function Unreadable({ errors }: { errors: readonly HomebrewReadError[] }) {
  const one = errors.length === 1;
  const opens = errors.some((e) => e.id !== undefined);
  return (
    <section aria-labelledby="unreadable-head" className="flex flex-col gap-1.5">
      <h2 id="unreadable-head" className={H2}>
        Could not be read
      </h2>
      <p className={NOTE}>
        {one ? 'One file' : `${errors.length} files`} here could not be read, so{' '}
        {one ? 'it is' : 'they are'} not in use.{opens && ' Open one to delete it.'}
      </p>
      <ul className="flex flex-col gap-1.5">
        {errors.map((e) => {
          const name = e.fileName ?? 'A file with no name';
          return (
            <li key={e.id ?? `${name}|${e.message}`} className="text-body break-words">
              {e.id === undefined ? (
                <span className="text-body-strong">{name}</span>
              ) : (
                <Link
                  to={collectionPath(e.id)}
                  className={`${LINK} inline-flex min-h-6 items-center`}
                >
                  {name}
                </Link>
              )}
              <span className="text-ink-muted">: {e.message}</span>
            </li>
          );
        })}
      </ul>
    </section>
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
  // What the last import, move or export did, on screen and said once (A11Y-002).
  const [outcome, setOutcome] = useState<string>();
  const [kind, setKind] = useState('all');

  // Select mode (board 9): rows by `mineKey`. Only rows on show count as
  // picked, so a kind filter never leaves a hidden entry picked.
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  // A move or delete sheet over the bar: it keeps select mode on to the end,
  // even if another tab empties the list meanwhile.
  const [sheetOpen, setSheetOpen] = useState(false);
  const kinds = new Set((mine ?? []).map((m) => m.type));
  const shownKind = kinds.has(kind) ? kind : 'all';
  const shown = (mine ?? []).filter((m) => shownKind === 'all' || m.type === shownKind);
  const picked = shown.filter((m) => chosen.has(mineKey(m)));
  const inSelect = selecting && shelf === 'yours' && (shown.length > 0 || sheetOpen);
  // Where the keyboard goes once select mode starts or stops: its first
  // control, or back to Select. After a delete it goes to Undo instead.
  const focusTo = useRef<string | null>(null);
  const select = (on: boolean, focus: string | null) => {
    setSelecting(on);
    setChosen(new Set());
    focusTo.current = focus;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once select mode has started or stopped
  useEffect(() => {
    const to = focusTo.current;
    if (to === null) return;
    focusTo.current = null;
    focusOn(to);
  }, [inSelect]);
  // The list emptied with no sheet open (another tab took the last entry):
  // select mode ends rather than coming back with the next entry made.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the list or a sheet changes
  useEffect(() => {
    if (selecting && mine !== undefined && shown.length === 0 && !sheetOpen) {
      // Select mode has already left the page: the keyboard goes back now.
      select(false, null);
      focusOn('[data-select-start]');
    }
  }, [mine, sheetOpen]);
  const toggle = (key: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Undo of a delete, offered until one of the files it changed changes again.
  const revisions = useMemo<Revisions | null>(
    () =>
      owned === undefined
        ? null
        : { revs: Object.fromEntries(owned.files.map((f) => [f.id, f.rev ?? 0])) },
    [owned],
  );
  const [undoFocus, setUndoFocus] = useState(0);
  const page = useRef<HTMLElement>(null);
  /**
   * The keyboard's way back onto the page: `to` (Select), else search when
   * there is nothing to select, else Stop selecting while select mode is on.
   */
  const focusOn = (to: string) =>
    (
      page.current?.querySelector<HTMLElement>(to) ??
      page.current?.querySelector<HTMLElement>('input[type="search"]') ??
      page.current?.querySelector<HTMLElement>('[data-select-stop]')
    )?.focus({ preventScroll: true });
  // "Undone" waits for the write, so an Undo another tab's change refuses never says it.
  const [restoring, setRestoring] = useState(false);
  const deleted = useUndoOffer<Revisions>({
    current: revisions,
    same: sameRevisions,
    restore: (before) => {
      if (before.removed === undefined) return;
      setRestoring(true);
      homebrewRepo.restoreEntries(before.removed).then(
        () => {
          setRestoring(false);
          invalidateRegistry();
        },
        (err: unknown) => {
          setRestoring(false);
          deleted.dismiss();
          notifyFailure('Undo', err);
          // The Undo button went with the offer.
          focusOn('[data-select-start]');
        },
      );
    },
  });
  const importing = params.has(IMPORT_PARAM);
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
    <main
      ref={page}
      className={`flex flex-1 flex-col gap-4 px-4 pt-5 ${inSelect ? 'pb-[calc(var(--select-bar-h,6rem)+1rem)]' : 'pb-4'}`}
    >
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
      <UndoBar
        pending={deleted.pending}
        undone={restoring ? null : deleted.undone}
        onUndo={() => void deleted.run()}
        focusRequest={undoFocus}
      />
      {inSelect ? (
        // Escape leaves select mode, as the X does.
        // biome-ignore lint/a11y/noStaticElementInteractions: a key handler for the controls inside it
        <div
          className="flex flex-col gap-4"
          onKeyDown={(e) => {
            if (e.key === 'Escape') select(false, '[data-select-start]');
          }}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Stop selecting"
              data-select-stop=""
              onClick={() => select(false, '[data-select-start]')}
            >
              <X size={20} aria-hidden />
            </Button>
            <p className="min-w-0 flex-1 text-body-strong">
              {picked.length === 0 ? 'Select entries' : `${picked.length} selected`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              // Over the rows on show only: a pick a kind filter hides stays as it was.
              onClick={() =>
                setChosen((was) => {
                  const next = new Set(was);
                  const all = picked.length === shown.length;
                  for (const m of shown) {
                    if (all) next.delete(mineKey(m));
                    else next.add(mineKey(m));
                  }
                  return next;
                })
              }
            >
              {picked.length === shown.length ? 'Select none' : 'Select all'}
            </Button>
          </div>
          <YoursShelf
            mine={mine}
            fileNames={names}
            kind={shownKind}
            onKind={setKind}
            selecting={{ chosen, toggle }}
            onSelect={() => undefined}
          />
        </div>
      ) : (
        <>
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
              {shelf === 'yours' && (
                <YoursShelf
                  mine={mine}
                  fileNames={names}
                  kind={shownKind}
                  onKind={setKind}
                  onSelect={() => select(true, '[data-select-stop]')}
                />
              )}
              {shelf === 'collections' && (
                <CollectionsShelf
                  rows={meta?.files}
                  unreadable={meta?.errors ?? []}
                  names={names}
                />
              )}
              {shelf === 'rules' && <RulesShelf rows={meta?.files} />}
            </>
          )}
        </>
      )}
      {inSelect && owned !== undefined && (
        <Suspense fallback={null}>
          <SelectBar
            picked={picked}
            files={owned.files}
            names={names}
            onDone={(text, stay) => {
              // An export that saved nothing keeps the selection to try again.
              if (stay !== true) select(false, '[data-select-start]');
              setOutcome(text);
              announce(text, { key: 'workshop-select', repeat: true });
            }}
            onEscape={() => select(false, '[data-select-start]')}
            onSheet={setSheetOpen}
            onDeleted={(removed, title, detail) => {
              select(false, null);
              setOutcome(undefined);
              // Undo's write moves each file one revision on, so "Undone"
              // stays until the next change to one of them.
              const revs = (step: number) =>
                Object.fromEntries(removed.files.map((f) => [f.id, f.rev + step]));
              deleted.offer({ revs: revs(1), removed }, { revs: revs(0) }, title, detail);
              setUndoFocus((n) => n + 1);
            }}
          />
        </Suspense>
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
