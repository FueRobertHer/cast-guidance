/**
 * How a spell row casts (the rolls canvas, "Level at cast" A and "Every way to
 * cast" A): the prompt's ways to cast as tiles by source, what the tile picked
 * spends and rolls, and the level the row's dice show. Play and Spells both
 * build their rows' casting here, so the two tabs offer the same ways.
 */
import type { Entity } from '@/data5e/copyMod';
import {
  type ChargeLookup,
  chargeCosts,
  isItemChargeKey,
  itemChargeKey,
  itemChargesOf,
} from '@/engine/curated/itemCharges';
import type { HpLimits } from '@/engine/effectLife';
import type { CharacterDoc, DerivedSheet, SpellcastingBlock } from '@/engine/types';
import { rememberCastLevel } from '@/stores/castLevels';
import type { DocUpdater } from '@/stores/characterSession';
import type { CastDice, HeldCast } from '@/stores/heldRoll';
import {
  type CastContext,
  type CastResource,
  type CastSpellInfo,
  type CastWay,
  type ChargeWay,
  castNote,
  castResourceId,
  castResourceLabel,
  castWays,
  defaultCastTile,
  ordinal,
  type UseWay,
  upcastEffectSummary,
} from './castResources';
import { castGrantedAsking, castSpellAsking } from './namedStarts';
import { type SpellRollAction, spellRollActions } from './spellRolls';

