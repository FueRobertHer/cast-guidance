import { AlertTriangle, Minus, Moon, Plus, Sun } from 'lucide-react';
import { useOutletContext } from 'react-router';
import { useRegistry } from '@/data5e/hooks';
import { pickForVersion } from '@/data5e/rulesVersion';
import { roll } from '@/dice/roll';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { currentAdvantage } from '@/stores/advMode';
import { type Notice, notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { askConfirm, askNumber, askText } from '@/ui/dialogs';
import { FeatureInfoSheet, findFeatureInfo } from '@/ui/FeatureInfoSheet';
import { RollChip } from '@/ui/RollChip';
import { COMBAT_CAPABILITIES, capabilityKey } from '../combatCapabilities';
import { conditionLimits } from '../conditionEffects';
import { exhaustionInfo, exhaustionLevel } from '../exhaustion';
import { SpellInfoSheet } from '../SpellInfoSheet';
import { castSpell, spellNeedsConcentration } from '../SpellManager';
import type { CharacterSheetState } from '../useCharacterSheet';
import { weaponInfoEntries } from '../weaponInfo';

const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

// Exhaustion is leveled, so it gets its own stepper below — not a plain chip.
const CONDITIONS = [
  'Blinded',
  'Charmed',
  'Deafened',
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
  // Any manual HP change means the character is in play now: stop auto-tracking
  // max HP so a deliberate 0-HP / damaged state sticks across level-ups.
  play.hpInitialized = true;
  if (delta < 0) {
    let dmg = -delta;
    const fromTemp = Math.min(play.tempHp, dmg);
    play.tempHp -= fromTemp;
    dmg -= fromTemp;
    play.currentHp = Math.max(0, play.currentHp - dmg);
    if (play.currentHp === 0) play.concentratingOn = undefined; // dropping to 0 breaks concentration
  } else {
    play.currentHp = Math.min(maxHp, play.currentHp + delta);
    if (play.currentHp > 0) play.deathSaves = { success: 0, fail: 0 };
  }
}

/**
 * A concentrating character who takes damage must make a CON save
 * (DC = max(10, half the damage taken)). Rolls it, logs it, and breaks
 * concentration on a failure. Mutates the draft; returns a notice to show.
 * No-op when not concentrating or already dropped to 0 HP (that breaks it too).
 */
function rollConcentration(
  play: PlayState,
  damageTaken: number,
  conSave: number,
  adv: 'adv' | 'dis' | undefined,
): Notice | null {
  const label = play.concentratingOn?.label;
  if (label === undefined || damageTaken <= 0 || play.currentHp === 0) return null;
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const r = roll(`1d20${fmt(conSave)}`, {
    label: `Concentration save (DC ${dc})`,
    advantage: adv,
  });
  rollLogStore.getState().append(r);
  const held = r.total >= dc;
  if (!held) play.concentratingOn = undefined;
  return {
    title: held ? 'Concentration held' : 'Concentration broken',
    detail: `${label} · rolled ${r.total} vs DC ${dc}`,
    tone: held ? 'good' : 'warn',
  };
}

/** Reset short-rest state and return a human summary of what was restored. */
function shortRest(play: PlayState, sheet: DerivedSheet): string[] {
  const restored: string[] = [];
  for (const r of sheet.resources) {
    if (r.resetOn === 'short' && play.resources.some((x) => x.key === r.key && x.used > 0)) {
      restored.push(r.label);
    }
  }
  for (const r of sheet.resources) {
    if (r.resetOn === 'short') {
      play.resources = play.resources.filter((x) => x.key !== r.key);
    }
  }
  if (play.pactSlotsSpent > 0) {
    restored.push('pact slots');
    play.pactSlotsSpent = 0;
  }
  return restored;
}

/** Reset long-rest state and return a human summary of what was restored. */
function longRest(play: PlayState, sheet: DerivedSheet): string[] {
  const restored: string[] = [];
  const hpHealed = sheet.maxHp.value - play.currentHp;
  if (hpHealed > 0) restored.push(`+${hpHealed} HP`);
  if (play.slotsSpent.some((n) => n > 0)) restored.push('spell slots');
  if (play.pactSlotsSpent > 0) restored.push('pact slots');
  if (play.resources.some((r) => r.used > 0)) restored.push('resources');
  if (play.deathSaves.success > 0 || play.deathSaves.fail > 0) restored.push('death saves');

  play.currentHp = sheet.maxHp.value;
  play.tempHp = 0;
  play.slotsSpent = play.slotsSpent.map(() => 0);
  play.pactSlotsSpent = 0;
  play.resources = [];
  play.deathSaves = { success: 0, fail: 0 };
  // Regain half your total hit dice (minimum 1)
  let hitDiceBack = 0;
  for (const [die, total] of Object.entries(sheet.hitDice)) {
    const spent = play.hitDiceSpent[die] ?? 0;
    const back = Math.min(spent, Math.max(1, Math.floor(total / 2)));
    hitDiceBack += back;
    play.hitDiceSpent[die] = spent - back;
  }
  if (hitDiceBack > 0) restored.push(`${hitDiceBack} hit ${hitDiceBack === 1 ? 'die' : 'dice'}`);
  return restored;
}

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry();
  if (sheet === null || doc === null) return <p className="text-sm text-ink-muted">Deriving…</p>;

  // Look a spell up by its stored printing; when that misses (blank/wrong source
  // on a granted spell) fall back to the printing matching the character's rules
  // version, so a 2024 sheet shows 2024 text.
  const spellEntity = (name: string, source: string) => {
    if (registry === null) return undefined;
    const bySource = source !== '' ? registry.get('spell', name, source) : undefined;
    if (bySource !== undefined) return bySource;
    const cands = registry
      .byType('spell')
      .filter((e) => String(e.name).toLowerCase() === name.toLowerCase());
    return pickForVersion(cands, doc.rulesVersion);
  };
  const spellLevelOf = (name: string, source: string): number => {
    const e = spellEntity(name, source);
    return typeof e?.level === 'number' ? e.level : 1;
  };
  const spellConcentrationOf = (name: string, source: string): boolean =>
    spellNeedsConcentration(spellEntity(name, source));
  /** Which slice of the turn a spell's casting time uses (undefined for rituals). */
  const spellCastEconomy = (
    name: string,
    source: string,
  ): 'action' | 'bonus' | 'reaction' | undefined => {
    const e = spellEntity(name, source);
    const unit = Array.isArray(e?.time)
      ? String((e.time[0] as { unit?: unknown })?.unit ?? '')
      : '';
    return unit === 'bonus' || unit === 'reaction' || unit === 'action' ? unit : undefined;
  };

  const play = doc.play;

  /** Mark a slice of the action economy used (attacks, casting). */
  const markUsed = (kind: 'action' | 'bonus' | 'reaction') =>
    update((d) => {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      turn[kind] = true;
      d.play.turn = turn;
    });
  /** Cast an innate/granted spell: no slot, just concentration + economy. */
  const castGranted = (name: string, source: string) =>
    update((d) => {
      if (spellConcentrationOf(name, source)) d.play.concentratingOn = { label: name };
      const eco = spellCastEconomy(name, source);
      if (eco !== undefined) {
        const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
        turn[eco] = true;
        d.play.turn = turn;
      }
    });

  // What the active conditions stop you doing — shown as warnings, never blocks.
  const limits = conditionLimits(play.conditions);
  const spellHasVerbal = (name: string, source: string): boolean => {
    const e = spellEntity(name, source);
    return (e?.components as { v?: boolean } | undefined)?.v === true;
  };
  // Condition/status rules text for the character's edition — Exhaustion in
  // particular reads very differently between 2014 and 2024.
  const conditionEntry = (id: string) => {
    if (registry === null) return undefined;
    const cands = [...registry.byType('condition'), ...registry.byType('status')].filter(
      (e) => String(e.name).toLowerCase() === id.toLowerCase(),
    );
    return pickForVersion(cands, doc.rulesVersion);
  };
  /** Amber "you normally can't do this" line for a condition limit. */
  const limitWarning = (text: string, reasons: readonly string[]) =>
    reasons.length > 0 ? (
      <span className="flex items-center gap-1 text-xs text-amber-300">
        <AlertTriangle size={12} className="shrink-0" /> {text} ({reasons.join(', ')})
      </span>
    ) : null;

  // Exhaustion: leveled effects (speed, disadvantage, death) with a real stepper.
  const exLevel = exhaustionLevel(play.conditions);
  const exInfo = exhaustionInfo(exLevel, doc.rulesVersion);
  const displaySpeed = exInfo.speedAfter(sheet.speedWalk.value);
  const setExhaustion = (level: number) =>
    update((d) => {
      const idx = d.play.conditions.findIndex((x) => x.id === 'Exhaustion');
      const lvl = Math.max(0, Math.min(6, level));
      if (lvl === 0) {
        if (idx >= 0) d.play.conditions.splice(idx, 1);
      } else if (idx >= 0) {
        const e = d.play.conditions[idx];
        if (e !== undefined) e.level = lvl;
      } else {
        d.play.conditions.push({ id: 'Exhaustion', level: lvl });
      }
    });
  const dying = play.currentHp === 0 && sheet.maxHp.value > 0;

  /** Does the character have one of these feats/features (by `name|source` uid)? */
  const hasFeature = (...uids: string[]) => sheet.features.some((f) => uids.includes(f.origin.uid));
  // War Caster: advantage on concentration saves (a global DIS cancels it).
  const concAdv = (): 'adv' | 'dis' | undefined => {
    const base = currentAdvantage();
    if (!hasFeature('war caster|phb', 'war caster|xphb')) return base;
    return base === 'dis' ? undefined : 'adv';
  };

  const usedOf = (key: string) => play.resources.find((r) => r.key === key)?.used ?? 0;

  const hpDelta = async (delta: number) => {
    // Healing is a plain apply; damage may force a concentration save.
    if (delta >= 0) {
      update((d) => applyHp(d.play, delta, sheet.maxHp.value));
      return;
    }
    // Relentless Endurance: when the hit would drop to 0, offer 1 HP instead.
    const dmgToHp = Math.max(0, -delta - play.tempHp);
    const wouldDrop = play.currentHp > 0 && play.currentHp - dmgToHp <= 0;
    const relentless = sheet.resources.find((r) => r.key === 'relentless-endurance');
    const useRelentless =
      wouldDrop &&
      relentless !== undefined &&
      usedOf('relentless-endurance') < relentless.max &&
      (await askConfirm({
        title: 'Relentless Endurance',
        detail: 'Drop to 1 HP instead of 0? Once per long rest.',
        confirmLabel: 'Stay at 1 HP',
      }));
    let notice: Notice | null = null;
    update((d) => {
      const concentration = d.play.concentratingOn;
      applyHp(d.play, delta, sheet.maxHp.value);
      if (useRelentless && d.play.currentHp === 0) {
        d.play.currentHp = 1;
        d.play.concentratingOn = concentration; // never actually hit 0
        const entry = d.play.resources.find((r) => r.key === 'relentless-endurance');
        if (entry !== undefined) entry.used += 1;
        else d.play.resources.push({ key: 'relentless-endurance', used: 1 });
      }
      notice = rollConcentration(d.play, -delta, sheet.saves.con.total.value, concAdv());
    });
    if (notice !== null) notify(notice);
    else if (useRelentless) {
      notify({
        title: 'Relentless Endurance',
        detail: 'Dropped to 1 HP instead of 0 — used for the day',
        tone: 'good',
      });
    }
  };
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
            onClick={() => void hpDelta(-1)}
            onDoubleClick={() => void hpDelta(-4)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-deep text-xl"
            title="Damage (double-tap −5 total)"
          >
            <Minus size={22} />
          </button>
          <button
            type="button"
            className="text-center"
            onClick={async () => {
              const n = await askNumber({
                title: 'Set current HP',
                initial: play.currentHp,
                min: 0,
                max: sheet.maxHp.value,
                hint: `0–${sheet.maxHp.value}`,
              });
              if (n === null) return;
              let notice: Notice | null = null;
              update((d) => {
                const target = Math.max(0, Math.min(sheet.maxHp.value, n));
                const damageTaken = d.play.currentHp - target;
                d.play.currentHp = target;
                d.play.hpInitialized = true;
                if (target === 0) d.play.concentratingOn = undefined;
                else {
                  d.play.deathSaves = { success: 0, fail: 0 };
                  notice = rollConcentration(
                    d.play,
                    damageTaken,
                    sheet.saves.con.total.value,
                    concAdv(),
                  );
                }
              });
              if (notice !== null) notify(notice);
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
            onClick={() => void hpDelta(1)}
            onDoubleClick={() => void hpDelta(4)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/70 text-xl"
            title="Heal (double-tap +5 total)"
          >
            <Plus size={22} />
          </button>
        </div>
        {/* HP bar: green → amber → red as it drops; temp HP shows as a cyan cap */}
        {sheet.maxHp.value > 0 &&
          (() => {
            const ratio = Math.max(0, Math.min(1, play.currentHp / sheet.maxHp.value));
            const color =
              ratio > 0.5 ? 'bg-emerald-500' : ratio > 0.25 ? 'bg-amber-400' : 'bg-accent';
            const tempPct =
              play.tempHp > 0 ? Math.min(100, (play.tempHp / sheet.maxHp.value) * 100) : 0;
            return (
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full ${color} transition-all`}
                  style={{ width: `${ratio * 100}%` }}
                />
                {tempPct > 0 && (
                  <div className="h-full bg-sky-400/70" style={{ width: `${tempPct}%` }} />
                )}
              </div>
            );
          })()}
        <p className="mt-1.5 text-center text-[10px] text-ink-muted">
          tap ±1 · double-tap ±5 · tap the number to type it
        </p>
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            type="button"
            className="text-ink-muted underline"
            onClick={async () => {
              const n = await askNumber({
                title: 'Temporary HP',
                initial: play.tempHp,
                min: 0,
                hint: "Temp HP doesn't stack — a new source replaces the old value.",
              });
              if (n !== null) update((d) => void (d.play.tempHp = n));
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
                  // Durable (2024) grants advantage on death saves.
                  const base = currentAdvantage();
                  const adv = hasFeature('durable|xphb')
                    ? base === 'dis'
                      ? undefined
                      : 'adv'
                    : base;
                  const r = roll('1d20', { label: 'Death save', advantage: adv });
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
          <div className="text-2xl font-bold">
            {displaySpeed}
            {displaySpeed !== sheet.speedWalk.value && (
              <span className="ml-1.5 align-middle text-sm font-normal text-ink-muted line-through">
                {sheet.speedWalk.value}
              </span>
            )}
          </div>
          <div className="text-xs text-ink-muted">
            Speed (ft){displaySpeed !== sheet.speedWalk.value ? ' · exhausted' : ''}
          </div>
        </div>
      </section>

      {/* Inspiration + concentration */}
      <section className="flex gap-2">
        <button
          type="button"
          onClick={() => update((d) => void (d.play.inspiration = !d.play.inspiration))}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${
            play.inspiration
              ? 'border-amber-300 bg-amber-300/10 text-amber-300'
              : 'border-surface-2 text-ink-muted'
          }`}
          title="Heroic Inspiration — reroll a d20"
        >
          {play.inspiration ? '★' : '☆'} Inspiration
        </button>
        <button
          type="button"
          onClick={async () => {
            if (play.concentratingOn !== undefined) {
              update((d) => void (d.play.concentratingOn = undefined));
              return;
            }
            const label = await askText({
              title: 'Concentrating on…',
              placeholder: 'e.g. Bless — casting a concentration spell sets this automatically',
            });
            if (label !== null && label.trim() !== '') {
              update((d) => void (d.play.concentratingOn = { label: label.trim() }));
            }
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 truncate rounded-lg border px-3 py-2 text-sm font-semibold ${
            play.concentratingOn !== undefined
              ? 'border-sky-300 bg-sky-300/10 text-sky-300'
              : 'border-surface-2 text-ink-muted'
          }`}
          title="Concentration — tap to set or clear"
        >
          {play.concentratingOn !== undefined
            ? `◈ ${play.concentratingOn.label}`
            : '◇ Concentration'}
        </button>
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

      {/* Conditions — active ones stay visible; the full list is behind a fold */}
      <details className="group rounded-lg bg-surface" open={play.conditions.length > 0}>
        <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold text-ink-muted">
            Conditions
            {play.conditions.length > 0 && (
              <span className="ml-2 font-normal text-amber-300">
                {play.conditions
                  .map((c) => `${c.id}${c.level !== undefined ? ` ${c.level}` : ''}`)
                  .join(', ')}
              </span>
            )}
          </span>
          <span className="text-xs text-ink-muted group-open:hidden">tap to edit</span>
        </summary>
        <div className="flex flex-wrap gap-1.5 border-t border-surface-2/40 p-3">
          {CONDITIONS.map((c) => {
            const active = play.conditions.find((x) => x.id === c);
            return (
              <button
                key={c}
                type="button"
                onClick={() =>
                  update((d) => {
                    const idx = d.play.conditions.findIndex((x) => x.id === c);
                    if (idx === -1) d.play.conditions.push({ id: c });
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
              </button>
            );
          })}
        </div>
        {/* Exhaustion — leveled, with a real +/- stepper (decrease, not just cycle). */}
        <div className="flex flex-col gap-2 border-t border-surface-2/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Exhaustion</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease exhaustion"
                onClick={() => setExhaustion(exLevel - 1)}
                disabled={exLevel === 0}
                className="h-7 w-7 rounded-full bg-surface-2 text-lg leading-none disabled:opacity-30"
              >
                −
              </button>
              <span className="w-10 text-center text-sm font-bold">{exLevel} / 6</span>
              <button
                type="button"
                aria-label="Increase exhaustion"
                onClick={() => setExhaustion(exLevel + 1)}
                disabled={exLevel >= 6}
                className="h-7 w-7 rounded-full bg-surface-2 text-lg leading-none disabled:opacity-30"
              >
                +
              </button>
            </div>
          </div>
          {exInfo.lines.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-amber-300">
              {exInfo.lines.map((l) => (
                <li key={l} className="flex items-center gap-1">
                  <AlertTriangle size={11} className="shrink-0" /> {l}
                </li>
              ))}
            </ul>
          )}
          {exInfo.dead && (
            <button
              type="button"
              onClick={() =>
                update((d) => {
                  d.play.hpInitialized = true; // deliberate 0 HP must stick (no auto-fill)
                  d.play.currentHp = 0;
                  d.play.tempHp = 0;
                  d.play.concentratingOn = undefined;
                })
              }
              className="self-start rounded-lg border border-accent/60 px-3 py-1.5 text-xs font-semibold text-accent"
            >
              Apply death — drop to 0 HP
            </button>
          )}
        </div>
        {/* Rules text for whatever's currently active — no rulebook needed. */}
        {play.conditions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-2/40 p-3">
            <span className="w-full text-[10px] font-semibold uppercase text-ink-muted">
              What these do
            </span>
            {play.conditions.map((c) => {
              const e = conditionEntry(c.id);
              if (e?.entries === undefined) return null;
              return (
                <FeatureInfoSheet
                  key={c.id}
                  title={c.id}
                  entries={e.entries}
                  trigger={
                    <button
                      type="button"
                      className="rounded-full border border-surface-2 px-2.5 py-1 text-xs text-ink-muted underline decoration-dashed underline-offset-2"
                    >
                      {c.id}
                    </button>
                  }
                />
              );
            })}
          </div>
        )}
      </details>

      {/* Rests */}
      <section className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            let restored: string[] = [];
            update((d) => void (restored = shortRest(d.play, sheet)));
            notify({
              title: 'Short rest',
              detail:
                restored.length > 0 ? `Restored ${restored.join(', ')}` : 'Nothing to restore',
              tone: restored.length > 0 ? 'good' : 'info',
            });
          }}
          className="flex items-center justify-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm font-semibold"
        >
          <Sun size={16} /> Short rest
        </button>
        <button
          type="button"
          onClick={async () => {
            const ok = await askConfirm({
              title: 'Long rest',
              detail: 'Full HP, all spell slots and resources restored; regain half your hit dice.',
              confirmLabel: 'Rest',
            });
            if (!ok) return;
            let restored: string[] = [];
            update((d) => void (restored = longRest(d.play, sheet)));
            notify({
              title: 'Long rest complete',
              detail: restored.length > 0 ? `Restored ${restored.join(', ')}` : 'Already at full',
              tone: 'good',
            });
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
              const info = findFeatureInfo(sheet.features, r.label, r.origin);
              return (
                <div key={r.key} className="rounded-lg bg-surface p-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    {info !== undefined ? (
                      <FeatureInfoSheet
                        title={info.title}
                        subtitle={r.origin}
                        entries={info.entries}
                        trigger={
                          <button
                            type="button"
                            className="font-semibold underline decoration-surface-2 decoration-dashed underline-offset-4"
                            title="What does this do?"
                          >
                            {r.label}
                          </button>
                        }
                      />
                    ) : (
                      <span className="font-semibold">{r.label}</span>
                    )}
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
          {limitWarning("Can't take actions", limits.noActions)}
          {limitWarning('Disadvantage on attack rolls', limits.attackDisadvantage)}
          <div className="flex flex-col rounded-lg bg-surface">
            {sheet.attacks.map((a) => (
              <div
                key={a.label}
                className="flex items-center justify-between gap-2 border-b border-surface-2/40 px-3 py-2.5 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  {(() => {
                    const info = weaponInfoEntries(
                      registry,
                      a.label,
                      a.properties,
                      doc.rulesVersion,
                    );
                    return info !== undefined ? (
                      <FeatureInfoSheet
                        title={a.label}
                        entries={info}
                        trigger={
                          <button
                            type="button"
                            className="truncate text-left font-semibold underline decoration-surface-2 decoration-dashed underline-offset-4"
                          >
                            {a.label}
                          </button>
                        }
                      />
                    ) : (
                      <div className="truncate font-semibold">{a.label}</div>
                    );
                  })()}
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
                    onRolled={() => markUsed('action')}
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
          <p className="text-xs text-ink-muted">Tap a name for the full rules text.</p>
          {limitWarning("Can't take actions or reactions", limits.noActions)}
          <div className="flex flex-wrap gap-1.5">
            {sheet.actions.map((a) => {
              const info = findFeatureInfo(sheet.features, a.label, a.origin);
              // Limited-use actions share a name with their resource — rolling
              // one spends a use so the pips stay honest.
              const linkedResource = sheet.resources.find(
                (r) => r.label.toLowerCase() === a.label.toLowerCase(),
              );
              const spendLinked =
                linkedResource !== undefined
                  ? () => {
                      const used = usedOf(linkedResource.key);
                      if (used < linkedResource.max) setUsed(linkedResource.key, used + 1);
                    }
                  : undefined;
              const remaining =
                linkedResource !== undefined
                  ? linkedResource.max - usedOf(linkedResource.key)
                  : undefined;
              const mechanics = [
                a.note,
                a.save !== undefined
                  ? `DC ${a.save.dc} ${a.save.targetAbility.toUpperCase()} save`
                  : undefined,
                remaining !== undefined ? `${remaining}/${linkedResource?.max} left` : undefined,
              ]
                .filter((s) => s !== undefined)
                .join(' · ');
              const name =
                info !== undefined ? (
                  <FeatureInfoSheet
                    title={info.title}
                    subtitle={[a.origin, mechanics].filter((s) => s !== '').join(' · ')}
                    entries={info.entries}
                    trigger={
                      <button
                        type="button"
                        className="underline decoration-surface-2 decoration-dashed underline-offset-4"
                      >
                        {a.label}
                      </button>
                    }
                  />
                ) : (
                  a.label
                );
              return (
                <span
                  key={`${a.origin}:${a.label}`}
                  className={`flex flex-col rounded-2xl border px-3 py-1.5 text-sm ${
                    a.economy === 'bonus'
                      ? 'border-emerald-300/40 text-emerald-300'
                      : a.economy === 'reaction'
                        ? 'border-sky-300/40 text-sky-300'
                        : 'border-surface-2'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {name}
                    {a.roll !== undefined && (
                      <RollChip
                        expr={a.roll}
                        label={a.label}
                        variant="damage"
                        onRolled={spendLinked}
                      />
                    )}
                  </span>
                  {mechanics !== '' && (
                    <span className="text-[11px] leading-tight text-ink-muted">{mechanics}</span>
                  )}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Passive combat options — things you can always do (Extra Attack, …)
          that aren't already a limited-use action chip above. */}
      {(() => {
        const actionNames = new Set(sheet.actions.map((a) => capabilityKey(a.label)));
        const seen = new Set<string>();
        const caps = sheet.features
          .map((f) => ({ f, key: capabilityKey(f.name) }))
          .filter(({ key }) => {
            if (COMBAT_CAPABILITIES[key] === undefined || actionNames.has(key)) return false;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        if (caps.length === 0) return null;
        return (
          <section className="flex flex-col gap-1.5">
            <h2 className="text-sm font-semibold text-ink-muted">Combat options</h2>
            <p className="text-xs text-ink-muted">Things you can always do. Tap for full rules.</p>
            <div className="flex flex-col gap-1">
              {caps.map(({ f, key }) => (
                <FeatureInfoSheet
                  key={key}
                  title={f.name}
                  subtitle={f.origin.label}
                  entries={f.entries}
                  trigger={
                    <button
                      type="button"
                      className="flex flex-col rounded-lg bg-surface px-3 py-2 text-left text-sm"
                    >
                      <span className="font-medium underline decoration-surface-2 decoration-dashed underline-offset-2">
                        {f.name}
                      </span>
                      <span className="text-xs text-ink-muted">{COMBAT_CAPABILITIES[key]}</span>
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        );
      })()}

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
            // Sorted by level (cantrips first), then name — not alphabetically.
            const registrySpells = [...state.known].sort(
              (a, b) =>
                spellLevelOf(a.name, a.source) - spellLevelOf(b.name, b.source) ||
                a.name.localeCompare(b.name),
            );
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
                      <SpellInfoSheet
                        name={ref.name}
                        source={ref.source}
                        version={doc.rulesVersion}
                        subtitle={`${sc.className} spell${prepared ? ' · prepared' : ''}`}
                        trigger={
                          <button
                            type="button"
                            className={`min-w-0 flex-1 truncate text-left underline decoration-surface-2 decoration-dashed underline-offset-2 ${
                              prepared ? '' : 'text-ink-muted'
                            }`}
                          >
                            {ref.name}
                            {prepared && (
                              <span className="ml-1.5 text-xs text-emerald-300">prepared</span>
                            )}
                          </button>
                        }
                      />
                      {limits.noVerbal.length > 0 && spellHasVerbal(ref.name, ref.source) && (
                        <span
                          className="shrink-0 text-amber-300"
                          title={`${limits.noVerbal.join(', ')}: you can't speak — this spell has a verbal component`}
                        >
                          <AlertTriangle size={12} />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          castSpell(update, sc, level, {
                            name: ref.name,
                            source: ref.source,
                            concentration: spellConcentrationOf(ref.name, ref.source),
                            economy: spellCastEconomy(ref.name, ref.source),
                          })
                        }
                        className="shrink-0 rounded bg-accent-deep px-2 py-0.5 text-xs font-semibold"
                        title={
                          level === 0
                            ? 'Cast cantrip (marks your action/bonus action)'
                            : `Cast (spends the lowest available slot ≥ L${level})`
                        }
                      >
                        Cast
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      ))}

      {/* Innate / granted spells — cast per their own rules (no slots) */}
      {sheet.grantedSpells.length > 0 && (
        <section className="rounded-lg bg-surface p-3 text-sm">
          <div className="mb-1.5 font-semibold">Innate &amp; granted spells</div>
          <div className="flex flex-col gap-1">
            {sheet.grantedSpells.map((g) => (
              <div
                key={`${g.name}|${g.source}`}
                className="flex items-center gap-2 border-b border-surface-2/40 py-1.5 last:border-b-0"
              >
                <SpellInfoSheet
                  name={g.name}
                  source={g.source}
                  version={doc.rulesVersion}
                  subtitle={`${g.origin}${g.usage === 'prepared' ? ' · always prepared' : ''}`}
                  trigger={
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <span className="truncate capitalize underline decoration-surface-2 decoration-dashed underline-offset-2">
                        {g.name}
                      </span>
                      {g.usage === 'prepared' && (
                        <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                          Always prepared
                        </span>
                      )}
                    </button>
                  }
                />
                <span className="shrink-0 text-xs text-ink-muted">
                  {g.ability !== undefined ? g.ability.toUpperCase() : g.origin}
                </span>
                {limits.noVerbal.length > 0 && spellHasVerbal(g.name, g.source) && (
                  <span
                    className="shrink-0 text-amber-300"
                    title={`${limits.noVerbal.join(', ')}: you can't speak — this spell has a verbal component`}
                  >
                    <AlertTriangle size={12} />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => castGranted(g.name, g.source)}
                  className="shrink-0 rounded bg-accent-deep px-2 py-0.5 text-xs font-semibold"
                  title="Cast (marks your action/bonus action; starts concentration if needed)"
                >
                  Cast
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
