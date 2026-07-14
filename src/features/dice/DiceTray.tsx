import { Dices } from 'lucide-react';
import { useState } from 'react';
import { Drawer } from 'vaul';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import { useScrollHidden } from '@/lib/useScrollHidden';
import { useAdvMode } from '@/stores/advMode';
import { rollLogStore, useRollLog } from '@/stores/rollLog';

const QUICK = [4, 6, 8, 10, 12, 20, 100];

export function DiceTray() {
  const rolls = useRollLog((s) => s.rolls);
  const [expr, setExpr] = useState('');
  const advMode = useAdvMode((s) => s.mode);
  const setAdvMode = useAdvMode((s) => s.set);
  const [error, setError] = useState<string>();
  const hidden = useScrollHidden();

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
    <Drawer.Root>
      <Drawer.Trigger asChild>
        <button
          type="button"
          title="Dice tray"
          className={`fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-all duration-200 lg:bottom-6 ${
            hidden ? 'pointer-events-none translate-x-20 opacity-0' : ''
          }`}
        >
          <Dices size={22} />
        </button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-xl bg-surface p-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-surface-2" />
          <Drawer.Title className="mb-2 text-base font-semibold">Dice</Drawer.Title>

          {/* Adv/dis toggle for d20 rolls */}
          <div className="mb-2 flex gap-1.5">
            {(
              [
                ['normal', 'Normal'],
                ['adv', 'Advantage'],
                ['dis', 'Disadvantage'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAdvMode(mode);
                }}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                  advMode === mode
                    ? mode === 'adv'
                      ? 'border-emerald-300 text-emerald-300'
                      : mode === 'dis'
                        ? 'border-accent text-accent'
                        : 'border-ink text-ink'
                    : 'border-surface-2 text-ink-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => doRoll(`1d${d}`, `d${d}`)}
                className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm font-semibold"
              >
                d{d}
              </button>
            ))}
          </div>

          <form
            className="mb-3 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (expr.trim() !== '') doRoll(expr.trim());
            }}
          >
            <input
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="e.g. 4d6dl1+2"
              className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-ink-muted"
            />
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white"
            >
              Roll
            </button>
          </form>
          {error !== undefined && <p className="mb-2 text-xs text-accent">{error}</p>}

          {/* Roll log */}
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-ink-muted">History</span>
            {rolls.length > 0 && (
              <button
                type="button"
                onClick={() => rollLogStore.getState().clear()}
                className="text-xs text-ink-muted underline hover:text-ink"
              >
                clear all
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rolls.length === 0 && <p className="text-sm text-ink-muted">No rolls yet.</p>}
            {rolls.map((r) => {
              const nat = r.meta?.d20?.natural;
              const time = new Date(r.at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              return (
                <div
                  key={r.at + r.expr + String(r.total)}
                  className="group flex items-center justify-between gap-2 border-b border-surface-2/40 py-2 text-sm last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate">
                      {r.label ?? r.expr}
                      {r.meta?.advantage !== undefined && (
                        <span
                          className={`ml-1 text-xs ${r.meta.advantage === 'adv' ? 'text-emerald-300' : 'text-accent'}`}
                        >
                          ({r.meta.advantage})
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-xs text-ink-muted">
                      {time} · {r.expr} ·{' '}
                      {r.terms
                        .map((t) =>
                          t.kind === 'dice'
                            ? `[${t.rolls.map((x) => (x.kept ? x.v : `(${x.v})`)).join(',')}]`
                            : t.value >= 0
                              ? `+${t.value}`
                              : `${t.value}`,
                        )
                        .join(' ')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`text-lg font-bold ${
                        nat === 20 ? 'text-emerald-300' : nat === 1 ? 'text-accent' : ''
                      }`}
                    >
                      {r.total}
                    </span>
                    <button
                      type="button"
                      title="Remove roll (accidental click?)"
                      onClick={() => rollLogStore.getState().remove(r.at)}
                      className="rounded px-1 text-ink-muted/60 hover:text-accent"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
