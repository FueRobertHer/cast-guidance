import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

/**
 * Dragonborn shaped as v2.41.0 has them, prose shortened: Fizban's bare
 * Chromatic race (a free resistance pick and a breath weapon whose prose names
 * a shape and no type), a Chromatic version whose data still offers the free
 * pick though its dragon fixes it, and a 2014 race with a subrace that names no
 * dragon and takes the resistance away (EGW's Draconblood), whose 2014 prose
 * names no shape or type.
 */
const breath = (shape: string, type = '') => ({
  name: 'Breath Weapon',
  type: 'entries',
  entries: [
    `When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy in a ${shape}. Each creature in that area must make a Dexterity saving throw (DC = 8 + your Constitution modifier + your proficiency bonus). On a failed save, the creature takes 1d10${type} damage. You can use your Breath Weapon a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.`,
  ],
});
const chromaticPick = [{ choose: { from: ['acid', 'lightning', 'poison', 'fire', 'cold'] } }];
const gemPick = [{ choose: { from: ['force', 'necrotic', 'psychic', 'radiant', 'thunder'] } }];

const WORLD: Record<string, DataEntity[]> = {
  race: [
    {
      name: 'Dragonborn (Chromatic)',
      source: 'FTX',
      resist: chromaticPick,
      entries: [breath('30-foot line that is 5 feet wide')],
    },
    {
      name: 'Dragonborn (Chromatic; Red)',
      source: 'FTX',
      resist: chromaticPick,
      entries: [breath('30-foot line that is 5 feet wide', ' fire')],
    },
    {
      name: 'Dragonborn',
      source: 'PHX',
      resist: [{ choose: { from: ['acid', 'cold', 'fire', 'lightning', 'poison'] } }],
      entries: [
        {
          name: 'Breath Weapon',
          type: 'entries',
          entries: [
            'You can use your action to exhale destructive energy. Each creature in the area of the exhalation must make a saving throw. The DC for this saving throw equals 8 + your Constitution modifier + your proficiency bonus. A creature takes 2d6 damage on a failed save. After you use your breath weapon, you can’t use it again until you complete a short or long rest.',
          ],
        },
      ],
    },
    { name: 'Dragonborn (Metallic)', source: 'FTX', resist: chromaticPick, entries: [] },
    { name: 'Dragonborn (Gem)', source: 'FTX', resist: gemPick, entries: [] },
    // The 2024 bare race: its breath weapon names neither type nor one shape.
    {
      name: 'Dragonborn',
      source: 'XPX',
      edition: 'one',
      resist: [{ choose: { from: ['acid', 'cold', 'fire', 'lightning', 'poison'] } }],
      entries: [
        {
          name: 'Breath Weapon',
          type: 'entries',
          entries: [
            'When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy in either a 15-foot {@variantrule Cone [Area of Effect]|XPX|Cone} or a 30-foot {@variantrule Line [Area of Effect]|XPX|Line} that is 5 feet wide (choose the shape each time). Each creature in that area must make a Dexterity saving throw (DC 8 plus your Constitution modifier and Proficiency Bonus). On a failed save, a creature takes 1d10 damage of the type determined by your Draconic Ancestry trait. You can use this Breath Weapon a number of times equal to your Proficiency Bonus, and you regain all expended uses when you finish a Long Rest.',
          ],
        },
      ],
    },
    // A homebrew Dragonborn whose own pick is no dragon's.
    {
      name: 'Dragonborn (Shadow)',
      source: 'HBX',
      resist: [{ choose: { from: ['necrotic', 'psychic'] } }],
    },
    // Any other race with a pick among types keeps it.
    { name: 'Stormkin', source: 'TSX', resist: [{ choose: { from: ['cold', 'thunder'] } }] },
  ],
  subrace: [
    { name: 'Draconblood', source: 'EGX', raceName: 'Dragonborn', raceSource: 'PHX', resist: [] },
    { name: 'Red', source: 'PHX', raceName: 'Dragonborn', raceSource: 'PHX', resist: ['fire'] },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => WORLD[type] ?? [],
};

function dragonborn(race: string, source: string, subrace?: [string, string]) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.race = { name: race, source };
  if (subrace) doc.subrace = { name: subrace[0], source: subrace[1] };
  return doc;
}
const breathNote = (doc: ReturnType<typeof dragonborn>) =>
  deriveSheet(doc, ctx).actions.find((a) => a.label === 'Breath Weapon')?.note;

