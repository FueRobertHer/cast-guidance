/**
 * The Workshop (ADR-001): where a player makes their own entries and edits
 * copies of official ones, saved to their homebrew file on this device.
 *
 * - `/workshop`: what they have made, and a way to make each kind;
 * - `/workshop/new/:type`: a new entry;
 * - `/workshop/copy/:type/:uid`: a copy of a Library entry (`name|source`);
 * - `/workshop/edit/:type/:uid`: one of theirs, found in the files they own.
 *
 * Each kind's editor is its own chunk (`editorTypes.ts`); this page is the
 * frame around them, and the saving.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, GitFork, Info, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
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
import { TYPE_LABELS } from '@/features/library/browseTypes';
import { findEntity } from '@/features/library/findEntity';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { errorText, notify } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { askChoice, askConfirm } from '@/ui/dialogs';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import {
  changeCount,
  copiedFrom,
  missingOriginal,
  originalChanged,
  readStored,
  type SaveMode,
  same,
  writeEntry,
} from './copyWriter';
import { EditorShell } from './EditorShell';
import { EDITORS, type EditorSpec, type Json } from './editorTypes';
import { Field } from './fields';

const NOTE = 'text-body text-ink-muted';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
const LINK =
  'text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
const BOX = 'flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption';

const keyOf = (name: string, source: string) => encodeURIComponent(`${name}|${source}`);
const labelOf = (type: string) => TYPE_LABELS.get(type) ?? type;

/** One of the player's entries, where it is kept. */
interface Mine {
  type: string;
  entry: Json;
  fileId: string;
}

/** Every entry of a kind the Workshop edits, in the files the player owns. */
function entriesOf(files: readonly HomebrewFile[]): Mine[] {
  const out: Mine[] = [];
  for (const file of files) {
    for (const type of EDITORS.keys()) {
      const list = file.json[type];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry === 'object' && entry !== null && typeof (entry as Json).name === 'string')
          out.push({ type, entry: entry as Json, fileId: file.id });
      }
    }
  }
  return out;
}

const matches = (e: Json, key: EntryKey) =>
  String(e.name).toLowerCase() === key.name.toLowerCase() &&
  String(e.source).toLowerCase() === key.source.toLowerCase();

