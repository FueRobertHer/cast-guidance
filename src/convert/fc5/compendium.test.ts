import { describe, expect, it } from 'vitest';
import {
  type ConvertedKind,
  type ConvertOptions,
  convertedTotal,
  type InstalledCheck,
  notesWith,
} from '../types';
import { parseXml } from '../xml';
import { convertFc5Compendium, FC5_CONVERTER_VERSION, isSpellStub, sourceFor } from './compendium';

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
      convertedFrom: {
        format: 'fc5-compendium',
        converterVersion: FC5_CONVERTER_VERSION,
        fileName: FILE,
      },
    });
    for (const kind of ['spell', 'item', 'feat', 'background', 'race'] as const) {
      expect(list(json, kind).map((e) => e.source)).toEqual([SOURCE]);
    }
    expect(report).toEqual({
      format: 'fc5-compendium',
      formatName: 'Fight Club 5e',
      converterVersion: FC5_CONVERTER_VERSION,
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
        // Feats are asked first, and once, so a background's feat grant
        // knows which feats the converted file keeps.
        ['feat', 'Ember Adept', '2014'],
        ['race', 'Emberkin', '2014'],
        ['spell', 'Ember Lance', '2014'],
        ['item', 'Rope Coil', '2014'],
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
  const installed = (kind: string, name: string) => kind === 'feat' && name === 'Ember Adept';
  const grant = (opts: Omit<ConvertOptions, 'fileName'> = {}) => {
    const { json, report } = convertFc5Compendium(parseXml(`<compendium>${body}</compendium>`), {
      fileName: FILE_2024,
      ...opts,
    });
    const background = (json.background as { feats?: Record<string, true>[] }[])[0];
    const note = report.notes.find((n) => n.kind === 'background');
    return { keys: Object.keys(background?.feats?.[0] ?? {}), reasons: note?.reasons ?? [] };
  };

  it("names this file's feat whole for a feat the file keeps, since its choice is inside it", () => {
    expect(grant().keys).toEqual(['ember adept|fcorigins55e']);
  });

  it('names the installed copy for a feat left out as installed', () => {
    const officialFeat = (name: string) =>
      name === 'Ember Adept' ? 'ember adept|xphb' : undefined;
    expect(grant({ isInstalled: installed, officialFeat }).keys).toEqual([
      'ember adept; fire|xphb',
    ]);
  });

  it('guesses no book when the game data cannot say which feat it is', () => {
    expect(grant({ isInstalled: installed })).toEqual({
      keys: [],
      reasons: [
        'its feat (Ember Adept (Fire)) is in neither this file nor the game data, so it is kept as text',
      ],
    });
  });
});

