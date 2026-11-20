/**
 * The Workshop (ADR-001, ADR-002): where a player makes their own entries and
 * edits copies of official ones, saved to a collection of theirs on this device.
 *
 * - `/workshop/new`: the Make sheet (`MakeSheet.tsx`, board 2): what to make,
 *   then where to start; the Workshop's home is `WorkshopHome`;
 * - `/workshop/new/:type`: a new entry, from nothing or from pasted text (the
 *   sheet hands its start over in the history state, `seed`);
 * - `/workshop/copy/:type/:uid`: a copy of a Library entry (`name|source`),
 *   under another name when `?name=` gives one;
 * - `/workshop/edit/:type/:uid`: one of theirs, found in the files they own;
 * - `/workshop/change/:type/:uid`: Change for your table (`ChangeSheet.tsx`).
 *
 * A copy of an entry the table has changed starts from the table's version
 * (owner, 2026-11-19), and is written against the entry the registry resolves
 * a copy against, the one below every change: so the table's change is in the
 * copy's own diffs, and the sheet shows the copy as the editor did.
 *
 * Each kind's editor is its own chunk (`editorTypes.ts`); this page is the
 * frame around them (board 3): the problems Save would meet, Saves to, Save
 * with Undo, the file view and Try it on.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Info } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useRegistryState, useTypePacks } from '@/data5e/hooks';
import { type EntityRegistry, isEntityType } from '@/data5e/normalize';
import { invalidateRegistry } from '@/data5e/registry';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import {
  EntryClash,
  type EntryKey,
  type HomebrewFile,
  homebrewRepo,
  WORKSHOP_SOURCE,
} from '@/db/homebrewRepo';
import { isRecord } from '@/engine/castGuidance';
import { readMechanics } from '@/engine/effects/mechanics';
import { findEntity } from '@/features/library/findEntity';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { errorText, notify } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { askChoice, askConfirm } from '@/ui/dialogs';
import { fieldClass } from '@/ui/TextField';
import { madeName } from './collections';
import {
  changeCount,
  changeKey,
  copiedFrom,
  missingOriginal,
  originalChanged,
  readStored,
  type SaveMode,
  same,
  writeEntry,
} from './copyWriter';
import { EditorShell, type Problem } from './EditorShell';
import { EDITORS, type EditorSpec, type Json } from './editorTypes';
import { Field, onePerName } from './fields';
import { EntryPicks } from './pickIds';
import { SpellChoices } from './spellChoices';
import { TRY_ON_TYPES, TryItOn } from './TryItOn';
import { editPath, entriesOf, inFile, labelOf, type Mine } from './yours';

const MakeSheet = lazy(() => import('./MakeSheet').then((m) => ({ default: m.MakeSheet })));
const ChangeSheet = lazy(() => import('./ChangeSheet').then((m) => ({ default: m.ChangeSheet })));

const NOTE = 'text-body text-ink-muted';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
const LINK =
  'text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
const BOX = 'flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption';
const SAVES_TO =
  'font-semibold text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink';

/** The name the Workshop's own collection goes by, made on the first save. */
const MY_HOMEBREW = 'My homebrew';

/** The file `?file=` names, as written. */
const fileParam = (search: string) => new URLSearchParams(search).get('file');

const matches = (e: Json, key: EntryKey) =>
  String(e.name).toLowerCase() === key.name.toLowerCase() &&
  String(e.source).toLowerCase() === key.source.toLowerCase();

/** A collection Save can put a new entry in. */
export interface Place {
  /** Absent for My homebrew before its first save makes it. */
  fileId?: string;
  /** The book the collection's entries are saved under. */
  source: string;
  title: string;
}

const isWorkshopFile = (f: HomebrewFile) =>
  f.editable && f.role === undefined && f.sourceIds[0] === WORKSHOP_SOURCE;

/**
 * Where a new entry can be saved: My homebrew first (made on the first save,
 * so nobody names a file or a short code before making anything), then each
 * other collection the player made. Their changes to the books are not one.
 */
export function placesOf(files: readonly HomebrewFile[]): Place[] {
  const workshop = files.find(isWorkshopFile);
  const out: Place[] = [{ fileId: workshop?.id, source: WORKSHOP_SOURCE, title: MY_HOMEBREW }];
  for (const f of files) {
    const source = f.sourceIds[0];
    if (!f.editable || f.role !== undefined || f === workshop || source === undefined) continue;
    out.push({ fileId: f.id, source, title: madeName(f.json) ?? f.fileName });
  }
  return out;
}

