import MiniSearch from 'minisearch';
import type {
  SearchDoc,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from '@/data5e/search/protocol';
import { pageAllowedHits, SEARCH_FIELDS, STORE_FIELDS } from '@/data5e/search/protocol';

const options = {
  fields: [...SEARCH_FIELDS],
  storeFields: [...STORE_FIELDS],
  searchOptions: { prefix: true, fuzzy: 0.15 },
};

let index: MiniSearch<SearchDoc> | null = null;

const post = (msg: SearchWorkerResponse) => postMessage(msg);

self.onmessage = (ev: MessageEvent<SearchWorkerRequest>) => {
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
        const ranked =
          index === null
            ? []
            : (index.search(msg.q) as unknown as Array<SearchDoc & { score: number }>);
        // Filters the whole ranked list before taking a page; see pageAllowedHits.
        const { hits, hiddenCount } = pageAllowedHits(ranked, msg.sources, msg.limit ?? 30);
        post({ kind: 'results', id: msg.id, hits, hiddenCount });
        break;
      }
    }
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
