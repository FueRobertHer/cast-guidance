import { describe, expect, it } from 'vitest';
import {
  type ConvertedKind,
  type ConvertOptions,
  convertedTotal,
  type InstalledCheck,
  notesWith,
} from '../types';
import { parseXml } from '../xml';
import { convertFc5Compendium, isSpellStub, sourceFor } from './compendium';

const FILE = 'ember_homebrew.xml';
const SOURCE = 'FCEmberHomebrew';

/** The fields a spell needs to convert cleanly. */
const SPELL_FIELDS =
  '<level>1</level><school>EV</school><time>1 action</time><range>60 feet</range><duration>Instantaneous</duration>';

function spell(name: string, extra = ''): string {
  return `<spell><name>${name}</name>${SPELL_FIELDS}${extra}</spell>`;
}

function convert(body: string, opts: ConvertOptions = { fileName: FILE }) {
  return convertFc5Compendium(parseXml(`<compendium>${body}</compendium>`), opts);
}

/** An installed check that records every question it is asked. */
function recorder(answer: (...args: Parameters<InstalledCheck>) => boolean) {
  const calls: Parameters<InstalledCheck>[] = [];
  const check: InstalledCheck = (...args) => {
    calls.push(args);
    return answer(...args);
  };
  return { calls, check };
}

function list(json: Record<string, unknown>, kind: ConvertedKind): Record<string, unknown>[] {
  return (json[kind] ?? []) as Record<string, unknown>[];
}

const MIXED = `
  <race><name>Emberkin</name><size>M</size><speed>30</speed></race>
  ${spell('Ember Lance', '<classes>Wizard</classes><text>A lance of embers.</text>')}
  <item><name>Rope Coil</name><type>G</type></item>
  <feat><name>Origin: Ember Adept</name><text>You learn a spark.</text></feat>
  <background><name>Lamplighter</name><trait><name>Feat: Ember Adept</name><text>x</text></trait></background>
`;

describe('sourceFor', () => {
  it('names the source after the file', () => {
    expect(sourceFor(FILE)).toEqual({
      json: SOURCE,
      abbreviation: SOURCE,
      full: 'ember_homebrew (Fight Club 5e)',
    });
  });

  it('drops the folder and the extension', () => {
    expect(sourceFor('C:\\games\\Ember Codex.XML').json).toBe('FCEmberCodex');
    expect(sourceFor('games/sub/ember codex.xml').json).toBe('FCEmberCodex');
    expect(sourceFor('spells_5.5e.xml').json).toBe('FCSpells55e');
  });

  it('falls back to Compendium for a name with no letters or digits', () => {
    expect(sourceFor('')).toEqual({
      json: 'FCCompendium',
      abbreviation: 'FCCompendium',
      full: 'Compendium (Fight Club 5e)',
    });
    expect(sourceFor('---.xml')).toEqual({
      json: 'FCCompendium',
      abbreviation: 'FCCompendium',
      full: '--- (Fight Club 5e)',
    });
  });

  it('caps the id length', () => {
    const { json } = sourceFor('abcdefghij abcdefghij abcdefghij abcdefghij.xml');
    expect(json).toBe('FCAbcdefghijAbcdefghijAbcdefgh');
  });
});

describe('isSpellStub', () => {
  it('is true for a spell with only a name and classes', () => {
    expect(
      isSpellStub(parseXml('<spell><name>Ember Lance</name><classes>Druid</classes></spell>')),
    ).toBe(true);
    expect(isSpellStub(parseXml('<spell><name>Ember Lance</name></spell>'))).toBe(true);
  });

  it('is false for a full spell or another element', () => {
    expect(isSpellStub(parseXml(spell('Ember Lance')))).toBe(false);
    expect(isSpellStub(parseXml('<item><name>Rope Coil</name></item>'))).toBe(false);
  });
});