/**
 * The collection `?file=` names, when it is one the player made and can write
 * to. The address can be edited, so any other id (an imported file, one gone)
 * names nothing, and the entry goes to My homebrew as it would without it.
 */
function placeIn(search: string, places: readonly Place[]): Place | undefined {
  const id = fileParam(search);
  return id === null ? undefined : places.find((p) => p.fileId === id);
}

/** What an editor opens on, worked out once from the URL and the data. */
interface Subject {
  draft: Json;
  /**
   * The entry a copy is made from, as the player's data has it: below every
   * change to the books, which is what the registry resolves a copy against.
   */
  original?: Json;
  /** The table's version of `original`, when the table changed it: what a new copy starts from. */
  tables?: Json;
  /** A copy whose original the player's data does not have: its name. */
  missing?: string;
  /** Where the entry is kept, once saved. */
  fileId?: string;
  stored?: EntryKey;
  mode: SaveMode;
  /** The original changed since this copy was made. */
  stale: boolean;
  /** Changes that no longer fit the original, so the editor cannot show them. */
  lost?: number;
}

type Resolved =
  | { state: 'loading' }
  | { state: 'gone'; text: string }
  /** A change to the books, which the Change sheet opens. */
  | { state: 'moved'; to: string }
  | { state: 'ready'; subject: Subject };

/** The entry a copy of `e` is written against: below every change, as the merge reads it. */
const copiedBase = (registry: EntityRegistry, e: Json): Json =>
  (registry.changeOf(e)?.base as Json | undefined) ?? e;

/** What the Make sheet hands a new entry: its text, and what the spell reader found in it. */
const seedOf = (state: unknown): Json | undefined =>
  isRecord(state) && isRecord(state.seed) ? state.seed : undefined;

function resolve(
  action: string,
  type: string,
  uid: string,
  spec: EditorSpec,
  registry: EntityRegistry,
  mine: readonly Mine[],
  /** The files the player owns: an entry of their changes to the books opens elsewhere. */
  files: readonly HomebrewFile[],
  /** The file `?file=` names: one of the player's entries is looked for there first. */
  fileId: string | null,
  /** A new entry's start from the Make sheet; a copy's own name (`?name=`). */
  start: { seed?: Json; name?: string | null },
): Resolved {
  if (action === 'new') {
    return {
      state: 'ready',
      subject: {
        draft: { name: '', ...spec.blank(), ...start.seed },
        mode: 'changes',
        stale: false,
      },
    };
  }
  if (action === 'copy') {
    // The table's version, which the Library shows and the copy starts from.
    const found = findEntity(registry, type as never, uid) as Json | undefined;
    if (found === undefined)
      return {
        state: 'gone',
        text: `Nothing in ${labelOf(type).toLowerCase()} is called ${uid.split('|')[0]}.`,
      };
    const original = copiedBase(registry, found);
    const draft = structuredClone(found);
    const name = start.name?.trim();
    if (name !== undefined && name !== '') draft.name = name;
    return {
      state: 'ready',
      subject: {
        draft,
        original,
        ...(found !== original ? { tables: found } : {}),
        mode: 'changes',
        stale: false,
      },
    };
  }
  const [name = '', source = ''] = uid.split('|');
  const named = (m: Mine) => m.type === type && matches(m.entry, { name, source });
  // An address without a file, or naming one that no longer holds it, opens
  // the first the player has.
  const found = mine.find((m) => m.fileId === fileId && named(m)) ?? mine.find(named);
  if (found === undefined)
    return { state: 'gone', text: `You have no ${spec.noun} called ${name} on this device.` };
  if (files.find((f) => f.id === found.fileId)?.role === 'changes') {
    // By the change's own identity: two features of one name and book are two entries.
    return {
      state: 'moved',
      to: `/workshop/change/${type}/${encodeURIComponent(changeKey(type, found.entry))}`,
    };
  }
  const stored = found.entry;
  const at = {
    fileId: found.fileId,
    stored: { name: String(stored.name), source: String(stored.source) },
  };
  const from = copiedFrom(stored);
  if (from === undefined)
    return {
      state: 'ready',
      subject: { draft: structuredClone(stored), mode: 'changes', stale: false, ...at },
    };
  const placed = registry.get(type as never, from.name, from.source) as Json | undefined;
  // As a new copy is written: against the entry below the table's change.
  const original = placed !== undefined ? copiedBase(registry, placed) : undefined;
  const stale = original !== undefined && originalChanged(stored, original);
  if (!from.changesOnly) {
    return {
      state: 'ready',
      subject: { draft: structuredClone(stored), original, mode: 'full', stale, ...at },
    };
  }
  if (original === undefined) {
    return {
      state: 'ready',
      subject: {
        draft: structuredClone(stored),
        missing: from.name,
        mode: 'changes',
        stale: false,
        ...at,
      },
    };
  }
  const { entry, lost } = readStored(stored, original);
  return {
    state: 'ready',
    subject: { draft: entry, original, mode: 'changes', stale, lost, ...at },
  };
}

