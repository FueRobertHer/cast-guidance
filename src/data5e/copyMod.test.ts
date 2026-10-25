import { describe, expect, it } from 'vitest';
import {
  applyMod,
  type CopyModWarning,
  compileModRegex,
  type Entity,
  expandVersions,
  MAX_REPLACE_STRING_LENGTH,
  MAX_REPLACE_WORK,
  MAX_VERSIONS_PER_ENTITY,
  resolveCopies,
  uidOf,
  withReplaceBudget,
} from './copyMod';
import { mergeHomebrew, normalizeDataset } from './normalize';

const noWarn = (message: string) => {
  throw new Error(`unexpected warning: ${message}`);
};

describe('applyMod', () => {
  it('appendArr appends items (creating the array if missing)', () => {
    const t: Entity = { entries: [{ name: 'A' }] };
    applyMod(t, { entries: { mode: 'appendArr', items: [{ name: 'B' }] } }, noWarn);
    expect(t.entries).toEqual([{ name: 'A' }, { name: 'B' }]);

    const empty: Entity = {};
    applyMod(empty, { tags: { mode: 'appendArr', items: 'x' } }, noWarn);
    expect(empty.tags).toEqual(['x']);
  });

  it('prependArr and insertArr place items correctly', () => {
    const t: Entity = { entries: ['b', 'd'] };
    applyMod(t, { entries: { mode: 'prependArr', items: 'a' } }, noWarn);
    applyMod(t, { entries: { mode: 'insertArr', index: 2, items: 'c' } }, noWarn);
    expect(t.entries).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removeArr removes by name, names array, and index', () => {
    const t: Entity = { entries: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] };
    applyMod(t, { entries: { mode: 'removeArr', names: 'B' } }, noWarn);
    expect(t.entries).toEqual([{ name: 'A' }, { name: 'C' }]);
    applyMod(t, { entries: { mode: 'removeArr', names: ['A', 'C'] } }, noWarn);
    expect(t.entries).toEqual([]);

    const u: Entity = { list: ['x', 'y'] };
    applyMod(u, { list: { mode: 'removeArr', index: 0 } }, noWarn);
    expect(u.list).toEqual(['y']);
  });

  it('replaceArr replaces a named entry with one or more items', () => {
    const t: Entity = { entries: [{ name: 'Old', v: 1 }, { name: 'Keep' }] };
    applyMod(
      t,
      { entries: { mode: 'replaceArr', replace: 'Old', items: { name: 'New', v: 2 } } },
      noWarn,
    );
    expect(t.entries).toEqual([{ name: 'New', v: 2 }, { name: 'Keep' }]);
  });

  it('replaceArr warns when the target is missing', () => {
    const warnings: string[] = [];
    const t: Entity = { entries: [] };
    applyMod(
      t,
      { entries: { mode: 'replaceArr', replace: 'Nope', items: 'x' } },
      (m) => void warnings.push(m),
    );
    expect(warnings[0]).toMatch(/replaceArr target not found/);
  });

  it('replaceTxt rewrites strings recursively', () => {
    const t: Entity = { entries: ['a dwarf walks', { name: 'X', entries: ['dwarf again'] }] };
    applyMod(t, { entries: { mode: 'replaceTxt', replace: 'dwarf', with: 'gnome' } }, noWarn);
    expect(t.entries).toEqual(['a gnome walks', { name: 'X', entries: ['gnome again'] }]);
  });

  it('replaceTxt is always global, as in 5etools, with the file flags added', () => {
    // The one official pattern: `{ replace: 'Goblins', flags: 'i' }`. 5etools
    // builds it as `new RegExp(replace, 'g' + flags)`, so every match changes.
    const t: Entity = { entries: ['goblins and GOBLINS'] };
    applyMod(
      t,
      { entries: { mode: 'replaceTxt', replace: 'Goblins', flags: 'i', with: 'Kobolds' } },
      noWarn,
    );
    expect(t.entries).toEqual(['Kobolds and Kobolds']);
  });

  it('replaceTxt keeps a doubled g from making the pattern invalid', () => {
    const t: Entity = { entries: ['a-a'] };
    applyMod(t, { entries: { mode: 'replaceTxt', replace: 'a', flags: 'gg', with: 'b' } }, noWarn);
    expect(t.entries).toEqual(['b-b']);
  });

  it('replaceTxt refuses a pattern that backtracks catastrophically', () => {
    const warnings: string[] = [];
    const t: Entity = { entries: ['aaa'] };
    applyMod(
      t,
      { entries: { mode: 'replaceTxt', replace: '(a+)+$', with: 'X' } },
      (m) => void warnings.push(m),
    );
    expect(t.entries).toEqual(['aaa']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/replaceTxt pattern refused/);
  });

  it('replaceTxt refuses a backreference', () => {
    const warnings: string[] = [];
    const t: Entity = { entries: ['aa'] };
    applyMod(
      t,
      { entries: { mode: 'replaceTxt', replace: '(a)\\1', with: 'X' } },
      (m) => void warnings.push(m),
    );
    expect(t.entries).toEqual(['aa']);
    expect(warnings[0]).toMatch(/backreference/);
  });

  it('replaceTxt leaves strings past the length cap alone, and says so', () => {
    const warnings: string[] = [];
    const long = `dwarf ${'x'.repeat(MAX_REPLACE_STRING_LENGTH)}`;
    const t: Entity = { entries: ['a dwarf', long] };
    applyMod(
      t,
      { entries: { mode: 'replaceTxt', replace: 'dwarf', with: 'gnome' } },
      (m) => void warnings.push(m),
    );
    expect(t.entries).toEqual(['a gnome', long]);
    expect(warnings[0]).toMatch(/skipped 1 string/);
  });

  it('replaceTxt charges a repeating pattern by length squared and stops at the budget', () => {
    const warnings: string[] = [];
    const chunk = `dwarf ${'x'.repeat(MAX_REPLACE_STRING_LENGTH - 6)}`;
    const perString = chunk.length * chunk.length;
    const fits = Math.floor(MAX_REPLACE_WORK / perString);
    const t: Entity = { entries: Array.from({ length: fits + 2 }, () => chunk) };
    applyMod(
      t,
      { entries: { mode: 'replaceTxt', replace: 'dwarf\\w*', with: 'gnome' } },
      (m) => void warnings.push(m),
    );
    const out = t.entries as string[];
    expect(out[0]?.startsWith('gnome ')).toBe(true);
    expect(out[fits - 1]?.startsWith('gnome ')).toBe(true);
    expect(out[fits]?.startsWith('dwarf')).toBe(true);
    expect(warnings[0]).toMatch(/work budget used up/);
  });

  it('replaceTxt draws every operation in a merge from one budget', () => {
    const chunk = `dwarf ${'x'.repeat(MAX_REPLACE_STRING_LENGTH - 6)}`;
    const fits = Math.floor(MAX_REPLACE_WORK / (chunk.length * chunk.length));
    const op = { entries: { mode: 'replaceTxt', replace: 'dwarf\\w*', with: 'gnome' } };
    const first: Entity = { entries: Array.from({ length: fits }, () => chunk) };
    const second: Entity = { entries: [chunk] };
    const warnings: string[] = [];
    withReplaceBudget(() => {
      applyMod(first, op, (m) => void warnings.push(m));
      applyMod(second, op, (m) => void warnings.push(m));
    });
    // A fresh budget per operation would have let the second one run.
    expect((second.entries as string[])[0]?.startsWith('dwarf')).toBe(true);
    expect(warnings).toEqual([expect.stringMatching(/work budget used up/)]);
  });

  it('sets scalar and object props without a mode', () => {
    const t: Entity = { speed: 25 };
    applyMod(t, { speed: 35, size: ['M'] }, noWarn);
    expect(t.speed).toBe(35);
    expect(t.size).toEqual(['M']);
  });

  it('warns on unknown modes and continues', () => {
    const warnings: string[] = [];
    const t: Entity = { entries: ['keep'] };
    applyMod(t, { entries: { mode: 'quantumFlip' } }, (m) => void warnings.push(m));
    expect(warnings[0]).toMatch(/unknown _mod mode "quantumFlip"/);
    expect(t.entries).toEqual(['keep']);
  });
});

