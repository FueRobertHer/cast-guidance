// @vitest-environment node
// A header change has to reach installed copies, which the service worker
// serves from the precached index.html: only a changed file gets refetched.
import type { HtmlTagDescriptor, IndexHtmlTransformContext, Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import { headersDigest, headersMetaPlugin } from './headersMeta';

// Loaded lazily and untyped: the Vite config is Node code outside this
// tsconfig, but running it is the only way to see which headers it hashes.
const viteConfigModule = import.meta.glob('/vite.config.ts');
const vercelRaw = import.meta.glob('/vercel.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const headers = [
  { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'" }] },
];

/** Runs a plugin's index.html hook the way Vite would, returning its tags. */
async function tagsOf(plugin: Plugin): Promise<HtmlTagDescriptor[]> {
  const hook = plugin.transformIndexHtml;
  const fn = typeof hook === 'function' ? hook : hook?.handler;
  if (fn === undefined) throw new Error('the plugin has no transformIndexHtml hook');
  const out = await fn.call({} as never, '<html></html>', {} as IndexHtmlTransformContext);
  if (!Array.isArray(out)) throw new Error('expected the hook to return tags');
  return out;
}

const injectedTags = (h: unknown) => tagsOf(headersMetaPlugin(h));

describe('headersDigest', () => {
  it('is a short, stable hex digest', async () => {
    const a = await headersDigest(headers);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(await headersDigest(structuredClone(headers))).toBe(a);
  });

  it('changes when any header value changes', async () => {
    const changed = structuredClone(headers);
    const first = changed[0]?.headers[0];
    if (first === undefined) throw new Error('fixture has no header');
    first.value = "default-src 'none'";
    expect(await headersDigest(changed)).not.toBe(await headersDigest(headers));
  });
});

describe('headersMetaPlugin', () => {
  it('writes the digest into the head of index.html', async () => {
    expect(await injectedTags(headers)).toEqual([
      {
        tag: 'meta',
        attrs: { name: 'cg-headers', content: await headersDigest(headers) },
        injectTo: 'head',
      },
    ]);
  });

  it('gives index.html different bytes for different headers', async () => {
    const other = [{ source: '/(.*)', headers: [] }];
    expect(await injectedTags(other)).not.toEqual(await injectedTags(headers));
  });

  it('is fed the headers of vercel.json by the Vite config', async () => {
    // vercel.json is what Vercel serves; hashing anything else would let the
    // live headers change without index.html changing.
    const load = viteConfigModule['/vite.config.ts'];
    if (load === undefined) throw new Error('vite.config.ts is missing');
    const mod = (await load()) as { default: { plugins?: unknown[] } };
    const plugin = (mod.default.plugins ?? [])
      .flat(Infinity)
      .find((p): p is Plugin => (p as Plugin | null)?.name === 'cg-headers-meta');
    if (plugin === undefined) throw new Error('the Vite config does not use headersMetaPlugin');
    const vercel = JSON.parse(vercelRaw['/vercel.json'] ?? '{}') as { headers?: unknown };
    expect(vercel.headers).toBeDefined();
    expect(await tagsOf(plugin)).toEqual(await injectedTags(vercel.headers));
  });
});