/**
 * The draft an editor opens on, for one whose entry gathers others (a
 * subclass's features, entries of their own): its `open` works out what the
 * player did to them. Every other editor opens on the entry as it is.
 */
function opened(
  r: Resolved,
  spec: EditorSpec,
  registry: EntityRegistry,
  files: readonly HomebrewFile[],
): Resolved {
  if (r.state !== 'ready' || spec.open === undefined) return r;
  const { draft, original, fileId } = r.subject;
  const file = files.find((f) => f.id === fileId)?.json;
  return {
    ...r,
    subject: { ...r.subject, draft: spec.open(draft, { original, registry, file }) },
  };
}

/** The type an entry of `type` owns, kept beside it in the file (a subclass's features). */
const OWNED_TYPE: Readonly<Record<string, string>> = {
  subclass: 'subclassFeature',
  class: 'classFeature',
};

/** How many entries a file holds, of every type. */
const entryCount = (json: Json) =>
  Object.entries(json)
    .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v))
    .reduce((n, [, v]) => n + (v as unknown[]).length, 0);

/**
 * The file as Save writes the entry into it, for the file view: the entry, and
 * for one that owns others, those too.
 */
function fileText(type: string, { entry, owned }: { entry: Json; owned?: Json[] }): string {
  if (owned === undefined) return JSON.stringify(entry, null, 2);
  const out: Json = { [type]: [entry] };
  const ownedType = OWNED_TYPE[type];
  if (ownedType !== undefined && owned.length > 0) out[ownedType] = owned;
  return JSON.stringify(out, null, 2);
}

/**
 * The file view (board 3): what Save writes, for anyone who writes homebrew by
 * hand. A new entry, or one of the player's own that copies nothing, can be
 * edited here, and the form shows it; a copy is written as its changes from
 * the original, and is changed in the form.
 */
