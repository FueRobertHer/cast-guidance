import { describe, expect, it } from 'vitest';
import {
  applyMod,
  type CopyModWarning,
  type Entity,
  expandVersions,
  resolveCopies,
  uidOf,
} from './copyMod';

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
});
