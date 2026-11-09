/**
 * One XML import, converted where it runs: the body of the import worker
 * (`src/workers/import.worker.ts`), kept apart from the worker's own API so a
 * test can run it in place. The file is read twice as it streams (see
 * `convertXmlChunks`), and progress is said in bytes across both reads.
 */
import { convertXmlChunks } from './index';
import { type OfficialKeys, officialChecks } from './official';
import type { ConversionResult, ConvertOptions } from './types';

export interface ImportJobRequest {
  /** The file, read as it streams, or text already read (a URL's body). */
  source: Blob | string;
  fileName: string;
  /** What the game data holds. Left out when it could not be read, so everything converts. */
  official?: OfficialKeys;
}

export type ImportJobMessage =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'done'; result: ConversionResult }
  | { kind: 'error'; name: string; message: string };

/** Progress is said at most once per this many bytes or characters read. */
const STEP = 1 << 20;

export async function runImportJob(
  request: ImportJobRequest,
  post: (message: ImportJobMessage) => void,
): Promise<void> {
  const { source, fileName, official } = request;
  // Each of the converter's two passes reads the whole file.
  const total = (typeof source === 'string' ? source.length : source.size) * 2;
  let done = 0;
  let said = 0;
  const advance = (n: number) => {
    done += n;
    if (done - said >= STEP) {
      said = done;
      post({ kind: 'progress', done, total });
    }
  };
  const opts: ConvertOptions =
    official === undefined ? { fileName } : { fileName, ...officialChecks(official) };
  try {
    const result = await convertXmlChunks(
      () =>
        typeof source === 'string' ? textChunks(source, advance) : blobChunks(source, advance),
      opts,
    );
    post({ kind: 'done', result });
  } catch (err) {
    post({
      kind: 'error',
      name: err instanceof Error ? err.name : 'Error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function* textChunks(text: string, advance: (n: number) => void): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += STEP) {
    const chunk = text.slice(i, i + STEP);
    advance(chunk.length);
    yield chunk;
  }
}

/** A file's text as it streams, decoded as UTF-8; the read stops when the reader does. */
async function* blobChunks(blob: Blob, advance: (n: number) => void): AsyncGenerator<string> {
  // A browser too old to stream a file still has its text.
  if (typeof blob.stream !== 'function') {
    yield* textChunks(await blob.text(), advance);
    return;
  }
  const reader = blob.stream().getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      advance(value.byteLength);
      yield decoder.decode(value, { stream: true });
    }
    const rest = decoder.decode();
    if (rest !== '') yield rest;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
