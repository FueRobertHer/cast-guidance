/**
 * Costs and buy-backs paid in spell slots or Hit Point Dice: the rows `SPEND_LINKS`
 * leaves out, since paying one means choosing a slot's level or a die's size as you
 * pay. The Play tab asks for that choice in the roll prompt.
 *
 * Read from each feature's own text (data function pass item 10, which lists the
 * features read and left out). Keys name the printing, as in `SPEND_LINKS`: class
 * features `name|class|source`, subclass features `name|subclass|source`, feats and
 * optional features `name|source`, all lowercase.
 */
import type { Collector } from '../effects/base';
import {
  type ActionBuyBack,
  type ActionCost,
  type ActionEconomy,
  type EffectOrigin,
  HIT_DIE_COST,
  SLOT_COST,
  type SlotDice,
  type SlotPrice,
} from '../types';

interface SlotSpend {
  kind: 'spend';
  cost: ActionCost;
  /** The slice of the turn it takes. Given when it has no chip yet, or the scanner's says another. */
  economy?: ActionEconomy;
  /**
   * Its own chip, by this name, when the feature's chip does something else (Combat
   * Wild Shape's chip is the Wild Shape it speeds up).
   */
  label?: string;
  /** What the chip's line says beside the cost. */
  note?: string;
}

interface SlotRestore {
  kind: 'restore';
  price: SlotPrice;
  /**
   * Another pool's use it buys back, by that pool's key, and the chip it shows on
   * (Font of Inspiration's slot restores a use of Bardic Inspiration).
   */
  pool?: { key: string; onAction: string };
}

type SlotRow = SlotSpend | SlotRestore;

interface SpendOptions extends SlotPrice {
  dice?: SlotDice;
  /** As many of this pool's points as the slot's level come back (Font of Magic). */
  refills?: string;
  /** It also takes a use of the feature, which a pool sharing its name counts. */
  ownUseToo?: boolean;
  label?: string;
  note?: string;
}

