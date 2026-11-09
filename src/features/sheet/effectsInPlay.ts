import { parseDice } from '@/dice/parse';
import { countingEffects, readActiveEffects } from '@/engine/activeEffects';
import type { ActiveCondition, ConditionImmunity, Edition } from '@/engine/conditions';
import type { HpLimits, newTurn } from '@/engine/effectLife';
import type { Defenses } from '@/engine/playRules';
import type {
  Ability,
  ActiveEffect,
  AttackRow,
  DerivedSheet,
  DerivedValue,
  EffectPart,
  RollFilter,
} from '@/engine/types';

/**
 * How the sheet shows what is in play (Bless, Rage, a Periapt's immunity):
 * the words for an effect's sheet, which numbers an effect raised, and the
 * character's defenses as the Defenses chip and sheet say them. The rules are
 * the engine's (`activeEffects.ts`, `playRules.ts`); this is how they read.
 */

const ABILITY: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** "a", "a and b", "a, b and c". */
export function andList(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const lower = (s: string) => s.trim().toLowerCase();

/** What the effects in play need of the sheet to change hit points with them. */
export function hpLimits(sheet: DerivedSheet, edition: Edition): HpLimits {
  return { maxHp: sheet.maxHp.value, edition, immune: sheet.conditionImmunities };
}

/** The effects in play this app can read, in the order they were added. */
export function effectsInPlay(play: { activeEffects?: unknown }): ActiveEffect[] {
  return readActiveEffects(play.activeEffects).effects;
}

/**
 * The conditions as the sheet applies them: one the character is immune to is
 * held off (Mindless Rage), which is how one switched off already reads, so
 * every helper that skips `ignored` skips it too.
 */
export function conditionsInForce(
  conditions: readonly ActiveCondition[],
  immune: readonly ConditionImmunity[],
): ActiveCondition[] {
  if (immune.length === 0) return [...conditions];
  const held = new Set(immune.map((i) => lower(i.condition)));
  return conditions.map((c) =>
    c.ignored !== true && held.has(lower(c.id)) ? { ...c, ignored: true } : c,
  );
}

/** What holds a condition off, by name: "Periapt of Proof against Poison". */
export function immunityTo(id: string, immune: readonly ConditionImmunity[]): string[] {
  return [...new Set(immune.filter((i) => lower(i.condition) === lower(id)).map((i) => i.origin))];
}

/** The die an effect rolls in or offers, as its chip marks it: "+d4", "+2d6". */
export function effectMark(effect: ActiveEffect): string | undefined {
  for (const p of effect.parts) {
    if (p.kind === 'rollDie' || p.kind === 'rollOffer') {
      return `+${p.dice.replace(/^1d/i, 'd')}`;
    }
  }
  return undefined;
}

/** The rolls a filter reaches, in words: "melee weapon attack rolls made with Strength". */
export function rollsWords(on: RollFilter): string {
  const abilities = on.abilities?.map((a) => ABILITY[a]).join(' or ');
  const words = on.rolls.map((r) => {
    if (r === 'attack') {
      const kind = [on.range, on.className, on.attack].filter((w) => w !== undefined).join(' ');
      return `${kind === '' ? '' : `${kind} `}attack rolls${abilities ? ` made with ${abilities}` : ''}`;
    }
    if (r === 'check') {
      if (on.skills !== undefined && on.skills.length > 0) return `${andList(on.skills)} checks`;
      if (on.skilled === true) return abilities ? `${abilities} skill checks` : 'skill checks';
      return abilities ? `${abilities} checks` : 'ability checks';
    }
    return abilities ? `${abilities} saving throws` : 'saving throws';
  });
  return andList(words);
}

const typeWords = (damageType: string) =>
  lower(damageType) === 'all' ? 'damage of every type' : `${lower(damageType)} damage`;

const scopeWords = (scope: 'melee' | 'ranged' | 'all') => (scope === 'all' ? '' : `${scope} `);

/** One part of an effect, as its sheet says it: "+2 to AC", "Half fire damage". */
export function partLine(p: EffectPart): string {
  switch (p.kind) {
    case 'abilityMin':
      return `${ABILITY[p.ability]} is at least ${p.min}`;
    case 'acBonus':
      return `${signed(p.amount)} to AC`;
    case 'acFormula': {
      const adds = p.addAbilities.map((a) => ` + ${a.toUpperCase()}`).join('');
      const cap = p.dexMax === undefined ? '' : ` (DEX at most ${signed(p.dexMax)})`;
      return `AC is ${p.base}${adds}${cap}`;
    }
    case 'acMin':
      return `AC is at least ${p.min}`;
    case 'attackBonus': {
      const kind = p.attack === 'spell' ? 'spell ' : p.attack === 'any' ? '' : 'weapon ';
      const ability = p.ability === undefined ? '' : ` made with ${ABILITY[p.ability]}`;
      return `${signed(p.amount)} to ${scopeWords(p.scope)}${kind}attack rolls${ability}`;
    }
    case 'checkBonus':
      return 'skills' in p
        ? `${signed(p.amount)} to ${andList(p.skills)} checks`
        : `${signed(p.amount)} to ${ABILITY[p.ability]} checks`;
    case 'conditionImmune':
      return `You cannot be ${lower(p.condition)}${p.note ? ` (${p.note})` : ''}`;
    case 'critRange':
      return `Attacks score a critical hit on ${p.min >= 20 ? 'a 20' : p.min === 19 ? 'a 19 or 20' : `${p.min} to 20`}`;
    case 'cue':
      return p.text;
    case 'damageBonus': {
      const ability = p.ability === undefined ? '' : `${ABILITY[p.ability]} `;
      return `${signed(p.amount)} damage on ${scopeWords(p.scope)}${ability}weapon attacks`;
    }
    case 'damageDie':
      return `+${p.dice} ${p.damageType ? `${lower(p.damageType)} ` : ''}damage on ${scopeWords(p.scope)}weapon hits`;
    case 'extraAction':
      return p.note ? `${p.label}: ${p.note}` : p.label;
    case 'immune':
      return `No ${typeWords(p.damageType)}${p.note ? ` (${p.note})` : ''}`;
    case 'initiativeBonus':
      return `${signed(p.amount)} to initiative`;
    case 'maxHpBonus':
      return `${signed(p.amount)} to your hit point maximum`;
    case 'moveSpeed':
      return p.speed === 'walk'
        ? `A ${p.mode} speed equal to your walking speed`
        : `A ${p.mode} speed of ${p.speed} ft.`;
    case 'resist':
      return `Half ${typeWords(p.damageType)}${p.note ? ` (${p.note})` : ''}`;
    case 'rollAdvantage':
      return `${p.mode === 'adv' ? 'Advantage' : 'Disadvantage'} on ${rollsWords(p.on)}`;
    case 'rollDie':
      return `Add ${p.dice} to ${rollsWords(p.on)}`;
    case 'rollOffer':
      return `Add ${p.dice} to ${p.once === true ? 'one of your' : 'your'} ${rollsWords(p.on)}, after you see the d20${p.ifFailed === true ? ', if it failed' : ''}`;
    case 'saveBonus': {
      const which =
        p.abilities === undefined || p.abilities.length === 0
          ? 'every saving throw'
          : `${andList(p.abilities.map((a) => ABILITY[a]))} saving throws`;
      return `${signed(p.amount)} to ${which}`;
    }
    case 'sense':
      return `${p.sense} ${p.range} ft.`;
    case 'spellDcBonus':
      return `${signed(p.amount)} to your spell save DC${p.className ? ` for ${p.className} spells` : ''}`;
    case 'speedBonus':
      return `${signed(p.amount)} ft. walking speed`;
    case 'speedMultiplier':
      return `Walking speed × ${p.factor}`;
    case 'tempHpEachTurn':
      return `${p.amount} temporary hit points at the start of each of your turns`;
    case 'vulnerable':
      return `Double ${typeWords(p.damageType)}`;
  }
}

/** How long an effect lasts, for its sheet; undefined when it says nothing. */
export function lastsLine(effect: ActiveEffect): string | undefined {
  const l = effect.lasts;
  const words: string[] = [];
  if (l?.rest === 'short') words.push('until you finish a short or long rest');
  else if (l?.rest === 'long') words.push('until you finish a long rest');
  if (typeof l?.minutes === 'number' && l.minutes > 0) {
    const m = l.minutes;
    words.push(
      `up to ${m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`}`,
    );
  }
  if (Number.isInteger(effect.turnsLeft) && (effect.turnsLeft ?? 0) > 0) {
    words.push(
      effect.turnsLeft === 1
        ? 'until the start of your next turn'
        : 'until the end of your next turn',
    );
  }
  const held = l?.concentration === true;
  if (words.length === 0 && !held) return undefined;
  const say = words.length > 0 ? `Lasts ${andList(words)}` : 'Lasts';
  return `${say}${held ? `${words.length > 0 ? ', ' : ' '}while ${effect.mine === true ? 'you concentrate' : 'its caster concentrates'}` : ''}.`;
}

/** Minutes as a rest's row says them: "10 minutes", "8 hours". */
const span = (m: number) =>
  m >= 60 && m % 60 === 0
    ? `${m / 60} hour${m === 60 ? '' : 's'}`
    : `${m} minute${m === 1 ? '' : 's'}`;

/**
 * What an effect lasts, as a rest's "Ends" row says it ("Concentration, 10
 * minutes"), with ", so it stays" when the rest leaves it ticked off.
 */
export function restLasts(effect: ActiveEffect, ends: boolean): string {
  const l = effect.lasts;
  const words: string[] = [];
  if (l?.concentration === true) words.push('Concentration');
  if (typeof l?.minutes === 'number' && l.minutes > 0) words.push(span(l.minutes));
  if (l?.rest === 'short') words.push('until a short rest');
  else if (l?.rest === 'long') words.push('until a long rest');
  const said = words.length > 0 ? words.join(', ') : 'Until you end it';
  const first = said.charAt(0).toUpperCase() + said.slice(1);
  return ends ? first : `${first}, so it stays`;
}

/**
 * The effect of the same name that counts instead of this one, when this one
 * does not count for anything: two Blesses roll one d4.
 */
export function countedInstead(effects: readonly ActiveEffect[], id: string): string | undefined {
  return countingEffects(effects).notCounted.find((n) => n.effectId === id)?.countedFrom;
}

// ---------------------------------------------------------------------------
// What an effect raised
// ---------------------------------------------------------------------------

/** A number an effect in play raised: higher with the effects than without. */
export function raised(
  now: DerivedValue | number,
  before: DerivedValue | number | undefined,
): boolean {
  if (before === undefined) return false;
  const a = typeof now === 'number' ? now : now.value;
  const b = typeof before === 'number' ? before : before.value;
  return a > b;
}

/**
 * The effects in play that raised a number, by name: the parts it has that the
 * build alone lacks. Empty when nothing raised it.
 */
export function raisedBy(now: DerivedValue, before: DerivedValue | undefined): string[] {
  if (!raised(now, before)) return [];
  const had = new Set(before?.parts.map((p) => p.label));
  const names = now.parts.filter((p) => !had.has(p.label) && p.amount > 0).map((p) => p.label);
  return names.length > 0 ? [...new Set(names)] : ['an effect in play'];
}

/** A dice expression's average, for telling a raised damage roll from a lowered one. */
function average(expr: string): number | undefined {
  try {
    return parseDice(expr).terms.reduce(
      (n, t) => n + t.sign * (t.kind === 'mod' ? t.value : (t.count * (t.sides + 1)) / 2),
      0,
    );
  } catch {
    return undefined;
  }
}

/**
 * Which of an attack's chips an effect raised, from its row without effects,
 * and what raised its damage: the bonuses the build alone lacks, else "an
 * effect in play" (Giant Strength's floor raises it through Strength).
 */
export function attackLift(
  now: AttackRow,
  before: AttackRow | undefined,
): { hit: boolean; damage: boolean; versatile: boolean; damageBy: string[]; riders: boolean[] } {
  const known = new Set(before?.extraDamage.map((x) => `${x.dice}:${x.damageType ?? ''}`));
  const more = (a: string | undefined, b: string | undefined) => {
    if (a === undefined || b === undefined) return false;
    const x = average(a);
    const y = average(b);
    return x !== undefined && y !== undefined && x > y;
  };
  const damage = more(now.damage, before?.damage);
  const versatile = more(now.versatileDamage, before?.versatileDamage);
  const had = new Set(before?.damageFrom);
  const added = (now.damageFrom ?? []).filter((n) => !had.has(n));
  return {
    hit: raised(now.toHit, before?.toHit),
    damage,
    versatile,
    damageBy: damage || versatile ? (added.length > 0 ? added : ['an effect in play']) : [],
    riders: now.extraDamage.map(
      (x) =>
        before !== undefined &&
        (x.label !== undefined || !known.has(`${x.dice}:${x.damageType ?? ''}`)),
    ),
  };
}

// ---------------------------------------------------------------------------
// Defenses
// ---------------------------------------------------------------------------

/** One line of the Defenses sheet: the types, and what gives them. */
export interface DefenseRow {
  /** "Bludgeoning, piercing, slashing", "All damage", "Poisoned". */
  what: string;
  /** "Rage", or "Periapt of Proof against Poison. Dwarven Resilience would halve it, but none beats half." */
  from: string;
  /** When it holds, from the data or the effect: "nonmagical". */
  note?: string;
}

export interface DefenseView {
  none: DefenseRow[];
  half: DefenseRow[];
  double: DefenseRow[];
  cannot: DefenseRow[];
  /** Advantage on saves an effect in play gives: "Strength saving throws". */
  saves: DefenseRow[];
  /** The chip on the HP card; undefined when there is nothing to show. */
  chip?: {
    word: string;
    /** For a screen reader: "Resists 3 damage types". */
    say: string;
    icon: 'half' | 'check' | 'alert';
  };
}

const cap = (s: string) => (s === '' ? s : s[0]?.toUpperCase() + s.slice(1));

/** Rows by what gives them, each listing its types: Rage's three in one row. */
function rowsOf(
  list: ReadonlyArray<{ damageType: string; origin: string; note?: string }>,
): DefenseRow[] {
  const by = new Map<string, { types: string[]; origin: string; note?: string }>();
  for (const d of list) {
    const key = `${d.origin}\u0000${d.note ?? ''}`;
    const row = by.get(key) ?? { types: [], origin: d.origin, note: d.note };
    const t = lower(d.damageType);
    if (!row.types.includes(t)) row.types.push(t);
    by.set(key, row);
  }
  return [...by.values()].map((r) => ({
    what: r.types.includes('all') ? 'All damage' : cap(r.types.join(', ')),
    from: r.origin,
    ...(r.note === undefined ? {} : { note: r.note }),
  }));
}

/** The damage types a list names, once each: "all" stands for every type. */
const typesOf = (list: ReadonlyArray<{ damageType: string }>) =>
  new Set(list.map((d) => lower(d.damageType)));

/** The character's defenses, as the Defenses chip and sheet show them. */
export function defenseView(
  sheet: Pick<
    DerivedSheet,
    'resists' | 'immunities' | 'vulnerabilities' | 'conditionImmunities' | 'rollRiders'
  >,
  defenses: Defenses,
): DefenseView {
  const none = rowsOf(defenses.immune);
  const immuneTypes = typesOf(defenses.immune);
  // Immunity beats resistance: say so where both reach a type. A resistance
  // to all (Warding Bond) reaches every immunity, and an immunity to all
  // beats every resistance.
  for (const row of none) {
    const types = new Set(row.what === 'All damage' ? ['all'] : row.what.toLowerCase().split(', '));
    const beaten = defenses.resist.filter((r) => {
      const t = lower(r.damageType);
      return t === 'all' || types.has('all') || types.has(t);
    });
    const names = [...new Set(beaten.map((r) => r.origin))];
    if (names.length > 0) {
      row.from = `${row.from}. ${andList(names)} would halve it, but none beats half.`;
    }
  }
  const cannot = [
    ...new Map(
      sheet.conditionImmunities.map((c) => [
        `${lower(c.condition)}\u0000${c.origin}`,
        {
          what: cap(lower(c.condition)),
          from: c.origin,
          ...(c.note === undefined ? {} : { note: c.note }),
        },
      ]),
    ).values(),
  ];
  const saves = sheet.rollRiders
    .filter((r) => r.kind === 'advantage' && r.mode === 'adv' && r.on.rolls.includes('save'))
    .map((r) => ({
      what: `Advantage on ${rollsWords({ ...r.on, rolls: ['save'] })}`,
      from: r.origin,
    }));

  // The chip counts what each type comes to: one immune is not also resisted.
  const zero = immuneTypes;
  const beat = (s: Set<string>) =>
    zero.has('all') ? new Set<string>() : new Set([...s].filter((t) => !zero.has(t)));
  const half = beat(typesOf(defenses.resist));
  const twice = beat(typesOf(defenses.vulnerable));
  const kinds = [half, zero, twice].filter((s) => s.size > 0).length;
  const count = (s: Set<string>) => (s.has('all') ? 'all' : String(s.size));
  const of = (n: string) =>
    n === 'all' ? 'every damage type' : `${n} damage type${n === '1' ? '' : 's'}`;
  let chip: DefenseView['chip'];
  if (kinds > 1) {
    const every = new Set([...half, ...zero, ...twice]);
    chip = every.has('all')
      ? { word: 'Defenses', say: 'Defenses against every damage type', icon: 'half' }
      : {
          word: `Defenses ${every.size}`,
          say: `Defenses against ${of(String(every.size))}`,
          icon: twice.size > 0 ? 'alert' : 'half',
        };
    if (twice.size > 0) chip.icon = 'alert';
  } else if (zero.size > 0) {
    chip = { word: `Immune ${count(zero)}`, say: `Immune to ${of(count(zero))}`, icon: 'check' };
  } else if (twice.size > 0) {
    chip = {
      word: `Double ${count(twice)}`,
      say: `Double damage from ${of(count(twice))}`,
      icon: 'alert',
    };
  } else if (half.size > 0) {
    chip = { word: `Resists ${count(half)}`, say: `Resists ${of(count(half))}`, icon: 'half' };
  } else if (cannot.length > 0) {
    chip = {
      word: 'Defenses',
      say: `Defenses: ${cannot.length} condition${cannot.length === 1 ? '' : 's'} you cannot have`,
      icon: 'check',
    };
  }

  return {
    none,
    half: rowsOf(defenses.resist),
    double: rowsOf(defenses.vulnerable),
    cannot,
    saves,
    ...(chip === undefined ? {} : { chip }),
  };
}

/**
 * What an effect in play added to the character's defenses, by name: a damage
 * type now resisted or taken none from, or a condition now held off, that the
 * build alone does not cover. A vulnerability raises nothing, nor does a
 * resistance the build already has (a fire-resistant species under Protection
 * from Energy: fire).
 */
export function defensesRaisedBy(
  now: Defenses,
  before: Defenses,
  nowConditions: ReadonlyArray<{ condition: string; origin: string }>,
  beforeConditions: ReadonlyArray<{ condition: string }>,
): string[] {
  const types = (list: ReadonlyArray<{ damageType: string }>) =>
    new Set(list.map((d) => lower(d.damageType)));
  const noneBefore = types(before.immune);
  const halfBefore = types([...before.resist, ...before.immune]);
  const covered = (had: Set<string>, t: string) => had.has('all') || had.has(t);
  const out = new Set<string>();
  for (const d of now.immune) if (!covered(noneBefore, lower(d.damageType))) out.add(d.origin);
  for (const d of now.resist) if (!covered(halfBefore, lower(d.damageType))) out.add(d.origin);
  const heldBefore = new Set(beforeConditions.map((c) => lower(c.condition)));
  for (const c of nowConditions) if (!heldBefore.has(lower(c.condition))) out.add(c.origin);
  return [...out];
}

/**
 * What New turn did, a line each, for its toast: temp HP an effect gave (or
 * offered, when the character already had more: they never add up), the
 * effects' own boxes ready again, and what ended (the buffs canvas, Together).
 */
export function newTurnLines(
  change: ReturnType<typeof newTurn>,
  extrasUsed: readonly string[],
  tempHp: number,
): string[] {
  const lines: string[] = [];
  const t = change.tempHp;
  if (t !== undefined)
    lines.push(
      t.kept
        ? `+${t.amount} temp HP: ${t.source}`
        : t.amount === tempHp
          ? `${t.source} keeps your temp HP at ${tempHp}`
          : `${t.source} offers ${t.amount} temp HP; you keep your ${tempHp}`,
    );
  for (const x of extrasUsed) lines.push(`${x} ready again`);
  for (const name of change.ended) lines.push(`${name} ended`);
  return lines;
}

/** Every damage type the keypad offers: the ones a defense names, "all" left out. */
export function defendedTypes(
  defenses: Defenses,
): Array<{ type: string; icon: 'half' | 'check' | 'alert' }> {
  const out = new Map<string, 'half' | 'check' | 'alert'>();
  const put = (list: ReadonlyArray<{ damageType: string }>, icon: 'half' | 'check' | 'alert') => {
    for (const d of list) {
      const t = lower(d.damageType);
      if (t !== 'all' && !out.has(t)) out.set(t, icon);
    }
  };
  put(defenses.immune, 'check');
  put(defenses.vulnerable, 'alert');
  put(defenses.resist, 'half');
  return [...out].map(([type, icon]) => ({ type, icon }));
}
