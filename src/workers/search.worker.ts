import MiniSearch from 'minisearch';
import type {
  SearchDoc,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '@/data5e/search/protocol';
import { SEARCH_FIELDS, STORE_FIELDS } from '@/data5e/search/protocol';

const options = {
  fields: [...SEARCH_FIELDS],
  storeFields: [...STORE_FIELDS],
  searchOptions: { prefix: true, fuzzy: 0.15 },
};

let index: MiniSearch<SearchDoc> | null = null;

const post = (msg: SearchWorkerResponse) => postMessage(msg);

onmessage = (ev: MessageEvent<SearchWorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.kind) {
      case 'load':
        index = MiniSearch.loadJSON<SearchDoc>(msg.serialized, options);
        post({ kind: 'ready' });
        break;
      case 'build':
        index = new MiniSearch<SearchDoc>(options);
        index.addAll(msg.docs);
        post({ kind: 'ready', serialized: JSON.stringify(index) });
        break;
      case 'query': {
        const hits =
          index === null
            ? []
            : (index.search(msg.q).slice(0, msg.limit ?? 30) as unknown as Array<
                SearchDoc & { score: number }
              >);
        post({
          kind: 'results',
          id: msg.id,
          hits: hits.map((h) => ({
            id: h.id,
            type: h.type,
            uid: h.uid,
            name: h.name,
            source: h.source,
          })),
        });
        break;
      }
    }
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
