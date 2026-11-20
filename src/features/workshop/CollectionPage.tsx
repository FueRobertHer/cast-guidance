/**
 * One collection, at `/workshop/collection/:id` (ADR-002, D1; board 8): the
 * page that takes the place of the Homebrew page's file card and the Builder.
 * What it holds, by kind, each entry opening where it is edited or read;
 * where it is on, for this device and for each character (D3); where it came
 * from, and an update from its link or a newer file through the Import
 * sheet; what needs a look after an update (E3's data, both versions); export
 * and delete.
 *
 * `:id` is the collection's address (`collections.ts`), which an update
 * keeps; `books` is The books (`BooksPage.tsx`).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronRight, Download, Ellipsis, Plus, Share2, Trash2 } from 'lucide-react';
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { applyMod, uidOf } from '@/data5e/copyMod';
import { getRevision, subscribeRevision } from '@/data5e/landing';
import { type ChangedEntry, type ChangeLayer, identityKey } from '@/data5e/normalize';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { sharedFile } from '@/data5e/rulePack';
import {
  characterSourceSwitches,
  ensureSourcesVisible,
  readSourcePolicy,
  type SourcePolicy,
} from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import {
  EntryClash,
  type EntryKey,
  type HomebrewFileMeta,
  homebrewRepo,
  ownsEntries,
} from '@/db/homebrewRepo';
import type { CharacterDoc } from '@/engine/types';
import { usePacksHere } from '@/features/homebrew/PackReviewSheet';
import { TYPE_LABELS } from '@/features/library/browseTypes';
import { downloadJson, jsonFilename } from '@/lib/download';
import { safeExternalHref } from '@/lib/url';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { useDataStatus } from '@/stores/dataStatus';
import { errorText, notify, notifyFailure } from '@/stores/notices';
import { Badge } from '@/ui/Badge';
import { Button, buttonClass } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { askChoice, askConfirm, askText } from '@/ui/dialogs';
import { FilterChips } from '@/ui/FilterChips';
import { listClass, listRowClass } from '@/ui/surfaces';
import { deviceOn, isChanges, reachesRow, switchedTo } from './collectionSwitches';
import {
  BOOKS_ID,
  type Collection,
  collectionPath,
  collectionWith,
  holdsOf,
  madeName,
} from './collections';
import { changeCount, writeChange } from './copyWriter';
import { EDITORS } from './editorTypes';
import { editPath, inFile, kindOf, labelOf } from './yours';

const BooksPage = lazy(() => import('./BooksPage'));
const ImportSheet = lazy(() => import('./ImportSheet'));

type Json = Record<string, unknown>;

const NOTE = 'text-body text-ink-muted';
const CAPTION = 'text-caption text-ink-muted';
const HEAD = 'px-1 text-heading';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
const ICON_ACTION =
  'tap -my-2 shrink-0 rounded-control text-ink-muted transition-colors duration-120 hover:bg-surface-raised hover:text-ink';
const LINK =
  'font-semibold text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink';
/** The most rows a list shows at once; the rest wait for Show all. */
const PAGE = 100;

const lower = (s: string) => s.toLowerCase();
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** "Hild", "Hild and Osk", "Hild, Maren and Osk". */
const andList = (names: readonly string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

// ---------------------------------------------------------------------------
// Where it is on

const names = (list: readonly string[], of: readonly string[]) =>
  list.some((x) => of.some((s) => lower(s) === lower(x)));

/**
 * Write a character's switches, as its sheet would save: against the
 * revision read, read again when another tab wrote in between.
 */
async function setSwitches(
  id: string,
  next: (doc: CharacterDoc) => CharacterDoc['sourceSwitches'],
): Promise<void> {
  for (let tries = 0; tries < 3; tries += 1) {
    const read = await characterRepo.getWithRevision(id);
    if (read === undefined) throw new Error('that character is no longer on this device');
    const { sourceSwitches: _, ...rest } = read.doc;
    const switches = next(read.doc);
    const doc: CharacterDoc = switches === undefined ? rest : { ...rest, sourceSwitches: switches };
    const done = await characterRepo.save(doc, {
      kind: 'revision',
      revision: read.revision,
      content: read.doc,
    });
    if (done.status === 'saved') return;
    if (done.status === 'missing') throw new Error('that character is no longer on this device');
  }
  throw new Error('that character kept changing in another tab');
}

/** Turn a file or a book on or off on this device; on shows its sources too. */
function toggle(r: HomebrewFileMeta, on: boolean): void {
  void (async () => {
    await homebrewRepo.setEnabled(r.id, on);
    if (on) await ensureSourcesVisible(r.sourceIds);
    invalidateRegistry();
  })().catch((err: unknown) => notifyFailure(on ? 'Turn on' : 'Turn off', err));
}

/** A row's switch for this device: its name stays put while its face says On or Off. */
function Switch({ on, name, onPress }: { on: boolean; name: string; onPress: () => void }) {
  return (
    <Chip
      tone="outline"
      aria-label={`Use ${name}`}
      pressed={on}
      onClick={onPress}
      className="-my-1 shrink-0"
    >
      {on ? 'On' : 'Off'}
    </Chip>
  );
}

/** A file's content as it leaves this device, as Download and Share give it. */
async function contentToShare(r: HomebrewFileMeta): Promise<Json> {
  const { file, error } = await homebrewRepo.getSafe(r.id);
  if (file === undefined) throw new Error(error?.message ?? 'the file is gone');
  return sharedFile(file.json);
}

async function download(r: HomebrewFileMeta, name: string): Promise<void> {
  try {
    downloadJson(name, await contentToShare(r));
  } catch (err) {
    notifyFailure('Export', err);
  }
}

function canShareFiles(): boolean {
  try {
    return (
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File(['{}'], 'a.json', { type: 'application/json' })] })
    );
  } catch {
    return false;
  }
}

