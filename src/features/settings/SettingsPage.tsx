import { useEffect, useState } from 'react';
import { DATA_TAG } from '@/data5e/config';
import { verifyFullOffline } from '@/data5e/loader';
import { useDataStatus } from '@/stores/dataStatus';

function useStorageEstimate() {
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>();
  useEffect(() => {
    void navigator.storage
      ?.estimate?.()
      .then(setEstimate)
      .catch(() => undefined);
  }, []);
  return estimate;
}

const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function Component() {
  const phase = useDataStatus((s) => s.phase);
  const [offline, setOffline] = useState<{ cached: number; total: number }>();
  const estimate = useStorageEstimate();

  useEffect(() => {
    void verifyFullOffline()
      .then(setOffline)
      .catch(() => undefined);
  }, []);

  const offlineReady = offline !== undefined && offline.cached === offline.total;

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <h1 className="text-xl font-bold">Settings</h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Game data</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">Dataset version</dt>
          <dd>{DATA_TAG}</dd>
          <dt className="text-ink-muted">Download queue</dt>
          <dd className="capitalize">{phase}</dd>
          <dt className="text-ink-muted">Offline compendium</dt>
          <dd>
            {offline === undefined
              ? '…'
              : offlineReady
                ? 'ready ✓'
                : `${offline.cached}/${offline.total} files`}
          </dd>
          <dt className="text-ink-muted">Storage used</dt>
          <dd>
            {mb(estimate?.usage)} of {mb(estimate?.quota)}
          </dd>
        </dl>
        <p className="text-xs text-ink-muted">
          Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
          with the app itself.
        </p>
      </section>
    </main>
  );
}
