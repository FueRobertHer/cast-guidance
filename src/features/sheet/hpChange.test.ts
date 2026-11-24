import { describe, expect, it } from 'vitest';
import { hpBand, hpChange } from './hpChange';

const at = (currentHp: number, tempHp = 0) => ({ currentHp, tempHp });

describe('hpBand', () => {
  it('is green over half, amber over a quarter, red below, as the bar colours it', () => {
    expect(hpBand(22, 42)).toBe('high');
    expect(hpBand(21, 42)).toBe('mid');
    expect(hpBand(11, 42)).toBe('mid');
    expect(hpBand(10, 42)).toBe('low');
    expect(hpBand(0, 42)).toBe('low');
  });

  it('holds HP over max (a house rule) at the top, and no max at the bottom', () => {
    expect(hpBand(50, 42)).toBe('high');
    expect(hpBand(5, 0)).toBe('low');
  });
});

describe('hpChange', () => {
  it('is nothing when nothing a cue shows changed', () => {
    expect(hpChange(at(42), at(42), 42)).toBeNull();
    // Damage at 0 with no temp HP, healing at full: the numbers stay put.
    expect(hpChange(at(0), at(0), 42)).toBeNull();
    expect(hpChange(at(30, 5), at(30, 5), 42)).toBeNull();
  });

  it('reads a hit as HP lost, red', () => {
    expect(hpChange(at(30), at(25), 42)).toEqual({
      lost: 5,
      soaked: 0,
      gained: 0,
      warded: false,
      shieldBroke: false,
      down: false,
      up: false,
      big: false,
      bandChanged: false,
    });
  });

  it('keeps a hit temp HP soaked apart from HP lost, and breaks the shield when it runs out', () => {
    expect(hpChange(at(30, 8), at(30, 3), 42)).toMatchObject({
      lost: 0,
      soaked: 5,
      shieldBroke: false,
    });
    expect(hpChange(at(30, 3), at(28, 0), 42)).toMatchObject({
      lost: 2,
      soaked: 3,
      shieldBroke: true,
    });
  });

  it('calls a quarter of max HP or more a big hit, and so is any drop to 0', () => {
    expect(hpChange(at(30), at(20), 42)?.big).toBe(false);
    expect(hpChange(at(30), at(19), 42)?.big).toBe(true);
    expect(hpChange(at(3), at(0), 42)).toMatchObject({ down: true, big: true });
  });

  it('reads healing as HP gained, and from 0 as back up', () => {
    expect(hpChange(at(20), at(25), 42)).toMatchObject({ gained: 5, up: false });
    expect(hpChange(at(0), at(7), 42)).toMatchObject({ gained: 7, up: true });
  });

  it('reads more temp HP as a ward going up, and less as soaked', () => {
    expect(hpChange(at(30), at(30, 8), 42)).toMatchObject({ warded: true, soaked: 0 });
    expect(hpChange(at(30, 5), at(30, 9), 42)).toMatchObject({ warded: true });
    expect(hpChange(at(30, 9), at(30, 5), 42)).toMatchObject({ warded: false, soaked: 4 });
  });

  it('notices the bar changing colour only as current HP moves', () => {
    expect(hpChange(at(24), at(19), 42)?.bandChanged).toBe(true);
    expect(hpChange(at(19), at(24), 42)?.bandChanged).toBe(true);
    expect(hpChange(at(30), at(25), 42)?.bandChanged).toBe(false);
    expect(hpChange(at(10, 0), at(10, 5), 42)?.bandChanged).toBe(false);
  });
});