describe('books', () => {
  const cited = (name: string, line: string) =>
    spell(name, `<classes>Wizard</classes><text>Text.\nSource: ${line}</text>`);
  const XGE = "Xanathar's Guide to Everything";

  it('puts each entry in the book it cites, one source per book', () => {
    const { json } = convert(`
      ${cited('Ember Lance', 'Ember Codex p. 3')}
      ${cited('Ash Ward', 'Ember Codex p. 9')}
      ${cited('Cinder Step', 'Ash Almanac p. 1')}
      ${spell('Smoke Veil', '<classes>Wizard</classes>')}
    `);
    expect(list(json, 'spell').map((s) => [s.name, s.source, s.page])).toEqual([
      ['Ember Lance', 'FCEmberCodex', 3],
      ['Ash Ward', 'FCEmberCodex', 9],
      ['Cinder Step', 'FCAshAlmanac', 1],
      ['Smoke Veil', SOURCE, undefined],
    ]);
    expect((json._meta as { sources: unknown[] }).sources).toEqual([
      { json: 'FCEmberCodex', abbreviation: 'EC', full: 'Ember Codex' },
      { json: 'FCAshAlmanac', abbreviation: 'AA', full: 'Ash Almanac' },
      { json: SOURCE, abbreviation: SOURCE, full: 'ember_homebrew (Fight Club 5e)' },
    ]);
  });

  it('keeps the citation as text when it names more than one book', () => {
    const { json } = convert(cited('Ember Lance', 'Ember Codex p. 3, Ash Almanac p. 4'));
    expect(list(json, 'spell')[0]?.entries).toEqual([
      'Text.',
      '{@i Source: Ember Codex p. 3, Ash Almanac p. 4}',
    ]);
  });

  it('asks about an entry from a book the data holds in its edition, then in its book', () => {
    const { calls, check } = recorder(() => false);
    convert(cited('Ember Lance', `${XGE} p. 3`), {
      fileName: FILE,
      isInstalled: check,
      hasBook: () => true,
    });
    expect(calls).toEqual([
      ['spell', 'Ember Lance', '2014'],
      ['spell', 'Ember Lance', '2014', 'XGE'],
    ]);
  });

  it('keeps an entry from a book the data does not hold without asking', () => {
    const { calls, check } = recorder(() => true);
    const { json } = convert(cited('Ember Lance', `${XGE} p. 3`), {
      fileName: FILE,
      isInstalled: check,
      hasBook: () => false,
    });
    expect(calls).toEqual([]);
    expect(list(json, 'spell')[0]?.source).toBe('FCXanatharSGuideToEverything');
  });

  it('finds a copy in any book it cites, under a name Fight Club words its own way', () => {
    const { check } = recorder(
      (_kind, name, _edition, book) => name === 'Ashen Emberkin' && book === 'XGE',
    );
    const { json, report } = convert(
      `<race><name>Emberkin, Ashen</name><size>M</size><speed>30</speed>
        <trait><name>Ash</name><text>Ash.\nSource: Player's Handbook p. 1, ${XGE} p. 2</text></trait></race>`,
      { fileName: FILE, isInstalled: check, hasBook: () => true },
    );
    expect(json.race).toBeUndefined();
    expect(notesWith(report, 'installed').map((n) => n.name)).toEqual(['Emberkin, Ashen']);
  });

  it('gives 2024 entries of a book of unknown edition a source of their own', () => {
    const { json } = convert(
      `${cited('Ember Lance', 'Ember Codex p. 3')}${cited('Ember Lance [5.5e]', 'Ember Codex p. 3')}`,
    );
    expect(list(json, 'spell').map((s) => [s.source, s.edition])).toEqual([
      ['FCEmberCodex', undefined],
      ['FCEmberCodex2024', 'one'],
    ]);
  });

  it('checks an entry from a free rules text by name and edition', () => {
    const { calls, check } = recorder(() => true);
    const { json } = convert(
      `${cited('Ember Lance', 'System Reference Document 5.1 p. 3')}${cited('Ash Ward', 'System Reference Document v5.2.1')}`,
      { fileName: FILE, isInstalled: check, hasBook: () => true },
    );
    expect(json.spell).toBeUndefined();
    expect(calls).toEqual([
      ['spell', 'Ember Lance', '2014'],
      ['spell', 'Ash Ward', '2024'],
    ]);
  });

  it('keeps the same name from two books as two printings', () => {
    const { json, report } = convert(
      `${cited('Ember Lance', 'Ember Codex p. 3')}${cited('Ember Lance', 'Ash Almanac p. 4')}`,
    );
    expect(list(json, 'spell')).toHaveLength(2);
    expect(report.notes).toEqual([]);
  });
});

