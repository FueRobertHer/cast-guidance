import { describe, expect, it } from 'vitest';
import { engineContextFor } from '../../data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '../../data5e/normalize';
import { CAST_GUIDANCE_LIMITS } from '../../engine/castGuidance';
import { deriveSheet } from '../../engine/derive';
import { readMechanics } from '../../engine/effects/mechanics';
import { newCharacterDoc } from '../../engine/types';
import { childElements, parseXml } from '../xml';
import { dropOwnUses } from './classCounters';
import { convertFc5Compendium } from './compendium';
import { addGuidance, readFeatureModifiers } from './featureModifiers';

const mod = (category: string, text: string) =>
  `<modifier category="${category}">${text}</modifier>`;
const featureEl = (mods: string) => {
  const root = parseXml(`<compendium><feature><name>F</name>${mods}</feature></compendium>`);
  const el = childElements(root, 'feature')[0];
  if (el === undefined) throw new Error('no feature');
  return el;
};
const read = (mods: string, prose = '') => readFeatureModifiers(featureEl(mods), prose);

describe('readFeatureModifiers', () => {
  it('reads each plain tag as the effect the engine counts, which it reads with no problem', () => {
    const got = read(
      [
        mod('bonus', 'speed +10'),
        mod('bonus', 'speed + 5'),
        mod('ability score', 'strength +2'),
        mod('ability score', 'constitution Score +2'),
        mod('bonus', 'ac +2'),
        mod('bonus', 'spell attack +1'),
        mod('bonus', 'spell dc +1'),
        mod('bonus', 'weapon attacks +1'),
        mod('bonus', 'ranged attacks +1'),
        mod('bonus', 'melee attack -1'),
        mod('Bonus', 'Initiative + Proficiency Bonus'),
        mod('bonus', 'initiative +%0'),
        mod('bonus', 'initiative +2'),
      ].join(''),
      'Your Strength and Constitution scores increase by 2, to a maximum of 22.',
    );
    expect(got.kept).toEqual([]);
    expect(got.effects).toEqual([
      { kind: 'speedBonus', amount: 10 },
      { kind: 'speedBonus', amount: 5 },
      { kind: 'abilityBonus', ability: 'str', amount: 2, max: 22 },
      { kind: 'abilityBonus', ability: 'con', amount: 2, max: 22 },
      { kind: 'acBonus', amount: 2 },
      { kind: 'attackBonus', attack: 'spell', amount: 1 },
      { kind: 'spellDcBonus', amount: 1 },
      { kind: 'attackBonus', attack: 'weapon', amount: 1 },
      { kind: 'attackBonus', attack: 'weapon', scope: 'ranged', amount: 1 },
      { kind: 'attackBonus', attack: 'weapon', scope: 'melee', amount: -1 },
      { kind: 'initiativeBonus', profBonus: true },
      { kind: 'initiativeBonus', profBonus: true },
      { kind: 'initiativeBonus', amount: 2 },
    ]);
    const mechanics = readMechanics({ v: 1, effects: got.effects });
    expect(mechanics.problems).toEqual([]);
    expect(mechanics.readable && mechanics.effects.length).toBe(got.effects.length);
  });

  it('keeps as text what Fight Club means two ways, or what no field holds', () => {
    const kept = [
      'persuasion +%0',
      'wisdom save +%0',
      'hp +1',
      'Passive Wisdom +5',
      'unarmored armor class +3',
      'strength +%0',
      'speed',
      'speed +1000',
      'melee damage +1',
    ];
    const got = read(
      [
        mod('skill', kept[0] ?? ''),
        mod('saving throw', kept[1] ?? ''),
        mod('bonus', kept[2] ?? ''),
        mod('bonus', kept[3] ?? ''),
        mod('bonus', kept[4] ?? ''),
        mod('ability score', kept[5] ?? ''),
        mod('bonus', kept[6] ?? ''),
        mod('bonus', kept[7] ?? ''),
        mod('bonus', kept[8] ?? ''),
      ].join(''),
    );
    expect(got.effects).toEqual([]);
    expect(got.kept).toEqual(kept);
  });

  it('holds a speed back as its words say, and keeps one whose armor no field names', () => {
    const speed = mod('bonus', 'speed +10');
    expect(
      read(speed, "Your speed increases while you aren't wearing heavy armor.").effects,
    ).toEqual([{ kind: 'speedBonus', amount: 10, unless: 'heavyArmor' }]);
    expect(
      read(speed, 'While you are not wearing armor or wielding a shield, your speed increases.')
        .effects,
    ).toEqual([{ kind: 'speedBonus', amount: 10, unless: 'armorOrShield' }]);
    expect(
      read(speed, 'While you are wearing light armor or no armor, it increases.').kept,
    ).toEqual(['speed +10']);
    expect(read(mod('bonus', 'ac +1'), 'While you are wearing armor, +1 to AC.').kept).toEqual([
      'ac +1',
    ]);
  });

  it('raises a score past 20 only as far as the words say', () => {
    const str = mod('ability score', 'strength +4');
    const max = (prose: string) => read(str, prose).effects[0]?.max;
    expect(max('Your maximum for those scores is now 24.')).toBe(24);
    expect(max('The maximum value of these abilities becomes 24.')).toBe(24);
    expect(max('Your Strength score increases by 4.')).toBeUndefined();
    expect(max('It increases, to a maximum of 18.')).toBeUndefined();
    expect(max('No maximum. Later, 24 of them.')).toBeUndefined();
  });

  it('gives no more effects than the engine counts, keeping the rest', () => {
    const many = Array.from({ length: CAST_GUIDANCE_LIMITS.effectsPerEntry + 3 }, () =>
      mod('bonus', 'speed +5'),
    ).join('');
    const got = read(many);
    expect(got.effects).toHaveLength(CAST_GUIDANCE_LIMITS.effectsPerEntry);
    expect(got.kept).toHaveLength(3);
  });
});

