/**
 * What a card file gives the effect list (ADR-002, D6): one `KindSpec` per
 * card, each with what that kind does beyond a box per field. The list
 * (`EffectCards`) finds the card files by name, as the Workshop finds its
 * editors, so a new card goes in its group's file and nowhere else.
 */
import type { ComponentType, ReactNode } from 'react';
import type { StoredEffect } from '@/engine/castGuidance';
import type { PickFill } from '@/engine/effects/picks';

export type Eff = StoredEffect;
export type Options = ReadonlyArray<readonly [string, string]>;

export type FieldSpec =
  | {
      key: string;
      label: string;
      type: 'pick';
      options: Options;
      /** The choice it shows, when that is not the field's own value. */
      value?: (e: Eff) => string;
      /** The effect once a choice is picked, when picking does more than set the field. */
      apply?: (e: Eff, v: string) => Eff;
    }
  | { key: string; label: string; type: 'amount' | 'text' | 'dice' };

/** A spell a card can name: the player's data, as `name|source`. */
export interface SpellOption {
  name: string;
  source: string;
}

/** What a list of cards inside a card is given: what a pick gives. */
export interface ListProps {
  effects: unknown;
  readOnly: boolean;
  spells?: readonly SpellOption[];
  resources?: readonly Eff[];
  prefix?: string;
  addLabel?: string;
  fills?: readonly PickFill[];
  picked?: string;
  onChange: (next: Eff[]) => void;
}

/** What a card's own boxes are given. */
export interface CardProps {
  effect: Eff;
  /** Its boxes' names start with this: "Armor Class", "Each pick gives: Skill". */
  title: string;
  /** What the reader says of it. */
  problems: string[];
  /** The pools on the list, and those kept elsewhere it can spend. */
  resources: readonly Eff[];
  /** The spells a "Cast a spell" card can name, when the host gives them. */
  spells?: readonly SpellOption[];
  /** An action's cost can spend the item's charges. */
  charges: boolean;
  /** The one a pick answers (`ask`), when the list is what a pick gives. */
  picked?: string;
  inPick: boolean;
  onChange: (next: Eff, renamedKey?: [string, string]) => void;
  /** The effect list itself, for a card that holds one (what a pick gives). */
  List: ComponentType<ListProps>;
}

/** A field set from a box, when setting it does more than store the value. */
export interface FieldSet {
  next: Eff;
  /** A pool's key changed with its name: what spends it follows. */
  renamed?: [string, string];
}

export interface KindSpec {
  kinds: readonly string[];
  /** For a kind two cards share: whether this card is the one for `e`. */
  is?: (e: Eff) => boolean;
  /** What the add list calls it. */
  add: string;
  make: () => Eff;
  /**
   * A whole one, as the reader takes it, when a new card is not (Cast a spell
   * names no spell yet): what the kind may take is asked of it (`Modifiers`).
   */
  sample?: () => Eff;
  fields: readonly FieldSpec[];
  /** The card's sentence, as the sheet reads it. */
  line: (e: Eff) => string;
  /** Boxes above the card's grid, for one that holds a list of its own (a pick's). */
  above?: (p: CardProps) => ReactNode;
  /** Its own boxes after its fields. */
  boxes?: (p: CardProps) => ReactNode;
  /** Boxes after When, before Rules: a pool's or an action's class in the name. */
  beforeRules?: (p: CardProps) => ReactNode;
  /** Boxes after Rules: an advantage's Only when. */
  after?: (p: CardProps) => ReactNode;
  /** A field set from its box, when that does more than store it; undefined stores it. */
  set?: (e: Eff, key: string, v: unknown, text: string) => FieldSet | undefined;
  /** It never goes in play: a condition's or a spell's card does not offer it. */
  notInPlay?: boolean;
  /** What a pick gives is not built with it; one a file gives is kept as written. */
  notInPick?: boolean;
  /** The field the one a pick of `ask` answers fills, offered as "The pick". */
  picks?: (ask: string | undefined) => string | undefined;
  /** The problems the card itself says, when some belong to cards inside it. */
  ownProblems?: (problems: string[], e: Eff, editable: boolean) => string[];
  /** A problem in the card's own words, when the reader's are not a player's. */
  problemWords?: (p: string) => string | undefined;
}
