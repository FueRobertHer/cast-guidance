import { describe, expect, it } from 'vitest';
import {
  ALLOW_ALL,
  applySourcePolicy,
  backToSourcesLabel,
  characterPolicy,
  characterSourceList,
  characterSourceSwitches,
  hiddenSourcesLabel,
  isPolicyNarrowed,
  parsePolicy,
  pickPolicy,
  policyAllows,
  policyForSearch,
  SOURCE_PRESETS,
  type SourcePolicy,
  sourcesInGroups,
  withSource,
  withSwitches,
} from './sourceFilter';
import { setHomebrewSourceNames } from './sourceNames';

const spells = [
  { name: 'Fireball', source: 'PHB' },
  { name: 'Shadow Blade', source: 'XGE' },
  { name: 'Tasha’s Mind Whip', source: 'TCE' },
];
const sourceOf = (e: { source: string }) => e.source;

describe('policyAllows', () => {
  it('allows everything by default', () => {
    expect(policyAllows(ALLOW_ALL, 'PHB')).toBe(true);
    expect(policyAllows(ALLOW_ALL, 'AnythingAtAll')).toBe(true);
    expect(isPolicyNarrowed(ALLOW_ALL)).toBe(false);
  });

  it('treats "all except" as a block list', () => {
    const p: SourcePolicy = { mode: 'all', except: ['TCE'] };
    expect(policyAllows(p, 'TCE')).toBe(false);
    expect(policyAllows(p, 'PHB')).toBe(true);
    // The point of the block-list default: a book nobody has heard of yet is
    // visible rather than hidden.
    expect(policyAllows(p, 'SomeBookAddedNextYear')).toBe(true);
    expect(isPolicyNarrowed(p)).toBe(true);
  });

  it('treats "only" as an allow list, closed to newcomers', () => {
    const p: SourcePolicy = { mode: 'only', sources: ['PHB'] };
    expect(policyAllows(p, 'PHB')).toBe(true);
    expect(policyAllows(p, 'XGE')).toBe(false);
    expect(policyAllows(p, 'SomeBookAddedNextYear')).toBe(false);
    expect(isPolicyNarrowed(p)).toBe(true);
  });
});

describe('withSource', () => {
  it('stays in block-list shape when it started there', () => {
    const off = withSource(ALLOW_ALL, 'TCE', false);
    expect(off).toEqual({ mode: 'all', except: ['TCE'] });
    expect(withSource(off, 'TCE', true)).toEqual({ mode: 'all', except: [] });
  });

  it('stays in allow-list shape when it started there', () => {
    const p: SourcePolicy = { mode: 'only', sources: ['PHB'] };
    expect(withSource(p, 'XGE', true)).toEqual({ mode: 'only', sources: ['PHB', 'XGE'] });
    expect(withSource(p, 'PHB', false)).toEqual({ mode: 'only', sources: [] });
  });

  it('is idempotent', () => {
    const once = withSource(ALLOW_ALL, 'TCE', false);
    expect(withSource(once, 'TCE', false)).toEqual(once);
  });
});

describe('presets', () => {
  it('hides everything outside core when core-only is chosen', () => {
    const p = SOURCE_PRESETS.find((x) => x.id === 'core-2024')?.policy();
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(policyAllows(p, 'XPHB')).toBe(true);
    expect(policyAllows(p, 'PHB')).toBe(false);
    expect(policyAllows(p, 'TCE')).toBe(false);
    // Books that arrive with a later data download must not leak in, which is
    // the whole reason presets are allow lists.
    expect(policyAllows(p, 'BrandNewBook')).toBe(false);
  });

  it('keeps rules expansions but drops settings and adventures', () => {
    const p = SOURCE_PRESETS.find((x) => x.id === 'core-plus')?.policy();
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(policyAllows(p, 'XPHB')).toBe(true);
    expect(policyAllows(p, 'TCE')).toBe(true);
    expect(policyAllows(p, 'ERLW')).toBe(false);
    expect(policyAllows(p, 'CoS')).toBe(false);
  });

  it('restores an unnarrowed policy via the "everything" preset', () => {
    const p = SOURCE_PRESETS.find((x) => x.id === 'all')?.policy();
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(isPolicyNarrowed(p)).toBe(false);
  });
});

describe('sourcesInGroups', () => {
  it('pulls exactly the requested categories', () => {
    const core = sourcesInGroups(['core']);
    expect(core).toContain('XPHB');
    expect(core).not.toContain('TCE');
    expect(sourcesInGroups(['core', 'supplement'])).toContain('TCE');
  });
});