describe('resolveCopies', () => {
  const byUid = (list: Entity[]) => (copy: { name?: string; source?: string }) =>
    list.find((e) => uidOf(e) === `${copy.name}|${copy.source}`.toLowerCase());

  it('copies target props, overlays own, applies mods, strips meta keys', () => {
    const target: Entity = {
      name: 'Testrace',
      source: 'TST',
      page: 10,
      speed: 30,
      reprintedAs: ['Testrace|TS2'],
      entries: [{ name: 'Trait A' }],
    };
    const copy: Entity = {
      name: 'Copyrace',
      source: 'TST',
      page: 99,
      _copy: {
        name: 'Testrace',
        source: 'TST',
        _mod: { entries: { mode: 'appendArr', items: { name: 'Trait B' } } },
      },
    };
    const all = [target, copy];
    const warnings = resolveCopies(all, byUid(all), 'race');
    expect(warnings).toEqual([]);
    expect(copy.name).toBe('Copyrace');
    expect(copy.page).toBe(99); // own prop wins
    expect(copy.speed).toBe(30); // inherited
    expect(copy.reprintedAs).toBeUndefined(); // meta key stripped
    expect(copy.entries).toEqual([{ name: 'Trait A' }, { name: 'Trait B' }]);
    expect(copy._copy).toBeUndefined();
  });

  it('honors _preserve', () => {
    const target: Entity = { name: 'A', source: 'S', reprintedAs: ['A|S2'] };
    const copy: Entity = {
      name: 'B',
      source: 'S',
      _copy: { name: 'A', source: 'S', _preserve: { reprintedAs: true } },
    };
    resolveCopies([target, copy], byUid([target, copy]), 't');
    expect(copy.reprintedAs).toEqual(['A|S2']);
  });

  it('resolves copy-of-copy chains', () => {
    const a: Entity = { name: 'A', source: 'S', speed: 30 };
    const b: Entity = { name: 'B', source: 'S', _copy: { name: 'A', source: 'S' } };
    const c: Entity = { name: 'C', source: 'S', _copy: { name: 'B', source: 'S' } };
    const all = [c, b, a]; // deliberately out of order
    const warnings = resolveCopies(all, byUid(all), 't');
    expect(warnings).toEqual([]);
    expect(c.speed).toBe(30);
  });

  it('reports cycles as unresolved instead of hanging', () => {
    const a: Entity = { name: 'A', source: 'S', _copy: { name: 'B', source: 'S' } };
    const b: Entity = { name: 'B', source: 'S', _copy: { name: 'A', source: 'S' } };
    const warnings = resolveCopies([a, b], byUid([a, b]), 't');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toMatch(/unresolved _copy/);
    expect(a._copy).toBeUndefined();
  });

  it('reports missing targets', () => {
    const a: Entity = { name: 'A', source: 'S', _copy: { name: 'Ghost', source: 'S' } };
    const warnings = resolveCopies([a], byUid([a]), 't');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('Ghost');
  });

  it.each([null, 'A', ['A']])('skips a _copy of %j with a warning instead of throwing', (ref) => {
    // Homebrew is anyone's JSON, and the lookup reads `copy.name`: a null ref
    // used to throw out of here and take the whole registry with it.
    const a: Entity = { name: 'A', source: 'S' };
    const b: Entity = { name: 'B', source: 'S', speed: 25, _copy: ref };
    const warnings = resolveCopies([a, b], byUid([a, b]), 'feat');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/feat: malformed _copy/);
    expect(b).toEqual({ name: 'B', source: 'S', speed: 25 });
  });

  it('costs one entity its copy, not the others theirs, when a lookup throws', () => {
    const a: Entity = { name: 'A', source: 'S', speed: 30 };
    const b: Entity = { name: 'B', source: 'S', _copy: { name: 'A', source: 'S' } };
    const bad: Entity = { name: 'C', source: 'S', _copy: { name: 'boom', source: 'S' } };
    const all = [a, b, bad];
    const warnings = resolveCopies(
      all,
      (copy) => {
        if (copy.name === 'boom') throw new Error('lookup failed');
        return byUid(all)(copy);
      },
      't',
    );
    expect(b.speed).toBe(30);
    expect(bad._copy).toBeUndefined();
    expect(warnings.map((w) => w.message)).toEqual(['t: could not resolve _copy: lookup failed']);
  });
});

