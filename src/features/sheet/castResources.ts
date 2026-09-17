import type { Entity } from '@/data5e/copyMod';
import type { DerivedResource, PlayState, SpellcastingBlock } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { spellRollActions } from './spellRolls';

export interface CastSpellInfo {
  name: string;
  source: string;
  concentration?: boolean;
  /** Which slice of the turn casting uses (from the spell's casting time). */
  economy?: 'action' | 'bonus' | 'reaction';
}

/**
 * What a cast spends. `pool` is a non-slot point pool converted into a slot
 * (sorcery points are the shipped case), and carries the price so the spend and
 * the label both read it from one place.
 */
export type CastResource =
  | { kind: 'cantrip'; level: 0 }
  | { kind: 'pact'; level: number }
  | { kind: 'slot'; level: number }
  | { kind: 'pool'; level: number; key: string; label: string; cost: number }
  | { kind: 'none'; level: number };

/**
 * Point pools that convert into a spell slot: what a slot of each level costs
 * (index 0 = a level-1 slot) and which slice of the turn converting takes.
 * Sorcery points (Font of Magic's "Creating Spell Slots" / 2024 "Create Spell
 * Slot") are the only conversion the shipped data grants; the table is keyed by
 * derived-resource key, so another pool needs a row here and a label that reads
 * sensibly as initials on the chip.
 *
 * The costs and the 5th-level ceiling are the same in both editions. What is
 * NOT modelled: 2024 added a minimum-Sorcerer-level column to the same table,
 * so a 2024 sorcerer can be offered a slot level they are too low to create
 * (the points alone gate it here). Offering it is the lesser error under
 * guidance-not-gatekeeping, but it is an unlabelled one.
 */
interface SlotConversion {
  costs: readonly number[];
  economy: 'action' | 'bonus';
}

const SLOT_CONVERSIONS: Record<string, SlotConversion> = {
  'sorcery-points': { costs: [2, 3, 5, 6, 7], economy: 'bonus' },
};

/** Which slice of the turn converting `key` into a slot takes, if it converts. */
export function conversionEconomy(key: string): 'action' | 'bonus' | undefined {
  return SLOT_CONVERSIONS[key]?.economy;
}

/** Which slice of the turn a spell's own casting time uses (undefined for rituals). */
export function castingEconomy(
  entity: Entity | undefined,
): 'action' | 'bonus' | 'reaction' | undefined {
  const unit = Array.isArray(entity?.time)
    ? String((entity.time[0] as { unit?: unknown })?.unit ?? '')
    : '';
  return unit === 'bonus' || unit === 'reaction' || unit === 'action' ? unit : undefined;
}

/** Preview the resource the current automatic cast path will consume. */
export function nextCastResource(
  block: SpellcastingBlock,
  play: PlayState,
  spellLevel: number,
): CastResource {
  if (spellLevel === 0) return { kind: 'cantrip', level: 0 };
  if (
    block.pactSlots !== undefined &&
    block.pactSlots.level >= spellLevel &&
    play.pactSlotsSpent < block.pactSlots.count
  ) {
    return { kind: 'pact', level: block.pactSlots.level };
  }
  for (let level = spellLevel; level <= 9; level++) {
    const total = block.slots[level - 1] ?? 0;
    const spent = play.slotsSpent[level - 1] ?? 0;
    if (total > 0 && spent < total) return { kind: 'slot', level };
  }
  return { kind: 'none', level: spellLevel };
}

/** How many points of a pool are left to spend. */
function poolRemaining(pool: DerivedResource, play: PlayState): number {
  return pool.max - (play.resources.find((r) => r.key === pool.key)?.used ?? 0);
}

/**
 * Every convertible pool the character could turn into a slot of `spellLevel`
 * or higher, ascending by slot level within each pool (GAME-001: non-slot pools
 * as first-class cast sources). A conversion is offered whenever the points are
 * there. Having an ordinary slot left does not hide it, because spending
 * points to keep a slot is a real choice the player gets to make.
 */
export function poolCastResources(
  pools: readonly DerivedResource[],
  play: PlayState,
  spellLevel: number,
): CastResource[] {
  if (spellLevel === 0) return [];
  const out: CastResource[] = [];
  for (const pool of pools) {
    const conversion = SLOT_CONVERSIONS[pool.key];
    if (conversion === undefined) continue;
    const left = poolRemaining(pool, play);
    for (let level = spellLevel; level <= conversion.costs.length; level++) {
      const cost = conversion.costs[level - 1];
      if (cost === undefined || cost > left) continue;
      out.push({ kind: 'pool', level, key: pool.key, label: pool.label, cost });
    }
  }
  return out;
}

/**
 * Every resource the character could spend on a spell of `spellLevel` — the
 * whole upcast ladder, not just the lowest — so the UI can offer an explicit
 * choice (GAME-001). Slot levels ascending, then the pact pool, then any
 * point-pool conversions. Empty for a cantrip or when nothing castable remains.
 */
