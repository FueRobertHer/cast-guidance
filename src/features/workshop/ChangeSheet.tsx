/**
 * Change for your table (ADR-002, D2; board 6, pick C): a book's entry, or an
 * imported collection's, changed for every character at the table. The change
 * is saved into the player's Changes to the books, under the entry's own
 * identity, so the registry puts it in the entry's place and every sheet that
 * holds the entry gets it, with no reference rewritten.
 *
 * At `/workshop/change/:type/:uid`, where `uid` is the entry's identity
 * (`identityKey`: `name|source`, and a feature's class and level), or its
 * `name|source`. It opens the entry as the table sees it now; the change is
 * written against `belowOwnChange(e)` (the entry below with a shared pack's
 * changes), never against the table's version, or a second edit would be
 * written as a change of the first.
 *
 * The parts are the type's own editor (its fields, its parts with Keep, Change
 * and Remove, what it does on the sheet), or for a class or subclass feature,
 * which has no editor, its text, its parts and its effects.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { Info, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { type CopyModWarning, type Entity, withReplaceBudget } from '@/data5e/copyMod';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistryState, useTypePacks } from '@/data5e/hooks';
import { type EntityRegistry, identityKey, stackChanges } from '@/data5e/normalize';
import { invalidateRegistry } from '@/data5e/registry';
import { sourceName } from '@/data5e/sourceNames';
import { EntryClash, type EntryKey, type HomebrewFile, homebrewRepo } from '@/db/homebrewRepo';
import { isRecord } from '@/engine/castGuidance';
import { readMechanics } from '@/engine/effects/mechanics';
import { findEntity } from '@/features/library/findEntity';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { errorText, notify } from '@/stores/notices';
import { askChoice, askConfirm } from '@/ui/dialogs';
import { cardClass } from '@/ui/surfaces';
import { changeCount, changeKey, partName, same, writeChange } from './copyWriter';
import { EditorShell, type Problem } from './EditorShell';
import { EntryEffects } from './EffectCards';
import { EDITORS, type EditorProps, type EditorSpec, type Json } from './editorTypes';
import { Section, TextBlocks } from './fields';
import { PartList } from './PartList';
import { EntryPicks } from './pickIds';
import { editPath, inFile } from './yours';

const NOTE = 'text-body text-ink-muted';
const BOX = 'flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption';
const LINK =
  'text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
const CHANGES = 'Changes to the books';

/** The types with no editor of their own that a change opens on, by what one is called. */
const FEATURES: Readonly<Record<string, string>> = {
  classFeature: 'class feature',
  subclassFeature: 'subclass feature',
};

/**
 * Whether an entry of `type` can be changed for the table. A class and a
 * subclass gather features that are entries of their own, each changed from
 * its own page, so they are not offered whole. LibraryPage asks the same.
 */
export function canChange(type: string): boolean {
  return (
    Object.hasOwn(FEATURES, type) || (EDITORS.has(type) && type !== 'class' && type !== 'subclass')
  );
}

/** The entry an address names: by its identity, else by `name|source` alone. */
export function entryAt(registry: EntityRegistry, type: string, uid: string): Entity | undefined {
  const key = uid.toLowerCase();
  const exact = registry.byType(type as never).find((e) => identityKey(type, e) === key);
  if (exact !== undefined) return exact;
  // A feature's identity names its class too: two parts alone could find another class's.
  return uid.split('|').length <= 2 ? findEntity(registry, type as never, uid) : undefined;
}

/** The address of the Change sheet for an entry. */
export const changePath = (type: string, e: Entity): string =>
  `/workshop/change/${type}/${encodeURIComponent(identityKey(type, e))}`;

const keyOf = (e: Json): EntryKey => ({ name: String(e.name), source: String(e.source) });

const sameKey = (e: unknown, key: EntryKey): boolean =>
  isRecord(e) &&
  String(e.name).toLowerCase() === key.name.toLowerCase() &&
  String(e.source).toLowerCase() === key.source.toLowerCase();

