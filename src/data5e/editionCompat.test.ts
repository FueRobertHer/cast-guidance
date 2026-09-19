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

/** A 2014 printing, optionally declaring what reprints it. */
const old = (name: string, reprintedAs?: unknown): Entity =>
  ({ name, source: 'PHB', ...(reprintedAs === undefined ? {} : { reprintedAs }) }) as Entity;
/** A 2024 printing (XPHB is a core 2024 source). */
const revised = (name: string): Entity => ({ name, source: 'XPHB' }) as Entity;

const nothingInstalled = () => false;
const allInstalled = () => true;

describe('editionFit', () => {
  it('says nothing when the pick already suits the character', () => {
    expect(editionFit(old('Fighter'), '2014', allInstalled)).toEqual({ kind: 'match' });
    expect(editionFit(revised('Fighter'), '2024', allInstalled)).toEqual({ kind: 'match' });
  });

  it('names the reprint when the newer books have one and it is installed', () => {
    const fit = editionFit(old('Elf', ['Elf|XPHB']), '2024', allInstalled);
    expect(fit).toEqual({ kind: 'reprinted', as: { name: 'Elf', source: 'XPHB' } });
  });

  it('is a carry-over when the reprint is declared but not installed', () => {
    // Offering a reprint the device does not have would send someone looking
    // for content that never downloaded.
    expect(editionFit(old('Elf', ['Elf|XPHB']), '2024', nothingInstalled)).toEqual({
      kind: 'carryOver',
    });
  });

  it('is a carry-over when nothing reprints it at all', () => {
    expect(editionFit(old('Kalashtar'), '2024', allInstalled)).toEqual({ kind: 'carryOver' });
  });

  it('picks the first installed reprint when several are declared', () => {
    const installed = (ref: { source: string }) => ref.source === 'XMM';
    expect(editionFit(old('Thing', ['A|XPHB', 'B|XMM']), '2024', installed)).toEqual({
      kind: 'reprinted',
      as: { name: 'B', source: 'XMM' },
    });
  });

  it('flags newer content in an older game, reprints being irrelevant there', () => {
    // 2024 content in a 2014 game cannot be "reprinted back", so the direction
    // matters: this is the case the pickers never produce and only a switch or
    // an import can create.
    expect(editionFit(revised('Elf'), '2014', allInstalled)).toEqual({ kind: 'newer' });
    expect(editionFit(revised('Elf'), '2014', nothingInstalled)).toEqual({ kind: 'newer' });
  });

  it('honours an explicit edition tag over the source heuristic', () => {
    const homebrew2024 = { name: 'Homebrewed', source: 'MINE', edition: 'one' } as Entity;
    expect(editionFit(homebrew2024, '2024', allInstalled)).toEqual({ kind: 'match' });
    expect(editionFit(homebrew2024, '2014', allInstalled)).toEqual({ kind: 'newer' });
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
