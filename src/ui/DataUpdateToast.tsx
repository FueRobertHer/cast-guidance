import { useState } from 'react';
import { getActiveTag, updateToTag } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { dataStatusStore, useDataStatus } from '@/stores/dataStatus';

/** Shows once a boot-time check finds a newer compatible data tag than the installed one. */
export function DataUpdateToast() {
  const tag = useDataStatus((s) => s.updateAvailableTag);
  const [dismissed, setDismissed] = useState<string>();

  if (tag === undefined || tag === dismissed) return null;

  const install = () => {
    // Clear immediately so this toast steps aside for the DataBanner, which
    // shows install progress (and any failure) at the same fixed position.
    dataStatusStore.getState().setUpdateAvailableTag(undefined);
    void updateToTag(tag)
      .then(() => invalidateRegistry())
      .catch((err: unknown) => {
        dataStatusStore
          .getState()
          .setPhase('error', err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <div className="fixed inset-x-4 top-3 z-40 flex items-center justify-between gap-3 rounded-lg border border-surface-2 bg-surface/95 px-4 py-2.5 text-xs shadow-lg backdrop-blur lg:left-auto lg:right-6 lg:w-96">
      <span className="truncate">
        Game data {tag} is available (current: {getActiveTag()}).
      </span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={install}
          className="rounded bg-accent px-2 py-0.5 font-semibold"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setDismissed(tag)}
          className="rounded bg-surface-2 px-2 py-0.5"
        >
          Later
        </button>
      </div>
    </div>
  );
}
