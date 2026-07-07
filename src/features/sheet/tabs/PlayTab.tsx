import { Minus, Moon, Plus, Sun } from 'lucide-react';
import { Link, useOutletContext } from 'react-router';
import { useRegistry } from '@/data5e/hooks';
import { roll } from '@/dice/roll';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { currentAdvantage } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { RollChip } from '@/ui/RollChip';
import { castSpell } from '../SpellManager';
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
  const registry = useRegistry();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  const spellLevelOf = (name: string, source: string): number => {
    const e = registry?.get('spell', name, source);
    return typeof e?.level === 'number' ? e.level : 1;
  };

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
            onDoubleClick={() => hpDelta(-4)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-deep text-xl"
            title="Damage (double-tap −5 total)"
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
            onDoubleClick={() => hpDelta(4)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/70 text-xl"
            title="Heal (double-tap +5 total)"
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
            <button
              type="button"
              onClick={() =>
                update((d) => {
                  const r = roll('1d20', { label: 'Death save', advantage: currentAdvantage() });
                  rollLogStore.getState().append(r);
                  const nat = r.meta?.d20?.natural;
                  const saves = d.play.deathSaves;
                  if (nat === 20) {
                    // Natural 20: back up with 1 hit point.
                    d.play.currentHp = 1;
                    d.play.deathSaves = { success: 0, fail: 0 };
                  } else if (nat === 1) {
                    saves.fail = Math.min(3, saves.fail + 2);
                  } else if (r.total >= 10) {
                    saves.success = Math.min(3, saves.success + 1);
                  } else {
                    saves.fail = Math.min(3, saves.fail + 1);
                  }
                })
              }
              className="rounded-lg bg-accent-deep px-3 py-1.5 text-xs font-semibold"
              title="Roll a death save — successes and failures fill in automatically (nat 1 = two failures, nat 20 = back up on 1 HP)"
            >
              🎲 Roll save
            </button>
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
            rollLogStore.getState().append(
              roll(`1d20${fmt(sheet.initiative.value)}`, {
                label: 'Initiative',
                advantage: currentAdvantage(),
              }),
            )
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

      {/* Turn tracker: action economy */}
      <section className="flex items-center gap-2 rounded-lg bg-surface p-3">
        {(
          [
            ['action', 'Action'],
            ['bonus', 'Bonus'],
            ['reaction', 'Reaction'],
          ] as const
        ).map(([key, label]) => {
          const used = play.turn?.[key] ?? false;
          return (
            <button
              key={key}
              type="button"
              onClick={() =>
                update((d) => {
                  const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
                  turn[key] = !turn[key];
                  d.play.turn = turn;
                })
              }
              className={`flex-1 rounded-lg border px-2 py-2 text-sm font-semibold transition-colors ${
                used
                  ? 'border-surface-2 bg-surface-2 text-ink-muted line-through'
                  : key === 'bonus'
                    ? 'border-emerald-300/50 text-emerald-300'
                    : key === 'reaction'
                      ? 'border-sky-300/50 text-sky-300'
                      : 'border-accent/60 text-ink'
              }`}
              title={
                used
                  ? `${label} used — tap to undo`
                  : `Tap when you use your ${label.toLowerCase()}`
              }
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() =>
            update((d) => {
              d.play.turn = { action: false, bonus: false, reaction: false };
            })
          }
          className="shrink-0 rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold"
          title="Reset action, bonus action, and reaction"
        >
          End turn
        </button>
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

      {/* Spell slots (spend/restore) — the leveled pool is character-wide,
          so render its pips only on the first casting class. */}
      {sheet.spellcasting.map((sc, scIdx) => (
        <section key={sc.classUid} className="rounded-lg bg-surface p-3 text-sm">
          <div className="mb-1.5 flex justify-between">
            <span className="font-semibold">{sc.className} spellcasting</span>
            <span className="text-ink-muted">
              DC <strong className="text-ink">{sc.saveDc.value}</strong> · Atk{' '}
              <strong className="text-ink">{fmt(sc.attackMod.value)}</strong>
            </span>
          </div>
          {sc.pactSlots !== undefined && (
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
          )}
          {scIdx === sheet.spellcasting.findIndex((b) => b.slots.some((n) => n > 0)) && (
            <div className="flex flex-col gap-1">
              {sheet.spellcasting.length > 1 && (
                <span className="text-xs text-ink-muted">Slots (shared across classes)</span>
              )}
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

          {/* Known / prepared spells, castable right here */}
          {(() => {
            const state = doc.spellcasting[sc.classUid];
            if (state === undefined || state.known.length === 0) return null;
            const preparedUids = new Set(
              state.prepared.map((r) => `${r.name}|${r.source}`.toLowerCase()),
            );
            const registrySpells = [...state.known].sort((a, b) => a.name.localeCompare(b.name));
            return (
              <div className="mt-2 flex flex-col gap-1 border-t border-surface-2/40 pt-2">
                {registrySpells.map((ref) => {
                  const uid = `${ref.name}|${ref.source}`.toLowerCase();
                  const prepared = preparedUids.has(uid);
                  const level = spellLevelOf(ref.name, ref.source);
                  return (
                    <div key={uid} className="flex items-center gap-2 text-sm">
                      <span className="w-6 shrink-0 text-xs text-ink-muted">
                        {level === 0 ? 'c' : `L${level}`}
                      </span>
                      <Link
                        to={`/library/spell/${encodeURIComponent(uid)}`}
                        className={`min-w-0 flex-1 truncate ${prepared ? '' : 'text-ink-muted'}`}
                      >
                        {ref.name}
                        {prepared && (
                          <span className="ml-1.5 text-xs text-emerald-300">prepared</span>
                        )}
                      </Link>
                      {level > 0 && (
                        <button
                          type="button"
                          onClick={() => castSpell(update, sc, level)}
                          className="shrink-0 rounded bg-accent-deep px-2 py-0.5 text-xs font-semibold"
                          title={`Cast (spends the lowest available slot ≥ L${level})`}
                        >
                          Cast
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      ))}
    </div>
  );
}
