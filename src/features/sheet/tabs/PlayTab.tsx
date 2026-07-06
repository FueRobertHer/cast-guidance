import { Minus, Moon, Plus, Sun } from 'lucide-react';
import { useOutletContext } from 'react-router';
import { roll } from '@/dice/roll';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { RollChip } from '@/ui/RollChip';
import type { CharacterSheetState } from '../useCharacterSheet';

const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
];

/** Damage eats temp HP first; healing caps at max. */
function applyHp(play: PlayState, delta: number, maxHp: number): void {
  if (delta < 0) {
    let dmg = -delta;
    const fromTemp = Math.min(play.tempHp, dmg);
    play.tempHp -= fromTemp;
    dmg -= fromTemp;
    play.currentHp = Math.max(0, play.currentHp - dmg);
  } else {
    play.currentHp = Math.min(maxHp, play.currentHp + delta);
    if (play.currentHp > 0) play.deathSaves = { success: 0, fail: 0 };
  }
}

function shortRest(play: PlayState, sheet: DerivedSheet): void {
  for (const r of sheet.resources) {
    if (r.resetOn === 'short') {
      play.resources = play.resources.filter((x) => x.key !== r.key);
    }
  }
  play.pactSlotsSpent = 0;
}

function longRest(play: PlayState, sheet: DerivedSheet): void {
  play.currentHp = sheet.maxHp.value;
  play.tempHp = 0;
  play.slotsSpent = play.slotsSpent.map(() => 0);
  play.pactSlotsSpent = 0;
  play.resources = [];
  play.deathSaves = { success: 0, fail: 0 };
  // Regain half your total hit dice (minimum 1)
  for (const [die, total] of Object.entries(sheet.hitDice)) {
    const spent = play.hitDiceSpent[die] ?? 0;
    play.hitDiceSpent[die] = Math.max(0, spent - Math.max(1, Math.floor(total / 2)));
  }
}

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  const play = doc.play;
  const dying = play.currentHp === 0 && sheet.maxHp.value > 0;

  const hpDelta = (delta: number) => update((d) => applyHp(d.play, delta, sheet.maxHp.value));

  const usedOf = (key: string) => play.resources.find((r) => r.key === key)?.used ?? 0;
  const setUsed = (key: string, used: number) =>
    update((d) => {
      const entry = d.play.resources.find((r) => r.key === key);
      if (entry !== undefined) entry.used = used;
      else d.play.resources.push({ key, used });
    });

  return (
    <div className="flex flex-col gap-4">
      {/* HP */}
      <section className="rounded-lg bg-surface p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => hpDelta(-1)}
            onDoubleClick={() => hpDelta(-5)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-deep text-xl"
            title="Damage (double-tap −5)"
          >
            <Minus size={22} />
          </button>
          <button
            type="button"
            className="text-center"
            onClick={() => {
              const v = window.prompt('Set current HP', String(play.currentHp));
              if (v === null) return;
              const n = Number.parseInt(v, 10);
              if (!Number.isNaN(n))
                update((d) => {
                  d.play.currentHp = Math.max(0, Math.min(sheet.maxHp.value, n));
                });
            }}
          >
            <div className="text-4xl font-bold">
              {play.currentHp}
              <span className="text-xl text-ink-muted"> / {sheet.maxHp.value}</span>
            </div>
            <div className="text-xs text-ink-muted">
              hit points{play.tempHp > 0 ? ` · +${play.tempHp} temp` : ''}
              {sheet.maxHp.overridden ? ' •' : ''}
            </div>
          </button>
          <button
            type="button"
            onClick={() => hpDelta(1)}
            onDoubleClick={() => hpDelta(5)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/70 text-xl"
            title="Heal (double-tap +5)"
          >
            <Plus size={22} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            type="button"
            className="text-ink-muted underline"
            onClick={() => {
              const v = window.prompt('Temporary HP', String(play.tempHp));
              if (v === null) return;
              const n = Number.parseInt(v, 10);
              if (!Number.isNaN(n)) update((d) => void (d.play.tempHp = Math.max(0, n)));
            }}
          >
            temp HP
          </button>
          <div className="flex gap-1">
            {Object.entries(sheet.hitDice).map(([die, total]) => (
              <button
                key={die}
                type="button"
                title={`Spend a hit die (${die})`}
                onClick={() =>
                  update((d) => {
                    const spent = d.play.hitDiceSpent[die] ?? 0;
                    if (spent >= total) return;
                    d.play.hitDiceSpent[die] = spent + 1;
                    const r = roll(`1${die}${fmt(sheet.abilities.con.mod)}`, {
                      label: `Hit die (${die})`,
                    });
                    rollLogStore.getState().append(r);
                    applyHp(d.play, Math.max(0, r.total), sheet.maxHp.value);
                  })
                }
                className="rounded bg-surface-2 px-2 py-1 font-mono"
              >
                {die} × {total - (play.hitDiceSpent[die] ?? 0)}
              </button>
            ))}
          </div>
          <BreakdownSheet
            title="Max HP"
            value={sheet.maxHp}
            onOverride={(v) =>
              update((d) => {
                if (v === null) delete d.overrides.maxHp;
                else d.overrides.maxHp = { value: v };
              })
            }
            trigger={
              <button type="button" className="text-ink-muted underline">
                breakdown
              </button>
            }
          />
        </div>
      </section>

      {/* Death saves */}
      {dying && (
        <section className="rounded-lg border border-accent/50 bg-surface p-3">
          <div className="mb-2 text-sm font-semibold text-accent">Death saving throws</div>
          <div className="flex items-center justify-between text-sm">
            {(['success', 'fail'] as const).map((kind) => (
              <div key={kind} className="flex items-center gap-1.5">
                <span className="text-xs capitalize text-ink-muted">{kind}</span>
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${kind} ${n}`}
                    onClick={() =>
                      update((d) => {
                        d.play.deathSaves[kind] = d.play.deathSaves[kind] >= n ? n - 1 : n;
                      })
                    }
                    className={`h-5 w-5 rounded-full border ${
                      play.deathSaves[kind] >= n
                        ? kind === 'success'
                          ? 'border-emerald-300 bg-emerald-300'
                          : 'border-accent bg-accent'
                        : 'border-surface-2'
                    }`}
                  />
                ))}
              </div>
            ))}
            <RollChip expr="1d20" label="Death save" variant="d20" />
          </div>
        </section>
      )}

      {/* Core tiles */}
      <section className="grid grid-cols-3 gap-2 text-center">
        <BreakdownSheet
          title={`Armor Class (${sheet.acFormulaLabel})`}
          value={sheet.ac}
          onOverride={(v) =>
            update((d) => {
              if (v === null) delete d.overrides.ac;
              else d.overrides.ac = { value: v };
            })
          }
          trigger={
            <button type="button" className="rounded-lg bg-surface p-3">
              <div className="text-2xl font-bold">{sheet.ac.value}</div>
              <div className="text-xs text-ink-muted">AC{sheet.ac.overridden ? ' •' : ''}</div>
            </button>
          }
        />
        <button
          type="button"
          onClick={() =>
            rollLogStore
              .getState()
              .append(roll(`1d20${fmt(sheet.initiative.value)}`, { label: 'Initiative' }))
          }
          className="rounded-lg bg-surface p-3"
        >
          <div className="text-2xl font-bold">{fmt(sheet.initiative.value)}</div>
          <div className="text-xs text-ink-muted">Initiative 🎲</div>
        </button>
        <div className="rounded-lg bg-surface p-3">
          <div className="text-2xl font-bold">{sheet.speedWalk.value}</div>
          <div className="text-xs text-ink-muted">Speed (ft)</div>
        </div>
      </section>

      {/* Conditions */}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold text-ink-muted">Conditions</h2>
        <div className="flex flex-wrap gap-1.5">
          {CONDITIONS.map((c) => {
            const active = play.conditions.find((x) => x.id === c);
            const isExhaustion = c === 'Exhaustion';
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  update((d) => {
                    const idx = d.play.conditions.findIndex((x) => x.id === c);
                    if (isExhaustion) {
                      if (idx === -1) d.play.conditions.push({ id: c, level: 1 });
                      else {
                        const entry = d.play.conditions[idx];
                        const lvl = (entry?.level ?? 1) + 1;
                        if (lvl > 6) d.play.conditions.splice(idx, 1);
                        else if (entry !== undefined) entry.level = lvl;
                      }
                    } else if (idx === -1) d.play.conditions.push({ id: c });
                    else d.play.conditions.splice(idx, 1);
                  })
                }
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  active !== undefined
                    ? 'border-amber-300 bg-amber-300/10 font-semibold text-amber-300'
                    : 'border-surface-2 text-ink-muted'
                }`}
              >
                {c}
                {active?.level !== undefined ? ` ${active.level}` : ''}
              </button>
            );
          })}
        </div>
      </section>

      {/* Rests */}
      <section className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => update((d) => shortRest(d.play, sheet))}
          className="flex items-center justify-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm font-semibold"
        >
          <Sun size={16} /> Short rest
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Long rest: full HP, all slots and resources restored?')) {
              update((d) => longRest(d.play, sheet));
            }
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm font-semibold"
        >
          <Moon size={16} /> Long rest
        </button>
      </section>

      {/* Resources with pips */}
      {sheet.resources.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-ink-muted">Resources</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sheet.resources.map((r) => {
              const used = usedOf(r.key);
              return (
                <div key={r.key} className="rounded-lg bg-surface p-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="font-semibold">{r.label}</span>
                    <span className="text-xs text-ink-muted">{r.resetOn} rest</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: Math.min(r.max, 12) }, (_, i) => (
                      <button
                        key={`${r.key}-${String(i)}`}
                        type="button"
                        aria-label={`${r.label} use ${i + 1}`}
                        onClick={() => setUsed(r.key, used > i ? i : i + 1)}
                        className={`h-4 w-4 rounded-full border ${
                          i < used ? 'border-surface-2 bg-surface-2' : 'border-accent bg-accent'
                        }`}
                        title={`${r.max - used} of ${r.max} left`}
                      />
                    ))}
                    {r.max > 12 && (
                      <span className="text-xs text-ink-muted">
                        {r.max - used}/{r.max}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
                  {a.versatileDamage !== undefined && (
                    <RollChip
                      expr={a.versatileDamage}
                      label={`${a.label} damage (two-handed)`}
                      variant="damage"
                    />
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
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                  a.economy === 'bonus'
                    ? 'border-emerald-300/40 text-emerald-300'
                    : a.economy === 'reaction'
                      ? 'border-sky-300/40 text-sky-300'
                      : 'border-surface-2'
                }`}
              >
                {a.label}
                {a.roll !== undefined && (
                  <RollChip expr={a.roll} label={a.label} variant="damage" />
                )}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Spell slots (spend/restore) */}
      {sheet.spellcasting.map((sc) => (
        <section key={sc.classUid} className="rounded-lg bg-surface p-3 text-sm">
          <div className="mb-1.5 flex justify-between">
            <span className="font-semibold">{sc.className} spellcasting</span>
            <span className="text-ink-muted">
              DC <strong className="text-ink">{sc.saveDc.value}</strong> · Atk{' '}
              <strong className="text-ink">{fmt(sc.attackMod.value)}</strong>
            </span>
          </div>
          {sc.pactSlots !== undefined ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-ink-muted">Pact (level {sc.pactSlots.level})</span>
              {Array.from({ length: sc.pactSlots.count }, (_, i) => (
                <button
                  key={`pact-${String(i)}`}
                  type="button"
                  aria-label={`Pact slot ${i + 1}`}
                  onClick={() =>
                    update((d) => {
                      d.play.pactSlotsSpent = d.play.pactSlotsSpent > i ? i : i + 1;
                    })
                  }
                  className={`h-4 w-4 rounded-full border ${
                    i < play.pactSlotsSpent
                      ? 'border-surface-2 bg-surface-2'
                      : 'border-sky-300 bg-sky-300'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sc.slots.map((count, lvlIdx) =>
                count > 0 ? (
                  <div key={`slots-${String(lvlIdx)}`} className="flex items-center gap-1.5">
                    <span className="w-8 text-xs text-ink-muted">L{lvlIdx + 1}</span>
                    {Array.from({ length: count }, (_, i) => (
                      <button
                        key={`s-${String(lvlIdx)}-${String(i)}`}
                        type="button"
                        aria-label={`Level ${lvlIdx + 1} slot ${i + 1}`}
                        onClick={() =>
                          update((d) => {
                            const cur = d.play.slotsSpent[lvlIdx] ?? 0;
                            d.play.slotsSpent[lvlIdx] = cur > i ? i : i + 1;
                          })
                        }
                        className={`h-4 w-4 rounded-full border ${
                          i < (play.slotsSpent[lvlIdx] ?? 0)
                            ? 'border-surface-2 bg-surface-2'
                            : 'border-sky-300 bg-sky-300'
                        }`}
                      />
                    ))}
                  </div>
                ) : null,
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
