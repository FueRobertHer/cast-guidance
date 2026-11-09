import type { RulesVersion } from '../../data5e/rulesVersion';
import type { ConvertedKind, OfficialFeat } from '../types';
import type { Book, HomebrewSource } from './books';
import { officialName } from './renames';

/**
 * Where an entry belongs: the source it carries, its rules edition, and the
 * 5etools fields that cite its book (`page`).
 */
export interface Placement {
  source: HomebrewSource;
  edition: RulesVersion;
  /** The entry's own book, when its `Source:` line names one. */
  book?: Book;
  /** Every book the `Source:` line names, the entry's own first. */
  books: readonly Book[];
  /** The 5etools fields that cite the book, for the entity: `page`. */
  fields: Record<string, unknown>;
  /**
   * The citation as a line of text, when it names more than the entry's own
   * book. Fight Club cites reprints and references alike (`Griffon's
   * Saddlebag p. 39, Player's Handbook p. 149` for a magic quarterstaff), so
   * the others cannot become 5etools `otherSources`, which says "also
   * printed in".
   */
  citation?: string;
  /**
   * The official book the entry is printed in, by the game data's code, when
   * its book is one the app knows and its edition is that book's. A free rules
   * text has none: its entries are under the books they come from.
   */
  officialBook?: string;
}

/** What every Fight Club entry converter is handed. */
export interface Fc5Context {
  /**
   * Where an entry with this `Source:` line belongs. `edition` is what the
   * entry says of itself (a `[5.5e]` name marker), which wins over its book.
   */
  place(sourceLine: string | undefined, edition: RulesVersion | undefined): Placement;
  /**
   * Feats this file's converted output holds, by lowercased name and by the
   * name without the group Fight Club puts before or after it (`Dragonmark,
   * Mark of Making`, `Mist Walker (Dark Gift)`), so a background's feat can
   * point at one.
   */
  featSources: ReadonlyMap<string, readonly FeatRef[]>;
  /** The installed feat a background's feat stands for, when the file has none. */
  officialFeat?: OfficialFeat;
  /**
   * Class lists that stub entries add to a spell, by {@link extraClassKey}.
   * Fight Club merges entries that share a name, so a class file lists its
   * subclass spells as `<spell>` with only a name and `<classes>`, and a
   * starred copy (`Hold Person*`) adds them the same way.
   */
  extraClasses?: ReadonlyMap<string, readonly string[]>;
}

/** A feat the file's output holds: its name and source as written, and whether it is under another name. */
export interface FeatRef {
  name: string;
  source: string;
  alias: boolean;
}

/** One entry converted, with what it lost, or why it was not converted at all. */
export type Fc5Result =
  | { skip: string }
  | {
      kind: ConvertedKind;
      name: string;
      edition: RulesVersion;
      entity: Record<string, unknown>;
      /** Where the entry belongs; its source joins the file's `_meta.sources` if it is kept. */
      placement: Placement;
      /** What did not carry over, in words; empty for a clean conversion. */
      reasons: string[];
    };

/**
 * The key {@link Fc5Context.extraClasses} files a spell's added class lists
 * under: its name and the edition its own name marks, so a `[5.5e]` copy's
 * lists go to the 2024 spell and not to the 2014 one of the same name.
 */
export function extraClassKey(name: string, edition: RulesVersion | undefined): string {
  return `${name.toLowerCase()}|${edition ?? ''}`;
}

/** Put a placement's source, edition and citation on an entity being built. */
export function placeEntity(entity: Record<string, unknown>, placement: Placement): void {
  entity.source = placement.source.json;
  if (placement.edition === '2024') entity.edition = 'one';
  Object.assign(entity, placement.fields);
}

/**
 * The official entry a converted entry prints, as `name|source`, for its
 * `printingOf`: the curated mechanics and spend links written for that entry
 * reach the copy through it, with or without the official data installed. An
 * entry from a book the app knows names that book; one from a free rules text
 * names the book the text takes it from, by the edition its name marks, else
 * the text's: the Player's Handbook, or the Dungeon Master's Guide for a magic
 * item. A name holding `|` would read as another ref, so it names none.
 */
export function printingRef(
  kind: ConvertedKind,
  entity: Record<string, unknown>,
  placement: Placement,
): string | undefined {
  const name = entity.name;
  if (typeof name !== 'string' || name === '' || name.includes('|')) return undefined;
  let book = placement.officialBook;
  if (book === undefined && placement.book?.reference === true) {
    const magic = kind === 'item' && entity.rarity !== undefined && entity.rarity !== 'none';
    const is2024 = placement.edition === '2024';
    book = magic ? (is2024 ? 'XDMG' : 'DMG') : is2024 ? 'XPHB' : 'PHB';
  }
  return book === undefined ? undefined : `${officialName(kind, name)}|${book}`;
}

/** The citation line some entries keep at the end of their text. */
export function citationEntry(placement: Placement): string | undefined {
  return placement.citation === undefined ? undefined : `{@i Source: ${placement.citation}}`;
}
