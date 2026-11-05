import type { Entity } from '@/data5e/copyMod';
import type { RulesVersion } from '@/data5e/rulesVersion';
import type {
  ClassLevelEntry,
  DerivedResource,
  PlayState,
  SpellcastingBlock,
} from '@/engine/types';
import { askChoice } from '@/ui/dialogs';
import {
  type CastResource,
  castResourceChipLabel,
  castResourceId,
  castResourceLabel,
  castResourceOptions,
  needsCastChoice,
} from './castResources';

/** What the chooser needs to word its options for one spell. */
export interface CastChoiceContext {
  spellName: string;
  options: readonly CastResource[];
  block: SpellcastingBlock;
  play: PlayState;
  pools: readonly DerivedResource[];
  spell: Entity | undefined;
  spellLevel: number;
  characterLevel: number;
  rulesVersion: RulesVersion;
  classes: readonly ClassLevelEntry[];
}

/** Asks which of `options` to spend; null when the player backs out. */
export async function askCastResource({
  spellName,
  options,
  ...rest
}: CastChoiceContext): Promise<CastResource | null> {
  const picked = await askChoice({
    title: `Cast ${spellName}`,
    detail: 'Choose which slot or pool to spend. A higher level upcasts the spell.',
    options: castResourceOptions(options, rest),
  });
  if (picked === null) return null;
  return options.find((o) => castResourceId(o) === picked) ?? null;
}

/**
 * The choose-then-roll control (GAME-001). A spell that rolls is cast from its
 * roll chip, so the slot has to be settled *before* the dice are rolled: the
 * roll's own dice scale with it. This chip names the resource the next cast
 * will spend and opens the chooser to change it, which leaves the roll chip
 * next to it to do nothing but roll.
 *
 * It renders when there is a real choice, and also when the single remaining
 * option is a pool conversion: that one spends points and a slice of the turn
 * that nothing else on the row mentions, so leaving it unlabelled would let a
 * tap on the roll chip quietly empty a pool the player was saving.
 */
export function CastResourcePicker({
  resource,
  onPick,
  ...context
}: CastChoiceContext & {
  /** What the next cast spends today: the player's pick, or the automatic one. */
  resource: CastResource;
  onPick: (resource: CastResource) => void;
}) {
  const { spellName, options } = context;
  if (!needsCastChoice(options)) return null;
  const choose = async () => {
    const chosen = await askCastResource(context);
    if (chosen !== null) onPick(chosen);
  };
  return (
    <button
      type="button"
      onClick={choose}
      // The chip's text is a compact "L3" / "L3 SP"; the spoken name says which
      // resource that is and that pressing it changes the choice (A11Y-001).
      aria-label={`${spellName}: casting with ${castResourceLabel(resource)}. Change`}
      aria-haspopup="dialog"
      // The accessible name is unreachable with a mouse, and "L3 SP" explains
      // itself to nobody, so the same sentence is the tooltip.
      title={`Casting with ${castResourceLabel(resource).toLowerCase()}. Press to change.`}
      // A plain roll chip's shape (DS-001), the size of the chips beside it:
      // it names a choice and rolls nothing, so it takes no roll colour.
      className="inline-flex h-8.5 min-w-8.5 shrink-0 items-center justify-center rounded-chip px-2 text-dice text-ink tabular-nums ring-1 ring-line-strong ring-inset transition-colors duration-120 hover:bg-surface-raised"
    >
      {castResourceChipLabel(resource)}
    </button>
  );
}
