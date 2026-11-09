// Conversions a review found wrong, each pinned to what the engine reads.
import { describe, expect, it } from 'vitest';
import { convertXmlText } from '../index';
import { readPrerequisite } from './feat';

type Json = Record<string, unknown>;
const first = (xml: string, key: string) =>
  (convertXmlText(`<compendium>${xml}</compendium>`, { fileName: 'r.xml' }).json[key] as Json[])[0];

describe('feat prerequisites', () => {
  it('reads a level with a trailing plus and leaves no other text', () => {
    expect(readPrerequisite('Level 4+')).toEqual([{ level: 4 }]);
    expect(readPrerequisite('Level 4+, Strength 13+')).toEqual([
      { level: 4, ability: [{ str: 13 }] },
    ]);
  });

  it('turns either ability into one set each, which the engine ORs', () => {
    expect(readPrerequisite('Level 4+, Strength or Dexterity 13+')).toEqual([
      { level: 4, ability: [{ str: 13 }] },
      { level: 4, ability: [{ dex: 13 }] },
    ]);
    expect(readPrerequisite('Strength 13+ or Dexterity 15+')).toEqual([
      { ability: [{ str: 13 }] },
      { ability: [{ dex: 15 }] },
    ]);
  });

  it('keeps a single ability with "or higher"', () => {
    expect(readPrerequisite('Wisdom 13 or higher')).toEqual([{ ability: [{ wis: 13 }] }]);
  });
});

describe('spells', () => {
  it('reads a capitalized melee spell attack as melee', () => {
    const s = first(
      '<spell><name>Ash Touch</name><level>1</level><text>Make a Melee spell attack.</text></spell>',
      'spell',
    );
    expect(s?.spellAttack).toEqual(['M']);
  });

  it('labels cantrip scaling with the rolls it took the dice from', () => {
    const s = first(
      `<spell><name>Frost Mote</name><level>0</level><text>Cold.</text>
        <roll description="Healing" level="0">1d4</roll>
        <roll description="Cold Damage" level="0">1d6</roll>
        <roll description="Cold Damage" level="5">2d6</roll></spell>`,
      'spell',
    );
    expect(s?.scalingLevelDice).toEqual({ label: 'cold damage', scaling: { 1: '1d6', 5: '2d6' } });
  });
});

describe('items', () => {
  it('marks a weapon martial from a "Proficiency: martial" line of its own', () => {
    const i = first(
      '<item><name>Glass Pike</name><type>M</type><dmg1>1d10</dmg1><dmgType>P</dmgType><text>Proficiency: martial</text></item>',
      'item',
    );
    expect(i?.weaponCategory).toBe('martial');
  });
});

describe('backgrounds', () => {
  it('reports a skill choice it keeps only as text', () => {
    const { json, report } = convertXmlText(
      `<compendium><background><name>Lamplighter</name>
        <trait><name>Skill Proficiencies: Insight, and one skill from the Lamp table</name><text>x</text></trait>
      </background></compendium>`,
      { fileName: 'r.xml' },
    );
    expect((json.background as Json[])[0]?.skillProficiencies).toEqual([{ insight: true }]);
    expect(report.notes).toEqual([
      {
        kind: 'background',
        name: 'Lamplighter',
        status: 'partial',
        reasons: ['its skill choice (one skill from the Lamp table) is kept as text'],
      },
    ]);
  });

  it('reads a skill of your choice, and no skill a phrase lists', () => {
    const skills = (line: string) => {
      const { json } = convertXmlText(
        `<compendium><background><name>Lamplighter</name>
          <trait><name>Skill Proficiencies: ${line}</name><text>x</text></trait>
        </background></compendium>`,
        { fileName: 'r.xml' },
      );
      return (json.background as Json[])[0]?.skillProficiencies;
    };
    expect(skills('Insight, and one skill of your choice')).toEqual([{ insight: true, any: 1 }]);
    expect(skills('Survival, plus one from among Arcana, History, and Religion')).toEqual([
      { survival: true },
    ]);
  });
});
