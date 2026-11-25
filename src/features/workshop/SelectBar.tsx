/**
 * What the Workshop's Yours shelf does with the entries picked in select mode
 * (the One Workshop canvas, board 9): the bar above the tab bar, and its
 * three actions.
 *
 * - Move: to another collection of the player's, or one started here. Each
 *   entry takes its new collection's source, and every character holding it
 *   follows it (`homebrewRepo.moveEntries`, ADR-002 D5). The sheet then says
 *   who followed, which imported rule packs still name the entries where they
 *   were, and which characters could not be read.
 * - Export: a file of the entries, to share.
 * - Delete: names each character that uses them first; the home offers Undo.
 *
 * Loaded once select mode is first opened.
 */
import { Download, Layers, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { type HomebrewFile, homebrewRepo, type Removed } from '@/db/homebrewRepo';
import type { ImportedMention, Repoint } from '@/db/repoint';
import type { CharacterDoc, EntityRef } from '@/engine/types';
import { downloadJson } from '@/lib/download';
import { errorText } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { DialogFrame } from '@/ui/dialogs';
import { fieldClass } from '@/ui/TextField';
import { entriesOf, kindOf, type Mine, mineKey, newSource, pickOf, selectionFile } from './yours';

/** "1 entry", "3 entries". */
export const words = (n: number) => (n === 1 ? '1 entry' : `${n} entries`);

const NOTE = 'text-body text-ink-muted';
const ITEM = 'flex flex-col gap-0.5 rounded-control bg-surface-raised px-3 py-2.5';

/** The value the move sheet's radio gives a collection started there. */
const NEW = '';

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** What a move did, for the sheet to say once it is made. */
interface Moved {
  /** One sentence for the home, said once. */
  summary: string;
  /** Each part that did not move, and why. */
  refused: string[];
  imported: ImportedMention[];
  skipped: number;
}

/** A character that uses some of the picked entries, a line for each. */
export interface User {
  id: string;
  name: string;
  lines: Array<{ key: string; text: string }>;
}

export interface SelectBarProps {
  /** The entries picked, as shown. */
  picked: readonly Mine[];
  /** Every file the player owns, with its content. */
  files: readonly HomebrewFile[];
  /** Each file's name, as the home shows it. */
  names: ReadonlyMap<string, string>;
  /** A move or an export is done: what to say on the page; `stay` keeps select mode on. */
  onDone: (message: string, stay?: boolean) => void;
  /** Escape on the bar: select mode ends, as it does from a row. */
  onEscape: () => void;
  /** A sheet opened or closed: select mode stays on under it, even if the list empties. */
  onSheet: (open: boolean) => void;
  /** Entries were deleted: what was taken out, for Undo, and what to call it. */
  onDeleted: (removed: Removed, title: string, detail: string) => void;
}

export default function SelectBar({
  picked,
  files,
  names,
  onDone,
  onEscape,
  onSheet,
  onDeleted,
}: SelectBarProps) {
  const [sheet, setSheet] = useState<'move' | 'delete' | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const bar = useClearOfBar();
  const none = picked.length === 0;
  const changes = new Set(files.filter((f) => f.role === 'changes').map((f) => f.id));
  const isChange = (m: Mine) => changes.has(m.fileId);
  const told = useRef(onSheet);
  told.current = onSheet;
  useEffect(() => {
    told.current(sheet !== null);
    return () => told.current(false);
  }, [sheet]);

  const open = (which: 'move' | 'delete', from: HTMLButtonElement | null) => {
    if (none) return;
    if (which === 'move' && picked.every(isChange)) {
      onDone(
        'Changes to the books stay where they are: a change keeps the book’s name and source.',
        true,
      );
      return;
    }
    opener.current = from;
    setSheet(which);
  };
  // A sheet gives focus back to what opened it: it has no trigger of its own.
  const close = () => {
    setSheet(null);
    requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
  };

  const exportPicked = () => {
    if (none) return;
    const shared = picked.filter((m) => !isChange(m));
    const left = picked.length - shared.length;
    if (shared.length === 0) {
      onDone('Changes to the books are shared as a rule pack, not as a file of entries.', true);
      return;
    }
    const homes = [...new Set(shared.map((m) => names.get(m.fileId) ?? 'Workshop'))];
    const only = shared.length === 1 ? shared[0] : undefined;
    const name =
      only !== undefined
        ? String(only.entry.name)
        : homes.length === 1
          ? `${homes[0]}, ${words(shared.length)}`
          : `Workshop, ${words(shared.length)}`;
    try {
      downloadJson(name, selectionFile(files, shared));
    } catch (err) {
      onDone(`The file could not be saved: ${errorText(err)}`, true);
      return;
    }
    onDone(
      `Saved a file with ${words(shared.length)}. Anyone can import it in their Workshop.${
        left === 0
          ? ''
          : ` ${left === 1 ? 'A change' : `${left} changes`} to the books ${left === 1 ? 'is' : 'are'} not in it.`
      }`,
    );
  };

  return (
    <>
      {/* Above the tab bar on a phone, which stays in reach; at the foot of the
          page beside the rail on a wide screen. */}
      <div
        ref={bar}
        className="fixed inset-x-0 bottom-[calc(var(--spacing-tabbar)+var(--cg-border)+env(safe-area-inset-bottom))] z-20 border-line border-t bg-surface lg:bottom-0 lg:left-40"
      >
        <fieldset
          className="flex flex-wrap items-center gap-2 px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onEscape();
          }}
        >
          <legend className="sr-only">With what is selected</legend>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            aria-disabled={none}
            aria-haspopup="dialog"
            onClick={(e) => open('move', e.currentTarget)}
          >
            <Layers size={16} aria-hidden />
            Move
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            aria-disabled={none}
            onClick={exportPicked}
          >
            <Download size={16} aria-hidden />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-danger"
            aria-disabled={none}
            aria-haspopup="dialog"
            onClick={(e) => open('delete', e.currentTarget)}
          >
            <Trash2 size={16} aria-hidden />
            Delete
          </Button>
        </fieldset>
      </div>
      {sheet === 'move' && (
        <MoveSheet
          picked={picked}
          files={files}
          names={names}
          isChange={isChange}
          onCancel={close}
          onMoved={(summary) => {
            setSheet(null);
            onDone(summary);
          }}
        />
      )}
      {sheet === 'delete' && (
        <DeleteSheet
          picked={picked}
          names={names}
          isChange={isChange}
          onCancel={close}
          onDeleted={(removed, title, detail) => {
            setSheet(null);
            onDeleted(removed, title, detail);
          }}
        />
      )}
    </>
  );
}

