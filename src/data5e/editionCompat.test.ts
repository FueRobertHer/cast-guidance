import { describe, expect, it } from 'vitest';
import type { Entity } from './copyMod';
import {
  addToPreview,
  describeSwitch,
  type EditionFit,
  editionFit,
  editionFitChip,
  editionFitNote,
  emptySwitchPreview,
} from './editionCompat';
import { normalizeDataset } from './normalize';

/** A 2014 printing, optionally declaring what reprints it. */
const old = (name: string, reprintedAs?: unknown): Entity =>
  ({ name, source: 'PHB', ...(reprintedAs === undefined ? {} : { reprintedAs }) }) as Entity;
/** A 2024 printing (XPHB is a core 2024 source). */
const revised = (name: string): Entity => ({ name, source: 'XPHB' }) as Entity;

/**
 * Resolvers hand back the target entity, because a reprint has to be installed
 * *and* be the right edition. A world is the set of printings that exist here.
 */
const world = (...entities: Entity[]) => {
  const byUid = new Map(entities.map((e) => [`${String(e.name)}|${String(e.source)}`, e]));
  return (ref: { name: string; source: string }) => byUid.get(`${ref.name}|${ref.source}`);
};
const nothingInstalled = () => undefined;

describe('editionFit', () => {
  it('says nothing when the pick already suits the character', () => {
    expect(editionFit(old('Fighter'), 'class', '2014', nothingInstalled)).toEqual({
      kind: 'match',
    });
    expect(editionFit(revised('Fighter'), 'class', '2024', nothingInstalled)).toEqual({
      kind: 'match',
    });
  });

  it('names the reprint when the newer books have one and it is installed', () => {
    const fit = editionFit(old('Elf', ['Elf|XPHB']), 'race', '2024', world(revised('Elf')));
    expect(fit).toEqual({ kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } });
  });

  it('is a carry-over when the reprint is declared but not installed', () => {
    // Offering a reprint the device does not have would send someone looking
    // for content that never downloaded.
    expect(editionFit(old('Elf', ['Elf|XPHB']), 'race', '2024', nothingInstalled)).toEqual({
      kind: 'carryOver',
    });
  });

  it('is a carry-over when nothing reprints it at all', () => {
    expect(editionFit(old('Kalashtar'), 'race', '2024', world(revised('Kalashtar')))).toEqual({
      kind: 'carryOver',
    });
  });

  it('ignores a reprint that is itself older content', () => {
    // The common shape in the real data: Bugbear|VGM is "reprinted as"
    // Bugbear|MPMM, and MPMM is a 2014 book. Installed is not enough — calling
    // that a 2024 reprint would be false, and the switch it offers gains
    // nothing.
    const mpmm = { name: 'Bugbear', source: 'MPMM' } as Entity;
    expect(editionFit(old('Bugbear', ['Bugbear|MPMM']), 'race', '2024', world(mpmm))).toEqual({
      kind: 'carryOver',
    });
  });

  it('passes over an older reprint to reach a 2024 one', () => {
    const mpmm = { name: 'Aasimar', source: 'MPMM' } as Entity;
    expect(
      editionFit(
        old('Aasimar', ['Aasimar|MPMM', 'Aasimar|XPHB']),
        'race',
        '2024',
        world(mpmm, revised('Aasimar')),
      ),
    ).toEqual({ kind: 'reprinted', as: { name: 'Aasimar', source: 'XPHB' } });
  });

  it('reads a subclass reprint by shortName and names it from the entity', () => {
    // Subclass uids are ShortName|ClassName|ClassSource|SubclassSource, and the
    // entity is called "Life Domain" where the uid says only "Life".
    const domain = { name: 'Life Domain', shortName: 'Life', source: 'XPHB' } as Entity;
    const pick = {
      name: 'Life Domain',
      shortName: 'Life',
      source: 'PHB',
      reprintedAs: ['Life|Cleric|XPHB|XPHB'],
    } as Entity;
    const resolve = (ref: { shortName?: string; source: string }) =>
      ref.shortName === 'Life' && ref.source === 'XPHB' ? domain : undefined;
    expect(editionFit(pick, 'subclass', '2024', resolve)).toEqual({
      kind: 'reprinted',
      as: { name: 'Life Domain', source: 'XPHB' },
    });
  });

  it('reads a class reprint as a separate class, since no control changes a row', () => {
    expect(
      editionFit(old('Cleric', ['Cleric|XPHB']), 'class', '2024', world(revised('Cleric'))),
    ).toEqual({ kind: 'reprintedClass', as: { name: 'Cleric', source: 'XPHB' } });
  });

  it('keeps the plain switch for what is not a class', () => {
    expect(
      editionFit(old('Drifter', ['Drifter|XPHB']), 'background', '2024', world(revised('Drifter'))),
    ).toEqual({ kind: 'reprinted', as: { name: 'Drifter', source: 'XPHB' } });
  });

  it('follows a cross-type reprint into the type the target names', () => {
    // Every 2014 subrace points at a race: High|PHB is reprinted as Elf|XPHB.
    const seen: string[] = [];
    const resolve = (ref: { name: string; source: string; type?: string }) => {
      seen.push(String(ref.type));
      return revised('Elf');
    };
    expect(editionFit(old('High', ['Elf|XPHB']), 'subrace', '2024', resolve)).toEqual({
      kind: 'reprinted',
      as: { name: 'Elf', source: 'XPHB' },
    });
    // The 2024 books fold subraces into the race, so the target is looked for
    // among races even though the holder is a subrace.
    expect(seen).toEqual(['race']);
  });

  describe('a reprint this pick cannot become', () => {
    const gift = revised('Gift');
    const asFeat = { uid: 'Gift|XPHB', tag: 'feat' };

    it('is told apart from one the pick can switch to', () => {
      expect(editionFit(old('Sub', [asFeat]), 'subrace', '2024', world(gift))).toEqual({
        kind: 'reprintedNoSwitch',
        as: { name: 'Gift', source: 'XPHB' },
        what: 'a feat',
      });
    });

    it('stays truthful about a type it has no word for', () => {
      const charm = revised('Charm');
      const asItem = { uid: 'Charm|XPHB', tag: 'item' };
      expect(editionFit(old('Kin', [asItem]), 'race', '2024', world(charm))).toEqual({
        kind: 'reprintedNoSwitch',
        as: { name: 'Charm', source: 'XPHB' },
        what: 'something else',
      });
    });

    it('gives way to a real switch, whichever the data lists first', () => {
      const real = { kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } };
      const installed = world(gift, revised('Elf'));
      expect(editionFit(old('Sub', [asFeat, 'Elf|XPHB']), 'subrace', '2024', installed)).toEqual(
        real,
      );
      expect(editionFit(old('Sub', ['Elf|XPHB', asFeat]), 'subrace', '2024', installed)).toEqual(
        real,
      );
    });

    it('is a carry-over when it is not installed, or is itself older content', () => {
      const older = { name: 'Gift', source: 'XPHB', edition: 'classic' } as Entity;
      expect(editionFit(old('Sub', [asFeat]), 'subrace', '2024', nothingInstalled)).toEqual({
        kind: 'carryOver',
      });
      expect(editionFit(old('Sub', [asFeat]), 'subrace', '2024', world(older))).toEqual({
        kind: 'carryOver',
      });
    });

    it('still lets a pick switch to a reprint tagged as its own type', () => {
      // No official row does this, but a homebrew one may, and a subrace can hold
      // a subrace.
      const tagged = old('Sub', [{ uid: 'Gift|XPHB', tag: 'subrace' }]);
      expect(editionFit(tagged, 'subrace', '2024', world(gift)).kind).toBe('reprinted');
    });

    it('applies to any holder, since the rule is the kind and not the slot', () => {
      expect(editionFit(old('Kin', [asFeat]), 'race', '2024', world(gift)).kind).toBe(
        'reprintedNoSwitch',
      );
      // A feat reprinted as a feat is its own kind, so that one is a real switch.
      expect(editionFit(old('Old Gift', [asFeat]), 'feat', '2024', world(gift)).kind).toBe(
        'reprinted',
      );
    });

    describe('a subclass', () => {
      const pick = {
        name: 'Path of Old',
        shortName: 'Old',
        source: 'PHB',
        className: 'Warrior',
        classSource: 'PHB',
        reprintedAs: ['New|Warrior|XPHB|XPHB'],
      } as Entity;
      const reprintUnder = (className: string) => () =>
        ({ name: 'Path of New', source: 'XPHB', className, classSource: 'XPHB' }) as Entity;
      const olderRow = { name: 'Warrior', source: 'PHB' };
      const newerRow = { name: 'Warrior', source: 'XPHB' };

      it('has to change class first to reach a reprint on another printing of it', () => {
        expect(editionFit(pick, 'subclass', '2024', reprintUnder('Warrior'), olderRow)).toEqual({
          kind: 'reprintedUnderClass',
          as: { name: 'Path of New', source: 'XPHB' },
          underClass: newerRow,
        });
      });

      it("reads the character's class row, not the row the lookup found", () => {
        // `pick` says PHB, as the lookup's row does, but this character has
        // already moved to the printing whose picker offers the reprint.
        expect(editionFit(pick, 'subclass', '2024', reprintUnder('Warrior'), newerRow)).toEqual({
          kind: 'reprinted',
          as: { name: 'Path of New', source: 'XPHB' },
        });
        expect(
          editionFit(pick, 'subclass', '2024', reprintUnder('Warrior'), {
            name: 'WARRIOR',
            source: 'xphb',
          }).kind,
        ).toBe('reprinted');
      });

      it('cannot switch to one under a differently named class', () => {
        expect(editionFit(pick, 'subclass', '2024', reprintUnder('Mystic'), olderRow)).toEqual({
          kind: 'reprintedNoSwitch',
          as: { name: 'Path of New', source: 'XPHB' },
          what: 'a subclass of Mystic',
        });
      });

      describe('with several reprints', () => {
        const twoReprints = {
          ...pick,
          reprintedAs: ['First|Warrior|XPHB|XPHB', 'Second|Warrior|PHB|XDMG'],
        } as Entity;
        const resolveTo = (first: Entity, second: Entity) => (ref: { shortName?: string }) =>
          ref.shortName === 'First' ? first : second;
        const onNewerRow = {
          name: 'First Path',
          source: 'XPHB',
          className: 'Warrior',
          classSource: 'XPHB',
        } as Entity;

        it('prefers the one on its own class row, even listed second', () => {
          const onOwnRow = {
            name: 'Second Path',
            source: 'XDMG',
            className: 'Warrior',
            classSource: 'PHB',
          } as Entity;
          expect(
            editionFit(twoReprints, 'subclass', '2024', resolveTo(onNewerRow, onOwnRow), olderRow),
          ).toEqual({ kind: 'reprinted', as: { name: 'Second Path', source: 'XDMG' } });
        });

        it('prefers changing class to having nothing to switch to, even listed second', () => {
          const underMystic = {
            name: 'Mystic Path',
            source: 'XPHB',
            className: 'Mystic',
            classSource: 'XPHB',
          } as Entity;
          expect(
            editionFit(
              twoReprints,
              'subclass',
              '2024',
              resolveTo(underMystic, onNewerRow),
              olderRow,
            ),
          ).toEqual({
            kind: 'reprintedUnderClass',
            as: { name: 'First Path', source: 'XPHB' },
            underClass: newerRow,
          });
        });
      });
    });
  });

  it('flags newer content in an older game, reprints being irrelevant there', () => {
    // 2024 content in a 2014 game cannot be "reprinted back", so the direction
    // matters: this is the case the pickers never produce and only a switch or
    // an import can create.
    expect(editionFit(revised('Elf'), 'race', '2014', world(old('Elf')))).toEqual({
      kind: 'newer',
    });
    expect(editionFit(revised('Elf'), 'race', '2014', nothingInstalled)).toEqual({
      kind: 'newer',
    });
  });

  it('honours an explicit edition tag over the source heuristic', () => {
    const homebrew2024 = { name: 'Homebrewed', source: 'MINE', edition: 'one' } as Entity;
    expect(editionFit(homebrew2024, 'race', '2024', nothingInstalled)).toEqual({ kind: 'match' });
    expect(editionFit(homebrew2024, 'race', '2014', nothingInstalled)).toEqual({ kind: 'newer' });
  });

  it('accepts a reprint whose source is not core but is tagged 2024', () => {
    // FRHoF is not in SOURCES_2024, so only the entity's own edition tag says
    // it is 2024 content. Resolving the entity is what makes that readable.
    const frhof = { name: 'Hexblood', source: 'FRHoF', edition: 'one' } as Entity;
    expect(editionFit(old('Hexblood', ['Hexblood|FRHoF']), 'race', '2024', world(frhof))).toEqual({
      kind: 'reprinted',
      as: { name: 'Hexblood', source: 'FRHoF' },
    });
  });

  it('accepts a reprint left unmarked in a book something else marks 2024', () => {
    // The later books mark their backgrounds and leave most of the rest bare, so
    // the target only reads as 2024 by way of its book.
    const reg = normalizeDataset(
      new Map<string, unknown>([
        ['backgrounds.json', { background: [{ name: 'Bg', source: 'LATE', edition: 'one' }] }],
        [
          'races.json',
          {
            race: [
              { name: 'Kin', source: 'PHB', reprintedAs: ['Kin|LATE'] },
              { name: 'Kin', source: 'LATE' },
            ],
          },
        ],
      ]),
    );
    const pick = reg.get('race', 'Kin', 'PHB') as Entity;
    const resolve = (ref: { name: string; source: string }) =>
      reg.get('race', ref.name, ref.source);
    expect(editionFit(pick, 'race', '2024', resolve)).toEqual({
      kind: 'reprinted',
      as: { name: 'Kin', source: 'LATE' },
    });
    // That reprint is newer content to a 2014 character holding it.
    const reprint = reg.get('race', 'Kin', 'LATE') as Entity;
    expect(editionFit(reprint, 'race', '2014', resolve)).toEqual({ kind: 'newer' });
  });
});

