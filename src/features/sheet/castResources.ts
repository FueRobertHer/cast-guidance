import type { Entity } from '@/data5e/copyMod';
import type { RulesVersion } from '@/data5e/rulesVersion';
import { type HpLimits, setConcentration } from '@/engine/effectLife';
import type {
  ClassLevelEntry,
  DerivedResource,
  PlayState,
  SpellcastingBlock,
} from '@/engine/types';
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
 * the label both read it from one place. `arcanum` is a warlock's Mystic
 * Arcanum at the spell's own level: no slot, once per long rest. `uses` is one
 * use of an innate or feat grant's own pool (Infernal Legacy's Hellish
 * Rebuke), and `charges` an item's charges (`ITEM_CHARGES`), `cost` of them.
 */
export type CastResource =
  | { kind: 'cantrip'; level: 0 }
  | { kind: 'arcanum'; level: number }
  | { kind: 'pact'; level: number }
  | { kind: 'slot'; level: number }
  | { kind: 'pool'; level: number; key: string; label: string; cost: number }
  | { kind: 'uses'; level: number; key: string; label: string }
  | { kind: 'charges'; level: number; key: string; label: string; cost: number }
  | { kind: 'none'; level: number };

/**
 * Is the Mystic Arcanum at this spell level the class's, and still unused
 * since the last long rest? One use per level, the rule as written: a second
 * pick at the same level (flagged, allowed) shares it.
 */
function arcanumReady(block: SpellcastingBlock, play: PlayState, spellLevel: number): boolean {
  return (
    block.mysticArcanum?.includes(spellLevel) === true &&
    play.arcanumUsed?.includes(spellLevel) !== true
  );
}

/**
 * Mark the Mystic Arcanum at `level` used or regained. The list stays sorted
 * and goes away when empty, so a character that never casts one, or has just
 * rested, saves exactly as it did before arcana were tracked.
 */
export function setArcanumUsed(play: PlayState, level: number, used: boolean): void {
  const others = (play.arcanumUsed ?? []).filter((l) => l !== level);
  const next = used ? [...others, level].sort((a, b) => a - b) : others;
  if (next.length > 0) play.arcanumUsed = next;
  else delete play.arcanumUsed;
}

interface SlotConversion {
  /** Index 0 = what a level-1 slot costs. */
  costs: readonly number[];
  /** Which slice of the turn converting takes. */
  economy: 'action' | 'bonus';
  /**
   * 2024 only: the class whose level gates each slot level, and the minimum
   * level per slot (index 0 = a level-1 slot).
   */
  minLevel2024?: { className: string; levels: readonly number[] };
}

/**
 * Point pools that convert into a spell slot. Sorcery points (Font of Magic's
 * "Creating Spell Slots" / 2024 "Create Spell Slot") are the only conversion
 * the shipped data grants; the table is keyed by derived-resource key, so
 * another pool needs a row here and a label that reads sensibly as initials on
 * the chip.
 *
 * The costs and the 5th-level ceiling are the same in both editions. 2024
 * added a minimum-Sorcerer-level column to the same table (GAME-008). It is a
 * note on the option, not a gate: the option stays offered under
 * guidance-not-gatekeeping, and now says what level it needs. 2014 has no
 * such column, so a 2014 character sees no note.
 */
const SLOT_CONVERSIONS: Record<string, SlotConversion> = {
  'sorcery-points': {
    costs: [2, 3, 5, 6, 7],
    economy: 'bonus',
    minLevel2024: { className: 'Sorcerer', levels: [2, 3, 5, 7, 9] },
  },
};

/** Which slice of the turn converting `key` into a slot takes, if it converts. */
function conversionEconomy(key: string): 'action' | 'bonus' | undefined {
  return SLOT_CONVERSIONS[key]?.economy;
}