async function share(r: HomebrewFileMeta, name: string): Promise<void> {
  try {
    const json = JSON.stringify(await contentToShare(r), null, 2);
    const file = new File([json], jsonFilename(name), { type: 'application/json' });
    await navigator.share({ files: [file], title: name });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    notifyFailure('Share', err);
  }
}

/**
 * Each row's name in the list of copies or books: a book by its name, a copy
 * by its file and the day it came in, with the time when two share a day and
 * a number when they share that too, so no two switches have one name.
 */
function rowNames(rows: readonly HomebrewFileMeta[]): Map<string, string> {
  const out = new Map<string, string>();
  const by = (name: (r: HomebrewFileMeta) => string, list: readonly HomebrewFileMeta[]) => {
    const groups = new Map<string, HomebrewFileMeta[]>();
    for (const r of list) groups.set(name(r), [...(groups.get(name(r)) ?? []), r]);
    return groups;
  };
  const day = (r: HomebrewFileMeta) =>
    r.book ?? `${r.fileName}, added ${new Date(r.addedAt).toLocaleDateString()}`;
  const time = (r: HomebrewFileMeta) =>
    r.book ?? `${r.fileName}, added ${new Date(r.addedAt).toLocaleString()}`;
  for (const [first, same] of by(day, rows)) {
    if (same.length === 1) {
      out.set(same[0]?.id ?? '', first);
      continue;
    }
    for (const [second, still] of by(time, same)) {
      for (const [i, r] of still.entries())
        out.set(r.id, still.length === 1 ? second : `${second} (${i + 1} of ${still.length})`);
    }
  }
  return out;
}

