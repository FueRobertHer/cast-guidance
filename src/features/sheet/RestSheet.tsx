import { useId, useState } from 'react';
import type { TableRuleChoices } from '@/engine/castGuidance';
import { endsAtRest } from '@/engine/effectLife';
import { restTakes } from '@/engine/rules';
import type { ActiveEffect } from '@/engine/types';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/sheet';
import { andList, restLasts } from './effectsInPlay';

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
}

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
  onRest: (rest: Rest, ends: ReadonlySet<string>) => void;
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
  onRest: (rest: Rest, ends: ReadonlySet<string>) => void;
}) {
  // The list as it opened, so the rows a rest ends stay put while it slides
  // away; what comes back too, which the rest taken would otherwise empty.
  const [listed] = useState(effects);
  const [restores] = useState(short?.restores);
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
        {restores !== undefined && (
          <p className="mb-3 text-ink-muted">
            {restores.length > 0
              ? `Gives back ${andList(restores)}.`
              : 'Nothing spent comes back on a short rest.'}
          </p>
        )}
        {short !== undefined && <HitDiceSpend short={short} />}
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
        onClick={() => onRest(rest, ends)}
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
          No Hit Dice left to spend. A long rest gives some back.
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
