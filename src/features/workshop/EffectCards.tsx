/**
 * What an entry does on the sheet, built as cards (ADR-001, D2; the Spell
 * board's A). Each card is one effect kind the engine already counts, read
 * back as a sentence, with the few controls that kind takes. The list is
 * stored as `castGuidance.effects` (`StoredEffect`) and checked by the same
 * reader the sheet uses, so a card that would not count says why, here.
 *
 * The cards live in `cards/`, one file for each group of board 4 (ADR-002,
 * D6), found by name as the Workshop finds its editors: a new card goes in its
 * group's file and nowhere else. This file is the list that holds them.
 */
import { CircleAlert, Plus, X } from 'lucide-react';
import { useContext, useRef } from 'react';
import { isRecord, type StoredState } from '@/engine/castGuidance';
import { pickGivesProblems, readStoredEffects } from '@/engine/effects/mechanics';
import type { PickFill } from '@/engine/effects/picks';
import { Chip } from '@/ui/Chip';
import { askChoice } from '@/ui/dialogs';
import { fieldClass } from '@/ui/TextField';
import { AmendCards } from './cards/actions';
import type { CardProps, Eff, FieldSpec, KindSpec, Options, SpellOption } from './cards/kit/types';
import {
  asWritten,
  EDITIONS,
  editionBox,
  editionOf,
  offering,
  PICKED,
  pickedWords,
  STATES,
  shown,
  stateBox,
  stored,
  word,
} from './cards/kit/words';
import type { EditorProps } from './editorTypes';
import { Field, Section, Select } from './fields';
import { EntryVersions, freshPickId, pickIdsIn } from './pickIds';

export { amendWords } from './cards/actions';
export type { SpellOption } from './cards/kit/types';
export {
  asWritten,
  BY_LEVEL,
  editionBox,
  editionOf,
  firstWords,
  isByAnswer,
  isByLevel,
} from './cards/kit/words';
export { rollKindOf } from './cards/rolls';

/** The cards each group's file gives (`cards/*.tsx`), its tests left out. */
const FILES = import.meta.glob<{ cards?: readonly KindSpec[] }>(
  ['./cards/*.tsx', '!./cards/*.test.tsx'],
  { eager: true },
);

/**
 * The order the add list offers them in, and the order a card is found in for
 * a kind two cards share (Spell attacks before Attack rolls). A card not named
 * here comes after these, in its file's order.
 */
const ORDER = [
  'Ability score',
  'Ability score is at least',
  'Armor Class',
  'Initiative',
  'Speed',
  'Fly, swim or climb',
  'Sense',
  'Hit points',
  'Hit points per level',
  'Saving throws',
  'Skill',
  'Save proficiency',
  'Language',
  'Tool',
  'Weapon',
  'Resistance',
  'Condition immunity',
  'Advantage',
  'Added die',
  'Paid extra',
  'Reroll',
  'Spell attacks',
  'Spell save DC',
  'Cast a spell',
  'Attack rolls',
  'Damage',
  'Uses per rest',
  'Action',
  'Reminder',
  'Pick',
];

const rank = (k: KindSpec) => {
  const at = ORDER.indexOf(k.add);
  return at === -1 ? ORDER.length : at;
};

const KINDS: readonly KindSpec[] = Object.keys(FILES)
  .sort()
  .flatMap((path) => FILES[path]?.cards ?? [])
  .map((k, at) => ({ k, at }))
  .sort((a, b) => rank(a.k) - rank(b.k) || a.at - b.at)
  .map(({ k }) => k);

const specOf = (e: Eff) => KINDS.find((k) => k.kinds.includes(e.kind) && (k.is?.(e) ?? true));

/** The kinds offered first, as chips; the rest are one tap further, under More. */
const FIRST = ['Ability score', 'Armor Class', 'Speed', 'Skill', 'Resistance', 'Uses per rest'];

/** A kind's card, for a kind a file gives that no card is for. */
const specFor = (kind: string) => KINDS.find((k) => k.kinds.includes(kind));

/**
 * Kinds that never go in play, and those what a pick gives is not built with,
 * as their cards say (`notInPlay`, `notInPick`).
 */
const notInPlay = (kind: string) => specFor(kind)?.notInPlay === true;
const notInPick = (kind: string) => specFor(kind)?.notInPick === true;