describe('addGuidance', () => {
  it('keeps what an entry holds, each kind dropped once', () => {
    const feature: Record<string, unknown> = {};
    addGuidance(feature, { effects: [{ kind: 'acBonus', amount: 1 }], drop: ['acBonus'] });
    dropOwnUses(feature);
    addGuidance(feature, { effects: [{ kind: 'acBonus', amount: 2 }], drop: ['acBonus'] });
    expect(feature.castGuidance).toEqual({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'acBonus', amount: 2 },
      ],
      drop: [{ kind: 'acBonus' }, { kind: 'resource' }],
    });
  });
});

describe('modifiers on the sheet', () => {
  const opt = ' optional="YES"';
  const feature = (name: string, text: string, mods = '', attrs = '') =>
    `<feature${attrs}><name>${name}</name><text>${text}</text>${mods}</feature>`;
  const convert = (classXml: string) =>
    convertFc5Compendium(parseXml(`<compendium>${classXml}</compendium>`), {
      fileName: 'Ember Homebrew.xml',
    });

  it("counts a homebrew class's tags once each, beside what its words give", () => {
    const { json, report } = convert(`<class><name>Ember Knight</name><hd>10</hd>
      <autolevel level="1">
        ${feature('Swift Feet', 'Your speed increases by 10 feet.', mod('bonus', 'speed +10'))}
        ${feature('Holy Shield', 'You gain a +2 bonus to your AC.', mod('bonus', 'ac +2'))}
        ${feature('Quick Hands', 'You add your proficiency bonus to your initiative.', mod('bonus', 'initiative +%0'))}
        ${feature('Alert Mind', 'You gain a +1 bonus to initiative.', mod('bonus', 'initiative +1'))}
        ${feature('Mighty', 'Your Strength score increases by 2, to a maximum of 22.', mod('ability score', 'strength +2'))}
        ${feature('Bold', 'You are proficient in Persuasion.', mod('skill', 'persuasion +%0'))}
      </autolevel></class>`);
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const [cls] = (json.class ?? []) as Record<string, unknown>[];
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.abilities = {
      method: 'standard',
      base: { str: 20, dex: 14, con: 12, int: 10, wis: 10, cha: 8 },
    };
    doc.classes = [
      { ref: { name: String(cls?.name), source: String(cls?.source) }, levels: 1, hp: ['avg'] },
    ];
    const sheet = deriveSheet(doc, engineContextFor(reg));
    expect(sheet.speedWalk.value).toBe(40);
    // 10, Dexterity's 2, Holy Shield's 2.
    expect(sheet.ac.value).toBe(14);
    // Dexterity's 2, the proficiency bonus, and Alert Mind's 1, whose words the
    // prose scan reads too: its words and its tag are one bonus.
    expect(sheet.initiative.value).toBe(5);
    expect(sheet.abilities.str.value).toBe(22);
    expect(sheet.warnings).toEqual([]);
    expect(report.notes.find((n) => n.kind === 'class')?.reasons.join(' ')).toContain(
      'Bold: persuasion +%0',
    );
  });

  it("leaves an official printing's tags to what its data gives", () => {
    const phb = (text: string) => `${text}\nSource: Player's Handbook p. 49`;
    const { json, report } = convert(`<class><name>Barbarian</name><hd>12</hd>
      <autolevel level="1">${feature('Rage', phb('You rage.'))}${feature('Unarmored Defense', phb('You defend.'))}</autolevel>
      <autolevel level="2">${feature('Reckless Attack', phb('You attack.'))}</autolevel>
      <autolevel level="5">${feature('Fast Movement', phb("Your speed increases by 10 feet while you aren't wearing heavy armor."), mod('bonus', 'speed +10'))}</autolevel>
    </class>`);
    const fast = (json.classFeature as Record<string, unknown>[]).find(
      (f) => f.name === 'Fast Movement',
    );
    expect(fast).toBeDefined();
    expect(fast).not.toHaveProperty('castGuidance');
    expect(JSON.stringify(report.notes)).not.toContain('speed +10');
    // A free rules text's Monk is the official one, which spreads its speed
    // across later features (Empowered Strikes' +5) its curated rows count.
    const srd = (text: string) => `${text}\nSource: System Reference Document 5.2.1 p. 49`;
    const monk = convert(`<class><name>Monk [5.5e]</name><hd>8</hd>
      <autolevel level="1">${feature('Martial Arts', srd('You strike.'))}</autolevel>
      <autolevel level="2">${feature('Unarmored Movement', srd("Your speed increases by 10 feet while you aren't wearing armor or wielding a Shield."), mod('bonus', 'speed +10'))}</autolevel>
      <autolevel level="6">${feature('Empowered Strikes', srd('Your strikes deal Force damage.'), mod('bonus', 'speed +5'))}</autolevel>
    </class>`);
    const monkFeatures = monk.json.classFeature as Record<string, unknown>[];
    expect(monkFeatures.map((f) => f.name)).toContain('Empowered Strikes');
    expect(monkFeatures.some((f) => 'castGuidance' in f)).toBe(false);
  });

  it("reads a homebrew subclass's on an official class, never an official subclass's", () => {
    const phb = (text: string) => `${text}\nSource: Player's Handbook p. 54`;
    const dance = (text: string) => `${text}\nSource: The Griffon's Saddlebag: Book One p. 157`;
    const { json } = convert(`<class><name>Bard</name><hd>8</hd>
      <autolevel level="1">${feature('Bardic Inspiration', phb('You inspire.'))}${feature('Spellcasting', phb('You cast.'))}</autolevel>
      <autolevel level="2">${feature('Jack of All Trades', phb('You know a bit.'))}</autolevel>
      <autolevel level="3">
        ${feature('Bard College', phb('You choose a college.'))}
        ${feature('Bard College: College of Lore', phb('Lore.'), '', opt)}
        ${feature('Cutting Words (College of Lore)', phb('Your speed increases by 10 feet.'), mod('bonus', 'speed +10'), opt)}
        ${feature('Bard College: College of Dance', dance('Dance.'), '', opt)}
        ${feature('Fast Movement (College of Dance)', dance('Your walking speed increases by 10 feet.'), mod('bonus', 'speed +10'), opt)}
      </autolevel></class>`);
    const features = json.subclassFeature as Record<string, unknown>[];
    const of = (name: string) => features.find((f) => f.name === name);
    expect(of('Fast Movement')?.castGuidance).toEqual({
      v: 1,
      effects: [{ kind: 'speedBonus', amount: 10 }],
      drop: [{ kind: 'speedBonus' }],
    });
    expect(of('Cutting Words')).toBeDefined();
    expect(of('Cutting Words')).not.toHaveProperty('castGuidance');
  });
});
