import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import type { EffectOrigin } from '@/engine/types';
import { makeBackgroundBlurb } from './pickerHints';

const CRIMINAL = {
  name: 'Criminal',
  source: 'TST',
  skillProficiencies: [{ deception: true, stealth: true, 'sleight of hand': true }],
} as Entity;

const ROGUE: EffectOrigin = { label: 'Rogue', uid: 'rogue|tst', type: 'class' };
const ELF: EffectOrigin = { label: 'Elf', uid: 'elf|tst', type: 'race' };

describe('makeBackgroundBlurb', () => {
  it('lists the fixed skills, named as the sheet names them', () => {
    expect(makeBackgroundBlurb()(CRIMINAL)).toBe('Skills: Deception, Stealth, Sleight of Hand');
  });

  it('says which of them the character already has, and from what', () => {
    const blurb = makeBackgroundBlurb({
      Stealth: { sourcesBesideBackground: [ROGUE] },
      Deception: { sourcesBesideBackground: [ELF, ROGUE] },
      'Sleight of Hand': { sourcesBesideBackground: [] },
    });
    expect(blurb(CRIMINAL)).toBe(
      'Skills: Deception, Stealth, Sleight of Hand · Deception already from Elf (species) and Rogue (class) · Stealth already from Rogue (class)',
    );
  });

  it('has nothing to say about a background without fixed skills', () => {
    const scholar = {
      name: 'Scholar',
      source: 'TST',
      skillProficiencies: [{ choose: { from: ['arcana', 'history'], count: 2 } }],
    } as Entity;
    expect(makeBackgroundBlurb()(scholar)).toBeUndefined();
  });
});
