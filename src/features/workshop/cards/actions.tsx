/**
 * Board 4's actions and uses: a pool of uses, an action and what it spends, a
 * choice (a pick), and a copy's prices on the actions it inherits (`amend`).
 */
import { CircleAlert, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { isRecord } from '@/engine/castGuidance';
import { ITEM_CHARGES } from '@/engine/curated/itemCharges';
import { readMechanics } from '@/engine/effects/mechanics';
import { HIT_DIE_COST, SLOT_COST, type SlotPrice } from '@/engine/types';
import { pickWords } from '@/features/homebrew/pickWords';
import { slotPriceWords } from '@/features/sheet/slotCost';
import { Chip } from '@/ui/Chip';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import { KEPT_ASKS, NEW_PICK, PickFields } from '../PickFields';
import type { Eff, KindSpec, Options } from './kit/types';
import { amount, held, isByLevel, isString, offering, words } from './kit/words';

/**
 * Whether a pool's or an action's name says the class that gives it: never,
 * always (`ownClass`), or only beside another class it lists (`ownClassBeside`).
 */
const NAMINGS: Options = [
  ['', 'Never'],
  ['own', 'Always'],
  ['beside', 'Beside a class'],
];

/** Class names as a box holds them, "Paladin, Cleric", as a list. */
const classList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/**
 * What a file's `ownClass` or `ownClassBeside` adds to a pool's or an action's
 * name: the sheet names it for the class that gives it, "Channel Divinity
 * (Paladin)", always or only beside a class it lists.
 */
function classWords(e: Eff): string {
  if (e.ownClass === true) return ' (name of the class that gives it)';
  const beside = Array.isArray(e.ownClassBeside) ? e.ownClassBeside.map(String) : [];
  return beside.length === 0
    ? ''
    : ` (name of the class that gives it, beside a level in ${beside.join(' or ')})`;
}

/** When a pool comes back, as a sentence reads it. */
const restWords = (v: unknown) =>
  isByLevel(v)
    ? 'a rest that changes by level'
    : v === 'short'
      ? 'a short or long rest'
      : 'a long rest';

const ECONOMY_WORDS: Readonly<Record<string, string>> = {
  action: 'Action',
  bonus: 'Bonus action',
  reaction: 'Reaction',
  none: 'No action',
};

/** An action's price (`cost` or `buyBack`), when the file gives one. */
type Price = Record<string, unknown>;
const priceOf = (v: unknown): Price | undefined =>
  isRecord(v) && typeof v.resource === 'string' ? v : undefined;

/** A price paid with a pool's uses, not a spell slot or a Hit Point Die. */
const isPool = (p: Price) => p.resource !== SLOT_COST && p.resource !== HIT_DIE_COST;

/** What a price takes: "2 uses of focus", "a level 3+ spell slot", "a Hit Point Die". */
function paidWords(p: Price): string {
  if (p.resource === SLOT_COST) return slotPriceWords(p as SlotPrice);
  if (p.resource === HIT_DIE_COST) return 'a Hit Point Die';
  const n = p.amount;
  if (p.resource === ITEM_CHARGES) {
    return n === 'varies'
      ? 'charges, as many as you choose'
      : `${String(n)} ${n === 1 ? 'charge' : 'charges'}`;
  }
  if (n === 'varies') return `uses of ${String(p.resource)}, as many as you choose`;
  return `${String(n)} ${n === 1 ? 'use' : 'uses'} of ${String(p.resource)}`;
}

/**
 * An action card's line after its name: what it spends, and what buys a use
 * back. A slot or a die pays for every use, so only a pool's price has a free one.
 */
function priceWords(e: Eff): string {
  const cost = priceOf(e.cost);
  const back = priceOf(e.buyBack);
  const of = back?.own === undefined ? '' : ` of ${String(back.own)}`;
  return [
    cost === undefined
      ? ''
      : cost.optional === true && isPool(cost)
        ? `, free, or ${paidWords(cost)} for more`
        : `, spends ${paidWords(cost)}`,
    back === undefined ? '' : `, buys a use${of} back with ${paidWords(back)}`,
  ].join('');
}

/** The fields that belong to one way of paying: a spell slot's, or a Hit Point Die's. */
const PAID_WITH_ONLY = [
  'minLevel',
  'pactOnly',
  'slotDice',
  'slotRefills',
  'hitDieHeals',
  'hitDieAtLeast',
];

/**
 * A price paid another way: what belonged to the old way goes, the rest stays
 * (how many, a use of its own too, the use it gives back). A spell slot or a
 * Hit Point Die is one, and pays for every use, so it drops a free base use.
 */
function repaid(price: Price | undefined, resource: string): Price {
  const one = resource === SLOT_COST || resource === HIT_DIE_COST;
  const rest = Object.fromEntries(
    Object.entries(price ?? {}).filter(
      ([k]) => !PAID_WITH_ONLY.includes(k) && !(one && k === 'optional'),
    ),
  );
  return { ...rest, resource, amount: one || rest.amount === undefined ? 1 : rest.amount };
}

const COUNTS: Options = Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]);
const AMOUNTS: Options = [...COUNTS, ['varies', 'Any number']];
const PAID_FOR: Options = [
  ['', 'Every use'],
  ['optional', 'Extra uses'],
];
const SLOT_PRICES: Options = [
  ['', 'Any spell slot'],
  ...Array.from({ length: 8 }, (_, i) => [String(i + 2), `Level ${i + 2}+`] as const),
  ['pact', 'Pact Magic'],
];
const HEALS: Options = [
  ['roll', 'Roll'],
  ['rollPlusCon', 'Roll plus Con'],
];

