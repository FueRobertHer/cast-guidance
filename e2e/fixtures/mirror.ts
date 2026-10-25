import type { BrowserContext, Route } from '@playwright/test';
import { VALID_BODIES } from '../../tests-fixtures/dataMirror.ts';

/** The release the app pins (`DATA_TAG` in `src/data5e/config.ts`). */
export const PINNED_TAG = 'v2.32.0';

/** Every file of the fixture release, which a full install fetches. */
export const MIRROR_PATHS: readonly string[] = Object.keys(VALID_BODIES);

/** A newer compatible release, for the data-update specs. */
export const NEXT_TAG = 'v2.33.0';

/** A species only {@link NEXT_TAG} has, so a page shows which release it reads. */
export const NEXT_ONLY_RACE = 'Newfolk';

/**
 * {@link NEXT_TAG}'s files: the shared valid release with one more species,
 * so the same paths install and the library tells the two apart.
 */
export const NEXT_BODIES: Readonly<Record<string, unknown>> = {
  ...VALID_BODIES,
  'races.json': {
    race: [
      ...(VALID_BODIES['races.json'] as { race: readonly unknown[] }).race,
      { name: NEXT_ONLY_RACE, source: 'PHB' },
    ],
  },
};

/** Serves {@link NEXT_BODIES} for {@link NEXT_TAG} and the shared release for every other tag. */
export function withNextRelease(tag: string): Readonly<Record<string, unknown>> {
  return tag === NEXT_TAG ? NEXT_BODIES : VALID_BODIES;
}

const JSDELIVR =
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/5etools-mirror-3\/5etools-src@([^/]+)\/data\/(.+)$/;
const RAW_GITHUB =
  /^https:\/\/raw\.githubusercontent\.com\/5etools-mirror-3\/5etools-src\/([^/]+)\/data\/(.+)$/;
const TAGS_API = 'https://api.github.com/repos/5etools-mirror-3/5etools-src/tags';

/** Every host the app fetches game data or the release list from. */
export const MIRROR_HOSTS =
  /^https:\/\/(cdn\.jsdelivr\.net|raw\.githubusercontent\.com|api\.github\.com)\//;

/** How a data file request fails: a network error, or that HTTP status. */
export type Failure = 'abort' | number;
export type FailRule = (tag: string, path: string) => Failure | undefined;
export type HoldRule = (tag: string, path: string) => boolean;

/** Parses a mirror data URL into its tag and path, or null for any other URL. */
export function parseMirrorUrl(url: string): { tag: string; path: string } | null {
  const m = JSDELIVR.exec(url) ?? RAW_GITHUB.exec(url);
  return m === null ? null : { tag: m[1] as string, path: decodeURIComponent(m[2] as string) };
}

export interface MirrorOptions {
  /** The release list `api.github.com` answers with. */
  tags?: readonly string[];
  /** Bodies per tag; defaults to the shared valid release for every tag. */
  bodies?: (tag: string) => Readonly<Record<string, unknown>>;
}

/** A request still being answered when its context closed is not a failure. */
export function ignoreClosed(err: unknown): void {
  if (err instanceof Error && /closed|disposed/i.test(err.message)) return;
  throw err;
}

const CORS = { 'access-control-allow-origin': '*' };

/**
 * A stand-in for jsDelivr, raw GitHub and the GitHub tags API, served through
 * `context.route` so no test touches the real network. One mirror can serve
 * several contexts (a persistent profile relaunched) and keeps one record.
 */
export class Mirror {
  /** Requests per `${tag}:${path}`, across both data hosts, failed ones included. */
  readonly hits = new Map<string, number>();
  /** Every request answered 200 (data files and the release list), in order. */
  readonly fulfils: string[] = [];
  /**
   * URLs this mirror failed because the test asked it to ({@link setFail},
   * {@link setOffline}), so the console guard can expect their errors.
   */
  readonly failedUrls = new Set<string>();
  /**
   * Requests no test asked to fail and the mirror cannot answer: a URL shape
   * the app should never build, or a file the release does not have. They are
   * answered 404, as a real mirror would, and fail the test at teardown.
   */
  readonly unexpected: string[] = [];
  tagListRequests = 0;