/** Spends one spell slot, of the level the player picks. */
function slot(economy: ActionEconomy | undefined, options: SpendOptions = {}): SlotSpend {
  const { dice, refills, ownUseToo, label, note, minLevel, pactOnly } = options;
  return {
    kind: 'spend',
    cost: {
      resource: SLOT_COST,
      amount: 1,
      ...(minLevel !== undefined ? { minLevel } : {}),
      ...(pactOnly === true ? { pactOnly } : {}),
      ...(dice !== undefined ? { slotDice: dice } : {}),
      ...(refills !== undefined ? { slotRefills: refills } : {}),
      ...(ownUseToo === true ? { ownUseToo } : {}),
    },
    ...(economy !== undefined ? { economy } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** A slot of `minLevel` or higher buys back the feature's own use, once none are left. */
const slotBack = (minLevel?: number, pactOnly?: true): SlotRestore => ({
  kind: 'restore',
  price: {
    ...(minLevel !== undefined && minLevel > 1 ? { minLevel } : {}),
    ...(pactOnly === true ? { pactOnly } : {}),
  },
});

/** A slot buys back a use of another pool, shown on that pool's chip. */
const slotFor = (key: string, onAction: string): SlotRestore => ({
  kind: 'restore',
  price: {},
  pool: { key, onAction },
});

/**
 * Spends one Hit Point Die, of the size the player picks, and heals by it: `atLeast`
 * where the feature names a least heal, `ownUseToo` where it counts uses as well.
 */
const hitDie = (
  economy: ActionEconomy | undefined,
  heals: 'roll' | 'rollPlusCon',
  { ownUseToo, atLeast }: { ownUseToo?: true; atLeast?: number } = {},
): SlotSpend => ({
  kind: 'spend',
  cost: {
    resource: HIT_DIE_COST,
    amount: 1,
    hitDieHeals: heals,
    ...(atLeast !== undefined ? { hitDieAtLeast: atLeast } : {}),
    ...(ownUseToo === true ? { ownUseToo } : {}),
  },
  ...(economy !== undefined ? { economy } : {}),
});

const d8 = (base: number, extra: Partial<SlotDice> = {}): SlotDice => ({ die: 8, base, ...extra });

export const SLOT_LINKS: Readonly<Record<string, SlotRow>> = {
  // Spent for what the slot's level buys.
  'divine smite|paladin|phb': slot('none', {
    dice: d8(1, { maxDice: 5 }),
    note: '1d8 more against an undead or fiend',
  }),
  'eldritch smite|xge': slot('none', {
    pactOnly: true,
    dice: d8(1),
    note: 'Huge or smaller: you can knock it prone',
  }),
  'eldritch smite|xphb': slot('none', {
    pactOnly: true,
    dice: d8(1),
    note: 'Huge or smaller: you can give it Prone',
  }),
  'combat wild shape|circle of the moon|phb': slot('bonus', {
    label: 'Combat Wild Shape healing',
    dice: d8(0, { heals: true }),
    note: 'while you are transformed',
  }),
  'primeval awareness|ranger|phb': slot('action', { note: '1 minute a slot level' }),
  'song of defense|bladesinging|tce': slot('reaction', { note: '5 less damage a slot level' }),
  'song of defense|bladesinger|frhof': slot('reaction', {
    note: '5 less damage a slot level, while your Bladesong is active',
  }),
  'arcane ward|abjurer|xphb': slot('bonus', { note: 'the ward regains 2 a slot level' }),
  'adept of the white robes|dsotdq': slot('reaction', {
    dice: { die: 6, base: 0, plain: true, plus: 'your spellcasting modifier' },
    note: 'less damage to you or a creature within 30 feet',
  }),
  'vestige recovery|vestige patron|au': slot('reaction', { pactOnly: true, ownUseToo: true }),
  'steel defender|battle smith|tce': slot('action', { label: 'Revive Steel Defender' }),
  'steel defender|battle smith|efa': slot('action', { label: 'Revive Steel Defender' }),
  'primal companion|beast master|tce': slot('action', { label: 'Revive Primal Companion' }),
  'primal companion|beast master|xphb': slot('action', { label: 'Revive Primal Companion' }),
  'experimental elixir|alchemist|tce': slot('action', { label: 'Create Experimental Elixir' }),
  'experimental elixir|alchemist|efa': slot('action', { label: 'Create Experimental Elixir' }),
  // A slot turned into points, as many as its level.
  'font of magic|sorcerer|xphb': slot('none', {
    label: 'Slot to Sorcery Points',
    refills: 'sorcery-points',
  }),
  'flexible casting|sorcerer|phb': slot('bonus', {
    label: 'Slot to Sorcery Points',
    refills: 'sorcery-points',
  }),
  'mystic focus|warrior of the mystic arts|au': slot('none', {
    label: 'Slot to Focus Points',
    refills: 'focus',
  }),
  // A slot buys back a use of another pool.
  'font of inspiration|bard|xphb': slotFor('bardic-inspiration', 'Bardic Inspiration'),
  'wild resurgence|druid|xphb': slotFor('wild-shape', 'Wild Shape'),
  // A slot buys back the feature's own use.
  'eyes of night|twilight domain|tce': slotBack(),
  'divine foreknowledge|knowledge domain|frhof': slotBack(6),
  'divine reaper|grave domain|rhw': slotBack(6),
  'eldritch cannon|artillerist|tce': slotBack(),
  'eldritch cannon|artillerist|efa': slotBack(),
  'reanimated companion|reanimator|rhw': slotBack(),
  'performance of creation|college of creation|tce': slotBack(2),
  'animating performance|college of creation|tce': slotBack(3),
  'universal speech|college of eloquence|tce': slotBack(),
  'mantle of majesty|college of glamour|xphb': slotBack(3),
  'moonlight step|circle of the moon|xphb': slotBack(2),
  'living legend|oath of glory|tce': slotBack(5),
  'living legend|oath of glory|xphb': slotBack(5),
  'mortal bulwark|oath of the watchers|tce': slotBack(5),
  'noble scion|oath of the noble genies|frhof': slotBack(5),
  'elder champion|oath of the ancients|xphb': slotBack(5),
  'holy nimbus|oath of devotion|xphb': slotBack(5),
  'avenging angel|oath of vengeance|xphb': slotBack(5),
  'drake companion|drakewarden|ftd': slotBack(),
  "drake's breath|drakewarden|ftd": slotBack(3),
  'frozen haunt|winter walker|frhof': slotBack(4),
  'ancient might|hollow warden|rhw': slotBack(4),
  'beguiling defenses|archfey patron|xphb': slotBack(1, true),
  'hurl through hell|fiend patron|xphb': slotBack(1, true),
  'clairvoyant combatant|great old one patron|xphb': slotBack(1, true),
  'event horizon|graviturgy magic|egw': slotBack(3),
  'manifest mind|order of scribes|tce': slotBack(),
  'distant transposition|conjurer|au': slotBack(3),
  'splintered summons|conjurer|au': slotBack(5),
  'illusory self|illusionist|xphb': slotBack(2),
  'strixhaven mascot|scc': slotBack(2),
  // Hit Point Dice spent to heal.
  'durable|xphb': hitDie('bonus', 'roll'),
  'light bringer|abh': hitDie('bonus', 'roll', { ownUseToo: true }),
  'dwarven fortitude|xge': hitDie('none', 'rollPlusCon', { atLeast: 1 }),
  'lifedrinker|xphb': hitDie('none', 'rollPlusCon', { atLeast: 1 }),
  'bloodlust|abh': hitDie('none', 'rollPlusCon', { ownUseToo: true }),
};

/**
 * Hang a slot or Hit Point Die cost on the feature's chip, or a buy-back on the
 * chip showing the use it restores. Runs after `SPEND_LINKS`, so a chip that
 * already spends a pool keeps that cost, and a row naming its own chip adds it.
 */
export function linkSlotCost(
  col: Collector,
  key: string,
  label: string,
  origin: EffectOrigin,
): boolean {
  const row = SLOT_LINKS[key.toLowerCase()];
  if (row === undefined) return false;
  if (row.kind === 'restore') {
    const { pool, price } = row;
    const buyBack: ActionBuyBack = {
      resource: SLOT_COST,
      amount: 1,
      ...price,
      ...(pool !== undefined ? { own: pool.key } : {}),
    };
    const target = col.effects.find(
      (e) =>
        e.kind === 'action' &&
        e.buyBack === undefined &&
        (pool !== undefined ? e.label === pool.onAction : e.origin === origin),
    );
    if (target?.kind === 'action') target.buyBack = buyBack;
    else if (pool === undefined) {
      col.add({ kind: 'action', economy: 'none', label, buyBack, origin });
    }
    return true;
  }
  const own =
    row.label === undefined
      ? col.effects.find((e) => e.kind === 'action' && e.origin === origin)
      : undefined;
  if (own?.kind === 'action' && own.cost === undefined) {
    own.cost = row.cost;
    if (row.economy !== undefined) own.economy = row.economy;
    if (row.note !== undefined && own.note === undefined) own.note = row.note;
    return true;
  }
  col.add({
    kind: 'action',
    economy: row.economy ?? 'none',
    label: row.label ?? label,
    cost: row.cost,
    origin,
    ...(row.note !== undefined ? { note: row.note } : {}),
  });
  return true;
}
