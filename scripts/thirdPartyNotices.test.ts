import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeModuleId,
  RECORDS_DIR,
  type ShippedModules,
  shippedModulesCollector,
} from './shippedModules.ts';
import { run } from './third-party-notices.ts';
import {
  buildNotices,
  checkNotices,
  collectInventory,
  type Extra,
  type InventoryInput,
  type PackageRecord,
  type PackageSource,
  parseOverrides,
  renderNotices,
  workboxPackages,
} from './thirdPartyNotices.ts';

const MIT = 'MIT License\n\nCopyright (c) Someone\n\nPermission is hereby granted...';

/** A fake node_modules: directory to package. `ownerOf` takes the first two path segments (or three when scoped). */
function fakeSource(packages: Record<string, PackageRecord>): PackageSource {
  return {
    ownerOf(moduleId) {
      const parts = moduleId.split('/');
      const dir = parts.slice(0, parts[1]?.startsWith('@') ? 3 : 2).join('/');
      return packages[dir] ? dir : undefined;
    },
    read: (dir) => packages[dir],
  };
}

const PACKAGES: Record<string, PackageRecord> = {
  'node_modules/react': { name: 'react', version: '19.0.0', identifier: 'MIT', licenseText: MIT },
  'node_modules/dexie': {
    name: 'dexie',
    version: '4.0.0',
    identifier: 'Apache-2.0',
    licenseText: 'Apache License 2.0 text',
    noticeText: 'Dexie.js\n\nCopyright (c) David Fahlander',
  },
  'node_modules/minisearch': {
    name: 'minisearch',
    version: '7.0.0',
    identifier: 'MIT',
    licenseText: MIT,
  },
  'node_modules/workbox-core': {
    name: 'workbox-core',
    version: '7.4.1',
    identifier: 'MIT',
    licenseText: MIT,
  },
  'node_modules/workbox-precaching': {
    name: 'workbox-precaching',
    version: '7.4.1',
    identifier: 'MIT',
    licenseText: MIT,
  },
  'node_modules/workbox-expiration': {
    name: 'workbox-expiration',
    version: '7.4.1',
    identifier: 'MIT',
    licenseText: MIT,
  },
  'node_modules/vite': { name: 'vite', version: '8.0.0', identifier: 'MIT', licenseText: MIT },
  'node_modules/tailwindcss': {
    name: 'tailwindcss',
    version: '4.0.0',
    identifier: 'MIT',
    licenseText: MIT,
  },
};

const EXTRAS: Extra[] = [
  { name: 'vite', why: 'helpers', moduleIdPrefix: '\0vite/' },
  { name: 'tailwindcss', why: 'css', cssMarker: '/*! tailwindcss v' },
];

function input(overrides: Partial<InventoryInput> = {}): InventoryInput {
  return {
    viteLicenses: [
      {
        name: 'dexie',
        version: '4.0.0',
        identifier: 'Apache-2.0',
        text: 'Apache License 2.0 text',
      },
      { name: 'react', version: '19.0.0', identifier: 'MIT', text: MIT },
    ],
    shippedModules: {
      chunks: [
        {
          fileName: 'assets/index-abc.js',
          kind: 'main',
          moduleIds: [
            '\0vite/preload-helper.js',
            'node_modules/dexie/dist/dexie.mjs',
            'node_modules/react/index.js',
          ],
        },
        {
          fileName: 'assets/search.worker-def.js',
          kind: 'worker',
          moduleIds: ['node_modules/minisearch/dist/es/index.js'],
        },
      ],
    },
    jsFiles: [
      { path: 'assets/index-abc.js', text: '' },
      { path: 'assets/search.worker-def.js', text: '' },
      { path: 'sw.js', text: 'define(["./workbox-1"],function(e){})' },
      {
        path: 'workbox-1.js',
        text: 'self["workbox:core:7.4.0"]&&_();self["workbox:precaching:7.4.0"]&&_();',
      },
    ],
    cssFiles: [
      { path: 'assets/index-abc.css', text: '/*! tailwindcss v4.0.0 | MIT License */ a{}' },
    ],
    extras: EXTRAS,
    ...overrides,
  };
}

function generate(
  data: InventoryInput = input(),
  packages: Record<string, PackageRecord> = PACKAGES,
  overrides = {},
) {
  return renderNotices(buildNotices(collectInventory(data, fakeSource(packages)), overrides));
}

