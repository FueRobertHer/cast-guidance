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
import { isRecord, MOMENTS, type MomentId } from '@/engine/castGuidance';
import { pickGivesProblems, readStoredEffects } from '@/engine/effects/mechanics';
import type { PickFill } from '@/engine/effects/picks';
import { readMoments } from '@/engine/moments';
import { Chip } from '@/ui/Chip';
import { askChoice } from '@/ui/dialogs';
import { fieldClass } from '@/ui/TextField';
import { AmendCards } from './cards/actions';
import { Modifiers, type MomentPlace, momentWords } from './cards/kit/modifiers';
import type { CardProps, Eff, FieldSpec, KindSpec, Options, SpellOption } from './cards/kit/types';
import {
  asWritten,
  EDITIONS,
  editionOf,
  offering,
  PICKED,
  pickedWords,
  STATES,
  shown,
  stored,
  word,
} from './cards/kit/words';
import type { EditorProps } from './editorTypes';
import { Field, Section, Select } from './fields';
import { EntryVersions, freshPickId, pickIdsIn } from './pickIds';
import { SpellChoices } from './spellChoices';

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
const FILES = import.meta.glob<{ cards?: readonly KindSpec[]; group?: string }>(
  ['./cards/*.tsx', '!./cards/*.test.tsx'],
  { eager: true },
);

