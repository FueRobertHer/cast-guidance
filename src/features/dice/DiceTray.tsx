import { X } from 'lucide-react';
import { useState } from 'react';
import { rollDetail } from '@/dice/format';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import { ADV_MODES, type AdvMode, useAdvMode } from '@/stores/advMode';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { useDockHidden } from '@/ui/AdvToggle';
import { Button } from '@/ui/Button';
import { D20Icon } from '@/ui/D20Icon';
import { ROLL_INK, rollTone } from '@/ui/rollTone';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';
import { listClass, listRowClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';

const QUICK = [4, 6, 8, 10, 12, 20, 100];

/** Spelled out here, where there is room for words rather than DIS/N/ADV. */
const MODES: ReadonlyArray<{ value: AdvMode; label: string }> = ADV_MODES.map((mode) => ({
  value: mode,
  label: { dis: 'Disadvantage', normal: 'Normal', adv: 'Advantage' }[mode],
}));

export function DiceTray() {
  const rolls = useRollLog((s) => s.rolls);
  const [expr, setExpr] = useState('');
  const advMode = useAdvMode((s) => s.mode);
  const setAdvMode = useAdvMode((s) => s.set);
  const [error, setError] = useState<string>();
  const hidden = useDockHidden();

  const doRoll = (expression: string, label?: string) => {
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
        advantage: advMode === 'normal' ? undefined : advMode,
      }),
    );
  };

  return (
    <Sheet.Root>
      {/* The dice dock's button (DS-001): it sits in the end of the capsule
          AdvToggle draws, 2px in from its right and bottom, so the two read as
          one control. A 44px tap, the brand circle 40px inside it. Hidden by
          scroll, it is still in the tab order: keyboard focus in either half
          brings the whole dock back (useDockHidden). */}
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
      <Sheet.Portal>
        <Sheet.Scrim />
        <Sheet.Panel aria-describedby={undefined} className="flex max-h-[80dvh] flex-col">
          <Sheet.Heading>Dice</Sheet.Heading>

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
             * size, so the last row's three line up under the first four.
             */}
            <div className="grid grid-cols-4 gap-2">
              {QUICK.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => doRoll(`1d${d}`, `d${d}`)}
                  className="h-15 rounded-control bg-surface-raised font-bold text-body transition-[background-color,transform] duration-120 hover:bg-surface-hover active:scale-97"
                >
                  d{d}
                </button>
              ))}
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
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  aria-label="Dice expression"
                  aria-invalid={error !== undefined ? true : undefined}
                  placeholder="e.g. 4d6dl1+2"
                  className={`${fieldClass} pl-10.5 tabular-nums`}
                />
              </div>
              <Button type="submit" variant="brand" className="h-12">
                Roll
              </Button>
            </form>
            {error !== undefined && <p className="-mt-1 text-caption text-danger">{error}</p>}
          </div>

          {/* Roll log */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-ink-muted text-overline uppercase">History</span>
            {rolls.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => rollLogStore.getState().clear()}
                className="-mr-1"
              >
                clear all
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rolls.length === 0 && <p className="text-body text-ink-muted">No rolls yet.</p>}
            {rolls.length > 0 && (
              <div className={listClass}>
                {rolls.map((r) => {
                  const time = new Date(r.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });
                  return (
                    <div key={r.id ?? r.at} className={`${listRowClass} pr-1`}>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body-strong">
                          {r.label ?? r.expr}
                          {r.meta?.advantage !== undefined && (
                            <span className="ml-1 font-normal text-caption text-ink-muted">
                              ({r.meta.advantage})
                            </span>
                          )}
                        </div>
                        <div className="truncate text-caption text-ink-muted tabular-nums">
                          {time} · {r.expr} · {rollDetail(r)}
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Sheet.Panel>
      </Sheet.Portal>
    </Sheet.Root>
  );
}