describe('editionFitNote', () => {
  it('says nothing about a matching pick', () => {
    expect(editionFitNote('Fighter', { kind: 'match' }, '2024')).toBeUndefined();
  });

  it('names the other edition, the reprint, and that the pick stands', () => {
    const fit: EditionFit = { kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } };
    expect(editionFitNote('Elf', fit, '2024')).toBe(
      'Elf: 2014 content, reprinted for 2024 as Elf. Kept as chosen.',
    );
  });

  it('distinguishes a carry-over from content out of the newer books', () => {
    expect(editionFitNote('Kalashtar', { kind: 'carryOver' }, '2024')).toBe(
      'Kalashtar: 2014 content with no 2024 reprint. Kept as chosen.',
    );
    expect(editionFitNote('Elf', { kind: 'newer' }, '2014')).toBe(
      'Elf: 2024 content in a 2014 game, so its rules assume the 2024 books. Kept as chosen.',
    );
  });

  it('says what a reprint out of reach is', () => {
    const fit: EditionFit = {
      kind: 'reprintedNoSwitch',
      as: { name: 'Gift', source: 'XPHB' },
      what: 'a feat',
    };
    expect(editionFitNote('Sub', fit, '2024')).toBe(
      'Sub: 2014 content, reprinted for 2024 as a feat, Gift. Kept as chosen.',
    );
  });

  it('says a class reprint is a separate class, since a phone shows only this', () => {
    const fit: EditionFit = { kind: 'reprintedClass', as: { name: 'Cleric', source: 'XPHB' } };
    expect(editionFitNote('Cleric', fit, '2024')).toBe(
      'Cleric: 2014 content, reprinted for 2024 as a separate class, Cleric (XPHB). Kept as chosen.',
    );
  });

  it('names the class a reprint sits under, since a phone shows only this', () => {
    const fit: EditionFit = {
      kind: 'reprintedUnderClass',
      as: { name: 'Path of New', source: 'XPHB' },
      underClass: { name: 'Warrior', source: 'XPHB' },
    };
    expect(editionFitNote("Warrior's Path of Old", fit, '2024')).toBe(
      "Warrior's Path of Old: 2014 content, reprinted for 2024 as Path of New, under Warrior (XPHB) rather than your class. Kept as chosen.",
    );
  });
});

