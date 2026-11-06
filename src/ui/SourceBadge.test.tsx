// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { setRulesBooks } from '@/data5e/rulesVersion';
import { setHomebrewSourceNames } from '@/data5e/sourceNames';
import { SourceBadge, sourceBadgeLabel } from './SourceBadge';

/** A release whose `LATE` book marks only its background, as the later books do. */
const release = () =>
  normalizeDataset(
    new Map<string, unknown>([
      ['backgrounds.json', { background: [{ name: 'Bg', source: 'LATE', edition: 'one' }] }],
      ['feats.json', { feat: [{ name: 'Plain', source: 'OLD' }] }],
    ]),
  );

afterEach(() => {
  cleanup();
  setRulesBooks(new Set());
  setHomebrewSourceNames(new Map());
});

describe('sourceBadgeLabel', () => {
  it('spells out the edition of a book the data marks, with no book named in code', () => {
    expect(sourceBadgeLabel('LATE')).toBe('LATE');
    setRulesBooks(release().rulesBooks);
    expect(sourceBadgeLabel('LATE')).toBe('LATE (2024 rules)');
    expect(sourceBadgeLabel('OLD')).toBe('OLD');
  });

  it('adds it to the title when the book has one', () => {
    // Which book does not matter here; this one's title carries no year.
    expect(sourceBadgeLabel('XGE')).toBe("Xanathar's Guide to Everything");
    setRulesBooks(new Set(['XGE']));
    expect(sourceBadgeLabel('XGE')).toBe("Xanathar's Guide to Everything (2024 rules)");
  });

  it('adds nothing to a title that already carries a year', () => {
    setRulesBooks(new Set(['XPHB', 'PHB']));
    expect(sourceBadgeLabel('XPHB')).toBe("Player's Handbook (2024)");
    expect(sourceBadgeLabel('PHB')).toBe("Player's Handbook (2014)");
  });

  it('reads homebrew as before, whatever its rows mark', () => {
    const reg = release();
    mergeHomebrew(
      reg,
      new Map([
        [
          'brew',
          {
            feat: [
              { name: 'Own', source: 'MINE', edition: 'one' },
              { name: 'Claim', source: 'OLD', edition: 'one' },
            ],
          },
        ],
      ]),
    );
    setRulesBooks(reg.rulesBooks);
    setHomebrewSourceNames(new Map([['MINE', 'My Table Brew']]));
    expect(sourceBadgeLabel('MINE')).toBe('My Table Brew');
    expect(sourceBadgeLabel('OLD')).toBe('OLD');
  });

  it("keeps a brew's title as written when it shares a code with a marked book", () => {
    // A code the title table does not know yet, so the brew's title is what shows.
    setRulesBooks(release().rulesBooks);
    setHomebrewSourceNames(new Map([['LATE', 'My Table Brew']]));
    expect(sourceBadgeLabel('LATE')).toBe('My Table Brew');
  });

  it('labels a published title even when a brew claims the same code', () => {
    // The published title wins in `sourceName`, so the label is about that book.
    setRulesBooks(new Set(['XGE']));
    setHomebrewSourceNames(new Map([['XGE', 'My Table Brew']]));
    expect(sourceBadgeLabel('XGE')).toBe("Xanathar's Guide to Everything (2024 rules)");
  });
});

describe('SourceBadge', () => {
  it('shows the code and carries the label for hover and for a screen reader', () => {
    setRulesBooks(release().rulesBooks);
    const { container } = render(<SourceBadge source="LATE" />);
    expect(screen.getByTitle('LATE (2024 rules)')).toBeTruthy();
    expect(container.querySelector('.sr-only')?.textContent).toBe('LATE (2024 rules)');
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('LATE');
  });
});
