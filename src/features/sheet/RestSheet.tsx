import { useState } from 'react';
import type { TableRuleChoices } from '@/engine/castGuidance';
import { endsAtRest } from '@/engine/effectLife';
import type { ActiveEffect } from '@/engine/types';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/sheet';
import { restLasts } from './effectsInPlay';

type Rest = 'short' | 'long';
type Length = TableRuleChoices['restLength'];

/**
 * A rest with effects in play: which of them it ends, ticked by what each one
 * lasts (a short rest ends an hour or less, a long one eight hours or less),
 * for the player to untick what their table says stays (the buffs canvas,
 * Together). The app counts neither rounds nor hours, so this is the moment a
 * duration decides anything.
 */
export function RestSheet({
  rest,
  length = 'standard',
  open,
  effects,
  detail,
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
          <Sheet.Heading>{rest === 'short' ? 'Short rest' : 'Long rest'}</Sheet.Heading>
          <RestEnds
            key={`${rest} ${openings}`}
            rest={rest}
            length={length}
            effects={effects}
            detail={detail}
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
  onRest,
}: {
  rest: Rest;
  length: Length;
  effects: readonly ActiveEffect[];
  detail?: string;
  onRest: (rest: Rest, ends: ReadonlySet<string>) => void;
}) {
  // The list as it opened, so the rows a rest ends stay put while it slides away.
  const [listed] = useState(effects);
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
