import { useEffect, useRef } from 'react';
import { useCastLevel } from '@/stores/castLevels';
import {
  attackInPlay,
  cancelHeldCast,
  castFrom,
  type DamageAsk,
  refreshHeldCast,
  spellDamageAsk,
} from '@/stores/heldRoll';
import { type ChipWear, NOT_WORN } from '@/ui/ChipFace';
import { RollChip } from '@/ui/RollChip';
import { CastButton } from './CastButton';
import {
  castNow,
  castPlan,
  castRolls,
  castRowId,
  castStartLevel,
  castsByPrompt,
  castWaysKey,
  type SpellCast,
  usedUpTitle,
} from './castPlan';
import type { D20Ask } from './d20Tests';
import { castsLater } from './damageAdds';
import type { SpellRollAction } from './spellRolls';

/**
 * A spell row's dice and Cast (DS-001 SpellRow, with the rolls canvas's
 * "Level at cast" A), the same on Play and on Spells. The control that casts
 * (the spell attack, else the first dice chip, else Cast) opens the prompt
 * with every way to cast as tiles, and the cast spends the tile as it lands. A
 * cantrip or an at-will grant casts at once, with nothing to choose. A spell
 * cast now for damage on later hits (Hex, Divine Favor: `castsLater`) casts
 * from Cast and rolls nothing; its dice chip only rolls, and its hits' damage
 * comes from the damage prompt.
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
  const { doc, info } = cast;
  const rowId = castRowId(cast);
  const last = useCastLevel(rowId);
  const prompts = !usedUp && castsByPrompt(cast);
  // A spell cast now for damage on later hits (Hex, Divine Favor) casts from
  // Cast, rolling nothing: its dice mean nothing yet. Its dice chip only rolls.
  const later = attack === undefined && castsLater(cast.entity);
  const plan = () => (later ? { ...castPlan(cast), dice: () => undefined } : castPlan(cast));
  // A cast waiting in the prompt shows what is left now: a slot spent on the
  // sheet behind it, or a rest, rebuilds its tiles. With nothing left to cast
  // it with, or the row gone from the screen, the cast goes.
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = prompts ? castWaysKey(cast) : '';
    if (key === shown.current) return;
    shown.current = key;
    if (prompts) refreshHeldCast(rowId, plan);
    else cancelHeldCast(rowId);
  });
  useEffect(() => () => cancelHeldCast(rowId), [rowId]);
  const start = prompts ? castStartLevel(cast) : cast.level;
  const rollsAt = (slotLevel: number) => castRolls(cast, slotLevel);
  const rolls = rollsAt(running ? (runningLevel ?? cast.level) : (last ?? start));
  // The chip that casts shows what the prompt starts on.
  const castingRolls = running || attack !== undefined ? rolls : rollsAt(start);
  // What a tap on the casting chip does: the prompt, or cast at once.
  const casts = !running && !usedUp;
  const castChip = casts ? (prompts ? { cast: plan } : { onRolled: () => castNow(cast) }) : {};
  const withAttack = attack === undefined ? undefined : { by: doc.id, of: info.name };
  /**
   * A spell attack's damage asked as a weapon's is (the damage prompt): its
   * dice as the chip shows them, twice when this spell's attack in play crit.
   */
  const damageAsk = (roll: SpellRollAction) => (): DamageAsk => {
    const struck = attackInPlay();
    const crit = struck?.crit === true && struck.by === doc.id && struck.of === info.name;
    return spellDamageAsk({ expr: roll.expr, label: roll.label, kind: 'damage' }, crit);
  };
  // What a hit offers: the spell's damage (a cantrip's at the character's level).
  // A spell cast through the prompt offers its own at the level picked instead.
  const hitDamage = rolls.find((r) => r.variant === 'damage');
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
          {...(hitDamage === undefined
            ? {}
            : {
                damageAfter: {
                  expr: hitDamage.expr,
                  label: hitDamage.label,
                  withAttack,
                  ask: damageAsk(hitDamage),
                },
              })}
        />
      )}
      {rolls.map((action, index) => {
        const first = attack === undefined && index === 0 && !later;
        const shown = first ? (castingRolls[0] ?? action) : action;
        return (
          <RollChip
            // biome-ignore lint/suspicious/noArrayIndexKey: a spell's rolls keep their order at every level
            key={`${index}:${action.label}`}
            expr={shown.expr}
            label={shown.label}
            variant={shown.variant}
            withAttack={withAttack}
            // An attack spell's damage asks first, as a weapon's does.
            {...(attack !== undefined && shown.variant === 'damage'
              ? { damagePrompt: damageAsk(shown) }
              : {})}
            {...(first ? castChip : {})}
            wear={first ? (casts ? castWear : NOT_WORN) : undefined}
          />
        );
      })}
      {castButton && attack === undefined && (rolls.length === 0 || later) && (
        <CastButton
          wear={castWear}
          aria-label={`Cast ${info.name}`}
          disabled={usedUp}
          title={usedUp ? usedUpTitle(cast) : castTitle}
          onClick={(event) => {
            if (prompts) {
              castFrom(event.currentTarget, plan(), undefined, {
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
