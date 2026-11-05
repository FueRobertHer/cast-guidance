/**
 * Fetching a real 5etools release for the network-gated data scripts
 * (`data-audit.ts` and `data-judge.ts`). Nothing here is cached or written:
 * no game data ever lands in the repo.
 */
import { DATA_TAG, isCompatibleTag, parseTagVersion, TAGS_API_URL } from '../src/data5e/config';
import { GithubTagSource } from '../src/data5e/source';

/**
 * The newest release this build could install, straight from the GitHub tags
 * API. Deliberately not `listAvailableTags` from the loader, which needs
 * IndexedDB. A token, when the workflow provides one, lifts the rate limit.
 */
export async function resolveLatestTag(): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${TAGS_API_URL}?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub tags API answered HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('GitHub tags API did not answer with a list');
  const versions = body
    .map((t: unknown) =>
      t !== null && typeof t === 'object' ? (t as { name?: unknown }).name : '',
    )
    .filter((name): name is string => typeof name === 'string' && isCompatibleTag(name))
    .map((name) => ({ name, v: parseTagVersion(name) }))
    .filter((t): t is { name: string; v: NonNullable<typeof t.v> } => t.v !== null)
    .sort((a, b) => b.v.major - a.v.major || b.v.minor - a.v.minor || b.v.patch - a.v.patch);
  const newest = versions[0];
  if (newest === undefined) throw new Error(`no tag compatible with ${DATA_TAG} on the mirror`);
  return newest.name;
}

const STATIC_FILES = [
  'races.json',
  'backgrounds.json',
  'feats.json',
  'items-base.json',
  'items.json',
  'magicvariants.json',
  'optionalfeatures.json',
  'skills.json',
  'languages.json',
  'senses.json',
  'actions.json',
  'conditionsdiseases.json',
  'variantrules.json',
  'books.json',
  'class/index.json',
  'spells/index.json',
];

export async function fetchRelease(tag: string) {
  /** Decoded size of every file fetched, by data path, for the size check. */
  const fileBytes = new Map<string, number>();
  const source = new GithubTagSource(tag, {
    fetchImpl: async (input, init) => {
      const res = await fetch(input, init);
      if (res.ok) {
        const url = String(input);
        const dataPath = url.slice(url.indexOf('/data/') + '/data/'.length);
        fileBytes.set(dataPath, (await res.clone().arrayBuffer()).byteLength);
      }
      return res;
    },
  });
  const files = new Map<string, unknown>();
  const fetchInto = async (paths: string[]) => {
    const queue = [...paths];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (;;) {
          const p = queue.shift();
          if (p === undefined) return;
          files.set(p, await source.fetchFile(p));
        }
      }),
    );
  };
  await fetchInto(STATIC_FILES);
  const index = (p: string) => Object.values((files.get(p) ?? {}) as Record<string, string>);
  await fetchInto([
    ...index('class/index.json').map((f) => `class/${f}`),
    ...index('spells/index.json').map((f) => `spells/${f}`),
  ]);
  return { files, fileBytes };
}
