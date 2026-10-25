import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeModuleId } from './shippedModules.ts';
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

describe('run (the CLI against a project on disk)', () => {
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
    for (const name of ['rolldown', 'tailwindcss', 'vite', 'vite-plugin-pwa']) {
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
    write('dist/sw.js', 'self["workbox:core:7.4.1"]');
    writeRecords();
    return dir;
  }

  /** What `vite build` leaves in dist/.vite/. */
  function writeRecords() {
    write(
      'dist/.vite/licenses.json',
      JSON.stringify([
        { name: 'dexie', version: '4.0.0', identifier: 'Apache-2.0', text: 'Apache text' },
        { name: 'react', version: '1.0.0', identifier: 'MIT', text: MIT },
      ]),
    );
    write(
      'dist/.vite/shipped-modules.json',
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

  it('writes the notices, deletes the build records, and --check then passes', () => {
    const root = project();
    expect(run(root, false).exitCode).toBe(0);
    const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('| minisearch | 7.0.0 | MIT | worker |');
    expect(notices).toContain('| workbox-core | 7.4.1 | MIT | service worker |');
    expect(notices).toContain('Dexie NOTICE');
    expect(() => readFileSync(path.join(root, 'dist/.vite/licenses.json'))).toThrow();
    expect(() => readFileSync(path.join(root, 'dist/.vite/shipped-modules.json'))).toThrow();

    // The records are gone, so a second run asks for a build.
    expect(run(root, true)).toMatchObject({ exitCode: 1, message: /Run `bun run build`/ });
  });

  it('--check fails on a committed file one character off, and passes on the real one', () => {
    const root = project();
    expect(run(root, false).exitCode).toBe(0);
    const noticesPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
    const good = readFileSync(noticesPath, 'utf8');

    writeFileSync(noticesPath, good.replace('| worker |', '| workers |'));
    writeRecords();
    expect(run(root, true)).toMatchObject({ exitCode: 1, message: /out of date/ });

    writeFileSync(noticesPath, good);
    writeRecords();
    expect(run(root, true).exitCode).toBe(0);
  });

  it('fails, without writing, when a shipped package has no license text', () => {
    const root = project();
    rmSync(path.join(root, 'node_modules/minisearch/LICENSE.txt'));
    expect(run(root, false)).toMatchObject({
      exitCode: 1,
      message: /minisearch@7\.0\.0 ships no license text/,
    });
    expect(() => readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'))).toThrow();
  });
});
