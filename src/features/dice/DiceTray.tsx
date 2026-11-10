import { CircleAlert, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import type { RollKind, RollResult } from '@/dice/types';
import { relativeTime } from '@/lib/relativeTime';
import { useScrollHidden } from '@/lib/useScrollHidden';
import { type DiceTrayView, diceTrayStore, useDiceTray } from '@/stores/diceTray';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { Button } from '@/ui/Button';
import { D20Icon } from '@/ui/D20Icon';
import { RollDetail } from '@/ui/RollDetail';
import { ROLL_MODES } from '@/ui/rollModes';
import { ROLL_INK, rollTone } from '@/ui/rollTone';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';

/** The dice in the grid: every one but the d20, which sits apart with its mode. */
const QUICK = [4, 6, 8, 10, 12, 100];

/** How many of the latest rolls the Roll view shows under the dice. */
const RECENT = 3;

/** How often the rows' "2 min ago" moves on, while the tray is open. */
export const TICK_MS = 15_000;

const VIEWS: ReadonlyArray<{ value: DiceTrayView; label: string }> = [
  { value: 'roll', label: 'Roll' },
  { value: 'history', label: 'History' },
];

/** The time now, moving on every TICK_MS while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * The dice tray (DS-001 DiceTray): a bottom sheet for rolls the sheet does
 * not know about, and the history of every roll, as two views picked in its
 * header. Opened from the dice button on Play and Stats (`dock`), and on any
 * of the sheet's pages from a tap on the roll toast, which opens it on
 * History. It is open while `diceTrayStore` says so.
 *
 * The d20 sits first, beside its own Dis, Normal and Adv, so the mode plainly
 * belongs to it; every other die, and dice typed in the field, roll as they
 * are (a d20 roll is a d20 roll, any other die damage).
 */
export function DiceTray({ dock = false }: { dock?: boolean }) {
  const open = useDiceTray((s) => s.open);
  const view = useDiceTray((s) => s.view);
  const rolls = useRollLog((s) => s.rolls);
  const [expr, setExpr] = useState('');
  const mode = useDiceTray((s) => s.mode);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const now = useNow(open);

  useEffect(() => diceTrayStore.getState().mount(), []);

  const doRoll = (
    expression: string,
    label?: string,
    kind?: RollKind,
    advantage?: 'adv' | 'dis',
  ) => {
    try {
      parseDice(expression);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(undefined);
    rollLogStore
      .getState()
      .append(roll(expression, { label, kind, ...(advantage === undefined ? {} : { advantage }) }));
  };

  return (
    <Sheet.Root open={open} onOpenChange={(next) => diceTrayStore.getState().setOpen(next)}>
      {dock && <DockButton />}
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel
          aria-describedby={undefined}
          className="flex max-h-[80dvh] flex-col"
          onCloseAutoFocus={(event) => {
            // Opened from the toast, which is gone now: back to what had
            // focus before it. Otherwise the dock's button, as for any sheet.
            const to = diceTrayStore.getState().returnTo;
            if (to?.isConnected === true) {
              event.preventDefault();
              to.focus();
            }
          }}
        >
          {/* Wraps the views under the title where both do not fit (large
              text) rather than push the sheet sideways. */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Sheet.Title className="min-w-0 font-display text-title-sheet">Dice</Sheet.Title>
            <SegmentedControl
              label="Dice tray view"
              options={VIEWS}
              value={view}
              onChange={(next) => diceTrayStore.getState().setView(next)}
            />
          </div>

          {/* One scroll for the whole view, not the log alone: with large
              text, or a phone on its side, the dice and the field are more
              than the sheet's height. Its padding keeps focus rings in, and
              its scroll padding does the same for a control scrolled to. */}
          <div className="-mx-4 -mt-1 min-h-0 flex-1 scroll-py-1 overflow-y-auto px-4 pt-1">
            {view === 'roll' ? (
              <>
                <div className="mb-3 flex flex-col gap-3">
                  {/* The d20 and its own mode, in the prompt's order. The
                      control wraps under the die where large text will not
                      fit it beside. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        doRoll('1d20', 'd20', 'd20', mode === 'normal' ? undefined : mode)
                      }
                      className={`${TILE_SHAPE} w-24 shrink-0 bg-roll-soft text-roll hover:brightness-112`}
                    >
                      <D20Icon size={18} />
                      d20
                    </button>
                    <div className="min-w-48 flex-1">
                      <SegmentedControl
                        label="d20 roll mode"
                        options={ROLL_MODES}
                        value={mode}
                        onChange={(next) => diceTrayStore.getState().setMode(next)}
                        block
                      />
                    </div>
                  </div>

                  {/*
                   * Four across with room to hit (DS-001): seven across gave each
                   * die a sliver of a label. Equal columns keep every die the same
                   * size, and Custom, across the last two, takes the field below.
                   */}
                  <div className="grid grid-cols-4 gap-2">
                    {QUICK.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => doRoll(`1d${d}`, `d${d}`, 'damage')}
                        className={TILE}
                      >
                        d{d}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Custom dice"
                      onClick={() => field.current?.focus()}
                      className={`${TILE} col-span-2`}
                    >
                      <Plus size={18} aria-hidden="true" />
                      <small className={TILE_CAPTION}>Custom</small>
                    </button>
                  </div>

                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (expr.trim() !== '') doRoll(expr.trim());
                    }}
                  >
                    <div className="relative min-w-0 flex-1">
                      <D20Icon
                        size={20}
                        className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
                      />
                      <input
                        ref={field}
                        value={expr}
                        onChange={(e) => setExpr(e.target.value)}
                        aria-label="Dice expression"
                        aria-invalid={error !== undefined ? true : undefined}
                        placeholder="Type dice, like 2d6+3"
                        className={`${fieldClass} pl-10.5 tabular-nums`}
                      />
                    </div>
                    <Button type="submit" variant="brand" className="h-12">
                      Roll
                    </Button>
                  </form>
                  {error !== undefined && (
                    <p className="-mt-1 flex items-start gap-1 text-caption text-danger">
                      <CircleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                      {error}
                    </p>
                  )}
                </div>
                {/* The latest rolls, the whole log a tap away on History. */}
                <RollRows rolls={rolls.slice(0, RECENT)} now={now} />
              </>
            ) : (
              <>
                {rolls.length > 0 && (
                  <div className="mb-1 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => rollLogStore.getState().clear()}
                      className="-mr-1"
                    >
                      Clear all
                    </Button>
                  </div>
                )}
                <RollRows rolls={rolls} now={now} removable />
              </>
            )}
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

/** A die tile's shape: the die's name over a small caption. */
const TILE_SHAPE =
  'flex min-h-15 flex-col items-center justify-center gap-0.5 rounded-control px-1 py-2 font-bold text-body transition-[background-color,filter,transform] duration-120 active:scale-97';
/** A die tile: `surface-raised`. The d20 is `roll-soft`, as a d20 chip is. */
const TILE = `${TILE_SHAPE} bg-surface-raised hover:bg-surface-hover`;
const TILE_CAPTION = 'font-semibold text-[0.6875rem] text-ink-muted leading-3.5';

/**
 * The dice button (DS-001 DiceDock), alone where rolls start: 52px, round,
 * `brand` with the d20, floating above the tab bar. It tucks away while the
 * page scrolls down, and is still in the tab order: keyboard focus brings it
 * back, so the keyboard never lands on an invisible button. `data-dice-dock`
 * lets the roll toast and notices rise above it.
 */
function DockButton() {
  const scrolledAway = useScrollHidden();
  const [focused, setFocused] = useState(false);
  const hidden = scrolledAway && !focused;
  return (
    <Sheet.Trigger asChild>
      <button
        type="button"
        aria-label="Dice tray"
        title="Dice tray"
        data-dice-dock=""
        onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
        className={`fixed right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex size-dock items-center justify-center rounded-full bg-brand text-on-brand shadow-float transition-all duration-200 hover:bg-brand-hover active:scale-92 lg:bottom-6 ${
          hidden ? 'pointer-events-none translate-x-20 opacity-0' : ''
        }`}
      >
        <D20Icon size={24} />
      </button>
    </Sheet.Trigger>
  );
}

/**
 * Rolls as list rows: what, the dice and when, and the total in the roll's
 * colour. On History each can be removed, for a tap that was a mistake.
 */
function RollRows({
  rolls,
  now,
  removable = false,
}: {
  rolls: readonly RollResult[];
  now: number;
  removable?: boolean;
}) {
  if (rolls.length === 0) return <p className="text-body text-ink-muted">No rolls yet.</p>;
  return (
    <div className={listClass}>
      {rolls.map((r) => (
        <div key={r.id ?? r.at} className={`${listRowClass} ${removable ? 'pr-1' : ''}`}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-body-strong">{r.label ?? r.expr}</div>
            {/* The dice give way to the time, which is never cut. */}
            <div className="flex gap-1 text-caption text-ink-muted tabular-nums">
              <span className="min-w-0 truncate">
                <RollDetail roll={r} />
              </span>
              <span className="shrink-0">
                · <RollTime at={r.at} now={now} />
              </span>
            </div>
            {/* What the character's conditions did, whole: a cut
                "Fails automatic…" would hide what the total means. */}
            {r.meta?.cue !== undefined && (
              <div className="text-caption text-guide">{r.meta.cue}</div>
            )}
          </div>
          <span
            className={`shrink-0 font-bold text-title-sheet tabular-nums ${ROLL_INK[rollTone(r)]}`}
          >
            {r.total}
          </span>
          {removable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${r.label ?? r.expr} roll (${r.total})`}
              title="Remove roll (accidental click?)"
              onClick={() => r.id !== undefined && rollLogStore.getState().remove(r.id)}
              className="shrink-0"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * When a roll was made, relative ("2 min ago") on screen, and the exact time
 * kept: machine-readable in `dateTime`, on hover in `title`, and said after
 * the relative time to a screen reader.
 */
function RollTime({ at, now }: { at: number; now: number }) {
  const clock = new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (
    <time dateTime={new Date(at).toISOString()} title={clock}>
      {relativeTime(at, now, clock)}
      <span className="sr-only"> ({clock})</span>
    </time>
  );
}
