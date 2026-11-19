import { describe, expect, it } from 'vitest';
import { fieldPrint, fingerprint, same } from './fingerprint';

const aid = () => ({
  name: 'Aid',
  source: 'XPHB',
  level: 2,
  entries: ['a', { name: 'B', entries: ['c'] }],
  page: 9,
});

describe('fingerprint', () => {
  it('is the mark copies were saved with before it moved here', () => {
    // Worked out by `copyWriter.fingerprint` on main at 3bd37af: a stored
    // `basedOnFingerprint` still matches the entry it was made from.
    expect(fingerprint(aid())).toBe('b7770e28');
  });

  it('reads neither identity nor where the book printed it, nor key order', () => {
    const { level, entries } = aid();
    expect(fingerprint({ entries, level, name: 'Other', source: 'HB', page: 1 })).toBe(
      fingerprint(aid()),
    );
    expect(fingerprint({ ...aid(), level: 3 })).not.toBe(fingerprint(aid()));
  });
});

describe('fieldPrint', () => {
  it('marks one field, so another field moving leaves it', () => {
    expect(fieldPrint({ ...aid(), level: 3 }, 'entries')).toBe(fieldPrint(aid(), 'entries'));
    expect(fieldPrint({ ...aid(), entries: ['x'] }, 'entries')).not.toBe(
      fieldPrint(aid(), 'entries'),
    );
    // A field the entry does not have is a field too: one it gains moves it.
    expect(fieldPrint(aid(), 'range')).not.toBe(fieldPrint({ ...aid(), range: 30 }, 'range'));
  });

  it('marks guidance by its author’s parts, not what a save works out', () => {
    const g = (castGuidance: unknown) => fieldPrint({ ...aid(), castGuidance }, 'castGuidance');
    const effects = [{ kind: 'speedBonus', amount: 10 }];
    expect(g({ v: 1, basedOn: 'Aid|XPHB', effects })).toBe(g({ v: 1, effects }));
    expect(g({ v: 1, effects })).not.toBe(g({ v: 1, effects: [] }));
    expect(g(undefined)).toBe(g({ v: 1, basedOn: 'Aid|PHB' }));
  });

  it('reads only a field the entry holds itself', () => {
    expect(fieldPrint(aid(), 'constructor')).toBe(fieldPrint(aid(), 'nothing'));
    expect(same({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});
