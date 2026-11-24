/**
 * Make your own (ADR-002 D1, board 2), at `/workshop/new`: what is being made,
 * then where it starts. Three starts, one editor after:
 *
 * - **From nothing**: the kind's editor, empty.
 * - **Like something that exists**: one search over the player's own, their
 *   collections and the books; the one picked is copied under a name of its
 *   own (`/workshop/copy/...?name=`), and stays as it is.
 * - **From text you paste**: the text fills Text. For a spell the spell
 *   reader's findings come ticked, and those kept are filled in; every other
 *   kind takes the text alone (no other reader fills fields).
 *
 * The steps are in the address (`?kind=`, `?from=`, `?pick=`), so Back steps
 * back through them; `?file=` (a collection to save into) passes through to
 * the editor. Nothing is saved here.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import {
  Backpack,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Copy,
  GitFork,
  type LucideIcon,
  Package,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Skull,
  Sparkles,
  Split,
  Star,
  Swords,
  Users,
  WandSparkles,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useRegistryState, useTypePacks } from '@/data5e/hooks';
import type { EntityType } from '@/data5e/normalize';
import { sourceName } from '@/data5e/sourceNames';
import { homebrewRepo } from '@/db/homebrewRepo';
import { findEntity } from '@/features/library/findEntity';
import { textToEntries } from '@/lib/entriesText';
import { usePageTitle } from '@/lib/usePageTitle';
import { errorText } from '@/stores/notices';
import { buttonClass } from '@/ui/Button';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { EDITORS, type EditorSpec, type Json } from './editorTypes';
import { Field } from './fields';
import { type Finding, readSpellText } from './textReader';
import { entriesOf, kindOf, labelOf } from './yours';

const NOTE = 'text-body text-ink-muted';
const CAPTION = 'text-caption text-ink-muted';
const ICON = 'tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
const ROW = `${listRowClass} w-full text-left hover:bg-surface-raised`;

/**
 * Each kind the Workshop makes, in the board's order, with what one holds.
 * `title` names a kind the Library has no section for (a subrace).
 */
const KINDS: ReadonlyArray<{ type: string; icon: LucideIcon; line: string; title?: string }> = [
  { type: 'spell', icon: WandSparkles, line: 'A cantrip or spell: damage, saves, what it does' },
  { type: 'item', icon: Backpack, line: 'Gear or a magic item, and what it gives' },
  { type: 'feat', icon: Star, line: 'Benefits that count on the sheet' },
  { type: 'subclass', icon: GitFork, line: 'A path for a class, its features by level' },
  { type: 'class', icon: Swords, line: 'Hit die, class table, features and pools' },
  { type: 'race', icon: Users, line: 'Size, speed, senses and traits' },
  {
    type: 'subrace',
    icon: Split,
    line: 'A version of a species, with traits of its own',
    title: 'Subraces',
  },
  { type: 'background', icon: ScrollText, line: 'Skills, tools, languages, an origin feat' },
  {
    type: 'condition',
    icon: CircleAlert,
    line: 'Put on a character in play, and what it changes',
  },
  { type: 'optionalfeature', icon: Sparkles, line: 'Invocations, maneuvers and other picks' },
];

/** Kinds on the board marked Later: shown, not offered. */
const LATER: ReadonlyArray<{ name: string; icon: LucideIcon; line: string }> = [
  { name: 'Creatures and companions', icon: Skull, line: 'A familiar, a mount, a summoned beast' },
  { name: 'Magic item variants', icon: Package, line: 'One rule for every +1 weapon or armor' },
];

/** A kind as the list of kinds names it ("Feats", "Subraces"). */
const titleOf = (type: string) => KINDS.find((k) => k.type === type)?.title ?? labelOf(type);

/** Every kind with an editor, the board's first; one added later by its file goes last. */
export function makeKinds(): Array<{ type: string; icon: LucideIcon; line: string }> {
  const known = KINDS.filter((k) => EDITORS.has(k.type));
  const added = [...EDITORS.keys()]
    .filter((t) => !KINDS.some((k) => k.type === t))
    .map((type) => ({ type, icon: Plus, line: `A new ${kindOf(type).toLowerCase()}` }));
  return [...known, ...added];
}