function Home() {
  usePageTitle('Workshop');
  const back = useBack('/library');
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const mine = owned === undefined ? undefined : entriesOf(owned.files);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pt-3 pb-6">
      <header className="flex items-start gap-1">
        <button type="button" aria-label="Back" onClick={back} className={ICON}>
          <ArrowLeft size={20} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="font-display text-title-page">Workshop</h1>
          <p className="text-caption text-ink-muted">
            Make your own, or edit a copy of anything in the Library. Everything is saved to your
            homebrew file on this device.
          </p>
        </div>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-overline text-ink-muted uppercase">Make your own</h2>
        <ul className={listClass}>
          {[...EDITORS.keys()].map((type) => (
            <li key={type}>
              <Link
                to={`/workshop/new/${type}`}
                className={`${listRowClass} hover:bg-surface-raised`}
              >
                <span className="min-w-0 flex-1 text-body-strong">{labelOf(type)}</span>
                <Plus size={18} aria-hidden className="text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-overline text-ink-muted uppercase">Yours</h2>
        {mine === undefined ? (
          <p className={NOTE}>Loading…</p>
        ) : mine.length === 0 ? (
          <p className={NOTE}>
            Nothing yet. Make one above, or open an entry in the{' '}
            <Link to="/library" className={LINK}>
              Library
            </Link>{' '}
            and choose Edit a copy.
          </p>
        ) : (
          <ul className={listClass}>
            {mine.map(({ type, entry, fileId }) => {
              const from = copiedFrom(entry);
              return (
                <li key={`${fileId}:${type}:${String(entry.name)}|${String(entry.source)}`}>
                  <Link
                    to={`/workshop/edit/${type}/${keyOf(String(entry.name), String(entry.source))}`}
                    className={`${listRowClass} hover:bg-surface-raised`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body-strong break-words">{String(entry.name)}</span>
                      <span className="text-caption text-ink-muted">
                        {labelOf(type)}
                        {from !== undefined && (
                          <>
                            {', '}
                            <GitFork size={12} aria-hidden className="inline align-[-1px]" /> based
                            on {from.name}
                          </>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

/** What an editor opens on, worked out once from the URL and the data. */
interface Subject {
  draft: Json;
  /** The entry a copy is made from, as the player's data has it. */
  original?: Json;
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

/** The file a new entry goes into, and the book it is saved under there. */
interface Into {
  fileId: string;
  source: string;
}

/**
 * The file `?file=` names, when it is one the player made and can write to.
 * The address can be edited, so any other id (an imported file, one gone)
 * names nothing, and the entry goes to My homebrew as it would without it.
 */
function intoFile(search: string, files: readonly HomebrewFile[]): Into | undefined {
  const id = new URLSearchParams(search).get('file');
  const file = id === null ? undefined : files.find((f) => f.id === id);
  const source = file?.sourceIds[0];
  if (file === undefined || file.editable !== true || source === undefined) return undefined;
  return { fileId: file.id, source };
}

type Resolved =
  | { state: 'loading' }
  | { state: 'gone'; text: string }
  | { state: 'ready'; subject: Subject };

function resolve(
  action: string,
  type: string,
  uid: string,
  spec: EditorSpec,
  registry: EntityRegistry,
  mine: readonly Mine[],
): Resolved {
  if (action === 'new') {
    return {
      state: 'ready',
      subject: { draft: { name: '', ...spec.blank() }, mode: 'changes', stale: false },
    };
  }
  if (action === 'copy') {
    const original = findEntity(registry, type as never, uid) as Json | undefined;
    if (original === undefined)
      return {
        state: 'gone',
        text: `Nothing in ${labelOf(type).toLowerCase()} is called ${uid.split('|')[0]}.`,
      };
    return {
      state: 'ready',
      subject: { draft: structuredClone(original), original, mode: 'changes', stale: false },
    };
  }
  const [name = '', source = ''] = uid.split('|');
  const found = mine.find((m) => m.type === type && matches(m.entry, { name, source }));
  if (found === undefined)
    return { state: 'gone', text: `You have no ${spec.noun} called ${name} on this device.` };
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
  const original = registry.get(type as never, from.name, from.source) as Json | undefined;
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

function Editor({
  type,
  spec,
  subject,
  registry,
  into,
  onSaved,
}: {
  type: string;
  spec: EditorSpec;
  subject: Subject;
  registry: EntityRegistry;
  /** A new entry's file, when it was made from one (`?file=`): else My homebrew. */
  into?: Into;
  onSaved: (url: string) => void;
}) {
  const navigate = useNavigate();
  const back = useBack('/workshop');
  const { original, missing } = subject;
  const lost = subject.lost ?? 0;
  const [draft, setDraft] = useState(subject.draft);
  const [clean, setClean] = useState(subject.draft);
  const [mode, setMode] = useState<SaveMode>(subject.mode);
  const [at, setAt] = useState({ fileId: subject.fileId, stored: subject.stored });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
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

  const problem = readOnly
    ? `${missingOriginal(missing ?? '')} It can be deleted, not changed.`
    : name === ''
      ? 'Give it a name to save it.'
      : name.includes('|')
        ? 'A name cannot have | in it.'
        : spec.check?.(draft);
  const footnote = (() => {
    if (problem !== undefined) return problem;
    if (original === undefined) return 'Saved to your homebrew file on this device.';
    const of = String(original.name);
    if (mode === 'full') return `A full copy of ${of}, readable without ${of} in the data.`;
    const n = changeCount(original, draft);
    return n === 0
      ? `No changes from ${of} yet. You can save it as it is.`
      : `${n} ${n === 1 ? 'change' : 'changes'} from ${of}, saved as changes only.`;
  })();

  const save = async () => {
    if (problem !== undefined) return;
    setSaving(true);
    setFailure(undefined);
    try {
      // A full copy reopened keeps the mark of the original it was made from.
      const base = mode === 'full' && subject.mode === 'full' ? undefined : original;
      const source = at.stored?.source ?? into?.source ?? WORKSHOP_SOURCE;
      const entry = writeEntry({ original: base, draft, source, mode }) as Json & EntryKey;
      const saved = await homebrewRepo.saveEntry(type, entry, {
        fileId: at.fileId ?? into?.fileId,
        replaces: at.stored,
      });
      invalidateRegistry();
      if (saved.created) {
        await ensureSourcesVisible([WORKSHOP_SOURCE]).catch(() => undefined);
      }
      setAt({ fileId: saved.fileId, stored: { name: entry.name, source: entry.source } });
      setClean(draft);
      notify({ title: `Saved ${entry.name}`, tone: 'good' });
      onSaved(`/workshop/edit/${type}/${keyOf(entry.name, entry.source)}`);
    } catch (err) {
      setFailure(
        err instanceof EntryClash
          ? `You already have a ${spec.noun} called ${name}. Choose another name.`
          : `Could not save ${name}: ${errorText(err)}. Nothing was changed on this device.`,
      );
    } finally {
      setSaving(false);
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

  const Body = spec.Body;
  const kind = `${spec.noun[0]?.toUpperCase()}${spec.noun.slice(1)}${
    !isCopy ? ', your own' : mode === 'full' ? ', a full copy' : ', a copy'
  }`;
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
      saving={saving}
      canSave={problem === undefined}
      onSave={() => void save()}
    >
      <Field label="Name">
        <input
          value={String(draft.name ?? '')}
          disabled={readOnly}
          onChange={(e) => change({ name: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Body
        draft={draft}
        change={change}
        original={original}
        registry={registry}
        readOnly={readOnly}
      />
      {failure !== undefined && (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-caption">
          {failure}
        </p>
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
  const url = location.pathname;

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
        : resolve(action, type, uid, spec, reg.registry, entriesOf(owned.files));

  usePageTitle(resolved.state === 'gone' ? 'Not found' : null, 'Workshop');

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
  if (resolved.state === 'loading') {
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
  return (
    <Editor
      key={key}
      type={type}
      spec={spec as EditorSpec}
      subject={resolved.subject}
      registry={reg.registry as EntityRegistry}
      into={action === 'new' ? intoFile(location.search, owned?.files ?? []) : undefined}
      onSaved={(next) => {
        setSession({ key, urls: [...(current?.urls ?? [url]), next], subject: resolved.subject });
        if (next !== url) navigate(next, { replace: true });
      }}
    />
  );
}

export function Component() {
  const { action, type, uid } = useParams();
  if (action === undefined) return <Home />;
  if (
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
