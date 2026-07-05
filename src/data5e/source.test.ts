import { describe, expect, it } from 'vitest';
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
});
