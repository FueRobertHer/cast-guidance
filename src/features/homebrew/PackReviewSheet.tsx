/**
 * Rule packs on the Homebrew page (Packs board, A): what a pack holds, who it
 * applies to, where it clashes with another, and the order that settles a
 * clash. The import preview shows the same details before a pack goes on (H8).
 *
 * Who a pack reaches is this device's alone, kept on the stored file bound to
 * its id (`data5e/rulePack.ts`), so Share, Download and a character's export
 * leave it behind.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { invalidateRegistry } from '@/data5e/registry';
import {
  type PackLocal,
  packGuidance,
  packLocal,
  packsInOrder,
  withPackLocal,
} from '@/data5e/rulePack';
import { characterRepo } from '@/db/characterRepo';
import { compareMergeOrder } from '@/db/homebrewOrder';
import { type HomebrewFile, type HomebrewFileMeta, homebrewRepo } from '@/db/homebrewRepo';
import type { PackAppliesTo } from '@/engine/castGuidance';
import { notifyFailure } from '@/stores/notices';
import { type AppTableRules, useAppTableRules } from '@/stores/tableRules';
import { Chip } from '@/ui/Chip';
import { ImportPreviewDialog, PreviewList, PreviewSection, StatusItem } from '@/ui/ImportPreview';
import { SegmentedControl } from '@/ui/SegmentedControl';
import {
  describeConflict,
  describeIncomingConflict,
  type PackInPlay,
  type PackReview,
  type PackReviewRow,
  packConflicts,
  packReview,
} from './importPreview';

/** The line under a pack's name: what it can and cannot do. */
export const PACK_SAFE_LINE = 'Rules and changes only. A pack cannot run code.';

/** A rule pack among the files here, with what it holds, in the player's order. */
export interface PackHere {
  id: string;
  fileName: string;
  enabled: boolean;
  review: PackReview;
  /** Who it reaches on this device; absent, nobody yet. */
  local?: PackLocal;
  guidance: Record<string, unknown>;
}

/** As the clash check reads a pack: who it reaches now, nobody while it breaks a limit. */
export function inPlay(p: PackHere, appliesTo = p.local?.appliesTo): PackInPlay {
  return {
    id: p.id,
    name: p.review.name,
    guidance: p.guidance,
    ...(appliesTo === undefined || p.review.refusals.length > 0 ? {} : { appliesTo }),
  };
}

/** The packs among `files`, in the player's order. */
export function packsHere(files: readonly HomebrewFile[]): PackHere[] {
  const byId = new Map(files.map((f) => [f.id, f]));
  return packsInOrder([...files].sort(compareMergeOrder).map((f) => [f.id, f.json] as const))
    .map((p): PackHere | undefined => {
      const file = byId.get(p.id);
      const review = file === undefined ? undefined : packReview(file.json);
      if (file === undefined || review === undefined) return undefined;
      return {
        id: p.id,
        fileName: file.fileName,
        enabled: file.enabled,
        review,
        guidance: p.guidance,
        ...(p.local === undefined ? {} : { local: p.local }),
      };
    })
    .filter((p): p is PackHere => p !== undefined);
}

/** A stored file as last read for packs; `pack` is null when it holds none, so its content is not kept. */
type ReadFile = { version: string; pack: HomebrewFile | null };
/** Which content a file is: when it was added and its revision, as a file deleted and added again is a new one. */
const versionOf = (f: Pick<HomebrewFileMeta, 'addedAt' | 'rev'>) => `${f.addedAt}:${f.rev ?? 0}`;

/**
 * The rule packs among the files listed, read from their content. Only a file
 * stored whole can be a pack (a converted compendium's books never are), so
 * the books are never read for this. A file is read again only when its
 * content moves; switching one on or off reads nothing. Undefined until first
 * read. A file that cannot be read is left out, as the page reports it on its
 * own.
 */
