/**
 * Another app's XML into homebrew JSON, for the import page. Loaded only when
 * an import turns out to be XML (see `importText.ts`). The conversion runs on
 * a worker (`src/workers/import.worker.ts`), which reads the file as it
 * streams, so a compendium of tens of megabytes neither freezes the page nor
 * has to fit in it whole.
 *
 * Entries the installed game data already has are left out: the installed copy
 * carries the app's curated mechanics, and a second one in every picker is
 * noise. What counts as installed is the official part of the registry, read
 * by name and rules edition, and sent to the worker as plain keys.
 */
import type { ImportJobMessage, ImportJobRequest } from '@/convert/importJob';
import { type OfficialKeys, officialKeys } from '@/convert/official';
import type { ConversionResult } from '@/convert/types';
import { getRegistry } from '@/data5e/registry';
import { dataStatusStore } from '@/stores/dataStatus';
import { ImportCancelledError } from './importText';

/** How far a conversion has read, in bytes or characters across both of its reads. */
export type ImportProgress = (done: number, total: number) => void;

/**
 * Convert an XML import against the game data on this device. A registry that
 * cannot be read converts everything; so does data still downloading, for an
 * entry it has not reached yet. `coverage` says which, for the report of a
 * file that converts anything: it is about the entries converted, so it says
 * nothing about one where every entry was already installed.
 */
export async function convertImportXml(
  source: Blob | string,
  fileName: string,
  { onProgress, signal }: { onProgress?: ImportProgress; signal?: AbortSignal } = {},
): Promise<{ result: ConversionResult; coverage?: string }> {
  // Read before the registry, as `loadOfficialIndex` does: a pack landing in
  // between must not count as checked.
  const complete = dataStatusStore.getState().phase === 'done';
  let official: OfficialKeys | undefined;
  try {
    official = officialKeys(await getRegistry());
  } catch {
    official = undefined;
  }
  const request: ImportJobRequest =
    official === undefined ? { source, fileName } : { source, fileName, official };
  const result = await runOnWorker(request, onProgress, signal);
  if (official === undefined) {
    return {
      result,
      coverage: 'Game data could not be read, so entries it already has were converted as well.',
    };
  }
  if (!complete) {
    return {
      result,
      coverage:
        'Not all game data is on this device yet, so entries it does not have yet were converted as well.',
    };
  }
  return { result };
}

function runOnWorker(
  request: ImportJobRequest,
  onProgress: ImportProgress | undefined,
  signal: AbortSignal | undefined,
): Promise<ConversionResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new ImportCancelledError());
      return;
    }
    const worker = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    const end = () => {
      worker.terminate();
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      end();
      reject(new ImportCancelledError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (ev: MessageEvent<ImportJobMessage>) => {
      const message = ev.data;
      if (message.kind === 'progress') {
        onProgress?.(message.done, message.total);
        return;
      }
      end();
      if (message.kind === 'done') resolve(message.result);
      else reject(Object.assign(new Error(message.message), { name: message.name }));
    };
    // A worker that dies without a word (out of memory, most likely) says
    // nothing more than that.
    worker.onerror = (ev) => {
      ev.preventDefault();
      end();
      reject(
        new Error(
          'The file could not be converted: the converter stopped, most likely because the device ran out of memory.',
        ),
      );
    };
    worker.postMessage(request);
  });
}
