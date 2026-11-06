import { afterEach, describe, expect, it } from 'vitest';
import {
  hasHomebrewTitle,
  isKnownSource,
  knownSources,
  SOURCE_GROUP_LABELS,
  SOURCE_GROUPS,
  setHomebrewSourceNames,
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

describe('homebrew titles', () => {
  afterEach(() => {
    setHomebrewSourceNames(new Map());
  });

  it('names a brew once the registry has read its file', () => {
    expect(sourceName('F')).toBe('F');
    setHomebrewSourceNames(new Map([['F', 'Flame Sword Homebrew']]));
    expect(sourceName('F')).toBe('Flame Sword Homebrew');
  });

  it('forgets a brew that is no longer loaded', () => {
    setHomebrewSourceNames(new Map([['F', 'Flame Sword Homebrew']]));
    setHomebrewSourceNames(new Map());
    expect(sourceName('F')).toBe('F');
  });

  it('cannot repaint a published book by claiming its code', () => {
    setHomebrewSourceNames(new Map([['PHB', 'My Better Handbook']]));
    expect(sourceName('PHB')).toBe("Player's Handbook (2014)");
  });

  it('stays out of the published table the presets are built from', () => {
    setHomebrewSourceNames(new Map([['F', 'Flame Sword Homebrew']]));
    expect(isKnownSource('F')).toBe(false);
    expect(knownSources()).not.toContain('F');
  });

  it('says when a title is the brew talking, which a published code never is', () => {
    expect(hasHomebrewTitle('F')).toBe(false);
    setHomebrewSourceNames(
      new Map([
        ['F', 'Flame Sword Homebrew'],
        ['PHB', 'My Better Handbook'],
      ]),
    );
    expect(hasHomebrewTitle('F')).toBe(true);
    expect(hasHomebrewTitle('PHB')).toBe(false);
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
  it('names the books the mirror added between v2.33.3 and v2.40.0', () => {
    const books: ReadonlyArray<[code: string, title: string, group: string]> = [
      ['AU', 'Arcana Unleashed', 'supplement'],
      ['AUD', 'Arcana Unleashed: Deadfall', 'adventure'],
      ['HFLotT', "Heroes' Feast: Legends of the Table", 'other'],
      ['ICC', 'World of Warcraft: Icecrown Citadel', 'adventure'],
      ['PL', 'Project_Lamordia', 'supplement'],
      ['RWG', "Red Wizards' Gambit", 'adventure'],
      ['SoS', 'Shadows of Sithicus', 'adventure'],
      ['WoW', 'D&D: World of Warcraft', 'setting'],
    ];
    for (const [code, title, group] of books) {
      expect(sourceName(code), code).toBe(title);
      expect(sourceGroup(code), code).toBe(group);
    }
  });

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