describe('applySourcePolicy', () => {
  it('is a no-op when nothing is hidden', () => {
    expect(applySourcePolicy(spells, ALLOW_ALL, sourceOf)).toHaveLength(3);
  });

  it('drops entities from hidden sources', () => {
    const p: SourcePolicy = { mode: 'only', sources: ['PHB'] };
    expect(applySourcePolicy(spells, p, sourceOf).map((s) => s.name)).toEqual(['Fireball']);
  });

  it('keeps entries the caller pins, so a live pick never vanishes', () => {
    const p: SourcePolicy = { mode: 'only', sources: ['PHB'] };
    const kept = applySourcePolicy(spells, p, sourceOf, (s) => s.source === 'TCE');
    expect(kept.map((s) => s.source).sort()).toEqual(['PHB', 'TCE']);
  });

  it('returns a copy rather than the caller’s array', () => {
    const out = applySourcePolicy(spells, ALLOW_ALL, sourceOf);
    expect(out).not.toBe(spells);
  });
});

describe('policyForSearch', () => {
  it('is undefined when nothing is hidden, so the worker can skip the work', () => {
    expect(policyForSearch(ALLOW_ALL)).toBeUndefined();
  });

  it('hands over a mutable copy, not the stored arrays', () => {
    const policy: SourcePolicy = { mode: 'only', sources: ['PHB'] };
    const sent = policyForSearch(policy);
    expect(sent).toEqual({ mode: 'only', sources: ['PHB'] });
    expect(sent?.mode === 'only' && sent.sources).not.toBe(policy.sources);
  });

  it('carries a block list across too', () => {
    expect(policyForSearch({ mode: 'all', except: ['TCE'] })).toEqual({
      mode: 'all',
      except: ['TCE'],
    });
  });
});

describe('sourcesInGroups ordering', () => {
  it('is sorted, which the settings preset comparison depends on', () => {
    const list = sourcesInGroups(['core', 'supplement']);
    expect(list).toEqual([...list].sort());
  });
});