describe('mergeHomebrew', () => {
  it('keeps the registry when a homebrew entity carries a null _copy', () => {
    const reg = normalizeDataset(
      new Map([['feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] }]]),
    );
    mergeHomebrew(
      reg,
      new Map([
        [
          'brew',
          {
            feat: [
              { name: 'X', source: 'HB', _copy: null },
              { name: 'Y', source: 'HB' },
            ],
          },
        ],
      ]),
    );
    expect(reg.byType('feat').map((f) => f.name)).toEqual(['Alert', 'X', 'Y']);
    expect(reg.warnings.some((w) => w.message.includes('malformed _copy'))).toBe(true);
  });
});

describe('expandVersions', () => {
  it('expands plain versions with overlay + mods and marks _versionOf', () => {
    const base: Entity = {
      name: 'Testfolk',
      source: 'TST',
      speed: 30,
      entries: [{ name: 'Revelation', entries: ['base text'] }],
      _versions: [
        {
          name: 'Testfolk; Shadow',
          source: 'TST',
          _mod: {
            entries: {
              mode: 'replaceArr',
              replace: 'Revelation',
              items: { name: 'Revelation (Shadow)', entries: ['shadow text'] },
            },
          },
        },
      ],
    };
    const warnings: CopyModWarning[] = [];
    const versions = expandVersions(base, warnings);
    expect(warnings).toEqual([]);
    expect(versions).toHaveLength(1);
    const v = versions[0] as Entity;
    expect(v.name).toBe('Testfolk; Shadow');
    expect(v.speed).toBe(30);
    expect(v.entries).toEqual([{ name: 'Revelation (Shadow)', entries: ['shadow text'] }]);
    expect(v._versionOf).toBe('testfolk|tst');
    expect(v._versions).toBeUndefined();
    expect(base._versions).toBeDefined(); // base untouched
  });

  it('materializes _abstract/_implementations with {{variable}} substitution', () => {
    const base: Entity = {
      name: 'Scaleborn',
      source: 'TST',
      entries: [{ name: 'Breath', entries: ['placeholder'] }],
      _versions: [
        {
          _abstract: {
            name: 'Scaleborn ({{color}})',
            source: 'TST',
            _mod: {
              entries: {
                mode: 'replaceArr',
                replace: 'Breath',
                items: { name: 'Breath', entries: ['deals {{damageType}} damage'] },
              },
            },
          },
          _implementations: [
            { _variables: { color: 'Black', damageType: 'acid' } },
            { _variables: { color: 'Red', damageType: 'fire' } },
          ],
        },
      ],
    };
    const warnings: CopyModWarning[] = [];
    const versions = expandVersions(base, warnings);
    expect(versions.map((v) => v.name)).toEqual(['Scaleborn (Black)', 'Scaleborn (Red)']);
    const red = versions[1] as Entity;
    expect(red.entries).toEqual([{ name: 'Breath', entries: ['deals fire damage'] }]);
  });

  it('returns [] when there are no versions', () => {
    expect(expandVersions({ name: 'X', source: 'S' }, [])).toEqual([]);
  });

  it('caps how many entities one base expands into', () => {
    const base: Entity = {
      name: 'Manyfolk',
      source: 'TST',
      _versions: [
        {
          _abstract: { name: 'Manyfolk ({{n}})', source: 'TST' },
          _implementations: Array.from({ length: MAX_VERSIONS_PER_ENTITY + 10 }, (_, n) => ({
            _variables: { n },
          })),
        },
        { name: 'Manyfolk; Extra', source: 'TST' },
      ],
    };
    const warnings: CopyModWarning[] = [];
    const versions = expandVersions(base, warnings);
    expect(versions).toHaveLength(MAX_VERSIONS_PER_ENTITY);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/more than 64 versions/);
  });
});

describe('compileModRegex', () => {
  const refused = (pattern: string) => !(compileModRegex(pattern) instanceof RegExp);

  it('accepts the patterns real data uses', () => {
    for (const p of [
      'Goblins',
      'dwarf',
      '\\(\\d+\\)',
      '[()+*]+',
      'a|b',
      '(?:the )?goblin',
      'x{2,5}',
    ]) {
      expect(refused(p), p).toBe(false);
    }
  });

  it('refuses nested and alternating quantified groups', () => {
    for (const p of ['(a+)+', '(a*)*b', '(a|aa)+', '(?:a+)*', '((a)+)+', '(a+){2}', '(a{1,3})+']) {
      expect(refused(p), p).toBe(true);
    }
  });

  it('allows a group that cannot repeat around a quantifier', () => {
    expect(refused('(\\d+)?')).toBe(false);
    expect(refused('(a+){1}')).toBe(false);
  });

  it('refuses backreferences, numbered and named', () => {
    expect(refused('(a)\\1')).toBe(true);
    expect(refused('(?<x>a)\\k<x>')).toBe(true);
  });

  it('allows one repeating quantifier, and a fixed count does not repeat', () => {
    expect(refused('\\bdwarf\\w*')).toBe(false);
    expect(refused('.{20}Q')).toBe(false);
    expect(refused('(?:ab){3}x+')).toBe(false);
  });

  it('refuses patterns that backtrack on ordinary prose', () => {
    // Each of these froze V8 for seconds on a single 1,200 character string.
    for (const p of [
      '.*.*.*q',
      '\\w+\\w+x',
      'a+b*',
      'a{1,8192}a{1,8192}x',
      `${'.?'.repeat(20)}.{20}Q`,
      'a?b?c?d?e?',
    ]) {
      expect(refused(p), p).toBe(true);
    }
    expect(refused('a?b?c?d?')).toBe(false);
  });

  it('refuses an overlong pattern', () => {
    expect(refused('a'.repeat(256))).toBe(false);
    expect(refused('a'.repeat(257))).toBe(true);
  });

  it('reads escapes and classes as atoms, not syntax', () => {
    // An escaped paren is a literal, and a quantifier inside a class is a
    // character: neither opens or quantifies a group.
    // Each has one real quantifier; the parens and stars around it are text.
    expect(refused('\\(a+\\)\\*')).toBe(false);
    expect(refused('[(*+]a+[)?]')).toBe(false);
  });

  it('refuses a pattern that does not compile, with the reason', () => {
    const out = compileModRegex('(a');
    expect(out).not.toBeInstanceOf(RegExp);
  });

  it('keeps only usable flags, always global', () => {
    const re = compileModRegex('a', 'gixdgv');
    expect(re).toBeInstanceOf(RegExp);
    expect((re as RegExp).flags).toBe('gi');
  });
});