export function usePacksHere(
  rows: readonly HomebrewFileMeta[] | undefined,
): PackHere[] | undefined {
  const key =
    rows === undefined
      ? undefined
      : JSON.stringify(
          rows.filter((r) => r.book === undefined).map((r) => [r.id, versionOf(r), r.enabled]),
        );
  const [read, setRead] = useState<{ key: string; packs: PackHere[] }>();
  // Each file's last read, by id, for as long as the page is open.
  const cache = useRef(new Map<string, ReadFile>());
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    const readFiles = cache.current;
    const wanted = JSON.parse(key) as Array<[string, string, boolean]>;
    void (async () => {
      const files: HomebrewFile[] = [];
      for (const [id, version, enabled] of wanted) {
        let known = readFiles.get(id);
        if (known?.version !== version) {
          try {
            const { file } = await homebrewRepo.getSafe(id);
            if (file === undefined) continue;
            known = {
              version: versionOf(file),
              pack: packGuidance(file.json) === undefined ? null : file,
            };
            readFiles.set(id, known);
          } catch {
            // Unreadable: the page lists it among the files that could not be read.
            continue;
          }
        }
        if (known.pack !== null) files.push({ ...known.pack, enabled });
      }
      // A file no longer here is not kept.
      const here = new Set(wanted.map(([id]) => id));
      for (const id of readFiles.keys()) if (!here.has(id)) readFiles.delete(id);
      if (live) setRead({ key, packs: packsHere(files) });
    })();
    return () => {
      live = false;
    };
  }, [key]);
  return read?.packs;
}

/** The characters here, by name, for Apply to. */
function useRoster(): Array<{ id: string; name: string }> {
  const roster = useLiveQuery(() => characterRepo.listSafe().catch(() => ({ characters: [] })), []);
  return (roster?.characters ?? []).map((c) => ({ id: c.id, name: c.name || 'Unnamed' }));
}

/**
 * Write who a stored pack applies to, or its place. The file keeps its id, so
 * the block stays bound to it; the revision moves, so the registry rebuilds.
 */
export async function savePackLocal(
  id: string,
  change: (local: PackLocal) => PackLocal,
): Promise<void> {
  const { file, error } = await homebrewRepo.getSafe(id);
  if (file === undefined)
    throw new Error(error?.message ?? 'that pack is no longer on this device');
  const now = packLocal(file.json, id) ?? { file: id, appliesTo: { characters: [] } };
  await homebrewRepo.saveEditable(id, withPackLocal(file.json, { ...change(now), file: id }));
  invalidateRegistry();
}

function Rows({ heading, rows }: { heading: string; rows: readonly PackReviewRow[] }) {
  if (rows.length === 0) return null;
  return (
    <PreviewSection heading={heading}>
      <dl className="flex flex-col divide-y divide-line overflow-hidden rounded-control bg-surface ring-1 ring-line ring-inset">
        {rows.map((r, i) => (
          // Two rows can say the same: a pack may hold a moment twice.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed while shown
          <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
            <dt className="min-w-0 text-body-strong wrap-anywhere">{r.key}</dt>
            <dd className="min-w-0 text-ink-muted wrap-anywhere">{r.value}</dd>
          </div>
        ))}
      </dl>
    </PreviewSection>
  );
}

/** What a pack holds, in the review's three sections, and what does not count. */
export function PackDetails({ review }: { review: PackReview }) {
  const empty =
    review.rules.length === 0 && review.changes.length === 0 && review.moments.length === 0;
  return (
    <>
      {review.refusals.length > 0 && (
        <PreviewSection heading="Cannot be added">
          <p className="text-ink-muted">
            It goes past what a rule pack may hold, so nothing in it applies:
          </p>
          <PreviewList>
            {review.refusals.map((r) => (
              <StatusItem key={r} tone="warn">
                {r}.
              </StatusItem>
            ))}
          </PreviewList>
        </PreviewSection>
      )}
      <Rows heading="Rules" rows={review.rules} />
      <Rows heading="Changes to entries" rows={review.changes} />
      <Rows heading="Moments" rows={review.moments} />
      {empty && review.refusals.length === 0 && (
        <p className="text-ink-muted">It holds nothing the app reads yet.</p>
      )}
      {review.problems.length > 0 && (
        <PreviewSection heading="What the app cannot read">
          <p className="text-ink-muted">These parts do nothing; the rest still applies.</p>
          <PreviewList>
            {review.problems.slice(0, 10).map((p) => (
              <StatusItem key={p} tone="info">
                {p}
              </StatusItem>
            ))}
          </PreviewList>
          {review.problems.length > 10 && (
            <p className="text-ink-muted">And {review.problems.length - 10} more.</p>
          )}
        </PreviewSection>
      )}
    </>
  );
}