/** Kinds whose text the editor keeps in `entries`: a class's and a subclass's is in its features. */
const TEXT_KINDS: ReadonlySet<string> = new Set([
  'spell',
  'item',
  'feat',
  'race',
  'background',
  'condition',
  'optionalfeature',
]);

const noun = (type: string) => kindOf(type).toLowerCase();
const an = (word: string) => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);

/** A row whose name is its title alone; the line under it describes it. */
function Tile({
  to,
  title,
  line,
  icon: Icon,
  state,
}: {
  to: string;
  title: string;
  line: string;
  icon: LucideIcon;
  state?: unknown;
}) {
  const id = useId();
  return (
    <li>
      <Link to={to} state={state} aria-describedby={id} className={ROW}>
        <Icon size={18} aria-hidden className="shrink-0 text-ink-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-strong">{title}</span>
          <span id={id} aria-hidden className={CAPTION}>
            {line}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
      </Link>
    </li>
  );
}

/** The steps in the address, read once. */
interface Step {
  kind?: string;
  from?: 'like' | 'text';
  pick?: string;
  file?: string;
}

function stepOf(params: URLSearchParams): Step {
  const kind = params.get('kind') ?? undefined;
  const from = params.get('from');
  const valid = kind !== undefined && EDITORS.has(kind);
  return {
    kind: valid ? kind : undefined,
    from:
      valid && (from === 'like' || (from === 'text' && TEXT_KINDS.has(kind))) ? from : undefined,
    pick: valid && from === 'like' ? (params.get('pick') ?? undefined) : undefined,
    file: params.get('file') ?? undefined,
  };
}

/** The address of a step, keeping the collection to save into. */
function query(step: Step): string {
  const q = new URLSearchParams();
  if (step.kind !== undefined) q.set('kind', step.kind);
  if (step.from !== undefined) q.set('from', step.from);
  if (step.pick !== undefined) q.set('pick', step.pick);
  if (step.file !== undefined) q.set('file', step.file);
  const s = q.toString();
  return s === '' ? '/workshop/new' : `/workshop/new?${s}`;
}

/** The step before this one. */
function parentOf(step: Step): Step | undefined {
  const file = step.file;
  if (step.pick !== undefined) return { kind: step.kind, from: 'like', file };
  if (step.from !== undefined) return { kind: step.kind, file };
  if (step.kind !== undefined) return { file };
  return undefined;
}

/** Marks an address this page pushed, so Back can step back to the one before. */
const PUSHED = { makeStep: true };
const pushed = (state: unknown) =>
  typeof state === 'object' &&
  state !== null &&
  (state as { makeStep?: unknown }).makeStep === true;
/**
 * Marks the tab's first entry once a step back has replaced it: a replace
 * gives even the first entry a new key, and the sheet may be mounted afresh
 * on it (back from the editor, then a step back), so only the entry can say.
 */
const FIRST = { makeFirst: true };
const first = (state: unknown) =>
  typeof state === 'object' &&
  state !== null &&
  (state as { makeFirst?: unknown }).makeFirst === true;

