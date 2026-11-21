// Homebrew files are anyone's JSON, merged on the main thread on every registry
// rebuild. The import bounds a file, not what `_copy` and `_versions` build
// from it: before the build budget, 200 copies of a 1 MB entry built 201 MB,
// 85 KB of `_versions` variables built 80 MB, and 22 variables that name each
// other built 4 MB from 639 characters, each one more doubling it. These keep
// what a merge builds under `MAX_BUILT_CHARS`, and pin the other hostile
// shapes the review named: `{toString: 1}` where text is read, and keys that
// name the prototype.
import { describe, expect, it } from 'vitest';
import { applyMod, type Entity, MAX_BUILT_CHARS } from './copyMod';
import { mergeHomebrew, normalizeDataset } from './normalize';

function merged(file: Record<string, unknown>, official = new Map<string, unknown>()) {
  const reg = normalizeDataset(official);
  mergeHomebrew(reg, new Map([['file', file]]));
  return reg;
}

const built = (list: readonly Entity[]) => list.reduce((n, e) => n + JSON.stringify(e).length, 0);
const fileSize = (file: unknown) => JSON.stringify(file).length;

describe('what a homebrew merge builds', () => {
  it('stops versions whose variables put a long value in many places', () => {
    const value = 'x'.repeat(20_000);
    const file = {
      race: [
        {
          name: 'Kin',
          source: 'HB',
          _versions: [
            {
              _abstract: { name: 'Kin {{n}}', source: 'HB', entries: ['{{v}}'.repeat(1_000)] },
              _implementations: Array.from({ length: 64 }, (_, n) => ({
                _variables: { n: `${n}`, v: value },
              })),
            },
          ],
        },
      ],
    };
    expect(fileSize(file)).toBeLessThan(1_400_000);
    const reg = merged(file);
    // 20 MB each: none fits, and the race itself stands.
    expect(reg.byType('race').map((r) => r.name)).toEqual(['Kin']);
    expect(reg.warnings).toHaveLength(64);
    expect(reg.warnings[0]?.message).toBe(
      `versions: a version could not be built: its variables would build more than the ${MAX_BUILT_CHARS} characters one merge may`,
    );
  });

  it('stops variables that name each other before they double past the budget', () => {
    const vars: Record<string, string> = {};
    for (let i = 0; i < 40; i++) vars[`a${i}`] = `{{a${i + 1}}}{{a${i + 1}}}`;
    vars.a40 = 'x';
    const file = {
      race: [
        {
          name: 'Kin',
          source: 'HB',
          _versions: [
            {
              _abstract: { name: 'Kin (Deep)', source: 'HB', entries: ['{{a0}}'] },
              _implementations: [{ _variables: vars }],
            },
          ],
        },
      ],
    };
    expect(fileSize(file)).toBeLessThan(1_100);
    const reg = merged(file);
    expect(reg.byType('race').map((r) => r.name)).toEqual(['Kin']);
    expect(reg.warnings.map((w) => w.message)).toEqual([
      `versions: a version could not be built: its variables would build more than the ${MAX_BUILT_CHARS} characters one merge may`,
    ]);
  });

  it('builds the copies that fit and leaves the rest unresolved', () => {
    const target = {
      name: 'Big',
      source: 'HB',
      level: 1,
      entries: Array.from({ length: 5 }, () => 'y'.repeat(200_000)),
    };
    const copies = Array.from({ length: 200 }, (_, i) => ({
      name: `Copy ${i}`,
      source: 'HB',
      _copy: { name: 'Big', source: 'HB' },
    }));
    const reg = merged({ spell: [target, ...copies] });
    const spells = reg.byType('spell');
    expect(spells).toHaveLength(201);
    const resolved = spells.filter((s) => Array.isArray(s.entries));
    // Each copy builds about 1 MB, so the budget holds 15 of them.
    expect(resolved.length).toBe(1 + Math.floor(MAX_BUILT_CHARS / fileSize(target)));
    expect(built(spells)).toBeLessThan(MAX_BUILT_CHARS + 2 * fileSize(target));
    expect(reg.warnings).toHaveLength(200 - (resolved.length - 1));
    expect(reg.warnings[0]?.message).toBe(
      `homebrew spell: could not resolve _copy: it would build more than the ${MAX_BUILT_CHARS} characters one merge may`,
    );
  });

  it('gives every merge a budget of its own', () => {
    const target = { name: 'Big', source: 'HB', entries: ['y'.repeat(200_000)] };
    const file = {
      spell: [
        target,
        ...Array.from({ length: 70 }, (_, i) => ({
          name: `Copy ${i}`,
          source: 'HB',
          _copy: { name: 'Big', source: 'HB' },
        })),
      ],
    };
    const first = merged(file);
    const second = merged(file);
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
  });

  it('builds what the books build, versions and copies alike', () => {
    const reg = merged(
      {
        race: [
          {
            name: 'Kin',
            source: 'HB',
            _versions: [
              {
                _abstract: { name: 'Kin ({{color}})', source: 'HB' },
                _implementations: [
                  { _variables: { color: 'Red' } },
                  { _variables: { color: 'Blue' } },
                ],
              },
            ],
          },
        ],
        spell: [{ name: 'Glow', source: 'HB', _copy: { name: 'Light', source: 'TST' } }],
      },
      new Map([
        ['spells/spells-tst.json', { spell: [{ name: 'Light', source: 'TST', level: 0 }] }],
      ]),
    );
    expect(reg.byType('race').map((r) => r.name)).toEqual(['Kin', 'Kin (Red)', 'Kin (Blue)']);
    expect(reg.get('spell', 'Glow', 'HB')?.level).toBe(0);
    expect(reg.warnings).toEqual([]);
  });
});

