/**
 * The table's rules, at `/workshop/rules` (ADR-002, D1; board 10, B): the six
 * table rules every character plays by, set here as Settings set them, and
 * the rule packs, each with its review (what it holds, who it applies to,
 * on or off), their order, and Write a rule pack. Settings keeps a row that
 * opens this page, reading the rules the same way (`useAppRules`).
 *
 * A pack is also a collection, on the Collections shelf: its file's page
 * exports it, updates it from its link and deletes it, and its review links
 * there. This page does what makes it a pack.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronRight, FileUp, ListOrdered, PenLine } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
  type PackHere,
  PackOrderSheet,
  PackReviewSheet,
  reachWords,
  togglePack,
  usePacksHere,
  useRoster,
} from '@/features/homebrew/PackReviewSheet';
import { HouseRulesSection } from '@/features/settings/HouseRulesSection';
import { useBack } from '@/lib/useBack';
import { usePageTitle } from '@/lib/usePageTitle';
import { announce } from '@/stores/announcer';
import { Button } from '@/ui/Button';
import { listClass, listRowClass } from '@/ui/surfaces';
import { collectionPath, collectionsOf } from './collections';

const ImportSheet = lazy(() => import('./ImportSheet'));
const WritePackSheet = lazy(() => import('./WritePackSheet'));

const NOTE = 'text-body text-ink-muted';
const H2 = 'px-1 text-body-strong';
const ICON =
  '-ml-3 tap shrink-0 self-start rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink';

/**
 * A pack from a link says so, since Update can bring a newer one. A written
 * pack keeps its key through export and import, so where any other pack came
 * from (written here, or a friend's file) cannot be told, and is not said.
 */
const fromWords = (row: { url?: string | undefined } | undefined) =>
  row?.url === undefined ? '' : 'From a link. ';

type Open =
  | { kind: 'pack'; id: string }
  | { kind: 'order' }
  | { kind: 'write' }
  | { kind: 'import' };

export function Component() {
  usePageTitle('Rules', 'Workshop');
  const back = useBack('/workshop?shelf=rules');
  const read = useLiveQuery(() => homebrewRepo.listMetaSafe(), []);
  const rows = read?.files;
  const packs = usePacksHere(rows);
  const roster = useRoster();
  const names = new Map((roster ?? []).map((c) => [c.id, c.name]));
  // The Workshop's Rules shelf opens the page with its write sheet open
  // (`?write`), once: the address drops it, so Back or a reload does not.
  const [params, setParams] = useSearchParams();
  const asked = params.has('write');
  const [open, setOpen] = useState<Open | undefined>(() => (asked ? { kind: 'write' } : undefined));
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the address asking matters
  useEffect(() => {
    if (!asked) return;
    const next = new URLSearchParams(params);
    next.delete('write');
    setParams(next, { replace: true });
  }, [asked]);
  const [message, setMessage] = useState<string>();
  // What opened a sheet, for focus to go back to as it closes: a sheet that
  // swaps for another (Import's preview) has no trigger of its own.
  const opener = useRef<HTMLElement | null>(null);
  const show = (next: Open) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(next);
  };
  const close = () => {
    setOpen(undefined);
    const to = opener.current;
    requestAnimationFrame(() => {
      if (to?.isConnected === true && document.activeElement === document.body) {
        to.focus({ preventScroll: true });
      }
    });
  };
  const say = (text: string) => {
    setMessage(text);
    announce(text, { key: 'rules', repeat: true });
  };

  const rowOf = (id: string) => rows?.find((r) => r.id === id);
  const fileOf = (p: PackHere) => {
    const c = collectionsOf(rows ?? []).find((x) => x.rows.some((r) => r.id === p.id));
    return c === undefined ? undefined : collectionPath(c.id);
  };
  const reviewed = open?.kind === 'pack' ? packs?.find((p) => p.id === open.id) : undefined;
  const reviewedFile = reviewed === undefined ? undefined : fileOf(reviewed);
  // A pack deleted while its review is open (from another tab) closes it for
  // good: left open, the same file put back (an undo, a re-import) would open
  // it again unasked.
  const gone = open?.kind === 'pack' && packs !== undefined && reviewed === undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` is fresh each render; only the pack going matters
  useEffect(() => {
    if (gone) close();
  }, [gone]);

  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-4">
      <button type="button" aria-label="Back" onClick={back} className={ICON}>
        <ArrowLeft size={20} aria-hidden />
      </button>
      <h1 className="font-display text-title-page">Rules</h1>
      {message !== undefined && <p className="text-caption text-ink-muted">{message}</p>}

      <HouseRulesSection heading={H2} title="Table rules" aside="Every character" />

      <section aria-labelledby="rules-packs" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <h2 id="rules-packs" className={H2}>
            Rule packs
          </h2>
          {packs !== undefined && packs.length > 1 && (
            <Button variant="ghost" size="sm" onClick={() => show({ kind: 'order' })}>
              <ListOrdered size={16} aria-hidden /> Order
            </Button>
          )}
        </div>
        <p className="px-1 text-caption text-ink-muted">
          A pack changes rules and entries for the characters it applies to, over the table rules.
          Where two disagree, the one later in the order wins.
        </p>
        {/* Who a pack reaches is said by name, so the list waits for the characters too. */}
        {packs === undefined || roster === undefined ? (
          <p className={NOTE}>Loading…</p>
        ) : packs.length === 0 ? (
          <p className={NOTE}>None yet. Write one from your rules, or import one.</p>
        ) : (
          <ul className={listClass}>
            {packs.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => show({ kind: 'pack', id: p.id })}
                  className={`${listRowClass} w-full text-left hover:bg-surface-hover`}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-strong break-words">{p.review.name}</span>
                    <span className="sr-only">,</span>{' '}
                    <span className="text-caption text-ink-muted">
                      {fromWords(rowOf(p.id))}
                      {reachWords(p, names)}
                    </span>
                  </span>
                  <ChevronRight size={20} aria-hidden="true" className="shrink-0 text-ink-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => show({ kind: 'write' })}>
            <PenLine size={18} aria-hidden /> Write a rule pack
          </Button>
          <Button variant="ghost" onClick={() => show({ kind: 'import' })}>
            <FileUp size={18} aria-hidden /> Import a rule pack
          </Button>
        </div>
      </section>

      {reviewed !== undefined && (
        <PackReviewSheet
          pack={reviewed}
          packs={packs ?? []}
          onToggle={() => togglePack(reviewed)}
          onClose={close}
          {...(reviewedFile === undefined ? {} : { file: reviewedFile })}
        />
      )}
      {open?.kind === 'order' && packs !== undefined && (
        <PackOrderSheet packs={packs} onClose={close} />
      )}
      {open?.kind === 'write' && (
        <Suspense fallback={null}>
          <WritePackSheet onClose={close} onSaved={setMessage} />
        </Suspense>
      )}
      {open?.kind === 'import' && (
        <Suspense fallback={null}>
          <ImportSheet
            onClose={close}
            onDone={(text) => {
              say(text);
              close();
            }}
          />
        </Suspense>
      )}
    </main>
  );
}