describe('collectInventory', () => {
  it('lists the main bundle, the worker, the service worker runtime and the extras', () => {
    const inventory = collectInventory(input(), fakeSource(PACKAGES));
    const shipsIn = Object.fromEntries(
      [...inventory.values()].map((item) => [item.name, item.shipsIn]),
    );
    expect(shipsIn).toEqual({
      dexie: ['app'],
      react: ['app'],
      minisearch: ['worker'],
      'workbox-core': ['service worker'],
      'workbox-precaching': ['service worker'],
      vite: ['app'],
      tailwindcss: ['stylesheet'],
    });
  });

  // Catches: Vite's build.license output used alone. It skips worker builds,
  // so a package that ships only in the search worker went unlisted.
  it("lists a worker chunk's packages, which Vite's license list does not have", () => {
    const inventory = collectInventory(input(), fakeSource(PACKAGES));
    expect(inventory.get('minisearch@7.0.0')?.shipsIn).toEqual(['worker']);
  });

  // Catches: a worker (or any chunk) the collector was not registered for.
  it('fails when an emitted worker chunk is missing from the module record', () => {
    const data = input({
      jsFiles: [...input().jsFiles, { path: 'assets/import.worker-ghi.js', text: '' }],
    });
    expect(() => collectInventory(data, fakeSource(PACKAGES))).toThrow(
      /assets\/import\.worker-ghi\.js is not in shipped-modules\.json/,
    );
  });

  it('fails when the record names a chunk the build did not emit (a stale record)', () => {
    const data = input({
      jsFiles: input().jsFiles.filter((file) => !file.path.includes('worker')),
    });
    expect(() => collectInventory(data, fakeSource(PACKAGES))).toThrow(/not in dist/);
  });

  // Catches: a new service worker module shipping unlisted.
  it('adds workbox-expiration for a workbox:expiration: marker', () => {
    const data = input({
      jsFiles: [
        ...input().jsFiles.filter((file) => file.path !== 'workbox-1.js'),
        {
          path: 'workbox-1.js',
          text: 'self["workbox:core:7.4.0"]&&_();self["workbox:expiration:7.4.0"]&&_();',
        },
      ],
    });
    const inventory = collectInventory(data, fakeSource(PACKAGES));
    expect(inventory.get('workbox-expiration@7.4.1')?.shipsIn).toEqual(['service worker']);
    expect(inventory.has('workbox-precaching@7.4.1')).toBe(false);
  });

  it('fails when a workbox marker has no installed package', () => {
    const data = input({
      jsFiles: [...input().jsFiles, { path: 'sw.js', text: 'self["workbox:routing:7.4.0"]' }],
    });
    expect(() => collectInventory(data, fakeSource(PACKAGES))).toThrow(
      /marker for workbox-routing: no package/,
    );
  });

  it('fails on a virtual module that no extra claims', () => {
    const data = input({
      shippedModules: {
        chunks: [
          { fileName: 'assets/index-abc.js', kind: 'main', moduleIds: ['\0new-plugin/helper'] },
          { fileName: 'assets/search.worker-def.js', kind: 'worker', moduleIds: [] },
        ],
      },
      viteLicenses: [],
    });
    expect(() => collectInventory(data, fakeSource(PACKAGES))).toThrow(
      /"\\u0000new-plugin\/helper" is not claimed by any extra/,
    );
  });

  it('fails on an extra with no trace in the build', () => {
    const data = input({ cssFiles: [] });
    expect(() => collectInventory(data, fakeSource(PACKAGES))).toThrow(
      /Extra tailwindcss has no trace/,
    );
  });

  describe('service worker markers', () => {
    const SW_EXTRAS: Extra[] = [
      ...EXTRAS,
      { name: 'sw-loader', why: 'loader', swMarker: 'if(!self.define)' },
      { name: 'workbox-build', why: 'template', swMarker: 'SKIP_WAITING' },
    ];
    const SW_PACKAGES: Record<string, PackageRecord> = {
      ...PACKAGES,
      'node_modules/sw-loader': {
        name: 'sw-loader',
        version: '3.0.0',
        identifier: 'Apache-2.0',
        licenseText: 'Apache License text',
        noticeText: 'Loader NOTICE',
      },
      'node_modules/workbox-build': {
        name: 'workbox-build',
        version: '7.4.1',
        identifier: 'MIT',
        licenseText: MIT,
      },
    };
    const SW_TEXT =
      'if(!self.define){let s;self.define=()=>{}}define(["./workbox-1"],function(s){self.addEventListener("message",s=>{s.data&&"SKIP_WAITING"===s.data.type&&self.skipWaiting()})});';
    const withSw = (text: string, extras: Extra[] = SW_EXTRAS) =>
      input({
        extras,
        jsFiles: input().jsFiles.map((file) => (file.path === 'sw.js' ? { ...file, text } : file)),
      });

    it('lists the loader and the template glue as service worker code, NOTICE included', () => {
      const output = renderNotices(
        buildNotices(collectInventory(withSw(SW_TEXT), fakeSource(SW_PACKAGES)), {}),
      );
      expect(output).toContain('| sw-loader | 3.0.0 | Apache-2.0 | service worker |');
      expect(output).toContain('| workbox-build | 7.4.1 | MIT | service worker |');
      expect(output).toContain('Loader NOTICE');
    });

    // Catches: an extra dropped from the list while its code still ships.
    it('fails on a marker in sw.js that no listed extra claims', () => {
      const extras = SW_EXTRAS.filter((extra) => extra.name !== 'sw-loader');
      expect(() => collectInventory(withSw(SW_TEXT, extras), fakeSource(SW_PACKAGES))).toThrow(
        /sw\.js contains "if\(!self\.define\)" .* but no extra .* claims it/,
      );
    });

    // Catches: an extra that stays listed after its code stopped shipping.
    it('fails on an extra whose marker is missing from sw.js', () => {
      const text = SW_TEXT.replace('SKIP_WAITING', 'OTHER');
      expect(() => collectInventory(withSw(text), fakeSource(SW_PACKAGES))).toThrow(
        /Extra workbox-build has no trace/,
      );
    });

    it('looks for the markers in sw.js only', () => {
      const data = withSw('');
      data.jsFiles = data.jsFiles.map((file) =>
        file.path === 'workbox-1.js' ? { ...file, text: `${file.text}${SW_TEXT}` } : file,
      );
      expect(() => collectInventory(data, fakeSource(SW_PACKAGES))).toThrow(
        /Extra sw-loader has no trace/,
      );
    });
  });

  it("fails when Vite's list and the module record disagree about the main bundle", () => {
    const missing = input({
      viteLicenses: [{ name: 'react', version: '19.0.0', identifier: 'MIT', text: MIT }],
    });
    expect(() => collectInventory(missing, fakeSource(PACKAGES))).toThrow(
      /dexie@4\.0\.0 ships in the main bundle, but Vite's license list misses it/,
    );
  });

  it('accepts workbox markers only from the service worker files', () => {
    const data = input({
      jsFiles: input().jsFiles.map((file) =>
        file.path === 'assets/index-abc.js' ? { ...file, text: 'workbox:window:7.4.0' } : file,
      ),
    });
    const inventory = collectInventory(data, fakeSource(PACKAGES));
    expect([...inventory.keys()].some((key) => key.startsWith('workbox-window'))).toBe(false);
  });
});