function FileView({
  text,
  why,
  onEdit,
}: {
  text: string;
  /** Why it is shown but not edited, when it cannot be. */
  why?: string;
  onEdit: (entry: Json) => void;
}) {
  const [typed, setTyped] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-overline text-ink-muted uppercase">As a file</h2>
      <p className="text-caption text-ink-muted">
        {why ??
          'The entry as Save writes it into its collection, for anyone who writes homebrew by hand. What you change here shows in the form. Its source is the collection it saves to.'}
      </p>
      {why !== undefined ? (
        <pre className="overflow-x-auto rounded-control bg-surface-raised p-3 font-mono text-caption">
          {text}
        </pre>
      ) : (
        <Field label="The file">
          <textarea
            value={typed ?? text}
            spellCheck={false}
            rows={16}
            aria-invalid={error !== undefined}
            aria-describedby={error !== undefined ? 'file-view-error' : undefined}
            onChange={(e) => {
              setTyped(e.target.value);
              try {
                const next: unknown = JSON.parse(e.target.value);
                if (!isRecord(next) || Array.isArray(next)) {
                  setError('The file is one entry: an object in { }.');
                  return;
                }
                setError(undefined);
                onEdit(next);
              } catch (err) {
                setError(`Not read yet: ${errorText(err)}. The form keeps the last that read.`);
              }
            }}
            className={`${fieldClass} min-h-80 py-3 font-mono text-caption`}
          />
        </Field>
      )}
      {error !== undefined && (
        <p id="file-view-error" className="text-caption text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** A save that can be taken back: what the file and the editor were before it. */
interface Undoable {
  text: string;
  fileId: string;
  /** The save made the file: Undo takes it away, unless something else is in it now. */
  created: boolean;
  /** The file's content before the save, to put back. */
  before?: Json;
  /** The file's content just after it: anything else since, and Undo stops. */
  after?: Json;
  key: EntryKey;
  owned: number;
  /** Where the editor stood before the save. */
  was: {
    at: { fileId?: string; stored?: EntryKey };
    storedAs: EntryKey[];
    clean: Json;
    saves: Json[];
    url: string;
    /** The address's state: a new entry's start (`seed`). */
    state: unknown;
  };
}

function Editor({
  type,
  spec,
  subject,
  registry,
  files,
  start,
  onSaved,
  onUndone,
}: {
  type: string;
  spec: EditorSpec;
  subject: Subject;
  registry: EntityRegistry;
  /** The files the player owns, for Saves to. */
  files: readonly HomebrewFile[];
  /** A new entry's or a copy's collection, when it was made from one (`?file=`). */
  start?: Place;
  /** Where the saved entry now opens, and the file it is in. */
  onSaved: (path: string, fileId: string) => void;
  /** A save taken back: the address the editor had before it, and its state. */
  onUndone: (url: string, state: unknown) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const back = useBack('/workshop');
  const { original, missing, tables } = subject;
  const lost = subject.lost ?? 0;
  const [draft, setDraft] = useState(subject.draft);
  const [clean, setClean] = useState(subject.draft);
  // Each version saved while open: a pick saved once may have answers filed under its id.
  const [saves, setSaves] = useState<Json[]>([]);
  const [mode, setMode] = useState<SaveMode>(subject.mode);
  const [at, setAt] = useState<Undoable['was']['at']>({
    fileId: subject.fileId,
    stored: subject.stored,
  });
  // Each name it is stored under while open, for an editor's own writer.
  const [storedAs, setStoredAs] = useState(subject.stored !== undefined ? [subject.stored] : []);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  // Kept here, not in the address: a new address would open the editor again.
  const [placeKey, setPlaceKey] = useState(start?.fileId);
  const [undo, setUndo] = useState<Undoable>();
  const [undoing, setUndoing] = useState(false);
  const [asFile, setAsFile] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const readOnly = missing !== undefined;
  const name = String(draft.name ?? '').trim();
  const isCopy = original !== undefined || missing !== undefined;
  usePageTitle(name || `New ${spec.noun}`, 'Workshop');

  const change = (patch: Json) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next;
    });

  const places = placesOf(files);
  const place = places.find((p) => p.fileId === placeKey) ?? places[0];
  const savedIn = files.find((f) => f.id === at.fileId);
  const source = at.stored?.source ?? place?.source ?? WORKSHOP_SOURCE;
  // A full copy reopened keeps the mark of the original it was made from.
  const base = mode === 'full' && subject.mode === 'full' ? undefined : original;
  // A copy saved into a file whose book is the original's (`?file=`) would
  // take the original's name and book, and so copy itself.
  const ownName =
    original !== undefined &&
    name.toLowerCase() === String(original.name).trim().toLowerCase() &&
    source.toLowerCase() === String(original.source).toLowerCase();

  const toName = () => {
    setAsFile(false);
    setTimeout(() => nameBox.current?.focus(), 0);
  };
  const problems: Problem[] = [];
  if (readOnly) {
    problems.push({
      text: `${missingOriginal(missing ?? '')} It can be deleted, not changed.`,
      blocks: true,
    });
  } else {
    if (name === '')
      problems.push({ text: 'Give it a name to save it.', blocks: true, fix: toName });
    else if (name.includes('|'))
      problems.push({ text: 'A name cannot have | in it.', blocks: true, fix: toName });
    else if (ownName)
      problems.push({
        text: `This copy needs a name of its own: ${name} is already in ${source}.`,
        blocks: true,
        fix: toName,
      });
    else if (
      original !== undefined &&
      name.toLowerCase() === String(original.name).trim().toLowerCase()
    )
      problems.push({
        text: `Same name as ${String(original.name)} in ${String(original.source)}: both show in every picker until you name this one your own.`,
        blocks: false,
        fix: toName,
      });
    const checked = spec.check?.(draft, {
      original: base,
      copied: original,
      source,
      mode,
      registry,
    });
    if (checked !== undefined) problems.push({ text: checked, blocks: true });
    const guidance = draft.castGuidance;
    const refused = isRecord(guidance) ? readMechanics(guidance).problems.length : 0;
    if (refused > 0)
      problems.push({
        text:
          refused === 1
            ? 'One effect does not count on the sheet yet: its card says why. It can still be saved.'
            : `${refused} effects do not count on the sheet yet: each card says why. They can still be saved.`,
        blocks: false,
      });
  }
  const blocked = problems.some((p) => p.blocks);
  const footnote = (() => {
    if (original === undefined || readOnly) return undefined;
    const of = String(original.name);
    if (mode === 'full') return `A full copy of ${of}, readable without ${of} in the data.`;
    if (spec.summary !== undefined) return spec.summary(draft, original, registry);
    // Counted from what it started as: the table's version, when the table changed it.
    const from = tables ?? original;
    const what = tables !== undefined ? `your table's ${of}` : of;
    const n = changeCount(from, draft);
    return n === 0
      ? `No changes from ${what} yet. You can save it as it is.`
      : `${n} ${n === 1 ? 'change' : 'changes'} from ${what}, saved as changes only.`;
  })();

  /** What Save writes: by the editor's own writer for an entry that owns others. */
  const written = (): { entry: Json & EntryKey; owned?: Json[] } => {
    const own = spec.write?.({
      original: base,
      copied: original,
      draft,
      source,
      mode,
      registry,
      stored: at.stored,
      storedAs,
    });
    if (own !== undefined) return own;
    return { entry: writeEntry({ original: base, draft, source, mode }) as Json & EntryKey };
  };

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const { entry, owned } = written();
      const fileId = at.fileId ?? place?.fileId;
      // What the file held, so Undo can put it back.
      const before =
        fileId === undefined ? undefined : (await homebrewRepo.getSafe(fileId)).file?.json;
      const saved = await homebrewRepo.saveEntry(type, entry, {
        fileId,
        replaces: at.stored,
        ...(owned !== undefined ? { owned } : {}),
      });
      invalidateRegistry();
      if (saved.created) {
        await ensureSourcesVisible([WORKSHOP_SOURCE]).catch(() => undefined);
      }
      // What this save left, so Undo can tell a later write (another tab) and keep it.
      // The save has landed: a failed read here only means Undo will not be offered.
      const after =
        before === undefined
          ? undefined
          : await homebrewRepo
              .getSafe(saved.fileId)
              .then((r) => r.file?.json)
              .catch(() => undefined);
      const key = { name: entry.name, source: entry.source };
      const into = files.find((f) => f.id === saved.fileId);
      const title = into !== undefined ? (madeName(into.json) ?? into.fileName) : MY_HOMEBREW;
      setUndo(
        saved.created || after !== undefined
          ? {
              text: saved.created
                ? `Saved. ${MY_HOMEBREW} is made, on this device.`
                : `Saved to ${title}.`,
              fileId: saved.fileId,
              created: saved.created,
              before,
              after,
              key,
              owned: owned?.length ?? 0,
              was: {
                at,
                storedAs,
                clean,
                saves,
                url: `${location.pathname}${location.search}`,
                state: location.state,
              },
            }
          : undefined,
      );
      setAt({ fileId: saved.fileId, stored: key });
      setStoredAs((s) => [...s, key]);
      setClean(draft);
      setSaves((s) => [...s, draft]);
      notify({ title: `Saved ${entry.name}`, tone: 'good' });
      onSaved(editPath(type, entry.name, entry.source), saved.fileId);
    } catch (err) {
      setFailure(
        err instanceof EntryClash
          ? `You already have ${/^[aeiou]/.test(spec.noun) ? 'an' : 'a'} ${spec.noun} called ${name}. Choose another name.`
          : `Could not save ${name}: ${errorText(err)}. Nothing was changed on this device.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const takeBack = async () => {
    if (undo === undefined) return;
    setUndoing(true);
    setFailure(undefined);
    try {
      if (undo.created) {
        // Something saved into it since (another tab) stays: only this entry goes.
        const { file } = await homebrewRepo.getSafe(undo.fileId);
        if (file !== undefined && entryCount(file.json) > 1 + undo.owned)
          await homebrewRepo.removeEntry(undo.fileId, type, undo.key);
        else await homebrewRepo.delete(undo.fileId);
      } else if (undo.before !== undefined) {
        // Putting the whole file back would lose anything written to it since.
        const { file } = await homebrewRepo.getSafe(undo.fileId);
        if (file === undefined || undo.after === undefined || !same(file.json, undo.after)) {
          setUndo(undefined);
          setFailure(
            'The collection changed after this save (in another tab?), so Undo would lose that. Nothing was taken back.',
          );
          return;
        }
        // A save that renamed it took every character holding it along (E5).
        // Renaming it back takes them back; then the file is put back exactly.
        const old = undo.was.at.stored;
        const list = undo.before[type];
        const was =
          old !== undefined &&
          (old.name !== undo.key.name || old.source !== undo.key.source) &&
          Array.isArray(list)
            ? list.find((e): e is Json & EntryKey => isRecord(e) && matches(e, old))
            : undefined;
        if (was !== undefined)
          await homebrewRepo.saveEntry(type, was, { fileId: undo.fileId, replaces: undo.key });
        await homebrewRepo.saveEditable(undo.fileId, undo.before);
      }
      invalidateRegistry();
      setAt(undo.was.at);
      setStoredAs(undo.was.storedAs);
      setClean(undo.was.clean);
      setSaves(undo.was.saves);
      setUndo(undefined);
      notify({ title: `Took back saving ${undo.key.name}`, tone: 'good' });
      onUndone(undo.was.url, undo.was.state);
    } catch (err) {
      setFailure(`Could not take the save back: ${errorText(err)}.`);
    } finally {
      setUndoing(false);
    }
  };

  const leave = async () => {
    if (!same(draft, clean)) {
      const ok = await askConfirm({
        title: 'Leave without saving?',
        detail: 'Your changes since the last save are lost.',
        confirmLabel: 'Leave',
        danger: true,
      });
      if (!ok) return;
    }
    back();
  };

  const remove = async () => {
    if (at.fileId === undefined || at.stored === undefined) return;
    const ok = await askConfirm({
      title: `Delete ${at.stored.name}?`,
      detail: 'It is taken out of your homebrew file. A character using it loses it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await homebrewRepo.removeEntry(at.fileId, type, at.stored);
      invalidateRegistry();
      notify({ title: `Deleted ${at.stored.name}`, tone: 'good' });
      navigate('/workshop', { replace: true });
    } catch (err) {
      setFailure(`Could not delete it: ${errorText(err)}.`);
    }
  };

  const more = async () => {
    const options: Array<{ id: string; label: string; hint?: string; danger?: boolean }> = [];
    if (original !== undefined) {
      const of = String(original.name);
      options.push(
        mode === 'changes'
          ? {
              id: 'full',
              label: 'Save a full copy instead',
              hint: `Every field written out, for someone whose data does not have ${of}.`,
            }
          : {
              id: 'changes',
              label: 'Save changes only',
              hint: `Only what you changed; the rest comes from ${of}.`,
            },
      );
    }
    if (at.fileId !== undefined) options.push({ id: 'delete', label: 'Delete', danger: true });
    const id = await askChoice({ title: name || `New ${spec.noun}`, options });
    if (id === 'full' || id === 'changes') setMode(id);
    if (id === 'delete') await remove();
  };

  const pickPlace = async () => {
    const id = await askChoice({
      title: 'Saves to',
      options: places.map((p) => ({
        id: p.fileId ?? '',
        label: p.title,
        hint: p.fileId === undefined ? 'Made the first time you save' : undefined,
      })),
    });
    if (id !== undefined && id !== null) setPlaceKey(id === '' ? undefined : id);
  };

  const savesTo =
    at.fileId !== undefined ? (
      <span>
        Saved in{' '}
        <span className="font-semibold text-ink">
          {savedIn !== undefined ? (madeName(savedIn.json) ?? savedIn.fileName) : MY_HOMEBREW}
        </span>
      </span>
    ) : places.length > 1 ? (
      <span>
        Saves to{' '}
        <button
          type="button"
          onClick={() => void pickPlace()}
          aria-label={`Saves to ${place?.title ?? MY_HOMEBREW}. Pick another collection`}
          className={SAVES_TO}
        >
          {place?.title ?? MY_HOMEBREW}
        </button>
      </span>
    ) : (
      <span>
        Saves to <span className="font-semibold text-ink">{MY_HOMEBREW}</span>
        {place?.fileId === undefined && ', made the first time you save'}
      </span>
    );

  // The spells a Cast a spell card can name, one per name in the entry's rules
  // version, as an item's are: for each list of cards whose editor names none.
  const { edition, bookEdition, source: from } = draft;
  const spellChoices = useMemo(
    () => onePerName(registry.byType('spell'), { edition, bookEdition, source: from }),
    [registry, edition, bookEdition, from],
  );
  // The entry as the sheet would hold it once saved, for Try it on.
  const trying = useMemo(
    () => ({ ...draft, name: name || `New ${spec.noun}`, source }),
    [draft, name, source, spec.noun],
  );
  const fileView = (() => {
    if (!asFile) return null;
    let text: string;
    try {
      text = fileText(type, written());
    } catch (err) {
      text = `It cannot be written as it stands: ${errorText(err)}.`;
    }
    const why = readOnly
      ? 'A copy of an entry your data does not have: it can be deleted, not changed.'
      : spec.write !== undefined
        ? `A ${spec.noun}'s file holds its features too. Change them in the form.`
        : original !== undefined
          ? `A copy is written as what changed from ${String(original.name)}. Change it in the form.`
          : undefined;
    return (
      <FileView
        text={text}
        why={why}
        onEdit={(next) => {
          const { source: _given, ...rest } = next;
          setDraft(draft.source !== undefined ? { ...rest, source: draft.source } : rest);
        }}
      />
    );
  })();

  const Body = spec.Body;
  const saveState =
    at.fileId === undefined
      ? 'Not saved yet'
      : same(draft, clean)
        ? 'Saved'
        : 'Changed since it was saved';
  const kind = `${spec.noun[0]?.toUpperCase()}${spec.noun.slice(1)}${
    !isCopy ? ', your own' : mode === 'full' ? ', a full copy' : ', a copy'
  }. ${saveState}`;
  return (
    <EditorShell
      title={name || `New ${spec.noun}`}
      kind={kind}
      onBack={() => void leave()}
      onMore={original !== undefined || at.fileId !== undefined ? () => void more() : undefined}
      basedOn={isCopy ? String(original?.name ?? missing) : undefined}
      banner={
        <>
          {missing !== undefined && (
            <p className={BOX}>
              <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
              <span>
                {missingOriginal(missing)} Your changes are kept as they are, and come back when the
                data that has it is loaded.
              </span>
            </p>
          )}
          {tables !== undefined && (
            <p className={BOX}>
              <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
              <span>
                Starts from your table's {String(original?.name)}, with your changes to the book's.
                The book's stays as the book has it, and nobody has this one until they pick it.
              </span>
            </p>
          )}
          {(subject.stale || lost > 0) && (
            <p className={BOX}>
              <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
              <span>
                {String(original?.name)} changed since you copied it.{' '}
                {mode === 'full'
                  ? 'This full copy keeps the old version.'
                  : lost > 0
                    ? `${lost === 1 ? 'One of your changes no longer fits it' : `${lost} of your changes no longer fit it`} and ${lost === 1 ? 'is' : 'are'} not shown. Saving keeps only what is shown here.`
                    : 'Your changes are shown on the new version.'}
              </span>
            </p>
          )}
        </>
      }
      footnote={footnote}
      problems={problems}
      savesTo={savesTo}
      saved={
        undo === undefined ? undefined : { text: undo.text, onUndo: () => void takeBack(), undoing }
      }
      failure={failure}
      file={{ shown: asFile, onToggle: () => setAsFile((v) => !v), view: fileView }}
      saving={saving}
      canSave={!blocked}
      onSave={() => void save()}
    >
      <Field label="Name">
        <input
          ref={nameBox}
          value={String(draft.name ?? '')}
          disabled={readOnly}
          onChange={(e) => change({ name: e.target.value })}
          className={fieldClass}
        />
      </Field>
      {/* A pick added anywhere in the entry takes an id none of its picks has, nor had. */}
      <EntryPicks draft={draft} before={[subject.draft, ...saves, original]}>
        <SpellChoices.Provider value={spellChoices}>
          <Body
            draft={draft}
            change={change}
            original={original}
            registry={registry}
            readOnly={readOnly}
          />
        </SpellChoices.Provider>
      </EntryPicks>
      {!readOnly && TRY_ON_TYPES.has(type) && (
        <TryItOn type={type} entry={trying} registry={registry} />
      )}
    </EditorShell>
  );
}

function Frame({ back, children }: { back: () => void; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pt-3 pb-4">
      <button type="button" aria-label="Back" onClick={back} className={ICON}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      {children}
    </main>
  );
}

function EditorRoute({ action, type, uid }: { action: string; type: string; uid: string }) {
  const reg = useRegistryState();
  const location = useLocation();
  const navigate = useNavigate();
  const back = useBack('/workshop');
  const packs = useTypePacks(type, reg.retry);
  // A background's origin feat is picked from the feats.
  const feats = useTypePacks(type === 'background' ? 'feat' : undefined, reg.retry);
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const [spec, setSpec] = useState<EditorSpec>();
  const [specError, setSpecError] = useState<string>();
  const [specTry, setSpecTry] = useState(0);
  // The editor open, kept through the URL change a first save makes, so a
  // save does not reload what the player is looking at.
  const [session, setSession] = useState<{ key: string; urls: string[]; subject: Subject }>();
  // With `?file=`: the same name and book in another file is another entry.
  const url = `${location.pathname}${location.search}`;
  const here = useRef(url);
  here.current = url;

  // biome-ignore lint/correctness/useExhaustiveDependencies: specTry asks for the chunk again after Try again.
  useEffect(() => {
    let live = true;
    setSpec(undefined);
    setSpecError(undefined);
    EDITORS.get(type)?.()
      .then((m) => live && setSpec(m.editor))
      .catch((err: unknown) => live && setSpecError(errorText(err)));
    return () => {
      live = false;
    };
  }, [type, specTry]);

  const current = session?.urls.includes(url) === true ? session : undefined;
  const loading =
    spec === undefined ||
    reg.registry === null ||
    packs.status === 'loading' ||
    feats.status === 'loading' ||
    owned === undefined;
  const resolved: Resolved =
    current !== undefined
      ? { state: 'ready', subject: current.subject }
      : loading || spec === undefined || reg.registry === null || owned === undefined
        ? { state: 'loading' }
        : opened(
            resolve(
              action,
              type,
              uid,
              spec,
              reg.registry,
              entriesOf(owned.files),
              owned.files,
              fileParam(location.search),
              {
                seed: seedOf(location.state),
                name: new URLSearchParams(location.search).get('name'),
              },
            ),
            spec,
            reg.registry,
            owned.files,
          );

  usePageTitle(resolved.state === 'gone' ? 'Not found' : null, 'Workshop');

  // A change to the books opens on the Change sheet. `navigate`, not
  // <Navigate>, which would pull the router's redirect into the entry chunk.
  const movedTo = resolved.state === 'moved' ? resolved.to : undefined;
  useEffect(() => {
    if (movedTo !== undefined) navigate(movedTo, { replace: true });
  }, [movedTo, navigate]);

  const failed =
    specError ??
    reg.error ??
    (packs.status === 'error' ? (packs.error ?? 'the download failed') : null);
  if (resolved.state !== 'ready' && failed !== null) {
    return (
      <Frame back={back}>
        <p className={NOTE}>The Workshop could not open this: {failed}</p>
        <Button
          variant="brand"
          className="self-start"
          onClick={() => {
            if (specError !== undefined) setSpecTry((n) => n + 1);
            reg.retry();
            packs.retry();
            feats.retry();
          }}
        >
          Try again
        </Button>
      </Frame>
    );
  }
  if (resolved.state === 'loading' || resolved.state === 'moved') {
    return (
      <Frame back={back}>
        <p className={NOTE}>Loading…</p>
      </Frame>
    );
  }
  if (resolved.state === 'gone') {
    return (
      <Frame back={back}>
        <p className={NOTE}>{resolved.text}</p>
        <Link to="/workshop" className={LINK}>
          Back to the Workshop
        </Link>
      </Frame>
    );
  }
  const key = current?.key ?? url;
  const files = owned?.files ?? [];
  return (
    <Editor
      key={key}
      type={type}
      spec={spec as EditorSpec}
      subject={resolved.subject}
      registry={reg.registry as EntityRegistry}
      files={files}
      start={action !== 'edit' ? placeIn(location.search, placesOf(files)) : undefined}
      onSaved={(path, fileId) => {
        const next = `${path}${inFile(fileId)}`;
        setSession({ key, urls: [...(current?.urls ?? [url]), next], subject: resolved.subject });
        if (next !== url) navigate(next, { replace: true });
      }}
      onUndone={(was, state) => {
        // The address now, not this render's: Undo can be pressed before the
        // save's own move to the entry's address has landed.
        if (was !== here.current) navigate(was, { replace: true, state });
      }}
    />
  );
}

export function Component() {
  const { action, type, uid } = useParams();
  if (action === 'new' && type === undefined) {
    return (
      <Suspense fallback={<Loading />}>
        <MakeSheet />
      </Suspense>
    );
  }
  if (action === 'change' && type !== undefined && uid !== undefined && isEntityType(type)) {
    return (
      <Suspense fallback={<Loading />}>
        <ChangeSheet type={type} uid={uid} />
      </Suspense>
    );
  }
  if (
    action === undefined ||
    type === undefined ||
    !isEntityType(type) ||
    !EDITORS.has(type) ||
    !['new', 'copy', 'edit'].includes(action) ||
    (action !== 'new' && uid === undefined)
  ) {
    return <NotHere />;
  }
  return <EditorRoute action={action} type={type} uid={uid ?? ''} />;
}

function Loading() {
  const back = useBack('/workshop');
  return (
    <Frame back={back}>
      <p className={NOTE}>Loading…</p>
    </Frame>
  );
}

function NotHere() {
  usePageTitle('Not found', 'Workshop');
  const back = useBack('/workshop');
  return (
    <Frame back={back}>
      <p className={NOTE}>The Workshop has nothing at this address.</p>
      <Link to="/workshop" className={LINK}>
        Back to the Workshop
      </Link>
    </Frame>
  );
}
