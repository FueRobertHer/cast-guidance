import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rollDetail } from '@/dice/format';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import type { RollKind, RollResult } from '@/dice/types';
import { ADV_MODES, type AdvMode, useAdvMode } from '@/stores/advMode';
import { type DiceTrayView, diceTrayStore, useDiceTray } from '@/stores/diceTray';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { MODE_LABELS, MODE_NAMES, useDockHidden } from '@/ui/AdvToggle';
import { Button } from '@/ui/Button';
import { D20Icon } from '@/ui/D20Icon';
import { ROLL_INK, rollTone } from '@/ui/rollTone';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';

const QUICK = [4, 6, 8, 10, 12, 20, 100];

/** How many of the latest rolls the Roll view shows under the dice. */
const RECENT = 3;

/** How often the rows' "2 min ago" moves on, while the tray is open. */
export const TICK_MS = 15_000;

/**
 * The dock's words, named in full as there. The whole words ran past the
 * sheet at 320px and with large text.
 */
const MODES: ReadonlyArray<{ value: AdvMode; label: string; name: string }> = ADV_MODES.map(
  (mode) => ({ value: mode, label: MODE_LABELS[mode], name: MODE_NAMES[mode] }),
);

const VIEWS: ReadonlyArray<{ value: DiceTrayView; label: string }> = [
  { value: 'roll', label: 'Roll' },
  { value: 'history', label: 'History' },
];

/** A die and its use: a d20 is a d20 roll, any other die damage (DS-001 DiceTray). */
const kindOf = (sides: number): RollKind => (sides === 20 ? 'd20' : 'damage');

/**
 * When a roll was made, as a player says it: "just now", "2 min ago",
 * "3 h ago", and past a day the clock time it was made at.
 */
export function relativeTime(at: number, now: number, clock: string): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : clock;
}

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
 * header. Opened from the dice dock's button on Play and Stats (`dock`), and
 * on any of the sheet's pages from a tap on the roll toast, which opens it on
 * History. It is open while `diceTrayStore` says so.
 */
export function DiceTray({ dock = false }: { dock?: boolean }) {
  const open = useDiceTray((s) => s.open);
  const view = useDiceTray((s) => s.view);
  const rolls = useRollLog((s) => s.rolls);
  const [expr, setExpr] = useState('');
  const advMode = useAdvMode((s) => s.mode);
  const setAdvMode = useAdvMode((s) => s.set);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const now = useNow(open);

  useEffect(() => diceTrayStore.getState().mount(), []);

  const doRoll = (expression: string, label?: string, kind?: RollKind) => {
    try {
      parseDice(expression);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setError(undefined);
    rollLogStore.getState().append(
      roll(expression, {
        label,
        kind,
        advantage: advMode === 'normal' ? undefined : advMode,
      }),
    );
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
              than the sheet's height. Its padding keeps focus rings in. */}
          <div className="-mx-4 -mt-1 min-h-0 flex-1 overflow-y-auto px-4 pt-1">
            {view === 'roll' ? (
              <>
                <div className="mb-3 flex flex-col gap-3">
                  {/* Adv/dis for d20 rolls, in the same order as the dock's */}
                  <SegmentedControl
                    label="Roll mode"
                    options={MODES}
                    value={advMode}
                    onChange={setAdvMode}
                    block
                  />

                  {/*
                   * Four across with room to hit (DS-001): seven across gave each
                   * die a sliver of a label. Equal columns keep every die the same
                   * size, and the eighth tile, custom, takes the field below.
                   * Each says "tap to roll" for a new player; the button's name
                   * stays the die's, since its role already says it is pressed.
                   */}
                  <div className="grid grid-cols-4 gap-2">
                    {QUICK.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => doRoll(`1d${d}`, `d${d}`, kindOf(d))}
                        className={TILE}
                      >
                        d{d}
                        <small aria-hidden="true" className={TILE_CAPTION}>
                          tap to roll
                        </small>
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Custom dice"
                      onClick={() => field.current?.focus()}
                      className={TILE}
                    >
                      <Plus size={18} aria-hidden="true" />
                      <small className={TILE_CAPTION}>custom</small>
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
                  {error !== undefined && <p className="-mt-1 text-caption text-danger">{error}</p>}
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
                      clear all
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

/** A die tile: `surface-raised`, the die's name over a small caption. */
const TILE =
  'flex min-h-15 flex-col items-center justify-center gap-0.5 rounded-control bg-surface-raised px-1 py-2 font-bold text-body transition-[background-color,transform] duration-120 hover:bg-surface-hover active:scale-97';
const TILE_CAPTION = 'font-semibold text-[0.6875rem] text-ink-muted leading-3.5';

/**
 * The dice dock's button (DS-001): it sits in the end of the capsule
 * AdvToggle draws, 2px in from its right and bottom, so the two read as one
 * control. A 44px tap, the brand circle 40px inside it. Hidden by scroll, it
 * is still in the tab order: keyboard focus in either half brings the whole
 * dock back (useDockHidden).
 */
function DockButton() {
  const hidden = useDockHidden();
  return (
    <Sheet.Trigger asChild>
      <button
        type="button"
        aria-label="Dice tray"
        title="Dice tray"
        data-dice-dock-button=""
        className={`fixed right-[calc(1rem+2px)] bottom-[calc(78px+env(safe-area-inset-bottom))] z-20 flex size-tap items-center justify-center rounded-full border-2 border-transparent bg-brand bg-clip-padding text-on-brand transition-all duration-200 [--tap-inset:2px] hover:bg-brand-hover active:scale-92 lg:bottom-[calc(1.5rem+2px)] ${
          hidden ? 'pointer-events-none translate-x-20 opacity-0' : ''
        }`}
      >
        <D20Icon size={22} />
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
            <div className="truncate text-body-strong">
              {r.label ?? r.expr}
              {r.meta?.advantage !== undefined && (
                <span className="ml-1 font-normal text-caption text-ink-muted">
                  ({r.meta.advantage})
                </span>
              )}
            </div>
            {/* The dice give way to the time, which is never cut. */}
            <div className="flex gap-1 text-caption text-ink-muted tabular-nums">
              <span className="min-w-0 truncate">
                {r.expr} · {rollDetail(r)}
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
            className={`shrink-0 font-bold text-[1.25rem] tabular-nums ${ROLL_INK[rollTone(r)]}`}
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