  private tags: readonly string[];
  private bodies: (tag: string) => Readonly<Record<string, unknown>>;
  private fail: FailRule | undefined;
  private hold: HoldRule | undefined;
  private held: Array<() => void> = [];
  private offline = false;

  constructor(options: MirrorOptions = {}) {
    this.tags = options.tags ?? [PINNED_TAG];
    this.bodies = options.bodies ?? (() => VALID_BODIES);
  }

  /** Routes the mirror hosts in `context`. Register after the network guard. */
  async attach(context: BrowserContext): Promise<void> {
    await context.route(MIRROR_HOSTS, (route) => this.handle(route).catch(ignoreClosed));
  }

  setTags(tags: readonly string[]): void {
    this.tags = tags;
  }

  /** Replaces the bodies served per tag (a new release published, say). */
  setBodies(bodies: (tag: string) => Readonly<Record<string, unknown>>): void {
    this.bodies = bodies;
  }

  setFail(rule: FailRule | undefined): void {
    this.fail = rule;
  }

  /** Holds matching requests unanswered until {@link releaseHeld}. */
  setHold(rule: HoldRule | undefined): void {
    this.hold = rule;
  }

  /** Answers every held request (with whatever the rules say by then). */
  releaseHeld(): void {
    this.hold = undefined;
    for (const release of this.held.splice(0)) release();
  }

  /**
   * The mirror's part of being offline (the `network` fixture in
   * `support/test.ts` drives it with the rest): while set,
   * every mirror and API request fails as a dropped connection would.
   * `context.setOffline` alone does not stop `route.fulfill`.
   */
  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  get isOffline(): boolean {
    return this.offline;
  }

  /** Total data-file requests so far, for "nothing was downloaded again" checks. */
  totalHits(): number {
    let total = 0;
    for (const n of this.hits.values()) total += n;
    return total;
  }

  assertClean(): void {
    if (this.unexpected.length > 0) {
      throw new Error(
        `The mirror was asked for things it does not have (add them to the release, or fail them on purpose with setFail):\n${this.unexpected.join('\n')}`,
      );
    }
  }

  private async handle(route: Route): Promise<void> {
    const url = route.request().url();

    if (url.split('?')[0] === TAGS_API) {
      this.tagListRequests++;
      if (this.offline) return this.abort(route, url);
      this.fulfils.push(url);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify(this.tags.map((name) => ({ name }))),
      });
    }

    const parsed = parseMirrorUrl(url);
    if (parsed === null) {
      // A host we serve, but a URL shape the app should never ask for.
      this.unexpected.push(url);
      return route.fulfill({ status: 404, headers: CORS, body: 'Not found' });
    }
    const { tag, path } = parsed;
    const key = `${tag}:${path}`;
    this.hits.set(key, (this.hits.get(key) ?? 0) + 1);

    if (this.hold?.(tag, path) === true) {
      await new Promise<void>((release) => this.held.push(release));
    }
    if (this.offline) return this.abort(route, url);

    const failure = this.fail?.(tag, path);
    if (failure === 'abort') return this.abort(route, url);
    if (typeof failure === 'number') {
      this.failedUrls.add(url);
      return route.fulfill({ status: failure, headers: CORS, body: `HTTP ${failure}` });
    }

    const body = this.bodies(tag)[path];
    if (body === undefined) {
      this.unexpected.push(url);
      return route.fulfill({ status: 404, headers: CORS, body: 'Not found' });
    }
    this.fulfils.push(url);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(body),
    });
  }

  private abort(route: Route, url: string): Promise<void> {
    this.failedUrls.add(url);
    return route.abort('internetdisconnected');
  }
}
