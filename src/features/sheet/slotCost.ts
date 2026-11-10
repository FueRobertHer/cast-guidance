/**
 * Paying a feature's cost or buy-back with a spell slot or a Hit Point Die (data
 * function pass item 10): the slots and dice that can pay as the roll prompt's
 * tiles, what a slot's level rolls, and what paying spends. The prompt is the one
 * a spell casts from ("Level at cast" A), so a smite picks its slot as Fireball does.
 */
import type { DerivedSheet, PlayState, SlotDice, SlotPrice } from '@/engine/types';
import type { HeldCast } from '@/stores/heldRoll';
import {
  type CastTile,
  type CastWay,
  castResourceId,
  castResourceLabel,
  ordinal,
  type SlotSpent,
} from './castResources';

/** The shared slot table and the pact slots, from whichever casting class carries them. */
function slotTables(sheet: DerivedSheet) {
  const slots = sheet.spellcasting.find((b) => b.slots.some((n) => n > 0))?.slots ?? [];
  const pact = sheet.spellcasting.find((b) => b.pactSlots !== undefined)?.pactSlots;
  return { slots, pact };
}

/** Each slot that pays `price`, with how many are left: the levels from its lowest up, then the pact slot. */
function slotsFor(
  sheet: DerivedSheet,
  play: PlayState,
  price: SlotPrice,
): Array<{ resource: SlotSpent; left: number; group: 'Spell slots' | 'Pact slots' }> {
  const min = price.minLevel ?? 1;
  const { slots, pact } = slotTables(sheet);
  const out: Array<{ resource: SlotSpent; left: number; group: 'Spell slots' | 'Pact slots' }> = [];
  if (price.pactOnly !== true) {
    for (let level = min; level <= 9; level++) {
      const total = slots[level - 1] ?? 0;
      if (total <= 0) continue;
      const left = Math.max(0, total - (play.slotsSpent[level - 1] ?? 0));
      out.push({ resource: { kind: 'slot', level }, left, group: 'Spell slots' });
    }
  }
  if (pact !== undefined && pact.count > 0 && pact.level >= min) {
    const left = Math.max(0, pact.count - play.pactSlotsSpent);
    out.push({ resource: { kind: 'pact', level: pact.level }, left, group: 'Pact slots' });
  }
  return out;
}

/** The slots that pay `price`, as the prompt's tiles, spent ones kept and marked. */
export function slotWays(sheet: DerivedSheet, play: PlayState, price: SlotPrice): CastWay[] {
  const out: CastWay[] = [];
  for (const { resource, left, group } of slotsFor(sheet, play, price)) {
    const tile: CastTile = { resource, ok: left > 0, sub: `${String(left)} left` };
    const way = out.find((w) => w.title === group);
    if (way !== undefined) way.tiles.push(tile);
    else out.push({ title: group, tiles: [tile] });
  }
  return out;
}

/** How many slots are left that pay `price`. */
export function slotsLeftFor(sheet: DerivedSheet, play: PlayState, price: SlotPrice): number {
  return slotsFor(sheet, play, price).reduce((n, s) => n + s.left, 0);
}

/** Can the slot be spent now? A tap that beat the last render must not spend one already gone. */
export function slotLeft(sheet: DerivedSheet, play: PlayState, resource: SlotSpent): boolean {
  const { slots, pact } = slotTables(sheet);
  if (resource.kind === 'pact') return pact !== undefined && play.pactSlotsSpent < pact.count;
  return (play.slotsSpent[resource.level - 1] ?? 0) < (slots[resource.level - 1] ?? 0);
}

/** The dice a slot of `level` rolls: `base` plus one a level, up to `maxDice`. */
export function slotDiceAt(dice: SlotDice, level: number): string {
  const count = Math.min(dice.maxDice ?? Number.POSITIVE_INFINITY, dice.base + level);
  return `${String(count)}d${String(dice.die)}`;
}

/** A price in words: "a spell slot", "a level 5+ spell slot", "a Pact Magic slot". */
export function slotPriceWords(price: SlotPrice): string {
  if (price.pactOnly === true) {
    return (price.minLevel ?? 1) > 1
      ? `a level ${String(price.minLevel)}+ Pact Magic slot`
      : 'a Pact Magic slot';
  }
  return (price.minLevel ?? 1) > 1
    ? `a level ${String(price.minLevel)}+ spell slot`
    : 'a spell slot';
}

function slotNote(resource: SlotSpent | undefined): string {
  if (resource === undefined) return 'No slot left that pays for it.';
  return resource.kind === 'pact'
    ? `Spends a pact slot (${ordinal(resource.level)} level).`
    : `Spends a ${ordinal(resource.level)}-level slot.`;
}

