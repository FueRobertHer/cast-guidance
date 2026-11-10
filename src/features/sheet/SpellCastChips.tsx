import { useEffect, useRef } from 'react';
import { useCastLevel } from '@/stores/castLevels';
import { cancelHeldCast, castFrom, refreshHeldCast } from '@/stores/heldRoll';
import { type ChipWear, NOT_WORN } from '@/ui/ChipFace';
import { RollChip } from '@/ui/RollChip';
import { CastButton } from './CastButton';
import {
  castNow,
  castPlan,
  castRowId,
  castStartLevel,
  castsByPrompt,
  castWaysKey,
  type SpellCast,
} from './castPlan';
import type { D20Ask } from './d20Tests';
import { spellRollActions } from './spellRolls';

/**
 * A spell row's dice and Cast (DS-001 SpellRow, with the rolls canvas's
 * "Level at cast" A), the same on Play and on Spells. The control that casts
 * (the spell attack, else the first dice chip, else Cast) opens the prompt
 * with every way to cast as tiles, and the cast spends the tile as it lands. A
 * cantrip or an at-will grant casts at once, with nothing to choose.
 *
 * The casting chip shows the dice at the level the prompt starts on. The
 * row's other dice, an attack spell's damage among them, keep the level last
 * cast, so closing the result loses nothing; a running concentration spell's
 * roll at the level it was cast with, and spend nothing more.
 */
export function SpellCastChips({
  cast,
  running,
  runningLevel,
  usedUp = false,
  castButton = true,
  attack,
  wear,
  castWear,
  castTitle,
}: {
  cast: SpellCast;
  /** Concentrating on it already: its dice are paid for. */
  running: boolean;
  /** The level the running spell was cast with. */
  runningLevel?: number | undefined;
  /** An innate grant with no use left and nothing else to cast it with. */
  usedUp?: boolean;
  /** Whether a spell with no dice shows Cast (Spells shows End there while it runs). */
  castButton?: boolean;
  /** The spell attack chip: its expression, what it shows, and its d20 test. */
  attack?: { expr: string; display: string; roller: () => D20Ask } | undefined;
  /** The conditions on the attack chip. */
  wear: ChipWear;
  /** On Cast and the dice chip that casts: only what stops casting. */
  castWear: ChipWear;
  /** Cast's tooltip. */
  castTitle: string;
}) {
  const { doc, sheet, entity, info } = cast;
  const rowId = castRowId(cast);
  const last = useCastLevel(rowId);
  const prompts = !usedUp && castsByPrompt(cast);
  // A cast waiting in the prompt shows what is left now: a slot spent on the
  // sheet behind it, or a rest, rebuilds its tiles. With nothing left to cast
  // it with, or the row gone from the screen, the cast goes.
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = prompts ? castWaysKey(cast) : '';
    if (key === shown.current) return;
    shown.current = key;
    if (prompts) refreshHeldCast(rowId, () => castPlan(cast));
    else cancelHeldCast(rowId);
  });
  useEffect(() => () => cancelHeldCast(rowId), [rowId]);
  const start = prompts ? castStartLevel(cast) : cast.level;
  const rollsAt = (slotLevel: number) =>
    spellRollActions(entity, {
      characterLevel: sheet.totalLevel,
      slotLevel,
      abilityModifier: cast.abilityModifier,
    });
  const rolls = rollsAt(running ? (runningLevel ?? cast.level) : (last ?? start));
  // The chip that casts shows what the prompt starts on.
  const castingRolls = running || attack !== undefined ? rolls : rollsAt(start);
  // What a tap on the casting chip does: the prompt, or cast at once.
  const casts = !running && !usedUp;
  const castChip = casts
    ? prompts
      ? { cast: () => castPlan(cast) }
      : { onRolled: () => castNow(cast) }
    : {};
  const withAttack = attack === undefined ? undefined : { by: doc.id, of: info.name };
  return (
    <>
      {attack !== undefined && (
        <RollChip
          expr={attack.expr}
          display={attack.display}
          label={`${info.name} spell attack`}
          variant="d20"
          roller={attack.roller}
          wear={wear}
          {...castChip}
        />
      )}
      {rolls.map((action, index) => {
        const first = attack === undefined && index === 0;
        const shown = first ? (castingRolls[0] ?? action) : action;
        return (
          <RollChip
            // biome-ignore lint/suspicious/noArrayIndexKey: a spell's rolls keep their order at every level
            key={`${index}:${action.label}`}
            expr={shown.expr}
            label={shown.label}
            variant={shown.variant}
            withAttack={withAttack}
            {...(first ? castChip : {})}
            wear={first ? (casts ? castWear : NOT_WORN) : undefined}
          />
        );
      })}
      {castButton && attack === undefined && rolls.length === 0 && (
        <CastButton
          wear={castWear}
          aria-label={`Cast ${info.name}`}
          disabled={usedUp}
          title={usedUp ? 'No uses left until you rest' : castTitle}
          onClick={(event) => {
            if (prompts) {
              castFrom(event.currentTarget, castPlan(cast), undefined, {
                face: { text: 'Cast', wear: castWear, tone: 'cast' },
              });
            } else {
              castNow(cast);
            }
          }}
        />
      )}
    </>
  );
}
