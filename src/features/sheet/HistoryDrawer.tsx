import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { historyRepo } from '@/db/historyRepo';
import { characterSessionStore } from '@/stores/characterSession';
import { Sheet } from '@/ui/sheet';

function timeLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** Version history: every change is snapshotted; any state can be restored. */
export function HistoryDrawer({ charId }: { charId: string }) {
  // Through the repo, which already had this exact query (REL-006). The copy
  // here was the last live query in the app reaching past it into Dexie, and a
  // second copy of a read is a second place for it to drift.
  const rows = useLiveQuery(() => historyRepo.list(charId), [charId], []);

  return (
    <Sheet.Root>
      <Sheet.Trigger asChild>
        <button
          type="button"
          title="Character history — restore any earlier state"
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
            Every change is saved automatically (last 50). Restoring creates a new entry, so you can
            always come back.
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 && (
              <p className="text-sm text-ink-muted">No history yet — make a change first.</p>
            )}
            {rows.map((row, i) => (
              <div
                key={row.id}
                className="flex items-center gap-2 border-b border-surface-2/40 py-2 text-sm last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">{row.label}</div>
                  <div className="text-xs text-ink-muted">{timeLabel(row.at)}</div>
                </div>
                {i === 0 ? (
                  <span className="shrink-0 text-xs text-emerald-300">current</span>
                ) : (
                  <Sheet.Close asChild>
                    <button
                      type="button"
                      onClick={() => characterSessionStore.getState().restore(row.doc)}
                      className="shrink-0 rounded border border-surface-2 px-2.5 py-1 text-xs font-semibold hover:border-accent hover:text-accent"
                    >
                      Restore
                    </button>
                  </Sheet.Close>
                )}
              </div>
            ))}
          </div>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
