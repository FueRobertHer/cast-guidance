/**
 * One collection, at `/workshop/collection/:id` (ADR-002, D1): for now its
 * name, its switch, and the way to the Homebrew page, where its entries,
 * export and delete still are. U6 builds the page board 8 draws in its
 * place, so the Collections shelf's cards never lead nowhere meanwhile.
 *
 * `:id` is any of its rows' ids (see `collections.ts`).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { invalidateRegistry } from '@/data5e/registry';
import { type HomebrewFileMeta, homebrewRepo } from '@/db/homebrewRepo';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { notifyFailure } from '@/stores/notices';
import { buttonClass } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { listClass, listRowClass } from '@/ui/surfaces';
import { type Collection, collectionWith, holdsOf, madeName } from './collections';

const NOTE = 'text-body text-ink-muted';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';
const LINK =
  'font-semibold text-ink underline decoration-line-strong underline-offset-3 hover:decoration-ink';

/**
 * Turn a file or a book on or off. The switch reads from the row, so a
 * refused write leaves it saying what is stored; the notice says the press
 * did not take.
 */
function toggle(r: HomebrewFileMeta): void {
  void homebrewRepo
    .setEnabled(r.id, !r.enabled)
    .then(invalidateRegistry)
    .catch((err: unknown) => notifyFailure(r.enabled ? 'Turn off' : 'Turn on', err));
}

/** A row's switch: its name stays put while its face says On or Off. */
function Switch({ row, name }: { row: HomebrewFileMeta; name: string }) {
  return (
    <Chip
      tone="outline"
      aria-label={`Use ${name}`}
      pressed={row.enabled}
      onClick={() => toggle(row)}
      className="-my-1 shrink-0"
    >
      {row.enabled ? 'On' : 'Off'}
    </Chip>
  );
}

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

function Found({ c }: { c: Collection }) {
  usePageTitle(c.name, 'Workshop');
  const books = c.rows.length > 1;
  return (
    <Frame>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-title-page break-words">{c.name}</h1>
        <p className="text-caption text-ink-muted">
          {c.from}. {holdsOf(c)}.
        </p>
      </header>
      {books ? (
        <ul className={listClass} aria-label="Its books">
          {c.rows.map((r) => {
            const name = r.book ?? r.fileName;
            return (
              <li key={r.id} className={`${listRowClass} flex-wrap`}>
                <span className="min-w-0 flex-1 basis-40 break-words">{name}</span>
                <Switch row={r} name={name} />
              </li>
            );
          })}
        </ul>
      ) : (
        c.rows.map((r) => (
          <div key={r.id} className={listClass}>
            <div className={`${listRowClass} flex-wrap`}>
              <span className="min-w-0 flex-1 basis-40">
                {r.enabled ? 'On for every character' : 'Off for every character'}
              </span>
              <Switch row={r} name={c.name} />
            </div>
          </div>
        ))
      )}
      <p className={NOTE}>
        Its entries, export, update and delete are on the Homebrew page for now.
      </p>
      <Link to="/homebrew" className={`self-start ${buttonClass({ variant: 'outline' })}`}>
        Open the Homebrew page
      </Link>
    </Frame>
  );
}

function Missing({ title, text }: { title: string; text: string }) {
  usePageTitle(title, 'Workshop');
  return (
    <Frame>
      <p className={NOTE}>{text}</p>
      <Link to="/workshop?shelf=collections" className={`self-start ${LINK}`}>
        Back to the Workshop
      </Link>
    </Frame>
  );
}

export function Component() {
  const { id = '' } = useParams();
  const meta = useLiveQuery(() => homebrewRepo.listMetaSafe(), []);
  const owned = useLiveQuery(() => homebrewRepo.ownedSafe(), []);
  if (meta === undefined || owned === undefined) {
    return (
      <Frame>
        <p className={NOTE}>Loading…</p>
      </Frame>
    );
  }
  const names = new Map(owned.files.map((f) => [f.id, madeName(f.json) ?? f.fileName]));
  const c = collectionWith(id, meta.files, names);
  if (c !== undefined) return <Found c={c} />;
  if (meta.errors.some((e) => e.id === id))
    return (
      <Missing
        title="Collection unreadable"
        text="This collection is on this device but could not be read. The Homebrew page says why."
      />
    );
  return (
    <Missing title="Collection not found" text="This collection is no longer on this device." />
  );
}