/** Which slots pay a slot price, as its box holds it: any, a level or higher, Pact Magic. */
function slotPriceBox(p: Price): { value: string; options: Options } {
  const means = (x: unknown) => x === undefined || typeof x === 'number';
  const level = p.minLevel === undefined ? '' : held(p.minLevel, means);
  const value = p.pactOnly === true ? (level === '' ? 'pact' : `pact:${level}`) : level;
  const written = means(p.minLevel) ? slotPriceWords(p as SlotPrice) : value;
  return { value, options: offering(SLOT_PRICES, value, written) };
}

function withSlotPrice(p: Price, value: string): Price {
  const { minLevel: _, pactOnly: _pact, ...rest } = p;
  if (value === 'pact') return { ...rest, pactOnly: true };
  return value === '' ? rest : { ...rest, minLevel: Number(value) };
}

/** Spends "Same pool": a price's new amount alone (`AmendedAmount`). */
const KEEPS = ':now';

/** A `cost` with no `resource`: how many of what an inherited action spends now. */
const keptOf = (v: unknown): Price | undefined =>
  isRecord(v) && !Object.hasOwn(v, 'resource') ? v : undefined;

/**
 * An action card's price: what using it spends (`cost`: a pool's uses, a spell
 * slot or a Hit Point Die) and what buys a use back once none are left
 * (`buyBack`), and the use it gives back. What no box here shows (a slot's
 * dice, the points it gives back, a use of its own too) is kept as written.
 * On a price for an inherited action (`amend`), an empty box keeps what it has
 * (`unset`), and Spends offers a new amount of the pool it spends now (`keeps`).
 */