/** How many entries a file holds, of every type. */
const entryCount = (json: Json) =>
  Object.entries(json)
    .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v))
    .reduce((n, [, v]) => n + (v as unknown[]).length, 0);

/** The file of the player's changes to the books, when one is stored. */
const changesFile = (files: readonly HomebrewFile[]) =>
  files.find((f) => f.editable && f.role === 'changes');

interface ChangeSubject {
  /** The entry as the table sees it now, which the Library shows. */
  placed: Entity;
  /** What the player's change is written against (`belowOwnChange`). */
  original: Json;
  draft: Json;
  /** The player's change as stored, when there is one. */
  stored?: Json;
  /** A stored change that no longer reads over the entry: the draft shows the entry without it. */
  lost: boolean;
  fileId?: string;
  /**
   * Another change in the file shares this one's name and book (each class's
   * Ability Score Improvement): saving by name and book could replace it.
   */
  clash?: string;
}

type Resolved =
  | { state: 'loading' }
  | { state: 'gone'; text: string; edit?: string }
  | { state: 'ready'; subject: ChangeSubject };

function resolveChange(
  type: string,
  uid: string,
  spec: EditorSpec | undefined,
  registry: EntityRegistry,
  files: readonly HomebrewFile[],
): Resolved {
  const placed = entryAt(registry, type, uid);
  const [name = uid] = uid.split('|');
  if (placed === undefined) return { state: 'gone', text: `Nothing here is called ${name}.` };
  const identity = identityKey(type, placed);
  const holds = (list: unknown) =>
    Array.isArray(list) && list.some((x) => isRecord(x) && identityKey(type, x) === identity);
  const mine = files.find((f) => f.role !== 'changes' && holds(f.json[type]));
  if (mine !== undefined) {
    return {
      state: 'gone',
      text: `${String(placed.name)} is one of yours, so it is changed in its own editor.`,
      edit: EDITORS.has(type)
        ? `${editPath(type, String(placed.name), String(placed.source))}${inFile(mine.id)}`
        : undefined,
    };
  }
  const original = registry.belowOwnChange(placed) as Json;
  const file = changesFile(files);
  const list = Array.isArray(file?.json[type]) ? (file?.json[type] as unknown[]) : [];
  const stored = list.find((x): x is Json => isRecord(x) && changeKey(type, x) === identity);
  const other = list.find(
    (x) => isRecord(x) && sameKey(x, keyOf(original)) && changeKey(type, x) !== identity,
  );
  let draft: Json = structuredClone(original);
  let lost = false;
  if (stored !== undefined) {
    const warnings: CopyModWarning[] = [];
    const stacked = withReplaceBudget(() => stackChanges(type, original, [stored], warnings));
    lost = stacked === original || warnings.length > 0;
    draft = structuredClone(stacked) as Json;
  }
  if (spec?.open !== undefined && spec.write === undefined) {
    draft = spec.open(draft, { original, registry, file: file?.json });
  }
  return {
    state: 'ready',
    subject: {
      placed,
      original,
      draft,
      stored,
      lost,
      fileId: file?.id,
      ...(other !== undefined
        ? {
            clash: `${CHANGES} already holds a change to another ${String(original.name)} of ${String(original.source)}, which saving here could replace. Change that one from its own page.`,
          }
        : {}),
    },
  };
}

/** A class or subclass feature: its text, its parts, and what it does on the sheet. */
function PartsBody({ draft, change, original, readOnly }: EditorProps) {
  const parts = Array.isArray(original?.entries)
    ? original.entries.some((b) => partName(b) !== undefined)
    : false;
  return (
    <>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      {parts && (
        <Section title="Parts">
          <PartList
            title="Parts"
            noun="part"
            entries={draft.entries}
            original={original?.entries}
            source={original !== undefined ? String(original.source) : undefined}
            readOnly={readOnly}
            onChange={(entries) => change({ entries })}
          />
        </Section>
      )}
      <EntryEffects draft={draft} change={change} original={original} readOnly={readOnly} />
    </>
  );
}