describe('buildNotices', () => {
  // Catches: silently emitting an empty license.
  it('throws for a package with no license text and no override', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/react': { name: 'react', version: '19.0.0', identifier: 'MIT' },
    };
    const data = input({
      viteLicenses: [
        { name: 'dexie', version: '4.0.0', identifier: 'Apache-2.0', text: 'Apache' },
        { name: 'react', version: '19.0.0', identifier: 'MIT' },
      ],
    });
    expect(() => generate(data, packages)).toThrow(/react@19\.0\.0 ships no license text/);
  });

  it("uses an override's text and names its source", () => {
    const packages = {
      ...PACKAGES,
      'node_modules/react': { name: 'react', version: '19.0.0', identifier: 'MIT' },
    };
    const data = input({
      viteLicenses: [
        { name: 'dexie', version: '4.0.0', identifier: 'Apache-2.0', text: 'Apache' },
        { name: 'react', version: '19.0.0', identifier: 'MIT' },
      ],
    });
    const output = generate(data, packages, {
      react: {
        reason: 'no file',
        text: 'Upstream MIT text',
        source: 'https://example.test/LICENSE',
      },
    });
    expect(output).toContain('Upstream MIT text');
    expect(output).toContain('https://example.test/LICENSE');
  });

  // Catches: dropping dexie's NOTICE (Apache-2.0 section 4(d)).
  it('includes a NOTICE file', () => {
    const output = generate();
    expect(output).toMatch(/## dexie 4\.0\.0[\s\S]*NOTICE:[\s\S]*Copyright \(c\) David Fahlander/);
  });

  // Catches: the license policy gate letting a copyleft dependency through.
  it('rejects a GPL identifier', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/minisearch': { ...PACKAGES['node_modules/minisearch'], identifier: 'GPL-3.0' },
    } as Record<string, PackageRecord>;
    expect(() => generate(input(), packages)).toThrow(
      /minisearch@7\.0\.0 is licensed GPL-3\.0, which is not in the allowlist/,
    );
  });

  it('rejects a package with no identifier', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/minisearch': { name: 'minisearch', version: '7.0.0', licenseText: MIT },
    };
    expect(() => generate(input(), packages)).toThrow(/declares no license identifier/);
  });

  it('cuts a license file at cutBefore, and fails when the line is gone', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/vite': {
        ...PACKAGES['node_modules/vite'],
        licenseText: 'Vite MIT\n\n# Licenses of bundled dependencies\nlots more',
      },
    } as Record<string, PackageRecord>;
    const cut = { vite: { reason: 'r', cutBefore: '# Licenses of bundled dependencies' } };
    const output = generate(input(), packages, cut);
    expect(output).toContain('Vite MIT');
    expect(output).not.toContain('lots more');
    expect(() => generate(input(), PACKAGES, cut)).toThrow(/cutBefore line is no longer/);
  });

  // Catches: Windows line endings leaking into the output, which would make
  // the file differ by platform.
  it('normalises CRLF and CR line endings in license and NOTICE texts', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/dexie': {
        ...PACKAGES['node_modules/dexie'],
        licenseText: 'Line one\r\nLine two\rLine three',
        noticeText: 'Notice one\r\nNotice two',
      },
    } as Record<string, PackageRecord>;
    const data = input({
      viteLicenses: [
        { name: 'dexie', version: '4.0.0', identifier: 'Apache-2.0' },
        { name: 'react', version: '19.0.0', identifier: 'MIT', text: MIT },
      ],
    });
    const output = generate(data, packages);
    expect(output).not.toMatch(/\r/);
    expect(output).toContain('Line one\nLine two\nLine three');
    expect(output).toContain('Notice one\nNotice two');
  });

  it('fails on an override that matches no shipped package', () => {
    expect(() => generate(input(), PACKAGES, { leftpad: { reason: 'r' } })).toThrow(
      /Override leftpad matches no shipped package/,
    );
  });
});

