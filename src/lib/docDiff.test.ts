import { describe, expect, it } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { burstKey, type DocChange, diffDocs, sameContent, summarizeChanges } from './docDiff';

const base = (): CharacterDoc => newCharacterDoc('c1', 'Bo', 'tag');
/** A copy of the base document with `edit` applied. */
const edited = (edit: (doc: CharacterDoc) => void): CharacterDoc => {
  const doc = base();
  edit(doc);
  return doc;
};
const lines = (from: CharacterDoc, to: CharacterDoc) => diffDocs(from, to).map((c) => c.line);
const wizard = (levels: number, subclass?: string): CharacterDoc['classes'][number] => ({
  ref: { name: 'Wizard', source: 'PHB' },
  subclass: subclass === undefined ? undefined : { name: subclass, source: 'PHB' },
  levels,
  hp: Array.from({ length: levels }, () => 'avg' as const),
});

describe('diffDocs', () => {
  it('finds nothing between identical characters', () => {
    expect(diffDocs(base(), base())).toEqual([]);
  });

  it('ignores bookkeeping the player never sees', () => {
    const to = edited((d) => {
      d.updatedAt = '2030-01-01T00:00:00.000Z';
      d.createdAt = '2000-01-01T00:00:00.000Z';
      d.schemaVersion = 999;
      d.homebrewDeps = ['x'];
    });
    expect(diffDocs(base(), to)).toEqual([]);
    expect(sameContent(base(), to)).toBe(true);
  });

  it('treats a missing turn tracker or HP rule as their defaults', () => {
    const old = edited((d) => {
      delete d.play.turn;
      delete d.hpMethod;
    });
    const fresh = edited((d) => {
      d.play.turn = { action: false, bonus: false, reaction: false };
      d.hpMethod = 'average';
    });
    expect(diffDocs(old, fresh)).toEqual([]);
    expect(sameContent(old, fresh)).toBe(true);
  });

  it('treats zero-valued play entries as absent', () => {
    // Ticking a pip and unticking it leaves {used: 0} where there was nothing.
    const touched = edited((d) => {
      d.play.resources = [{ key: 'rage', used: 0 }];
      d.play.hitDiceSpent = { d8: 0 };
      d.play.slotsSpent = [0, 0];
      d.play.conditions = [{ id: 'exhaustion', level: 0 }];
    });
    const untouched = edited((d) => {
      d.play.conditions = [{ id: 'exhaustion' }];
    });
    expect(diffDocs(untouched, touched)).toEqual([]);
    expect(sameContent(untouched, touched)).toBe(true);
  });

  it('keeps whether HP still follows the maximum', () => {
    const following = edited((d) => {
      d.play.hpInitialized = false;
    });
    const settled = edited((d) => {
      d.play.hpInitialized = true;
    });
    expect(sameContent(following, settled)).toBe(false);
  });

  it('is not fooled by key order', () => {
    const reordered = base();
    const { str, ...rest } = reordered.abilities.base;
    reordered.abilities.base = { ...rest, str };
    expect(sameContent(base(), reordered)).toBe(true);
  });

  it('describes play-state changes as from and to', () => {
    const from = edited((d) => {
      d.play.currentHp = 12;
      d.play.slotsSpent = [2];
      d.play.conditions = [{ id: 'prone' }, { id: 'exhaustion', level: 2 }];
    });
    const to = edited((d) => {
      d.play.currentHp = 20;
      d.play.tempHp = 5;
      d.play.slotsSpent = [0];
      d.play.conditions = [{ id: 'poisoned' }, { id: 'exhaustion', level: 3 }];
      d.play.hitDiceSpent = { d8: 1 };
      d.play.resources = [{ key: 'arcane-recovery', used: 1 }];
      d.play.deathSaves = { success: 1, fail: 2 };
      d.play.concentratingOn = { label: 'Bless' };
      d.play.inspiration = true;
      d.play.currency.gp = 25;
      d.play.xp = 900;
      d.play.turn = { action: true, bonus: false, reaction: true };
    });
    expect(lines(from, to)).toEqual([
      'HP 12 → 20',
      'Temp HP 0 → 5',
      'Conditions: +poisoned, −prone',
      'exhaustion 2 → 3',
      'Level 1 slots spent 2 → 0',
      'Hit dice (d8) spent 0 → 1',
      'arcane recovery used 0 → 1',
      'Death saves none → 1 success, 2 failures',
      'Concentrating: none → Bless',
      'Inspiration no → yes',
      'GP 0 → 25',
      'XP 0 → 900',
      'Turn: fresh → action + reaction used',
    ]);
  });

  it('matches gear by entry, so a quantity change is not an add and a remove', () => {
    const arrows = { id: 'e1', ref: { name: 'Arrow', source: 'PHB' }, qty: 20 };
    const from = edited((d) => {
      d.equipment = [
        { ...arrows, equipped: false, attuned: false },
        {
          id: 'e2',
          ref: { name: 'Longsword', source: 'PHB' },
          qty: 1,
          equipped: true,
          attuned: false,
        },
      ];
    });
    const to = edited((d) => {
      d.equipment = [
        { ...arrows, qty: 14, equipped: false, attuned: false },
        { id: 'e3', custom: { name: 'Shield' }, qty: 1, equipped: true, attuned: false },
      ];
    });
    expect(lines(from, to)).toEqual(['Gear: +Shield, −Longsword', 'Arrow ×20 → ×14']);
  });

  it('names prepared and known spells that moved', () => {
    const ref = (name: string) => ({ name, source: 'PHB' });
    const from = edited((d) => {
      d.spellcasting = { 'Cleric|PHB': { known: [], prepared: [ref('Shield of Faith')] } };
    });
    const to = edited((d) => {
      d.spellcasting = {
        'Cleric|PHB': { known: [ref('Sacred Flame')], prepared: [ref('Bless')] },
      };
    });
    expect(lines(from, to)).toEqual(['Prepared: +Bless, −Shield of Faith', 'Known: +Sacred Flame']);
  });

  it('marks class, level, subclass and species changes as structural', () => {
    const from = edited((d) => {
      d.classes = [wizard(5, 'School of Evocation')];
      d.race = { name: 'Elf', source: 'PHB' };
    });
    const to = edited((d) => {
      d.classes = [wizard(4)];
      d.race = { name: 'Human', source: 'PHB' };
    });
    const changes = diffDocs(from, to);
    expect(changes.map((c) => c.line)).toEqual([
      'Wizard 5 → 4',
      'Wizard subclass: School of Evocation → none',
      'Species: Elf → Human',
    ]);
    expect(changes.every((c) => c.structural)).toBe(true);
  });

  it('shows the source when only the edition of a species changed', () => {
    const from = edited((d) => {
      d.race = { name: 'Elf', source: 'PHB' };
    });
    const to = edited((d) => {
      d.race = { name: 'Elf', source: 'XPHB' };
    });
    expect(lines(from, to)).toEqual(['Species: Elf (PHB) → Elf (XPHB)']);
  });

  it('names a field it does not describe rather than reporting no difference', () => {
    const from = edited((d) => {
      d.classes = [wizard(1), { ...wizard(1), ref: { name: 'Fighter', source: 'PHB' } }];
    });
    const to = edited((d) => {
      d.classes = [...from.classes].reverse();
    });
    expect(lines(from, to)).toEqual(['Class details']);
  });
});