/** The choice a card's dropdown shows. */
function pickValue(e: Eff, f: Extract<FieldSpec, { type: 'pick' }>): string {
  return f.key === 'kind' ? e.kind : (f.value?.(e) ?? shown(e, f));
}

/**
 * A card's dropdown's choices, with a value a file gives that none of them is
 * shown as written (a homebrew condition, a skill the list has not), so the box
 * never shows its first choice for it, unsaid. A level table, or the one a pick
 * answers, has a choice of its own.
 */
function pickOptions(e: Eff, f: Extract<FieldSpec, { type: 'pick' }>): Options {
  const v = pickValue(e, f);
  return v === '' || v.includes('{pick') ? f.options : offering(f.options, v, `${v}, as written`);
}

/**
 * The lists of what a pick gives, each by its place: "gives", "givesAll",
 * "always" (given in place of nothing), "options 2 gives".
 */
function givenLists(x: Eff): Array<readonly [string, readonly unknown[]]> {
  if (x.kind !== 'pick') return [];
  const options = Array.isArray(x.options) ? x.options : [];
  return [
    ...(['gives', 'givesAll', 'always'] as const).flatMap((k) =>
      Array.isArray(x[k]) ? [[k, x[k] as unknown[]] as const] : [],
    ),
    ...options.flatMap((o, n) =>
      isRecord(o) && Array.isArray(o.gives) ? [[`options ${n} gives`, o.gives] as const] : [],
    ),
  ];
}

/** A pick's lists of what it gives (`givenLists`), each effect `g` turned by `turn`. */
function regiven(
  x: Eff,
  turn: (g: unknown, at: string, k: number) => unknown,
): Partial<Record<'gives' | 'givesAll' | 'always' | 'options', unknown>> {
  if (x.kind !== 'pick') return {};
  const each = (list: unknown, at: string) =>
    Array.isArray(list) ? list.map((g, k) => turn(g, at, k)) : list;
  return {
    ...(x.gives === undefined ? {} : { gives: each(x.gives, 'gives') }),
    ...(x.givesAll === undefined ? {} : { givesAll: each(x.givesAll, 'givesAll') }),
    ...(x.always === undefined ? {} : { always: each(x.always, 'always') }),
    ...(Array.isArray(x.options)
      ? {
          options: x.options.map((o, n) =>
            isRecord(o) && o.gives !== undefined
              ? { ...o, gives: each(o.gives, `options ${n} gives`) }
              : o,
          ),
        }
      : {}),
  };
}

/** A price's fields that name a pool, for its cost and its buy-back. */
const PRICE_KEYS = [
  ['cost', ['resource', 'slotRefills']],
  ['buyBack', ['resource', 'own']],
] as const;

/** A price's fields that follow the renamed pool (`follows`), named for its new key. */
function renamedIn(
  key: 'cost' | 'buyBack',
  v: unknown,
  to: string,
  follows: (field: string) => boolean,
): Record<string, Record<string, unknown>> {
  if (!isRecord(v)) return {};
  return {
    [key]: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, follows(k) ? to : x])),
  };
}

/** A problem in a player's words, where the reader's are not. */
function problemWords(spec: KindSpec | undefined, p: string): string {
  return (
    spec?.problemWords?.(p) ??
    (p === '"ownClassBeside" is a list' ? 'name a class it stands beside' : p)
  );
}

