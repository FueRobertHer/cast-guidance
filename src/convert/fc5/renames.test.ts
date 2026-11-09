import { describe, expect, it } from 'vitest';
import { nameVariants } from './renames';

describe('nameVariants', () => {
  it('starts with the name as it is', () => {
    expect(nameVariants('spell', 'Ember Lance', [])).toEqual(['Ember Lance']);
  });

  it('reads both names of an entry with two', () => {
    const names = nameVariants('race', 'Emberkin, Ashen / Grey', []);
    expect(names).toContain('Emberkin, Ashen');
    expect(names).toContain('Emberkin, Grey');
  });

  it('turns a list name around', () => {
    const names = nameVariants('race', 'Emberkin, Ashen', []);
    expect(names).toContain('Ashen Emberkin');
    expect(names).toContain('Emberkin (Ashen)');
  });

  it('drops or moves a bracket', () => {
    const names = nameVariants('race', 'Emberkin (Ashlands)', []);
    expect(names).toContain('Emberkin');
    expect(names).toContain('Ashlands Emberkin');
  });

  it('writes a bracketed pair as 5etools shows a subrace', () => {
    expect(nameVariants('race', 'Emberkin (Ashlands, Cinder Clan)', [])).toContain(
      'Emberkin (Ashlands; Cinder Clan)',
    );
    expect(nameVariants('race', 'Emberkin, Cinder Clan (Ashlands)', [])).toContain(
      'Emberkin (Ashlands; Cinder Clan)',
    );
  });

  it('puts an item`s bonus first', () => {
    expect(nameVariants('item', 'Ember Rod, +1', [])).toContain('+1 Ember Rod');
    expect(nameVariants('item', 'Ember Rod +2', [])).toContain('+2 Ember Rod');
  });

  it('reads a race named for its patron, and one named for its ancestry', () => {
    expect(nameVariants('race', 'Emberkin of Ashes', [])).toContain('Emberkin, Ashes');
    expect(nameVariants('race', 'Half-Emberkin, Ashen Ancestry', [])).toContain(
      'Half-Emberkin, Ashen',
    );
    expect(nameVariants('spell', 'Emberkin of Ashes', [])).not.toContain('Emberkin, Ashes');
  });

  it('takes a feat out of its list', () => {
    expect(nameVariants('feat', 'Ember Gift: Ashen Soul', [])).toContain('Ashen Soul');
    expect(nameVariants('feat', 'Ember Mark, Mark of Ash', [])).toContain('Mark of Ash');
    expect(nameVariants('race', 'Emberkin, Ashen', [])).not.toContain('Ashen');
  });

  it('drops a word the cited book`s title starts with', () => {
    expect(nameVariants('background', 'Cinderhold Lamplighter', ['Cinderhold: A Guide'])).toContain(
      'Lamplighter',
    );
    expect(nameVariants('background', 'Cinderhold Lamplighter', ['Ember Codex'])).not.toContain(
      'Lamplighter',
    );
  });

  it('renames one step only', () => {
    // `Emberkin (Ashen)` is a rename of `Emberkin, Ashen`; `Emberkin` is not.
    expect(nameVariants('race', 'Emberkin, Ashen', [])).not.toContain('Emberkin');
  });

  it('looks for a name longer than any real one as it is', () => {
    const name = `Emberkin, ${'Ash'.repeat(100)}`;
    expect(nameVariants('race', name, [])).toEqual([name]);
  });
});
