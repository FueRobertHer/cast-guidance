import { useState } from 'react';
import { getActiveTag, updateToTag } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { dataStatusStore, showsDataBanner, useDataStatus } from '@/stores/dataStatus';

/** Shows once a boot-time check finds a newer compatible data tag than the installed one. */
export function DataUpdateToast() {
  const tag = useDataStatus((s) => s.updateAvailableTag);
  const banner = useDataStatus(showsDataBanner);
  const [dismissed, setDismissed] = useState<string>();

  // The banner holds this position, and the offer waits its turn. Knowing about
  // a release early is the point of checking at boot; interrupting the download
  // of the version already installed to advertise a different one is not, and
  // installing on top of a queue still fetching under the old tag is how the
  // two ended up racing for the same rows. Nothing is lost by waiting: the
  // answer is already in the store, and the queue either finishes or reports
  // why it could not.
  if (tag === undefined || tag === dismissed || banner) return null;

  const install = () => {
    // Clear immediately so this toast steps aside for the DataBanner, which
    // shows install progress (and any failure) at the same fixed position.
    dataStatusStore.getState().setUpdateAvailableTag(undefined);
    void updateToTag(tag)
      .then(() => invalidateRegistry())
      // The loader has already recorded the failure and the tag it belongs to,
      // which is what lets the banner offer to retry this install.
      .catch(() => undefined);
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