describe('printingOf', () => {
  const at = (line: string) => `<text>Text.
Source: ${line}</text>`;
  const printing = (json: Record<string, unknown>, kind: ConvertedKind) =>
    list(json, kind).map((e) => [e.name, e.printingOf]);

  it('names the official entry an entry from a book the app knows prints', () => {
    const { json } = convert(`
      <feat><name>Lucky</name>${at("Player's Handbook (2014) p. 167")}</feat>
      <feat><name>Alert</name>${at("Player's Handbook (2024) p. 200")}</feat>
      ${spell('Ember Lance', `<classes>Wizard</classes>${at("Xanathar's Guide to Everything p. 3")}`)}
    `);
    expect(printing(json, 'feat')).toEqual([
      ['Lucky', ['Lucky|PHB']],
      ['Alert', ['Alert|XPHB']],
    ]);
    expect(printing(json, 'spell')).toEqual([['Ember Lance', ['Ember Lance|XGE']]]);
  });

  it('names the book a free rules text takes an entry from, by edition and kind', () => {
    const { json } = convert(`
      <feat><name>Grappler</name>${at('System Reference Document 5.1')}</feat>
      <feat><name>Alert</name>${at('System Reference Document v5.2.1')}</feat>
      <item><name>Rope</name><type>G</type>${at('System Reference Document 5.1')}</item>
      <item><name>Bag of Holding</name><type>W</type><magic>1</magic><detail>uncommon</detail>${at('System Reference Document v5.2.1')}</item>
    `);
    expect(printing(json, 'feat')).toEqual([
      ['Grappler', ['Grappler|PHB']],
      ['Alert', ['Alert|XPHB']],
    ]);
    expect(printing(json, 'item')).toEqual([
      ['Rope', ['Rope|PHB']],
      ['Bag of Holding', ['Bag of Holding|XDMG']],
    ]);
  });

  it('names none for a book the app does not know, no book, or another edition', () => {
    const { json } = convert(`
      <feat><name>Ember Adept</name>${at('Ember Codex p. 3')}</feat>
      <feat><name>Ash Adept</name><text>No source.</text></feat>
      <feat><name>Lucky [5.5e]</name>${at("Player's Handbook (2014) p. 167")}</feat>
    `);
    expect(printing(json, 'feat')).toEqual([
      ['Ember Adept', undefined],
      ['Ash Adept', undefined],
      ['Lucky', undefined],
    ]);
  });

  it('names an option as the official list names it', () => {
    const option = (name: string, classes: string, line: string) =>
      `<spell><name>${name}</name><level>0</level><classes>${classes}</classes>${at(line)}</spell>`;
    const { json } = convert(`
      ${option('Fist of Unbroken Air', 'Monk (Way of the Four Elements)', "Player's Handbook (2014) p. 81")}
      ${option('Helm of Awareness (Level 10)', 'Artificer Infusions', "Tasha's Cauldron of Everything p. 22")}
    `);
    expect(printing(json, 'optionalfeature')).toEqual([
      ['Fist of Unbroken Air', ['Unbroken Air|PHB']],
      ['Helm of Awareness (Level 10)', ['Helm of Awareness|TCE']],
    ]);
  });
});

