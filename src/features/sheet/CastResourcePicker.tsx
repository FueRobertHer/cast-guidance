import type { Entity } from '@/data5e/copyMod';
import type { DerivedResource, PlayState, SpellcastingBlock } from '@/engine/types';
import { askChoice } from '@/ui/dialogs';
import {
  type CastResource,
  castResourceChipLabel,
  castResourceId,
  castResourceLabel,
  castResourceOptions,
  needsCastChoice,
} from './castResources';

/**
 * The Play tab's choose-then-roll control (GAME-001). Play-tab casts fire from
 * a roll chip, so the slot has to be settled *before* the dice are rolled: the
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
  spellName,
  resource,
  options,
  block,
  play,
  pools,
  spell,
  spellLevel,
  characterLevel,
  onPick,
}: {
  spellName: string;
  /** What the next cast spends today: the player's pick, or the automatic one. */
  resource: CastResource;
  options: readonly CastResource[];
  block: SpellcastingBlock;
  play: PlayState;
  pools: readonly DerivedResource[];
  spell: Entity | undefined;
  spellLevel: number;
  characterLevel: number;
  onPick: (resource: CastResource) => void;
}) {
  if (!needsCastChoice(options)) return null;
  const choose = async () => {
    const picked = await askChoice({
      title: `Cast ${spellName}`,
      detail: 'Choose which slot or pool to spend — a higher level upcasts the spell.',
      options: castResourceOptions(options, {
        block,
        play,
        pools,
        spell,
        spellLevel,
        characterLevel,
      }),
    });
    if (picked === null) return;
    const chosen = options.find((o) => castResourceId(o) === picked);
    if (chosen !== undefined) onPick(chosen);
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
      className="shrink-0 rounded border border-surface-2 px-1.5 py-0.5 text-xs font-semibold text-ink-muted"
    >
      {castResourceChipLabel(resource)}
    </button>
  );
}