describe('a Dragonborn whose dragon is picked', () => {
  it("asks Fizban's bare race for one of its own five dragons", () => {
    const sheet = deriveSheet(dragonborn('Dragonborn (Chromatic)', 'FTX'), ctx);
    const prompts = sheet.pending.map((p) => [p.label, p.options.map((o) => o.id)]);
    expect(prompts).toEqual([['Draconic Ancestry', ['black', 'blue', 'green', 'red', 'white']]]);
  });

  it("puts the dragon's type before a breath weapon that names only its shape", () => {
    const doc = dragonborn('Dragonborn (Chromatic)', 'FTX');
    doc.choices['race:dragonborn (chromatic)|ftx:ancestry'] = ['blue'];
    expect(breathNote(doc)).toBe('lightning · 30-foot line');
    expect(deriveSheet(doc, ctx).resists.map((r) => r.damageType)).toEqual(['lightning']);
  });

  it("fixes a version's free resistance pick to the type its dragon has", () => {
    const sheet = deriveSheet(dragonborn('Dragonborn (Chromatic; Red)', 'FTX'), ctx);
    expect(sheet.pending).toEqual([]);
    expect(sheet.resists.map((r) => r.damageType)).toEqual(['fire']);
    expect(sheet.actions.find((a) => a.label === 'Breath Weapon')?.note).toBe(
      'fire · 30-foot line',
    );
  });

  it('asks a subrace that names no dragon, and leaves the resistance it took away', () => {
    const doc = dragonborn('Dragonborn', 'PHX', ['Draconblood', 'EGX']);
    expect(deriveSheet(doc, ctx).pending.map((p) => p.id)).toEqual([
      'race:dragonborn|phx:ancestry',
    ]);
    doc.choices['race:dragonborn|phx:ancestry'] = ['red'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.resists).toEqual([]);
    expect(breathNote(doc)).toBe('fire · 15 ft cone');
  });

  it('lets the dragon a subrace names win over a pick stored before it was taken', () => {
    const doc = dragonborn('Dragonborn', 'PHX', ['Red', 'PHX']);
    doc.choices['race:dragonborn|phx:ancestry'] = ['blue'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.pending).toEqual([]);
    expect(sheet.resists.map((r) => r.damageType)).toEqual(['fire']);
    expect(breathNote(doc)).toBe('fire · 15 ft cone');
  });

  it("offers Fizban's metallic and gem dragons, and the gem's own type", () => {
    const options = (race: string) =>
      deriveSheet(dragonborn(race, 'FTX'), ctx).pending.map((p) => p.options.map((o) => o.id));
    expect(options('Dragonborn (Metallic)')).toEqual([
      ['brass', 'bronze', 'copper', 'gold', 'silver'],
    ]);
    expect(options('Dragonborn (Gem)')).toEqual([
      ['amethyst', 'crystal', 'emerald', 'sapphire', 'topaz'],
    ]);
    const doc = dragonborn('Dragonborn (Gem)', 'FTX');
    const types = (gem: string) => {
      doc.choices['race:dragonborn (gem)|ftx:ancestry'] = [gem];
      return deriveSheet(doc, ctx).resists.map((r) => r.damageType);
    };
    expect(['amethyst', 'crystal', 'emerald', 'sapphire', 'topaz'].map(types)).toEqual([
      ['force'],
      ['radiant'],
      ['psychic'],
      ['thunder'],
      ['necrotic'],
    ]);
  });

  it('gives a 2024 race its either-shape breath on a character under 2014 rules', () => {
    const doc = dragonborn('Dragonborn', 'XPX');
    doc.rulesVersion = '2014';
    doc.choices['race:dragonborn|xpx:ancestry'] = ['green'];
    expect(breathNote(doc)).toBe('poison · 15 ft cone or 30 ft line');
    expect(deriveSheet(doc, ctx).actions.find((a) => a.label === 'Breath Weapon')?.save).toEqual(
      expect.objectContaining({ targetAbility: 'dex' }),
    );
  });

  it("leaves a homebrew Dragonborn's own pick that is no dragon's", () => {
    const sheet = deriveSheet(dragonborn('Dragonborn (Shadow)', 'HBX'), ctx);
    expect(sheet.pending.map((p) => [p.label, p.options.length])).toEqual([
      ['Draconic Ancestry', 10],
      ['Damage resistance', 2],
    ]);
  });

  it('leaves any other race its own pick among types', () => {
    const sheet = deriveSheet(dragonborn('Stormkin', 'TSX'), ctx);
    expect(sheet.pending.map((p) => [p.label, p.options.map((o) => o.id)])).toEqual([
      ['Damage resistance', ['cold', 'thunder']],
    ]);
  });
});