const ECONOMY_LABEL = { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction' } as const;

/**
 * Why converting might not fit in the turn this cast happens on, or undefined
 * when it fits. The turn tracker is one flag per slice, so it cannot record a
 * second Bonus Action or one taken on somebody else's turn; rather than let a
 * cast read as a legal turn that no turn could hold, the option says what is
 * wrong and stays pressable (guidance, not gatekeeping).
 */
function conversionTurnNote(
  economy: 'action' | 'bonus',
  spell: Entity | undefined,
  play: PlayState,
): string | undefined {
  const slice = ECONOMY_LABEL[economy];
  const own = castingEconomy(spell);
  // A reaction is cast on another creature's turn, where you have neither.
  if (own === 'reaction') return `no ${slice} on another creature's turn`;
  if (own === economy) return "on top of the spell's own";
  if (play.turn?.[economy] === true) return `your ${slice} is already used`;
  return undefined;
}

/**
 * What class level a 2024 conversion into a `slotLevel` slot needs, when the
 * character is below it; undefined when it is met, when the rules are 2014, or
 * when the character has none of the gating class (nothing to measure, so
 * nothing is said rather than every row being labelled).
 */
function conversionLevelNote(key: string, slotLevel: number, ctx: CastContext): string | undefined {
  const gate = SLOT_CONVERSIONS[key]?.minLevel2024;
  if (ctx.rulesVersion !== '2024' || gate === undefined) return undefined;
  const needed = gate.levels[slotLevel - 1];
  if (needed === undefined) return undefined;
  const entry = ctx.classes.find(
    (c) => String(c.ref.name).toLowerCase() === gate.className.toLowerCase(),
  );
  // An unreadable level (an imported doc) is nothing to measure either.
  if (entry === undefined || !Number.isFinite(entry.levels)) return undefined;
  return entry.levels < needed ? `2024: needs ${gate.className} ${String(needed)}` : undefined;
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

/**
 * The lowest slot (pact first) a cast would reach for on its own, or `none`
 * when every slot is gone. An unused Mystic Arcanum comes before any slot,
 * since it costs nothing a slot could pay for. This is the automatic pick
 * alone: it never reaches into a convertible pool, so it is not the whole of
 * what an unchosen cast spends: see `defaultCastResource`, which is what the
 * UI resolves against. With no class (an innate grant) there is no slot to
 * reach for, so it is `none`.
 */
export function nextCastResource(
  block: SpellcastingBlock | undefined,
  play: PlayState,
  spellLevel: number,
): CastResource {
  if (block === undefined) return { kind: 'none', level: spellLevel };
  if (spellLevel === 0) return { kind: 'cantrip', level: 0 };
  if (arcanumReady(block, play, spellLevel)) return { kind: 'arcanum', level: spellLevel };
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
    // The sheet cannot tell which points are gone, so it assumes the locked ones went first.
    const left = Math.min(poolRemaining(pool, play), pool.max - (pool.noSlotConversion ?? 0));
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
 * choice (GAME-001). An unused Mystic Arcanum first, then slot levels
 * ascending, then the pact pool, then any point-pool conversions. Empty for a
 * cantrip or when nothing castable remains.
 */
export function availableCastResources(
  block: SpellcastingBlock,
  play: PlayState,
  spellLevel: number,
  pools: readonly DerivedResource[] = [],
): CastResource[] {
  if (spellLevel === 0) return [];
  const out: CastResource[] = [];
  if (arcanumReady(block, play, spellLevel)) out.push({ kind: 'arcanum', level: spellLevel });
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

/** Stable id for one way to cast: a tile in the cast prompt. */
export function castResourceId(resource: CastResource): string {
  if (resource.kind === 'pact') return 'pact';
  if (resource.kind === 'pool' || resource.kind === 'charges') {
    return `${resource.kind}-${resource.key}-${String(resource.level)}`;
  }
  if (resource.kind === 'uses') return `uses-${resource.key}`;
  return `${resource.kind}-${String(resource.level)}`;
}

/** Spoken form, for a tile's or a control's accessible name. */
export function castResourceLabel(resource: CastResource): string {
  switch (resource.kind) {
    case 'cantrip':
      return 'Cantrip (no slot)';
    case 'arcanum':
      return `Mystic Arcanum · level ${String(resource.level)}`;
    case 'pact':
      return `Pact slot · level ${String(resource.level)}`;
    case 'slot':
      return `Level ${String(resource.level)} slot`;
    case 'pool':
      return `Level ${String(resource.level)} slot from ${resource.label}`;
    case 'uses':
      return `${resource.label} · level ${String(resource.level)}`;
    case 'charges':
      return `Level ${String(resource.level)} from ${resource.label}`;
    case 'none':
      return 'No slot left';
  }
}

export interface CastContext {
  /** The class whose slots it casts with; none for an innate grant or an item alone. */
  block?: SpellcastingBlock | undefined;
  play: PlayState;
  /** Derived pools, so a convertible one can be priced against what is left. */
  pools?: readonly DerivedResource[];
  spell?: Entity;
  spellLevel: number;
  characterLevel: number;
  /** For limits only one edition has (GAME-008). */
  rulesVersion: RulesVersion;
  /** The character's classes, so a level-gated conversion can say which level it needs. */
  classes: readonly ClassLevelEntry[];
}

/** An innate or feat grant's pool that casts this spell once a use (Infernal Legacy). */
export interface UseWay {
  key: string;
  /** Where it comes from: the group's heading and what the note names. */
  label: string;
  max: number;
}

/** A carried item whose charges cast this spell, and what each level costs. */
export interface ChargeWay {
  key: string;
  /** The item's name. */
  label: string;
  max: number;
  costs: ReadonlyArray<{ level: number; cost: number }>;
}

/** One way to cast, as a tile: what it spends, whether it can pay now, and what is under its level. */
export interface CastTile {
  resource: CastResource;
  ok: boolean;
  /** What is left, or what it costs: "2 left", "3 points", "2 charges". */
  sub: string;
}

/** The tiles of one source, under a heading: "Spell slots", "Staff of Healing". */
export interface CastWay {
  title: string;
  /** What the heading adds: "1 charge a level · 7 left", "Bonus Action to convert". */
  sub?: string;
  tiles: CastTile[];
}

const plural = (n: number, one: string) => `${String(n)} ${one}${n === 1 ? '' : 's'}`;

/** How many of a pool are left to spend, by its key. */
function leftOf(play: PlayState, key: string, max: number): number {
  return Math.max(0, max - (play.resources.find((r) => r.key === key)?.used ?? 0));
}

/**
 * Every way to cast a spell of `ctx.spellLevel` right now, grouped by source
 * for the cast prompt (the rolls canvas, "Every way to cast" A): an unused
 * Mystic Arcanum, slots by level from the spell's own up, the pact slot, a
 * point pool's conversions, an innate grant's uses, and items' charges. A
 * source with nothing left keeps its tiles, spent (`ok` false), so the prompt
 * says what is gone rather than hiding it. Empty for a cantrip.
 */
export function castWays(
  ctx: CastContext,
  extra: { uses?: readonly UseWay[]; charges?: readonly ChargeWay[] } = {},
): CastWay[] {
  const { block, play, spellLevel } = ctx;
  if (spellLevel === 0) return [];
  const out: CastWay[] = [];
  if (block?.mysticArcanum?.includes(spellLevel) === true) {
    const ok = arcanumReady(block, play, spellLevel);
    out.push({
      title: 'Mystic Arcanum',
      sub: 'once per long rest',
      tiles: [{ resource: { kind: 'arcanum', level: spellLevel }, ok, sub: ok ? 'ready' : 'used' }],
    });
  }
  if (block !== undefined) {
    const slots: CastTile[] = [];
    for (let level = spellLevel; level <= 9; level++) {
      const total = block.slots[level - 1] ?? 0;
      if (total <= 0) continue;
      const left = Math.max(0, total - (play.slotsSpent[level - 1] ?? 0));
      slots.push({ resource: { kind: 'slot', level }, ok: left > 0, sub: `${String(left)} left` });
    }
    if (slots.length > 0) out.push({ title: 'Spell slots', tiles: slots });
    const pact = block.pactSlots;
    if (pact !== undefined && pact.level >= spellLevel) {
      const left = Math.max(0, pact.count - play.pactSlotsSpent);
      out.push({
        title: 'Pact slots',
        tiles: [
          {
            resource: { kind: 'pact', level: pact.level },
            ok: left > 0,
            sub: `${String(left)} left`,
          },
        ],
      });
    }
    for (const pool of ctx.pools ?? []) {
      const conversion = SLOT_CONVERSIONS[pool.key];
      if (conversion === undefined) continue;
      // The sheet cannot tell which points are gone, so it assumes the locked ones went first.
      const left = Math.min(poolRemaining(pool, play), pool.max - (pool.noSlotConversion ?? 0));
      const tiles: CastTile[] = [];
      for (let level = spellLevel; level <= conversion.costs.length; level++) {
        const cost = conversion.costs[level - 1];
        if (cost === undefined) continue;
        tiles.push({
          resource: { kind: 'pool', level, key: pool.key, label: pool.label, cost },
          ok: cost <= left,
          sub: `${String(cost)} points`,
        });
      }
      if (tiles.length > 0) {
        out.push({
          title: pool.label,
          sub: `${String(poolRemaining(pool, play))} left · ${ECONOMY_LABEL[conversion.economy]} to convert`,
          tiles,
        });
      }
    }
  }
  for (const use of extra.uses ?? []) {
    const left = leftOf(play, use.key, use.max);
    out.push({
      title: use.label,
      tiles: [
        {
          resource: { kind: 'uses', level: spellLevel, key: use.key, label: use.label },
          ok: left > 0,
          sub: `${String(left)} left`,
        },
      ],
    });
  }
  for (const item of extra.charges ?? []) {
    const left = leftOf(play, item.key, item.max);
    const perLevel = item.costs.length > 1;
    const first = item.costs[0];
    if (first === undefined) continue;
    out.push({
      title: item.label,
      sub: `${perLevel ? '1 charge a level · ' : ''}${String(left)} of ${String(item.max)} left`,
      tiles: item.costs.map(({ level, cost }) => ({
        resource: { kind: 'charges', level, key: item.key, label: item.label, cost },
        ok: cost <= left,
        sub: plural(cost, 'charge'),
      })),
    });
  }
  return out;
}

/**
 * The tile a cast starts on: what an unchosen cast has always spent (an unused
 * arcanum, the pact slot, else the lowest slot), or, with all of those gone,
 * the first way left that can pay (a conversion, a use, an item's charges).
 * Undefined when nothing can, so the cast spends nothing.
 */
export function defaultCastTile(ways: readonly CastWay[], ctx: CastContext): CastTile | undefined {
  const tiles = ways.flatMap((w) => w.tiles);
  if (ctx.block !== undefined) {
    const auto = nextCastResource(ctx.block, ctx.play, ctx.spellLevel);
    const id = castResourceId(auto);
    const found = tiles.find((t) => t.ok && castResourceId(t.resource) === id);
    if (found !== undefined) return found;
  }
  return tiles.find((t) => t.ok);
}

/** "1st", "2nd", "3rd", "4th": a level as a tile says it. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${String(n)}th`;
  return `${String(n)}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * The note beside Roll for a way to cast: what casting spends, in words, and
 * what converting points costs the turn or needs of the character. Nothing
 * left to spend says so, since the cast then marks only the turn.
 */
export function castNote(resource: CastResource | undefined, ctx: CastContext): string {
  if (resource === undefined || resource.kind === 'none') {
    return 'Nothing left to spend: it marks only your turn.';
  }
  switch (resource.kind) {
    case 'cantrip':
      return 'A cantrip spends nothing.';
    case 'arcanum':
      return `Spends your ${ordinal(resource.level)}-level Mystic Arcanum.`;
    case 'pact':
      return `Spends a pact slot (${ordinal(resource.level)} level).`;
    case 'slot':
      return `Spends a ${ordinal(resource.level)}-level slot.`;
    case 'uses':
      return `Spends a use of ${resource.label}.`;
    case 'charges':
      return `Spends ${plural(resource.cost, `${resource.label} charge`)}.`;
    case 'pool': {
      const economy = conversionEconomy(resource.key) ?? 'action';
      const turn = conversionTurnNote(economy, ctx.spell, ctx.play);
      const level = conversionLevelNote(resource.key, resource.level, ctx);
      const article = economy === 'action' ? 'an' : 'a';
      return [
        `Spends ${String(resource.cost)} ${resource.label} and ${article} ${ECONOMY_LABEL[economy]} to convert${turn === undefined ? '' : `, ${turn}`}.`,
        ...(level === undefined ? [] : [`${level}.`]),
      ].join(' ');
    }
  }
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
    spellRollActions(entity, { characterLevel, slotLevel: level }).map((a) => a.expr);
  const atSlot = rollExprs(slotLevel);
  if (atSlot.length === 0) return undefined;
  const baseLevel = typeof entity?.level === 'number' ? entity.level : slotLevel;
  if (slotLevel > baseLevel && atSlot.join('+') === rollExprs(baseLevel).join('+')) {
    return undefined; // upcast changes targets/instances, not dice — show no dice
  }
  return atSlot.join(' / ');
}

/** Is the character concentrating on this spell, by the name a cast stores? */
export function isConcentratingOn(play: PlayState, name: string): boolean {
  return play.concentratingOn?.label.toLowerCase() === name.toLowerCase();
}

/** A slot or the pact slot: what casting at a level, or a slot price, spends. */
export type SlotSpent = Extract<CastResource, { kind: 'slot' | 'pact' }>;

/** Spends a slot, or the pact slot. */
export function spendSlot(play: PlayState, resource: SlotSpent): void {
  if (resource.kind === 'pact') {
    play.pactSlotsSpent += 1;
    return;
  }
  const at = play.slotsSpent[resource.level - 1] ?? 0;
  play.slotsSpent[resource.level - 1] = at + 1;
}

/**
 * Cast a spell, spending `resource` when given (an explicit slot/upcast/pool
 * choice) or else the lowest available slot ≥ `level` (pact-aware). Marks the
 * action economy the casting time uses and, when the spell concentrates, it
 * becomes the active concentration (dropping any prior one: one at a time),
 * along with the level it was cast at: its dice on a later turn are that slot's.
 * The character's own effects held by the old concentration end with it
 * (casting Haste ends Bless), within `hp`. The sheet casts through
 * `castSpellAsking`, which then asks Bless's caster about themself.
 */
export function castSpell(
  update: DocUpdater,
  hp: HpLimits,
  /** The class whose slots it casts with; without one, it spends only `resource`. */
  block: SpellcastingBlock | undefined,
  level: number,
  spell?: CastSpellInfo,
  resource?: CastResource,
): void {
  // Which resource actually paid for it is only known inside the recipe, so the
  // history label is resolved afterwards (see DocUpdater).
  let spent: CastResource | undefined;
  update(
    (d) => {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      let turnUsed = false;
      if (spell?.economy !== undefined) {
        turn[spell.economy] = true;
        turnUsed = true;
      }
      const spend = resource ?? nextCastResource(block, d.play, level);
      spent = spend;
      if (spell?.concentration === true) {
        const leveled = spend.kind !== 'cantrip' && spend.kind !== 'none';
        setConcentration(
          d.play,
          leveled ? { label: spell.name, level: spend.level } : { label: spell.name },
          hp,
        );
        // Cast with no slot, it holds no level, whatever an earlier casting held.
        if (!leveled) delete d.play.concentratingOn?.level;
      }
      if (spend.kind === 'pool') {
        // Converting points into the slot takes its own slice of the turn, so
        // the cast costs that as well as the spell's own economy. Both land on
        // one flag when they want the same slice; the chooser says so.
        turn[conversionEconomy(spend.key) ?? 'action'] = true;
        turnUsed = true;
        const entry = d.play.resources.find((r) => r.key === spend.key);
        if (entry !== undefined) entry.used += spend.cost;
        else d.play.resources.push({ key: spend.key, used: spend.cost });
      } else if (spend.kind === 'uses' || spend.kind === 'charges') {
        // An innate grant's use, or an item's charges: its own pool.
        const cost = spend.kind === 'uses' ? 1 : spend.cost;
        const entry = d.play.resources.find((r) => r.key === spend.key);
        if (entry !== undefined) entry.used += cost;
        else d.play.resources.push({ key: spend.key, used: cost });
      } else if (spend.kind === 'arcanum') {
        setArcanumUsed(d.play, spend.level, true);
      } else if (spend.kind === 'pact' || spend.kind === 'slot') {
        spendSlot(d.play, spend);
      }
      if (turnUsed) d.play.turn = turn;
    },
    spell === undefined ? undefined : () => `Cast ${spell.name}${castCost(spent, level)}`,
  );
}

/**
 * Cast an innate grant: no slot, just concentration and the action economy. One
 * with its own pool ("1/day" from a wand) spends a use here rather than leaving
 * the pips for the player to remember.
 */
export function castGranted(
  update: DocUpdater,
  hp: HpLimits,
  spell: CastSpellInfo,
  limit?: { key: string; max: number },
): void {
  update((d) => {
    if (spell.concentration === true) {
      setConcentration(d.play, { label: spell.name }, hp);
      delete d.play.concentratingOn?.level;
    }
    if (spell.economy !== undefined) {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      turn[spell.economy] = true;
      d.play.turn = turn;
    }
    if (limit !== undefined) {
      const entry = d.play.resources.find((r) => r.key === limit.key);
      const used = entry?.used ?? 0;
      if (used < limit.max) {
        if (entry !== undefined) entry.used = used + 1;
        else d.play.resources.push({ key: limit.key, used: 1 });
      }
    }
  }, `Cast ${spell.name}`);
}

/** " (L3)" / " (pact slot)" / " (Mystic Arcanum)" / " (no slot)" / "", when it isn't the obvious cost. */
export function castCost(spent: CastResource | undefined, level: number): string {
  if (spent === undefined) return '';
  if (spent.kind === 'arcanum') return ' (Mystic Arcanum)';
  if (spent.kind === 'pact') return ' (pact slot)';
  // Which pool paid is always news, even at the spell's own level.
  if (spent.kind === 'pool') {
    return ` (L${String(spent.level)} from ${String(spent.cost)} ${spent.label})`;
  }
  if (spent.kind === 'uses') return ` (${spent.label})`;
  if (spent.kind === 'charges') {
    return ` (L${String(spent.level)} from ${plural(spent.cost, `${spent.label} charge`)})`;
  }
  // Casting with nothing left to spend is deliberate but must not read the same
  // as a paid cast, since the explicit label replaces the diff that would show it.
  if (spent.kind === 'none') return ' (no slot)';
  // An upcast is news; paying the spell's own level is not.
  if (spent.kind === 'slot' && spent.level !== level) return ` (L${String(spent.level)})`;
  return '';
}
