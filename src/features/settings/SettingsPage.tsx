import { useEffect, useState } from 'react';
import { getActiveTag, listAvailableTags, updateToTag, verifyFullOffline } from '@/data5e/loader';
import { invalidateRegistry } from '@/data5e/registry';
import { useDataStatus } from '@/stores/dataStatus';
import { askConfirm } from '@/ui/dialogs';

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
  const filesDone = useDataStatus((s) => s.filesDone);
  const filesTotal = useDataStatus((s) => s.filesTotal);
  const [offline, setOffline] = useState<{ cached: number; total: number }>();
  const [tags, setTags] = useState<string[] | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string>();
  const estimate = useStorageEstimate();

  useEffect(() => {
    void verifyFullOffline()
      .then(setOffline)
      .catch(() => undefined);
  }, []);

  const offlineReady = offline !== undefined && offline.cached === offline.total;

  const runUpdate = async (tag: string) => {
    const ok = await askConfirm({
      title: `Install data version ${tag}?`,
      detail: 'The current version stays until the new one downloads and passes checks (~2.5 MB).',
      confirmLabel: 'Install',
    });
    if (!ok) return;
    setUpdating(true);
    setUpdateMsg(undefined);
    try {
      await updateToTag(tag);
      invalidateRegistry();
      setUpdateMsg(`Now on ${tag}. Characters re-derive automatically.`);
      setTags(null);
      void verifyFullOffline().then(setOffline);
    } catch (err) {
      setUpdateMsg(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Game data</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-ink-muted">Dataset version</dt>
          <dd>{getActiveTag()}</dd>
          <dt className="text-ink-muted">Download queue</dt>
          <dd className="capitalize">
            {phase}
            {updating && filesTotal > 0 ? ` (${filesDone}/${filesTotal})` : ''}
          </dd>
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

        {tags === null ? (
          <button
            type="button"
            disabled={updating}
            onClick={() => {
              void listAvailableTags()
                .then(setTags)
                .catch((err: unknown) =>
                  setUpdateMsg(
                    `Could not list versions: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
            }}
            className="w-fit rounded-lg bg-surface px-3 py-2 text-sm font-semibold disabled:opacity-40"
          >
            Check for data updates
          </button>
        ) : tags.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No compatible data versions available. Newer releases with a different schema are not
            shown because this app build cannot read them safely.
          </p>
        ) : (
          <div className="flex flex-col gap-1 rounded-lg bg-surface p-2">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                disabled={updating || t === getActiveTag()}
                onClick={() => void runUpdate(t)}
                className={`rounded px-3 py-1.5 text-left text-sm ${
                  t === getActiveTag()
                    ? 'bg-accent-deep/40 font-semibold'
                    : 'hover:bg-surface-2 disabled:opacity-40'
                }`}
              >
                {t}
                {t === getActiveTag() ? ' (installed)' : ''}
              </button>
            ))}
          </div>
        )}
        {updateMsg !== undefined && <p className="text-xs text-amber-300">{updateMsg}</p>}
        <p className="text-xs text-ink-muted">
          Game data is downloaded from the 5etools mirror and cached on this device. Nothing ships
          with the app itself. Characters store name references, so they survive data updates.
        </p>
      </section>
    </main>
  );
}
