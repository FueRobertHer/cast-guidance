import { describe, expect, it } from 'vitest';
import { readSpellGrants, type SpellIndex } from './spellGrants';

/** An index of the spells named, at the levels given. */
const indexOf = (levels: Record<string, number>): SpellIndex => ({
  level: (name) => (Object.hasOwn(levels, name) ? levels[name] : undefined),
});

const race = (traits: string[], index?: SpellIndex) =>
  readSpellGrants(traits, index, { prepares: false, firstLevel: '1' });
const feat = (text: string, index?: SpellIndex) =>
  readSpellGrants([text], index, { prepares: true, firstLevel: '_' });

describe('readSpellGrants', () => {
  it("reads a race's cantrip and the spells it gains by level, as the data writes them", () => {
    const { blocks, unread } = race([
      'You know the thaumaturgy cantrip. When you reach 3rd level, you can cast the hellish rebuke spell as a 2nd-level spell once with this trait and regain the ability to do so when you finish a long rest. When you reach 5th level, you can cast the darkness spell once with this trait and regain the ability to do so when you finish a long rest. Charisma is your spellcasting ability for these spells.',
    ]);
    expect(unread).toBe(false);
    expect(blocks).toEqual([
      {
        ability: 'cha',
        known: { 1: ['thaumaturgy#c'] },
        innate: {
          3: { daily: { 1: ['hellish rebuke#2'] } },
          5: { daily: { 1: ['darkness'] } },
        },
      },
    ]);
  });

  it('names a spell without the word "spell" when the index knows it', () => {
    const index = indexOf({ 'poison spray': 0, 'animal friendship': 1, suggestion: 2 });
    const { blocks } = race(
      [
        'You know the poison spray cantrip. You can cast animal friendship an unlimited number of times with this trait, but you can target only snakes with it. Starting at 3rd level, you can also cast suggestion with this trait. Once you cast it, you can’t do so again until you finish a long rest. Charisma is your spellcasting ability for these spells.',
      ],
      index,
    );
    expect(blocks).toEqual([
      {
        ability: 'cha',
        known: { 1: ['poison spray#c'] },
        innate: { 1: { will: ['animal friendship'] }, 3: { daily: { 1: ['suggestion'] } } },
      },
    ]);
    // Without the index, only the framed cantrip is read.
    expect(race(['You can cast animal friendship at will.']).blocks).toBeUndefined();
  });

  it('counts uses by the proficiency bonus, and takes the ability from the race tag', () => {
    const index = indexOf({ 'minor illusion': 0, 'speak with animals': 1 });
    const { blocks } = readSpellGrants(
      [
        'You know the Minor Illusion cantrip. You can also cast Speak with Animals with this trait. You can cast it with this trait a number of times equal to your Proficiency Bonus, and you regain all expended uses when you finish a Long Rest.',
      ],
      index,
      { prepares: false, firstLevel: '1', ability: 'int' },
    );
    expect(blocks).toEqual([
      {
        ability: 'int',
        known: { 1: ['minor illusion#c'] },
        innate: { 1: { daily: { pb: ['speak with animals'] } } },
      },
    ]);
  });

  it('offers one of a list of cantrips', () => {
    const { blocks } = race([
      'You know one of the following cantrips of your choice: Dancing Lights, Light, or Sacred Flame. Intelligence, Wisdom, or Charisma is your spellcasting ability for it.',
    ]);
    expect(blocks).toEqual([
      {
        ability: { choose: ['int', 'wis', 'cha'] },
        known: { 1: [{ choose: { from: ['dancing lights#c', 'light#c', 'sacred flame#c'] } }] },
      },
    ]);
  });

  it('gives each of two spells cast once a use of its own, and inherits the ability', () => {
    const { blocks } = feat(
      [
        'Increase your Intelligence, Wisdom, or Charisma score by 1, to a maximum of 20.',
        'You learn the misty step spell and one 1st-level spell of your choice. The 1st-level spell must be from the divination or enchantment school of magic. You can cast each of these spells without expending a spell slot. Once you cast either of these spells in this way, you can’t cast that spell in this way again until you finish a long rest. You can also cast these spells using spell slots you have of the appropriate level. The spells’ spellcasting ability is the ability increased by this feat.',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      {
        ability: 'inherit',
        innate: { _: { daily: { '1e': ['misty step', { choose: 'level=1|school=D;E' }] } } },
      },
    ]);
  });

  it('builds a block per class when the picks come from one list of several', () => {
    const { blocks } = feat(
      [
        'You gain the following benefits.',
        'Two Cantrips. You learn two cantrips of your choice from the Cleric, Druid, or Wizard spell list. Intelligence, Wisdom, or Charisma is your spellcasting ability for this feat’s spells (choose when you select this feat).',
        'Level 1 Spell. Choose a level 1 spell from the same list you selected for this feat’s cantrips. You always have that spell prepared. You can cast it once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest. You can also cast the spell using any spell slots you have.',
        'Spell Change. Whenever you gain a new level, you can replace one of the spells you chose for this feat with a different spell of the same level from the chosen spell list.',
      ].join('\n'),
    );
    const block = (cls: string) => ({
      name: `${cls} Spells`,
      ability: { choose: ['int', 'wis', 'cha'] },
      known: { _: [{ choose: `level=0|class=${cls}`, count: 2 }] },
      // Always prepared, and cast once a day without a slot besides.
      prepared: { _: { daily: { 1: [{ choose: `level=1|class=${cls}` }] } } },
    });
    expect(blocks).toEqual([block('Cleric'), block('Druid'), block('Wizard')]);
  });

  it('keeps a spell always prepared and never cast for free as prepared', () => {
    const { blocks } = feat(
      'You learn the bless spell. You always have it prepared, and you can cast it using your spell slots.',
    );
    expect(blocks).toEqual([{ prepared: { _: ['bless'] } }]);
  });

  it('keeps a spell with no free cast apart from one cast once a day at the same level', () => {
    expect(
      race([
        'You can cast the detect magic spell with this trait.',
        'You can cast the misty step spell once with this trait, and you regain the ability when you finish a long rest.',
      ]).blocks,
    ).toEqual([{ innate: { 1: { _: ['detect magic'], daily: { 1: ['misty step'] } } } }]);
  });

  it('gates spells learned at two levels "respectively"', () => {
    const { blocks } = race([
      'You know the Thaumaturgy cantrip. When you reach character levels 3 and 5, you learn Hellish Rebuke and Darkness, respectively. You can cast each spell once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest.',
    ]);
    expect(blocks).toEqual([
      {
        known: { 1: ['thaumaturgy#c'] },
        innate: { 3: { daily: { 1: ['hellish rebuke'] } }, 5: { daily: { 1: ['darkness'] } } },
      },
    ]);
  });

  it('reads an innate list under "the following spells"', () => {
    const { blocks } = race(
      [
        [
          'You have an innate ability to cast the following spells, requiring no material components:',
          '• At will: nondetection (self only)',
          '• 1/day each: blindness/deafness, blur, disguise self',
          'Intelligence is your spellcasting ability for these spells.',
        ].join('\n'),
      ],
      indexOf({}),
    );
    expect(blocks).toEqual([
      {
        ability: 'int',
        innate: {
          1: {
            will: ['nondetection'],
            daily: { '1e': ['blindness/deafness', 'blur', 'disguise self'] },
          },
        },
      },
    ]);
  });

  it('reads "each of the following spells" set down in a sentence, and "allows you to cast"', () => {
    const { blocks } = feat(
      'This ability allows you to cast nondetection on yourself at will, without needing a material component. You can also cast each of the following spells once with this ability: blindness/deafness, blur, and disguise self. You regain the ability to cast these spells when you finish a long rest. Intelligence is your spellcasting ability for these spells.',
      indexOf({ nondetection: 3 }),
    );
    expect(blocks).toEqual([
      {
        ability: 'int',
        innate: {
          _: {
            will: ['nondetection'],
            daily: { '1e': ['blindness/deafness', 'blur', 'disguise self'] },
          },
        },
      },
    ]);
  });

  it('reads a table of spells added to the class lists, by spell level', () => {
    const rows = [
      'For you, the spells on the Azorius Guild Spells table are added to the spell list of your spellcasting class.',
      'Cantrip — friends, message',
      '1st | command, ensnaring strike',
      '2nd | create or destroy water, spare the dying, and hold person',
      'If you cast beneficial spells on your allies, they appear surrounded with halos of bright fire.',
    ].join('\n');
    expect(feat(rows, indexOf({ friends: 0 }))).toEqual({
      blocks: [
        {
          expanded: {
            s0: ['friends', 'message'],
            s1: ['command', 'ensnaring strike'],
            s2: ['create or destroy water', 'spare the dying', 'hold person'],
          },
        },
      ],
      unread: false,
    });
    // A table the text does not hold is not read.
    expect(
      feat(
        'The spells on the Lorehold Spells table are added to the spell list of your spellcasting class.',
      ),
    ).toEqual({ unread: true });
  });

  it('reads names joined by "and" as the index knows them, and a clause with a level of its own', () => {
    const index = indexOf({
      'detect magic': 1,
      'detect poison and disease': 1,
      'fog cloud': 1,
      'gust of wind': 2,
      'wall of water': 3,
      'animal friendship': 1,
      'speak with animals': 1,
    });
    expect(
      race(
        ['You can cast the detect magic and detect poison and disease spells with this trait.'],
        index,
      ).blocks,
    ).toEqual([{ innate: { 1: ['detect magic', 'detect poison and disease'] } }]);
    expect(
      race(
        [
          'You can cast fog cloud with this trait. Starting at 3rd level, you can cast gust of wind with it, and starting at 5th level, you can also cast wall of water with it. Once you cast a spell with this trait, you can’t cast that spell with it again until you finish a long rest.',
        ],
        index,
      ).blocks,
    ).toEqual([
      {
        innate: {
          1: { daily: { 1: ['fog cloud'] } },
          3: { daily: { 1: ['gust of wind'] } },
          5: { daily: { 1: ['wall of water'] } },
        },
      },
    ]);
    expect(
      race(
        [
          'You can cast the Animal Friendship spell and the Speak with Animals with this trait. Once you cast either spell with this trait, you can’t cast that spell again until you finish a Long Rest.',
        ],
        index,
      ).blocks,
    ).toEqual([
      { innate: { 1: { daily: { '1e': ['animal friendship', 'speak with animals'] } } } },
    ]);
  });

  it('reads a second spell named after "and the", and a pick of a level or lower', () => {
    expect(
      feat(
        'Choose one level 1 spell from the Divination or Enchantment school of magic. You always have that spell and the Misty Step spell prepared. You can cast each of these spells without expending a spell slot. Once you cast either spell in this way, you can’t cast that spell in this way again until you finish a Long Rest.',
      ).blocks,
    ).toEqual([
      {
        prepared: {
          _: { daily: { '1e': [{ choose: 'level=1|school=D;E' }, 'misty step'] } },
        },
      },
    ]);
    expect(
      feat(
        'Choose a level 3 or lower spell from the Sorcerer spell list. You always have that spell prepared.',
      ).blocks,
    ).toEqual([{ prepared: { _: [{ choose: 'level=1;2;3|class=Sorcerer' }] } }]);
  });

  it("reads no grant from a swap, a fallback, a table or another feat's list", () => {
    expect(
      race([
        'You know the Prestidigitation cantrip. Whenever you finish a Long Rest, you can replace that cantrip with a different cantrip from the Wizard spell list.',
      ]).blocks,
    ).toEqual([{ known: { 1: ['prestidigitation#c'] } }]);
    expect(
      feat(
        'You learn the Ray of Frost cantrip. If you already know it, you learn a different Wizard cantrip of your choice.',
      ).blocks,
    ).toEqual([{ known: { _: ['ray of frost#c'] } }]);
    const tabled = feat(
      'You learn one cantrip of your choice from the cleric spell list and one 1st-level spell based on the alignment of your character, as specified in the Alignment Spells table below.',
    );
    expect(tabled).toEqual({
      blocks: [{ known: { _: [{ choose: 'level=0|class=Cleric' }] } }],
      unread: true,
    });
    expect(
      feat(
        "Choose a level 1 and a level 2 spell from the same list you selected for the Magic Initiate feat's cantrips.",
      ),
    ).toEqual({ unread: true });
  });

  it('reads casting as a ritual, and a ritual pick', () => {
    expect(feat('You can cast the find familiar spell as a ritual.').blocks).toEqual([
      { innate: { _: { ritual: ['find familiar'] } } },
    ]);
    expect(
      feat(
        'You always have the Speak with Animals spell prepared. When you cast this spell as a Ritual, its duration is 8 hours.',
      ).blocks,
    ).toEqual([{ prepared: { _: ['speak with animals'] } }]);
    expect(
      feat(
        'When you choose this feat, you acquire a ritual book holding two 1st-level wizard spells of your choice. The spells you choose must have the ritual tag.',
      ).blocks,
    ).toEqual([
      {
        innate: {
          _: [{ choose: 'level=1|class=Wizard|components & miscellaneous=ritual', count: 2 }],
        },
      },
    ]);
  });

  it('takes "from that spell list" as the list before, and no grant from casting a spell', () => {
    expect(
      feat(
        'You know one cantrip of your choice from the Sorcerer spell list. Also, choose a level 1 spell from that spell list. You always have that spell prepared.',
      ).blocks,
    ).toEqual([
      {
        known: { _: [{ choose: 'level=0|class=Sorcerer' }] },
        prepared: { _: [{ choose: 'level=1|class=Sorcerer' }] },
      },
    ]);
    expect(
      feat(
        'When you cast the Find Familiar spell, choose Acid or Fire damage. Your familiar is imbued with this energy until you cast Find Familiar again.',
      ),
    ).toEqual({ unread: false });
  });

  it('reads no grant from a condition, a table of options, or spells resisted', () => {
    const none = { unread: false };
    // A row of a lineage table is one option of several.
    expect(
      race(['Drow | You also know the Dancing Lights cantrip. | Faerie Fire | Darkness']),
    ).toEqual(none);
    expect(
      race([
        "You have advantage on saving throws against being charmed, and the sleep spell can't put you to sleep.",
      ]),
    ).toEqual(none);
    expect(race(['When you know the shield spell, you gain advantage.'])).toEqual(none);
    expect(feat('Whenever you cast a 1st-level spell, you regain 1 hit point.')).toEqual(none);
    expect(
      race([
        'You have advantage on saving throws against each of the following spells: charm person, sleep, and hold person.',
      ]),
    ).toEqual(none);
    // A cast at a spell level is no gate.
    expect(race(['You can cast the fly spell at 5th level, once per long rest.']).blocks).toEqual([
      { innate: { 1: { daily: { 1: ['fly'] } } } },
    ]);
  });

  it("reads a lineage's table of spells by character level", () => {
    expect(
      race([
        [
          'When you reach character levels 3 and 5, you learn a higher-level spell, as shown on the table. You can cast it once without a spell slot, and you regain the ability to cast it in that way when you finish a Long Rest.',
          'Level | Spell',
          'Level 1 | You know the Thorn Whip cantrip. Whenever you finish a Long Rest, you can replace that cantrip with a different cantrip from the Druid spell list.',
          'Level 3 | Command',
          'Level 5 | Silence',
        ].join('\n'),
      ]),
    ).toEqual({
      blocks: [
        {
          known: { 1: ['thorn whip#c'] },
          innate: { 3: { daily: { 1: ['command'] } }, 5: { daily: { 1: ['silence'] } } },
        },
      ],
      unread: false,
    });
  });

  it("says when some spells are not read, and reads no pick from a class's list chosen elsewhere", () => {
    expect(
      race(
        [
          'You can cast nondetection at will. You can also cast the blindness/deafness, blur, and disguise self spells once per long rest.',
        ],
        indexOf({ nondetection: 3 }),
      ),
    ).toEqual({ blocks: [{ innate: { 1: { will: ['nondetection'] } } }], unread: true });
    expect(
      feat(
        "Choose a class: bard, cleric, or wizard. You learn two cantrips of your choice from that class's spell list. In addition, choose one 1st-level spell to learn from that same list.",
      ),
    ).toEqual({ unread: true });
  });

  it('says when a trait speaks of spells it could not read', () => {
    expect(race(['You can cast a spell of your patron’s choosing, once per long rest.'])).toEqual({
      unread: true,
    });
    expect(race(['You have darkvision.'])).toEqual({ unread: false });
  });

  it('takes no clause for a name', () => {
    expect(race(['You can cast these spells using spell slots you have.'])).toEqual({
      unread: false,
    });
    expect(feat('You learn two cantrips of your choice.').blocks).toEqual([
      { known: { _: [{ choose: 'level=0', count: 2 }] } },
    ]);
  });
});