type Reach = 'every' | 'choose';

/**
 * Apply to: every character, or the ones chosen. Every character makes its
 * table rules the app's default, under a choice made in Settings; chosen
 * characters get them over the app's.
 */
export function ApplyTo({
  value,
  onChange,
}: {
  value: PackAppliesTo;
  onChange: (next: PackAppliesTo) => void;
}) {
  const roster = useRoster();
  const hint = useId();
  const reach: Reach = value.appDefault === true ? 'every' : 'choose';
  const chosen = new Set(value.characters);
  // The characters chosen, kept while Every character is picked, for Choose to bring back.
  const [kept, setKept] = useState<readonly string[]>(value.characters);
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const characters = roster.map((c) => c.id).filter((c) => next.has(c));
    setKept(characters);
    onChange({ characters });
  };
  return (
    <PreviewSection heading="Apply to">
      <SegmentedControl
        label="Apply to"
        block
        describedBy={hint}
        options={[
          { value: 'every', label: 'Every character' },
          { value: 'choose', label: 'Choose' },
        ]}
        value={reach}
        onChange={(next) => {
          if (next === reach) return;
          if (next === 'every') {
            setKept(value.characters);
            onChange({ characters: [], appDefault: true });
          } else onChange({ characters: [...kept] });
        }}
      />
      <p id={hint} className="text-caption text-ink-muted">
        {reach === 'every'
          ? 'Its rules become the app’s, under any you set in Settings.'
          : 'Its rules win over the app’s for these characters.'}
      </p>
      {reach === 'choose' &&
        (roster.length === 0 ? (
          <p className="text-ink-muted">No characters yet. Choose Every character to use it.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {roster.map((c) => (
              <Chip
                key={c.id}
                tone="outline"
                pressed={chosen.has(c.id)}
                onClick={() => toggle(c.id)}
              >
                {c.name}
              </Chip>
            ))}
          </div>
        ))}
    </PreviewSection>
  );
}

/** True when a pack applied this way reaches someone. */
export const appliesToAnyone = (to: PackAppliesTo): boolean =>
  to.appDefault === true || to.characters.length > 0;

/** The clash lines for one pack, worded from its side or as the page says them. */
export function clashLines(
  packs: readonly PackInPlay[],
  id: string,
  incoming: boolean,
  app: AppTableRules = {},
): string[] {
  const lines = packConflicts(packs, app)
    .filter((c) => c.ids.includes(id))
    .map((c) => (incoming ? describeIncomingConflict(c, id) : describeConflict(c)));
  // Two packs may share a name, so two clashes can read the same: each is said once.
  return [...new Set(lines)];
}

/**
 * A pack's review from the Homebrew page: what it holds, its clashes, its
 * Apply to, and turning it on or off. A changed Apply to is saved on closing.
 */