/** A save or a removal that can be taken back: the file before and after it, and the editor. */
interface Undoable {
  text: string;
  fileId: string;
  created: boolean;
  before?: Json;
  after?: Json;
  key: EntryKey;
  was: { draft: Json; clean: Json; stored?: Json; fileId?: string };
}

function ChangeEditor({
  type,
  spec,
  subject,
  registry,
}: {
  type: string;
  spec?: EditorSpec;
  subject: ChangeSubject;
  registry: EntityRegistry;
}) {
  const back = useBack('/workshop');
  const { original } = subject;
  const name = String(original.name);
  const noun = spec?.noun ?? FEATURES[type] ?? 'entry';
  const [draft, setDraft] = useState(subject.draft);
  const [clean, setClean] = useState(subject.draft);
  const [stored, setStored] = useState(subject.stored);
  const [fileId, setFileId] = useState(subject.fileId);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [undo, setUndo] = useState<Undoable>();
  const [undoing, setUndoing] = useState(false);
  const [asFile, setAsFile] = useState(false);
  const [showBook, setShowBook] = useState(false);
  usePageTitle(name, 'Change for your table', 'Workshop');

  const change = (patch: Json) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next;
    });

  const count = changeCount(original, draft);
  const problems: Problem[] = [];
  if (subject.clash !== undefined) problems.push({ text: subject.clash, blocks: true });
  if (count === 0) {
    problems.push({
      text:
        stored === undefined
          ? `Nothing here differs from the book's ${name} yet.`
          : `Nothing here differs from the book's ${name}. To use the book's again, choose More.`,
      blocks: true,
    });
  }
  const checked = spec?.check?.(draft, {
    original,
    copied: original,
    source: String(original.source),
    mode: 'changes',
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
  const blocked = problems.some((p) => p.blocks);

  /** Write the change file through `write`, keeping what it held before for Undo. */
  const commit = async (
    write: () => Promise<{ fileId: string; created: boolean }>,
    next: { draft: Json; stored?: Json },
    key: EntryKey,
    text: string,
  ) => {
    const before =
      fileId === undefined ? undefined : (await homebrewRepo.getSafe(fileId)).file?.json;
    const done = await write();
    invalidateRegistry();
    // The write has landed: a failed read here only means Undo is not offered.
    const after = done.created
      ? undefined
      : await homebrewRepo
          .getSafe(done.fileId)
          .then((r) => r.file?.json)
          .catch(() => undefined);
    setUndo(
      done.created || (before !== undefined && after !== undefined)
        ? {
            text,
            fileId: done.fileId,
            created: done.created,
            before,
            after,
            key,
            was: { draft, clean, stored, fileId },
          }
        : undefined,
    );
    setFileId(done.fileId);
    setStored(next.stored);
    setDraft(next.draft);
    setClean(next.draft);
  };

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const entry = writeChange(type, original, draft) as Json & EntryKey;
      await commit(
        () =>
          homebrewRepo.saveEntry(type, entry, {
            role: 'changes',
            ...(stored !== undefined ? { replaces: keyOf(stored) } : {}),
          }),
        { draft, stored: entry },
        keyOf(entry),
        `Saved. Every character at your table uses your ${name}.`,
      );
      notify({ title: `Saved ${name} for your table`, tone: 'good' });
    } catch (err) {
      setFailure(
        err instanceof EntryClash
          ? `${CHANGES} already holds a change called ${name} that this one cannot replace.`
          : `Could not save ${name}: ${errorText(err)}. Nothing was changed on this device.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const backToBook = async () => {
    if (stored === undefined || fileId === undefined) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const at = fileId;
      const key = keyOf(stored);
      await commit(
        async () => {
          if (!(await homebrewRepo.removeEntry(at, type, key)))
            throw new Error('your change is no longer in the file');
          return { fileId: at, created: false };
        },
        { draft: structuredClone(original) },
        key,
        `The book's ${name} is back for your table.`,
      );
      notify({ title: `The book's ${name} is back`, tone: 'good' });
    } catch (err) {
      setFailure(`Could not take your change away: ${errorText(err)}.`);
    } finally {
      setSaving(false);
    }
  };

  const takeBack = async () => {
    if (undo === undefined) return;
    setUndoing(true);
    setFailure(undefined);
    try {
      const { file } = await homebrewRepo.getSafe(undo.fileId);
      if (undo.created) {
        // Something saved into it since (another tab) stays: only this change goes.
        if (file !== undefined && entryCount(file.json) > 1)
          await homebrewRepo.removeEntry(undo.fileId, type, undo.key);
        else await homebrewRepo.delete(undo.fileId);
      } else {
        // Putting the whole file back would lose anything written to it since.
        if (
          file === undefined ||
          undo.before === undefined ||
          undo.after === undefined ||
          !same(file.json, undo.after)
        ) {
          setUndo(undefined);
          setFailure(
            `${CHANGES} changed after this (in another tab?), so Undo would lose that. Nothing was taken back.`,
          );
          return;
        }
        await homebrewRepo.saveEditable(undo.fileId, undo.before);
      }
      invalidateRegistry();
      setDraft(undo.was.draft);
      setClean(undo.was.clean);
      setStored(undo.was.stored);
      setFileId(undo.was.fileId);
      setUndo(undefined);
      notify({ title: `Took it back: ${name} is as it was`, tone: 'good' });
    } catch (err) {
      setFailure(`Could not take it back: ${errorText(err)}.`);
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

  const more = async () => {
    const id = await askChoice({
      title: name,
      options: [
        {
          id: 'book',
          label: `Use the book's ${name} again`,
          hint: "Takes your change away: every character at your table gets the book's.",
        },
      ],
    });
    if (id === 'book') await backToBook();
  };

  const written = (() => {
    try {
      return JSON.stringify(writeChange(type, original, draft), null, 2);
    } catch (err) {
      return `It cannot be written as it stands: ${errorText(err)}.`;
    }
  })();
  const saveState =
    stored === undefined
      ? 'Not saved yet'
      : same(draft, clean)
        ? 'Saved'
        : 'Changed since it was saved';
  const Body = spec?.Body ?? PartsBody;
  return (
    <EditorShell
      title={name}
      kind={`${noun[0]?.toUpperCase()}${noun.slice(1)}, your table's version. ${saveState}`}
      onBack={() => void leave()}
      onMore={stored !== undefined && subject.clash === undefined ? () => void more() : undefined}
      banner={
        <>
          <span className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-full px-3 text-caption font-semibold text-ink-muted ring-1 ring-line-strong ring-inset">
            <Pencil size={14} aria-hidden />
            Changes the book's {name}, {sourceName(String(original.source))}
          </span>
          <p className={BOX}>
            <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
            <span>
              Every character at your table gets this version in place of the book's.
              {stored === undefined ? ' Their sheets use yours once you save.' : ''}
            </span>
          </p>
          {subject.lost && (
            <p className={BOX}>
              <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
              <span>
                Your saved change no longer reads over the book's {name}, so it is not shown here.
                Saving writes what is shown.
              </span>
            </p>
          )}
          <button
            type="button"
            aria-expanded={showBook}
            onClick={() => setShowBook((v) => !v)}
            className={`${LINK} self-start`}
          >
            {showBook ? "Hide the book's" : "See the book's"}
          </button>
          {showBook && (
            <div className={cardClass}>
              <EntriesView entries={original.entries} />
            </div>
          )}
        </>
      }
      footnote={
        count > 0
          ? `${count} ${count === 1 ? 'change' : 'changes'} from the book's ${name}, saved as changes only.`
          : undefined
      }
      problems={problems}
      savesTo={
        <span>
          {stored !== undefined ? 'Saved in ' : 'Saves to '}
          <span className="font-semibold text-ink">{CHANGES}</span>
          {fileId === undefined && ', made the first time you save'}
        </span>
      }
      saved={
        undo === undefined ? undefined : { text: undo.text, onUndo: () => void takeBack(), undoing }
      }
      failure={failure}
      file={{
        shown: asFile,
        onToggle: () => setAsFile((v) => !v),
        view: (
          <section className="flex flex-col gap-2">
            <h2 className="text-overline text-ink-muted uppercase">As a file</h2>
            <p className="text-caption text-ink-muted">
              A change is written as what differs from the book's {name}, under its name and book.
              Change it in the form.
            </p>
            <pre className="overflow-x-auto rounded-control bg-surface-raised p-3 font-mono text-caption">
              {written}
            </pre>
          </section>
        ),
      }}
      saveLabel="Save for your table"
      saving={saving}
      canSave={!blocked}
      onSave={() => void save()}
    >
      <EntryPicks draft={draft} before={[subject.draft, original]}>
        <Body
          draft={draft}
          change={change}
          original={original}
          registry={registry}
          readOnly={false}
        />
      </EntryPicks>
    </EditorShell>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 px-4 pt-5 pb-4">
      {children}
    </main>
  );
}

/** The Change sheet's route: finds the entry, the player's change to it, and the type's editor. */
export function ChangeSheet({ type, uid }: { type: string; uid: string }) {
  const reg = useRegistryState();
  const navigate = useNavigate();
  const packs = useTypePacks(type, reg.retry);
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const editor = canChange(type) ? EDITORS.get(type) : undefined;
  const [spec, setSpec] = useState<EditorSpec>();
  const [specError, setSpecError] = useState<string>();
  // What the sheet opened on, kept while it is open: a save rebuilds the
  // registry, and the editor goes on from what it holds.
  const held = useRef<{ uid: string; subject: ChangeSubject }>(undefined);

  useEffect(() => {
    let live = true;
    editor?.()
      .then((m) => live && setSpec(m.editor))
      .catch((err: unknown) => live && setSpecError(errorText(err)));
    return () => {
      live = false;
    };
  }, [editor]);

  const decoded = decodeURIComponent(uid);
  if (!canChange(type)) {
    return (
      <Frame>
        <p className={NOTE}>This kind of entry cannot be changed for your table yet.</p>
        <Link to="/workshop" className={LINK}>
          Back to the Workshop
        </Link>
      </Frame>
    );
  }
  const failed = specError ?? reg.error ?? (packs.status === 'error' ? packs.error : null);
  const loading =
    (editor !== undefined && spec === undefined) ||
    reg.registry === null ||
    packs.status === 'loading' ||
    owned === undefined;
  const resolved: Resolved =
    held.current?.uid === decoded
      ? { state: 'ready', subject: held.current.subject }
      : loading || reg.registry === null || owned === undefined
        ? { state: 'loading' }
        : resolveChange(type, decoded, spec, reg.registry, owned.files);
  if (resolved.state === 'ready') held.current = { uid: decoded, subject: resolved.subject };

  if (resolved.state !== 'ready' && failed !== null && failed !== undefined) {
    return (
      <Frame>
        <p className={NOTE}>The Workshop could not open this: {failed}</p>
      </Frame>
    );
  }
  if (resolved.state === 'loading') {
    return (
      <Frame>
        <p className={NOTE}>Loading…</p>
      </Frame>
    );
  }
  if (resolved.state === 'gone') {
    return (
      <Frame>
        <p className={NOTE}>{resolved.text}</p>
        {resolved.edit !== undefined ? (
          <button
            type="button"
            className={`${LINK} self-start`}
            onClick={() => navigate(resolved.edit as string, { replace: true })}
          >
            Open it in its editor
          </button>
        ) : (
          <Link to="/workshop" className={LINK}>
            Back to the Workshop
          </Link>
        )}
      </Frame>
    );
  }
  return (
    <ChangeEditor
      key={decoded}
      type={type}
      spec={spec}
      subject={resolved.subject}
      registry={reg.registry as EntityRegistry}
    />
  );
}