describe('convertFc5Compendium', () => {
  it('converts every kind into one homebrew file, in a fixed kind order', () => {
    const { json, report } = convert(MIXED);
    expect(Object.keys(json)).toEqual(['_meta', 'spell', 'item', 'feat', 'background', 'race']);
    expect(json._meta).toEqual({
      sources: [{ json: SOURCE, abbreviation: SOURCE, full: 'ember_homebrew (Fight Club 5e)' }],
      convertedFrom: { format: 'fc5-compendium', converterVersion: 1, fileName: FILE },
    });
    for (const kind of ['spell', 'item', 'feat', 'background', 'race'] as const) {
      expect(list(json, kind).map((e) => e.source)).toEqual([SOURCE]);
    }
    expect(report).toEqual({
      format: 'fc5-compendium',
      formatName: 'Fight Club 5e',
      converterVersion: 1,
      converted: { spell: 1, item: 1, feat: 1, background: 1, race: 1 },
      notes: [],
      warnings: [],
    });
    expect(convertedTotal(report)).toBe(5);
  });

  it('points a background at a feat the same file defines', () => {
    const { json } = convert(MIXED);
    expect(list(json, 'feat')[0]?.name).toBe('Ember Adept');
    expect(list(json, 'background')[0]?.feats).toEqual([{ 'ember adept|fcemberhomebrew': true }]);
  });

  it('converts the same text to the same JSON', () => {
    const first = convert(MIXED);
    const second = convert(MIXED);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('converts an empty compendium to metadata alone', () => {
    const { json, report } = convert('');
    expect(Object.keys(json)).toEqual(['_meta']);
    expect(report.converted).toEqual({});
    expect(convertedTotal(report)).toBe(0);
    expect(report.notes).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('applies the edition the file name gives', () => {
    const { calls, check } = recorder(() => false);
    const { json } = convert(spell('Ember Lance'), {
      fileName: 'ember_5.5e.xml',
      isInstalled: check,
    });
    expect(list(json, 'spell')[0]?.edition).toBe('one');
    expect(calls).toEqual([['spell', 'Ember Lance', '2024']]);
  });

  describe('duplicates', () => {
    it('keeps the first of two entries with the same name, in any case', () => {
      const { json, report } = convert(
        `${spell('Ember Lance', '<text>First.</text>')}${spell('ember lance', '<text>Second.</text>')}`,
      );
      expect(list(json, 'spell').map((s) => s.entries)).toEqual([['First.']]);
      expect(report.converted).toEqual({ spell: 1 });
      expect(report.notes).toEqual([
        {
          kind: 'spell',
          name: 'ember lance',
          status: 'duplicate',
          reasons: ['the file has it more than once, and the first one is kept'],
        },
      ]);
    });

    it('keeps the same name in two editions', () => {
      const { json, report } = convert(`${spell('Ember Lance')}${spell('Ember Lance [2024]')}`);
      expect(list(json, 'spell')).toHaveLength(2);
      expect(report.notes).toEqual([]);
    });

    it('keeps the same name in two kinds', () => {
      const { report } = convert(
        `${spell('Ember Lance')}<item><name>Ember Lance</name><type>G</type></item>`,
      );
      expect(report.converted).toEqual({ spell: 1, item: 1 });
    });
  });

  describe('installed entries', () => {
    it('leaves out what the game data already has, and asks with kind, name and edition', () => {
      const { calls, check } = recorder((kind, name) => kind === 'item' && name === 'Rope Coil');
      const { json, report } = convert(MIXED, { fileName: FILE, isInstalled: check });
      expect(json.item).toBeUndefined();
      expect(report.converted).toEqual({ spell: 1, feat: 1, background: 1, race: 1 });
      expect(notesWith(report, 'installed')).toEqual([
        {
          kind: 'item',
          name: 'Rope Coil',
          status: 'installed',
          reasons: ['your game data already has it'],
        },
      ]);
      expect(calls).toEqual([
        // Feats are asked first, so a background's feat grant knows which
        // feats the converted file keeps.
        ['feat', 'Ember Adept', '2014'],
        ['race', 'Emberkin', '2014'],
        ['spell', 'Ember Lance', '2014'],
        ['item', 'Rope Coil', '2014'],
        ['feat', 'Ember Adept', '2014'],
        ['background', 'Lamplighter', '2014'],
      ]);
    });

    it('reports a second copy of an installed entry as a duplicate', () => {
      const { report } = convert(`${spell('Ember Lance')}${spell('Ember Lance')}`, {
        fileName: FILE,
        isInstalled: () => true,
      });
      expect(report.notes.map((n) => n.status)).toEqual(['installed', 'duplicate']);
      expect(report.converted).toEqual({});
    });
  });

  describe('notes', () => {
    it('records a partial conversion once per reason, and still counts it', () => {
      const { report } = convert(`
        <item>
          <name>Ember Ring</name><type>RG</type>
          <modifier category="bonus">initiative +2</modifier>
          <modifier category="bonus">initiative +2</modifier>
        </item>
      `);
      expect(report.converted).toEqual({ item: 1 });
      expect(report.notes).toEqual([
        {
          kind: 'item',
          name: 'Ember Ring',
          status: 'partial',
          reasons: ['the bonus "initiative +2" is kept as text'],
        },
      ]);
      expect(notesWith(report, 'partial')).toHaveLength(1);
      expect(notesWith(report, 'skipped')).toEqual([]);
    });

    it('records an entry with no name as skipped', () => {
      const { json, report } = convert('<item><type>G</type></item><feat><text>x</text></feat>');
      expect(Object.keys(json)).toEqual(['_meta']);
      expect(report.notes).toEqual([
        { kind: 'item', name: '(no name)', status: 'skipped', reasons: ['it has no name'] },
        { kind: 'feat', name: '(no name)', status: 'skipped', reasons: ['it has no name'] },
      ]);
    });

    it('keeps notes in file order', () => {
      const { report } = convert(`
        ${spell('Ember Lance')}
        <spell><name>Ash Ward</name><level>1</level></spell>
        ${spell('Ember Lance')}
        <item><name>Odd Thing</name><type>XQ</type></item>
      `);
      expect(report.notes.map((n) => [n.name, n.status])).toEqual([
        ['Ash Ward', 'partial'],
        ['Ember Lance', 'duplicate'],
        ['Odd Thing', 'partial'],
      ]);
    });
  });

  describe('warnings', () => {
    it('counts the classes, creatures and unknown elements it leaves out', () => {
      const { report } = convert(`
        <class><name>Ash Knight</name></class>
        <monster><name>Cinder Hound</name></monster>
        <class><name>Lamp Mage</name></class>
        <npc><name>Old Tom</name></npc>
        <widget/>
        <widget/>
      `);
      expect(report.converted).toEqual({});
      expect(report.notes).toEqual([]);
      expect(report.warnings).toEqual([
        '2 classes left out: classes cannot be converted yet.',
        '1 monster left out: this app does not use creatures.',
        '1 <npc> element left out: not part of this format.',
        '2 <widget> elements left out: not part of this format.',
      ]);
    });

    it('uses the plural for creatures and the singular for one class', () => {
      const { report } = convert('<monster/><monster/><class><name>Ash Knight</name></class>');
      expect(report.warnings).toEqual([
        '2 creatures left out: this app does not use creatures.',
        '1 class left out: classes cannot be converted yet.',
      ]);
    });
  });

  describe('spell stubs', () => {
    it('merges a stub class list into the full spell, wherever the stub is', () => {
      const { json, report } = convert(`
        <spell><name>Ember Lance</name><classes>Druid, Ranger (Ash Warden)</classes></spell>
        ${spell('Ember Lance', '<classes>Wizard</classes>')}
        <spell><name>Ember Lance</name><classes>Bard</classes></spell>
      `);
      expect(report.converted).toEqual({ spell: 1 });
      expect(report.notes).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(list(json, 'spell')[0]?.classes).toEqual({
        fromClassList: [
          { name: 'Wizard', source: 'PHB' },
          { name: 'Druid', source: 'PHB' },
          { name: 'Bard', source: 'PHB' },
        ],
        fromSubclass: [
          {
            class: { name: 'Ranger', source: 'PHB' },
            subclass: { name: 'Ash Warden', shortName: 'Ash Warden', source: 'PHB' },
          },
        ],
      });
    });

    it('warns about one stub for a spell the file does not define', () => {
      const { json, report } = convert(
        '<spell><name>Frost Jab</name><classes>Wizard</classes></spell>',
      );
      expect(json.spell).toBeUndefined();
      expect(report.notes).toEqual([]);
      expect(report.warnings).toEqual([
        '1 spell entry left out: it only adds class lists to spells this file does not include.',
      ]);
    });

    it('warns about several stubs, ahead of other warnings', () => {
      const { report } = convert(`
        <class><name>Ash Knight</name></class>
        <spell><name>Frost Jab</name><classes>Wizard</classes></spell>
        <spell><name>Ash Ward</name><classes>Cleric</classes></spell>
      `);
      expect(report.warnings).toEqual([
        '2 spell entries left out: they only add class lists to spells this file does not include.',
        '1 class left out: classes cannot be converted yet.',
      ]);
    });
  });
});

describe('feat grants against left-out feats', () => {
  const FILE_2024 = 'origins_5.5e.xml';
  const body = `
    <feat><name>Origin: Ember Adept</name><text>Sparks.</text></feat>
    <background>
      <name>Lamplighter</name>
      <trait><name>Feat: Ember Adept (Fire)</name><text>You gain the feat.</text></trait>
    </background>`;
  const grant = (isInstalled?: (kind: string, name: string) => boolean) => {
    const opts =
      isInstalled === undefined ? { fileName: FILE_2024 } : { fileName: FILE_2024, isInstalled };
    const { json } = convertFc5Compendium(parseXml(`<compendium>${body}</compendium>`), opts);
    return Object.keys((json.background as { feats: Record<string, true>[] }[])[0]?.feats[0] ?? {});
  };

  it("names this file's source for a feat the file keeps", () => {
    expect(grant()).toEqual(['ember adept; fire|fcorigins55e']);
  });

  it('names the installed copy for a feat left out as installed', () => {
    expect(grant((kind, name) => kind === 'feat' && name === 'Ember Adept')).toEqual([
      'ember adept; fire|xphb',
    ]);
  });
});
