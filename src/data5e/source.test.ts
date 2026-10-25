import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataFetchError, GithubTagSource } from './source';

function fakeFetch(handler: (url: string) => Response | Error): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const out = handler(url);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GithubTagSource', () => {
  const endpoints = [
    (tag: string, path: string) => `https://primary.test/${tag}/${path}`,
    (tag: string, path: string) => `https://fallback.test/${tag}/${path}`,
  ];

  it('fetches and parses from the primary endpoint', async () => {
    const src = new GithubTagSource('v1', {
      endpoints,
      fetchImpl: fakeFetch(() => json({ ok: 1 })),
    });
    await expect(src.fetchFile('races.json')).resolves.toEqual({ ok: 1 });
  });

  it('fails over to the second endpoint on network error', async () => {
    const calls: string[] = [];
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 1,
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        return url.includes('primary') ? new TypeError('network down') : json({ via: 'fallback' });
      }),
    });
    await expect(src.fetchFile('feats.json')).resolves.toEqual({ via: 'fallback' });
    // two tries on primary, then fallback succeeds
    expect(calls).toEqual([
      'https://primary.test/v1/feats.json',
      'https://primary.test/v1/feats.json',
      'https://fallback.test/v1/feats.json',
    ]);
  });

  it('moves to the next endpoint immediately on HTTP error (no retry of a 404)', async () => {
    const calls: string[] = [];
    const src = new GithubTagSource('v1', {
      endpoints,
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        return url.includes('primary') ? json({}, 404) : json({ via: 'fallback' });
      }),
    });
    await expect(src.fetchFile('x.json')).resolves.toEqual({ via: 'fallback' });
    expect(calls.filter((c) => c.includes('primary'))).toHaveLength(1);
  });

  it('throws DataFetchError with all failure causes when everything fails', async () => {
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 1,
      fetchImpl: fakeFetch(() => new TypeError('offline')),
    });
    const err = await src.fetchFile('y.json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataFetchError);
    expect((err as DataFetchError).message).toContain('offline');
    expect((err as DataFetchError).path).toBe('y.json');
  });

  it('tries each endpoint once, without the backoff retries, while the device is offline', async () => {
    // PWA-001: a device that is offline now is offline a moment later too, so
    // the backoff retries only kept an offline page waiting for the same answer.
    vi.stubGlobal('navigator', { onLine: false });
    const seen: string[] = [];
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 60_000,
      fetchImpl: fakeFetch((url) => {
        seen.push(url);
        return new TypeError('Failed to fetch');
      }),
    });
    const err = await src.fetchFile('races.json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataFetchError);
    expect((err as Error).message).toContain('the device is offline');
    expect(seen).toEqual([
      'https://primary.test/v1/races.json',
      'https://fallback.test/v1/races.json',
    ]);
  });

  it('still reaches the mirror when the device wrongly reports offline', async () => {
    // `onLine` can be false with a working network (a blocked CDN, a captive
    // portal that let the mirror through); the failover must still run.
    vi.stubGlobal('navigator', { onLine: false });
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 60_000,
      fetchImpl: fakeFetch((url) =>
        url.startsWith('https://primary.test/')
          ? new TypeError('Failed to fetch')
          : json({ ok: 2 }),
      ),
    });
    await expect(src.fetchFile('races.json')).resolves.toEqual({ ok: 2 });
  });

  it('moves past an oversized body to the mirror without retrying it', async () => {
    const calls: string[] = [];
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 1,
      maxBytes: 64,
      fetchImpl: fakeFetch((url) => {
        calls.push(url);
        return url.includes('primary') ? json({ pad: 'x'.repeat(500) }) : json({ via: 'fallback' });
      }),
    });
    await expect(src.fetchFile('races.json')).resolves.toEqual({ via: 'fallback' });
    // One request at the primary: the same endpoint would send the same body.
    expect(calls).toEqual([
      'https://primary.test/v1/races.json',
      'https://fallback.test/v1/races.json',
    ]);
  });

  it('reports the byte limit when every endpoint sends too much', async () => {
    const src = new GithubTagSource('v1', {
      endpoints,
      backoffMs: 1,
      maxBytes: 64,
      fetchImpl: fakeFetch(() => json({ pad: 'x'.repeat(500) })),
    });
    const err = await src.fetchFile('items.json').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataFetchError);
    expect((err as DataFetchError).message).toContain('larger than the 64 byte limit');
  });
});