export function availableCastResources(
  block: SpellcastingBlock,
  play: PlayState,
  spellLevel: number,
  pools: readonly DerivedResource[] = [],
): CastResource[] {
  if (spellLevel === 0) return [];
  const out: CastResource[] = [];
  for (let level = spellLevel; level <= 9; level++) {
    const total = block.slots[level - 1] ?? 0;
    const spent = play.slotsSpent[level - 1] ?? 0;
    if (total > 0 && spent < total) out.push({ kind: 'slot', level });
  }
  if (
    block.pactSlots !== undefined &&
    block.pactSlots.level >= spellLevel &&
    play.pactSlotsSpent < block.pactSlots.count
  ) {
    out.push({ kind: 'pact', level: block.pactSlots.level });
  }
  out.push(...poolCastResources(pools, play, spellLevel));
  return out;
}

/**
 * What an unchosen cast spends: the automatic pick, or, when slots and pact
 * magic are exhausted and only a conversion is left, the first offered option,
 * so a pool that can pay is never passed over for a "no slot" cast. Automatic
 * casting still never reaches past slots into a pool while a slot remains.
 */
export function defaultCastResource(
  block: SpellcastingBlock,
  play: PlayState,
  spellLevel: number,
  pools: readonly DerivedResource[] = [],
  /** The options for this same cast, when the caller has already built them. */
  options?: readonly CastResource[],
): CastResource {
  const auto = nextCastResource(block, play, spellLevel);
  if (auto.kind !== 'none') return auto;
  return (options ?? availableCastResources(block, play, spellLevel, pools))[0] ?? auto;
}

/**
 * Does this cast need to ask, or can it just happen? More than one option is a
 * decision. A lone pool conversion is one too: it is the only single option
 * that spends something the player was not already resigned to spending (points
 * plus a slice of the turn), so it gets said out loud rather than taken.
 */
export function needsCastChoice(options: readonly CastResource[]): boolean {
  return options.length > 1 || options[0]?.kind === 'pool';
}

/** Stable option id for the cast chooser; must round-trip through askChoice. */
export function castResourceId(resource: CastResource): string {
  if (resource.kind === 'pact') return 'pact';
  if (resource.kind === 'pool') return `pool-${resource.key}-${String(resource.level)}`;
  return `${resource.kind}-${String(resource.level)}`;
}

/** Spoken form, for a chooser row or a control's accessible name. */
export function castResourceLabel(resource: CastResource): string {
  switch (resource.kind) {
    case 'cantrip':
      return 'Cantrip (no slot)';
    case 'pact':
      return `Pact slot · level ${String(resource.level)}`;
    case 'slot':
      return `Level ${String(resource.level)} slot`;
    case 'pool':
      return `Level ${String(resource.level)} slot from ${resource.label}`;
    case 'none':
      return 'No slot left';
  }
}

/** Initials of a pool's label ("Sorcery Points" -> "SP") for the compact chip. */
function initials(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}

/**
 * Compact text for the inline chip that shows what the next cast will spend.
 * Never icon-only and never color-only: the source is spelled out in the chip's
 * own accessible name via `castResourceLabel`.
 */
export function castResourceChipLabel(resource: CastResource): string {
  switch (resource.kind) {
    case 'cantrip':
      return 'cantrip';
    case 'pact':
      return `L${String(resource.level)} pact`;
    case 'slot':
      return `L${String(resource.level)}`;
    case 'pool':
      return `L${String(resource.level)} ${initials(resource.label)}`;
    case 'none':
      return 'no slot';
  }
}

export interface CastContext {
  block: SpellcastingBlock;
  play: PlayState;
  /** Derived pools, so a convertible one can be priced against what is left. */
  pools?: readonly DerivedResource[];
  spell?: Entity;
  spellLevel: number;
  characterLevel: number;
}

/**
 * Chooser rows for `askChoice`: what each option spends, how much of it is
 * left, and what the spell's dice become at that level. Pure, so the wording
 * the Play tab and the spell manager offer is the same wording under test.
 */
export function castResourceOptions(
  options: readonly CastResource[],
  ctx: CastContext,
): Array<{ id: string; label: string; hint: string }> {
  return options.map((option) => {
    const upcast = option.level > ctx.spellLevel ? ' (upcast)' : '';
    const effect = upcastEffectSummary(ctx.spell, ctx.characterLevel, option.level);
    const parts: string[] = [];
    if (effect !== undefined) parts.push(effect);
    if (option.kind === 'pool') {
      const pool = ctx.pools?.find((p) => p.key === option.key);
      const left = pool === undefined ? undefined : poolRemaining(pool, ctx.play);
      const economy = conversionEconomy(option.key) ?? 'action';
      // Converting takes its own slice of the turn. When the spell's casting
      // time wants that same slice, the turn tracker has one flag for both and
      // cannot show the second, so the option says so rather than letting the
      // cast read as legal on a turn that could not hold it.
      const clash = castingEconomy(ctx.spell) === economy;
      const convert = `${economy === 'bonus' ? 'Bonus Action' : 'Action'} to convert`;
      parts.push(
        `${String(option.cost)} points${left === undefined ? '' : ` of ${String(left)}`} · ${convert}${clash ? ", on top of the spell's own" : ''}`,
      );
    } else if (option.kind === 'pact') {
      const left = (ctx.block.pactSlots?.count ?? 0) - ctx.play.pactSlotsSpent;
      parts.push(`${String(left)} left`);
    } else if (option.kind === 'slot') {
      const left =
        (ctx.block.slots[option.level - 1] ?? 0) - (ctx.play.slotsSpent[option.level - 1] ?? 0);
      parts.push(`${String(left)} left`);
    }
    return {
      id: castResourceId(option),
      label: `${castResourceLabel(option)}${upcast}`,
      hint: parts.join(' · '),
    };
  });
}