/** The heading a card is listed under on the add sheet: its file's group. */
const GROUP = new Map(
  Object.values(FILES).flatMap((f) => (f.cards ?? []).map((k) => [k, f.group] as const)),
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
  'Ability check bonus',
  'Advantage',
  'Added die',
  'Die offered after a roll',
  'Paid extra',
  'Reroll',
  'Spell attacks',
  'Spell save DC',
  'Spell damage',
  'Spells added to a class list',
  'Cast a spell',
  'Attack rolls',
  'Damage',
  'Extra die on a hit',
  'Critical hit range',
  'Natural weapon',
  'Bigger unarmed strike',
  'Uses per rest',
  'Uses back on a short rest',
  'Action',
  'One more action',
  'Reminder',
  'Note',
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

const isObject = (x: unknown): x is object => typeof x === 'object' && x !== null;

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

type Drawn = Record<string, unknown> & {
  at: MomentId;
  do: [Record<string, unknown> & { effects: Eff[] }];
};

/** A moment the cards draw: at a moment the app sees, it puts one effect on, and only that. */
function drawn(m: unknown): m is Drawn {
  if (!isRecord(m) || !MOMENTS.includes(m.at as MomentId)) return false;
  const [o, ...more] = Array.isArray(m.do) ? m.do : [];
  return (
    more.length === 0 &&
    isRecord(o) &&
    o.kind === 'addEffect' &&
    Array.isArray(o.effects) &&
    o.effects.length > 0 &&
    o.effects.every((x) => isRecord(x) && typeof x.kind === 'string')
  );
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
  place,
  toMoment,
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
  /** Where it sits in a moment, for a card a moment puts on. */
  place?: MomentPlace;
  /** Puts it on at a moment instead, where the list keeps moments. */
  toMoment?: (at: MomentId) => void;
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
    inPlay,
    atMoment: place !== undefined,
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
          {spec.beforeRules?.(props)}
          {spec.after?.(props)}
        </div>
      )}
      {spec !== undefined && editable && (
        <Modifiers
          spec={spec}
          effect={effect}
          title={title}
          inPlay={inPlay}
          inPick={inPick}
          onChange={onChange}
          place={place}
          toMoment={toMoment}
        />
      )}
      {place !== undefined && readOnly && (
        <span className="text-caption text-ink-muted">{momentWords(place)}</span>
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
  spells: hostSpells,
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
  moments,
  onMoments,
  momentName,
  hostName,
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
  /**
   * The spells a "Cast a spell" card can name; without them those of the page
   * (`SpellChoices`), and without those it is not offered.
   */
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
  /**
   * What happens at moments (`castGuidance.moments`), where the list's host
   * keeps them (`onMoments`): a card can be put on at a moment (Counts when)
   * for a time (Lasts). A moment that puts one effect on is drawn as its
   * cards; every other is kept as written. `onMoments` is given the moments,
   * and the effects too when a card moved between them.
   */
  moments?: unknown;
  onMoments?: (moments: unknown[], effects?: Eff[]) => void;
  /** The name what a moment puts on goes on the sheet under: the entry's. */
  momentName?: string;
  /**
   * The name of what gives these effects (a trait's, a feature's, the
   * entry's): a new pool is named for it, so two features' pools are two.
   */
  hostName?: string;
}) {
  const pageSpells = useContext(SpellChoices);
  // A page with no spells in its books has none to name, so Cast a spell waits.
  const spells = hostSpells ?? (pageSpells?.length ? pageSpells : undefined);
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
  const held: unknown[] = onMoments !== undefined && Array.isArray(moments) ? moments : [];
  // Moments a file gives as something other than a list are kept as written: no card goes in.
  const movable = onMoments !== undefined && (moments === undefined || Array.isArray(moments));
  const named = momentName ?? 'Effect';
  // An effect a moment puts on replaces one of the same name already on, so
  // each new moment's gets a name none of the others has: two moments, or two
  // cards put on at the same one, hold side by side.
  const freshName = () => {
    const taken = held.flatMap((m) =>
      isRecord(m) && Array.isArray(m.do)
        ? m.do.map((o) =>
            isRecord(o) && typeof o.name === 'string' ? o.name.trim().toLowerCase() : '',
          )
        : [],
    );
    let name = named;
    for (let n = 2; taken.includes(name.trim().toLowerCase()); n++) name = `${named} (${n})`;
    return name;
  };
  // Effects have no id of their own, so each card is given one, kept by the
  // effect and passed on to what it is edited into. What is open on a card
  // goes with the card, not with its place on the page.
  const ids = useRef(new WeakMap<object, number>());
  const lastId = useRef(0);
  const idOf = (x: object): number => {
    let id = ids.current.get(x);
    if (id === undefined) {
      id = ++lastId.current;
      ids.current.set(x, id);
    }
    return id;
  };
  const edited = (from: unknown, to: unknown) => {
    if (isObject(from) && isObject(to) && from !== to) ids.current.set(to, idOf(from));
  };
  /**
   * What stands at `j` of `xs`: a card by its id, and an entry that is not an
   * object (a file's text or number) by its value and how many of it stand before.
   */
  const tokenOf = (xs: readonly unknown[], j: number): string => {
    const x = xs[j];
    if (isObject(x)) return `#${idOf(x)}`;
    const said = (y: unknown) => JSON.stringify(y) ?? String(y);
    const v = said(x);
    return `=${v} ${xs.slice(0, j).filter((y) => !isObject(y) && said(y) === v).length}`;
  };
  /** Each card's key: what stands there, and its place where one effect is on the page twice. */
  const keysOf = (xs: readonly unknown[]) => {
    const used = new Set<string>();
    return xs.map((_, j) => {
      const at = tokenOf(xs, j);
      const key = used.has(at) ? `${at} ${j}` : at;
      used.add(key);
      return key;
    });
  };
  // The list's order as this session has seen it, the cards since put on at
  // a moment among them, so Counts when taken away puts a card back where it
  // stood, however many are out.
  const home = useRef<string[]>([]);
  /**
   * The order with all that is now on the list in it. One this session never
   * saw goes just before the next on the list it has seen, or last: a card
   * added while others are at a moment comes after them, as it was added.
   */
  const placed = (): string[] => {
    const order = [...home.current];
    const now = list.map((_, j) => tokenOf(list, j));
    now.forEach((t, j) => {
      if (order.includes(t)) return;
      const next = now.slice(j + 1).find((u) => order.includes(u));
      order.splice(next === undefined ? order.length : order.indexOf(next), 0, t);
    });
    home.current = order;
    return order;
  };
  const putBack = (effect: Eff): Eff[] => {
    const order = placed();
    const at = order.indexOf(tokenOf([effect], 0));
    if (at === -1) return [...list, effect];
    // After the last on the list that stood before it.
    let after = -1;
    list.forEach((_, j) => {
      if (order.indexOf(tokenOf(list, j)) < at) after = j;
    });
    return [...list.slice(0, after + 1), effect, ...list.slice(after + 1)];
  };
  const momentProblems = held.length > 0 ? readMoments(held, named).problems : [];
  /** What the reader says of a drawn moment's card `k`, and of the moment itself. */
  const problemsAt = (mi: number, k: number) =>
    momentProblems.flatMap((p) => {
      const hit =
        /^moment (\d+)(?: \([^)]*\))?(?:, outcome 1(?: \([^)]*\))?)?: (?:effect (\d+)(?: \([^)]*\))?: )?(.*)$/.exec(
          p,
        );
      if (hit === null || Number(hit[1]) !== mi + 1) return [];
      return hit[2] === undefined || Number(hit[2]) === k + 1 ? [hit[3] ?? p] : [];
    });
  const withEffects = (m: Drawn, effects: Eff[]): Drawn => ({
    ...m,
    do: [{ ...m.do[0], effects }],
  });
  /** The moments without moment `mi`'s card `k`, and without the moment once it puts nothing on. */
  const without = (mi: number, k: number): unknown[] => {
    const m = held[mi] as Drawn;
    const rest = m.do[0].effects.filter((_, j) => j !== k);
    return rest.length === 0
      ? held.filter((_, j) => j !== mi)
      : held.map((x, j) => (j === mi ? withEffects(m, rest) : x));
  };
  const drawnCards = held.flatMap((m, mi) =>
    drawn(m) ? m.do[0].effects.map((effect, k) => ({ m, mi, effect, k })) : [],
  );
  const kept = held.filter((m) => !drawn(m)).length;
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
   * with, the pool some uses come back to on a short rest, and on an action or a price on what a copy inherits (`priced`), its
   * cost (and the points a slot gives back), what buys a use back and the use
   * it gives back. A pick's are those of what it gives, its options' too.
   */
  const naming = (x: Eff, place: string, from: string, priced = x.kind === 'action'): string[] => [
    ...givenLists(x).flatMap(([at, given]) =>
      given.flatMap((g, k) => (isRecord(g) ? naming(g as Eff, `${place} ${at} ${k}`, from) : [])),
    ),
    ...(x.kind === 'resource' && x.key === from ? [`${place} key`] : []),
    ...(x.kind === 'grantSpell' && x.resourceKey === from ? [`${place} resourceKey`] : []),
    ...(x.kind === 'resourceRegain' && x.key === from ? [`${place} regain`] : []),
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
    const renamed = (x: Eff, place: string): Eff => {
      // A file's text or number in the list names no pool.
      if (!isRecord(x)) return x;
      const out: Eff = {
        ...x,
        ...regiven(x, (g, at, k) => (isRecord(g) ? renamed(g as Eff, `${place} ${at} ${k}`) : g)),
        ...(at.has(`${place} key`) ? { key: to, label: next.label } : {}),
        ...(at.has(`${place} resourceKey`) ? { resourceKey: to } : {}),
        ...(at.has(`${place} regain`) ? { key: to } : {}),
        ...Object.assign(
          {},
          ...PRICE_KEYS.map(([key]) =>
            renamedIn(key, x[key], to, (f) => at.has(`${place} ${key} ${f}`)),
          ),
        ),
      };
      // What the rename leaves alone stays the same object, so its card (and
      // a card a pick of it gives) stays the same card.
      return JSON.stringify(out) === JSON.stringify(x) ? x : out;
    };
    const effects = list.map((x, j) => (j === i ? next : renamed(x, `effect ${j}`)));
    // A renamed card is still the same card.
    list.forEach((x, j) => {
      edited(x, effects[j] as Eff);
    });
    const amended =
      onAmend === undefined || amends.length === 0
        ? undefined
        : amends.map((a, k) => renamed(a, `amend ${k}`));
    following.current = { was: JSON.stringify([effects, amended ?? amends]), at };
    return [effects, amended];
  };
  const add = (spec: KindSpec) => {
    // A new pool is named for what gives it, with a key none of the pools here has.
    const pools = [...list, ...(resources ?? [])].flatMap((x) =>
      x.kind === 'resource' && typeof x.key === 'string' ? [x.key] : [],
    );
    const made = spec.make({
      name: hostName,
      pools,
      copy: inherits !== undefined && replace !== true,
    });
    // A new pick takes an id none of the entry's picks has, so each is asked.
    const next =
      made.kind === 'pick' ? { ...made, id: freshPickId(pickIdsIn([list, ...versions()])) } : made;
    onChange([...list, next]);
  };
  const more = async () => {
    const offered = moreKinds({ inPlay, spells: spells !== undefined, inPick, counts });
    const reminder = offered.includes('Reminder');
    const id = await askChoice({
      title: inPick ? 'What does each pick give?' : 'What does it do?',
      // Searched by what a kind does, so "minimum" finds Ability score is at least.
      search: 'Search by what it does',
      options: offered.map((add) => {
        const k = KINDS.find((x) => x.add === add);
        return { id: add, label: add, line: k?.does, group: k && GROUP.get(k) };
      }),
      noMatch: (q) =>
        reminder
          ? {
              say: `Nothing does "${q}" yet. Add a reminder instead: a line on the sheet with nothing to count.`,
              choice: { id: 'Reminder', label: 'Add a reminder' },
            }
          : { say: `Nothing does "${q}" yet.` },
    });
    const spec = KINDS.find((k) => k.add === id);
    if (spec !== undefined) add(spec);
  };
  const listKeys = keysOf(list);
  const momentKeys = keysOf(drawnCards.map((d) => d.effect));
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
            key={listKeys[i]}
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
            toMoment={
              onMoments === undefined || !movable
                ? undefined
                : (at) => {
                    placed();
                    onMoments(
                      [
                        ...held,
                        { at, do: [{ kind: 'addEffect', name: freshName(), effects: [effect] }] },
                      ],
                      list.filter((_, j) => j !== i),
                    );
                  }
            }
            onRemove={() => onChange(list.filter((_, j) => j !== i))}
            onChange={(next, renamed) => {
              edited(effect, next);
              if (renamed === undefined) onChange(list.map((x, j) => (j === i ? next : x)));
              else onChange(...follow(i, next, renamed));
            }}
          />
        ),
      )}
      {drawnCards.map(({ m, mi, effect, k }, n) => {
        const place: MomentPlace = {
          moment: m,
          outcome: m.do[0],
          set: (next) => onMoments?.(held.map((x, j) => (j === mi ? next : x))),
          out: () => onMoments?.(without(mi, k), putBack(effect)),
        };
        return (
          <Card
            key={momentKeys[n]}
            effect={effect}
            list={list}
            pools={resources ?? []}
            spells={spells}
            problems={problemsAt(mi, k)}
            inPlay={inPlay}
            readOnly={readOnly}
            place={place}
            onRemove={() => onMoments?.(without(mi, k))}
            onChange={(next) => {
              edited(effect, next);
              onMoments?.(
                held.map((x, j) =>
                  j === mi
                    ? withEffects(
                        m,
                        m.do[0].effects.map((y, i) => (i === k ? next : y)),
                      )
                    : x,
                ),
              );
            }}
          />
        );
      })}
      {kept > 0 && (
        <p className="text-caption text-ink-muted">
          {kept === 1 ? 'One moment does' : `${kept} moments do`} more than put an effect on:{' '}
          {kept === 1 ? 'it is' : 'they are'} kept as written.
        </p>
      )}
      {list.filter((e) => hide?.(e) !== true).length === 0 &&
        drawnCards.length === 0 &&
        kept === 0 && (
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
        moments={g.moments}
        momentName={
          typeof draft.name === 'string' && draft.name.trim() !== '' ? draft.name : undefined
        }
        hostName={typeof draft.name === 'string' ? draft.name : undefined}
        onMoments={(moments, effects) =>
          set({
            moments: moments.length > 0 ? moments : undefined,
            ...(effects === undefined ? {} : { effects: effects.length > 0 ? effects : undefined }),
          })
        }
      />
    </Section>
  );
}