function Card({
  effect,
  problems,
  list,
  pools,
  spells,
  inPlay,
  readOnly,
  onChange,
  onRemove,
  prefix = '',
  picked,
  inPick = false,
  charges = false,
}: {
  effect: Eff;
  problems: string[];
  list: readonly Eff[];
  pools: readonly Eff[];
  /** The spells a "Cast a spell" card can name; without them it is not offered. */
  spells?: readonly SpellOption[];
  inPlay: boolean;
  readOnly: boolean;
  onChange: (next: Eff, renamedKey?: [string, string]) => void;
  onRemove: () => void;
  /** Words before its box names, for a card of what a pick gives: "Each pick gives: ". */
  prefix?: string;
  /** What the pick it is given by answers (`ask`), offered as "The pick" where it fits. */
  picked?: string;
  /** It is one of what a pick gives. */
  inPick?: boolean;
  /** An action's cost can spend the item's charges (`EffectCards`' `holdsCharges`). */
  charges?: boolean;
}) {
  const spec = specOf(effect);
  const name = spec?.add ?? effect.kind;
  const title = `${prefix}${name}`;
  // What a pick gives holds no pool or action the boxes could build (`notInPick`).
  const fixed = inPick && notInPick(effect.kind);
  const editable = !readOnly && !fixed;
  const line = ((s: string) => (inPick ? pickedWords(s) : s))(spec?.line(effect) ?? effect.kind);
  const own = spec?.ownProblems?.(problems, effect, editable) ?? problems;
  // One of each key: a pool given once for each rules version (`edition`) is one
  // pool, the card's own or one kept elsewhere (a class's).
  // In what a pick gives, a pool named for the one picked is said so (`pickedWords`).
  const resources = [...list.filter((x) => x.kind === 'resource'), ...pools]
    .filter((x, i, all) => typeof x.key === 'string' && all.findIndex((y) => y.key === x.key) === i)
    .map((x) =>
      inPick && typeof x.label === 'string' ? { ...x, label: pickedWords(x.label) } : x,
    );
  const state = typeof effect.while === 'string' ? effect.while : '';
  const edition = editionOf(effect);
  const props: CardProps = {
    effect,
    title,
    problems,
    resources,
    spells,
    charges,
    picked,
    inPick,
    onChange,
    List: EffectCards,
  };
  const set = (f: FieldSpec, text: string) => {
    const v = stored(f, text);
    if (f.key === 'kind') return onChange({ ...effect, kind: String(v) });
    const done = spec?.set?.(effect, f.key, v, text);
    if (done !== undefined) onChange(done.next, done.renamed);
    else onChange({ ...effect, [f.key]: v });
  };
  const when = stateBox(effect, spec?.early === true);
  return (
    <div className="flex flex-col gap-2 rounded-control bg-surface py-2.5 pr-1 pl-3 ring-1 ring-line ring-inset">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-caption text-ink-muted">{name}</b>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Remove ${line}`}
            onClick={onRemove}
            className="tap -my-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      <span className="pr-2 text-body-strong">{line}</span>
      {spec?.above !== undefined && editable && spec.above(props)}
      {fixed && !readOnly && (
        <span className="pr-2 text-caption text-ink-muted">Kept as written</span>
      )}
      {spec !== undefined && editable && (
        <div className="grid grid-cols-2 items-end gap-2 pr-2">
          {spec.fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === 'pick' ? (
                <Select
                  aria-label={`${title}: ${f.label}`}
                  value={pickValue(effect, f)}
                  onChange={(e) =>
                    f.apply !== undefined
                      ? onChange(f.apply(effect, e.target.value))
                      : set(f, e.target.value)
                  }
                >
                  {asWritten(effect[f.key]) !== undefined && (
                    <option value="">{asWritten(effect[f.key])}</option>
                  )}
                  {(spec.picks?.(picked) === f.key || shown(effect, f).includes('{pick')) && (
                    <option value={PICKED}>The pick</option>
                  )}
                  {pickOptions(effect, f).map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
                </Select>
              ) : (
                <input
                  aria-label={`${title}: ${f.label}`}
                  value={shown(effect, f)}
                  placeholder={asWritten(effect[f.key])}
                  onChange={(e) => set(f, e.target.value)}
                  className={fieldClass}
                />
              )}
            </Field>
          ))}
          {spec.boxes?.(props)}
          {/* An effect in play holds for as long as it lasts, with no When of its
              own: its box shows only while a file sets one, to take it away. */}
          {spec.stateful === true && (!inPlay || effect.while !== undefined) && (
            <Field label="When">
              <Select
                aria-label={`${title}: When`}
                value={when.value}
                onChange={(e) => {
                  const { while: _, ...rest } = effect;
                  onChange(
                    e.target.value === ''
                      ? (rest as Eff)
                      : { ...rest, while: e.target.value as StoredState },
                  );
                }}
              >
                {when.options
                  .filter(([v]) => !inPlay || v === '' || v === when.value)
                  .map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          {spec.beforeRules?.(props)}
          {/* An effect in play holds under the sheet's rules: its box shows only
              while a file sets one, to take it away. */}
          {(!inPlay || effect.edition !== undefined) && (
            <Field label="Rules">
              <Select
                aria-label={`${title}: Rules`}
                value={editionBox(effect).value}
                onChange={(e) => {
                  const { edition: _, ...rest } = effect;
                  const v = e.target.value;
                  onChange(v === '' ? (rest as Eff) : { ...rest, edition: v as typeof edition });
                }}
              >
                {editionBox(effect).options.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {spec.after?.(props)}
        </div>
      )}
      {state !== '' && readOnly && (
        <span className="text-caption text-ink-muted">{word(STATES, state)}</span>
      )}
      {edition !== undefined && readOnly && (
        <span className="text-caption text-ink-muted">{word(EDITIONS, edition)}</span>
      )}
      {own.map((p) => (
        <p key={p} className="flex items-start gap-1.5 pr-2 text-caption text-danger">
          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          This does not count yet: {problemWords(spec, p)}
        </p>
      ))}
    </div>
  );
}

/**
 * What More offers, by the names the add list gives: the kinds past the first
 * chips, with Cast a spell only where spells can be named, in play only what
 * an effect in play may do, and only kinds whose new card `counts` where the
 * list's host says.
 */
export function moreKinds({
  inPlay,
  spells,
  inPick = false,
  counts,
}: {
  inPlay: boolean;
  spells: boolean;
  /** For what a pick gives, whose one add button offers every kind it may hold. */
  inPick?: boolean;
  counts?: (e: Eff) => boolean;
}): string[] {
  return KINDS.filter(
    (k) =>
      (inPick ? !k.kinds.some(notInPick) : !FIRST.includes(k.add)) &&
      (spells || k.add !== 'Cast a spell') &&
      !(inPlay && k.kinds.some(notInPlay)) &&
      (counts?.(k.make()) ?? true),
  ).map((k) => k.add);
}

/**
 * The effects list: a card per effect, then the kinds to add. `inherits` names
 * the entry a copy is made from, whose own mechanics it keeps unless the
 * player starts from nothing (`replace`).
 */
export function EffectCards({
  effects,
  onChange,
  readOnly,
  inherits,
  replace,
  onReplace,
  spells,
  hide,
  holdsCharges = false,
  resources,
  inPlay = false,
  amend,
  onAmend,
  prefix,
  addLabel,
  fills,
  picked,
  counts,
}: {
  effects: unknown;
  /** The effects, and the prices (`amend`) when renaming a pool moved them too. */
  onChange: (next: Eff[], amend?: Eff[]) => void;
  readOnly: boolean;
  /**
   * A copy's prices on the actions it inherits (`amend`), offered while it
   * still does what `inherits` does.
   */
  amend?: unknown;
  onAmend?: (next: Eff[]) => void;
  /**
   * The effects are in play (a condition's, a spell's on its target): they hold
   * under the sheet's rules, so no card offers a rules version.
   */
  inPlay?: boolean;
  inherits?: string;
  replace?: boolean;
  onReplace?: (replace: boolean) => void;
  /** The spells a "Cast a spell" card can name; without them it is not offered. */
  spells?: readonly SpellOption[];
  /** Effects another control of the editor shows, left out of the cards (an item's charges). */
  hide?: (e: Eff) => boolean;
  /**
   * The list is an item's own: while it holds a `charges` effect (shown by
   * the editor and left out with `hide`), an action's cost can spend them.
   */
  holdsCharges?: boolean;
  /** Uses kept elsewhere that an action or a spell here can spend too (a class's pools). */
  resources?: readonly Eff[];
  /**
   * The effects are what a pick gives (`gives`): each card's box names start
   * with `prefix`, its one add button is named `addLabel`, and they are read
   * as the pick's reader reads them, with each of `fills` filled in.
   */
  prefix?: string;
  addLabel?: string;
  fills?: readonly PickFill[];
  /** What the pick answers (`ask`), offered as "The pick" where a box fits it. */
  picked?: string;
  /**
   * Whether an effect counts where this list is (a condition's counts less
   * than any effect in play): a kind is offered only when its new card would.
   * A card a file already holds is shown whatever it is, with why it does not
   * count. A card that starts unfinished (Cast a spell names no spell yet)
   * never counts as made, so a host offering it needs more than the reader.
   */
  counts?: (e: Eff) => boolean;
}) {
  const list: Eff[] = Array.isArray(effects) ? (effects as Eff[]) : [];
  const amends: Eff[] = Array.isArray(amend) ? (amend as Eff[]) : [];
  const inPick = fills !== undefined;
  // An item's charges effect reads as a problem here, which goes to its card,
  // and `hide` leaves that card out: the editor shows the reader's own words.
  const problems = inPick ? pickGivesProblems(list, fills) : readStoredEffects(list).problems;
  const charges = holdsCharges && list.some((e) => e.kind === 'charges');
  const versions = useContext(EntryVersions);
  const problemsOf = (i: number) =>
    problems
      .filter((p) => p.startsWith(`effect ${i + 1}:`) || p.startsWith(`effect ${i + 1} (`))
      .map((p) => p.replace(/^effect \d+( \([^)]*\))?: /, ''));
  // What follows a pool being renamed: what names it as its name starts to
  // change, kept while it changes. On the way to Kindle its key is ki for a
  // moment, and what spends the class's Ki (or a pool of the entry's own named
  // Ki) stays put. It is the same rename while the card typed in is one that
  // follows it (the pool's own card, keyed or not, or a pool that shared its
  // key when the rename began, its twin for the other rules version among
  // them) and nothing else has changed since the last step, so each place kept
  // names the key the last step gave it. A pool typed in after another took
  // its key starts a rename of its own, which takes along what names that key.
  const following = useRef<{ was: string; at: Set<string> }>(undefined);
  /**
   * Where `x` names `from`, as `place` and the field: a pool's key (the same
   * pool for the other rules version, `edition`), the uses a spell is cast
   * with, and on an action or a price on what a copy inherits (`priced`), its
   * cost (and the points a slot gives back), what buys a use back and the use
   * it gives back. A pick's are those of what it gives, its options' too.
   */
  const naming = (x: Eff, place: string, from: string, priced = x.kind === 'action'): string[] => [
    ...givenLists(x).flatMap(([at, given]) =>
      given.flatMap((g, k) => (isRecord(g) ? naming(g as Eff, `${place} ${at} ${k}`, from) : [])),
    ),
    ...(x.kind === 'resource' && x.key === from ? [`${place} key`] : []),
    ...(x.kind === 'grantSpell' && x.resourceKey === from ? [`${place} resourceKey`] : []),
    ...PRICE_KEYS.flatMap(([key, fields]) => {
      const price = x[key];
      return priced && isRecord(price)
        ? fields.filter((f) => price[f] === from).map((f) => `${place} ${key} ${f}`)
        : [];
    }),
  ];
  /**
   * The cards, with card `i` now `next`, and the prices on what it inherits,
   * after its pool's key changed `from` `to`: what follows it is named `to`.
   * The prices are given only to a host that takes them (`onAmend`), when
   * there are some.
   */
  const follow = (
    i: number,
    next: Eff,
    [from, to]: readonly [string, string],
  ): [Eff[], Eff[] | undefined] => {
    const last = following.current;
    const at =
      last?.at.has(`effect ${i} key`) === true && last.was === JSON.stringify([list, amends])
        ? last.at
        : new Set([
            // A pool a file gives no key (or a number) names none, but is the one renamed.
            `effect ${i} key`,
            ...list.flatMap((x, j) => naming(x, `effect ${j}`, from)),
            ...amends.flatMap((a, k) => naming(a, `amend ${k}`, from, true)),
          ]);
    const renamed = (x: Eff, place: string): Eff => ({
      ...x,
      ...regiven(x, (g, at, k) => (isRecord(g) ? renamed(g as Eff, `${place} ${at} ${k}`) : g)),
      ...(at.has(`${place} key`) ? { key: to, label: next.label } : {}),
      ...(at.has(`${place} resourceKey`) ? { resourceKey: to } : {}),
      ...Object.assign(
        {},
        ...PRICE_KEYS.map(([key]) =>
          renamedIn(key, x[key], to, (f) => at.has(`${place} ${key} ${f}`)),
        ),
      ),
    });
    const effects = list.map((x, j) => (j === i ? next : renamed(x, `effect ${j}`)));
    const amended =
      onAmend === undefined || amends.length === 0
        ? undefined
        : amends.map((a, k) => renamed(a, `amend ${k}`));
    following.current = { was: JSON.stringify([effects, amended ?? amends]), at };
    return [effects, amended];
  };
  const add = (spec: KindSpec) => {
    const made = spec.make();
    // A new pick takes an id none of the entry's picks has, so each is asked.
    const next =
      made.kind === 'pick' ? { ...made, id: freshPickId(pickIdsIn([list, ...versions()])) } : made;
    onChange([...list, next]);
  };
  const more = async () => {
    const id = await askChoice({
      title: inPick ? 'What does each pick give?' : 'What does it do?',
      options: moreKinds({ inPlay, spells: spells !== undefined, inPick, counts }).map((add) => ({
        id: add,
        label: add,
      })),
    });
    const spec = KINDS.find((k) => k.add === id);
    if (spec !== undefined) add(spec);
  };
  return (
    <div className="flex flex-col gap-2">
      {inherits !== undefined && (
        <label className="flex min-h-tap items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            disabled={readOnly}
            checked={replace !== true}
            onChange={(e) => onReplace?.(!e.target.checked)}
          />
          Also does what {inherits} does on the sheet
        </label>
      )}
      {inherits !== undefined && replace !== true && onAmend !== undefined && (
        <AmendCards
          amend={amend}
          inherits={inherits}
          resources={[...list.filter((x) => x.kind === 'resource'), ...(resources ?? [])].filter(
            (x, i, all) => typeof x.key === 'string' && all.findIndex((y) => y.key === x.key) === i,
          )}
          readOnly={readOnly}
          onChange={onAmend}
        />
      )}
      {list.map((effect, i) =>
        hide?.(effect) === true ? null : (
          <Card
            // Effects have no id of their own; a card is its place in the list.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            effect={effect}
            list={list}
            pools={resources ?? []}
            spells={spells}
            problems={problemsOf(i)}
            inPlay={inPlay}
            readOnly={readOnly}
            prefix={prefix}
            picked={picked}
            inPick={inPick}
            charges={charges}
            onRemove={() => onChange(list.filter((_, j) => j !== i))}
            onChange={(next, renamed) =>
              renamed === undefined
                ? onChange(list.map((x, j) => (j === i ? next : x)))
                : onChange(...follow(i, next, renamed))
            }
          />
        ),
      )}
      {list.filter((e) => hide?.(e) !== true).length === 0 && (
        <p className="text-caption text-ink-muted">
          {inPick
            ? 'Nothing yet.'
            : // Another control of the editor shows what is hidden (an item's charges).
              `Nothing ${list.length > 0 ? 'else ' : ''}for the sheet to count yet. Add what it does, and the sheet adds it up.`}
        </p>
      )}
      {!readOnly && inPick && (
        <div className="-mx-1.5 flex flex-wrap">
          <Chip tone="outline" className="px-2.5" aria-label={addLabel} onClick={() => void more()}>
            <Plus size={14} aria-hidden />
            Add
          </Chip>
        </div>
      )}
      {!readOnly && !inPick && (
        <div className="-mx-1.5 flex flex-wrap">
          {KINDS.filter((k) => FIRST.includes(k.add) && (counts?.(k.make()) ?? true)).map((k) => (
            <Chip key={k.add} tone="outline" className="px-2.5" onClick={() => add(k)}>
              <Plus size={14} aria-hidden />
              {k.add}
            </Chip>
          ))}
          <Chip tone="outline" className="px-2.5" onClick={() => void more()}>
            More
          </Chip>
        </div>
      )}
    </div>
  );
}

/**
 * The `castGuidance` patch for a copy's prices on what it inherits: an empty
 * list leaves none; `undefined` (no change to them) patches nothing.
 */
export function amendPatch(amend: Eff[] | undefined): Record<string, unknown> {
  return amend === undefined ? {} : { amend: amend.length > 0 ? amend : undefined };
}

/** `castGuidance` with `patch` applied, or undefined once it says nothing. */
export function guidanceWith(
  g: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { v: 1, ...(isRecord(g) ? g : {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return Object.keys(next).some((k) => k !== 'v') ? next : undefined;
}

/** An entry's own effects, as a section of its editor. */
export function EntryEffects({
  draft,
  change,
  original,
  readOnly,
}: Pick<EditorProps, 'draft' | 'change' | 'original' | 'readOnly'>) {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const set = (patch: Record<string, unknown>) =>
    change({ castGuidance: guidanceWith(draft.castGuidance, patch) });
  return (
    <Section title="What it does on the sheet">
      <EffectCards
        effects={g.effects}
        readOnly={readOnly}
        inherits={original !== undefined ? String(original.name) : undefined}
        replace={g.replace === true}
        onReplace={(replace) =>
          set(replace ? { replace: true, amend: undefined } : { replace: undefined })
        }
        onChange={(effects, amend) =>
          set({ effects: effects.length > 0 ? effects : undefined, ...amendPatch(amend) })
        }
        amend={g.amend}
        onAmend={(amend) => set(amendPatch(amend))}
      />
    </Section>
  );
}