/**
 * A one-line preview of a spell's rolled dice when cast at `slotLevel`, so the
 * upcast chooser can show e.g. Fireball "8d6" at level 3 vs "9d6" at level 4, or
 * Ice Knife "1d10 / 3d6" (the cold die scales). Ability modifiers are left out —
 * the dice are the point. Returns undefined when there's nothing rolled, and —
 * crucially — also for an upcast whose dice are unchanged from the base level
 * (e.g. Magic Missile / Scorching Ray add darts/rays, not dice), so the preview
 * never implies a bigger die that upcasting doesn't actually grant.
 */
export function upcastEffectSummary(
  entity: Entity | undefined,
  characterLevel: number,
  slotLevel: number,
): string | undefined {
  const rollExprs = (level: number) =>
    spellRollActions(entity, { characterLevel, slotLevel: level })
      .filter((a) => a.variant === 'damage' || a.variant === 'dice')
      .map((a) => a.expr);
  const atSlot = rollExprs(slotLevel);
  if (atSlot.length === 0) return undefined;
  const baseLevel = typeof entity?.level === 'number' ? entity.level : slotLevel;
  if (slotLevel > baseLevel && atSlot.join('+') === rollExprs(baseLevel).join('+')) {
    return undefined; // upcast changes targets/instances, not dice — show no dice
  }
  return atSlot.join(' / ');
}

/**
 * Cast a spell, spending `resource` when given (an explicit slot/upcast/pool
 * choice) or else the lowest available slot ≥ `level` (pact-aware). Marks the
 * action economy the casting time uses and, when the spell concentrates, it
 * becomes the active concentration (dropping any prior one — one at a time).
 */
export function castSpell(
  update: DocUpdater,
  block: SpellcastingBlock,
  level: number,
  spell?: CastSpellInfo,
  resource?: CastResource,
): void {
  // Which resource actually paid for it is only known inside the recipe, so the
  // history label is resolved afterwards (see DocUpdater).
  let spent: CastResource | undefined;
  update(
    (d) => {
      if (spell?.concentration === true) {
        d.play.concentratingOn = { label: spell.name };
      }
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      let turnUsed = false;
      if (spell?.economy !== undefined) {
        turn[spell.economy] = true;
        turnUsed = true;
      }
      const spend = resource ?? nextCastResource(block, d.play, level);
      spent = spend;
      if (spend.kind === 'pool') {
        // Converting points into the slot takes its own slice of the turn, so
        // the cast costs that as well as the spell's own economy. Both land on
        // one flag when they want the same slice; the chooser says so.
        turn[conversionEconomy(spend.key) ?? 'action'] = true;
        turnUsed = true;
        const entry = d.play.resources.find((r) => r.key === spend.key);
        if (entry !== undefined) entry.used += spend.cost;
        else d.play.resources.push({ key: spend.key, used: spend.cost });
      } else if (spend.kind === 'pact') {
        d.play.pactSlotsSpent += 1;
      } else if (spend.kind === 'slot') {
        const at = d.play.slotsSpent[spend.level - 1] ?? 0;
        d.play.slotsSpent[spend.level - 1] = at + 1;
      }
      if (turnUsed) d.play.turn = turn;
    },
    spell === undefined ? undefined : () => `Cast ${spell.name}${castCost(spent, level)}`,
  );
}

/** " (L3)" / " (pact slot)" / " (no slot)" / "", when it isn't the obvious cost. */
export function castCost(spent: CastResource | undefined, level: number): string {
  if (spent === undefined) return '';
  if (spent.kind === 'pact') return ' (pact slot)';
  // Which pool paid is always news, even at the spell's own level.
  if (spent.kind === 'pool') {
    return ` (L${String(spent.level)} from ${String(spent.cost)} ${spent.label})`;
  }
  // Casting with nothing left to spend is deliberate but must not read the same
  // as a paid cast, since the explicit label replaces the diff that would show it.
  if (spent.kind === 'none') return ' (no slot)';
  // An upcast is news; paying the spell's own level is not.
  if (spent.kind === 'slot' && spent.level !== level) return ` (L${String(spent.level)})`;
  return '';
}
