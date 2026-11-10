import { describe, expect, it } from 'vitest';
import { engineContextFor } from '../../data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '../../data5e/normalize';
import { deriveSheet } from '../../engine/derive';
import { readMechanics } from '../../engine/effects/mechanics';
import { newCharacterDoc } from '../../engine/types';
import { parseXml } from '../xml';
import { counterPools, type FileCounter } from './classCounters';
import { convertFc5Compendium } from './compendium';

/** A counter from rows of `level:value:reset` (reset `-` for none). */
const counter = (name: string, ...rows: string[]): FileCounter => ({
  name,
  rows: rows.map((r) => {
    const [level, value, reset] = r.split(':');
    return {
      level: Number(level),
      value: value ?? '',
      ...(reset !== undefined && reset !== '-' && { reset }),
    };
  }),
});
const effects = (...counters: FileCounter[]) => counterPools(counters).castGuidance?.effects ?? [];

describe('counterPools', () => {
  it('makes a level table of plain numbers, keyed as the prose scan keys a feature', () => {
    expect(effects(counter('Ember Rage', '1:2:L', '3:3:L', '6:4:L', '9:4:L'))).toEqual([
      {
        kind: 'resource',
        key: 'ember-rage',
        label: 'Ember Rage',
        max: { byLevel: { '1': 2, '3': 3, '6': 4 } },
        reset: 'long',
      },
    ]);
  });

  it('reads %0 as the proficiency bonus and %1 to %6 as ability modifiers, at least one', () => {
    expect(
      effects(
        counter('A', '1:%0:S'),
        counter('B', '1:%6:L'),
        counter('C', '1:1+%6:L'),
        counter('D', '3:%5:L'),
      ).map((e) => e.max),
    ).toEqual([
      { f: 'prof' },
      { f: 'max(1, mod.cha)' },
      { f: '1 + mod.cha' },
      { f: 'classLevel >= 3 ? max(1, mod.wis) : 0' },
    ]);
  });

  it('comes back whole on a short rest from the level a long rest turns short', () => {
    expect(effects(counter('Inspiration', '1:%6:L', '5:%6:S'))).toEqual([
      {
        kind: 'resource',
        key: 'inspiration',
        label: 'Inspiration',
        max: { f: 'max(1, mod.cha)' },
        reset: 'long',
        regainOnShort: { f: 'classLevel >= 5 ? max(1, mod.cha) : 0' },
      },
    ]);
    expect(effects(counter('Grit', '9:1:L', '13:2:S', '17:3:S'))[0]).toMatchObject({
      max: { byLevel: { '9': 1, '13': 2, '17': 3 } },
      reset: 'long',
      regainOnShort: { byLevel: { '13': 2, '17': 3 } },
    });
  });

  it('takes the rest of its highest level when the rest changes some other way, and says so', () => {
    const pools = counterPools([counter('Soul', '3:2:S', '10:3:L')]);
    expect(pools.castGuidance?.effects[0]).toMatchObject({ reset: 'long' });
    expect(pools.castGuidance?.effects[0]?.regainOnShort).toBeUndefined();
    expect(pools.reasons).toEqual([
      'its counters whose rest changes by level (Soul) come back on the rest of their highest level',
    ]);
  });

  it('reads spells known from a counter with no rest, and reports what else it cannot count', () => {
    const pools = counterPools([
      counter('Spells Known', '1:2:-', '3:4:-'),
      counter('Infusions Known', '2:4:L'),
      counter('Tracked', '1:3:-'),
      counter('Sense', '6:%8+%5:L'),
      counter('Dawn', '1:1:D'),
    ]);
    expect(pools.castGuidance).toBeUndefined();
    expect(pools.spellsKnown).toEqual([2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(pools.reasons).toEqual([
      'its counters that count rather than spend (Infusions Known, Tracked) are not converted',
      'its counters whose numbers the converter cannot read (Sense) are not converted',
      'its counters that come back on a rest the converter does not read (Dawn) are not converted',
    ]);
  });

  it('writes what the engine reads, with no problem', () => {
    const pools = counterPools([
      counter('Ember Rage', '1:2:L', '3:3:L'),
      counter('Inspiration', '1:%6:L', '5:%6:S'),
      counter('Focus', '2:%0:S'),
    ]);
    const read = readMechanics(pools.castGuidance);
    expect(read.problems).toEqual([]);
    expect(read.readable && read.effects.length).toBe(3);
  });
});

describe('counters on the sheet', () => {
  it('counts a feature of a pool name once, by the counter', () => {
    const xml = `<compendium><class><name>Ember Knight</name><hd>10</hd>
      <autolevel level="1"><feature><name>Ember Burst</name><text>You can use this feature twice. You regain all expended uses when you finish a long rest.</text></feature>
        <counter><name>Ember Burst</name><value>2</value><reset>L</reset></counter></autolevel>
      <autolevel level="5"><counter><name>Ember Burst</name><value>4</value><reset>S</reset></counter></autolevel>
    </class></compendium>`;
    const { json } = convertFc5Compendium(parseXml(xml), { fileName: 'Ember Homebrew.xml' });
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const [cls] = (json.class ?? []) as Record<string, unknown>[];
    const resourcesAt = (levels: number) => {
      const doc = newCharacterDoc('e', 'E', 'v2.41.0');
      doc.classes = [
        {
          ref: { name: String(cls?.name), source: String(cls?.source) },
          levels,
          hp: Array<'avg'>(levels).fill('avg'),
        },
      ];
      return deriveSheet(doc, engineContextFor(reg)).resources.map((r) => [
        r.label,
        r.max,
        r.resetOn,
        r.regainOnShort,
      ]);
    };
    expect(resourcesAt(1)).toEqual([['Ember Burst', 2, 'long', undefined]]);
    expect(resourcesAt(5)).toEqual([['Ember Burst', 4, 'long', 4]]);
  });

  it('counts pools whose names have letters a key drops, each on its own', () => {
    const xml = `<compendium><class><name>Ember Knight</name><hd>10</hd>
      <autolevel level="1"><feature><name>Ember Strike</name><text>x</text></feature>
        <counter><name>Ярость</name><value>2</value><reset>L</reset></counter>
        <counter><name>Ки</name><value>3</value><reset>S</reset></counter>
        <counter><name>Ярость 2</name><value>1</value><reset>L</reset></counter>
        <counter><name>Ки 2</name><value>4</value><reset>S</reset></counter></autolevel>
    </class></compendium>`;
    const { json } = convertFc5Compendium(parseXml(xml), { fileName: 'Ember Homebrew.xml' });
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const [cls] = (json.class ?? []) as Record<string, unknown>[];
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.classes = [
      { ref: { name: String(cls?.name), source: String(cls?.source) }, levels: 1, hp: ['avg'] },
    ];
    expect(
      deriveSheet(doc, engineContextFor(reg)).resources.map((r) => [r.label, r.max, r.resetOn]),
    ).toEqual([
      ['Ярость', 2, 'long'],
      ['Ки', 3, 'short'],
      ['Ярость 2', 1, 'long'],
      ['Ки 2', 4, 'short'],
    ]);
  });
});