function OnSection({
  c,
  device,
  characters,
  pack,
}: {
  c: Collection;
  /** The books' choice of what shows, as read: never the default while it loads. */
  device: SourcePolicy;
  characters: readonly CharacterDoc[] | undefined;
  /** Undefined while it is not yet known whether a rule pack is here. */
  pack: boolean | undefined;
}) {
  // Every character whose write has not ended: taps on two run side by side.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const many = c.rows.length > 1;
  const books = c.rows[0]?.book !== undefined;
  const named = rowNames(c.rows);
  const ours = c.rows.flatMap((r) => r.sourceIds);
  const anyOn = c.rows.some((r) => deviceOn(r, device));

  const write = (doc: CharacterDoc, on: boolean | 'device') => {
    setBusy((b) => new Set(b).add(doc.id));
    void setSwitches(doc.id, (now) => switchedTo(now, c.rows, device, on))
      .catch((err: unknown) => notifyFailure(`Switch for ${doc.name}`, err))
      .finally(() =>
        setBusy((b) => {
          const next = new Set(b);
          next.delete(doc.id);
          return next;
        }),
      );
  };
  const switched = (characters ?? []).filter((d) => {
    const { on, off } = characterSourceSwitches(d.sourceSwitches);
    return names(on, ours) || names(off, ours);
  });
  const who = (characters ?? []).filter((d) => c.rows.some((r) => reachesRow(d, r, device)));

  return (
    <section aria-labelledby="where-on" className="flex flex-col gap-2">
      <h2 id="where-on" className={HEAD}>
        Where it is on
      </h2>
      {many ? (
        <ul className={listClass} aria-label={books ? 'Its books' : 'Its copies'}>
          {inOrder(c).map((r) => {
            const name = named.get(r.id) ?? r.fileName;
            const on = deviceOn(r, device);
            return (
              <li key={r.id} className={`${listRowClass} flex-wrap`}>
                <span className="min-w-0 flex-1 basis-40 break-words">{name}</span>
                <button
                  type="button"
                  aria-label={`Export ${name}`}
                  title="Export"
                  onClick={() => void download(r, r.book ?? r.fileName)}
                  className={ICON_ACTION}
                >
                  <Download size={18} aria-hidden />
                </button>
                <Switch on={on} name={name} onPress={() => toggle(r, !on)} />
              </li>
            );
          })}
        </ul>
      ) : (
        c.rows.map((r) => {
          const on = deviceOn(r, device);
          return (
            <div key={r.id} className={listClass}>
              <div className={`${listRowClass} flex-wrap`}>
                <span className="min-w-0 flex-1 basis-40">
                  {on
                    ? 'In use on this device'
                    : r.enabled
                      ? 'Hidden by The books’ choice of what shows'
                      : 'Turned off on this device'}
                </span>
                <Switch on={on} name={c.name} onPress={() => toggle(r, !on)} />
              </div>
            </div>
          );
        })
      )}
      <p className={`px-1 ${CAPTION}`}>
        On this device: the Library, search, new characters and every character without a switch of
        its own.
      </p>
      {pack ? (
        <p className={`px-1 ${CAPTION}`}>
          A rule pack reaches the characters its review applies it to, so it has no switch for each
          character here.
        </p>
      ) : characters === undefined || pack === undefined ? null : characters.length === 0 ? (
        <p className={`px-1 ${CAPTION}`}>No characters yet.</p>
      ) : (
        <>
          <h3 id="for-each" className="px-1 text-body-strong">
            For each character
          </h3>
          {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs */}
          <div role="group" aria-labelledby="for-each" className="-mx-1.5 flex flex-wrap">
            {characters.map((d) => {
              const on = c.rows.some((r) => reachesRow(d, r, device));
              return (
                <Chip
                  key={d.id}
                  tone="outline"
                  pressed={on}
                  aria-label={`${d.name} picks from it`}
                  disabled={busy.has(d.id)}
                  onClick={() => write(d, !on)}
                >
                  {d.name}
                </Chip>
              );
            })}
          </div>
          <p className={`px-1 ${CAPTION}`}>
            {who.length === 0
              ? 'No character picks from it.'
              : who.length === characters.length
                ? 'Every character picks from it.'
                : `${andList(who.map((d) => d.name))} ${who.length === 1 ? 'picks' : 'pick'} from it.`}{' '}
            {anyOn ? 'New characters do too.' : 'New characters do not.'} Off for a character, it
            leaves that character&rsquo;s pickers; what is already on its sheet keeps counting.
          </p>
          {switched.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                for (const d of switched) write(d, 'device');
              }}
            >
              Every character as this device
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// What it holds

/** Kinds a file you made keeps with the entry that owns them, saved and deleted with it. */
const OWNED_KINDS = new Set(['classFeature', 'subclassFeature']);
const FEATURES = new Set(['classFeature', 'subclassFeature']);

interface Entry {
  type: string;
  entry: Json;
  name: string;
}

function entriesIn(json: Json, own: boolean): Entry[] {
  const out: Entry[] = [];
  for (const [type, list] of Object.entries(json)) {
    if (type === '_meta' || !Array.isArray(list)) continue;
    if (own && (OWNED_KINDS.has(type) || !EDITORS.has(type))) continue;
    for (const e of list)
      if (isRecord(e) && typeof e.name === 'string') out.push({ type, entry: e, name: e.name });
  }
  return out;
}

/** An entry's page in the Library, by its own name and source (bug 4). */
function libraryPath(type: string, e: Json): string | undefined {
  if (!TYPE_LABELS.has(type) && !FEATURES.has(type)) return undefined;
  const uid = FEATURES.has(type) ? identityKey(type, e) : uidOf(e);
  return `/library/${type}/${encodeURIComponent(uid)}`;
}

/** Every pick of a character's that names an entry `test` takes, by name. */
function heldBy(doc: CharacterDoc, test: (name: string, source: string) => boolean): string[] {
  const found = new Map<string, string>();
  const text = (s: string, fromObject: boolean) => {
    const [name, source, ...rest] = s.split('|');
    if (name === undefined || source === undefined || rest.length > 0) return;
    if (!test(name, source)) return;
    if (fromObject || !found.has(lower(name))) found.set(lower(name), name);
  };
  const walk = (v: unknown, depth: number) => {
    if (depth > 16) return;
    if (typeof v === 'string') return text(v, false);
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (!isRecord(v)) return;
    if (typeof v.name === 'string' && typeof v.source === 'string')
      text(`${v.name}|${v.source}`, true);
    for (const [k, x] of Object.entries(v)) {
      // A pick's key names what it is in: `feat:<name|source>:…`.
      for (const part of k.split(':')) if (part.includes('|')) text(part, false);
      walk(x, depth + 1);
    }
  };
  walk(doc, 0);
  return [...found.values()];
}

/**
 * "Hild has Ember Lance. Osk has Ember Ward and Frost Ward." or nobody, read
 * when asked: the list on screen may not have loaded yet.
 */
async function losses(
  test: (name: string, source: string) => boolean,
  partly = false,
): Promise<string> {
  const { characters } = await characterRepo.listSafe();
  const lines = characters
    .map((d) => [d.name, heldBy(d, test)] as const)
    .filter(([, held]) => held.length > 0)
    .map(([who, held]) => `${who} has ${andList(held)}.`);
  if (lines.length > 0) return lines.join(' ');
  return partly ? 'No character has any of what could be read.' : 'No character has any of it.';
}

/**
 * Whether an entry is one of a collection's, by its own name and source: an
 * entry can name a source its file does not declare. `unread` names each row
 * whose content could not be read, so what it held is not known.
 */
async function heldIn(c: Collection): Promise<{
  test: (name: string, source: string) => boolean;
  unread: string[];
}> {
  const ids = new Set<string>();
  const unread: string[] = [];
  for (const r of c.rows) {
    const { file } = await homebrewRepo.getSafe(r.id);
    if (file === undefined) unread.push(r.book ?? r.fileName);
    for (const e of file === undefined ? [] : entriesIn(file.json, false)) {
      if (typeof e.entry.source === 'string') ids.add(`${lower(e.name)}|${lower(e.entry.source)}`);
    }
  }
  return { test: (name, source) => ids.has(`${lower(name)}|${lower(source)}`), unread };
}

/** What deleting a collection takes, for its confirm. */
async function deleteDetail(c: Collection, strays: number): Promise<string> {
  const parts: string[] = [];
  if (c.rows.some(isChanges)) {
    parts.push('Every entry it changes is the book’s again.');
  } else {
    const { test, unread } = await heldIn(c);
    parts.push(`Its entries leave every picker. ${await losses(test, unread.length > 0)}`);
    if (unread.length > 0) {
      parts.push(
        `${andList(unread)} could not be read, so who has ${unread.length === 1 ? 'its' : 'their'} entries is not known.`,
      );
    }
  }
  if (c.rows.length > 1) {
    parts.push(
      `All ${c.rows.length} of its ${c.rows[0]?.book === undefined ? 'copies' : 'books'} go.`,
    );
  }
  // Not deleted by its name: another file can share it.
  if (strays > 0) {
    parts.push(
      `${strays === 1 ? 'One more row' : `${strays} more rows`} named ${c.rows[0]?.fileName ?? c.name} could not be read, so ${strays === 1 ? 'it stays' : 'they stay'}: the Homebrew page says which.`,
    );
  }
  return parts.join(' ');
}

/** A compendium's books by name, as the Homebrew page lists them; other rows as they come. */
const inOrder = (c: Collection) =>
  c.rows[0]?.book === undefined
    ? c.rows
    : [...c.rows].sort((a, b) => (a.book ?? '').localeCompare(b.book ?? ''));

function EntriesSection({ c, looks }: { c: Collection; looks: ReadonlySet<string> }) {
  const navigate = useNavigate();
  const books = c.rows[0]?.book !== undefined && c.rows.length > 1;
  const rows = inOrder(c);
  // A book by its name: an update stores it under a new row, and it stays picked.
  const bookOf = (r: HomebrewFileMeta) => r.book ?? r.id;
  const [picked, setPicked] = useState(rows[0] === undefined ? '' : bookOf(rows[0]));
  const row = rows.find((r) => bookOf(r) === picked) ?? rows[0];
  const read = useLiveQuery(
    () => (row === undefined ? undefined : homebrewRepo.getSafe(row.id)),
    [row?.id],
  );
  const [kind, setKind] = useState('all');
  const [all, setAll] = useState(false);
  if (row === undefined) return null;
  const changes = row.role === 'changes';
  const own = row.editable && !changes;
  // A file you made keeps its features with their class; a change to one stands alone.
  const list = read?.file === undefined ? undefined : entriesIn(read.file.json, own);
  const kinds = [...new Set((list ?? []).map((e) => e.type))];
  // A kind picked whose last entry went: every entry again, as its chip went too.
  const showing = kinds.length > 1 && kinds.includes(kind) ? kind : 'all';
  const shown = (list ?? []).filter((e) => showing === 'all' || e.type === showing);

  const hrefOf = (e: Entry): string | undefined =>
    own
      ? `${editPath(e.type, e.name, String(e.entry.source))}${inFile(row.id)}`
      : row.enabled
        ? libraryPath(e.type, e.entry)
        : undefined;

  const act = async (e: Entry) => {
    const view = libraryPath(e.type, e.entry);
    const choice = await askChoice({
      title: e.name,
      options: [
        ...(own && view !== undefined && row.enabled
          ? [{ id: 'view', label: 'View in the Library' }]
          : []),
        ...(own && !ownsEntries(e.type) ? [{ id: 'rename', label: 'Rename' }] : []),
        ...(row.editable ? [{ id: 'delete', label: 'Delete', danger: true }] : []),
      ],
    });
    if (choice === 'view' && view !== undefined) void navigate(view);
    if (choice === 'rename') await rename(e);
    if (choice === 'delete') await remove(e);
  };

  const rename = async (e: Entry) => {
    const next = (await askText({ title: `Rename ${e.name}`, initial: e.name }))?.trim();
    if (next === undefined || next === '' || next === e.name) return;
    const source = String(e.entry.source);
    try {
      await homebrewRepo.saveEntry(
        e.type,
        { ...e.entry, name: next, source },
        { fileId: row.id, replaces: { name: e.name, source } },
      );
      invalidateRegistry();
      notify({ title: `Renamed ${e.name} to ${next}`, tone: 'good' });
    } catch (err) {
      notifyFailure(
        'Rename',
        err instanceof EntryClash ? new Error(`${c.name} already has one called ${next}`) : err,
      );
    }
  };

  const remove = async (e: Entry) => {
    const source = String(e.entry.source);
    const ok = await askConfirm({
      title: `Delete ${e.name}?`,
      detail: changes
        ? `Your change is taken out: ${e.name} is what is below it again, the book’s or its collection’s.`
        : `It is taken out of ${c.name}. ${await losses(
            (n, s) => lower(n) === lower(e.name) && lower(s) === lower(source),
          )}`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      // A change is found by its identity: a feature's class and level too.
      const key = (changes ? e.entry : { name: e.name, source }) as unknown as EntryKey;
      if (!(await homebrewRepo.removeEntry(row.id, e.type, key)))
        throw new Error('it is no longer in the collection');
      invalidateRegistry();
      notify({ title: `Deleted ${e.name}`, tone: 'good' });
    } catch (err) {
      notifyFailure('Delete', err);
    }
  };

  return (
    <section aria-labelledby="holds" className="flex flex-col gap-2">
      <h2 id="holds" className={HEAD}>
        What it holds
      </h2>
      {books && (
        <label className="flex flex-col gap-1 px-1 text-caption">
          <span className="text-ink-muted">Book</span>
          <select
            value={bookOf(row)}
            onChange={(ev) => {
              setPicked(ev.target.value);
              setKind('all');
              setAll(false);
            }}
            className="min-h-tap rounded-control bg-surface px-2 text-body ring-1 ring-line-strong ring-inset"
          >
            {rows.map((r) => (
              <option key={r.id} value={bookOf(r)}>
                {r.book ?? r.fileName}
              </option>
            ))}
          </select>
        </label>
      )}
      {read === undefined ? (
        <p className={NOTE}>Loading…</p>
      ) : list === undefined ? (
        <p className={NOTE}>
          This {books ? 'book' : 'file'} could not be read: {read.error?.message ?? 'it is gone'}.
        </p>
      ) : list.length === 0 ? (
        <p className={NOTE}>Nothing in it yet.</p>
      ) : (
        <>
          {kinds.length > 1 && (
            <FilterChips
              label="Show"
              value={showing}
              onChange={(k) => {
                setKind(k);
                setAll(false);
              }}
              options={[
                { value: 'all', label: 'All', count: list.length },
                ...kinds.map((k) => ({
                  value: k,
                  label: labelOf(k),
                  count: list.filter((e) => e.type === k).length,
                })),
              ]}
            />
          )}
          <ul className={listClass} aria-label={`In ${c.name}`}>
            {(all ? shown : shown.slice(0, PAGE)).map((e, i) => {
              const href = hrefOf(e);
              const look = looks.has(`${e.type}:${identityKey(e.type, e.entry)}`);
              // Only when off: some kinds have no Library page at all.
              const caption = `${kindOf(e.type)}${href === undefined && !own && !row.enabled ? '. Turn it on to open it in the Library' : ''}`;
              const body = (
                <>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="break-words text-body">{e.name}</span>
                    <span className="sr-only">,</span> <span className={CAPTION}>{caption}</span>
                  </span>
                  {look && (
                    <Badge tone="guide" className="shrink-0">
                      Needs a look
                    </Badge>
                  )}
                  {href !== undefined && (
                    <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
                  )}
                </>
              );
              return (
                <li key={`${e.type}:${e.name}:${String(i)}`} className="flex items-center">
                  {href === undefined ? (
                    <div className={`${listRowClass} min-w-0 flex-1 flex-wrap`}>{body}</div>
                  ) : (
                    <Link
                      to={href}
                      className={`${listRowClass} min-w-0 flex-1 flex-wrap hover:bg-surface-raised`}
                    >
                      {body}
                    </Link>
                  )}
                  {row.editable && (
                    <button
                      type="button"
                      aria-label={`More for ${e.name}`}
                      onClick={() => void act(e)}
                      className={`${ICON_ACTION} mr-1`}
                    >
                      <Ellipsis size={18} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {!all && shown.length > PAGE && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
              Show all {shown.length}
            </Button>
          )}
        </>
      )}
      {own && (
        <Link
          to={`/workshop/new${inFile(row.id)}`}
          className={buttonClass({ variant: 'outline', block: true })}
        >
          <Plus size={16} aria-hidden /> Add to {c.name}
        </Link>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Needs a look

interface Look {
  record: ChangedEntry;
  layer: ChangeLayer;
}

const lookKey = (record: ChangedEntry) => `${record.type}:${identityKey(record.type, record.base)}`;

/**
 * The changes over this collection's entries, or in it, that an update moved
 * under: by the change's file, the entry's source, or else (an entry can name
 * a source its file does not declare) its identity among `held`.
 */
function looksAt(
  records: readonly ChangedEntry[],
  c: Collection,
  held?: ReadonlySet<string>,
): Look[] {
  const ids = new Set(c.rows.map((r) => r.id));
  const sources = new Set(c.rows.flatMap((r) => r.sourceIds.map(lower)));
  const out: Look[] = [];
  for (const record of records) {
    const base = typeof record.base.source === 'string' ? lower(record.base.source) : '';
    const here = sources.has(base) || held?.has(lookKey(record)) === true;
    for (const layer of record.layers) {
      if (layer.needsLook.length === 0) continue;
      if (here || ids.has(layer.from.fileId)) out.push({ record, layer });
    }
  }
  return out;
}

/**
 * Every entry identity a collection holds, read only while some look is not
 * already placed here by its file or source: most pages never read a file
 * for it.
 */
function useHeld(
  c: Collection,
  records: readonly ChangedEntry[],
  stamp: string,
): ReadonlySet<string> | undefined {
  const need = records.some(
    (r) => r.layers.some((l) => l.needsLook.length > 0) && looksAt([r], c).length === 0,
  );
  const [held, setHeld] = useState<{ stamp: string; ids: ReadonlySet<string> }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp names every row and its revision
  useEffect(() => {
    if (!need) return;
    let alive = true;
    void (async () => {
      const ids = new Set<string>();
      for (const r of c.rows) {
        const { file } = await homebrewRepo.getSafe(r.id);
        for (const e of file === undefined ? [] : entriesIn(file.json, false)) {
          ids.add(`${e.type}:${identityKey(e.type, e.entry)}`);
        }
      }
      if (alive) setHeld({ stamp, ids });
    })().catch(() => {
      // Unread, a look shows where its file or source places it.
    });
    return () => {
      alive = false;
    };
  }, [need, stamp]);
  return need && held?.stamp === stamp ? held.ids : undefined;
}

const FIELD_NAMES: Readonly<Record<string, string>> = {
  entries: 'Text',
  entriesHigherLevel: 'At higher levels',
  time: 'Casting time',
  range: 'Range',
  components: 'Components',
  duration: 'Duration',
  level: 'Level',
  school: 'School',
  ability: 'Ability scores',
  speed: 'Speed',
  size: 'Size',
  prerequisite: 'Prerequisite',
  'castGuidance.effects': 'What it does on the sheet',
  'castGuidance.drop': 'What it stops doing',
  'castGuidance.amend': 'What it changes',
  'castGuidance.replace': 'Whether it replaces what it does',
  'castGuidance.moments': 'When it asks',
};

const fieldName = (f: string) =>
  FIELD_NAMES[f] ??
  f.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`).replace(/^./, (m) => m.toUpperCase());

function fieldOf(e: unknown, path: string): unknown {
  let v = e;
  for (const part of path.split('.')) v = isRecord(v) ? v[part] : undefined;
  return v;
}

/** A field's value as a line of words, its tags read as their text. */
function words(v: unknown): string {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (out.join(' ').length > 240) return;
    if (typeof x === 'string') out.push(x.replace(/\{@\w+ ([^|}]*)[^}]*\}/g, '$1'));
    else if (typeof x === 'number' || typeof x === 'boolean') out.push(String(x));
    else if (Array.isArray(x)) x.forEach(walk);
    // An entry's `type` is its shape, not its words.
    else if (isRecord(x)) for (const [k, y] of Object.entries(x)) if (k !== 'type') walk(y);
  };
  walk(v);
  const all = out.join(' ').trim();
  if (all === '') return 'Nothing';
  return all.length > 240 ? `${all.slice(0, 239)}…` : all;
}

/**
 * How a change holds a field it marks: whole (what shows is the player's),
 * as `_mod` steps that still find their text in the entry below (what shows
 * is the player's, over the new text), or as steps that miss it now (an
 * update reworded the very text the player changed: the collection's words
 * show, and the player's whole field is gone, since a mark is only a hash).
 */
type Shape = 'whole' | 'applies' | 'partly' | 'misses';

function shapeOf(layer: ChangeLayer, f: string): { shape: Shape; missed: Json[] } {
  const copy = fieldOf(layer.entry, '_copy');
  const mod = isRecord(copy) && isRecord(copy._mod) ? copy._mod[f] : undefined;
  const steps: unknown[] = mod === undefined ? [] : Array.isArray(mod) ? mod : [mod];
  const ops = steps.filter((o): o is Json => isRecord(o) && typeof o.mode === 'string');
  if (f.includes('.') || ops.length === 0 || ops.length !== steps.length) {
    return { shape: 'whole', missed: [] };
  }
  // Step by step over the text as it is now. Not every step says when it
  // misses (`removeArr` finds nothing in silence), so a step that leaves the
  // field as it was has missed too: the change wrote none that does nothing.
  const target = { [f]: structuredClone(fieldOf(layer.below, f)) } as Parameters<
    typeof applyMod
  >[0];
  const missed: Json[] = [];
  let tried = 0;
  for (const op of ops) {
    // A removal of several is read one by one: one can still find its part
    // while another, renamed by the update, finds nothing.
    for (const part of partsOf(op)) {
      tried += 1;
      const before = JSON.stringify(target[f]);
      let warned = false;
      applyMod(target, { [f]: [structuredClone(part)] }, () => {
        warned = true;
      });
      const found = !warned && JSON.stringify(target[f]) !== before;
      // A replacement whose words went because the update already says the
      // player's: what shows is theirs (#6).
      if (!found && !alreadySays(target[f], part)) missed.push(part);
    }
  }
  const shape = missed.length === 0 ? 'applies' : missed.length === tried ? 'misses' : 'partly';
  return { shape, missed };
}

/** A `removeArr` of several names or items as one step each; any other step as it is. */
function partsOf(op: Json): Json[] {
  if (op.mode !== 'removeArr') return [op];
  for (const k of ['names', 'items'] as const) {
    const list = op[k];
    if (Array.isArray(list) && list.length > 1) return list.map((x) => ({ ...op, [k]: [x] }));
  }
  return [op];
}

/** Whether a field already holds every item a `replaceArr` puts in. */
function alreadySays(field: unknown, op: Json): boolean {
  if (op.mode !== 'replaceArr' || !Array.isArray(field)) return false;
  const items = Array.isArray(op.items) ? op.items : op.items === undefined ? [] : [op.items];
  const there = new Set(field.map((x) => JSON.stringify(x)));
  return items.length > 0 && items.every((x) => there.has(JSON.stringify(x)));
}

/** The player's wording, as the steps of their change say it. */
function wordingOf(ops: readonly Json[]): string {
  return ops
    .map((o) => {
      if (o.mode === 'replaceArr') return `${words(o.items)} (in place of “${words(o.replace)}”)`;
      if (o.mode === 'removeArr') return `Takes out ${words(o.names ?? o.items)}`;
      return words(o.items ?? o);
    })
    .join(' ');
}

/** What settling a look does: keeps the player's, where it still applies. */
function settleLabel(shapes: readonly Shape[]): string {
  if (shapes.every((s) => s === 'whole' || s === 'applies')) return 'Keep yours';
  if (shapes.every((s) => s === 'misses')) return 'Use the collection’s';
  return 'Keep yours where it applies';
}

function NeedsLookSection({ c, items }: { c: Collection; items: readonly Look[] }) {
  const [busy, setBusy] = useState(false);
  if (items.length === 0) return null;

  /**
   * Read the change again over the entry below as it is now: what shows stays
   * (the player's where it applies, the collection's where it misses), and the
   * marks are the new text's, so it no longer needs a look. A change left with
   * nothing to say is taken out.
   */
  const settle = async ({ record, layer }: Look, label: string) => {
    setBusy(true);
    try {
      const below = layer.below as Json;
      const placed = record.placed as Json;
      const was = layer.entry as unknown as EntryKey;
      if (changeCount(below, placed) === 0) {
        if (!(await homebrewRepo.removeEntry(layer.from.fileId, record.type, was)))
          throw new Error('that change is no longer in its collection');
      } else {
        const entry = writeChange(record.type, below, placed) as Json & EntryKey;
        await homebrewRepo.saveEntry(record.type, entry, { role: 'changes', replaces: was });
      }
      invalidateRegistry();
      notify({ title: `${label}: ${String(placed.name)}`, tone: 'good' });
    } catch (err) {
      notifyFailure(label, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="needs-look" className="flex flex-col gap-2">
      <h2 id="needs-look" className={HEAD}>
        Needs a look
      </h2>
      <p className={`px-1 ${CAPTION}`}>
        {c.rows.some((r) => r.role === 'changes')
          ? 'What these change moved underneath since you changed it.'
          : 'Since you changed these, this collection changed the same thing.'}
      </p>
      <ul className="flex flex-col gap-2" aria-label="Needs a look">
        {items.map((look) => {
          const { record, layer } = look;
          const name = String(record.placed.name);
          const view = libraryPath(record.type, record.placed as Json);
          const fields = layer.needsLook.map((f) => ({ f, ...shapeOf(layer, f) }));
          const label = settleLabel(fields.map((x) => x.shape));
          return (
            <li
              key={`${record.type}:${identityKey(record.type, record.base)}:${layer.from.fileId}`}
              className="flex flex-col gap-2 rounded-card bg-guide-soft p-3"
            >
              <span className="text-body-strong break-words">
                {name}
                <span className="font-normal text-ink-muted">, {kindOf(record.type)}</span>
              </span>
              <dl className="flex flex-col gap-1.5 text-caption">
                {fields.map(({ f, shape, missed }) => (
                  <div key={f} className="flex flex-col gap-0.5">
                    <dt className="font-semibold">{fieldName(f)}</dt>
                    <dd className="break-words">
                      <span className="text-ink-muted">The collection&rsquo;s now: </span>
                      {words(fieldOf(layer.below, f))}
                    </dd>
                    <dd className="break-words">
                      <span className="text-ink-muted">Yours: </span>
                      {shape === 'misses' ? wordingOf(missed) : words(fieldOf(record.placed, f))}
                    </dd>
                    <dd className="text-ink-muted">
                      {shape === 'misses'
                        ? 'The words yours changed are gone from the collection’s, so its words show now.'
                        : shape === 'partly'
                          ? `Part of yours no longer finds its words, so the collection’s show there: ${wordingOf(missed)}`
                          : 'Yours shows.'}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {layer.from.kind === 'changes' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${label}: ${name}`}
                    onClick={() => void settle(look, label)}
                  >
                    {label}
                  </Button>
                )}
                {view !== undefined && (
                  <Link
                    to={view}
                    className={`${LINK} inline-flex min-h-tap items-center text-caption`}
                  >
                    Change it in the Library
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page

function Frame({ children }: { children: ReactNode }) {
  const back = useBack('/workshop?shelf=collections');
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <button type="button" aria-label="Back" onClick={back} className={ICON}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      {children}
    </main>
  );
}

function FromSection({ c, onImport }: { c: Collection; onImport: (link?: string) => void }) {
  const [r] = c.rows;
  if (r === undefined) return null;
  const link = c.rows.find((x) => x.url !== undefined)?.url;
  const href = safeExternalHref(link);
  const date = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const added = Math.min(...c.rows.map((x) => x.addedAt));
  return (
    <section aria-labelledby="came-from" className="flex flex-col gap-2">
      <h2 id="came-from" className={HEAD}>
        Where it came from
      </h2>
      <dl className={`${listClass} text-caption`}>
        <div className={`${listRowClass} flex-wrap`}>
          <dt className="w-24 shrink-0 text-ink-muted">Source</dt>
          <dd className="min-w-0 flex-1 basis-40 break-words">
            {r.editable ? 'Made in the Workshop' : c.from}
          </dd>
        </div>
        {!r.editable && (
          <div className={`${listRowClass} flex-wrap`}>
            <dt className="w-24 shrink-0 text-ink-muted">File</dt>
            <dd className="min-w-0 flex-1 basis-40 break-words">{r.fileName}</dd>
          </div>
        )}
        {link !== undefined && (
          <div className={`${listRowClass} flex-wrap`}>
            <dt className="w-24 shrink-0 text-ink-muted">Link</dt>
            <dd className="min-w-0 flex-1 basis-40 break-all">
              {href === undefined ? (
                link
              ) : (
                <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
                  {link}
                </a>
              )}
            </dd>
          </div>
        )}
        <div className={`${listRowClass} flex-wrap`}>
          <dt className="w-24 shrink-0 text-ink-muted">{r.editable ? 'Started' : 'Came in'}</dt>
          <dd className="min-w-0 flex-1 basis-40">{date(added)}</dd>
        </div>
      </dl>
      {!r.editable && (
        <>
          <p className={`px-1 ${CAPTION}`}>
            {link !== undefined
              ? 'Its link is read again when you ask. A newer copy updates it in place: its switches, its place and your changes stay.'
              : 'A newer copy of the file updates it in place: its switches, its place and your changes stay.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {link !== undefined && (
              <Button variant="outline" onClick={() => onImport(link)}>
                Update from its link
              </Button>
            )}
            {/* A file would land beside a collection from a link: its key is the link (U7). */}
            {link === undefined && (
              <Button variant="outline" onClick={() => onImport()}>
                Update from a file
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Every change over an entry (E3), read again whenever a stored file moves:
 * `stamp` names each row and its revision. The registry hook rebuilds on a
 * data landing alone, and a change saved here, or an update made elsewhere,
 * is none.
 */
function useChangedEntries(stamp: string): readonly ChangedEntry[] {
  const [records, setRecords] = useState<readonly ChangedEntry[]>([]);
  // The books under a change can move with no stored file moving: a release
  // landing. The registry hook's own triggers (`hooks.ts`), read here.
  const revision = useSyncExternalStore(subscribeRevision, getRevision, getRevision);
  const phase = useDataStatus((s) => s.phase);
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp, revision and phase are the refresh triggers
  useEffect(() => {
    let alive = true;
    getRegistry()
      .then((reg) => {
        if (alive) setRecords(reg.changedEntries());
      })
      .catch(() => {
        // The page still works without it: nothing shows as needing a look.
      });
    return () => {
      alive = false;
    };
  }, [stamp, revision, phase]);
  return records;
}

function Found({
  c,
  stamp,
  strays,
}: {
  c: Collection;
  stamp: string;
  /** Rows of its file name that could not be read: a delete leaves them. */
  strays: number;
}) {
  usePageTitle(c.name, 'Workshop');
  const navigate = useNavigate();
  const packs = usePacksHere(c.rows);
  const pack = packs?.some((p) => c.rows.some((r) => r.id === p.id));
  const characters = useLiveQuery(() => characterRepo.listSafe().then((r) => r.characters), []);
  const [importing, setImporting] = useState<{ link?: string }>();
  const [status, setStatus] = useState<string>();
  const sharing = useMemo(canShareFiles, []);
  const records = useChangedEntries(stamp);
  const held = useHeld(c, records, stamp);
  const looks = useMemo(() => looksAt(records, c, held), [records, c, held]);
  const looked = useMemo(() => new Set(looks.map((l) => lookKey(l.record))), [looks]);
  const [single] = c.rows.length === 1 ? c.rows : [];
  // Read here, not through `useSourcePolicy`, whose default while it loads
  // shows every book: a tap then would write switches for the wrong choice.
  const device = useLiveQuery(() => readSourcePolicy(), []);

  const removeAll = async () => {
    const ok = await askConfirm({
      title: `Delete ${c.name}?`,
      detail: await deleteDetail(c, strays),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await homebrewRepo.deleteMany(c.rows.map((r) => r.id));
      invalidateRegistry();
      notify({ title: `Deleted ${c.name}`, tone: 'good' });
      void navigate('/workshop?shelf=collections', { replace: true });
    } catch (err) {
      notifyFailure('Delete', err);
    }
  };

  if (device === undefined) {
    return (
      <Frame>
        <p className={NOTE}>Loading…</p>
      </Frame>
    );
  }
  return (
    <Frame>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title-page break-words">{c.name}</h1>
        <p className="text-caption text-ink-muted">
          {c.from}. {holdsOf(c, (r) => deviceOn(r, device))}.
        </p>
      </header>
      {status !== undefined && (
        <p role="status" className="rounded-control bg-surface-raised px-3 py-2 text-caption">
          {status}
        </p>
      )}
      <EntriesSection c={c} looks={looked} />
      <OnSection c={c} device={device} characters={characters} pack={pack} />
      <NeedsLookSection c={c} items={looks} />
      <FromSection c={c} onImport={(link) => setImporting({ link })} />
      <section aria-labelledby="share-delete" className="flex flex-col gap-2">
        <h2 id="share-delete" className={HEAD}>
          Share or delete
        </h2>
        {single !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void download(single, single.fileName)}>
              <Download size={16} aria-hidden /> Export a file
            </Button>
            {sharing && (
              <Button variant="outline" onClick={() => void share(single, single.fileName)}>
                <Share2 size={16} aria-hidden /> Share
              </Button>
            )}
          </div>
        )}
        <Button variant="ghost" className="self-start text-danger" onClick={() => void removeAll()}>
          {/* Not its name: a long file name kept the button wider than a phone (bug 11). */}
          <Trash2 size={16} aria-hidden /> Delete this collection
        </Button>
      </section>
      <p className={NOTE}>
        A rule pack&rsquo;s review and the order of packs are on the Homebrew page for now.
      </p>
      <Link to="/homebrew" className={`self-start ${buttonClass({ variant: 'outline' })}`}>
        Open the Homebrew page
      </Link>
      {importing !== undefined && (
        <Suspense fallback={null}>
          <ImportSheet
            link={importing.link}
            onClose={() => setImporting(undefined)}
            onDone={(message) => {
              setImporting(undefined);
              setStatus(message);
            }}
          />
        </Suspense>
      )}
    </Frame>
  );
}

function Missing({
  title,
  text,
  onDelete,
}: {
  title: string;
  text: string;
  onDelete?: () => void;
}) {
  usePageTitle(title, 'Workshop');
  return (
    <Frame>
      <p className={NOTE}>{text}</p>
      {onDelete !== undefined && (
        <Button variant="outline" className="self-start text-danger" onClick={onDelete}>
          <Trash2 size={16} aria-hidden /> Delete it
        </Button>
      )}
      <Link to="/workshop?shelf=collections" className={`self-start ${LINK}`}>
        Back to the Workshop
      </Link>
    </Frame>
  );
}

function CollectionAt({ address }: { address: string }) {
  const navigate = useNavigate();
  const meta = useLiveQuery(() => homebrewRepo.listMetaSafe(), []);
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const made =
    owned === undefined
      ? undefined
      : new Map(owned.files.map((f) => [f.id, madeName(f.json) ?? f.fileName]));
  const c =
    meta === undefined || made === undefined
      ? undefined
      : collectionWith(address, meta.files, made);
  // Found by a row's id or the link it came from: its own address from here
  // on, which an update keeps (a row's id goes with it).
  const own = c?.id;
  useEffect(() => {
    if (own !== undefined && own !== address) void navigate(collectionPath(own), { replace: true });
  }, [own, address, navigate]);
  if (meta === undefined || made === undefined) {
    return (
      <Frame>
        <p className={NOTE}>Loading…</p>
      </Frame>
    );
  }
  // Keyed by its address, so a book picked or a list opened is kept across an update.
  const stamp = meta.files.map((r) => `${r.id}@${r.rev ?? 0}:${r.enabled}`).join(',');
  if (c !== undefined) {
    const names = new Set(c.rows.map((r) => r.fileName));
    const strays = meta.errors.filter(
      (e) => e.fileName !== undefined && names.has(e.fileName),
    ).length;
    return <Found key={c.id} c={c} stamp={stamp} strays={strays} />;
  }
  const broken = meta.errors.find((e) => e.id === address);
  if (broken?.id !== undefined) {
    const id = broken.id;
    return (
      <Missing
        title="Collection unreadable"
        text={`This collection is on this device but could not be read: ${broken.message}.`}
        onDelete={() =>
          void askConfirm({
            title: 'Delete this collection?',
            detail: 'It could not be read, so what it held is not known.',
            confirmLabel: 'Delete',
            danger: true,
          }).then(async (ok) => {
            if (!ok) return;
            try {
              await homebrewRepo.delete(id);
              invalidateRegistry();
            } catch (err) {
              notify({ title: 'Delete failed', detail: errorText(err), tone: 'warn' });
            }
          })
        }
      />
    );
  }
  return (
    <Missing title="Collection not found" text="This collection is no longer on this device." />
  );
}

/**
 * The address as written in the path: the router turns a `%2F` in a param
 * into `/`, and a link's key can hold one (`?p=a%2Fb.json`).
 */
function addressIn(pathname: string): string | undefined {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  try {
    return last === '' ? undefined : decodeURIComponent(last);
  } catch {
    return undefined;
  }
}

export function Component() {
  const { id: param = '' } = useParams();
  const id = addressIn(useLocation().pathname) ?? param;
  if (id === BOOKS_ID) {
    return (
      <Suspense
        fallback={
          <Frame>
            <p className={NOTE}>Loading…</p>
          </Frame>
        }
      >
        <BooksPage />
      </Suspense>
    );
  }
  return <CollectionAt address={id} />;
}
