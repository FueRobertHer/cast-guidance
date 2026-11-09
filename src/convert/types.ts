/**
 * What a converter hands back: a 5etools homebrew file the app already knows
 * how to store, and a report of what did and did not carry over. The report
 * is what makes an import from another app trustworthy, so it is part of the
 * result, never a log line.
 */
import type { RulesVersion } from '../data5e/rulesVersion';

/** The kinds a converter can produce, named as their 5etools homebrew keys. */
export type ConvertedKind = 'spell' | 'item' | 'feat' | 'background' | 'race';

/**
 * Whether the installed game data already has this entry. A converter leaves
 * such entries out: the installed one is the better copy (curated mechanics,
 * structured data), and two of the same thing in a picker is noise.
 */
export type InstalledCheck = (kind: ConvertedKind, name: string, edition: RulesVersion) => boolean;

export interface ConvertOptions {
  /** The imported file's name; it names the homebrew source. */
  fileName: string;
  isInstalled?: InstalledCheck;
}

/** One entry that did not convert in full, and why, in words for the player. */
export interface EntryNote {
  /** The other app's element name: `spell`, `item`, `class`, `monster`… */
  kind: string;
  name: string;
  /**
   * `partial`: converted, but something it had is only in its text now.
   * `skipped`: not converted (a kind this app does not read, or a broken entry).
   * `installed`: left out because the game data already has it.
   * `duplicate`: left out because the file has it twice.
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