describe('copies of other entries', () => {
  it('folds a starred copy`s subclass lists into the spell and leaves it out', () => {
    const { json, report } = convert(`
      ${spell('Ember Lance', '<classes>Wizard</classes>')}
      ${spell('Ember Lance*', '<classes>Cleric (Forge)</classes>')}
    `);
    expect(list(json, 'spell')).toHaveLength(1);
    expect(list(json, 'spell')[0]?.classes).toMatchObject({
      fromSubclass: [{ class: { name: 'Cleric' }, subclass: { name: 'Forge' } }],
    });
    expect(report.notes).toEqual([
      {
        kind: 'spell',
        name: 'Ember Lance',
        status: 'duplicate',
        reasons: ['a copy that adds subclass lists to a spell in the file, which gets them'],
      },
    ]);
  });

  it('leaves out a starred copy of an installed spell', () => {
    const { report } = convert(spell('Ember Lance*', '<classes>Cleric (Forge)</classes>'), {
      fileName: FILE,
      isInstalled: (_kind, name) => name === 'Ember Lance',
    });
    expect(report.notes.map((n) => n.reasons)).toEqual([
      ['a copy that adds subclass lists to a spell your game data already has'],
    ]);
  });

  it('leaves out a ritual-only copy', () => {
    const inFile = convert(
      `${spell('Ember Lance', '<classes>Wizard</classes>')}${spell('Ember Lance (Ritual Only)', '<classes>Ritual Caster</classes>')}`,
    );
    expect(list(inFile.json, 'spell').map((s) => s.name)).toEqual(['Ember Lance']);
    expect(inFile.report.notes.map((n) => n.reasons)).toEqual([
      ['a ritual-only copy of a spell in the file'],
    ]);
    const installed = convert(
      spell('Ember Lance (Ritual Only)', '<classes>Ritual Caster</classes>'),
      { fileName: FILE, isInstalled: (_kind, name) => name === 'Ember Lance' },
    );
    expect(installed.report.notes.map((n) => n.reasons)).toEqual([
      ['a ritual-only copy of a spell your game data already has'],
    ]);
  });

  it('makes a homebrew feat split per choice one feat with the choice', () => {
    const feat = (ability: string) =>
      `<feat><name>Ember Fear (${ability})</name><text>Roar.</text><modifier category="ability score">${ability} +1</modifier></feat>`;
    const { json, report } = convert(`${feat('Strength')}${feat('Charisma')}`);
    expect(list(json, 'feat').map((f) => [f.name, f.ability])).toEqual([
      ['Ember Fear', [{ choose: { from: ['str', 'cha'] } }]],
    ]);
    expect(report.notes).toEqual([
      {
        kind: 'feat',
        name: 'Ember Fear (Charisma)',
        status: 'duplicate',
        reasons: ['a copy per choice of a feat, and the copies are one feat with the choice here'],
      },
    ]);
  });

  it('leaves out every choice of a feat the game data has', () => {
    const { json, report } = convert(
      '<feat><name>Ember Fear (Strength)</name><text>Roar.</text></feat><feat><name>Ember Fear (Charisma)</name><text>Roar.</text></feat>',
      { fileName: FILE, isInstalled: (_kind, name) => name === 'Ember Fear' },
    );
    expect(json.feat).toBeUndefined();
    expect(report.notes.map((n) => n.reasons[0])).toEqual([
      'a copy per choice of a feat your game data already has, choices included',
      'a copy per choice of a feat your game data already has, choices included',
    ]);
  });

  it('leaves out copies per choice of a feat the file has whole', () => {
    const { json, report } = convert(
      '<feat><name>Ember Fear</name><text>Roar.</text></feat>' +
        '<feat><name>Ember Fear (Strength)</name><text>Roar.</text></feat>' +
        '<feat><name>Ember Fear (Charisma)</name><text>Roar.</text></feat>',
    );
    expect(list(json, 'feat').map((f) => f.name)).toEqual(['Ember Fear']);
    expect(report.notes.map((n) => [n.name, n.reasons[0]])).toEqual([
      ['Ember Fear (Strength)', 'a copy per choice of a feat the file has whole'],
      ['Ember Fear (Charisma)', 'a copy per choice of a feat the file has whole'],
    ]);
  });

  it('reads a lone bracket as a choice only when it names an ability', () => {
    const isInstalled = (_kind: string, name: string) => name === 'Ember Fear';
    const revised = convert('<feat><name>Ember Fear (Revised)</name><text>Roar.</text></feat>', {
      fileName: FILE,
      isInstalled,
    });
    expect(list(revised.json, 'feat').map((f) => f.name)).toEqual(['Ember Fear (Revised)']);
    const strength = convert('<feat><name>Ember Fear (Strength)</name><text>Roar.</text></feat>', {
      fileName: FILE,
      isInstalled,
    });
    expect(strength.json.feat).toBeUndefined();
  });

  it('reads one bracket the file repeats as no choice', () => {
    const { json } = convert(
      '<feat><name>Ember Fear</name><text>Roar.</text></feat>' +
        '<feat><name>Ember Fear (Revised)</name><text>Roar louder.</text></feat>' +
        '<feat><name>Ember Fear (Revised)</name><text>Roar louder.</text></feat>',
    );
    expect(list(json, 'feat').map((f) => f.name)).toEqual(['Ember Fear', 'Ember Fear (Revised)']);
  });

  it('gives a stub`s lists to the spell whose name marks no edition, or to all when unsure', () => {
    const fromSubclass = (json: Record<string, unknown>) =>
      list(json, 'spell').map((s) => [
        s.edition,
        (s.classes as { fromSubclass?: unknown[] }).fromSubclass?.length,
      ]);
    const unmarked = convert(`
      ${spell('Ember Hold', '<classes>Wizard</classes>')}
      ${spell('Ember Hold [5.5e]', '<classes>Wizard [5.5e]</classes>')}
      <spell><name>Ember Hold</name><classes>Cleric [Legacy] (Forge)</classes></spell>
    `);
    expect(fromSubclass(unmarked.json)).toEqual([
      [undefined, 1],
      ['one', undefined],
    ]);
    const unsure = convert(`
      ${spell('Ember Hold (Legacy)', '<classes>Wizard</classes>')}
      ${spell('Ember Hold [5.5e]', '<classes>Wizard [5.5e]</classes>')}
      <spell><name>Ember Hold</name><classes>Cleric (Forge)</classes></spell>
    `);
    expect(fromSubclass(unsure.json)).toEqual([
      [undefined, 1],
      ['one', 1],
    ]);
  });

  it('gives a starred copy`s lists to the spell of its own edition', () => {
    const { json } = convert(`
      ${spell('Ember Hold', '<classes>Wizard</classes>')}
      ${spell('Ember Hold [5.5e]', '<classes>Wizard [5.5e]</classes>')}
      ${spell('Ember Hold* [5.5e]', '<classes>Cleric [5.5e] (Forge)</classes>')}
    `);
    expect(
      list(json, 'spell').map((s) => [
        s.edition,
        (s.classes as { fromSubclass?: unknown[] }).fromSubclass?.length,
      ]),
    ).toEqual([
      [undefined, undefined],
      ['one', 1],
    ]);
  });

  it('reads a book tag in a name as no part of it', () => {
    const { json } = convert(spell('Ember Lance (HB)', '<classes>Wizard</classes>'));
    expect(list(json, 'spell')[0]?.name).toBe('Ember Lance');
  });
});