export function PackReviewSheet({
  pack,
  packs,
  onToggle,
  onClose,
}: {
  pack: PackHere;
  /** Every pack here, in order, for the clashes. */
  packs: readonly PackHere[];
  onToggle: () => void;
  onClose: () => void;
}) {
  // A pack never applied here starts at nobody, so closing the sheet applies it to no one.
  // Kept as the sheet opened: a read of the pack while it is open changes neither.
  const [start] = useState<PackAppliesTo>(() => pack.local?.appliesTo ?? { characters: [] });
  const [appliesTo, setAppliesTo] = useState<PackAppliesTo>(start);
  const changed = JSON.stringify(appliesTo) !== JSON.stringify(start);
  const app = useAppTableRules();
  const refused = pack.review.refusals.length > 0;
  const close = (then?: () => void) => {
    onClose();
    if (changed && !refused) {
      void savePackLocal(pack.id, (local) => ({ ...local, appliesTo }))
        .then(then)
        .catch((err: unknown) => notifyFailure('Apply to', err));
    } else then?.();
  };
  const clashes = clashLines(
    packs
      .filter((p) => p.enabled || p.id === pack.id)
      .map((p) => (p.id === pack.id ? inPlay(p, appliesTo) : inPlay(p))),
    pack.id,
    false,
    app,
  );
  const toggle = { label: pack.enabled ? 'Turn off' : 'Turn on', onClick: () => close(onToggle) };
  const done = { label: 'Done', onClick: () => close() };
  return (
    <ImportPreviewDialog
      title={pack.review.name}
      description={PACK_SAFE_LINE}
      onDismiss={() => close()}
      actions={
        pack.enabled ? [toggle, { ...done, primary: true }] : [done, { ...toggle, primary: true }]
      }
    >
      {clashes.length > 0 && pack.enabled && (
        <PreviewList>
          {clashes.map((c) => (
            <StatusItem key={c} tone="warn">
              {c}
            </StatusItem>
          ))}
        </PreviewList>
      )}
      <PackDetails review={pack.review} />
      {!refused && <ApplyTo value={appliesTo} onChange={setAppliesTo} />}
      {!refused && !appliesToAnyone(appliesTo) && (
        <p className="text-ink-muted">Choose a character, or it applies to nobody.</p>
      )}
    </ImportPreviewDialog>
  );
}

/**
 * The packs in the player's order, to move. Where two set the same thing, the
 * later one wins, as the banner says.
 */
export function PackOrderSheet({
  packs,
  onClose,
}: {
  packs: readonly PackHere[];
  onClose: () => void;
}) {
  const [order, setOrder] = useState(() => packs.map((p) => p.id));
  const byId = new Map(packs.map((p) => [p.id, p]));
  const move = (i: number, by: -1 | 1) => {
    const next = [...order];
    const [moved] = next.splice(i, 1);
    if (moved === undefined) return;
    next.splice(i + by, 0, moved);
    setOrder(next);
  };
  const save = async () => {
    onClose();
    try {
      for (const [place, id] of order.entries()) {
        if (byId.get(id)?.local?.order === place) continue;
        await savePackLocal(id, (local) => ({ ...local, order: place }));
      }
    } catch (err) {
      notifyFailure('Pack order', err);
    }
  };
  return (
    <ImportPreviewDialog
      title="Pack order"
      description="Where two packs set the same thing, the one later in this list wins."
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onClick: onClose },
        { label: 'Save', onClick: () => void save(), primary: true },
      ]}
    >
      <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-control bg-surface ring-1 ring-line ring-inset">
        {order.map((id, i) => {
          const p = byId.get(id);
          if (p === undefined) return null;
          return (
            <li key={id} className="flex items-center gap-2 px-3 py-1">
              <span className="w-5 shrink-0 text-caption text-ink-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-strong">{p.review.name}</span>
                <span className="block truncate text-caption text-ink-muted">
                  {p.enabled ? p.review.holds : 'Turned off'}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Move ${p.review.name} up`}
                aria-disabled={i === 0 ? true : undefined}
                onClick={i === 0 ? undefined : () => move(i, -1)}
                className="tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink aria-disabled:opacity-40"
              >
                <ArrowUp size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Move ${p.review.name} down`}
                aria-disabled={i === order.length - 1 ? true : undefined}
                onClick={i === order.length - 1 ? undefined : () => move(i, 1)}
                className="tap shrink-0 rounded-control text-ink-muted hover:bg-surface-raised hover:text-ink aria-disabled:opacity-40"
              >
                <ArrowDown size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </ImportPreviewDialog>
  );
}
