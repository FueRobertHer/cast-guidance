import { db } from '@/db/db';
import { getActiveTag } from '../loader';
import type { EntityRegistry, EntityType } from '../normalize';
import type { SearchDoc, SearchWorkerRequest, SearchWorkerResponse } from './protocol';

/** Types worth surfacing in global search. */
const SEARCHABLE: EntityType[] = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'spell',
  'class',
  'subclass',
  'condition',
  'disease',
  'status',
  'action',
  'skill',
  'sense',
  'language',
  'variantrule',
  'book',
];

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let indexedSignature = '';
let queryId = 0;
const pending = new Map<number, (hits: SearchDoc[]) => void>();

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<SearchWorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'results') {
        pending.get(msg.id)?.(msg.hits);
        pending.delete(msg.id);
      }
    };
  }
  return worker;
}

function send(msg: SearchWorkerRequest): void {
  getWorker().postMessage(msg);
}

function docsFrom(registry: EntityRegistry): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const seen = new Set<string>();
  for (const type of SEARCHABLE) {
    for (const e of registry.byType(type)) {
      const name = typeof e.name === 'string' ? e.name : undefined;
      const source = typeof e.source === 'string' ? e.source : '?';
      if (name === undefined) continue;
      const uid = `${name}|${source}`.toLowerCase();
      const id = `${type}:${uid}`;
      if (seen.has(id)) continue;
      seen.add(id);
      docs.push({ id, type, uid, name, source });
    }
  }
  return docs;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Build (or rehydrate) the index for the given registry + cache signature. */
export async function ensureSearchIndex(
  registry: EntityRegistry,
  signature: string,
): Promise<void> {
  if (signature === indexedSignature && readyPromise !== null) return readyPromise;
  indexedSignature = signature;
  const key = `${getActiveTag()}|official|${hashString(signature)}`;

  readyPromise = (async () => {
    const w = getWorker();
    const cached = await db.searchIndexes.get(key);
    const done = new Promise<string | undefined>((resolve) => {
      const onReady = (ev: MessageEvent<SearchWorkerResponse>) => {
        if (ev.data.kind === 'ready') {
          w.removeEventListener('message', onReady);
          resolve(ev.data.serialized);
        } else if (ev.data.kind === 'error') {
          w.removeEventListener('message', onReady);
          resolve(undefined);
        }
      };
      w.addEventListener('message', onReady);
    });
    if (cached) {
      send({ kind: 'load', serialized: cached.json });
      await done;
    } else {
      send({ kind: 'build', docs: docsFrom(registry) });
      const serialized = await done;
      if (serialized !== undefined) {
        // Keep only the latest index for this tag.
        await db.searchIndexes.where('key').startsWith(`${getActiveTag()}|official|`).delete();
        await db.searchIndexes.put({ key, json: serialized });
      }
    }
  })();
  return readyPromise;
}

export async function searchAll(q: string, limit = 30): Promise<SearchDoc[]> {
  if (readyPromise === null) return [];
  await readyPromise;
  return new Promise((resolve) => {
    const id = ++queryId;
    pending.set(id, resolve);
    send({ kind: 'query', id, q, limit });
  });
}
