import { AlertTriangle, Brain, Hourglass, Minus, Moon, Plus, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useRegistry } from '@/data5e/hooks';
import { pickForVersion } from '@/data5e/rulesVersion';
import { roll } from '@/dice/roll';
import type { PlayState, SpellcastingBlock } from '@/engine/types';
import { currentAdvantage } from '@/stores/advMode';
import { announce, cancelAnnouncement } from '@/stores/announcer';
import { type Notice, notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { Badge, badgeClass } from '@/ui/Badge';
import { BannerAction } from '@/ui/Banner';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { Button, buttonClass } from '@/ui/Button';
import { Chip, chipClass } from '@/ui/Chip';
import { D20Icon } from '@/ui/D20Icon';
import { askConfirm, askNumber, askText } from '@/ui/dialogs';
import { FeatureInfoSheet, findFeatureInfo } from '@/ui/FeatureInfoSheet';
import { Pips } from '@/ui/Pips';
import { RollChip } from '@/ui/RollChip';
import { cardClass, listClass } from '@/ui/surfaces';
import { CastResourcePicker } from '../CastResourcePicker';
import {
  availableCastResources,
  type CastResource,
  castingEconomy,
  castResourceId,
  castResourceLabel,
  castSpell,
  defaultCastResource,
} from '../castResources';
import { capabilityKey, collectCapabilityCards } from '../combatCapabilities';
import { conditionLimits } from '../conditionEffects';
import { exhaustionInfo, exhaustionLevel } from '../exhaustion';
import { clampPlayStateToMax, detectPlayStateOverages } from '../playStateLimits';
import { longRest, shortRest } from '../rest';
import { SpellInfoSheet } from '../SpellInfoSheet';
import { spellNeedsConcentration } from '../SpellManager';
import { spellRollActions } from '../spellRolls';
import type { CharacterSheetState } from '../useCharacterSheet';
import { attackSubtitle, damageLabel, weaponInfoEntries } from '../weaponInfo';

const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** A section's heading and the helper line under it (DS-001 `heading`, `caption`). */
const H2 = 'px-1 text-heading';
const HELP = 'px-1 text-caption text-ink-muted';
/** A quiet text link in a card's footer (temp HP, breakdown). */
const LINK =
  'min-h-6 whitespace-nowrap text-caption font-semibold text-ink-muted underline decoration-line-strong underline-offset-3 hover:text-ink';
/** A name that opens its rules: dashed, so it reads as tappable without shouting. */
const RULES = 'underline decoration-line-strong decoration-dashed';
/**
 * A lasting state, on or off (Inspiration, Concentration): ToggleChip's look,
 * without its On and Off words, which would change the buttons' names. Each
 * grows from 8rem, so the pair stacks where both do not fit (large text)
 * rather than push the page sideways (A11Y-003).
 */
const TOGGLE =
  'flex min-h-tap min-w-0 grow basis-32 items-center justify-center gap-2 rounded-control px-4 text-label transition-colors duration-120';
const TOGGLE_OFF = 'text-ink-muted ring-1 ring-line-strong ring-inset hover:text-ink';
/** The HP card's ±1: round `surface-raised` steppers, the icon in `danger` or `heal`. */
const STEP =
  'flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised transition-[background-color,scale] duration-120 hover:bg-surface-hover active:scale-92';
/** Its ±5: a 36px tint of the same role inside a 44px target (A11Y-002). */
const FIVE =
  'tap rounded-full text-label tabular-nums transition-[filter] duration-120 hover:brightness-112';
/** A card without its padding (surfaces' `cardClass`), for one whose rows pad themselves. */
const FLUSH = 'rounded-card bg-surface shadow-card ring-1 ring-line ring-inset';
/** A cell of the AC / Initiative / Speed strip. */
const TILE = 'flex min-h-19 flex-col items-center justify-center gap-0.5 px-1 py-2';
/** Exhaustion's −/+: a 32px raised circle in a 44px target, `ink-faint` when it cannot go further. */
const EX_STEP = 'tap rounded-full text-ink disabled:text-ink-faint';
/** A point pool's −5 / −1 / +1 / +5 (sorcery points, Lay on Hands). */
const POOL_STEP =
  'tap rounded-full bg-surface-raised px-2 text-label tabular-nums leading-none hover:bg-surface-hover unavailable:bg-surface-raised unavailable:text-ink-faint';

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

/**
 * How long HP has to stay put before it is said (A11Y-002). A run of taps on
 * the steppers is one change to a listener: only where it ends is spoken.
 */
export const HP_SETTLE_MS = 1000;

/** HP as a screen reader hears it once a change settles; the meter's own words. */
export function hpSpeech(play: Pick<PlayState, 'currentHp' | 'tempHp'>, max: number): string {
  const temp = play.tempHp > 0 ? `, plus ${play.tempHp} temporary` : '';
  return `${play.currentHp} of ${max} hit points${temp}`;
}

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

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry();
  // Keyed by character, so a settling HP line is only ever about the one it
  // was for; leaving the tab or the character drops one still settling.
  const hpKey = `hp:${doc?.id ?? ''}`;
  useEffect(() => () => cancelAnnouncement(hpKey), [hpKey]);
  // Which resource each castable spell will spend, keyed by class + spell, held
  // only for as long as the tab is open: a pick is about this cast, not a
  // setting.
  const [castChoice, setCastChoice] = useState<Record<string, string>>({});
  // Anything that moves a slot, a pact slot or a pool drops every standing pick.
  // Suppressing an unavailable pick is not enough on its own: the id would sit
  // there and take effect again the moment the option came back, so a choice
  // made before a long rest would silently upcast the first cast after it.
  const spendState = JSON.stringify([
    doc?.play.slotsSpent,
    doc?.play.pactSlotsSpent,
    doc?.play.resources,
  ]);
  const lastSpendState = useRef(spendState);
  useEffect(() => {
    if (lastSpendState.current === spendState) return;
    lastSpendState.current = spendState;
    setCastChoice({});
  }, [spendState]);
  if (sheet === null || doc === null) return <p className="text-body text-ink-muted">Deriving…</p>;

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
  const spellCastEconomy = (name: string, source: string) =>
    castingEconomy(spellEntity(name, source));

  const play = doc.play;

  // After a build change lowers a limit, stored play state can hold values above
  // the new maxima — surface them and offer a non-destructive clamp (GAME-007).
  const overages = detectPlayStateOverages(play, sheet);

  /**
   * Mark a slice of the action economy used (attacks, casting). `label` names
   * the deed for history: the diff only shows "action spent", which can't tell
   * a Longsword swing from a Dodge.
   */
  const markUsed = (kind: 'action' | 'bonus' | 'reaction', label?: string) =>
    update((d) => {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      turn[kind] = true;
      d.play.turn = turn;
    }, label);
  /**
   * Trigger an action: mark its slice of the turn used AND spend one pip of its
   * linked resource (if any), in a single update so the sheet stays honest.
   */
  const triggerAction = (
    economy: 'action' | 'bonus' | 'reaction',
    resourceKey?: string,
    max?: number,
    label?: string,
  ) =>
    update(
      (d) => {
        const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
        turn[economy] = true;
        d.play.turn = turn;
        if (resourceKey !== undefined && max !== undefined) {
          const entry = d.play.resources.find((r) => r.key === resourceKey);
          const used = entry?.used ?? 0;
          if (used < max) {
            if (entry !== undefined) entry.used = used + 1;
            else d.play.resources.push({ key: resourceKey, used: 1 });
          }
        }
      },
      label !== undefined ? `Used ${label}` : undefined,
    );
  /** Cast an innate/granted spell: no slot, just concentration + economy. */
  const castGranted = (name: string, source: string, limit?: { key: string; max: number }) =>
    update((d) => {
      if (spellConcentrationOf(name, source)) d.play.concentratingOn = { label: name };
      const eco = spellCastEconomy(name, source);
      if (eco !== undefined) {
        const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
        turn[eco] = true;
        d.play.turn = turn;
      }
      // A grant with its own pool ("1/day" from a wand) spends a use here
      // rather than leaving the pips for the player to remember.
      if (limit !== undefined) {
        const entry = d.play.resources.find((r) => r.key === limit.key);
        const used = entry?.used ?? 0;
        if (used < limit.max) {
          if (entry !== undefined) entry.used = used + 1;
          else d.play.resources.push({ key: limit.key, used: 1 });
        }
      }
    }, `Cast ${name}`);

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
  /** A `guide` "you normally can't do this" line for a condition limit. */
  const limitWarning = (text: string, reasons: readonly string[]) =>
    reasons.length > 0 ? (
      <span className="flex items-center gap-1 px-1 text-caption text-guide">
        <AlertTriangle size={14} className="shrink-0" /> {text} ({reasons.join(', ')})
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

  /**
   * What a cast will spend, and everything it could spend: the player's standing
   * pick when it is still on offer, else the automatic one. Checking the pick
   * against the live options is the synchronous guard that a cast in the same
   * tick as a build change cannot spend something the character no longer has;
   * the effect above is what stops a suppressed pick from coming back.
   */
  const castResourceFor = (key: string, block: SpellcastingBlock, level: number) => {
    const options = availableCastResources(block, play, level, sheet.resources);
    const picked = options.find((o) => castResourceId(o) === castChoice[key]);
    return {
      options,
      resource: picked ?? defaultCastResource(block, play, level, sheet.resources, options),
    };
  };
  const chooseCastResource = (key: string, resource: CastResource) =>
    setCastChoice((prev) => ({ ...prev, [key]: castResourceId(resource) }));

  /** Say where HP ended up, once the taps stop; see {@link HP_SETTLE_MS}. */
  const sayHp = (after: Pick<PlayState, 'currentHp' | 'tempHp'>) =>
    announce(hpSpeech(after, sheet.maxHp.value), { key: hpKey, settleMs: HP_SETTLE_MS });
  const hpDelta = async (delta: number) => {
    const after = { currentHp: play.currentHp, tempHp: play.tempHp };
    // Healing is a plain apply; damage may force a concentration save.
    if (delta >= 0) {
      update((d) => {
        applyHp(d.play, delta, sheet.maxHp.value);
        after.currentHp = d.play.currentHp;
        after.tempHp = d.play.tempHp;
      });
      sayHp(after);
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
      after.currentHp = d.play.currentHp;
      after.tempHp = d.play.tempHp;
    });
    sayHp(after);
    if (notice !== null) notify(notice);
    else if (useRelentless) {
      notify({
        title: 'Relentless Endurance',
        detail: 'Dropped to 1 HP instead of 0, used for the day',
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
      {overages.length > 0 && (
        <section className="rounded-control bg-guide-soft p-3" role="alert">
          <p className="flex items-center gap-2 text-body-strong">
            <AlertTriangle size={16} className="shrink-0 text-guide" />
            Some tracked values are above their new limits
          </p>
          <p className="mt-0.5 text-caption text-ink-muted">
            A build change lowered these. You can keep them as-is (house rule) or bring them back
            within range.
          </p>
          <ul className="mt-2 flex flex-col gap-0.5 text-caption">
            {overages.map((o) => (
              <li key={`${o.kind}:${o.label}`}>
                {o.label}: <span className="tabular-nums">{o.current}</span> → max{' '}
                <span className="tabular-nums">{o.max}</span>
              </li>
            ))}
          </ul>
          {/* The guide ground's own action, as on a guide banner: an outline
              would sit under 3:1 on the tint. */}
          <BannerAction
            tone="guide"
            onClick={() => update((d) => clampPlayStateToMax(d.play, sheet))}
            className="mt-1 -mb-1.5 -ml-1.5"
          >
            Bring within limits
          </BannerAction>
        </section>
      )}
      {/* HP: the hero card (DS-001 HitPoints). */}
      <section className={cardClass}>
        {/* Wraps where the row cannot fit (large text), the heal pair kept
            at the right, rather than push the page sideways (A11Y-003). */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Explicit amounts — a reliable single click each. (The old single/
              double-tap combo double-fired: a "double-tap −5" applied −6 and
              rolled up to three concentration saves.) Tap the total for an
              exact value. */}
          <div className="flex items-center gap-0.5">
            {/* ±5 keep their smaller circle so ±1 still reads as the main
                control, inside a 44px target (A11Y-002). They are the HP
                card's damage and heal tints; ±1 are its round steppers. */}
            <button
              type="button"
              aria-label="Damage 5 hit points"
              onClick={() => void hpDelta(-5)}
              className={FIVE}
              title="Damage 5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-danger-soft text-danger">
                −5
              </span>
            </button>
            <button
              type="button"
              aria-label="Damage 1 hit point"
              onClick={() => void hpDelta(-1)}
              className={`${STEP} text-danger`}
              title="Damage 1"
            >
              <Minus size={24} />
            </button>
          </div>
          {/* Zero basis: the row wraps only when the HP's narrowest layout
              cannot fit, never just because a long total would rather not
              break onto two lines. The 3.25rem floor is what fits between
              the pairs at 320px; with large text it no longer fits beside
              a pair, so the total gets a line of its own rather than split
              "0 / 0" in two. Never below min-content, though: a floor that
              replaced it let a long total run into the heal pair. */}
          <button
            type="button"
            className="min-w-[max(3.25rem,min-content)] grow basis-0 text-center"
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
              const after = { currentHp: play.currentHp, tempHp: play.tempHp };
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
                after.currentHp = d.play.currentHp;
                after.tempHp = d.play.tempHp;
              });
              sayHp(after);
              if (notice !== null) notify(notice);
            }}
          >
            {/* `stat` under 360px and `stat-hero` from there: three-digit HP
                between two 94px button pairs has about 50px at 320
                (A11Y-002). The total may break before "/ max" and nowhere
                else: kept on one line whole, even a two-digit total would
                push the heal pair onto a line of its own at 320px. */}
            <div className="text-stat tabular-nums min-[360px]:text-stat-hero">
              {play.currentHp}{' '}
              <span className="whitespace-nowrap text-title-sheet text-ink-muted">
                / {sheet.maxHp.value}
              </span>
            </div>
            <div className="text-caption text-ink-muted">
              hit points{play.tempHp > 0 ? ` · +${play.tempHp} temp` : ''}
              {sheet.maxHp.overridden ? ' •' : ''}
            </div>
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Heal 1 hit point"
              onClick={() => void hpDelta(1)}
              className={`${STEP} text-heal`}
              title="Heal 1"
            >
              <Plus size={24} />
            </button>
            <button
              type="button"
              aria-label="Heal 5 hit points"
              onClick={() => void hpDelta(5)}
              className={FIVE}
              title="Heal 5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-heal-soft text-heal">
                +5
              </span>
            </button>
          </div>
        </div>
        {/* HP bar: green → amber → red as it drops; temp HP shows as a cyan cap.
            The colour is a glance cue only: the numbers above say the same
            thing, and the bar is a meter that reports them (A11Y-002). */}
        {sheet.maxHp.value > 0 &&
          (() => {
            const max = sheet.maxHp.value;
            const ratio = Math.max(0, Math.min(1, play.currentHp / max));
            const color = ratio > 0.5 ? 'bg-heal' : ratio > 0.25 ? 'bg-meter-mid' : 'bg-danger';
            const tempPct = play.tempHp > 0 ? Math.min(100, (play.tempHp / max) * 100) : 0;
            // valuenow has to sit inside the range, but the text says what the
            // screen says: a house rule can leave HP above max (140 / 136).
            const now = Math.max(0, Math.min(max, play.currentHp));
            return (
              // biome-ignore lint/a11y/useSemanticElements: a native <meter> draws one fill and cannot show the temp HP cap beside it
              <div
                role="meter"
                aria-label="Hit points"
                aria-valuemin={0}
                aria-valuemax={max}
                aria-valuenow={now}
                aria-valuetext={`${play.currentHp} of ${max}${
                  play.tempHp > 0 ? `, plus ${play.tempHp} temporary` : ''
                }`}
                className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-track"
              >
                <div
                  className={`h-full ${color} transition-[width,background-color] duration-200 ease-arrive`}
                  style={{ width: `${ratio * 100}%` }}
                />
                {/* Striped `ward`, so temp HP differs from the fill in
                    pattern as well as hue. */}
                {tempPct > 0 && (
                  <div
                    className="h-full rounded-r-full bg-[repeating-linear-gradient(135deg,var(--cg-ward)_0_4px,transparent_4px_7px)] shadow-[inset_0_0_0_1.5px_var(--cg-ward)]"
                    style={{ width: `${tempPct}%` }}
                  />
                )}
              </div>
            );
          })()}
        <p className="mt-1.5 text-center text-caption text-ink-muted">
          tap ±1 or ±5 · tap the number to type an exact value
        </p>
        {/* Wraps whole items onto a second line at 320px rather than
            breaking a hit die chip in two. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <button
            type="button"
            className={LINK}
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
          <div className="flex flex-wrap gap-1">
            {Object.entries(sheet.hitDice).map(([die, total]) => (
              <button
                key={die}
                type="button"
                aria-label={`Spend a ${die} hit die, ${total - (play.hitDiceSpent[die] ?? 0)} left`}
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
                className="min-h-6 whitespace-nowrap rounded-chip bg-surface-raised px-2 text-dice tabular-nums hover:bg-surface-hover"
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
              <button type="button" className={LINK}>
                breakdown
              </button>
            }
          />
        </div>
      </section>

      {/* Death saves */}
      {dying && (
        <section className={cardClass}>
          <div className="mb-2 text-heading text-danger">Death saving throws</div>
          {/* Successes over failures, each circle in a 44px target
              (A11Y-002); Roll save wraps under them on a narrow phone. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              {(['success', 'fail'] as const).map((kind) => (
                <div key={kind} className="flex items-center">
                  <span className="w-14 text-caption text-ink-muted capitalize">{kind}</span>
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`Death save ${kind} ${n}`}
                      aria-pressed={play.deathSaves[kind] >= n}
                      onClick={() =>
                        update((d) => {
                          d.play.deathSaves[kind] = d.play.deathSaves[kind] >= n ? n - 1 : n;
                        })
                      }
                      className="tap rounded-full"
                    >
                      {/* Marked: filled `heal` or `danger`. Unmarked: an empty
                          `line-strong` ring, so the two differ in shape. */}
                      <span
                        aria-hidden="true"
                        className={`size-5 rounded-full border-2 ${
                          play.deathSaves[kind] >= n
                            ? kind === 'success'
                              ? 'border-heal bg-heal'
                              : 'border-danger bg-danger'
                            : 'border-line-strong'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <Button
              variant="brand"
              size="sm"
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
              title="Roll a death save — successes and failures fill in automatically (nat 1 = two failures, nat 20 = back up on 1 HP)"
            >
              {/* The one next step while dying, so the one `brand` button. */}
              <D20Icon size={16} /> Roll save
            </Button>
          </div>
        </section>
      )}

      {/* Core tiles: one strip, its cells divided by `line` hairlines. */}
      <section className={`grid grid-cols-3 overflow-hidden text-center ${FLUSH}`}>
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
            <button type="button" className={TILE}>
              <div className="text-stat tabular-nums">{sheet.ac.value}</div>
              <div className="text-caption text-ink-muted">AC{sheet.ac.overridden ? ' •' : ''}</div>
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
          className={`${TILE} border-line border-l`}
        >
          <div className="text-stat tabular-nums">{fmt(sheet.initiative.value)}</div>
          <div className="flex items-center justify-center gap-1 text-caption text-ink-muted">
            Initiative <D20Icon size={14} />
          </div>
        </button>
        <div className={`${TILE} border-line border-l`}>
          <div className="text-stat tabular-nums">
            {displaySpeed}
            {displaySpeed !== sheet.speedWalk.value && (
              <span className="ml-1.5 align-middle font-normal text-body text-ink-muted line-through">
                {sheet.speedWalk.value}
              </span>
            )}
          </div>
          <div className="text-caption text-ink-muted">
            Speed (ft){displaySpeed !== sheet.speedWalk.value ? ' · exhausted' : ''}
          </div>
        </div>
      </section>

      {/* Inspiration + concentration */}
      <section className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={play.inspiration}
          onClick={() => update((d) => void (d.play.inspiration = !d.play.inspiration))}
          className={`${TOGGLE} ${play.inspiration ? 'bg-guide-soft text-guide' : TOGGLE_OFF}`}
          title="Heroic Inspiration — reroll a d20"
        >
          {/* Filled while held: a change of shape as well as colour. */}
          <Star size={16} fill={play.inspiration ? 'currentColor' : 'none'} className="shrink-0" />
          <span className="truncate">Inspiration</span>
        </button>
        <button
          type="button"
          aria-pressed={play.concentratingOn !== undefined}
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
          className={`${TOGGLE} ${
            play.concentratingOn !== undefined ? 'bg-arcane-soft text-arcane' : TOGGLE_OFF
          }`}
          title="Concentration — tap to set or clear"
        >
          <Brain size={16} className="shrink-0" />
          {/* The visible label is the spell alone; the prefix says what it means. */}
          <span className="truncate">
            {play.concentratingOn !== undefined ? (
              <>
                <span className="sr-only">Concentrating on</span> {play.concentratingOn.label}
              </>
            ) : (
              'Concentration'
            )}
          </span>
        </button>
      </section>

      {/* Turn tracker: action economy. Wraps End turn onto a line of its own,
          at the right, where the row is too narrow for all four (320px, or
          large text) instead of pushing the page sideways (A11Y-003). */}
      <section className={`flex flex-wrap items-center gap-2 ${cardClass}`}>
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
              aria-pressed={used}
              onClick={() =>
                update((d) => {
                  const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
                  turn[key] = !turn[key];
                  d.play.turn = turn;
                })
              }
              // Three equal slots, so all ink (DS-001 TurnTracker): ready is
              // an outline, used fills and strikes the name.
              className={`min-h-tap flex-1 rounded-control px-2 text-label transition-colors duration-120 ${
                used
                  ? 'bg-surface-raised text-ink-muted line-through decoration-[1.5px]'
                  : 'text-ink ring-1 ring-line-strong ring-inset hover:bg-surface-raised'
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update((d) => {
              d.play.turn = { action: false, bonus: false, reaction: false };
            }, 'Turn ended')
          }
          className="-mr-1 ml-auto shrink-0"
          title="Reset action, bonus action, and reaction"
        >
          End turn
        </Button>
      </section>

      {/* Conditions — active ones stay visible; the full list is behind a fold */}
      <details className={`group ${FLUSH}`} open={play.conditions.length > 0}>
        <summary className="flex min-h-tap cursor-pointer items-center justify-between gap-2 px-4 py-2">
          <span className="text-heading">
            Conditions
            {play.conditions.length > 0 && (
              <span className="ml-2 font-normal text-body text-guide">
                {play.conditions
                  .map((c) => `${c.id}${c.level !== undefined ? ` ${c.level}` : ''}`)
                  .join(', ')}
              </span>
            )}
          </span>
          <span className="shrink-0 text-caption text-ink-muted group-open:hidden">
            tap to edit
          </span>
        </summary>
        {/* Chips pad themselves to 44px with a 6px clear border, so the
            row needs no gap and less padding of its own. */}
        <div className="flex flex-wrap border-line border-t px-2.5 py-2">
          {CONDITIONS.map((c) => {
            const active = play.conditions.find((x) => x.id === c);
            return (
              <Chip
                key={c}
                pressed={active !== undefined}
                onClick={() =>
                  update((d) => {
                    const idx = d.play.conditions.findIndex((x) => x.id === c);
                    if (idx === -1) d.play.conditions.push({ id: c });
                    else d.play.conditions.splice(idx, 1);
                  })
                }
              >
                {c}
              </Chip>
            );
          })}
        </div>
        {/* Exhaustion — leveled, with a real +/- stepper (decrease, not just cycle). */}
        <div className="flex flex-col gap-2 border-line border-t px-4 py-3">
          {/* Wraps the stepper under the name, at the right, where both do not
              fit (large text), and the count grows with its text rather than
              push the + out of the card (A11Y-003). */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body-strong">Exhaustion</span>
            <div className="-my-2 ml-auto flex items-center">
              <button
                type="button"
                aria-label="Decrease exhaustion"
                onClick={() => setExhaustion(exLevel - 1)}
                disabled={exLevel === 0}
                className={EX_STEP}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised">
                  <Minus size={16} />
                </span>
              </button>
              <span className="min-w-10 whitespace-nowrap text-center text-body-strong tabular-nums">
                {exLevel} / 6
              </span>
              <button
                type="button"
                aria-label="Increase exhaustion"
                onClick={() => setExhaustion(exLevel + 1)}
                disabled={exLevel >= 6}
                className={EX_STEP}
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-surface-raised">
                  <Plus size={16} />
                </span>
              </button>
            </div>
          </div>
          {exInfo.lines.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-caption text-guide">
              {exInfo.lines.map((l) => (
                <li key={l} className="flex items-center gap-1">
                  <AlertTriangle size={14} className="shrink-0" /> {l}
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
              className="min-h-8 self-start rounded-control px-3 py-1 text-danger text-label ring-1 ring-line-strong ring-inset transition-colors duration-120 hover:bg-danger-soft"
            >
              Apply death — drop to 0 HP
            </button>
          )}
        </div>
        {/* Rules text for whatever's currently active — no rulebook needed. */}
        {play.conditions.length > 0 && (
          <div className="flex flex-wrap items-center border-line border-t px-2.5 py-2">
            <span className="w-full px-1.5 pt-1 text-ink-muted text-overline uppercase">
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
                      aria-label={`What ${c.id} does`}
                      className={`${chipClass('outline')} ${RULES} underline-offset-2`}
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
            update((d) => void (restored = shortRest(d.play, sheet)), 'Short rest');
            notify({
              title: 'Short rest',
              detail:
                restored.length > 0 ? `Restored ${restored.join(', ')}` : 'Nothing to restore',
              tone: restored.length > 0 ? 'good' : 'info',
            });
          }}
          className={buttonClass({ variant: 'outline' })}
        >
          <Hourglass size={18} /> Short rest
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
            update((d) => void (restored = longRest(d.play, sheet)), 'Long rest');
            notify({
              title: 'Long rest complete',
              detail: restored.length > 0 ? `Restored ${restored.join(', ')}` : 'Already at full',
              tone: 'good',
            });
          }}
          className={buttonClass({ variant: 'outline' })}
        >
          <Moon size={18} /> Long rest
        </button>
      </section>

      {/* Resources with pips */}
      {sheet.resources.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Resources</h2>
          {/* One list, a row per pool: its name and when it comes back on the
              left, the pips (or a point pool's stepper) at the end, wrapping
              under the name where a long pool does not fit beside it. */}
          <div className={listClass}>
            {sheet.resources.map((r) => {
              const used = usedOf(r.key);
              const info = findFeatureInfo(sheet.features, r.label, r.origin);
              return (
                <div
                  key={r.key}
                  className="flex min-h-14 flex-wrap items-center justify-end gap-x-2 py-1 pr-2 pl-4"
                >
                  <div className="flex min-w-0 flex-1 basis-32 flex-col items-start py-1">
                    {info !== undefined ? (
                      <FeatureInfoSheet
                        title={info.title}
                        subtitle={r.origin}
                        entries={info.entries}
                        trigger={
                          <button
                            type="button"
                            className={`min-h-6 text-left text-body-strong ${RULES} underline-offset-4`}
                            title="What does this do?"
                          >
                            {r.label}
                          </button>
                        }
                      />
                    ) : (
                      <span className="text-body-strong">{r.label}</span>
                    )}
                    <span className="text-caption text-ink-muted">{r.resetOn} rest</span>
                  </div>
                  {r.max > 12 ? (
                    // Point pools (Lay on Hands, ki, sorcery points) outgrow
                    // pips fast, and pips can't even reach uses beyond the
                    // twelfth; a stepper covers the whole range. ±5 as well as
                    // ±1, because a level 20 paladin heals out of a 100-point
                    // pool and single taps would not get there.
                    <div className="flex items-center gap-1.5">
                      {([5, 1] as const).map((step) => (
                        <button
                          key={`spend-${String(step)}`}
                          type="button"
                          aria-label={`Spend ${step} ${r.label}`}
                          onClick={() => setUsed(r.key, Math.min(r.max, used + step))}
                          disabled={used >= r.max}
                          className={POOL_STEP}
                        >
                          −{step}
                        </button>
                      ))}
                      <span className="min-w-16 text-center text-body-strong tabular-nums">
                        {r.max - used}
                        <span className="font-normal text-ink-muted"> / {r.max}</span>
                      </span>
                      {([1, 5] as const).map((step) => (
                        <button
                          key={`restore-${String(step)}`}
                          type="button"
                          aria-label={`Restore ${step} ${r.label}`}
                          onClick={() => setUsed(r.key, Math.max(0, used - step))}
                          disabled={used === 0}
                          className={POOL_STEP}
                        >
                          +{step}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap justify-end">
                      <Pips
                        total={r.max}
                        spent={used}
                        onChange={(next) => setUsed(r.key, next)}
                        label={(use) => `${r.label} use ${use}`}
                        tone="ink"
                        title={`${r.max - used} of ${r.max} left`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Attacks */}
      {sheet.attacks.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Attacks</h2>
          {limitWarning("Can't take actions", limits.noActions)}
          {limitWarning('Disadvantage on attack rolls', limits.attackDisadvantage)}
          <div className={listClass}>
            {sheet.attacks.map((a) => (
              <div
                key={a.label}
                className="flex min-h-15 items-center justify-between gap-2 py-2 pr-3 pl-4"
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
                            className={`min-h-6 max-w-full truncate text-left text-body-strong ${RULES} underline-offset-4`}
                          >
                            {a.label}
                          </button>
                        }
                      />
                    ) : (
                      <div className="truncate text-body-strong">{a.label}</div>
                    );
                  })()}
                  <div className="truncate text-caption text-ink-muted">{attackSubtitle(a)}</div>
                </div>
                {/* Wraps rather than squeezing the name: a versatile weapon
                    with a damage rider carries four chips, which is one more
                    than a narrow phone fits on a line. */}
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <RollChip
                    expr={`1d20${fmt(a.toHit.value)}`}
                    display={fmt(a.toHit.value)}
                    label={`${a.label} attack`}
                    variant="d20"
                    onRolled={() => markUsed('action', `Attacked with ${a.label}`)}
                  />
                  <RollChip
                    expr={a.damage}
                    label={damageLabel(a.label, a.damageType)}
                    variant="damage"
                  />
                  {a.versatileDamage !== undefined && (
                    <RollChip
                      expr={a.versatileDamage}
                      label={`${damageLabel(a.label, a.damageType)} (two-handed)`}
                      variant="damage"
                    />
                  )}
                  {/* Each rider rolls on its own: the totals are resisted
                      separately, so one combined number would be a lie the
                      moment the target is immune to fire. */}
                  {a.extraDamage.map((x) => (
                    <RollChip
                      key={`${x.dice}:${x.damageType ?? ''}`}
                      expr={x.dice}
                      display={`+${x.dice}`}
                      label={damageLabel(a.label, x.damageType)}
                      variant="damage"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Action economy */}
      {sheet.actions.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className={H2}>Actions</h2>
          <p className={HELP}>Tap a name for rules; tap Use / roll to spend it.</p>
          <div className="flex flex-wrap gap-1.5">
            {sheet.actions.map((a) => {
              const info = findFeatureInfo(sheet.features, a.label, a.origin);
              // Limited-use actions share a name with their resource — triggering
              // one spends a use so the pips stay honest.
              const linkedResource = sheet.resources.find(
                (r) => r.label.toLowerCase() === a.label.toLowerCase(),
              );
              const remaining =
                linkedResource !== undefined
                  ? linkedResource.max - usedOf(linkedResource.key)
                  : undefined;
              // Using it marks the right slice of the turn and spends a pip.
              const trigger = () =>
                triggerAction(a.economy, linkedResource?.key, linkedResource?.max, a.label);
              const depleted = remaining === 0;
              // Incapacitating conditions stop actions/bonus actions/reactions.
              const blocked = limits.noActions;
              const economyLabel =
                a.economy === 'bonus'
                  ? 'bonus action'
                  : a.economy === 'reaction'
                    ? 'reaction'
                    : 'action';
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
                        className={`min-h-6 text-left ${RULES} underline-offset-4`}
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
                  // Ink, whatever the economy: green and blue outlines read as
                  // statuses, and colour alone is no way to say which slot an
                  // action spends (DS-001 TurnTracker). The Use button's
                  // title says it.
                  className={`flex flex-col ${FLUSH} px-3 py-1.5`}
                >
                  <span className="flex items-center gap-1.5">
                    {name}
                    {blocked.length > 0 && (
                      <span
                        className="text-guide"
                        title={`${blocked.join(', ')}: you normally can't take ${
                          a.economy === 'action' ? 'an' : 'a'
                        } ${economyLabel}`}
                      >
                        <AlertTriangle size={14} />
                        {/* lucide hides the icon, so without this nothing is read. */}
                        <span className="sr-only">
                          {`${blocked.join(', ')}: you normally can't take ${
                            a.economy === 'action' ? 'an' : 'a'
                          } ${economyLabel}`}
                        </span>
                      </span>
                    )}
                    {a.roll !== undefined ? (
                      <RollChip expr={a.roll} label={a.label} variant="damage" onRolled={trigger} />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Use ${a.label}`}
                        onClick={trigger}
                        disabled={depleted}
                        className="-my-1.5"
                        title={
                          depleted
                            ? 'No uses left'
                            : `Use — marks your ${economyLabel}${
                                linkedResource !== undefined
                                  ? ` and spends a ${linkedResource.label} use`
                                  : ''
                              }`
                        }
                      >
                        Use
                      </Button>
                    )}
                  </span>
                  {mechanics !== '' && (
                    <span className="text-caption text-ink-muted">{mechanics}</span>
                  )}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Passive combat options: things you can always do (Extra Attack,
          Magic Resistance, …) that aren't already a limited-use action chip
          above. Race traits live nested inside the race card, so the collector
          walks named sub-entries too. */}
      {(() => {
        const actionNames = new Set(sheet.actions.map((a) => capabilityKey(a.label)));
        const caps = collectCapabilityCards(sheet.features, actionNames);
        if (caps.length === 0) return null;
        return (
          <section className="flex flex-col gap-1.5">
            <h2 className={H2}>Combat options</h2>
            <p className={HELP}>Things you can always do. Tap for full rules.</p>
            <div className={listClass}>
              {caps.map((cap) => (
                <FeatureInfoSheet
                  key={cap.key}
                  title={cap.name}
                  subtitle={cap.origin}
                  entries={cap.entries}
                  trigger={
                    <button
                      type="button"
                      className="flex min-h-14 flex-col justify-center px-4 py-2 text-left"
                    >
                      <span className={`text-body-strong ${RULES} underline-offset-4`}>
                        {cap.name}
                      </span>
                      <span className="text-caption text-ink-muted">{cap.blurb}</span>
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
        <section key={sc.classUid} className={cardClass}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-heading">{sc.className} spellcasting</span>
            {/* Spell DC in `arcane`, the colour of what spellcasting spends. */}
            <Badge tone="arcane">
              DC <strong>{sc.saveDc.value}</strong> · Atk <strong>{fmt(sc.attackMod.value)}</strong>
            </Badge>
          </div>
          {sc.pactSlots !== undefined && (
            <div className="flex flex-wrap items-center">
              <span className="mr-1.5 text-label text-ink-muted">
                Pact (level {sc.pactSlots.level})
              </span>
              <Pips
                total={sc.pactSlots.count}
                spent={play.pactSlotsSpent}
                onChange={(next) =>
                  update((d) => {
                    d.play.pactSlotsSpent = next;
                  })
                }
                label={(slot) => `Pact slot ${slot}`}
                tone="arcane"
              />
            </div>
          )}
          {scIdx === sheet.spellcasting.findIndex((b) => b.slots.some((n) => n > 0)) && (
            <div className="flex flex-col gap-1">
              {sheet.spellcasting.length > 1 && (
                <span className="text-caption text-ink-muted">Slots (shared across classes)</span>
              )}
              {sc.slots.map((count, lvlIdx) =>
                count > 0 ? (
                  <div key={`slots-${String(lvlIdx)}`} className="flex flex-wrap items-center">
                    <span className="w-8 shrink-0 text-label text-ink-muted">L{lvlIdx + 1}</span>
                    <Pips
                      total={count}
                      spent={play.slotsSpent[lvlIdx] ?? 0}
                      onChange={(next) =>
                        update((d) => {
                          d.play.slotsSpent[lvlIdx] = next;
                        })
                      }
                      label={(slot) => `Level ${lvlIdx + 1} slot ${slot}`}
                      tone="arcane"
                    />
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
              <div className="mt-2 flex flex-col gap-1 border-line border-t pt-2">
                {registrySpells.map((ref) => {
                  const uid = `${ref.name}|${ref.source}`.toLowerCase();
                  const prepared = preparedUids.has(uid);
                  const level = spellLevelOf(ref.name, ref.source);
                  const entity = spellEntity(ref.name, ref.source);
                  const choiceKey = `${sc.classUid}::${uid}`;
                  const { resource, options } = castResourceFor(choiceKey, sc, level);
                  // The dice follow the chosen slot, which is the whole reason
                  // the choice has to come before the roll rather than after it.
                  const rolls = spellRollActions(entity, {
                    characterLevel: sheet.totalLevel,
                    slotLevel: resource.level,
                    abilityModifier: sheet.abilities[sc.ability].mod,
                  });
                  const hasAttack =
                    Array.isArray(entity?.spellAttack) && entity.spellAttack.length > 0;
                  const cast = () => {
                    castSpell(
                      update,
                      sc,
                      level,
                      {
                        name: ref.name,
                        source: ref.source,
                        concentration: spellConcentrationOf(ref.name, ref.source),
                        economy: spellCastEconomy(ref.name, ref.source),
                      },
                      resource,
                    );
                  };
                  return (
                    <div key={uid} className="flex min-h-10 items-center gap-2">
                      <span className="w-6 shrink-0 text-caption text-ink-muted">
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
                            className={`min-w-0 flex-1 truncate text-left ${RULES} underline-offset-2 ${
                              prepared ? '' : 'text-ink-muted'
                            }`}
                          >
                            {ref.name}
                            {prepared && (
                              <span className="ml-1.5 text-caption text-heal">prepared</span>
                            )}
                          </button>
                        }
                      />
                      {limits.noVerbal.length > 0 && spellHasVerbal(ref.name, ref.source) && (
                        <span
                          className="shrink-0 text-guide"
                          title={`${limits.noVerbal.join(', ')}: you can't speak — this spell has a verbal component`}
                        >
                          <AlertTriangle size={14} />
                          <span className="sr-only">
                            {`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                          </span>
                        </span>
                      )}
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                        <CastResourcePicker
                          spellName={ref.name}
                          resource={resource}
                          options={options}
                          block={sc}
                          play={play}
                          pools={sheet.resources}
                          spell={entity}
                          spellLevel={level}
                          characterLevel={sheet.totalLevel}
                          rulesVersion={doc.rulesVersion}
                          classes={doc.classes}
                          onPick={(picked) => chooseCastResource(choiceKey, picked)}
                        />
                        {hasAttack && (
                          <RollChip
                            expr={`1d20${fmt(sc.attackMod.value)}`}
                            display={`Atk ${fmt(sc.attackMod.value)}`}
                            label={`${ref.name} spell attack`}
                            variant="d20"
                            onRolled={cast}
                          />
                        )}
                        {rolls.map((action, index) => (
                          <RollChip
                            key={`${action.expr}:${action.label}`}
                            expr={action.expr}
                            label={action.label}
                            variant={action.variant}
                            onRolled={!hasAttack && index === 0 ? cast : undefined}
                          />
                        ))}
                        {!hasAttack && rolls.length === 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Cast ${ref.name}`}
                            onClick={cast}
                            className="-my-1"
                            title={
                              level === 0
                                ? 'Cast cantrip (marks the action economy its casting time uses)'
                                : resource.kind === 'none'
                                  ? 'Cast with nothing left to spend (marks action economy)'
                                  : `Cast (spends ${castResourceLabel(resource).toLowerCase()})`
                            }
                          >
                            Cast
                          </Button>
                        )}
                      </span>
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
        <section className={cardClass}>
          <div className="mb-1 text-heading">Innate &amp; granted spells</div>
          <div className="flex flex-col gap-1">
            {sheet.grantedSpells.map((g) => {
              const entity = spellEntity(g.name, g.source);
              const level = spellLevelOf(g.name, g.source);
              const block =
                sheet.spellcasting.find((sc) => sc.ability === g.ability) ??
                (g.usage === 'prepared' ? sheet.spellcasting[0] : undefined);
              const abilityModifier =
                g.ability !== undefined ? sheet.abilities[g.ability].mod : undefined;
              const attackModifier =
                abilityModifier !== undefined ? sheet.profBonus.value + abilityModifier : undefined;
              // An always-prepared grant casts with class slots, so it gets the
              // same choose-then-roll picker; an innate grant spends its own
              // pool and has nothing to choose.
              const choiceKey = `granted::${g.name}|${g.source}`;
              const slotChoice =
                g.usage === 'prepared' && block !== undefined
                  ? castResourceFor(choiceKey, block, level)
                  : undefined;
              const resource = slotChoice?.resource;
              const rolls = spellRollActions(entity, {
                characterLevel: sheet.totalLevel,
                slotLevel: resource?.level,
                abilityModifier,
              });
              const hasAttack =
                attackModifier !== undefined &&
                Array.isArray(entity?.spellAttack) &&
                entity.spellAttack.length > 0;
              // "1/day" grants carry their own pool; casting spends from it.
              const limited =
                g.resourceKey !== undefined
                  ? sheet.resources.find((r) => r.key === g.resourceKey)
                  : undefined;
              const remaining =
                limited !== undefined ? limited.max - usedOf(limited.key) : undefined;
              // Rolling dice is always allowed, but a spent grant must not go
              // on marking your action and your concentration: most limited
              // spells cast through a roll chip rather than the Cast button, so
              // guarding only the button would leave the limit unenforced for
              // every one of them.
              const depleted = remaining !== undefined && remaining <= 0;
              const cast = () => {
                if (g.usage === 'prepared' && block !== undefined) {
                  castSpell(
                    update,
                    block,
                    level,
                    {
                      name: g.name,
                      source: g.source,
                      concentration: spellConcentrationOf(g.name, g.source),
                      economy: spellCastEconomy(g.name, g.source),
                    },
                    resource,
                  );
                } else {
                  castGranted(
                    g.name,
                    g.source,
                    limited !== undefined ? { key: limited.key, max: limited.max } : undefined,
                  );
                }
              };
              return (
                <div
                  key={`${g.name}|${g.source}`}
                  className="flex min-h-11 items-center gap-2 border-line border-b py-1.5 last:border-b-0"
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
                        <span className={`truncate capitalize ${RULES} underline-offset-2`}>
                          {g.name}
                        </span>
                        {g.usage === 'prepared' && (
                          <Badge className="shrink-0">Always prepared</Badge>
                        )}
                        {remaining !== undefined && limited !== undefined && (
                          <span
                            title={
                              depleted
                                ? 'No uses left until you rest'
                                : `${g.usage} from ${g.origin}`
                            }
                            // Uses left of an innate spell are magic's to spend,
                            // so `arcane`; spent, a neutral badge.
                            className={`shrink-0 ${badgeClass(depleted ? 'neutral' : 'arcane')}`}
                          >
                            {remaining}/{limited.max} per {g.usage?.split('/')[1]}
                          </span>
                        )}
                      </button>
                    }
                  />
                  <span className="shrink-0 text-caption text-ink-muted">
                    {g.ability !== undefined ? g.ability.toUpperCase() : g.origin}
                  </span>
                  {limits.noVerbal.length > 0 && spellHasVerbal(g.name, g.source) && (
                    <span
                      className="shrink-0 text-guide"
                      title={`${limits.noVerbal.join(', ')}: you can't speak — this spell has a verbal component`}
                    >
                      <AlertTriangle size={14} />
                      <span className="sr-only">
                        {`${limits.noVerbal.join(', ')}: you can't speak, and this spell has a verbal component`}
                      </span>
                    </span>
                  )}
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {slotChoice !== undefined && resource !== undefined && block !== undefined && (
                      <CastResourcePicker
                        spellName={g.name}
                        resource={resource}
                        options={slotChoice.options}
                        block={block}
                        play={play}
                        pools={sheet.resources}
                        spell={entity}
                        spellLevel={level}
                        characterLevel={sheet.totalLevel}
                        rulesVersion={doc.rulesVersion}
                        classes={doc.classes}
                        onPick={(picked) => chooseCastResource(choiceKey, picked)}
                      />
                    )}
                    {hasAttack && (
                      <RollChip
                        expr={`1d20${fmt(attackModifier)}`}
                        display={`Atk ${fmt(attackModifier)}`}
                        label={`${g.name} spell attack`}
                        variant="d20"
                        onRolled={depleted ? undefined : cast}
                      />
                    )}
                    {rolls.map((action, index) => (
                      <RollChip
                        key={`${action.expr}:${action.label}`}
                        expr={action.expr}
                        label={action.label}
                        variant={action.variant}
                        onRolled={!hasAttack && index === 0 && !depleted ? cast : undefined}
                      />
                    ))}
                    {!hasAttack && rolls.length === 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Cast ${g.name}`}
                        onClick={cast}
                        disabled={depleted}
                        className="-my-1"
                        title={
                          depleted
                            ? 'No uses left until you rest'
                            : resource === undefined
                              ? 'Cast (marks action economy and spends the applicable resource)'
                              : resource.kind === 'none'
                                ? 'Cast with nothing left to spend (marks action economy)'
                                : `Cast (spends ${castResourceLabel(resource).toLowerCase()})`
                        }
                      >
                        Cast
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