/**
 * Keeps the page clear of the bar while it is up. Its height goes on the root
 * as `--select-bar-h`, which the page pads its foot by, so the last row scrolls
 * out from under it; and the page's bottom scroll padding grows to the bar's
 * top, so Tab never lands on a row behind it. Measured, because large text
 * wraps the three buttons onto more lines.
 */
function useClearOfBar(): (el: HTMLElement | null) => void {
  const [el, ref] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (el === null) return;
    const root = document.documentElement.style;
    const was = root.scrollPaddingBottom;
    const measure = () => {
      root.setProperty('--select-bar-h', `${el.offsetHeight}px`);
      root.scrollPaddingBottom = `${Math.max(0, window.innerHeight - el.getBoundingClientRect().top)}px`;
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.removeProperty('--select-bar-h');
      root.scrollPaddingBottom = was;
    };
  }, [el]);
  return ref;
}

function MoveSheet({
  picked,
  files,
  names,
  isChange,
  onCancel,
  onMoved,
}: {
  picked: readonly Mine[];
  files: readonly HomebrewFile[];
  names: ReadonlyMap<string, string>;
  isChange: (m: Mine) => boolean;
  onCancel: () => void;
  onMoved: (summary: string) => void;
}) {
  // Picked once, as the sheet opens: the entries move under it.
  const [movable] = useState(() => picked.filter((m) => !isChange(m)));
  const stay = picked.length - movable.length;
  const places = files.filter((f) => f.role === undefined);
  const homes = new Set(movable.map((m) => m.fileId));
  // A collection none of them is in, else any but their only one.
  const [to, setTo] = useState(
    () =>
      (
        places.find((f) => !homes.has(f.id)) ??
        places.find((f) => !(homes.size === 1 && homes.has(f.id)))
      )?.id ?? NEW,
  );
  const [name, setName] = useState('New collection');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [moved, setMoved] = useState<Moved>();
  const going = movable.filter((m) => m.fileId !== to);
  const target = to === NEW ? name.trim() : (names.get(to) ?? 'that collection');

  const run = async () => {
    if (busy || going.length === 0 || target === '') return;
    setBusy(true);
    setError(undefined);
    let made: string | undefined;
    let count = 0;
    const refused: string[] = [];
    const characters = new Set<string>();
    const skipped = new Set<string>();
    const imported = new Map<string, ImportedMention>();
    try {
      if (to === NEW) made = (await homebrewRepo.createEditable(target, newSource(target))).id;
      const into = made ?? to;
      // One move per collection they come from, in turn. Each changes nothing
      // when it refuses, and the others still go.
      const groups = new Map<string, Mine[]>();
      for (const m of going) groups.set(m.fileId, [...(groups.get(m.fileId) ?? []), m]);
      for (const [from, list] of groups) {
        try {
          const report = await homebrewRepo.moveEntries({
            from,
            to: into,
            entries: list.map((m) => ({
              type: m.type,
              name: String(m.entry.name),
              source: String(m.entry.source),
            })),
          });
          count += list.length;
          for (const id of report.characters) characters.add(id);
          for (const id of report.skipped) skipped.add(id);
          for (const p of report.imported) {
            const was = imported.get(p.fileId);
            imported.set(p.fileId, {
              ...p,
              targets: [...new Set([...(was?.targets ?? []), ...p.targets])],
            });
          }
        } catch (err) {
          const what = list.length === 1 ? String(list[0]?.entry.name) : words(list.length);
          refused.push(
            `${what} from ${names.get(from) ?? 'a collection'} did not move: ${errorText(err)}.`,
          );
        }
      }
    } catch (err) {
      setError(`The collection could not be made: ${errorText(err)}.`);
      setBusy(false);
      return;
    }
    // Nothing moved into a collection started here: it is taken away again,
    // so a refused move makes none.
    if (made !== undefined && count === 0) await homebrewRepo.delete(made).catch(() => undefined);
    setBusy(false);
    if (count === 0) {
      setError(refused.join('\n'));
      return;
    }
    const followed =
      characters.size === 0
        ? ''
        : ` ${characters.size === 1 ? '1 character' : `${characters.size} characters`} followed them.`;
    const summary = `${made !== undefined ? `Made ${target} and moved ${words(count)}` : `Moved ${words(count)} to ${target}`}.${followed}`;
    if (refused.length === 0 && imported.size === 0 && skipped.size === 0) {
      onMoved(summary);
      return;
    }
    setMoved({ summary, refused, imported: [...imported.values()], skipped: skipped.size });
  };

  if (moved !== undefined) {
    return (
      <DialogFrame title="Moved" onDismiss={() => onMoved(moved.summary)}>
        <div className="flex flex-col gap-3">
          <p className="text-body">{moved.summary}</p>
          {moved.refused.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: two refusals can read the same, and the list never reorders.
            <p key={i} className="text-body text-danger">
              {r}
            </p>
          ))}
          {moved.imported.length > 0 && (
            <section aria-labelledby="moved-packs" className="flex flex-col gap-2">
              <h3 id="moved-packs" className="text-body-strong">
                Imported rule packs that still name them where they were
              </h3>
              <p className={NOTE}>
                Their changes no longer reach the entries you moved. They are left as they came.
              </p>
              <ul className="flex flex-col gap-2">
                {moved.imported.map((p) => (
                  <li key={p.fileId} className={ITEM}>
                    <span className="text-body-strong">{p.pack}</span>
                    <span className="text-caption text-ink-muted">
                      {p.fileName}. Names {andList(p.targets)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {moved.skipped > 0 && (
            <p className={NOTE}>
              {moved.skipped === 1 ? '1 character' : `${moved.skipped} characters`} could not be
              read, so {moved.skipped === 1 ? 'it still names' : 'they still name'} them where they
              were.
            </p>
          )}
          <Button variant="brand" size="lg" block onClick={() => onMoved(moved.summary)}>
            Done
          </Button>
        </div>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame title={`Move ${words(movable.length)}`} onDismiss={() => !busy && onCancel()}>
      <div className="flex flex-col gap-3">
        <p className={NOTE}>
          To a collection of yours. Characters that use them follow them to the new collection and
          keep what they have.
        </p>
        {stay > 0 && (
          <p className={NOTE}>
            {stay === 1 ? 'A change' : `${stay} changes`} to the books{' '}
            {stay === 1 ? 'stays' : 'stay'} where {stay === 1 ? 'it is' : 'they are'}: a change
            keeps the book&rsquo;s name and source.
          </p>
        )}
        {movable.length > 0 && (
          // `min-w-0`: a fieldset is never narrower than its longest word by
          // default, which ran the choices off the sheet with text at 200%.
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="sr-only">Move to</legend>
            {places.map((f) => (
              <label key={f.id} className={`${ITEM} cursor-pointer flex-row items-center gap-3`}>
                <input
                  type="radio"
                  name="move-to"
                  checked={to === f.id}
                  onChange={() => setTo(f.id)}
                  className="size-5 shrink-0 accent-brand"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-strong break-words">{names.get(f.id)}</span>
                  <span className="text-caption text-ink-muted">
                    {words(entriesOf([f]).length)} now
                  </span>
                </span>
              </label>
            ))}
            <label className={`${ITEM} cursor-pointer flex-row items-center gap-3`}>
              <input
                type="radio"
                name="move-to"
                checked={to === NEW}
                onChange={() => setTo(NEW)}
                className="size-5 shrink-0 accent-brand"
              />
              <span className="flex min-w-0 flex-col break-words">
                <span className="text-body-strong">Start a new collection</span>
                <span className="text-caption text-ink-muted">Name it here</span>
              </span>
            </label>
          </fieldset>
        )}
        {to === NEW && movable.length > 0 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-label">Name of the new collection</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClass}
            />
          </label>
        )}
        {movable.length > 0 && going.length === 0 && (
          <p className={NOTE}>They are in {target} already.</p>
        )}
        {going.length > 0 && going.length < movable.length && (
          <p className={NOTE}>
            {movable.length - going.length === 1
              ? '1 of them is'
              : `${movable.length - going.length} of them are`}{' '}
            in {target} already and {movable.length - going.length === 1 ? 'stays' : 'stay'} there.
          </p>
        )}
        {/* One refusal a line, when every collection they come from refused. */}
        {error !== undefined && (
          <p role="alert" className="whitespace-pre-line text-body text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="brand"
            className="flex-1"
            aria-disabled={busy || going.length === 0 || target === ''}
            onClick={() => void run()}
          >
            {busy ? 'Moving…' : to === NEW ? 'Make and move' : 'Move here'}
          </Button>
        </div>
        <p className="text-center text-caption text-ink-muted">
          Cancel leaves everything where it is and makes no collection.
        </p>
      </div>
    </DialogFrame>
  );
}

/**
 * A character's content with the keys of its picks and pools set aside: what
 * it holds and answers, not where they sit.
 */
function beyondKeys(doc: CharacterDoc): string {
  const sorted = (r: Record<string, unknown> | undefined) =>
    Object.values(r ?? {})
      .map((v) => JSON.stringify(v))
      .sort();
  return JSON.stringify({
    ...doc,
    choices: sorted(doc.choices),
    play: {
      ...doc.play,
      resources: doc.play.resources.map((r) => ({ ...r, key: '' })),
      foretold: sorted(doc.play.foretold),
    },
  });
}

/**
 * The types whose own picks and pools sit under another type's key, and
 * whether `doc` holds an entry of that type by `ref`'s name and book: an
 * optional feature's under a feat's, class's or subclass's, a subrace's under
 * its race's. When one is there, a key that moved alone is its, not theirs.
 */
const HOSTED: Readonly<Record<string, (doc: CharacterDoc, ref: EntityRef) => boolean>> = {
  optionalfeature: (doc, r) =>
    doc.feats.some((f) => sameRef(f.ref, r.name, r.source)) ||
    doc.classes.some(
      (l) => sameRef(l.ref, r.name, r.source) || sameRef(l.subclass, r.name, r.source),
    ),
  subrace: (doc, r) => sameRef(doc.race, r.name, r.source),
};

const sameRef = (r: EntityRef | undefined, name: unknown, source: unknown) =>
  r !== undefined &&
  typeof name === 'string' &&
  r.name.toLowerCase() === name.toLowerCase() &&
  (typeof source !== 'string' || r.source.toLowerCase() === source.toLowerCase());

/** Who uses the entries being deleted, and how many characters could not be read to say. */
interface Users {
  users: User[];
  unreadable: number;
}

/** The characters holding any of `picked`, each with what it holds. */
async function usersOf(
  picked: ReadonlyArray<Mine & { change: boolean }>,
  names: ReadonlyMap<string, string>,
): Promise<Users> {
  const [{ repointDoc }, { characters, errors }] = await Promise.all([
    import('@/db/repoint'),
    characterRepo.listSafe(),
  ]);
  const found = whoUses(characters, picked, names, repointDoc);
  return { users: found.users, unreadable: errors.length + found.unchecked };
}

/**
 * Each of `characters` that holds some of `picked`, with a line for each, and
 * how many could not be checked. E5's walker is the finder (`repointDoc`,
 * passed in so the module loads lazily): a character that a rename of an
 * entry would change holds it. Where it cannot tell, it lists: this is said
 * before a delete. So a subrace or subclass of its name and book is listed
 * whatever its parent: the sheet's own choice between two of them depends on
 * each character's view of the data.
 */
export function whoUses(
  characters: readonly CharacterDoc[],
  picked: ReadonlyArray<Mine & { change: boolean }>,
  names: ReadonlyMap<string, string>,
  repointDoc: (doc: CharacterDoc, changes: readonly Repoint[]) => CharacterDoc,
): { users: User[]; unchecked: number } {
  const named = (m: Mine) => String(m.entry.name);
  let unchecked = 0;
  const users = characters.flatMap((doc) => {
    let was: string | undefined;
    let failed = false;
    const held = picked.filter((m) => {
      const from = { name: named(m), source: String(m.entry.source) };
      let after: CharacterDoc;
      try {
        after = repointDoc(doc, [
          { type: m.type, from, to: { ...from, name: `${from.name} (deleted)` } },
        ]);
      } catch {
        failed = true;
        return false;
      }
      if (after === doc) return false;
      if (HOSTED[m.type]?.(doc, from) !== true) return true;
      // Only keys moved: they are the same-named host's.
      was ??= beyondKeys(doc);
      return beyondKeys(after) !== was;
    });
    if (failed) unchecked += 1;
    if (held.length === 0) return [];
    // Two of one name are told apart by kind, parent and collection, and by
    // book when those are the same too.
    const tags = (h: Mine) => {
      const parent = h.entry.raceName ?? h.entry.className;
      return {
        kind: kindOf(h.type).toLowerCase(),
        rest: [...(typeof parent === 'string' ? [parent] : []), names.get(h.fileId) ?? 'Workshop'],
      };
    };
    const lines = held.map((m) => {
      const twins = held.filter(
        (h) => h !== m && named(h).toLowerCase() === named(m).toLowerCase(),
      );
      const mine = tags(m);
      const same = twins.some((h) => {
        const theirs = tags(h);
        return theirs.kind === mine.kind && theirs.rest.join('|') === mine.rest.join('|');
      });
      const what =
        twins.length === 0
          ? named(m)
          : `${named(m)} (${[mine.kind, ...(same ? [String(m.entry.source)] : []), ...mine.rest].join(', ')})`;
      return {
        key: mineKey(m),
        text: m.change ? `${what} goes back to the book’s.` : `${what} leaves the sheet.`,
      };
    });
    return [{ id: doc.id, name: doc.name, lines }];
  });
  return { users, unchecked };
}

function DeleteSheet({
  picked,
  names,
  isChange,
  onCancel,
  onDeleted,
}: {
  picked: readonly Mine[];
  names: ReadonlyMap<string, string>;
  isChange: (m: Mine) => boolean;
  onCancel: () => void;
  onDeleted: (removed: Removed, title: string, detail: string) => void;
}) {
  // Picked once, as the sheet opens, with whether each is a change to the books.
  const [gone] = useState(() => picked.map((m) => ({ ...m, change: isChange(m) })));
  // Undefined while checking, null when the check failed.
  const [found, setFound] = useState<Users | null>();
  const users = found?.users;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    usersOf(gone, names).then(
      (u) => alive && setFound(u),
      () => alive && setFound(null),
    );
    return () => {
      alive = false;
    };
  }, [gone, names]);
  const homes = andList([...new Set(gone.map((m) => names.get(m.fileId) ?? 'Workshop'))]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const removed = await homebrewRepo.removeEntries(gone.map(pickOf));
      invalidateRegistry();
      onDeleted(removed, `Deleted ${words(gone.length)}`, `From ${homes}`);
    } catch (err) {
      setError(`Nothing was deleted: ${errorText(err)}.`);
      setBusy(false);
    }
  };

  return (
    <DialogFrame title={`Delete ${words(gone.length)}?`} onDismiss={() => !busy && onCancel()}>
      <div className="flex flex-col gap-3">
        <p className={NOTE}>
          They leave {homes}.
          {users !== undefined &&
            users.length > 0 &&
            ' Characters that use them lose what they gave:'}
        </p>
        {found === undefined ? (
          <p className={NOTE}>Checking your characters…</p>
        ) : found === null ? (
          <p className={NOTE}>Your characters could not be checked for them.</p>
        ) : found.users.length === 0 ? (
          <p className={NOTE}>No character uses them.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {found.users.map((u) => (
              <li key={u.id} className={ITEM}>
                <span className="text-body-strong">{u.name}</span>
                {u.lines.map((l) => (
                  <span key={l.key} className="text-caption text-ink-muted">
                    {l.text}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {found !== undefined && found !== null && found.unreadable > 0 && (
          <p className={NOTE}>
            {found.unreadable === 1 ? '1 character' : `${found.unreadable} characters`} could not be
            read, so {found.unreadable === 1 ? 'it was' : 'they were'} not checked.
          </p>
        )}
        {error !== undefined && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            aria-disabled={busy}
            onClick={() => void run()}
          >
            Delete {words(gone.length)}
          </Button>
        </div>
        <p className="text-center text-caption text-ink-muted">You can undo this right after.</p>
      </div>
    </DialogFrame>
  );
}
