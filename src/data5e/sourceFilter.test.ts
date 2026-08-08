import { describe, expect, it } from 'vitest';
import {
  ALLOW_ALL,
  applySourcePolicy,
  isPolicyNarrowed,
  parsePolicy,
  policyAllows,
  policyForSearch,
  SOURCE_PRESETS,
  type SourcePolicy,
  sourcesInGroups,
  withSource,
} from './sourceFilter';

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