function PriceFields({
  effect,
  title,
  resources,
  onChange,
  unset = 'Nothing',
  keeps = false,
  charges = false,
}: {
  effect: Eff;
  title: string;
  resources: readonly Eff[];
  onChange: (next: Eff) => void;
  unset?: string;
  keeps?: boolean;
  /**
   * Spends and Restores offer the item's charges (`ITEM_CHARGES`), which the
   * sheet spends from and gives back to the carried copy's pool, in place of a
   * pool of the list's own under that key. A buy-back is never paid in them.
   */
  charges?: boolean;
}) {
  const cost = priceOf(effect.cost);
  const kept = keeps ? keptOf(effect.cost) : undefined;
  const back = priceOf(effect.buyBack);
  const pools: Options = resources.map((r) => [String(r.key), `Uses of ${words(r.label)}`]);
  const payWith = (p: Price | undefined, hitDie: boolean): { value: string; options: Options } => {
    const value = hitDie && kept !== undefined ? KEEPS : p === undefined ? '' : String(p.resource);
    const own = hitDie && charges;
    const options: Options = [
      ['', unset],
      ...(hitDie && keeps ? ([[KEEPS, 'Same pool']] as const) : []),
      ...(own ? pools.filter(([k]) => k !== ITEM_CHARGES) : pools),
      ...(own ? ([[ITEM_CHARGES, 'Its charges']] as const) : []),
      [SLOT_COST, 'A spell slot'],
      ...(hitDie ? ([[HIT_DIE_COST, 'A Hit Point Die']] as const) : []),
    ];
    return { value, options: offering(options, value, value) };
  };
  const set = (key: 'cost' | 'buyBack', next: Price | undefined) => {
    const { [key]: _, ...rest } = effect;
    onChange(next === undefined ? (rest as Eff) : ({ ...rest, [key]: next } as Eff));
  };
  const pick = (
    label: string,
    box: { value: string; options: Options },
    to: (v: string) => void,
  ) => (
    <Field label={label}>
      <Select
        aria-label={`${title}: ${label}`}
        value={box.value}
        onChange={(e) => to(e.target.value)}
      >
        {box.options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
  const count = (p: Price, options: Options) => {
    const value = held(p.amount, (x) => typeof x === 'number' || x === 'varies');
    return { value, options: offering(options, value, value) };
  };
  const heals = cost?.hitDieHeals === undefined ? 'roll' : held(cost.hitDieHeals, isString);
  // The sheet gives back only a use it is told of, or one sharing the action's
  // name, so a new buy-back gives back a use of the pool the action spends. An
  // inherited action's pool is not known here, so its buy-back gives back its own.
  const restoring = (): Price => {
    const pool = cost !== undefined && isPool(cost) ? cost.resource : undefined;
    const own = keeps ? pool : (pool ?? resources[0]?.key);
    return own === undefined ? {} : { own };
  };
  const spend = (v: string) => {
    if (v === '') return set('cost', undefined);
    if (v !== KEEPS) return set('cost', repaid(cost ?? kept, v));
    // How many it spends stays, when it says.
    const now = cost !== undefined && isPool(cost) ? cost.amount : undefined;
    set('cost', { amount: typeof now === 'number' || now === 'varies' ? now : 1 });
  };
  const restores = (p: Price) => {
    const value = p.own === undefined ? '' : held(p.own, isString);
    const named: Options = resources.map((r) => [String(r.key), words(r.label)]);
    const options: Options = [
      ['', 'Same name'],
      ...(charges ? named.filter(([k]) => k !== ITEM_CHARGES) : named),
      ...(charges ? ([[ITEM_CHARGES, 'Its charges']] as const) : []),
    ];
    return { value, options: offering(options, value, value) };
  };
  return (
    <>
      {pick('Spends', payWith(cost, true), spend)}
      {kept !== undefined &&
        pick('How many', count(kept, AMOUNTS), (v) =>
          set('cost', { amount: v === 'varies' ? v : Number(v) }),
        )}
      {cost !== undefined &&
        isPool(cost) &&
        pick('How many', count(cost, AMOUNTS), (v) =>
          set('cost', { ...cost, amount: v === 'varies' ? v : Number(v) }),
        )}
      {/* A slot or a die pays for every use: the box shows there only to take a file's away. */}
      {cost !== undefined &&
        (isPool(cost) || cost.optional === true) &&
        pick(
          'Paid for',
          { value: cost.optional === true ? 'optional' : '', options: PAID_FOR },
          (v) => {
            const { optional: _, ...rest } = cost;
            set('cost', v === 'optional' ? { ...rest, optional: true } : rest);
          },
        )}
      {cost?.resource === SLOT_COST &&
        pick('Which slots', slotPriceBox(cost), (v) => set('cost', withSlotPrice(cost, v)))}
      {cost?.resource === HIT_DIE_COST &&
        pick('It heals', { value: heals, options: offering(HEALS, heals, heals) }, (v) => {
          const { hitDieHeals: _, ...rest } = cost;
          set('cost', v === 'roll' ? rest : { ...rest, hitDieHeals: v });
        })}
      {pick('Buys back a use with', payWith(back, false), (v) =>
        set('buyBack', v === '' ? undefined : repaid(back ?? restoring(), v)),
      )}
      {back !== undefined &&
        isPool(back) &&
        pick('Buy-back uses', count(back, COUNTS), (v) =>
          set('buyBack', { ...back, amount: Number(v) }),
        )}
      {back?.resource === SLOT_COST &&
        pick('Buy-back slots', slotPriceBox(back), (v) => set('buyBack', withSlotPrice(back, v)))}
      {back !== undefined &&
        pick('Restores', restores(back), (v) => {
          const { own: _, ...rest } = back;
          set('buyBack', v === '' ? rest : { ...rest, own: v });
        })}
    </>
  );
}

/**
 * A resource's key, from the name a player gives it. A price names a spell
 * slot or a Hit Point Die by its own word, so a pool never takes one: a price
 * naming it would be read as the slot or the die.
 */
function keyOf(label: string): string {
  const key =
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-|-$/g, '') || 'uses';
  return key === SLOT_COST || key === HIT_DIE_COST ? `${key}-uses` : key;
}

/**
 * A pool's or an action's "Class in the name" box, and the classes it names
 * when the name says the class only beside another (`ownClassBeside`).
 */
function NamingFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const beside = Array.isArray(effect.ownClassBeside) ? effect.ownClassBeside.map(String) : [];
  const naming =
    effect.ownClass === true ? 'own' : Array.isArray(effect.ownClassBeside) ? 'beside' : '';
  // The words as typed, so a comma can start the next name. Cards are their
  // place in the list, so this one can be handed another card's classes (the
  // one above it removed): then those are shown, not what was typed.
  const [held, setTyped] = useState(beside.join(', '));
  const typed = classList(held).join('\n') === beside.join('\n') ? held : beside.join(', ');
  const without = (): Eff => {
    const { ownClass: _, ownClassBeside: _beside, ...rest } = effect;
    return rest as Eff;
  };
  return (
    <>
      <Field label="Class in the name">
        <Select
          aria-label={`${title}: Class in the name`}
          value={naming}
          onChange={(e) => {
            const v = e.target.value;
            onChange(
              v === 'own'
                ? { ...without(), ownClass: true }
                : v === 'beside'
                  ? { ...without(), ownClassBeside: classList(typed) }
                  : without(),
            );
          }}
        >
          {NAMINGS.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      {naming === 'beside' && (
        <Field label="Beside which classes">
          <input
            aria-label={`${title}: Beside which classes`}
            value={typed}
            placeholder="Paladin, Cleric"
            onChange={(e) => {
              setTyped(e.target.value);
              onChange({ ...without(), ownClassBeside: classList(e.target.value) });
            }}
            className={fieldClass}
          />
        </Field>
      )}
    </>
  );
}

/** An amend card's line: which action, and what it now spends and buys a use back with. */
export function amendWords(a: Eff): string {
  const named = typeof a.label === 'string' ? a.label.trim() : '';
  const kept = keptOf(a.cost);
  const n = kept?.amount;
  const uses =
    n === 'varies'
      ? 'as many uses as you choose'
      : typeof n === 'number'
        ? `${n} ${n === 1 ? 'use' : 'uses'}`
        : 'uses';
  const more =
    kept === undefined
      ? priceWords(a)
      : `, spends ${uses} of its pool${priceWords({ ...a, cost: undefined })}`;
  return `${named === '' ? 'Its first action' : named}${more === '' ? ', as it is' : more}`;
}

/**
 * A copy's prices on what it inherits (`amend`, rule pack port 3g): each on the
 * first action the original gives it, or on each of a name, as the sheet names
 * it. Its own cards are its own to price, so these never reach them.
 */
export function AmendCards({
  amend,
  inherits,
  resources,
  readOnly,
  onChange,
}: {
  amend: unknown;
  inherits: string;
  resources: readonly Eff[];
  readOnly: boolean;
  onChange: (next: Eff[]) => void;
}) {
  const list: Eff[] = Array.isArray(amend) ? (amend as Eff[]) : [];
  const { problems } = readMechanics({ v: 1, amend: list });
  const title = 'Price';
  const setAt = (i: number, next: Eff) => onChange(list.map((x, j) => (j === i ? next : x)));
  return (
    <>
      {list.map((a, i) => (
        <div
          // Prices have no id of their own; a card is its place in the list.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={i}
          className="flex flex-col gap-2 rounded-control bg-surface py-2.5 pr-1 pl-3 ring-1 ring-line ring-inset"
        >
          <div className="flex items-center gap-2">
            <b className="flex-1 text-caption text-ink-muted">Price of what {inherits} gives</b>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${amendWords(a)}`}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
                className="tap -my-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
              >
                <X size={16} aria-hidden />
              </button>
            )}
          </div>
          <span className="pr-2 text-body-strong">{amendWords(a)}</span>
          {!readOnly && (
            <div className="grid grid-cols-2 items-end gap-2 pr-2">
              <Field label="Action">
                <input
                  aria-label={`${title}: Action`}
                  value={typeof a.label === 'string' ? a.label : ''}
                  placeholder="Its first"
                  onChange={(e) => {
                    const { label: _, ...rest } = a;
                    setAt(
                      i,
                      e.target.value === '' ? (rest as Eff) : { ...rest, label: e.target.value },
                    );
                  }}
                  className={fieldClass}
                />
              </Field>
              <PriceFields
                effect={a}
                title={title}
                resources={resources}
                unset="As it is"
                keeps
                onChange={(next) => setAt(i, next)}
              />
            </div>
          )}
          {problems
            .filter((p) => p.startsWith(`amend ${i + 1}:`))
            .map((p) => p.replace(/^amend \d+: /, ''))
            .map((p) => (
              <p key={p} className="flex items-start gap-1.5 pr-2 text-caption text-danger">
                <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
                This does not count yet: {p}
              </p>
            ))}
        </div>
      ))}
      {!readOnly && (
        <div className="-mx-1.5 flex flex-wrap">
          <Chip
            tone="outline"
            className="px-2.5"
            onClick={() => onChange([...list, { cost: { amount: 1 } } as unknown as Eff])}
          >
            <Plus size={14} aria-hidden />
            Change its price
          </Chip>
        </div>
      )}
    </>
  );
}

const naming = (p: { effect: Eff; title: string; onChange: (next: Eff) => void }) => (
  <NamingFields effect={p.effect} title={p.title} onChange={p.onChange} />
);

/** The heading its cards are listed under on the add sheet. */
export const group = 'Uses, actions and picks';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['resource'],
    add: 'Uses per rest',
    does: 'A number of uses that come back on a rest',
    make: () => ({ kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' }),
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'max', label: 'Uses', type: 'amount' },
      {
        key: 'reset',
        label: 'Back on',
        type: 'pick',
        options: [
          ['short', 'A short or long rest'],
          ['long', 'A long rest'],
        ],
      },
    ],
    line: (e) =>
      `${words(e.label)}${classWords(e)}: ${amount(e.max, false)} ${e.max === 1 ? 'use' : 'uses'}, back on ${restWords(e.reset)}`,
    // The key follows the name, and an action spending it follows the key.
    set: (e, key, v, text) => {
      if (key !== 'label') return undefined;
      const next = keyOf(text);
      return { next: { ...e, label: v, key: next }, renamed: [String(e.key), next] };
    },
    beforeRules: naming,
    notInPick: true,
  },
  {
    kinds: ['action'],
    add: 'Action',
    does: 'An action, bonus action or reaction on the sheet, and what it costs',
    make: () => ({ kind: 'action', economy: 'action', label: 'New action' }),
    fields: [
      {
        key: 'economy',
        label: 'Takes',
        type: 'pick',
        options: [
          ['action', 'An action'],
          ['bonus', 'A bonus action'],
          ['reaction', 'A reaction'],
          // A rider on a hit, a spell or a roll: tapping it spends and takes nothing from the turn.
          ['none', 'No action'],
        ],
      },
      { key: 'label', label: 'Name', type: 'text' },
    ],
    line: (e) =>
      `${ECONOMY_WORDS[String(e.economy)] ?? 'Action'}: ${words(e.label)}${classWords(e)}${priceWords(e)}`,
    boxes: (p) => (
      <PriceFields
        effect={p.effect}
        title={p.title}
        resources={p.resources}
        charges={p.charges}
        onChange={p.onChange}
      />
    ),
    beforeRules: naming,
    notInPick: true,
  },
  {
    // Its id is set as it is added (`EffectCards`), one the entry's other picks do not have.
    kinds: ['pick'],
    add: 'Pick',
    does: 'Asks the player to choose, such as a skill or a damage type',
    make: () => NEW_PICK,
    fields: [],
    line: pickWords,
    above: (p) => (
      <PickFields
        effect={p.effect}
        title={p.title}
        problems={p.problems}
        onChange={p.onChange}
        gives={(g) => (
          <p.List
            effects={g.effects}
            readOnly={false}
            spells={p.spells}
            resources={p.resources}
            prefix={g.prefix}
            addLabel={g.addLabel}
            fills={g.fills}
            picked={g.picked}
            onChange={(next) => g.onChange(next)}
          />
        )}
      />
    ),
    // A pick's cards of what it gives say their own problems; the rest are the card's.
    ownProblems: (problems, e, editable) =>
      editable && !KEPT_ASKS.has(String(e.ask))
        ? problems.filter((p) => !/^"(gives|options\.\d+\.gives)": effect \d+/.test(p))
        : problems,
    notInPlay: true,
    notInPick: true,
  },
];
