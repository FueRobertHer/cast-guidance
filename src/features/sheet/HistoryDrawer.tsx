import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { historyRepo } from '@/db/historyRepo';
import { contentKey, diffDocs, summarizeChanges } from '@/lib/docDiff';
import { characterSessionStore, useCharacterSession } from '@/stores/characterSession';
import { Sheet } from '@/ui/sheet';

function timeLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/**
 * Version history: every change is snapshotted; any state can be restored.
 * Restore is never one tap (UX-005): an entry first previews what restoring it
 * would change, measured against the character as it is on screen right now
 * rather than the newest entry, which can lag an edit still waiting to save.
 */
export function HistoryDrawer({ charId }: { charId: string }) {
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const sessionDoc = useCharacterSession((s) => s.doc);
  // For a render after a route change the session can still hold the last character.
  const current = sessionDoc?.id === charId ? sessionDoc : null;
  /**
   * Only while the drawer is open. This is mounted on every tab of every
   * character, and a live query re-runs whenever the table it read changes,
   * so leaving it on meant every autosave re-read the fifty kept snapshots
   * and re-rendered a list nobody was looking at. Each snapshot is a whole
   * character document, which is cheap enough to shrug at on a desktop and
   * is not on a phone.
   *
   * `undefined` is "not asked yet", which is what separates the closed state
   * and the first frame after opening from a character that genuinely has no
   * history.
   */
  const rows = useLiveQuery(
    () => (open ? historyRepo.list(charId) : undefined),
    [charId, open],
    undefined,
  );
  // Which entries already match the character, so they offer no Restore.
  // Rows never change once written except the newest, so each row's key is
  // kept until its time stamp moves rather than rebuilt for all fifty on every
  // re-read.
  const keys = useRef(new Map<string, { at: number; key: string }>());
  const matching = useMemo(() => {
    if (rows === undefined || current === null) return new Set<string>();
    const now = contentKey(current);
    const cache = keys.current;
    const out = new Set<string>();
    for (const r of rows) {
      let hit = cache.get(r.id);
      if (hit?.at !== r.at) {
        hit = { at: r.at, key: contentKey(r.doc) };
        cache.set(r.id, hit);
      }
      if (hit.key === now) out.add(r.id);
    }
    return out;
  }, [rows, current]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setPreviewing(null);
  };

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Trigger asChild>
        <button
          type="button"
          aria-label="Character history"
          title="Character history: restore any earlier state"
          className="rounded p-2 text-ink-muted hover:text-ink"
        >
          <History size={18} />
        </button>
      </Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Sheet.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-2" />
          <Sheet.Title className="mb-1 text-base font-semibold">History</Sheet.Title>
          <p className="mb-2 text-xs text-ink-muted">
            Every change is saved automatically (last 50), and a quick run of the same kind of edit
            is kept as one entry. Preview an entry to see what restoring it would change; restoring
            adds a new entry, so you can always come back.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows === undefined && <p className="text-sm text-ink-muted">Loading…</p>}
            {rows?.length === 0 && (
              <p className="text-sm text-ink-muted">No history yet. Make a change first.</p>
            )}
            {rows?.map((row) => {
              const same = matching.has(row.id);
              const expanded = !same && previewing === row.id && current !== null;
              const panelId = `history-preview-${row.id}`;
              return (
                <div
                  key={row.id}
                  className="border-b border-surface-2/40 py-2 text-sm last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{row.label}</div>
                      <div className="text-xs text-ink-muted">{timeLabel(row.at)}</div>
                    </div>
                    {same ? (
                      <span className="shrink-0 text-xs text-emerald-300">same as now</span>
                    ) : current === null ? null : (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? panelId : undefined}
                        aria-label={`Preview "${row.label}" from ${timeLabel(row.at)}`}
                        onClick={() => setPreviewing(expanded ? null : row.id)}
                        className="shrink-0 rounded border border-surface-2 px-2.5 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
                      >
                        Preview
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <div id={panelId} className="mt-2 rounded bg-surface-2/40 p-2">
                      <p className="text-xs text-ink-muted">Restoring this changes:</p>
                      <ul className="my-1 list-disc pl-5 text-xs">
                        {summarizeChanges(diffDocs(current, row.doc)).map((line, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: lines can repeat, and the list is rebuilt whole
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        aria-label={`Restore "${row.label}" from ${timeLabel(row.at)}`}
                        onClick={async () => {
                          const session = characterSessionStore.getState();
                          // Save an edit still waiting on the debounce first, so
                          // the state being replaced is in history to come back to.
                          await session.flush().catch(() => undefined);
                          session.restore(row.doc);
                          onOpenChange(false);
                        }}
                        className="mt-1 rounded bg-accent-fill px-2.5 py-1 text-xs font-semibold text-white"
                      >
                        Restore
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