export function MakeSheet() {
  usePageTitle('Make your own', 'Workshop');
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Opened as the tab's first page (a link from outside), Back on the first
  // step goes up to the Workshop rather than out of the app.
  const atFirst = location.key === 'default' || first(location.state);
  const leave = () => {
    if (atFirst) void navigate('/workshop', { replace: true });
    else void navigate(-1);
  };
  const step = stepOf(params);
  const parent = parentOf(step);
  const heading = useRef<HTMLHeadingElement>(null);
  const where = query(step);
  // Each step's heading takes the keyboard when the step changes, so the next
  // step is where it is; arriving on the page leaves focus as the app has it.
  const shown = useRef(where);
  useEffect(() => {
    if (shown.current === where) return;
    shown.current = where;
    heading.current?.focus();
  }, [where]);

  const back = () => {
    if (parent === undefined) leave();
    else if (pushed(location.state)) navigate(-1);
    else
      setParams(new URLSearchParams(query(parent).split('?')[1] ?? ''), {
        replace: true,
        ...(atFirst ? { state: FIRST } : {}),
      });
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-3 pb-6">
      <header className="flex items-start gap-1">
        <button
          type="button"
          aria-label={parent === undefined ? 'Back' : 'Back a step'}
          onClick={back}
          className={`-ml-3 ${ICON}`}
        >
          <ChevronLeftIcon />
        </button>
        <h1 className="min-w-0 flex-1 pt-1.5 font-display text-title-page">Make your own</h1>
      </header>
      {step.kind === undefined ? (
        <Kinds heading={heading} file={step.file} />
      ) : step.from === undefined ? (
        <Starts heading={heading} step={step} />
      ) : step.from === 'text' ? (
        <FromText heading={heading} step={step} />
      ) : step.pick === undefined ? (
        <Like heading={heading} step={step} />
      ) : (
        <Based heading={heading} step={step} />
      )}
    </main>
  );
}

