// A homebrew URL can point anywhere, so what it sends back is read through a
// byte bound before it is parsed, and nothing is stored unless all of it fits.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { ResponseTooLargeError } from '@/lib/boundedRead';
import { HomebrewUrlRefusedError, importHomebrewFromUrl } from './importUrl';

const brew = {
  _meta: { sources: [{ json: 'BREW', abbreviation: 'BREW', full: 'Brew' }] },
  spell: [{ name: 'Zap', source: 'BREW', level: 1 }],
};

/** A `fetch` that answers every request with `make()`. */
const serve = (make: () => Response) => (() => Promise.resolve(make())) as unknown as typeof fetch;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('importHomebrewFromUrl', () => {
  it('imports a file that fits', async () => {
    const row = await importHomebrewFromUrl(
      'https://raw.githubusercontent.com/me/brews/main/my%20brew.json',
      serve(() => new Response(JSON.stringify(brew))),
    );
    expect(row.fileName).toBe('my brew.json');
    expect(row.url).toBe('https://raw.githubusercontent.com/me/brews/main/my%20brew.json');
    expect(await db.homebrewFiles.count()).toBe(1);
  });

  it('refuses an oversized body and stores nothing', async () => {
    const big = { ...brew, pad: 'x'.repeat(4096) };
    await expect(
      importHomebrewFromUrl(
        'https://raw.githubusercontent.com/me/brews/main/big.json',
        serve(() => new Response(JSON.stringify(big))),
        1024,
      ),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('stops reading a body that keeps coming', async () => {
    let cancelled = false;
    let pulls = 0;
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    // Ends at 10 MiB only so that a reader with no limit fails this test
    // rather than exhausting the test process.
    const endless = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls++;
            if (pulls > 10_240) controller.close();
            else controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    await expect(
      importHomebrewFromUrl(
        'https://raw.githubusercontent.com/me/brews/main/endless.json',
        serve(endless),
        1024,
      ),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(10);
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('refuses a host off the allow-list without fetching it', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(brew))));
    const attempt = importHomebrewFromUrl(
      'https://example.com/brew.json',
      fetchSpy as unknown as typeof fetch,
    );
    await expect(attempt).rejects.toBeInstanceOf(HomebrewUrlRefusedError);
    await expect(attempt).rejects.toMatchObject({ url: 'https://example.com/brew.json' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await db.homebrewFiles.count()).toBe(0);
  });

  it('fetches the raw file behind a github.com page URL', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify(brew))));
    const row = await importHomebrewFromUrl(
      'https://github.com/me/brews/blob/main/brew.json',
      fetchSpy as unknown as typeof fetch,
    );
    const raw = 'https://raw.githubusercontent.com/me/brews/main/brew.json';
    expect(fetchSpy).toHaveBeenCalledWith(raw, expect.anything());
    expect(row.url).toBe(raw);
    expect(row.fileName).toBe('brew.json');
  });

  it('reports an HTTP failure without reading the body', async () => {
    await expect(
      importHomebrewFromUrl(
        'https://raw.githubusercontent.com/me/brews/main/missing.json',
        serve(() => new Response('nope', { status: 404 })),
      ),
    ).rejects.toThrow('HTTP 404');
    expect(await db.homebrewFiles.count()).toBe(0);
  });
});