describe('text a _mod reads, as JSON that String() refuses', () => {
  const odd = { toString: 1 };
  const target = () => ({ entries: ['a', { name: 'Keep', entries: [] }] }) as Entity;

  it.each([
    ['replaceTxt pattern', { mode: 'replaceTxt', replace: odd, with: 'x' }],
    ['replaceTxt replacement', { mode: 'replaceTxt', replace: 'a', with: odd }],
    ['removeArr names', { mode: 'removeArr', names: [odd] }],
    [
      'replaceArr regex over an odd name',
      { mode: 'replaceArr', replace: { regex: 'z' }, items: ['q'] },
    ],
  ])('applyMod reads a %s without throwing', (_, op) => {
    const t = target();
    (t.entries as unknown[]).push({ name: odd });
    const warnings: string[] = [];
    expect(() => applyMod(t, { entries: op }, (m) => warnings.push(m))).not.toThrow();
  });

  it('keeps the registry when a copy reaches one through the merge', () => {
    const reg = merged(
      {
        spell: [
          {
            name: 'Dim',
            source: 'HB',
            _copy: {
              name: 'Light',
              source: 'TST',
              _mod: { entries: { mode: 'replaceTxt', replace: odd, with: 'x' } },
            },
          },
          // normalize.ts reads a copy reference with String(), inside the
          // copy resolver: it costs that copy, not the registry.
          { name: 'Gloom', source: 'HB', _copy: { name: odd, source: 'TST' } },
        ],
      },
      new Map([
        ['spells/spells-tst.json', { spell: [{ name: 'Light', source: 'TST', entries: ['a'] }] }],
      ]),
    );
    expect(reg.byType('spell').map((s) => s.name)).toEqual(['Light', 'Dim', 'Gloom']);
    expect(reg.get('spell', 'Dim', 'HB')?.entries).toEqual(['a']);
    expect(reg.warnings.map((w) => w.entity)).toContain('gloom|hb');
  });
});

describe('keys that name the prototype', () => {
  const official = () =>
    new Map<string, unknown>([
      ['spells/spells-tst.json', { spell: [{ name: 'Light', source: 'TST', entries: ['a'] }] }],
    ]);
  const parse = (text: string) => JSON.parse(text) as Record<string, unknown>;

  it('leaves every merged entry, and the object prototype, as they were', () => {
    const reg = merged(
      parse(`{"spell": [
        {"name": "Own", "source": "HB", "__proto__": {"own": 1},
         "_copy": {"name": "Light", "source": "TST"}},
        {"name": "Mod", "source": "HB",
         "_copy": {"name": "Light", "source": "TST", "_mod": {"__proto__": {"viaMod": 1}}}},
        {"name": "Deep", "source": "HB", "entries": [{"__proto__": {"deep": 1}, "x": "a"}],
         "_copy": {"name": "Light", "source": "TST",
           "_mod": {"entries": {"mode": "replaceTxt", "replace": "a", "with": "b"}}}}
      ]}`),
      official(),
    );
    for (const e of reg.byType('spell')) {
      expect(Object.getPrototypeOf(e)).toBe(Object.prototype);
      for (const part of Array.isArray(e.entries) ? e.entries : []) {
        if (typeof part === 'object') expect(Object.getPrototypeOf(part)).toBe(Object.prototype);
      }
    }
    const probe: Record<string, unknown> = {};
    expect([probe.own, probe.viaMod, probe.deep]).toEqual([undefined, undefined, undefined]);
    expect(reg.warnings.map((w) => w.message)).toEqual([
      'homebrew spell: unsupported _mod prop "__proto__"',
    ]);
  });

  it('keeps a constructor or prototype key as plain data', () => {
    const reg = merged(
      parse(`{"spell": [{"name": "Odd", "source": "HB",
        "_copy": {"name": "Light", "source": "TST",
          "_mod": {"constructor": "c", "prototype": {"p": 1}}}}]}`),
      official(),
    );
    const odd = reg.get('spell', 'Odd', 'HB');
    expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
    expect(Object.hasOwn(odd ?? {}, 'constructor')).toBe(true);
    expect(({} as { constructor: unknown }).constructor).toBe(Object);
  });
});