describe('class options', () => {
  it('converts options to optional features, and warns when no class offers a list', () => {
    const { json, report } = convert(`
      <spell><name>Invocation: Ember Sight</name><level>0</level><classes>Eldritch Invocations</classes><text>Smoke.</text></spell>
      <spell><name>Ash Rite</name><level>0</level><classes>Ember Knight: Rites</classes><text>Ash.</text></spell>
    `);
    expect(list(json, 'optionalfeature').map((o) => [o.name, o.featureType])).toEqual([
      ['Ember Sight', ['EI']],
      ['Ash Rite', ['Ember Knight: Rites']],
    ]);
    expect(report.warnings).toEqual([
      '1 class option is for a class this app cannot convert yet (Ember Knight: Rites). It is in the Library under Optional features, but no character can pick it yet.',
    ]);
  });

  it('counts options, not lists, in the warning', () => {
    const { report } = convert(
      '<spell><name>Ash Rite</name><level>0</level><classes>Ember Knight: Rites, Ash Knight: Rites</classes></spell>',
    );
    expect(report.warnings[0]).toMatch(/^1 class option is for classes /);
  });

  it('asks about an option as an optional feature', () => {
    const { calls, check } = recorder(() => false);
    convert(
      '<spell><name>Invocation: Ember Sight</name><level>0</level><classes>Eldritch Invocations</classes></spell>',
      { fileName: FILE, isInstalled: check },
    );
    expect(calls).toEqual([['optionalfeature', 'Ember Sight', '2014']]);
  });
});
