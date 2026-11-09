import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import type { Fc5Context, Fc5Result } from './context';
import {
  convertSpell,
  parseComponents,
  parseDuration,
  parseRange,
  parseTime,
  readClasses,
} from './spell';

const ctx: Fc5Context = { source: 'FCTest', featNames: new Set() };

function done(result: Fc5Result) {
  if ('skip' in result) throw new Error(`skipped: ${result.skip}`);
  return result;
}

function spell(body: string, context: Fc5Context = ctx) {
  return done(convertSpell(parseXml(`<spell>${body}</spell>`), context));
}

/** The fields every clean spell needs, so a test names only what it is about. */
const BASE =
  '<level>1</level><school>EV</school><time>1 action</time><range>60 feet</range><duration>Instantaneous</duration>';

function rolls(description: string, levels: [number, string][]): string {
  return levels
    .map(([level, dice]) => `<roll description="${description}" level="${level}">${dice}</roll>`)
    .join('');
}

describe('parseTime', () => {
  it('reads a count and a unit', () => {
    expect(parseTime('1 action')).toEqual([{ number: 1, unit: 'action' }]);
    expect(parseTime('10 minutes')).toEqual([{ number: 10, unit: 'minute' }]);
    expect(parseTime('Bonus Action')).toEqual([{ number: 1, unit: 'bonus' }]);
  });

  it('keeps a reaction trigger as its condition', () => {
    expect(parseTime('1 reaction, which you take when you or an ally is struck')).toEqual([
      { number: 1, unit: 'reaction', condition: 'which you take when you or an ally is struck' },
    ]);
  });

  it('reads two alternative times', () => {
    expect(parseTime('1 action or 8 hours')).toEqual([
      { number: 1, unit: 'action' },
      { number: 8, unit: 'hour' },
    ]);
  });

  it('gives up on anything else', () => {
    expect(parseTime('When the moon rises')).toBeUndefined();
    expect(parseTime('')).toBeUndefined();
  });
});

describe('parseRange', () => {
  it('reads a distance in feet or miles', () => {
    expect(parseRange('90 feet')).toEqual({
      type: 'point',
      distance: { type: 'feet', amount: 90 },
    });
    expect(parseRange('1 mile')).toEqual({ type: 'point', distance: { type: 'miles', amount: 1 } });
  });

  it('reads the named ranges', () => {
    expect(parseRange('Self')).toEqual({ type: 'point', distance: { type: 'self' } });
    expect(parseRange('Touch')).toEqual({ type: 'point', distance: { type: 'touch' } });
    expect(parseRange('Sight')).toEqual({ type: 'point', distance: { type: 'sight' } });
    expect(parseRange('Unlimited')).toEqual({ type: 'point', distance: { type: 'unlimited' } });
    expect(parseRange('Special')).toEqual({ type: 'special' });
  });

  it('reads an area centered on the caster', () => {
    expect(parseRange('Self (15-foot cone)')).toEqual({
      type: 'cone',
      distance: { type: 'feet', amount: 15 },
    });
    expect(parseRange('Self (10-foot-radius sphere)')).toEqual({
      type: 'sphere',
      distance: { type: 'feet', amount: 10 },
    });
    expect(parseRange('Self (1-mile radius)')).toEqual({
      type: 'radius',
      distance: { type: 'miles', amount: 1 },
    });
  });

  it('gives up on an unknown shape or wording', () => {
    expect(parseRange('Self (5-foot blob)')).toBeUndefined();
    expect(parseRange('Within reach')).toBeUndefined();
  });
});

describe('parseComponents', () => {
  it('reads the component letters', () => {
    expect(parseComponents('V, S')).toEqual({ v: true, s: true });
    expect(parseComponents('v, s, m')).toEqual({ v: true, s: true, m: true });
  });

  it('keeps a material description whole, commas included', () => {
    expect(parseComponents('V, S, M (a coal, a bent nail, and a feather)')).toEqual({
      v: true,
      s: true,
      m: 'a coal, a bent nail, and a feather',
    });
  });

  it('gives up on an unknown component', () => {
    expect(parseComponents('V, S, X')).toBeUndefined();
    expect(parseComponents('')).toBeUndefined();
  });
});

