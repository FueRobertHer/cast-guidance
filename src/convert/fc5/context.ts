import type { RulesVersion } from '../../data5e/rulesVersion';
import type { ConvertedKind } from '../types';

/** What every Fight Club entry converter is handed. */
export interface Fc5Context {
  /** The homebrew source id every converted entry carries. */
  source: string;
  /** The file's own edition, when its name says (`spells_5.5e.xml`). */
  fileEdition?: RulesVersion;
  /** Feat names in this file, lowercased, so a background's feat can point at one. */
  featNames: ReadonlySet<string>;
  /**
   * Class lists that stub entries add to a spell, by lowercased spell name.
   * Fight Club merges entries that share a name, so a class file lists its
   * subclass spells as `<spell>` with only a name and `<classes>`.
   */
  extraClasses?: ReadonlyMap<string, readonly string[]>;
}

/** One entry converted, with what it lost, or why it was not converted at all. */
export type Fc5Result =
  | { skip: string }
  | {
      kind: ConvertedKind;
      name: string;
      edition: RulesVersion;
      entity: Record<string, unknown>;
      /** What did not carry over, in words; empty for a clean conversion. */
      reasons: string[];
    };