/** One spell on one row, and what casting it can spend. */
export interface SpellCast {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
  hp: HpLimits;
  info: CastSpellInfo;
  entity: Entity | undefined;
  /** The spell's own level. */
  level: number;
  /** The class whose slots it casts with: none for an innate grant. */
  block?: SpellcastingBlock | undefined;
  /**
   * The class it is a spell of, when that is not `block`'s: an innate grant from
   * a class or subclass (a Light Domain's Light is a Cleric cantrip).
   */
  className?: string | undefined;
  abilityModifier?: number | undefined;
  /** An innate grant's own pool of uses, which this row casts from. */
  grantPool?: UseWay | undefined;
  /** It casts with a spell attack: its hit offers the damage, and its d20 is the prompt's. */
  attack: boolean;
  /** The registry's lookups: what a carried item's charges cast (`itemChargesOf`). */
  entities: ChargeLookup;
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * What the character adds to this cast's damage (`DerivedSheet.spellDamageBonuses`):
 * each bonus whose limits all hold for the spell, cast as a spell of its row's class.
 */
export function castDamageBonuses(c: SpellCast): Array<{ amount: number; oneRoll?: true }> {
  const name = typeof c.entity?.name === 'string' ? lower(c.entity.name) : lower(c.info.name);
  const cls = c.className ?? c.block?.className;
  const school = typeof c.entity?.school === 'string' ? c.entity.school.toUpperCase() : undefined;
  return c.sheet.spellDamageBonuses.flatMap((b) =>
    (b.spells === undefined || b.spells.some((s) => lower(s) === name)) &&
    (b.className === undefined || (cls !== undefined && lower(cls) === lower(b.className))) &&
    (b.cantrips !== true || c.level === 0) &&
    (b.school === undefined || school === b.school.toUpperCase())
      ? [{ amount: b.amount, ...(b.oneRoll === true ? { oneRoll: true as const } : {}) }]
      : [],
  );
}

/** The spell's rolls when cast at `slotLevel`, with what the character adds to its damage. */
export function castRolls(c: SpellCast, slotLevel: number): SpellRollAction[] {
  return spellRollActions(c.entity, {
    characterLevel: c.sheet.totalLevel,
    slotLevel,
    abilityModifier: c.abilityModifier,
    damageBonuses: castDamageBonuses(c),
  });
}

/** The carried items whose charges cast `name`, with what each level costs (`itemChargesOf`). */
export function itemChargeWays(
  doc: CharacterDoc,
  sheet: DerivedSheet,
  name: string,
  spellLevel: number,
  entities: ChargeLookup,
): ChargeWay[] {
  const out: ChargeWay[] = [];
  for (const entry of doc.equipment) {
    if (!entry.equipped || entry.ref === undefined) continue;
    const row = itemChargesOf(entities, doc.id, entry.ref);
    // The pool is there only while the item's magic works (attuned, where it asks).
    const pool = sheet.resources.find((r) => r.key === itemChargeKey(entry.id));
    if (row === undefined || pool === undefined) continue;
    const costs = chargeCosts(row, name, spellLevel);
    if (costs.length === 0) continue;
    const fixed = row.dc !== undefined || row.attack !== undefined;
    out.push({
      key: pool.key,
      label: pool.origin,
      max: pool.max,
      costs,
      ...(fixed ? { fixed: true as const } : {}),
    });
  }
  // Two of one item are two pools: number them, so each tile says which.
  return out.map((way) => {
    const same = out.filter((w) => w.label === way.label);
    return same.length < 2 ? way : { ...way, label: `${way.label} ${same.indexOf(way) + 1}` };
  });
}

/**
 * The innate and feat grants of `name` with a pool of their own (Infernal
 * Legacy's Hellish Rebuke), so a class row offers them beside its slots. An
 * item's charges are not a use: `itemChargeWays` offers them, priced by level.
 */
export function grantUseWays(sheet: DerivedSheet, name: string): UseWay[] {
  return sheet.grantedSpells.flatMap((g) => {
    if (
      g.usage === 'prepared' ||
      g.resourceKey === undefined ||
      isItemChargeKey(g.resourceKey) ||
      lower(g.name) !== lower(name)
    ) {
      return [];
    }
    const pool = sheet.resources.find((r) => r.key === g.resourceKey);
    return pool === undefined ? [] : [{ key: pool.key, label: g.origin, max: pool.max }];
  });
}

function contextOf(c: SpellCast): CastContext {
  return {
    block: c.block,
    play: c.doc.play,
    pools: c.sheet.resources,
    spell: c.entity,
    spellLevel: c.level,
    characterLevel: c.sheet.totalLevel,
    rulesVersion: c.doc.rulesVersion,
    classes: c.doc.classes,
  };
}

/**
 * What a granted spell casts with: its save DC, its spell attack bonus, and
 * the ability modifier its dice add. An item's says them (what its text fixes,
 * or the character's own spellcasting); any other grant's are by its ability,
 * and absent with none.
 */
export function grantCast(
  g: DerivedSheet['grantedSpells'][number],
  sheet: Pick<DerivedSheet, 'abilities' | 'profBonus'>,
): { dc?: number; attack?: number; mod?: number } {
  const mod = g.ability === undefined ? g.mod : sheet.abilities[g.ability].mod;
  const byAbility =
    g.ability === undefined ? undefined : sheet.profBonus.value + sheet.abilities[g.ability].mod;
  const attack = g.attack ?? byAbility;
  const dc = g.dc ?? (byAbility === undefined ? undefined : 8 + byAbility);
  return {
    ...(dc === undefined ? {} : { dc }),
    ...(attack === undefined ? {} : { attack }),
    ...(mod === undefined ? {} : { mod }),
  };
}

/** Whether a grant's row is paid in a carried item's charges (an item's own `charges` effect's spell). */
export function paidInCharges(c: SpellCast): boolean {
  return c.block === undefined && c.grantPool !== undefined && isItemChargeKey(c.grantPool.key);
}

/** Every way this row's spell can be cast now, grouped by source. */
export function castWaysOf(c: SpellCast): CastWay[] {
  // An at-will grant casts for nothing, at once: an item's charges are the class row's.
  if (c.block === undefined && c.grantPool === undefined) return [];
  const charges = itemChargeWays(c.doc, c.sheet, c.info.name, c.level, c.entities);
  // A grant paid in an item's charges offers that copy's, priced by level, and no use.
  if (paidInCharges(c)) {
    return castWays(contextOf(c), { charges: charges.filter((w) => w.key === c.grantPool?.key) });
  }
  // A class row offers every grant's pool of the spell; a grant's row, its own.
  const uses =
    c.block !== undefined
      ? grantUseWays(c.sheet, c.info.name)
      : c.grantPool === undefined
        ? []
        : [c.grantPool];
  // Another row offers an item's charges only where the item casts with the
  // character's numbers: one whose text fixes a DC has its own row for them.
  return castWays(contextOf(c), { uses, charges: charges.filter((w) => w.fixed !== true) });
}

/**
 * What a cast with nothing to choose (`castNow`) takes from a grant's pool:
 * one use, or the charges the spell costs at its own level from the item's.
 * None when the item no longer casts it, so the row cannot cast it.
 */
function directCost(c: SpellCast): number | undefined {
  if (!paidInCharges(c)) return 1;
  const way = itemChargeWays(c.doc, c.sheet, c.info.name, c.level, c.entities).find(
    (w) => w.key === c.grantPool?.key,
  );
  return way?.costs.find((x) => x.level === c.level)?.cost;
}

/**
 * Whether a grant's row cannot cast now, with `remaining` left in its pool:
 * spent, with nothing else to cast it with, or paid in an item's charges with
 * too few left for any level. It must not then go on marking the turn.
 */
export function grantUsedUp(c: SpellCast, remaining: number | undefined): boolean {
  if (remaining === undefined || castsByPrompt(c)) return false;
  const cost = directCost(c);
  return cost === undefined || remaining < cost;
}

/** Why a row's cast button is off (`grantUsedUp`): its charges cannot pay, or its uses are spent. */
export function usedUpTitle(c: SpellCast): string {
  return paidInCharges(c) ? 'Not enough charges left' : 'No uses left until you rest';
}

/** A limited grant's badge title: where its uses come from, or that none are left. */
export function grantBadgeTitle(usage: string | undefined, origin: string, spent: boolean): string {
  if (!spent) return `${usage ?? ''} from ${origin}`;
  return usage === 'charges' ? 'No charges left' : 'No uses left until you rest';
}

/**
 * The words after a limited grant's count: "per day" for "1/day", and an
 * item's charges by their name, "charges".
 */
export function grantLimitWords(usage: string | undefined): string {
  const per = usage?.split('/')[1];
  return per === undefined ? (usage ?? '') : `per ${per}`;
}

/**
 * The row a cast comes from: a spell can sit on a class's row and on a
 * grant's (Bless always prepared, and once a day from a feat).
 */
export function castRowId(c: SpellCast): string {
  const from = c.block?.classUid ?? c.grantPool?.key ?? 'innate';
  return `${c.doc.id}|${from}|${c.info.name}|${c.info.source}`.toLowerCase();
}

/**
 * What the prompt says for this row now (each heading, tile and note): when it
 * changes, a waiting cast is rebuilt.
 */
export function castWaysKey(c: SpellCast): string {
  const ctx = contextOf(c);
  return castWaysOf(c)
    .flatMap((w) => [
      `${w.title}:${w.sub ?? ''}`,
      ...w.tiles.map(
        (t) =>
          `${castResourceId(t.resource)}:${t.sub}:${String(t.ok)}:${castNote(t.resource, ctx)}`,
      ),
    ])
    .join('\n');
}

/** The level a cast of this row starts at: its first tile's, or the spell's own. */
export function castStartLevel(c: SpellCast): number {
  return defaultCastTile(castWaysOf(c), contextOf(c))?.resource.level ?? c.level;
}

/** Can this row cast through the prompt: a leveled spell with a class's slots, or a way left that can pay. */
export function castsByPrompt(c: SpellCast): boolean {
  if (c.level === 0) return false;
  if (c.block !== undefined) return true;
  return castWaysOf(c).some((w) => w.tiles.some((t) => t.ok));
}

/**
 * The spell's dice at `level`: the chip that casts it, or the damage its
 * attack's hit offers; with `label`, its roll of that label.
 */
export function castDiceAt(c: SpellCast, level: number, label?: string): CastDice | undefined {
  const rolls = castRolls(c, level);
  const roll =
    label !== undefined
      ? rolls.find((r) => r.label === label)
      : c.attack
        ? rolls.find((r) => r.variant === 'damage')
        : rolls[0];
  if (roll === undefined) return undefined;
  const kind = roll.variant === 'dice' ? undefined : roll.variant;
  return { expr: roll.expr, label: roll.label, kind };
}

/**
 * The prompt's cast: the ways to cast as tiles, starting on the one an
 * unchosen cast has always spent, and what the tile picked spends and rolls.
 * Casting remembers the level, for the row's damage chip.
 */
export function castPlan(c: SpellCast): HeldCast {
  const ctx = contextOf(c);
  const ways = castWaysOf(c);
  const tiles = ways.flatMap((w) => w.tiles);
  const resourceOf = (id: string | null): CastResource | undefined =>
    tiles.find((t) => t.ok && castResourceId(t.resource) === id)?.resource;
  const levelOf = (id: string | null) => resourceOf(id)?.level ?? c.level;
  const start = defaultCastTile(ways, ctx);
  return {
    id: castRowId(c),
    spell: c.info.name,
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
    note: (id) => castNote(resourceOf(id), ctx),
    dice: (id, label) => castDiceAt(c, levelOf(id), label),
    line: (id) => {
      const level = levelOf(id);
      const dice = upcastEffectSummary(c.entity, c.sheet.totalLevel, level);
      const at = `${ordinal(level)} level`;
      if (dice === undefined) return at;
      return c.attack ? `${at}, then ${dice}` : `${at}: ${dice}`;
    },
    cast: (id) => {
      const resource = resourceOf(id) ?? { kind: 'none', level: c.level };
      rememberCastLevel(castRowId(c), resource.level);
      castSpellAsking(c.update, c.hp, c.block, c.level, c.info, resource);
    },
  };
}

/**
 * Casts at once, with nothing to choose: a cantrip, or an innate grant cast at
 * will. Either marks its slice of the turn, and concentration when it needs it.
 */
export function castNow(c: SpellCast): void {
  if (c.block === undefined) {
    // A grant's own pool, when it has one, still pays for a cantrip: an item's
    // charges, what the cantrip costs.
    const pool = c.grantPool;
    const cost = directCost(c) ?? 1;
    castGrantedAsking(c.update, c.hp, c.info, pool && { key: pool.key, max: pool.max, cost });
  } else if (c.level === 0) {
    castSpellAsking(c.update, c.hp, c.block, 0, c.info, { kind: 'cantrip', level: 0 });
  } else {
    castSpellAsking(c.update, c.hp, c.block, c.level, c.info);
  }
}
