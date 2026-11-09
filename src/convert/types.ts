/**
 * What a converter hands back: a 5etools homebrew file the app already knows
 * how to store, and a report of what did and did not carry over. The report
 * is what makes an import from another app trustworthy, so it is part of the
 * result, never a log line.
 */
import type { RulesVersion } from '../data5e/rulesVersion';

/** The kinds a converter can produce, named as their 5etools homebrew keys. */
export type ConvertedKind = 'spell' | 'item' | 'feat' | 'background' | 'race' | 'optionalfeature';

/**
 * Whether the installed game data already has this entry: in the book given
 * (its code, any edition), or without one, anywhere in that edition. A
 * converter leaves such entries out: the installed one is the better copy
 * (curated mechanics, structured data), and two of the same thing in a picker
 * is noise.
 */
export type InstalledCheck = (
  kind: ConvertedKind,
  name: string,
  edition: RulesVersion,
  book?: string,
) => boolean;

export interface ConvertOptions {
  /** The imported file's name; it names the homebrew source of entries that cite no book. */
  fileName: string;
  isInstalled?: InstalledCheck;
  /**
   * Whether the installed game data holds a book, by code. An entry from a
   * book it lacks is kept as a printing of its own. Absent, every book the app
   * can name counts as held.
   */
  hasBook?: (code: string) => boolean;
  /** Books the installed data reads as 2024 rules, past the core ones the app knows. */
  rulesBooks?: ReadonlySet<string>;
}

/** One entry that did not convert in full, and why, in words for the player. */
export interface EntryNote {
  /** The other app's element name: `spell`, `item`, `class`, `monster`… */
  kind: string;
  name: string;
  /**
   * `partial`: converted, but something it had is only in its text now.
   * `skipped`: not converted (a kind this app does not read, or a broken entry).
   * `installed`: left out because the game data already has it, or the
   *   entry is a copy of one it has (one per choice, ritual-only, starred).
   * `duplicate`: left out because the file has it twice, or it copies
   *   another entry the file has (its class lists or choices go to that one).
   */
  status: 'partial' | 'skipped' | 'installed' | 'duplicate';
  reasons: string[];
}

export interface ConversionReport {
  /** A stable id for the format, recorded in the converted file's `_meta`. */
  format: string;
  /** The format in words, for the preview's heading. */
  formatName: string;
  converterVersion: number;
  /** Entries written, per 5etools key, partial ones included. */
  converted: Partial<Record<ConvertedKind, number>>;
  /** Every entry that was not a clean conversion, in file order. */
  notes: EntryNote[];
  /** About the file as a whole, not one entry. */
  warnings: string[];
}

export interface ConversionResult {
  /** A 5etools homebrew file: `_meta.sources` plus entity arrays. */
  json: Record<string, unknown>;
  report: ConversionReport;
}

/** The number of entries a report counts as converted. */
export function convertedTotal(report: ConversionReport): number {
  return Object.values(report.converted).reduce((sum, n) => sum + (n ?? 0), 0);
}

/** Notes of one status. */
export function notesWith(report: ConversionReport, status: EntryNote['status']): EntryNote[] {
  return report.notes.filter((n) => n.status === status);
}
