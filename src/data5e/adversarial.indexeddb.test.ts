import 'fake-indexeddb/auto';
// What a hostile or broken mirror can do to the device. Nothing here is
// mocked between `fetch` and IndexedDB: the real source reads the body, the
// real loader decides whether to keep it, and every refusal is checked where
// it matters, in what was stored and what the registry was built from.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_TAG, MAX_DATA_FILE_BYTES } from './config';

/** Every URL the app asked for. */
const requested: string[] = [];

/** Serve `body(path, url)` as the mirror's answer for every data file. */
function mirror(body: (path: string, url: string) => string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const path = url.split('/data/')[1] ?? '';
      return Promise.resolve(new Response(body(path, url)));
    }),
  );
}

/**
 * A loader built after `fetch` is stubbed (the source binds the global when it
 * is constructed), over an empty device pinned to the build's tag so tag
 * resolution makes no request of its own.
 */
async function boot() {
  vi.resetModules();
  const [{ db }, loader, registry] = await Promise.all([
    import('@/db/db'),
    import('./loader'),
    import('./registry'),
  ]);
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  return { db, loader, registry };
}

const races = JSON.stringify({ race: [{ name: 'Elf', source: 'PHB' }] });

beforeEach(() => {
  requested.length = 0;
});

describe('a mirror that sends something other than a data file', () => {
  it('stores a well-formed file (the control for the cases below)', async () => {
    mirror(() => races);
    const { db, loader, registry } = await boot();
    await expect(loader.getFile('races.json')).resolves.toEqual(JSON.parse(races));
    expect(await db.dataFiles.count()).toBe(1);
    expect((await registry.getRegistry()).byType('race')).toHaveLength(1);
  });

  it('refuses a body over the byte limit, from every endpoint, and stores nothing', async () => {
    const huge = JSON.stringify({ race: [{ name: 'x'.repeat(MAX_DATA_FILE_BYTES) }] });
    mirror(() => huge);
    const { db, loader, registry } = await boot();
    await expect(loader.getFile('races.json')).rejects.toThrow(/byte limit/);
    // Once per endpoint: the same mirror would only send the same body again.
    expect(requested).toHaveLength(2);
    expect(await db.dataFiles.count()).toBe(0);
    expect((await registry.getRegistry()).byType('race')).toHaveLength(0);
  });

  it('refuses a body nested a thousand deep', async () => {
    mirror(() => `{"race":${'['.repeat(1000)}${']'.repeat(1000)}}`);
    const { db, loader } = await boot();
    await expect(loader.getFile('races.json')).rejects.toThrow(
      'data file "races.json" nests deeper than 64 levels',
    );
    expect(await db.dataFiles.count()).toBe(0);
  });

  it('refuses a string longer than any real one', async () => {
    mirror(() => JSON.stringify({ race: [{ name: 'Elf', entries: ['x'.repeat(40_000)] }] }));
    const { db, loader } = await boot();
    await expect(loader.getFile('races.json')).rejects.toThrow(/string longer than/);
    expect(await db.dataFiles.count()).toBe(0);
  });

  it('refuses a body that is not an object', async () => {
    mirror(() => '[1,2,3]');
    const { db, loader } = await boot();
    await expect(loader.getFile('races.json')).rejects.toThrow('is not a JSON object');
    expect(await db.dataFiles.count()).toBe(0);
  });

  it('refuses the same bodies during an install, and keeps the release it has', async () => {
    // A deep body whose top level still looks like races: the install's own
    // sanity check (a non-empty `race` array) would wave it through.
    const deepRaces = `{"race":[${'['.repeat(100)}${']'.repeat(100)}]}`;
    mirror((path, url) => (url.includes('v2.33.0') && path === 'races.json' ? deepRaces : '{}'));
    const { db, loader } = await boot();
    await expect(loader.updateToTag('v2.33.0')).rejects.toThrow('nests deeper than 64 levels');
    expect(loader.getActiveTag()).toBe(DATA_TAG);
    expect((await db.settings.get('dataTag'))?.value).toBe(DATA_TAG);
    expect(await db.dataFiles.where('tag').equals('v2.33.0').count()).toBe(0);
  });

  it('refuses them on a repair, leaving the cached copy in place', async () => {
    // One stub for the whole test, since the source holds on to the `fetch` it
    // was built with; what it serves changes underneath.
    let served = races;
    mirror(() => served);
    const { db, loader } = await boot();
    await loader.getFile('races.json');
    served = `{"race":${'['.repeat(100)}${']'.repeat(100)}}`;
    await expect(loader.repairTypePacks('race')).rejects.toThrow('nests deeper than 64 levels');
    expect((await db.dataFiles.get(`${DATA_TAG}:races.json`))?.json).toEqual(JSON.parse(races));
  });
});