function ChevronLeftIcon() {
  return <ChevronRight size={20} aria-hidden className="rotate-180" />;
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

function StepHeading({ heading, children }: { heading: HeadingRef; children: string }) {
  return (
    <h2 ref={heading} tabIndex={-1} className="font-display text-title-sheet">
      {children}
    </h2>
  );
}

function Kinds({ heading, file }: { heading: HeadingRef; file?: string }) {
  return (
    <>
      <StepHeading heading={heading}>What are you making?</StepHeading>
      <ul className={listClass}>
        {makeKinds().map((k) => (
          <Tile
            key={k.type}
            to={query({ kind: k.type, file })}
            state={PUSHED}
            title={titleOf(k.type)}
            line={k.line}
            icon={k.icon}
          />
        ))}
      </ul>
      <section className="flex flex-col gap-2">
        <h3 className="text-overline text-ink-muted uppercase">Later</h3>
        <ul className={listClass}>
          {LATER.map((k) => (
            <li key={k.name} className={listRowClass}>
              <k.icon size={18} aria-hidden className="shrink-0 text-ink-faint" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-strong text-ink-muted">{k.name}</span>
                <span className={CAPTION}>{k.line}. Not in the Workshop yet.</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <p className={NOTE}>
        A rule pack (your house rules and changes, to share as a file) is written from{' '}
        <Link
          to="/workshop/rules"
          className="font-semibold text-ink underline decoration-line-strong underline-offset-3"
        >
          Rules
        </Link>
        .
      </p>
    </>
  );
}

/** Where the editor opens: the kind's, with the collection to save into. */
const editorPath = (kind: string, file?: string) =>
  `/workshop/new/${kind}${file !== undefined ? `?file=${encodeURIComponent(file)}` : ''}`;

function Starts({ heading, step }: { heading: HeadingRef; step: Step }) {
  const kind = step.kind ?? '';
  const one = noun(kind);
  return (
    <>
      <StepHeading heading={heading}>{`A new ${one}: start from`}</StepHeading>
      <ul className={listClass}>
        <Tile
          to={editorPath(kind, step.file)}
          title="From nothing"
          line={`An empty ${one}: about it, its text, what it does, and a character to try it on.`}
          icon={Pencil}
        />
        <Tile
          to={query({ ...step, from: 'like' })}
          state={PUSHED}
          title="Like something that exists"
          line={`Copy ${an(one)} from the books, a collection or your own, then change it. The one you copy stays as it is.`}
          icon={Copy}
        />
        {TEXT_KINDS.has(kind) && (
          <Tile
            to={query({ ...step, from: 'text' })}
            state={PUSHED}
            title="From text you paste"
            line={
              kind === 'spell'
                ? "Paste a spell's text. The spell reader fills in what it can count and you say what to keep."
                : `Paste ${an(one)}'s text. It goes into Text, and you add what it does in the editor.`
            }
            icon={Clipboard}
          />
        )}
      </ul>
      <p className={NOTE}>
        It saves to My homebrew, made the first time you save, or to a collection of yours you pick
        in the editor.
      </p>
    </>
  );
}

/** What the spell reader finds in a spell made of `entries`, and the spell with the kept ones in. */
function readPasted(
  spec: EditorSpec,
  entries: unknown[],
  off: ReadonlySet<string>,
): { found: Finding[]; spell: Json } {
  const start: Json = { ...spec.blank(), entries };
  const found = readSpellText(start);
  // One at a time, each read again over the last one's result, as the editor's Add all does.
  let spell = start;
  for (let i = 0; i < 40; i++) {
    const next = readSpellText(spell).find((f) => !off.has(findingKey(f)));
    if (next === undefined) break;
    spell = { ...spell, ...next.patch };
    for (const [k, v] of Object.entries(next.patch)) if (v === undefined) delete spell[k];
  }
  return { found, spell };
}

const findingKey = (f: Finding) => `${f.kind}|${f.what}`;

function FromText({ heading, step }: { heading: HeadingRef; step: Step }) {
  const kind = step.kind ?? '';
  const one = noun(kind);
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [spec, setSpec] = useState<EditorSpec>();
  const [specError, setSpecError] = useState<string>();
  const [specTry, setSpecTry] = useState(0);
  const boxId = useId();
  // The spell's own start (its level and the rest), as From nothing has it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: specTry asks for the chunk again after Try again.
  useEffect(() => {
    if (kind !== 'spell') return;
    let live = true;
    setSpecError(undefined);
    EDITORS.get('spell')?.()
      .then((m) => live && setSpec(m.editor))
      .catch((err: unknown) => live && setSpecError(errorText(err)));
    return () => {
      live = false;
    };
  }, [kind, specTry]);
  const entries = useMemo(() => textToEntries(text), [text]);
  // Without the reader (its chunk did not load), the text still goes into Text.
  const reads = kind === 'spell' && specError === undefined;
  const read = useMemo(
    () => (reads && spec !== undefined ? readPasted(spec, entries, off) : undefined),
    [reads, spec, entries, off],
  );
  const open = () => {
    const seed: Json = read !== undefined ? read.spell : { entries };
    navigate(editorPath(kind, step.file), { state: { seed } });
  };
  const kept = read === undefined ? 0 : read.found.filter((f) => !off.has(findingKey(f))).length;
  return (
    <>
      <StepHeading heading={heading}>{`From text: a new ${one}`}</StepHeading>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={boxId} className="text-label text-ink-muted">
          Paste the text
        </label>
        <textarea
          id={boxId}
          value={text}
          rows={8}
          placeholder={`Paste ${an(one)}'s text here`}
          onChange={(e) => setText(e.target.value)}
          className={`${fieldClass} min-h-48 py-3`}
        />
      </div>
      {specError !== undefined ? (
        <div className="flex flex-col items-start gap-2">
          <p className={NOTE}>
            The spell reader could not load: {specError}. The text still goes into Text, and you can
            fill in the rest in the editor.
          </p>
          <button
            type="button"
            onClick={() => setSpecTry((n) => n + 1)}
            className={buttonClass({ variant: 'outline', size: 'sm' })}
          >
            Try again
          </button>
        </div>
      ) : reads && read === undefined ? (
        <p className={NOTE}>Loading the spell reader…</p>
      ) : read !== undefined ? (
        <section className="flex flex-col gap-2" aria-labelledby={`${boxId}-found`}>
          <div className="flex items-baseline gap-2">
            <h3 id={`${boxId}-found`} className="flex-1 text-overline text-ink-muted uppercase">
              What the reader found
            </h3>
            {read.found.length > 0 && (
              <span className={CAPTION}>
                {kept} of {read.found.length} kept
              </span>
            )}
          </div>
          {read.found.length === 0 ? (
            <p className={NOTE}>
              {text.trim() === ''
                ? 'Paste the text, and what the spell reader can count shows here. Untick anything it got wrong.'
                : 'Nothing the spell reader counts yet. The text still goes into Text, and you can fill in the rest in the editor.'}
            </p>
          ) : (
            <ul className={listClass}>
              {read.found.map((f) => {
                const key = findingKey(f);
                return (
                  <li key={key}>
                    <label className={`${ROW} cursor-pointer`}>
                      <input
                        type="checkbox"
                        checked={!off.has(key)}
                        onChange={() =>
                          setOff((s) => {
                            const next = new Set(s);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })
                        }
                        className="size-5 shrink-0 accent-brand"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body-strong">{f.what}</span>
                        <span className={`${CAPTION} wrap-anywhere`}>&ldquo;{f.quote}&rdquo;</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {read.found.length > 0 && (
            <p className={CAPTION}>
              What you untick stays in the text, and the editor offers it again.
            </p>
          )}
        </section>
      ) : (
        <p className={NOTE}>
          The text goes into Text. The reader that fills in fields reads spells alone, so you add
          what {an(one)} does in the editor.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={open}
          disabled={text.trim() === '' || (reads && read === undefined)}
          className={buttonClass({ variant: 'brand', block: true })}
        >
          Open in the editor
        </button>
        <p className={CAPTION}>Nothing is saved until you save in the editor.</p>
      </div>
    </>
  );
}

/** Where a found entry is: the player's own, one of their collections, or a book. */
type Shelf = 'yours' | 'collections' | 'books';
const SHELVES: ReadonlyArray<{ shelf: Shelf; head: string }> = [
  { shelf: 'yours', head: 'Yours' },
  { shelf: 'collections', head: 'In your collections' },
  { shelf: 'books', head: 'In the books' },
];
/** The most rows a shelf lists before it asks for more of the name. */
const LISTED = 20;

const uidOf = (e: Json) => `${String(e.name)}|${String(e.source)}`;

function Like({ heading, step }: { heading: HeadingRef; step: Step }) {
  const kind = step.kind ?? '';
  const one = noun(kind);
  const reg = useRegistryState();
  const packs = useTypePacks(kind, reg.retry);
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  const [q, setQ] = useState('');
  const searchId = useId();
  // The player's own entries by name and book, as the Workshop's Yours lists
  // them. Not by book alone: every device's Workshop file is MyHomebrew, so a
  // friend's imported one shares the book.
  const mine = useMemo(
    () =>
      new Set(
        entriesOf(owned?.files ?? [])
          .filter((m) => m.type === kind)
          .map((m) => uidOf(m.entry).toLowerCase()),
      ),
    [owned, kind],
  );
  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const registry = reg.registry;
  const hits = useMemo(() => {
    if (registry === null || words.length === 0) return [];
    const all = registry.byType(kind as EntityType) as readonly Json[];
    const official = registry.officialCount(kind as EntityType);
    return all
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => {
        const name = String(e.name ?? '').toLowerCase();
        return words.every((w) => name.includes(w));
      })
      .map(({ e, i }) => {
        const source = String(e.source ?? '');
        const shelf: Shelf =
          i < official ? 'books' : mine.has(uidOf(e).toLowerCase()) ? 'yours' : 'collections';
        return { e, shelf, source };
      });
  }, [registry, kind, mine, words]);
  const loading = registry === null || packs.status === 'loading';
  const label = `Search ${titleOf(kind).toLowerCase()}: yours, your collections and the books`;
  return (
    <>
      <StepHeading heading={heading}>{`Like something: a new ${one}`}</StepHeading>
      <div className="relative">
        <Search
          size={18}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
        />
        <input
          id={searchId}
          type="search"
          value={q}
          aria-label={label}
          placeholder="Search by name"
          onChange={(e) => setQ(e.target.value)}
          className={`${fieldClass} pl-10`}
        />
      </div>
      <p className={NOTE}>
        Pick one to copy. The new one is yours to change; the one you picked stays as it is.
      </p>
      <div aria-live="polite" className="flex flex-col gap-4">
        {loading && words.length > 0 && <p className={NOTE}>Looking…</p>}
        {!loading && words.length === 0 && (
          <p className={NOTE}>Type a name to find {an(one)} to copy.</p>
        )}
        {!loading && words.length > 0 && hits.length === 0 && (
          <p className={NOTE}>Nothing called &ldquo;{q.trim()}&rdquo;. Try a shorter word.</p>
        )}
      </div>
      {!loading &&
        SHELVES.map(({ shelf, head }) => {
          const rows = hits.filter((h) => h.shelf === shelf);
          if (rows.length === 0) return null;
          return (
            <section key={shelf} className="flex flex-col gap-2" aria-label={head}>
              <div className="flex items-baseline gap-2">
                <h3 className="flex-1 text-overline text-ink-muted uppercase">{head}</h3>
                <span className={CAPTION}>{rows.length}</span>
              </div>
              <ul className={listClass}>
                {rows.slice(0, LISTED).map(({ e, source }) => (
                  <li key={uidOf(e)}>
                    <Link to={query({ ...step, pick: uidOf(e) })} state={PUSHED} className={ROW}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body-strong wrap-anywhere">{String(e.name)}</span>
                        <span className={CAPTION}>
                          {kindOf(kind)}, {sourceName(source)}
                        </span>
                      </span>
                      <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              {rows.length > LISTED && (
                <p className={CAPTION}>
                  {LISTED} of {rows.length} shown. Type more of the name to find the one you want.
                </p>
              )}
            </section>
          );
        })}
    </>
  );
}

function Based({ heading, step }: { heading: HeadingRef; step: Step }) {
  const kind = step.kind ?? '';
  const one = noun(kind);
  const reg = useRegistryState();
  const packs = useTypePacks(kind, reg.retry);
  const pick = step.pick ?? '';
  const picked =
    reg.registry === null
      ? undefined
      : (findEntity(reg.registry, kind as EntityType, pick) as Json | undefined);
  const pickedName = picked !== undefined ? String(picked.name) : (pick.split('|')[0] ?? '');
  const [name, setName] = useState<string>();
  const shown = name ?? pickedName;
  const nameId = useId();
  if (reg.registry === null || packs.status === 'loading') {
    // The heading is there from the start, so it can take the keyboard.
    return (
      <>
        <StepHeading heading={heading}>{`A new ${one}, based on ${pickedName}`}</StepHeading>
        <p className={NOTE}>Loading…</p>
      </>
    );
  }
  if (picked === undefined) {
    return (
      <>
        <StepHeading heading={heading}>{`A new ${one}`}</StepHeading>
        <p className={NOTE}>
          Nothing in {titleOf(kind).toLowerCase()} is called {pickedName}. Search again.
        </p>
      </>
    );
  }
  const from = sourceName(String(picked.source));
  const trimmed = shown.trim();
  const sameName = trimmed.toLowerCase() === pickedName.toLowerCase();
  const to = new URLSearchParams();
  if (trimmed !== '' && !sameName) to.set('name', trimmed);
  if (step.file !== undefined) to.set('file', step.file);
  const search = to.toString();
  return (
    <>
      <StepHeading heading={heading}>{`A new ${one}, based on ${pickedName}`}</StepHeading>
      <span className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-pill px-3 text-caption font-semibold text-ink-muted ring ring-line-strong ring-inset">
        <Copy size={14} aria-hidden />
        Based on {pickedName}, {from}
      </span>
      <Field label="Name">
        <input
          id={nameId}
          value={shown}
          onChange={(e) => setName(e.target.value)}
          className={fieldClass}
        />
      </Field>
      <p className={CAPTION} aria-live="polite">
        {trimmed === ''
          ? 'Give it a name, or keep the one it has.'
          : sameName
            ? `Same name as the one you copied. It is saved beside ${pickedName} in your collection; give it a new name to tell them apart.`
            : `A new ${one}, beside ${pickedName}.`}
      </p>
      <div className="flex flex-col gap-1">
        <Link
          to={`/workshop/copy/${kind}/${encodeURIComponent(pick)}${search === '' ? '' : `?${search}`}`}
          className={buttonClass({ variant: 'brand', block: true })}
        >
          Open in the editor
        </Link>
        <p className={CAPTION}>
          Everything is copied, all of it yours to change. Nothing is saved until you save in the
          editor.
        </p>
      </div>
    </>
  );
}
