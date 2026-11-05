import { describe, expect, it } from 'vitest';
import {
  type CharacterDoc,
  type ClassLevelEntry,
  type DataEntity,
  newCharacterDoc,
} from '@/engine/types';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { classRemovalParts, firstClassShift } from './describeRemoval';

describe('classRemovalParts', () => {
  const warrior = { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] };
  const mage = { ref: { name: 'Mage', source: 'TST' }, levels: 4, hp: [] };
  const FIRST = 'feat:skilled|tst:asi4:skill';
  const SECOND = 'feat:skilled|tst:asi4@mage|tst:skill';

  it.each([
    ['Warrior', warrior],
    ['Mage', mage],
  ])('counts only the copy %s holds of a feat both classes took', (name, entry) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [warrior, mage];
    doc.choices = {
      'class:warrior|tst:asi:4:feat': ['skilled|tst'],
      'class:mage|tst:asi:4:feat': ['skilled|tst'],
      [FIRST]: ['stealth', 'history'],
      [SECOND]: ['arcana', 'nature'],
    };
    expect(classRemovalParts(doc, entry, new Set([FIRST, SECOND]))).toEqual([`2 ${name} picks`]);
  });
});

describe('firstClassShift', () => {
  /** The shared world, with the test's own classes laid over it. */
  const world = (...classes: DataEntity[]) => {
    const base = makeTestContext();
    return {
      get: (type: string, name: string, source?: string) =>
        (type === 'class' ? classes.find((c) => c.name === name) : undefined) ??
        base.get(type, name, source),
      byType: (type: string) => base.byType(type),
    };
  };
  const row = (name: string, levels: number): ClassLevelEntry => ({
    ref: { name, source: 'TST' },
    levels,
    hp: Array<'avg'>(levels).fill('avg'),
  });
  const character = (classes: ClassLevelEntry[], edit?: (d: CharacterDoc) => void) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
    doc.classes = classes;
    edit?.(doc);
    return doc;
  };
  /** The sentence for removing a first-row Warrior from these rows. */
  const shift = (rows: ClassLevelEntry[], edit?: (d: CharacterDoc) => void, ctx = world()) => {
    const doc = character(rows, edit);
    const [first] = doc.classes;
    if (first === undefined) throw new Error('no first row');
    return firstClassShift(doc, first, ctx);
  };

  it('names the next class and what moves to it', () => {
    expect(shift([row('Warrior', 1), row('Sneak', 3)])).toBe(
      'Sneak becomes your first class, and a class you add later goes after it: ' +
        'saving throws move from STR and CON to DEX and INT; ' +
        'armor proficiencies lose light, medium, heavy and shield; ' +
        'weapon proficiencies lose simple and martial; max HP goes from 33 to 24; ' +
        'Sneak asks for more skill picks.',
    );
  });

  it('says nothing for a later row or an only class', () => {
    const later = character([row('Sneak', 3), row('Warrior', 1)]);
    expect(firstClassShift(later, row('Warrior', 1), world())).toBeUndefined();
    const only = character([row('Warrior', 1)]);
    expect(firstClassShift(only, row('Warrior', 1), world())).toBeUndefined();
  });

  it('only names the next class when either class has no data to read', () => {
    expect(shift([row('Warrior', 1), row('Unknown', 3)])).toBe(
      'Unknown becomes your first class, and a class you add later goes after it.',
    );
    expect(shift([row('Unknown', 1), row('Sneak', 3)])).toBe(
      'Sneak becomes your first class, and a class you add later goes after it.',
    );
  });

  it('still says what moves when only an unrelated row has no data', () => {
    expect(shift([row('Warrior', 1), row('Sneak', 3), row('Unknown', 1)])).toContain(
      'saving throws move from STR and CON to DEX and INT;',
    );
  });

  it('says nothing when the next class gives the same as the first', () => {
    const warrior = makeTestContext().get('class', 'Warrior', 'TST');
    const twin = { ...warrior, name: 'Twin' } as DataEntity;
    expect(
      shift(
        [row('Warrior', 1), row('Twin', 3)],
        (d) => {
          d.choices['class:twin|tst:skill:0'] = ['athletics', 'survival'];
        },
        world(twin),
      ),
    ).toBeUndefined();
  });

  describe('states only what is true for this character', () => {
    it('keeps a save something else also grants', () => {
      const origin = { label: 'Boon', uid: 'boon|tst', type: 'item' as const };
      const text = shift([row('Warrior', 1), row('Sneak', 3)], (d) => {
        d.customEffects = [{ kind: 'saveProf', ability: 'con', origin }];
      });
      expect(text).toContain('saving throws move from STR to DEX and INT;');
    });

    it('keeps a save the player set by hand', () => {
      const text = shift([row('Warrior', 1), row('Sneak', 3)], (d) => {
        d.overrides['save.str.prof'] = { value: 1 };
        d.overrides['save.con.prof'] = { value: 1 };
        d.overrides['save.dex.prof'] = { value: 0 };
        d.overrides['save.int.prof'] = { value: 0 };
      });
      expect(text).not.toContain('saving throws');
    });

    it('leaves out armor or weapons the next class also has', () => {
      const carrier = {
        name: 'Carrier',
        source: 'TST',
        hd: { number: 1, faces: 8 },
        proficiency: ['str', 'con'],
        startingProficiencies: {
          armor: ['light', 'medium', 'shield'],
          weapons: ['simple', 'martial', 'nets'],
          tools: ['ropes'],
        },
      } as DataEntity;
      const text = shift([row('Warrior', 1), row('Carrier', 3)], undefined, world(carrier));
      expect(text).toContain('armor proficiencies lose heavy;');
      expect(text).toContain('weapon proficiencies gain nets;');
      expect(text).toContain('tool proficiencies gain ropes;');
      expect(text).not.toContain('saving throws');
    });

    it('does not read two spellings of one proficiency as a change', () => {
      const printing = (name: string, tool: string) =>
        ({
          name,
          source: 'TST',
          hd: { number: 1, faces: 8 },
          proficiency: ['dex', 'int'],
          startingProficiencies: { tools: [tool] },
          multiclassing: { proficienciesGained: { tools: [tool] } },
        }) as DataEntity;
      const ctx = world(printing('Lower', 'ropes'), printing('Upper', 'Ropes'));
      const text = shift([row('Lower', 1), row('Upper', 3)], undefined, ctx);
      expect(text).toBeUndefined();
    });

    it('moves max HP only when the first row is worth a different amount', () => {
      const sameDie = shift([row('Warrior', 1), row('Oathkeeper', 3)]);
      expect(sameDie).not.toContain('max HP');
      const maxMethod = shift([row('Warrior', 1), row('Sneak', 3)], (d) => {
        d.hpMethod = 'max';
      });
      expect(maxMethod).not.toContain('max HP');
    });

    it('leaves max HP out when removing it costs what removing it from the end would', () => {
      // 10 + 4 + 5 + 5 first, 8 + 5 + 5 + 6 last: the same 24 either way.
      const rolled = (hp: number[]) =>
        shift([row('Warrior', 1), { ...row('Sneak', 3), hp }], (d) => {
          d.hpMethod = 'rolled';
        });
      expect(rolled([4, 5, 5])).not.toContain('max HP');
      expect(rolled([5, 5, 5])).toContain('max HP goes from 33 to 24;');
    });

    it('leaves max HP out when the player set it by hand', () => {
      const text = shift([row('Warrior', 1), row('Sneak', 3)], (d) => {
        d.overrides.maxHp = { value: 40 };
      });
      expect(text).not.toContain('max HP');
    });

    it('leaves max HP out when the two changes cancel', () => {
      // Mage's first level is 6 - 2. Warrior's first level going from 6 to 10 repays it.
      const text = shift([row('Mage', 1), row('Warrior', 3)], (d) => {
        d.abilities.base.con = 6;
      });
      expect(text).not.toContain('max HP');
    });

    it('asks for more skill picks only when the longer list leaves some open', () => {
      const switcher = {
        name: 'Switcher',
        source: 'TST',
        hd: { number: 1, faces: 8 },
        proficiency: ['dex', 'int'],
        startingProficiencies: {
          skills: [
            { choose: { from: ['stealth', 'acrobatics', 'perception', 'arcana'], count: 3 } },
          ],
        },
        multiclassing: {
          proficienciesGained: { skills: [{ choose: { from: ['stealth'], count: 1 } }] },
        },
      } as DataEntity;
      const holding = (...picks: string[]) =>
        shift(
          [row('Warrior', 1), row('Switcher', 3)],
          (d) => {
            if (picks.length > 0) d.choices['class:switcher|tst:skill:0'] = picks;
          },
          world(switcher),
        );
      const more = 'Switcher asks for more skill picks.';
      expect(holding()).toContain(more);
      expect(holding('stealth')).toContain(more);
      // A saved pick the list no longer offers fills none of them.
      expect(holding('athletics')).toContain(more);
      // Already enough for the longer list, however it was saved.
      expect(holding('stealth', 'acrobatics', 'perception')).not.toContain('skill picks');
    });
  });
});