describe('renderNotices', () => {
  // Catches: output that depends on bundle or directory order, which would
  // make `--check` flap.
  it('is identical across runs with shuffled input', () => {
    const base = input();
    const shuffled = input({
      viteLicenses: [...(base.viteLicenses as unknown[])].reverse(),
      shippedModules: {
        chunks: [...(base.shippedModules as { chunks: { moduleIds: string[] }[] }).chunks]
          .reverse()
          .map((chunk) => ({ ...chunk, moduleIds: [...chunk.moduleIds].reverse() })),
      },
      jsFiles: [...base.jsFiles].reverse(),
      extras: [...EXTRAS].reverse(),
    });
    expect(generate(shuffled)).toBe(generate(base));
  });

  it('starts with the generated header, lists a sorted table and has no dates', () => {
    const output = generate();
    expect(output.startsWith('<!-- Generated by scripts/third-party-notices.ts')).toBe(true);
    const rows = output.split('\n').filter((line) => /^\| [a-z@]/.test(line));
    const names = rows.map((row) => row.split(' | ')[0]?.slice(2));
    expect(names).toEqual([...names].sort());
    expect(output).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(output).not.toMatch(/[\u2013\u2014]/);
  });

  it('fences a license text that contains backticks', () => {
    const packages = {
      ...PACKAGES,
      'node_modules/minisearch': {
        ...PACKAGES['node_modules/minisearch'],
        licenseText: 'a ```b``` c',
      },
    } as Record<string, PackageRecord>;
    expect(generate(input(), packages)).toContain('````text\na ```b``` c\n````');
  });
});

