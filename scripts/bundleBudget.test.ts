import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Budget,
  type DistFile,
  evaluate,
  measure,
  parseBudget,
  parseEntryScripts,
  parseModulePreloads,
  parsePrecacheUrls,
  toDistPath,
  toMarkdown,
} from './bundleBudget.ts';

// Fixtures copy the shape of a real `vite build` + vite-plugin-pwa output:
// Vite writes `crossorigin` between `type` and `src`, leaves comments in, and
// Workbox lists favicon.svg twice (once from the glob, once from the manifest).
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <!--
      <script type="module" src="/assets/commented-out.js"></script>
    -->
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="dns-prefetch" href="https://api.github.com" />
    <title>Cast Guidance</title>
    <script type="module" crossorigin src="/assets/index-CtC1UB32.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-DTwi_8cj.js">
    <link rel="modulepreload" crossorigin href="/assets/registry-qSDUE6yK.js">
    <link rel="stylesheet" crossorigin href="/assets/index-Cz6s2DaM.css">
  <link rel="manifest" href="/manifest.webmanifest"></head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const SW_JS = `if(!self.define){let s,e={};const l=(l,r)=>(l=new URL(l+".js",r).href,e[l]||new Promise(e=>{if("document"in self){const s=document.createElement("script");s.src=l,s.onload=e,document.head.appendChild(s)}else s=l,importScripts(l),e()}))}define(["./workbox-2fbc6a65"],function(s){"use strict";self.skipWaiting(),s.clientsClaim(),s.precacheAndRoute([{url:"index.html",revision:"823bcab41c235bdcb4fe522766ac14f3"},{url:"favicon.svg",revision:"fbc0d548fa2c68f14796ee59fc91634e"},{url:"assets/search.worker-CGmySGpb.js",revision:null},{url:"assets/registry-qSDUE6yK.js",revision:null},{url:"assets/react-DTwi_8cj.js",revision:null},{url:"assets/index-Cz6s2DaM.css",revision:null},{url:"assets/index-CtC1UB32.js",revision:null},{url:"assets/BuildPage-BpTzIkpz.js",revision:null},{url:"favicon.svg",revision:"fbc0d548fa2c68f14796ee59fc91634e"},{url:"manifest.webmanifest",revision:"51c6008ca9880659b6f562830c6bc9f4"}],{}),s.cleanupOutdatedCaches(),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("index.html")))});
`;

const file = (p: string, bytes: number, gzipBytes = Math.round(bytes / 3)): DistFile => ({
  path: p,
  bytes,
  gzipBytes,
});

const FILES: DistFile[] = [
  file('index.html', 2_000),
  file('favicon.svg', 500),
  file('manifest.webmanifest', 400),
  file('sw.js', 3_000),
  file('workbox-2fbc6a65.js', 22_000),
  file('assets/index-CtC1UB32.js', 380_000, 120_000),
  file('assets/react-DTwi_8cj.js', 10_000, 4_000),
  file('assets/registry-qSDUE6yK.js', 130_000, 43_000),
  file('assets/search.worker-CGmySGpb.js', 30_000),
  file('assets/BuildPage-BpTzIkpz.js', 60_000),
  file('assets/index-Cz6s2DaM.css', 42_000, 8_000),
];

const INPUT = { indexHtml: INDEX_HTML, swJs: SW_JS, files: FILES };

const GENEROUS: Budget = {
  entryBytes: 400_000,
  entryGzipBytes: 130_000,
  initialJsBytes: 600_000,
  initialJsGzipBytes: 200_000,
  totalJsBytes: 700_000,
  largestChunkBytes: 400_000,
  cssBytes: 50_000,
  precacheBytes: 700_000,
};

describe('index.html parsing', () => {
  it('finds the module entry with Vite attribute order and skips commented-out tags', () => {
    expect(parseEntryScripts(INDEX_HTML)).toEqual(['/assets/index-CtC1UB32.js']);
  });

  it('accepts attributes in any order and either quote style, and ignores classic scripts', () => {
    const html = `<script src='/assets/a.js' crossorigin type=module></script>
      <script src="/assets/legacy.js"></script>
      <script type="text/javascript" src="/assets/b.js"></script>`;
    expect(parseEntryScripts(html)).toEqual(['/assets/a.js']);
  });

  it('lists modulepreload links but not stylesheets or icons', () => {
    expect(parseModulePreloads(INDEX_HTML)).toEqual([
      '/assets/react-DTwi_8cj.js',
      '/assets/registry-qSDUE6yK.js',
    ]);
  });

  it('maps root-relative URLs to dist paths and leaves other origins out', () => {
    expect(toDistPath('/assets/x.js')).toBe('assets/x.js');
    expect(toDistPath('./assets/x.js?v=1')).toBe('assets/x.js');
    expect(toDistPath('https://cdn.jsdelivr.net/x.js')).toBeUndefined();
    expect(toDistPath('//cdn.jsdelivr.net/x.js')).toBeUndefined();
  });
});