describe('burstKey', () => {
  const change = (kind: DocChange['kind'], structural = false): DocChange => ({
    kind,
    line: kind,
    structural,
  });

  it('cannot merge an empty or structural step', () => {
    expect(burstKey([])).toBeUndefined();
    expect(burstKey([change('hp'), change('class', true)])).toBeUndefined();
    expect(burstKey([change('other', true)])).toBeUndefined();
  });

  it('keys taking hits the same with or without temp HP', () => {
    expect(burstKey([change('hp')])).toBe(burstKey([change('tempHp'), change('hp')]));
    expect(burstKey([change('hp')])).toBe(burstKey([change('hp'), change('deathSaves')]));
  });

  it('keys different kinds of edit apart', () => {
    expect(burstKey([change('hp')])).not.toBe(burstKey([change('notes')]));
    expect(burstKey([change('hp'), change('slots')])).toBe('spend+vitals');
  });
});

describe('summarizeChanges', () => {
  it('caps the list with a count of the rest', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      kind: 'notes' as const,
      line: `line ${i}`,
      structural: false,
    }));
    expect(summarizeChanges(many, 3)).toEqual(['line 0', 'line 1', 'line 2', '…and 2 more']);
    expect(summarizeChanges(many)).toHaveLength(5);
  });
});
