import { ENDPOINTS, type Endpoint, FETCH_TIMEOUT_MS } from './config';

export interface DataSource {
  id: string;
  kind: 'official' | 'homebrew';
  /** Fetch and parse one JSON file, e.g. "races.json" or "class/class-fighter.json". */
  fetchFile(path: string): Promise<unknown>;
}

export interface GithubTagSourceOptions {
  endpoints?: Endpoint[];
  fetchImpl?: typeof fetch;
  /** Attempts per endpoint before moving to the next. */
  triesPerEndpoint?: number;
  backoffMs?: number;
}

export class DataFetchError extends Error {
  readonly path: string;

  constructor(path: string, causes: string[]) {
    super(`failed to fetch "${path}": ${causes.join('; ')}`);
    this.name = 'DataFetchError';
    this.path = path;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetches files of a pinned 5etools release tag with endpoint failover + retry. */
export class GithubTagSource implements DataSource {
  readonly id: string;
  readonly kind = 'official' as const;
  readonly tag: string;
  private readonly endpoints: Endpoint[];
  private readonly fetchImpl: typeof fetch;
  private readonly triesPerEndpoint: number;
  private readonly backoffMs: number;

  constructor(tag: string, opts: GithubTagSourceOptions = {}) {
    this.tag = tag;
    this.id = `official@${tag}`;
    this.endpoints = opts.endpoints ?? ENDPOINTS;
    // Bind: calling an unbound `fetch` through a property rebinds `this` and
    // throws "Illegal invocation" in browsers.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.triesPerEndpoint = opts.triesPerEndpoint ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
  }

  async fetchFile(path: string): Promise<unknown> {
    const failures: string[] = [];
    for (const endpoint of this.endpoints) {
      const url = endpoint(this.tag, path);
      for (let attempt = 1; attempt <= this.triesPerEndpoint; attempt++) {
        try {
          const res = await this.fetchImpl(url, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok) {
            failures.push(`${url} -> HTTP ${res.status}`);
            // 404 at one endpoint will 404 at the mirror too, but endpoints can
            // lag right after a tag is published — still worth the failover.
            break;
          }
          return await res.json();
        } catch (err) {
          failures.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
          if (attempt < this.triesPerEndpoint) await sleep(this.backoffMs * attempt);
        }
      }
    }
    throw new DataFetchError(path, failures);
  }
}