describe('parseDuration', () => {
  it('reads instant, special and permanent', () => {
    expect(parseDuration('Instantaneous')).toEqual([{ type: 'instant' }]);
    expect(parseDuration('Instantaneous.')).toEqual([{ type: 'instant' }]);
    expect(parseDuration('Special')).toEqual([{ type: 'special' }]);
    expect(parseDuration('Permanent')).toEqual([{ type: 'permanent' }]);
  });

  it('reads a timed duration, with or without concentration', () => {
    expect(parseDuration('Concentration, up to 1 minute')).toEqual([
      { type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true },
    ]);
    expect(parseDuration('8 hours')).toEqual([
      { type: 'timed', duration: { type: 'hour', amount: 8 } },
    ]);
    expect(parseDuration('Up to 10 minutes')).toEqual([
      { type: 'timed', duration: { type: 'minute', amount: 10 } },
    ]);
  });

  it('reads how a lasting spell ends', () => {
    expect(parseDuration('Until dispelled')).toEqual([{ type: 'permanent', ends: ['dispel'] }]);
    expect(parseDuration('Until dispelled or triggered')).toEqual([
      { type: 'permanent', ends: ['dispel', 'trigger'] },
    ]);
  });

  it('gives up on anything else', () => {
    expect(parseDuration('Until the next dawn')).toBeUndefined();
  });
});

describe('readClasses', () => {
  it('reads a plain class list', () => {
    expect(readClasses('Wizard, Sorcerer')).toEqual({
      classes: ['Wizard', 'Sorcerer'],
      subclasses: [],
    });
  });

  it('drops the pseudo-entries some files mix in', () => {
    expect(readClasses('School: Evocation, Ritual Caster, Touch Spells, Wizard').classes).toEqual([
      'Wizard',
    ]);
  });

  it('reads a parenthesized name as a subclass', () => {
    expect(readClasses('Fighter (Eldritch Knight), Rogue (Ash Trickster)')).toEqual({
      classes: [],
      subclasses: [
        { className: 'Fighter', subclassName: 'Eldritch Knight' },
        { className: 'Rogue', subclassName: 'Ash Trickster' },
      ],
    });
  });

  it('strips (UA) and dedupes in any case', () => {
    expect(readClasses('Artificer (UA), Wizard, wizard').classes).toEqual(['Artificer', 'Wizard']);
  });

  it('takes the edition from a marker', () => {
    expect(readClasses('Wizard [5.5e], Cleric')).toEqual({
      classes: ['Wizard', 'Cleric'],
      subclasses: [],
      edition: '2024',
    });
  });
});

