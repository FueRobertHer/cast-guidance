import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getActiveTag, updateToTag } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { announce } from '@/stores/announcer';
import { dataStatusStore, showsDataBanner, useDataStatus } from '@/stores/dataStatus';
import { Banner, BannerAction, BannerDismiss } from './Banner';

/** What the offer says, on screen and to a screen reader. */
export function dataUpdateText(tag: string, current: string): string {
  return `Game data ${tag} is available (current: ${current}).`;
}

/**
 * Shows once a boot-time check finds a newer compatible data tag than the installed one.
 * A `guide` banner (DS-001): something to do, in the page under the storage
 * banners rather than a card floating over the screen title.
 *
 * A plain visual: a region that mounts with its text is announced unreliably,
 * so the offer is said through the announcer instead (A11Y-002), once per tag,
 * under the key it shares with the app update offer.
 */
export function DataUpdateToast() {
  const tag = useDataStatus((s) => s.updateAvailableTag);
  const banner = useDataStatus(showsDataBanner);
  const [dismissed, setDismissed] = useState<string>();
  const [announced, setAnnounced] = useState<string>();
  const shown = tag !== undefined && tag !== dismissed && !banner;

  useEffect(() => {
    if (!shown || tag === announced) return;
    setAnnounced(tag);
    announce(dataUpdateText(tag, getActiveTag()), { key: 'update' });
  }, [shown, tag, announced]);

  // The banner holds this position, and the offer waits its turn. Knowing about
  // a release early is the point of checking at boot; interrupting the download
  // of the version already installed to advertise a different one is not, and
  // installing on top of a queue still fetching under the old tag is how the
  // two ended up racing for the same rows. Nothing is lost by waiting: the
  // answer is already in the store, and the queue either finishes or reports
  // why it could not.
  if (!shown) return null;

  const install = () => {
    // Clear immediately so this offer steps aside for the DataBanner, which
    // shows install progress (and any failure) in its place.
    dataStatusStore.getState().setUpdateAvailableTag(undefined);
    void updateToTag(tag)
      .then(() => invalidateRegistry())
      // The loader has already recorded the failure and the tag it belongs to,
      // which is what lets the banner offer to retry this install.
      .catch(() => undefined);
  };

  return (
    <Banner
      tone="guide"
      icon={Download}
      actions={
        <>
          <BannerAction tone="guide" onClick={install}>
            Update
          </BannerAction>
          <BannerDismiss tone="guide" label="Later" onClick={() => setDismissed(tag)} />
        </>
      }
    >
      {dataUpdateText(tag, getActiveTag())}
    </Banner>
  );
}
