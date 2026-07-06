import { useOutletContext } from 'react-router';
import { roll } from '@/dice/roll';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { RollChip } from '@/ui/RollChip';
import type { CharacterSheetState } from '../useCharacterSheet';

const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

export function Component() {
  const { sheet, doc } = useOutletContext<CharacterSheetState>();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  const rollInitiative = () => {
    rollLogStore
      .getState()
      .append(roll(`1d20${fmt(sheet.initiative.value)}`, { label: 'Initiative' }));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* HP (interactive steppers land in M3) */}
      <section className="flex items-center justify-between rounded-lg bg-surface p-4">
        <div>
          <div className="text-xs text-ink-muted">Hit points</div>
          <div className="text-3xl font-bold">
            {doc.play.currentHp}
            <span className="text-lg text-ink-muted"> / {sheet.maxHp.value}</span>
          </div>
        </div>
        <BreakdownSheet
          title="Max HP"
          value={sheet.maxHp}
          trigger={
            <button type="button" className="text-xs text-ink-muted underline">
              breakdown
            </button>
          }
        />
      </section>

      {/* Core tiles */}
      <section className="grid grid-cols-3 gap-2 text-center">
        <BreakdownSheet
          title={`Armor Class (${sheet.acFormulaLabel})`}
          value={sheet.ac}
          trigger={
            <button type="button" className="rounded-lg bg-surface p-3">
              <div className="text-2xl font-bold">{sheet.ac.value}</div>
              <div className="text-xs text-ink-muted">AC{sheet.ac.overridden ? ' •' : ''}</div>
            </button>
          }
        />
        <button type="button" onClick={rollInitiative} className="rounded-lg bg-surface p-3">
          <div className="text-2xl font-bold">{fmt(sheet.initiative.value)}</div>
          <div className="text-xs text-ink-muted">Initiative 🎲</div>
        </button>
        <div className="rounded-lg bg-surface p-3">
          <div className="text-2xl font-bold">{sheet.speedWalk.value}</div>
          <div className="text-xs text-ink-muted">Speed (ft)</div>
        </div>
      </section>

      {/* Attacks */}
      {sheet.attacks.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-ink-muted">Attacks</h2>
          <div className="flex flex-col rounded-lg bg-surface">
            {sheet.attacks.map((a) => (
              <div
                key={a.label}
                className="flex items-center justify-between gap-2 border-b border-surface-2/40 px-3 py-2.5 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold">{a.label}</div>
                  <div className="truncate text-xs text-ink-muted">
                    {a.properties.join(', ')}
                    {a.range !== undefined ? ` · ${a.range}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <RollChip
                    expr={`1d20${fmt(a.toHit.value)}`}
                    display={fmt(a.toHit.value)}
                    label={`${a.label} attack`}
                    variant="d20"
                  />
                  <RollChip expr={a.damage} label={`${a.label} damage`} variant="damage" />
                  {a.damageType !== undefined && (
                    <span className="text-xs text-ink-muted">{a.damageType}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Action economy */}
      {sheet.actions.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-ink-muted">Actions</h2>
          <div className="flex flex-wrap gap-1.5">
            {sheet.actions.map((a) => (
              <span
                key={`${a.origin}:${a.label}`}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  a.economy === 'bonus'
                    ? 'border-emerald-300/40 text-emerald-300'
                    : a.economy === 'reaction'
                      ? 'border-sky-300/40 text-sky-300'
                      : 'border-surface-2'
                }`}
              >
                {a.label}
                {a.roll !== undefined && (
                  <span className="ml-1.5">
                    <RollChip expr={a.roll} label={a.label} variant="damage" />
                  </span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Resources */}
      {sheet.resources.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-ink-muted">Resources</h2>
          <div className="grid grid-cols-2 gap-2">
            {sheet.resources.map((r) => (
              <div key={r.key} className="rounded-lg bg-surface p-3 text-sm">
                <div className="font-semibold">{r.label}</div>
                <div className="text-xs text-ink-muted">
                  {r.max} / {r.resetOn} rest
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Spellcasting header (full spells tab in M4) */}
      {sheet.spellcasting.map((sc) => (
        <section key={sc.classUid} className="rounded-lg bg-surface p-3 text-sm">
          <div className="mb-1 font-semibold">{sc.className} spellcasting</div>
          <div className="flex gap-4 text-ink-muted">
            <span>
              DC <strong className="text-ink">{sc.saveDc.value}</strong>
            </span>
            <span>
              Attack <strong className="text-ink">{fmt(sc.attackMod.value)}</strong>
            </span>
            {sc.pactSlots !== undefined ? (
              <span>
                Pact: {sc.pactSlots.count} × level {sc.pactSlots.level}
              </span>
            ) : (
              <span>
                Slots:{' '}
                {sc.slots
                  .map((n, i) => (n > 0 ? `L${i + 1}×${n}` : ''))
                  .filter(Boolean)
                  .join(' ')}
              </span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
