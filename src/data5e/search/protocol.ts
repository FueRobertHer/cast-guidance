export interface SearchDoc {
  /** `${type}:${uid}` — unique across types. */
  id: string;
  type: string;
  uid: string;
  name: string;
  source: string;
}

export type SearchWorkerRequest =
  | { kind: 'load'; serialized: string }
  | { kind: 'build'; docs: SearchDoc[] }
  | { kind: 'query'; id: number; q: string; limit?: number };

export type SearchWorkerResponse =
  | { kind: 'ready'; serialized?: string }
  | { kind: 'results'; id: number; hits: SearchDoc[] }
  | { kind: 'error'; message: string };

export const SEARCH_FIELDS = ['name'] as const;
export const STORE_FIELDS = ['type', 'uid', 'name', 'source'] as const;
