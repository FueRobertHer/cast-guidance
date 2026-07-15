import { describe, expect, it } from 'vitest';
import { requiredLevel, summarizePrerequisite } from './class';

describe('summarizePrerequisite', () => {
  it('reads ability requirements', () => {
    expect(summarizePrerequisite([{ ability: [{ str: 13 }] }])).toBe('STR 13');
  });

  it('reads warlock invocation gates: pact, patron, spell, spellcasting, level', () => {
    expect(summarizePrerequisite([{ pact: 'Blade' }])).toBe('Pact of the Blade');
    expect(summarizePrerequisite([{ patron: 'The Fiend|PHB' }])).toBe('The Fiend patron');
    expect(summarizePrerequisite([{ spell: ['eldritch blast#c|phb'] }])).toBe(
      'knows eldritch blast',
    );
    expect(summarizePrerequisite([{ spellcasting: true }])).toBe('spellcasting');
    expect(summarizePrerequisite([{ level: 5 }])).toBe('level 5');
    expect(summarizePrerequisite([{ level: { level: 7 } }])).toBe('level 7');
  });

  it('joins multiple parts and is empty for none', () => {
    expect(summarizePrerequisite([{ pact: 'Tome', level: 5 }])).toBe('level 5, Pact of the Tome');
    expect(summarizePrerequisite(undefined)).toBe('');
    expect(summarizePrerequisite([])).toBe('');
  });

  it('reads race, feat, background, and proficiency requirements (previously dropped)', () => {
    expect(summarizePrerequisite([{ race: [{ name: 'elf' }, { name: 'half-elf' }] }])).toBe(
      'race elf/half-elf',
    );
    expect(summarizePrerequisite([{ feat: ['strixhaven initiate|scc'] }])).toBe(
      'strixhaven initiate feat',
    );
    expect(summarizePrerequisite([{ background: ['acolyte|xphb'] }])).toBe('acolyte background');
    expect(summarizePrerequisite([{ proficiency: [{ armor: 'heavy' }] }])).toBe('heavy armor');
    // A subrace qualifier is preserved.
    expect(summarizePrerequisite([{ race: [{ name: 'elf', subrace: 'high' }] }])).toBe(
      'race high elf',
    );
  });

  it('renders alternative requirement sets with "or" instead of flattening to "and"', () => {
    // XPHB Ritual Caster: (level 4 AND INT 13) OR (level 4 AND WIS 13).
    expect(
      summarizePrerequisite([
        { level: 4, ability: [{ int: 13 }] },
        { level: 4, ability: [{ wis: 13 }] },
      ]),
    ).toBe('INT 13, level 4 or WIS 13, level 4');
  });
});

describe('requiredLevel', () => {
  it('returns the highest numeric level prerequisite', () => {
    expect(requiredLevel([{ level: 3 }])).toBe(3);
    expect(requiredLevel([{ level: { level: 7 } }])).toBe(7);
    expect(requiredLevel([{ level: 3 }, { level: 9 }])).toBe(9);
  });

  it('is undefined without a level requirement', () => {
    expect(requiredLevel([{ pact: 'Blade' }])).toBeUndefined();
    expect(requiredLevel(undefined)).toBeUndefined();
  });
});