describe('sw.js parsing', () => {
  it('dedupes the precache manifest, keeping first-seen order', () => {
    const urls = parsePrecacheUrls(SW_JS);
    expect(urls).toHaveLength(9);
    expect(urls.filter((u) => u === 'favicon.svg')).toHaveLength(1);
    expect(urls[0]).toBe('index.html');
    expect(urls.at(-1)).toBe('manifest.webmanifest');
  });
});

describe('measure', () => {
  it('resolves the entry, initial JS, all JS, CSS, and unique precache files', () => {
    const m = measure(INPUT);
    expect(m.entry.path).toBe('assets/index-CtC1UB32.js');
    expect(m.initialJs.map((f) => f.path)).toEqual([
      'assets/index-CtC1UB32.js',
      'assets/react-DTwi_8cj.js',
      'assets/registry-qSDUE6yK.js',
    ]);
    // Root-level workbox runtime and sw.js are not app chunks.
    expect(m.allJs).toHaveLength(5);
    expect(m.css.map((f) => f.path)).toEqual(['assets/index-Cz6s2DaM.css']);
    expect(m.precache).toHaveLength(9);
  });

  it('fails when index.html has no module entry', () => {
    const indexHtml = INDEX_HTML.replaceAll(' type="module"', '');
    expect(() => measure({ ...INPUT, indexHtml })).toThrow(/found 0/);
  });

  it('fails when index.html has two module entries', () => {
    const indexHtml = INDEX_HTML.replace(
      '</title>',
      '</title><script type="module" src="/assets/react-DTwi_8cj.js"></script>',
    );
    expect(() => measure({ ...INPUT, indexHtml })).toThrow(/found 2/);
  });

  it('fails when sw.js has no precache entries', () => {
    const swJs = SW_JS.replace(/url:/g, 'href:');
    expect(() => measure({ ...INPUT, swJs })).toThrow(/no precache entries/);
  });

  it('fails when a referenced file is missing from dist', () => {
    const files = FILES.filter((f) => f.path !== 'assets/registry-qSDUE6yK.js');
    expect(() => measure({ ...INPUT, files })).toThrow(/dist\/assets\/registry-qSDUE6yK\.js/);
  });

  it('fails when a hashed asset is left out of the precache', () => {
    const files = [...FILES, file('assets/huge-Xx.js', 3_000_000)];
    expect(() => measure({ ...INPUT, files })).toThrow(/unavailable offline: assets\/huge-Xx\.js/);
  });
});

describe('evaluate', () => {
  it('sums each metric and passes a build within budget', () => {
    const { rows, violations } = evaluate(measure(INPUT), GENEROUS);
    const actual = Object.fromEntries(rows.map((r) => [r.key, r.actual]));
    expect(actual).toEqual({
      entryBytes: 380_000,
      entryGzipBytes: 120_000,
      initialJsBytes: 520_000,
      initialJsGzipBytes: 167_000,
      totalJsBytes: 610_000,
      largestChunkBytes: 380_000,
      cssBytes: 42_000,
      // Unique precache entries: favicon.svg counted once.
      precacheBytes: 2_000 + 500 + 30_000 + 130_000 + 10_000 + 42_000 + 380_000 + 60_000 + 400,
    });
    expect(violations).toEqual([]);
  });

  it('treats a metric exactly at its budget as within budget', () => {
    const { violations } = evaluate(measure(INPUT), { ...GENEROUS, entryBytes: 380_000 });
    expect(violations).toEqual([]);
  });

  it('reports every metric over budget', () => {
    const { violations } = evaluate(measure(INPUT), {
      ...GENEROUS,
      entryBytes: 379_999,
      cssBytes: 41_999,
    });
    expect(violations.map((v) => v.key)).toEqual(['entryBytes', 'cssBytes']);
    expect(violations[0]?.detail).toBe('assets/index-CtC1UB32.js');
  });

  it('renders violations in the markdown table', () => {
    const { rows } = evaluate(measure(INPUT), { ...GENEROUS, cssBytes: 40_000 });
    const md = toMarkdown(rows);
    expect(md.split('\n')).toHaveLength(2 + rows.length);
    expect(md).toContain('| CSS (raw)<br>`1 file` | 42,000 B (41.0 KiB) | 40,000 B (39.1 KiB) |');
    expect(md).toContain('**over budget**');
  });
});

describe('parseBudget', () => {
  it('accepts the committed budget file', () => {
    const raw = JSON.parse(
      readFileSync(path.join(import.meta.dirname, 'bundle-budget.json'), 'utf8'),
    );
    expect(parseBudget(raw).entryBytes).toBeGreaterThan(0);
  });

  it('rejects missing, unknown, and non-positive keys', () => {
    const { cssBytes: _omitted, ...missing } = GENEROUS;
    expect(() => parseBudget(missing)).toThrow(/"cssBytes"/);
    expect(() => parseBudget({ ...GENEROUS, entryKb: 1 })).toThrow(/Unknown.*entryKb/);
    expect(() => parseBudget({ ...GENEROUS, cssBytes: 0 })).toThrow(/"cssBytes"/);
    expect(() => parseBudget({ ...GENEROUS, cssBytes: '47000' })).toThrow(/"cssBytes"/);
    expect(() => parseBudget([])).toThrow(/JSON object/);
  });
});