describe('workboxPackages', () => {
  it('maps every marker to its package once, sorted', () => {
    expect(workboxPackages('workbox:routing:7.4.0 workbox:core:7.4.0 workbox:core:7.4.0')).toEqual([
      'workbox-core',
      'workbox-routing',
    ]);
  });
});

describe('checkNotices', () => {
  // Catches: a check that passes on a near miss.
  it('exits non-zero on a one-character difference and says what to run', () => {
    const generated = generate();
    const committed = generated.replace('MIT License', 'MIT Licence');
    const result = checkNotices(committed, generated);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/bun run notices/);
    expect(checkNotices(generated, generated).exitCode).toBe(0);
    expect(checkNotices(undefined, generated).exitCode).toBe(1);
  });
});

describe('parseOverrides', () => {
  it('requires a reason, and a source for replacement text', () => {
    expect(() => parseOverrides({ packages: { a: {} } })).toThrow(/needs a `reason`/);
    expect(() => parseOverrides({ packages: { a: { reason: 'r', text: 't' } } })).toThrow(
      /needs its `source`/,
    );
  });

  it('parses the committed overrides file', () => {
    const file = path.join(import.meta.dirname, 'third-party-notices.overrides.json');
    const overrides = parseOverrides(JSON.parse(readFileSync(file, 'utf8')));
    expect(overrides['react-remove-scroll-bar']?.text).toMatch(/^MIT License/);
    expect(overrides['react-remove-scroll-bar']?.source).toMatch(/^https:\/\/github\.com\//);
  });
});

describe('normalizeModuleId', () => {
  const root = path.join(path.sep, 'repo');
  it('keeps package modules relative, virtual modules as they are, and drops app source', () => {
    expect(normalizeModuleId(path.join(root, 'node_modules', 'a', 'i.js'), root)).toBe(
      'node_modules/a/i.js',
    );
    expect(normalizeModuleId('\0vite/preload-helper.js', root)).toBe('\0vite/preload-helper.js');
    expect(normalizeModuleId('/@vite-plugin-pwa/virtual:pwa-register/react', root)).toBe(
      '/@vite-plugin-pwa/virtual:pwa-register/react',
    );
    expect(normalizeModuleId(path.join(root, 'src', 'main.tsx'), root)).toBeUndefined();
  });
});

describe('shippedModulesCollector', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  type Hook = (this: unknown, ...args: unknown[]) => void;
  /** Calls a plugin hook given as a function or as `{ handler }`. */
  function call(hook: unknown, ...args: unknown[]) {
    const fn = (typeof hook === 'function' ? hook : (hook as { handler: Hook }).handler) as Hook;
    fn.call({}, ...args);
  }

  const nm = (rel: string) => path.join(root ?? '', 'node_modules', rel);

  function setup() {
    root = mkdtempSync(path.join(tmpdir(), 'collector-'));
    return shippedModulesCollector(root);
  }

  /** Vite bundles the worker while it transforms its importer, before the main bundle. */
  function buildWorker(collector: ReturnType<typeof shippedModulesCollector>) {
    call(
      collector.worker().generateBundle,
      {},
      {
        'assets/search.worker-b.js': {
          type: 'chunk',
          moduleIds: [nm('minisearch/dist/es/index.js'), path.join(root ?? '', 'src/workers/w.ts')],
        },
      },
    );
  }

  /** The main bundle at the collector's turn: the worker's file is in it as an asset. */
  function buildMain(
    collector: ReturnType<typeof shippedModulesCollector>,
    { entry = 'assets/index-a.js', withWorker = true, withLicenses = true } = {},
  ) {
    const bundle: Record<string, unknown> = {
      [entry]: {
        type: 'chunk',
        moduleIds: [
          nm('react/index.js'),
          '\0vite/preload-helper.js',
          path.join(root ?? '', 'src/main.tsx'),
        ],
      },
      'assets/index-a.css': { type: 'asset', source: 'a{}' },
      ...(withWorker ? { 'assets/search.worker-b.js': { type: 'asset', source: '' } } : {}),
      ...(withLicenses
        ? { '.vite/licenses.json': { type: 'asset', source: '[{"name":"react"}]' } }
        : {}),
    };
    call(collector.main.generateBundle, {}, bundle, false);
    return bundle;
  }

  function build(options: Parameters<typeof buildMain>[1] = {}) {
    const collector = setup();
    call(collector.main.buildStart);
    buildWorker(collector);
    return { collector, bundle: buildMain(collector, options) };
  }

  function readRecord(): ShippedModules {
    return JSON.parse(
      readFileSync(path.join(root ?? '', RECORDS_DIR, 'shipped-modules.json'), 'utf8'),
    ) as ShippedModules;
  }

  const MAIN_MODULES = ['\0vite/preload-helper.js', 'node_modules/react/index.js'];
  const WORKER_CHUNK = {
    fileName: 'assets/search.worker-b.js',
    kind: 'worker',
    moduleIds: ['node_modules/minisearch/dist/es/index.js'],
  };

  it("takes Vite's license list out of the bundle and writes both records outside dist/", () => {
    const { bundle } = build();
    expect(Object.keys(bundle).sort()).toEqual([
      'assets/index-a.css',
      'assets/index-a.js',
      'assets/search.worker-b.js',
    ]);
    const dir = path.join(root ?? '', RECORDS_DIR);
    expect(readFileSync(path.join(dir, 'licenses.json'), 'utf8')).toBe('[{"name":"react"}]');
  });

  // Catches: the worker half recording into a separate, lost record.
  it("merges the worker build's chunks into the main record", () => {
    build();
    expect(readRecord().chunks).toEqual([
      { fileName: 'assets/index-a.js', kind: 'main', moduleIds: MAIN_MODULES },
      WORKER_CHUNK,
    ]);
  });

  // Catches: clearing the record per build (a watch rebuild that does not
  // touch the worker then loses it), and not pruning (an old chunk lingers).
  it('keeps the worker across a watch rebuild and prunes files no longer emitted', () => {
    const { collector } = build();
    call(collector.main.buildStart);
    buildMain(collector, { entry: 'assets/index-c.js' });
    expect(readRecord().chunks).toEqual([
      { fileName: 'assets/index-c.js', kind: 'main', moduleIds: MAIN_MODULES },
      WORKER_CHUNK,
    ]);

    // A rebuild in which the worker is gone drops it.
    call(collector.main.buildStart);
    buildMain(collector, { entry: 'assets/index-c.js', withWorker: false });
    expect(readRecord().chunks.map((chunk) => chunk.fileName)).toEqual(['assets/index-c.js']);
  });

  it('fails the build when Vite emitted no license list', () => {
    expect(() => build({ withLicenses: false })).toThrow(/did not emit \.vite\/licenses\.json/);
  });

  it('deletes the record files at the start of every build', () => {
    const { collector } = build();
    call(collector.main.buildStart);
    expect(() => readFileSync(path.join(root ?? '', RECORDS_DIR, 'licenses.json'))).toThrow();
  });
});