describe('convertSpell', () => {
  it('converts a full leveled spell', () => {
    const result = spell(`
      <name>Ember Lance</name>
      <level>3</level>
      <school>EV</school>
      <ritual>NO</ritual>
      <time>1 action</time>
      <range>Self (30-foot line)</range>
      <components>V, S, M (a coal wrapped in wire, worth 5 gp)</components>
      <duration>Instantaneous</duration>
      <classes>School: Evocation, Wizard, Sorcerer, Fighter (Eldritch Knight), Touch Spells</classes>
      <text>A lance of embers bursts out. Each creature in the line must make a Dexterity saving throw, taking 4d6 fire damage on a failed save.</text>
      <text/>
      <text>At Higher Levels. The damage increases by 1d6 for each slot level above 3rd.</text>
      ${rolls('Fire Damage', [
        [3, '4d6'],
        [4, '5d6'],
        [5, '6d6'],
        [6, '7d6'],
        [7, '8d6'],
        [8, '9d6'],
        [9, '10d6'],
      ])}
    `);
    expect(result.kind).toBe('spell');
    expect(result.name).toBe('Ember Lance');
    expect(result.edition).toBe('2014');
    expect(result.reasons).toEqual([]);
    expect(result.entity).toEqual({
      name: 'Ember Lance',
      source: 'FCTest',
      level: 3,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'line', distance: { type: 'feet', amount: 30 } },
      components: { v: true, s: true, m: 'a coal wrapped in wire, worth 5 gp' },
      duration: [{ type: 'instant' }],
      classes: {
        fromClassList: [
          { name: 'Wizard', source: 'PHB' },
          { name: 'Sorcerer', source: 'PHB' },
        ],
        fromSubclass: [
          {
            class: { name: 'Fighter', source: 'PHB' },
            subclass: { name: 'Eldritch Knight', shortName: 'Eldritch Knight', source: 'PHB' },
          },
        ],
      },
      entries: [
        'A lance of embers bursts out. Each creature in the line must make a Dexterity saving throw, taking {@damage 4d6} fire damage on a failed save.',
      ],
      entriesHigherLevel: [
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: [
            'The damage increases by {@scaledamage 4d6|3-9|1d6} for each slot level above 3rd.',
          ],
        },
      ],
      savingThrow: ['dexterity'],
    });
  });

  it('skips an entry with no name', () => {
    expect(convertSpell(parseXml(`<spell>${BASE}</spell>`), ctx)).toEqual({
      skip: 'it has no name',
    });
  });

  describe('ritual', () => {
    it('reads a ritual flag', () => {
      const { entity } = spell(`<name>Ash Ward</name>${BASE}<ritual>YES</ritual>`);
      expect(entity.meta).toEqual({ ritual: true });
    });

    it('reads "or Ritual" in the casting time', () => {
      const result = spell(
        '<name>Ash Ward</name><level>1</level><school>A</school><time>1 action or Ritual</time><range>Touch</range><duration>8 hours</duration>',
      );
      expect(result.entity.time).toEqual([{ number: 1, unit: 'action' }]);
      expect(result.entity.meta).toEqual({ ritual: true });
      expect(result.reasons).toEqual([]);
    });

    it('leaves meta out of a spell that is not a ritual', () => {
      expect(spell(`<name>Ash Ward</name>${BASE}<ritual>NO</ritual>`).entity.meta).toBeUndefined();
    });
  });

  describe('fields it cannot read', () => {
    it('reads a missing level as a cantrip and says so', () => {
      const result = spell(
        '<name>Ash Ward</name><school>A</school><time>1 action</time><range>Touch</range><duration>8 hours</duration>',
      );
      expect(result.entity.level).toBe(0);
      expect(result.reasons).toEqual(['its level was missing, so it reads as a cantrip']);
    });

    it('reports an unknown school', () => {
      const result = spell(
        '<name>Ash Ward</name><level>1</level><school>Q</school><time>1 action</time><range>Touch</range><duration>8 hours</duration>',
      );
      expect(result.entity.school).toBeUndefined();
      expect(result.reasons).toEqual(['no school of magic']);
    });

    it('keeps unparsed fields as bold-labeled lines ahead of the text', () => {
      const result = spell(`
        <name>Ash Ward</name><level>1</level><school>A</school>
        <time>When the moon rises</time>
        <range>Within reach</range>
        <components>V, S, X</components>
        <duration>Until the next dawn</duration>
        <text>A ward of ash rises.</text>
      `);
      expect(result.entity.time).toEqual([{ number: 1, unit: 'action' }]);
      expect(result.entity.range).toEqual({ type: 'special' });
      expect(result.entity.components).toBeUndefined();
      expect(result.entity.duration).toEqual([{ type: 'special' }]);
      expect(result.entity.entries).toEqual([
        '{@b Casting Time:} When the moon rises',
        '{@b Range:} Within reach',
        '{@b Components:} V, S, X',
        '{@b Duration:} Until the next dawn',
        'A ward of ash rises.',
      ]);
      expect(result.reasons).toEqual([
        'casting time kept as text',
        'range kept as text',
        'components kept as text',
        'duration kept as text',
      ]);
    });

    it('reports missing fields, but not missing components', () => {
      const result = spell('<name>Ash Ward</name><level>1</level><school>A</school>');
      expect(result.entity.time).toEqual([{ number: 1, unit: 'action' }]);
      expect(result.entity.range).toEqual({ type: 'special' });
      expect(result.entity.duration).toEqual([{ type: 'special' }]);
      expect(result.entity.components).toBeUndefined();
      expect(result.reasons).toEqual([
        'the file gives no casting time',
        'the file gives no range',
        'the file gives no duration',
      ]);
    });
  });

  describe('edition', () => {
    it('reads a name marker, and points class lists at the 2024 book', () => {
      const result = spell(`<name>Ember Lance [2024]</name>${BASE}<classes>Wizard</classes>`);
      expect(result.name).toBe('Ember Lance');
      expect(result.edition).toBe('2024');
      expect(result.entity.edition).toBe('one');
      expect(result.entity.classes).toEqual({
        fromClassList: [{ name: 'Wizard', source: 'XPHB' }],
      });
    });

    it('reads a marker in the class list', () => {
      const result = spell(`<name>Ember Lance</name>${BASE}<classes>Wizard [5.5e]</classes>`);
      expect(result.edition).toBe('2024');
    });

    it('reads a source line, from its element or from the text', () => {
      const fromElement = spell(
        `<name>Ember Lance</name>${BASE}<source>Homebrew Codex (2024) p. 7</source><text>Embers fly.</text>`,
      );
      expect(fromElement.edition).toBe('2024');
      expect(fromElement.entity.entries).toEqual([
        'Embers fly.',
        '{@i Source: Homebrew Codex (2024) p. 7}',
      ]);

      const fromText = spell(
        `<name>Ember Lance</name>${BASE}<text>Embers fly.</text><text>Source: Homebrew Codex p. 7</text>`,
      );
      expect(fromText.edition).toBe('2014');
      expect(fromText.entity.entries).toEqual(['Embers fly.', '{@i Source: Homebrew Codex p. 7}']);
    });

    it('prefers the source element over a Source line in the text', () => {
      const result = spell(
        `<name>Ember Lance</name>${BASE}<source>Element Codex</source><text>Source: Text Codex</text>`,
      );
      expect(result.entity.entries).toEqual(['{@i Source: Element Codex}']);
    });

    it('falls back to the file edition', () => {
      const result = spell(`<name>Ember Lance</name>${BASE}`, { ...ctx, fileEdition: '2024' });
      expect(result.edition).toBe('2024');
      expect(result.entity.edition).toBe('one');
    });

    it('defaults to 2014 and leaves the edition field out', () => {
      const result = spell(`<name>Ember Lance</name>${BASE}`);
      expect(result.edition).toBe('2014');
      expect(result.entity.edition).toBeUndefined();
    });
  });

  it('adds class lists from the context', () => {
    const result = spell(`<name>Ember Lance</name>${BASE}<classes>Wizard</classes>`, {
      ...ctx,
      extraClasses: new Map([['ember lance', ['Druid, Ranger (Ash Warden)']]]),
    });
    expect(result.entity.classes).toEqual({
      fromClassList: [
        { name: 'Wizard', source: 'PHB' },
        { name: 'Druid', source: 'PHB' },
      ],
      fromSubclass: [
        {
          class: { name: 'Ranger', source: 'PHB' },
          subclass: { name: 'Ash Warden', shortName: 'Ash Warden', source: 'PHB' },
        },
      ],
    });
  });

  describe('scaling dice', () => {
    it('gives a cantrip its damage by character level', () => {
      const result = spell(`
        <name>Spark Flick</name><level>0</level><school>EV</school><time>1 action</time>
        <range>60 feet</range><components>V, S</components><duration>Instantaneous</duration>
        <text>Make a ranged spell attack. On a hit, the target takes 1d8 lightning damage.</text>
        <text>Cantrip Upgrade. The damage grows by 1d8 at levels 5, 11, and 17.</text>
        ${rolls('Lightning Damage', [
          [0, '1d8'],
          [5, '2d8'],
          [11, '3d8'],
          [17, '4d8'],
        ])}
      `);
      expect(result.entity.scalingLevelDice).toEqual({
        label: 'lightning damage',
        scaling: { '1': '1d8', '5': '2d8', '11': '3d8', '17': '4d8' },
      });
      expect(result.entity.spellAttack).toEqual(['R']);
      expect(result.entity.entriesHigherLevel).toEqual([
        {
          type: 'entries',
          name: 'Cantrip Upgrade',
          entries: ['The damage grows by {@dice 1d8} at levels 5, 11, and 17.'],
        },
      ]);
      expect(result.entity.entries).toEqual([
        'Make a ranged spell attack. On a hit, the target takes {@damage 1d8} lightning damage.',
      ]);
    });

    it('gives a cantrip no scaling from a single roll', () => {
      const result = spell(
        `<name>Spark Flick</name>${BASE.replace('<level>1</level>', '<level>0</level>')}${rolls(
          'Lightning Damage',
          [[0, '1d8']],
        )}`,
      );
      expect(result.entity.scalingLevelDice).toBeUndefined();
    });

    it('uses the dice of the first description that has two or more rolls', () => {
      const result = spell(
        `<name>Spark Flick</name>${BASE.replace('<level>1</level>', '<level>0</level>')}${rolls(
          'Healing',
          [[0, '1d4']],
        )}${rolls('Cold Damage', [
          [0, '1d6'],
          [5, '2d6'],
        ])}`,
      );
      const scaling = result.entity.scalingLevelDice as { scaling: unknown } | undefined;
      expect(scaling?.scaling).toEqual({ '1': '1d6', '5': '2d6' });
    });

    it('keeps a flat bonus in the upcast tag', () => {
      const result = spell(`
        <name>Ember Lance</name>${BASE}
        <text>Using a Higher-Level Spell Slot. The damage increases by 1d8 for each slot level above 1.</text>
        ${rolls('Fire Damage', [
          [1, '2d8+5'],
          [2, '3d8+5'],
          [3, '4d8+5'],
        ])}
      `);
      expect(result.entity.entriesHigherLevel).toEqual([
        {
          type: 'entries',
          name: 'Using a Higher-Level Spell Slot',
          entries: [
            'The damage increases by {@scaledamage 2d8+5|1-3|1d8} for each slot level above 1.',
          ],
        },
      ]);
    });

    it('drops a placeholder bonus from the upcast tag', () => {
      const result = spell(`
        <name>Ember Lance</name>${BASE}
        <text>At Higher Levels. The damage increases by 1d10 for each slot level above 1.</text>
        ${rolls('Fire Damage', [
          [1, '1d10+%0'],
          [2, '2d10+%0'],
        ])}
      `);
      expect(JSON.stringify(result.entity.entriesHigherLevel)).toContain(
        '{@scaledamage 1d10|1-2|1d10}',
      );
    });

    it('leaves the higher-level text alone when the step is not constant', () => {
      const result = spell(`
        <name>Ember Lance</name>${BASE.replace('<level>1</level>', '<level>2</level>')}
        <text>At Higher Levels. The damage increases by 1d4 for each slot level above 2nd.</text>
        ${rolls('Fire Damage', [
          [2, '3d4'],
          [3, '5d4'],
          [4, '6d4'],
        ])}
      `);
      expect(result.entity.entriesHigherLevel).toEqual([
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: ['The damage increases by {@dice 1d4} for each slot level above 2nd.'],
        },
      ]);
    });

    it('leaves the higher-level text alone when the rolls start at another level', () => {
      const result = spell(`
        <name>Ember Lance</name>${BASE}
        <text>At Higher Levels. The damage increases by 1d6 for each slot level above 1st.</text>
        ${rolls('Fire Damage', [
          [2, '2d6'],
          [3, '3d6'],
        ])}
      `);
      expect(JSON.stringify(result.entity.entriesHigherLevel)).not.toContain('@scaledamage');
    });

    it('leaves the higher-level text alone when it does not name the step dice', () => {
      const result = spell(`
        <name>Ember Lance</name>${BASE}
        <text>At Higher Levels. The flames burn hotter for each slot level above 1st.</text>
        ${rolls('Fire Damage', [
          [1, '2d6'],
          [2, '3d6'],
        ])}
      `);
      expect(result.entity.entriesHigherLevel).toEqual([
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: ['The flames burn hotter for each slot level above 1st.'],
        },
      ]);
    });
  });

  describe('text scans', () => {
    it('lists each save the spell forces, once', () => {
      const result = spell(`
        <name>Ash Storm</name>${BASE}
        <text>Each creature must make a Strength saving throw. A creature that fails is pushed.</text>
        <text>A pushed creature makes a Strength saving throw again, then must succeed on a DC 15 Constitution saving throw.</text>
      `);
      expect(result.entity.savingThrow).toEqual(['strength', 'constitution']);
    });

    it('does not count a save the spell improves', () => {
      const result = spell(
        `<name>Ash Ward</name>${BASE}<text>The target has advantage on Wisdom saving throws.</text>`,
      );
      expect(result.entity.savingThrow).toBeUndefined();
    });

    it('reads melee and ranged spell attacks', () => {
      const result = spell(
        `<name>Frost Jab</name>${BASE}<text>Make a melee spell attack. If it misses, make a ranged spell attack.</text>`,
      );
      expect(result.entity.spellAttack).toEqual(['M', 'R']);
    });
  });
});