describe('editionFitChip', () => {
  it('has nothing to show for a matching pick', () => {
    expect(editionFitChip({ kind: 'match' }, '2024')).toBeUndefined();
  });

  it('says how the pick sits, not which book it came from', () => {
    // The source badge beside it already carries the book, so repeating the
    // edition would say nothing new; what is missing is what it means here.
    const reprinted = editionFitChip(
      { kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } },
      '2024',
    );
    expect(reprinted?.text).toBe('reprinted for 2024');
    expect(reprinted?.title).toContain('Elf (XPHB)');
    expect(reprinted?.title).toContain('Your pick is kept');
    expect(editionFitChip({ kind: 'carryOver' }, '2024')?.text).toBe('2014 content');
    expect(editionFitChip({ kind: 'newer' }, '2014')?.text).toBe('2024 content');
  });

  it('offers the switch where one exists, a subrace reprinted as a race included', () => {
    // The player gets there through the species picker rather than this slot.
    const fit = editionFit(old('High', ['Elf|XPHB']), 'subrace', '2024', world(revised('Elf')));
    const chip = editionFitChip(fit, '2024');
    expect(chip?.text).toBe('reprinted for 2024');
    expect(chip?.title).toBe(
      '2014 content. The 2024 books reprint it as Elf (XPHB), which you can switch to. Your pick is kept either way.',
    );
  });

  it('says what replacing a class costs, rather than promising a switch', () => {
    const chip = editionFitChip(
      { kind: 'reprintedClass', as: { name: 'Cleric', source: 'XPHB' } },
      '2024',
    );
    expect(chip?.text).toBe('reprinted for 2024');
    expect(chip?.title).toBe(
      '2014 content. The 2024 books reprint it as a separate class, Cleric (XPHB). To switch, take this class down to level 1, remove it, then add that one, which starts at level 1. Removing it clears any subclass, picks and spell list it has. This class stays until you do.',
    );
  });

  it('says what reaching it costs, and that the reprint is not in the picker below', () => {
    const chip = editionFitChip(
      {
        kind: 'reprintedUnderClass',
        as: { name: 'Path of New', source: 'XPHB' },
        underClass: { name: 'Warrior', source: 'XPHB' },
      },
      '2024',
    );
    expect(chip?.text).toBe('reprinted elsewhere');
    expect(chip?.title).toBe(
      '2014 content. The 2024 books reprint it as Path of New (XPHB), under Warrior (XPHB). To switch, take this class down to level 1, remove it, then add that one. Removing it clears this pick, which stays until you do.',
    );
  });

  it('offers no switch to a reprint out of reach, and says so where a phone shows it', () => {
    const chip = editionFitChip(
      { kind: 'reprintedNoSwitch', as: { name: 'Gift', source: 'XPHB' }, what: 'a feat' },
      '2024',
    );
    expect(chip?.text).toBe('reprinted as a feat');
    expect(chip?.title).toBe(
      '2014 content. The 2024 books reprint it as a feat, Gift (XPHB), so there is nothing to switch this pick to. Your pick is kept either way.',
    );
    expect(chip?.title).not.toContain('which you can switch to');
  });

  it('keeps a class name out of the chip, which does not wrap, and in the title', () => {
    const chip = editionFitChip(
      {
        kind: 'reprintedNoSwitch',
        as: { name: 'Path of New', source: 'XPHB' },
        what: 'a subclass of Mystic',
      },
      '2024',
    );
    expect(chip?.text).toBe('reprinted elsewhere');
    expect(chip?.title).toBe(
      '2014 content. The 2024 books reprint it as a subclass of Mystic, Path of New (XPHB), so there is nothing to switch this pick to. Your pick is kept either way.',
    );
  });
});