describe('run (the CLI against a project on disk)', () => {
  // toMatchObject does not test a RegExp against a string (any message would
  // pass), so the message is matched explicitly.
  function expectFailure(result: { exitCode: number; message: string }, message: RegExp) {
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(message);
  }

  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function write(relative: string, content: string) {
    if (!dir) throw new Error('no project');
    const full = path.join(dir, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }

  function project() {
    dir = mkdtempSync(path.join(tmpdir(), 'notices-'));
    write(
      'node_modules/react/package.json',
      JSON.stringify({ name: 'react', version: '1.0.0', license: 'MIT' }),
    );
    write('node_modules/react/LICENSE', `${MIT}\n`);
    // A nested package.json without a name, as some packages ship.
    write('node_modules/react/cjs/package.json', JSON.stringify({ type: 'commonjs' }));
    write(
      'node_modules/dexie/package.json',
      JSON.stringify({ name: 'dexie', version: '4.0.0', license: 'Apache-2.0' }),
    );
    write('node_modules/dexie/LICENSE', 'Apache text');
    write('node_modules/dexie/NOTICE', 'Dexie NOTICE');
    write(
      'node_modules/minisearch/package.json',
      JSON.stringify({ name: 'minisearch', version: '7.0.0', license: 'MIT' }),
    );
    write('node_modules/minisearch/LICENSE.txt', MIT);
    write(
      'node_modules/workbox-core/package.json',
      JSON.stringify({ name: 'workbox-core', version: '7.4.1', license: 'MIT' }),
    );
    write('node_modules/workbox-core/LICENSE', MIT);
    for (const name of [
      '@trickfilm400/rollup-plugin-off-main-thread',
      'rolldown',
      'tailwindcss',
      'vite',
      'vite-plugin-pwa',
      'workbox-build',
    ]) {
      write(
        `node_modules/${name}/package.json`,
        JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
      );
      write(`node_modules/${name}/LICENSE`, MIT);
    }
    write('scripts/third-party-notices.overrides.json', JSON.stringify({ packages: {} }));
    write('dist/assets/index-a.js', '');
    write('dist/assets/search.worker-b.js', '');
    write('dist/assets/index-a.css', '/*! tailwindcss v4 */');
    write(
      'dist/sw.js',
      'if(!self.define){}define([],function(){"SKIP_WAITING";self["workbox:core:7.4.1"]})',
    );
    writeRecords();
    return dir;
  }

  /** What the collector writes during `vite build`. */
  function writeRecords() {
    write(
      `${RECORDS_DIR}/licenses.json`,
      JSON.stringify([
        { name: 'dexie', version: '4.0.0', identifier: 'Apache-2.0', text: 'Apache text' },
        { name: 'react', version: '1.0.0', identifier: 'MIT', text: MIT },
      ]),
    );
    write(
      `${RECORDS_DIR}/shipped-modules.json`,
      JSON.stringify({
        chunks: [
          {
            fileName: 'assets/index-a.js',
            kind: 'main',
            moduleIds: [
              '/@vite-plugin-pwa/virtual:pwa-register/react',
              '\0rolldown/runtime.js',
              '\0vite/preload-helper.js',
              'node_modules/dexie/dist/dexie.mjs',
              'node_modules/react/cjs/react.production.js',
            ],
          },
          {
            fileName: 'assets/search.worker-b.js',
            kind: 'worker',
            moduleIds: ['node_modules/minisearch/dist/es/index.js'],
          },
        ],
      }),
    );
  }

  it('writes the notices from the records outside dist/, and --check then passes', () => {
    const root = project();
    expect(run(root, false).exitCode).toBe(0);
    const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('| minisearch | 7.0.0 | MIT | worker |');
    expect(notices).toContain('| workbox-core | 7.4.1 | MIT | service worker |');
    expect(notices).toContain('Dexie NOTICE');
    // The records stay where they are, so the check can follow the write.
    expect(run(root, true)).toEqual({ exitCode: 0, message: 'THIRD_PARTY_NOTICES.md is current.' });
  });

  it('--check fails on a committed file one character off, and passes on the real one', () => {
    const root = project();
    expect(run(root, false).exitCode).toBe(0);
    const noticesPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
    const good = readFileSync(noticesPath, 'utf8');

    writeFileSync(noticesPath, good.replace('| worker |', '| workers |'));
    expectFailure(run(root, true), /out of date/);

    writeFileSync(noticesPath, good);
    expect(run(root, true).exitCode).toBe(0);
  });

  // Catches: a build record back in the deployed output.
  it('fails when dist/.vite exists', () => {
    const root = project();
    write('dist/.vite/licenses.json', '[]');
    expectFailure(run(root, true), /dist\/\.vite\/ exists/);
  });

  it('asks for a build when the records are missing', () => {
    const root = project();
    rmSync(path.join(root, RECORDS_DIR), { recursive: true });
    expectFailure(run(root, true), /Run `bun run build` first/);
  });

  it('fails instead of inventing a version for a package that has none', () => {
    const root = project();
    write('node_modules/minisearch/package.json', JSON.stringify({ name: 'minisearch' }));
    expectFailure(
      run(root, true),
      /node_modules\/minisearch\/package\.json \(minisearch\) has no version/,
    );
  });

  it('fails, without writing, when a shipped package has no license text', () => {
    const root = project();
    rmSync(path.join(root, 'node_modules/minisearch/LICENSE.txt'));
    expectFailure(run(root, false), /minisearch@7\.0\.0 ships no license text/);
    expect(() => readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'))).toThrow();
  });
});