/** What paying with a slot needs to know. */
export interface SlotPlan {
  /** The row it is paid from, so that row alone refreshes it. */
  id: string;
  /** The feature, as the prompt names it. */
  title: string;
  /** What the prompt's button does: Use for a cost, Restore for a buy-back. */
  verb: 'Use' | 'Restore';
  sheet: DerivedSheet;
  play: PlayState;
  price: SlotPrice;
  dice?: SlotDice | undefined;
  /** Did the attack this damage goes with crit? Asked as it rolls, when the prompt has gone. */
  crit?: () => boolean;
  /** Spends the slot picked and what goes with it. */
  pay: (resource: SlotSpent) => void;
}

/** The prompt's way to pay with a slot: a tile a level, starting on the lowest that can pay. */
export function slotPlan(p: SlotPlan): HeldCast {
  const ways = slotWays(p.sheet, p.play, p.price);
  const tiles = ways.flatMap((w) => w.tiles);
  const resourceOf = (id: string | null): SlotSpent | undefined => {
    const r = tiles.find((t) => t.ok && castResourceId(t.resource) === id)?.resource;
    return r?.kind === 'slot' || r?.kind === 'pact' ? r : undefined;
  };
  const start = tiles.find((t) => t.ok);
  const { dice } = p;
  return {
    id: p.id,
    spell: p.title,
    verb: p.verb,
    groups: ways.map((w) => ({
      title: w.title,
      sub: w.sub,
      tiles: w.tiles.map((t) => ({
        id: castResourceId(t.resource),
        head: ordinal(t.resource.level),
        sub: t.sub,
        ok: t.ok,
        aria: `${castResourceLabel(t.resource)}, ${t.sub}${t.ok ? '' : ', cannot pay now'}`,
      })),
    })),
    picked: start === undefined ? null : castResourceId(start.resource),
    note: (id) => slotNote(resourceOf(id)),
    dice: (id) => {
      const r = resourceOf(id);
      if (r === undefined || dice === undefined) return undefined;
      const kind = dice.heals === true ? 'heal' : dice.plain === true ? undefined : 'damage';
      return {
        expr: slotDiceAt(dice, r.level),
        label: p.title,
        kind,
        ...(kind === 'damage' && p.crit?.() === true ? { crit: true } : {}),
      };
    },
    line: (id) => {
      const r = resourceOf(id);
      if (r === undefined) return undefined;
      const at = `${ordinal(r.level)} level`;
      if (dice === undefined) return at;
      return `${at}: ${slotDiceAt(dice, r.level)}${dice.plus === undefined ? '' : ` + ${dice.plus}`}`;
    },
    cast: (id) => {
      const r = resourceOf(id);
      if (r !== undefined) p.pay(r);
    },
  };
}

/** The Hit Point Dice left, by size: "d10" to 3. Largest first, as a long rest gives them back. */
export function hitDiceLeft(
  sheet: DerivedSheet,
  play: PlayState,
): Array<{ die: string; left: number }> {
  return Object.entries(sheet.hitDice)
    .map(([die, total]) => ({ die, left: Math.max(0, total - (play.hitDiceSpent[die] ?? 0)) }))
    .sort((a, b) => Number(b.die.slice(1)) - Number(a.die.slice(1)));
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${String(n)}`;

/** The roll a Hit Point Die heals by: the die, plus the Constitution modifier when the feature says so. */
export function hitDieRoll(die: string, heals: 'roll' | 'rollPlusCon', conMod: number): string {
  return heals === 'rollPlusCon' ? `1${die}${signed(conMod)}` : `1${die}`;
}

/** What paying with a Hit Point Die needs to know. */
export interface HitDiePlan {
  id: string;
  title: string;
  sheet: DerivedSheet;
  play: PlayState;
  heals: 'roll' | 'rollPlusCon';
  conMod: number;
  /** Spends the die picked and what goes with it. */
  pay: (die: string) => void;
}

/** The prompt's way to pay with a Hit Point Die, when there is more than one size: a tile a size. */
export function hitDiePlan(p: HitDiePlan): HeldCast {
  const sizes = hitDiceLeft(p.sheet, p.play);
  const ok = (id: string | null) => sizes.some((s) => s.die === id && s.left > 0);
  const start = sizes.find((s) => s.left > 0);
  return {
    id: p.id,
    spell: p.title,
    verb: 'Use',
    groups: [
      {
        title: 'Hit Point Dice',
        tiles: sizes.map((s) => ({
          id: s.die,
          head: s.die,
          sub: `${String(s.left)} left`,
          ok: s.left > 0,
          aria: `${s.die} Hit Point Die, ${String(s.left)} left${s.left > 0 ? '' : ', cannot pay now'}`,
        })),
      },
    ],
    picked: start === undefined ? null : start.die,
    note: (id) =>
      id !== null && ok(id) ? `Spends a ${id} Hit Point Die.` : 'No Hit Point Die left.',
    dice: (id) =>
      id !== null && ok(id)
        ? { expr: hitDieRoll(id, p.heals, p.conMod), label: p.title, kind: 'heal' }
        : undefined,
    line: () => undefined,
    cast: (id) => {
      if (id !== null && ok(id)) p.pay(id);
    },
  };
}
