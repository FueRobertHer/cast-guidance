// Relative, not `@/`: scripts/data-audit.ts runs this module under plain Bun,
// which does not see the app's path alias.
import { ResponseTooLargeError, readJsonBounded } from '../lib/boundedRead';
import { ENDPOINTS, type Endpoint, FETCH_TIMEOUT_MS, MAX_DATA_FILE_BYTES } from './config';

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
  /** Decoded bytes one file may have before it is refused unparsed. */
  maxBytes?: number;
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

/** Only an explicit `false` counts: Bun (the data audit) has no `onLine` at all. */
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Fetches files of a pinned 5etools release tag with endpoint failover + retry. */
export class GithubTagSource implements DataSource {
  readonly id: string;
  readonly kind = 'official' as const;
  readonly tag: string;
  private readonly endpoints: Endpoint[];
  private readonly fetchImpl: typeof fetch;
  private readonly triesPerEndpoint: number;
  private readonly backoffMs: number;
  private readonly maxBytes: number;

  constructor(tag: string, opts: GithubTagSourceOptions = {}) {
    this.tag = tag;
    this.id = `official@${tag}`;
    this.endpoints = opts.endpoints ?? ENDPOINTS;
    // Bind: calling an unbound `fetch` through a property rebinds `this` and
    // throws "Illegal invocation" in browsers.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.triesPerEndpoint = opts.triesPerEndpoint ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
    this.maxBytes = opts.maxBytes ?? MAX_DATA_FILE_BYTES;
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
          return await readJsonBounded(res, this.maxBytes);
        } catch (err) {
          failures.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
          // The same endpoint will send the same oversized body again, so a
          // retry only spends another download on it. The mirror is worth
          // asking: one CDN copy gone wrong is not the release gone wrong.
          if (err instanceof ResponseTooLargeError) break;
          // A device that says it is offline will not have a network a moment
          // from now either, so the backoff retries only make the page that is
          // waiting wait longer for the same answer. The next endpoint still
          // gets its one try: `onLine` can be wrong (a captive portal, a
          // blocked CDN), and the failover is what reaches the mirror then.
          if (isOffline()) break;
          if (attempt < this.triesPerEndpoint) await sleep(this.backoffMs * attempt);
        }
      }
    }
    throw new DataFetchError(path, isOffline() ? [...failures, 'the device is offline'] : failures);
  }
}