describe('parsePolicy', () => {
  it('reads back what was written', () => {
    const p: SourcePolicy = { mode: 'only', sources: ['PHB', 'XGE'] };
    expect(parsePolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('falls back to allow-all for junk, so a corrupt setting cannot hide the app', () => {
    for (const junk of [undefined, null, 42, 'nope', {}, { mode: 'weird' }]) {
      expect(parsePolicy(junk)).toEqual(ALLOW_ALL);
    }
  });

  it('discards non-string entries instead of trusting the stored shape', () => {
    expect(parsePolicy({ mode: 'only', sources: ['PHB', 7, null] })).toEqual({
      mode: 'only',
      sources: ['PHB'],
    });
    expect(parsePolicy({ mode: 'all', except: 'PHB' })).toEqual({ mode: 'all', except: [] });
  });

  it('reads an "only" policy with no list as allow-all, never as hide-everything', () => {
    // An allow list with nothing on it would black out every screen in the app.
    // Corruption should degrade to the default, not to an unusable app.
    expect(parsePolicy({ mode: 'only' })).toEqual(ALLOW_ALL);
    expect(parsePolicy({ mode: 'only', sources: null })).toEqual(ALLOW_ALL);

    // An explicitly empty list is a real (if odd) user choice, so it survives.
    expect(parsePolicy({ mode: 'only', sources: [] })).toEqual({ mode: 'only', sources: [] });
  });
});

describe("a character's own sources (GAME-005)", () => {
  const device: SourcePolicy = { mode: 'only', sources: ['XPHB'] };

  it('reads an empty, missing or junk list as no restriction', () => {
    for (const raw of [[], undefined, null, 'PHB', [1, null, ''], ['  ']]) {
      expect(characterSourceList(raw)).toEqual([]);
      expect(characterPolicy(raw)).toBeUndefined();
      expect(pickPolicy(device, raw)).toEqual({ policy: device, scope: 'device' });
    }
  });

  it('replaces the device policy with the character list, never intersecting', () => {
    // Intersecting "2024 core only" with a 2014 table would empty every picker.
    const picked = pickPolicy(device, ['PHB', 'XGE']);
    expect(picked).toEqual({
      policy: { mode: 'only', sources: ['PHB', 'XGE'] },
      scope: 'character',
    });
    expect(policyAllows(picked.policy, 'XGE')).toBe(true);
    expect(policyAllows(picked.policy, 'XPHB')).toBe(false);
  });

  it('respells ids the way the dataset does, keeping ones it does not know', () => {
    setHomebrewSourceNames(new Map([['MyBrew', 'My Brew']]));
    try {
      expect(characterSourceList([' phb', 'Xge', 'PHB', 'mybrew', 'FriendsBook'])).toEqual([
        'PHB',
        'XGE',
        'MyBrew',
        'FriendsBook',
      ]);
    } finally {
      setHomebrewSourceNames(new Map());
    }
  });

  it('words the reveal offer for whose list is narrowing', () => {
    expect(hiddenSourcesLabel(3, 'device')).toBe(
      '3 hidden by your source settings. Show them anyway',
    );
    expect(hiddenSourcesLabel(3, 'character', 'spells')).toBe(
      "3 spells outside this character's sources. Show them anyway",
    );
    expect(backToSourcesLabel('character')).toBe("Back to this character's sources");
  });
});

describe("a character's collection switches (ADR-002 E2)", () => {
  const everything: SourcePolicy = { mode: 'all', except: ['KIB'] };
  const core: SourcePolicy = { mode: 'only', sources: ['XPHB'] };

  it('switches nothing without switches, so an old character sees what it saw', () => {
    for (const raw of [undefined, null, 'off', [], {}, { on: [], off: [] }, { on: 'PHB' }]) {
      const picked = pickPolicy(everything, [], raw);
      expect(picked.policy).toBe(everything);
      expect(picked.scope).toBe('device');
      // An old "only these" list reads exactly as before.
      expect(pickPolicy(everything, ['PHB', 'XGE'], raw)).toEqual({
        policy: { mode: 'only', sources: ['PHB', 'XGE'] },
        scope: 'character',
      });
    }
  });

  it('hides a source switched off for one character only, and still shows a book added later', () => {
    const osk = pickPolicy(everything, [], { off: ['MyHomebrew'] });
    const maren = pickPolicy(everything, [], undefined);
    expect(osk.scope).toBe('character');
    expect(policyAllows(osk.policy, 'MyHomebrew')).toBe(false);
    expect(policyAllows(maren.policy, 'MyHomebrew')).toBe(true);
    // "Everything except these": a source no setting has heard of shows for both.
    expect(policyAllows(osk.policy, 'BookFromNextYear')).toBe(true);
    expect(policyAllows(maren.policy, 'BookFromNextYear')).toBe(true);
    // The device keeps hiding what it hid.
    expect(policyAllows(osk.policy, 'KIB')).toBe(false);
    // The library reads the device policy, which the switch never touched.
    expect(everything).toEqual({ mode: 'all', except: ['KIB'] });
  });

  it('shows a source switched on over the device, without taking the scope', () => {
    const fromAll = pickPolicy(everything, [], { on: ['KIB'] });
    expect(policyAllows(fromAll.policy, 'KIB')).toBe(true);
    expect(fromAll.scope).toBe('device');

    // Over a preset, the switch adds to it and the preset's other books stay hidden.
    const fromCore = pickPolicy(core, [], { on: ['KIB'] });
    expect(fromCore.policy).toEqual({ mode: 'only', sources: ['XPHB', 'KIB'] });
    expect(policyAllows(fromCore.policy, 'PHB')).toBe(false);
  });

  it("goes over the character's own list both ways", () => {
    const picked = pickPolicy(core, ['PHB', 'XGE'], { on: ['KIB'], off: ['XGE'] });
    expect(picked).toEqual({
      policy: { mode: 'only', sources: ['PHB', 'KIB'] },
      scope: 'character',
    });
  });

  it('keeps the device in charge when the only switch off hides what it already hides', () => {
    const picked = pickPolicy(everything, [], { off: ['KIB'] });
    expect(picked.scope).toBe('device');
    expect(policyAllows(picked.policy, 'KIB')).toBe(false);
  });

  it('reads a source on both lists as off, respells ids and drops junk', () => {
    setHomebrewSourceNames(new Map([['MyBrew', 'My Brew']]));
    try {
      expect(
        characterSourceSwitches({ on: ['phb', 'mybrew', 7, ' ', 'xge'], off: ['MYBREW', null] }),
      ).toEqual({ on: ['PHB', 'XGE'], off: ['MyBrew'] });
      expect(characterSourceSwitches({ on: ['constructor', '__proto__'] })).toEqual({
        on: ['constructor', '__proto__'],
        off: [],
      });
      for (const raw of [undefined, null, 'PHB', ['PHB'], { on: 'PHB', off: {} }]) {
        expect(characterSourceSwitches(raw)).toEqual({ on: [], off: [] });
      }
    } finally {
      setHomebrewSourceNames(new Map());
    }
  });

  it('lays switches over a policy in its own shape', () => {
    expect(withSwitches(everything, { on: ['KIB'], off: ['A'] })).toEqual({
      mode: 'all',
      except: ['A'],
    });
    expect(withSwitches(core, { on: [], off: ['XPHB'] })).toEqual({ mode: 'only', sources: [] });
    expect(withSwitches(core, { on: [], off: [] })).toBe(core);
  });

  it('reads a source on both lists as off in either shape, even called directly', () => {
    const both = { on: ['A'], off: ['A'] };
    expect(policyAllows(withSwitches({ mode: 'only', sources: ['A'] }, both), 'A')).toBe(false);
    expect(policyAllows(withSwitches({ mode: 'all', except: [] }, both), 'A')).toBe(false);
  });
});
