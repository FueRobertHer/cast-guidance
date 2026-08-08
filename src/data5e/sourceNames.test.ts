import { describe, expect, it } from 'vitest';
import {
  isKnownSource,
  knownSources,
  SOURCE_GROUP_LABELS,
  SOURCE_GROUPS,
  sourceGroup,
  sourceName,
} from './sourceNames';

describe('sourceName', () => {
  it('expands the codes a player meets first', () => {
    expect(sourceName('PHB')).toBe("Player's Handbook (2014)");
    expect(sourceName('XPHB')).toBe("Player's Handbook (2024)");
    expect(sourceName('TCE')).toBe("Tasha's Cauldron of Everything");
  });

  it('falls back to the code itself for homebrew and anything unlisted', () => {
    expect(sourceName('MyTableBrew')).toBe('MyTableBrew');
    expect(isKnownSource('MyTableBrew')).toBe(false);
    expect(isKnownSource('PHB')).toBe(true);
  });
});

describe('sourceGroup', () => {
  it('separates core, supplements, settings, and adventures', () => {
    expect(sourceGroup('XPHB')).toBe('core');
    expect(sourceGroup('XGE')).toBe('supplement');
    expect(sourceGroup('ERLW')).toBe('setting');
    expect(sourceGroup('CoS')).toBe('adventure');
  });

  it('parks unknown codes in "other" rather than dropping them', () => {
    expect(sourceGroup('MyTableBrew')).toBe('other');
  });
});

describe('the table itself', () => {
  it('covers the sources the app hardcodes elsewhere', () => {
    // SOURCES_2024 and EntityCardList's SOURCE_RANK both name codes directly;
    // a badge for one of them showing bare shorthand would be the bug this
    // table exists to prevent.
    for (const s of ['XPHB', 'XDMG', 'XMM', 'PHB', 'MPMM', 'TCE', 'VGM', 'MTF', 'XGE', 'FTD']) {
      expect(isKnownSource(s), s).toBe(true);
    }
  });

  it('only uses groups that have a label and an order slot', () => {
    for (const s of knownSources()) {
      const g = sourceGroup(s);
      expect(SOURCE_GROUPS, s).toContain(g);
      expect(SOURCE_GROUP_LABELS[g], s).toBeTruthy();
    }
  });

  it('has no source whose title is just the code again', () => {
    const lazy = knownSources().filter((s) => sourceName(s) === s);
    expect(lazy).toEqual([]);
  });
});
