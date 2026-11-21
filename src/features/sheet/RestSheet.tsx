import { useId, useState } from 'react';
import type { TableRuleChoices } from '@/engine/castGuidance';
import { endsAtRest } from '@/engine/effectLife';
import { restTakes } from '@/engine/rules';
import type { ActiveEffect } from '@/engine/types';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/sheet';
import { ordinal } from './castResources';
import { andList, restLasts } from './effectsInPlay';
import { pickedLevels, type SlotPicks, type SlotRecovery } from './rest';

type Rest = 'short' | 'long';
type Length = TableRuleChoices['restLength'];

/** What the short rest sheet shows besides the effects: hit points, hit dice, what comes back. */
export interface ShortRestView {
  /** Hit points now, of the maximum the HP card heals up to. */
  hp: { current: number; max: number; temp: number };
  /** Each size of hit die, with how many are left to spend. */
  hitDice: ReadonlyArray<{ die: string; left: number; total: number }>;
  /** Spends one die of the size, as the HP card's chip does. */
  onSpendHitDie: (die: string) => void;
  /** What the rest would give back, in the rest's own words (`shortRestWouldRestore`). */
  restores: readonly string[];
  /** Pools that give back spent slots as the rest ends, with a use left (`slotRecoveries`). */
  recoveries?: readonly SlotRecovery[];
  /** Each level with slots spent (`spentSlots`). */
  spentSlots?: ReadonlyArray<{ level: number; spent: number }>;
}

/** Slots picked to give back, by recovery pool key. */
export type RecoveryPicks = ReadonlyMap<string, SlotPicks>;

/**
 * A rest: which of the effects in play it ends, ticked by what each one
 * lasts (a short rest ends an hour or less, a long one eight hours or less),
 * for the player to untick what their table says stays (the buffs canvas,
 * Together). The app counts neither rounds nor hours, so this is the moment a
 * duration decides anything. A short rest always asks (`short`): it is where
 * hit dice are spent, one tap a die, and it says what it gives back.
 */
