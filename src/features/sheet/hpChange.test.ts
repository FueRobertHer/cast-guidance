import { describe, expect, it } from 'vitest';
import { fillShare, hpBand, hpChange } from './hpChange';

const at = (currentHp: number, tempHp = 0, maxHp = 42) => ({ currentHp, tempHp, maxHp });

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
    expect(hpChange(at(42), at(42))).toBeNull();
    // Damage at 0 with no temp HP, healing at full: the numbers stay put.
    expect(hpChange(at(0), at(0))).toBeNull();
    expect(hpChange(at(30, 5), at(30, 5))).toBeNull();
  });

  it('reads a hit as HP lost, red', () => {
    expect(hpChange(at(30), at(25))).toEqual({
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
    expect(hpChange(at(30, 8), at(30, 3))).toMatchObject({
      lost: 0,
      soaked: 5,
      shieldBroke: false,
    });
    expect(hpChange(at(30, 3), at(28, 0))).toMatchObject({
      lost: 2,
      soaked: 3,
      shieldBroke: true,
    });
  });

  it('calls a quarter of max HP or more a big hit, and so is any drop to 0', () => {
    expect(hpChange(at(30), at(20))?.big).toBe(false);
    expect(hpChange(at(30), at(19))?.big).toBe(true);
    expect(hpChange(at(3), at(0))).toMatchObject({ down: true, big: true });
  });

  it('reads healing as HP gained, and from 0 as back up', () => {
    expect(hpChange(at(20), at(25))).toMatchObject({ gained: 5, up: false });
    expect(hpChange(at(0), at(7))).toMatchObject({ gained: 7, up: true });
  });

  it('reads more temp HP as a ward going up, and less as soaked', () => {
    expect(hpChange(at(30), at(30, 8))).toMatchObject({ warded: true, soaked: 0 });
    expect(hpChange(at(30, 5), at(30, 9))).toMatchObject({ warded: true });
    expect(hpChange(at(30, 9), at(30, 5))).toMatchObject({ warded: false, soaked: 4 });
  });

  it('notices the bar changing colour only as current HP moves', () => {
    expect(hpChange(at(24), at(19))?.bandChanged).toBe(true);
    expect(hpChange(at(19), at(24))?.bandChanged).toBe(true);
    expect(hpChange(at(30), at(25))?.bandChanged).toBe(false);
    expect(hpChange(at(10, 0), at(10, 5))?.bandChanged).toBe(false);
  });
});

describe('fillShare', () => {
  it('is current over max, as the fill is drawn', () => {
    expect(fillShare(at(21))).toBeCloseTo(50);
    expect(fillShare(at(0))).toBe(0);
    expect(fillShare(at(50))).toBe(100);
    expect(fillShare(at(5, 0, 0))).toBe(0);
  });

  it('shrinks with the temp HP piece where the two come to more than the bar', () => {
    // 38 and 10 of 42: 90.5% and 23.8%, squeezed alike into 100%.
    const fill = (38 / 42) * 100;
    const temp = (10 / 42) * 100;
    expect(fillShare(at(38, 10))).toBeCloseTo((fill * 100) / (fill + temp));
    expect(fillShare(at(20, 10))).toBeCloseTo((20 / 42) * 100);
  });
});

describe('hpChange, as max HP moves', () => {
  it('reads each band against its own maximum', () => {
    // 30 of 42 is green; clamped to 21 of 21 by a halved max, still green.
    expect(hpChange(at(30, 0, 42), at(21, 0, 21))?.bandChanged).toBe(false);
    // 12 of 42 is amber; 12 of 50 is red.
    expect(hpChange(at(12, 0, 42), at(11, 0, 50))?.bandChanged).toBe(true);
  });

  it('calls a hit big against the maximum it landed on', () => {
    expect(hpChange(at(30, 0, 42), at(21, 0, 21))?.big).toBe(false);
  });
});