describe('describeSwitch', () => {
  const preview = (...fits: Array<[string, EditionFit]>) => {
    const p = emptySwitchPreview();
    for (const [label, fit] of fits) addToPreview(p, label, fit);
    return p;
  };

  it('says the pickers are all that change when nothing is selected', () => {
    const { summary, unchanged } = describeSwitch(emptySwitchPreview(), '2024');
    expect(unchanged).toBe(true);
    expect(summary).toContain('Nothing is selected yet');
  });

  it('reassures when every pick already suits the target', () => {
    const { summary, unchanged } = describeSwitch(
      preview(['Fighter', { kind: 'match' }], ['Elf', { kind: 'match' }]),
      '2024',
    );
    expect(unchanged).toBe(true);
    expect(summary).toContain('Every selection already suits 2024');
    expect(summary).toContain('Nothing is removed');
  });

  it('leads with what is kept, then names each mismatch by kind', () => {
    const { summary, unchanged } = describeSwitch(
      preview(
        ['Fighter', { kind: 'match' }],
        ['Elf', { kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } }],
        ['Kalashtar', { kind: 'carryOver' }],
      ),
      '2024',
    );
    expect(unchanged).toBe(false);
    // The count is every pick, not just the mismatched ones: "nothing is
    // removed" is the question a version switch actually raises.
    expect(summary).toContain('Nothing is removed and every selection is kept');
    expect(summary).toContain('1 has a 2024 reprint you can switch to afterwards (Elf → Elf)');
    expect(summary).toContain('1 carries over with no 2024 reprint (Kalashtar)');
    expect(summary).not.toContain('newer books');
  });

  it('reports content from the newer books when switching down', () => {
    const { summary } = describeSwitch(preview(['Elf', { kind: 'newer' }]), '2014');
    expect(summary).toContain('1 comes from the newer books (Elf)');
  });

  it('keeps a reprint behind a class change apart from one open right away', () => {
    const { summary, unchanged } = describeSwitch(
      preview(
        ['Elf', { kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } }],
        [
          "Warrior's Path of Old",
          {
            kind: 'reprintedUnderClass',
            as: { name: 'Path of New', source: 'XPHB' },
            underClass: { name: 'Warrior', source: 'XPHB' },
          },
        ],
      ),
      '2024',
    );
    expect(unchanged).toBe(false);
    expect(summary).toContain('1 has a 2024 reprint you can switch to afterwards (Elf → Elf)');
    expect(summary).toContain(
      "1 has a 2024 reprint you can only reach by replacing a class (Warrior's Path of Old → Path of New under Warrior (XPHB))",
    );
  });

  it('says one thing about a class and its subclass, which come to the same', () => {
    const { summary, unchanged } = describeSwitch(
      preview(
        ['Cleric', { kind: 'reprintedClass', as: { name: 'Cleric', source: 'XPHB' } }],
        [
          "Cleric's Life Domain",
          {
            kind: 'reprintedUnderClass',
            as: { name: 'Life Domain', source: 'XPHB' },
            underClass: { name: 'Cleric', source: 'XPHB' },
          },
        ],
      ),
      '2024',
    );
    expect(unchanged).toBe(false);
    expect(summary).toContain(
      "2 have a 2024 reprint you can only reach by replacing a class (Cleric → Cleric (XPHB), Cleric's Life Domain → Life Domain under Cleric (XPHB))",
    );
    expect(summary).not.toContain('afterwards');
  });

  it('counts a class reprint alone as something to warn about', () => {
    const { summary, unchanged } = describeSwitch(
      preview(['Cleric', { kind: 'reprintedClass', as: { name: 'Cleric', source: 'XPHB' } }]),
      '2024',
    );
    expect(unchanged).toBe(false);
    expect(summary).toContain(
      '1 has a 2024 reprint you can only reach by replacing a class (Cleric → Cleric (XPHB))',
    );
  });

  it('counts a pick behind a class change as something to warn about', () => {
    const { summary, unchanged } = describeSwitch(
      preview(
        [
          'A',
          {
            kind: 'reprintedUnderClass',
            as: { name: 'B', source: 'XPHB' },
            underClass: { name: 'C', source: 'XPHB' },
          },
        ],
        [
          'D',
          {
            kind: 'reprintedUnderClass',
            as: { name: 'E', source: 'XPHB' },
            underClass: { name: 'F', source: 'XPHB' },
          },
        ],
      ),
      '2024',
    );
    expect(unchanged).toBe(false);
    expect(summary).toContain('2 have a 2024 reprint you can only reach by replacing a class');
    expect(summary).not.toContain('afterwards');
  });

  it('promises no switch for a reprint out of reach', () => {
    const { summary, unchanged } = describeSwitch(
      preview([
        'Sub',
        { kind: 'reprintedNoSwitch', as: { name: 'Gift', source: 'XPHB' }, what: 'a feat' },
      ]),
      '2024',
    );
    expect(unchanged).toBe(false);
    expect(summary).toContain(
      '1 has a 2024 reprint of another kind, with nothing to switch to (Sub → Gift as a feat)',
    );
    expect(summary).not.toContain('you can switch to');
  });
});

describe('describeSwitch wording', () => {
  const preview = (...fits: Array<[string, EditionFit]>) => {
    const p = emptySwitchPreview();
    for (const [label, fit] of fits) addToPreview(p, label, fit);
    return p;
  };

  it('agrees with its verbs when several picks share a fit', () => {
    const { summary } = describeSwitch(
      preview(['Acolyte', { kind: 'carryOver' }], ['Fighter', { kind: 'carryOver' }]),
      '2024',
    );
    expect(summary).toContain('2 carry over with no 2024 reprint (Acolyte, Fighter)');
    expect(summary).not.toContain('carries over');
  });

  it('claims no total, since an unresolvable pick is never classified', () => {
    // editionCues skips a pick whose entity is missing, so a count here would
    // be an absolute claim about selections this function never saw.
    const { summary } = describeSwitch(
      preview(['Elf', { kind: 'carryOver' }], ['Fighter', { kind: 'match' }]),
      '2024',
    );
    expect(summary).toContain('every selection is kept');
    expect(summary).not.toMatch(/all \d+ selections/);
  });
});