export function RestSheet({
  rest,
  length = 'standard',
  open,
  effects,
  detail,
  short,
  onOpenChange,
  onRest,
}: {
  /** The rest asked about, kept while the sheet slides away so it says the same. */
  rest: Rest;
  /** How long the table's rests take (the rest length rule): what each one ends. */
  length?: Length;
  open: boolean;
  effects: readonly ActiveEffect[];
  /** What else the rest does, said above the list (a long rest's refill). */
  detail?: string;
  /** A short rest's hit points, hit dice and what it gives back. */
  short?: ShortRestView;
  onOpenChange: (open: boolean) => void;
  onRest: (rest: Rest, ends: ReadonlySet<string>, recover: RecoveryPicks) => void;
}) {
  // Each opening counted, so each one ticks afresh.
  const [openings, setOpenings] = useState(open ? 1 : 0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpenings((n) => n + 1);
  }
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel aria-describedby={undefined} className="flex max-h-[85dvh] flex-col">
          {/* How long it takes under the table's rest length rule. */}
          <Sheet.Heading aside={restTakes(length, rest)}>
            {rest === 'short' ? 'Short rest' : 'Long rest'}
          </Sheet.Heading>
          <RestEnds
            key={`${rest} ${openings}`}
            rest={rest}
            length={length}
            effects={effects}
            detail={detail}
            short={short}
            onRest={onRest}
          />
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

function RestEnds({
  rest,
  length,
  effects,
  detail,
  short,
  onRest,
}: {
  rest: Rest;
  length: Length;
  effects: readonly ActiveEffect[];
  detail?: string | undefined;
  short?: ShortRestView | undefined;
  onRest: (rest: Rest, ends: ReadonlySet<string>, recover: RecoveryPicks) => void;
}) {
  // The list as it opened, so the rows a rest ends stay put while it slides
  // away; what comes back too, which the rest taken would otherwise empty.
  const [listed] = useState(effects);
  const [restores] = useState(short?.restores);
  // The pools and spent slots as it opened: hit dice spent on the way change neither.
  const [recoveries] = useState(short?.recoveries ?? []);
  const [spent] = useState(short?.spentSlots ?? []);
  const [picks, setPicks] = useState<RecoveryPicks>(new Map());
  const [ends, setEnds] = useState<ReadonlySet<string>>(
    () => new Set(listed.filter((e) => endsAtRest(e, rest, length)).map((e) => e.id)),
  );
  const tick = (id: string, on: boolean) =>
    setEnds((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto text-body">
        {detail !== undefined && <p className="mb-3 text-ink-muted">{detail}</p>}
        {/* With nothing back by itself, a recovery pool below still gives slots back. */}
        {restores !== undefined && (restores.length > 0 || recoveries.length === 0) && (
          <p className="mb-3 text-ink-muted">
            {restores.length > 0
              ? `Gives back ${andList(restores)}.`
              : 'Nothing spent comes back on a short rest.'}
          </p>
        )}
        {short !== undefined && <HitDiceSpend short={short} />}
        {recoveries.map((pool) => (
          <SlotRecoveryPick
            key={pool.key}
            pool={pool}
            spent={spent}
            picks={picks}
            onPick={(next) => setPicks((was) => new Map(was).set(pool.key, next))}
          />
        ))}
        {listed.length > 0 && (
          <>
            <fieldset>
              <legend className="mb-1 text-heading">Ends, by what each one lasts</legend>
              {listed.map((e) => {
                const on = ends.has(e.id);
                return (
                  <label
                    key={e.id}
                    className="-mx-2 flex min-h-tap items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(event) => tick(e.id, event.target.checked)}
                      className="size-5 shrink-0 accent-ink"
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body-strong">{e.name}</span>
                      <span className="text-caption text-ink-muted">{restLasts(e, on)}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <p className="mt-2 text-caption text-ink-muted">Untick what your table says stays.</p>
          </>
        )}
      </div>
      <Button
        variant="brand"
        size="lg"
        block
        className="mt-4 shrink-0"
        onClick={() => onRest(rest, ends, picks)}
      >
        {rest === 'short' ? 'Take the short rest' : 'Take the long rest'}
      </Button>
    </>
  );
}

/**
 * Hit dice to spend before the short rest ends, one tap a die, with the hit
 * points they heal up to. Live: each tap rolls, heals and logs at once.
 */
function HitDiceSpend({ short }: { short: ShortRestView }) {
  const { hp, hitDice, onSpendHitDie } = short;
  const none = hitDice.every((d) => d.left <= 0);
  const id = useId();
  return (
    <section aria-labelledby={id} className="mb-4">
      <h3 id={id} className="mb-1 text-heading">
        Hit Dice
      </h3>
      <p className="text-ink-muted">
        <span className="tabular-nums">
          HP {hp.current} of {hp.max}
          {hp.temp > 0 ? `, plus ${hp.temp} temporary` : ''}
        </span>
      </p>
      {none ? (
        <p className="mt-1 text-ink-muted">
          {hitDice.length === 0
            ? 'No Hit Dice to spend.'
            : 'No Hit Dice left to spend. A long rest gives some back.'}
        </p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {hitDice.map(({ die, left, total }) => (
            <li key={die} className="flex min-h-tap items-center justify-between gap-3">
              <span className="tabular-nums">
                <b>{left}</b> of {total} {die} left
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Spend a ${die} hit die, ${left} left`}
                disabled={left <= 0}
                onClick={() => onSpendHitDie(die)}
              >
                Spend a {die}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A pool that gives back spent slots as the rest ends (Arcane Recovery): a
 * stepper for each spent level under its cap, within its level budget. The
 * pools share the spent slots, so what one picks another cannot. Picking any
 * spends the pool's use when the rest is taken; picking none keeps it.
 */
function SlotRecoveryPick({
  pool,
  spent,
  picks,
  onPick,
}: {
  pool: SlotRecovery;
  spent: ReadonlyArray<{ level: number; spent: number }>;
  picks: RecoveryPicks;
  onPick: (next: SlotPicks) => void;
}) {
  const id = useId();
  const mine = picks.get(pool.key) ?? {};
  const left = pool.levels - pickedLevels(mine);
  const levels = spent.filter((s) => s.level < pool.below);
  const takenElsewhere = (level: number) =>
    [...picks].reduce((sum, [key, p]) => sum + (key === pool.key ? 0 : (p[level] ?? 0)), 0);
  const cap = pool.below < 10 ? `, none ${ordinal(pool.below)} level or higher` : '';
  return (
    <section aria-labelledby={id} className="mb-4">
      <h3 id={id} className="mb-1 text-heading">
        {pool.label}
      </h3>
      <p className="text-ink-muted">
        Spent slots back, up to {pool.levels} {pool.levels === 1 ? 'level' : 'levels'} in all
        {cap}. Picking any uses it until a long rest.
      </p>
      {levels.length === 0 ? (
        <p className="mt-1 text-ink-muted">No spent slots it can give back.</p>
      ) : (
        <>
          <ul className="mt-1 flex flex-col">
            {levels.map(({ level, spent: n }) => {
              const count = mine[level] ?? 0;
              const name = `${ordinal(level)}-level`;
              const more = count < n - takenElsewhere(level) && level <= left;
              return (
                <li key={level} className="flex min-h-tap items-center justify-between gap-3">
                  <span className="tabular-nums">
                    {name} slots, {n} spent
                  </span>
                  <span className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`One fewer ${name} slot back, ${pool.label}`}
                      disabled={count <= 0}
                      onClick={() => onPick({ ...mine, [level]: count - 1 })}
                    >
                      &minus;
                    </Button>
                    <span className="w-5 text-center text-body-strong tabular-nums">{count}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`One more ${name} slot back, ${pool.label}`}
                      disabled={!more}
                      onClick={() => onPick({ ...mine, [level]: count + 1 })}
                    >
                      +
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-caption text-ink-muted tabular-nums" aria-live="polite">
            {left} of {pool.levels} {pool.levels === 1 ? 'level' : 'levels'} left
          </p>
        </>
      )}
    </section>
  );
}
