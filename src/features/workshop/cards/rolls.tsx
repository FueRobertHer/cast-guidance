/** Board 4's rolls: saving throw bonuses, advantage, an added die, paid extras and rerolls. */
import { isRecord } from '@/engine/castGuidance';
import { readStoredEffects } from '@/engine/effects/mechanics';
import type { RollFilter } from '@/engine/types';
import { rollsWords } from '@/features/sheet/effectsInPlay';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import type { Eff, FieldSpec, KindSpec, Options } from './kit/types';
import {
  ABILITY,
  amount,
  amountField,
  BY_LEVEL,
  bonusWords,
  held,
  isByLevel,
  isNumber,
  listed,
  offering,
  omit,
  shown,
  stored,
  word,
} from './kit/words';

/**
 * The rolls an Advantage or Added die card can name, each one stored filter,
 * worded as the sheet words it (`rollsWords`).
 */
const ROLL_KINDS: ReadonlyArray<readonly [string, RollFilter]> = [
  ['attack', { rolls: ['attack'] }],
  ['save', { rolls: ['save'] }],
  ['death', { rolls: ['save'], save: 'death' }],
  ['concentration', { rolls: ['save'], save: 'concentration' }],
  ['check', { rolls: ['check'] }],
  ['proficient', { rolls: ['check'], proficient: true }],
  ['initiative', { rolls: ['check'], initiative: true }],
];
/** The kinds an ability narrows: a death save has none, and the others name theirs. */
const TAKES_ABILITY = new Set(['attack', 'save', 'check', 'proficient']);
/**
 * The rolls a Paid extra or Reroll card can name. A death save and a
 * concentration save are settled on the spot, with nothing offered after, so a
 * file's filter for one shows as written.
 */
const PAID_ROLL_KINDS = ROLL_KINDS.filter(([k]) => k !== 'death' && k !== 'concentration');

/**
 * Initiative has no failure to turn into a success: the prompt never offers one
 * that waits on it. A filter naming initiative reaches nothing else, whatever
 * else it narrows.
 */
const onInitiative = (e: Eff) => isRecord(e.on) && e.on.initiative === true;

/**
 * A paid extra or a reroll the author has just put on initiative: one offered
 * after a failed roll is offered after any roll instead.
 */
function noFailure(e: Eff): Eff {
  if (e.ifFailed !== true) return e;
  const rest = omit(e, ['ifFailed', 'spentOnSuccess']);
  return e.kind === 'rollPaid' ? { ...rest, after: true } : rest;
}

/** A failed roll's choice, left out on initiative unless a file gives it. */
const FAILED_ON_INITIATIVE = 'After a failed roll, never offered on initiative';

/**
 * An effect's roll filter as the reader reads it, so a stored one it refuses
 * (abilities as a word, a roll it does not know) is worded as no filter, not
 * thrown or misread; the card's problem line says what is wrong.
 */
function filterOf(e: Eff): RollFilter | undefined {
  const read = readStoredEffects([{ kind: 'rollAdvantage', mode: 'adv', on: e.on }]).effects[0];
  return read?.effect.on as RollFilter | undefined;
}

const rollWords = (e: Eff) => {
  const on = filterOf(e);
  return on !== undefined ? rollsWords(on) : 'rolls';
};

/**
 * Which of `ROLL_KINDS` a filter is, with any abilities beside it where the
 * kind takes one; undefined for one the card cannot show (skills, a range, two
 * kinds of roll), which it keeps as written until the player picks a kind.
 */
export function rollKindOf(on: unknown): string | undefined {
  if (!isRecord(on)) return undefined;
  const { abilities, ...rest } = on;
  const same = (f: RollFilter) => {
    const keys = Object.keys(rest);
    return (
      keys.length === Object.keys(f).length &&
      keys.every((k) => JSON.stringify(rest[k]) === JSON.stringify(f[k as keyof RollFilter]))
    );
  };
  const kind = ROLL_KINDS.find(([, f]) => same(f))?.[0];
  if (kind === undefined) return undefined;
  if (abilities === undefined) return kind;
  const known = (a: unknown) => ABILITY.some(([v]) => v === a);
  return TAKES_ABILITY.has(kind) &&
    Array.isArray(abilities) &&
    abilities.length > 0 &&
    abilities.every(known)
    ? kind
    : undefined;
}

/**
 * What pays for a paid extra or a reroll, as its "Paid with" box holds it: the
 * use of the entry's action or pool (with the reaction, or never one), a reaction
 * alone, Inspiration, nothing, or nothing as the d20 lands (`auto`).
 */
function paidWithOf(e: Eff): string {
  // A paid extra has no free or automatic kind: the reader passes over both.
  const reroll = e.kind === 'rollReroll';
  if (reroll && e.auto === true) return 'auto';
  if (e.inspiration === true) return 'inspiration';
  if (reroll && e.free === true) return e.reaction === true ? 'reaction' : 'free';
  if (e.reaction === true) return 'useReaction';
  if (e.reaction === false) return 'noReaction';
  return 'use';
}

/** The "Paid with" choices both cards have; a reroll adds what costs nothing. */
const PAID_WITH: Options = [
  ['use', 'Its use'],
  ['useReaction', 'Its use and your reaction'],
  ['noReaction', 'Its use, never your reaction'],
  ['inspiration', 'Inspiration'],
];
const FREE_WITH: Options = [
  ['reaction', 'Your reaction alone'],
  ['free', 'Nothing'],
  ['auto', 'Nothing, as the d20 lands'],
];

/** What an automatic one waits on, which it leaves out. */
const WAITS = ['ifFailed', 'when', 'reaction', 'inspiration'];

function withPaidWith(e: Eff, v: string): Eff {
  const rest = omit(e, ['auto', 'free', 'reaction', 'inspiration']);
  if (v === 'useReaction') return { ...rest, reaction: true };
  if (v === 'noReaction') return { ...rest, reaction: false };
  if (v === 'inspiration') return { ...rest, inspiration: true };
  if (v === 'reaction') return { ...rest, free: true, reaction: true };
  if (v === 'free') return { ...rest, free: true };
  if (v === 'auto') return omit({ ...rest, auto: true, free: true }, WAITS);
  return rest;
}

function priceLine(e: Eff): string {
  const words: Readonly<Record<string, string>> = {
    auto: ', as the d20 lands',
    inspiration: ', paid with Inspiration',
    reaction: ', paid with your reaction',
    free: ', free',
    useReaction: ', paid with its use and your reaction',
    noReaction: ', paid with its use, never your reaction',
  };
  return words[paidWithOf(e)] ?? ', paid with its use';
}

const whenLine = (e: Eff) =>
  typeof e.when === 'string' && e.when.trim() !== '' ? `. ${e.when.trim()}` : '';

/** What a paid extra adds, as its "Adds" box holds it. */
const addsOf = (e: Eff) =>
  e.poolDie === true
    ? 'poolDie'
    : e.advantage === true
      ? 'advantage'
      : e.bonus !== undefined
        ? 'bonus'
        : 'dice';

/** When the prompt offers a paid extra: a bonus is always added once the d20 shows. */
const timingOf = (e: Eff) =>
  e.ifFailed === true ? 'failed' : e.after === true || e.bonus !== undefined ? 'after' : 'before';

/**
 * A paid extra that adds something else. Advantage is claimed before the d20,
 * so it waits on nothing; a bonus is added after it.
 */
function withAdds(e: Eff, v: string): Eff {
  const rest = omit(e, ['dice', 'poolDie', 'bonus', 'advantage']);
  if (v === 'advantage') {
    return omit({ ...rest, advantage: true }, ['after', 'ifFailed', 'spentOnSuccess']);
  }
  if (v === 'bonus')
    return { ...rest, bonus: 1, ...(rest.ifFailed === true ? {} : { after: true }) };
  if (v === 'poolDie') return { ...rest, poolDie: true };
  return { ...rest, dice: '1d4' };
}

function withTiming(e: Eff, v: string): Eff {
  const rest = omit(e, ['after', 'ifFailed', 'spentOnSuccess']);
  if (v === 'after') return { ...rest, after: true };
  if (v === 'failed') return { ...rest, ifFailed: true };
  return rest;
}

function paidLine(e: Eff): string {
  const adds = addsOf(e);
  const what =
    adds === 'poolDie'
      ? `+the paying pool's die to ${rollWords(e)}`
      : adds === 'advantage'
        ? `Advantage on ${rollWords(e)}`
        : adds === 'bonus'
          ? `${bonusWords(e.bonus)} to ${rollWords(e)}`
          : `+${String(e.dice)} to ${rollWords(e)}`;
  const time = timingOf(e);
  const at =
    time === 'failed' ? ', after a failed roll' : time === 'after' ? ', after the roll' : '';
  const back = e.spentOnSuccess === true ? ' (its price comes back if it still fails)' : '';
  return `${what}${at}${priceLine(e)}${back}${whenLine(e)}`;
}

/** What a reroll does, as its "Does" box holds it. */
const rerollOf = (e: Eff) =>
  e.floorScore !== undefined
    ? 'floor'
    : e.to !== undefined
      ? 'to'
      : e.die === 'one' || e.die === 'low' || e.die === 'extra'
        ? e.die
        : 'all';

const REROLLS: Options = [
  ['all', 'Rerolls the d20'],
  ['one', 'Rerolls a low die'],
  ['extra', 'Rolls one d20 more, keeping the best'],
  ['low', 'Rerolls the lower die of advantage'],
  ['to', 'Counts the d20 as at least a number'],
  ['floor', 'Counts the total as at least a score'],
];

/** What may be made as the d20 lands: it never makes the roll worse. */
const autoable = (e: Eff) =>
  e.to !== undefined ||
  e.floorScore !== undefined ||
  e.die === 'low' ||
  (e.die === 'one' && e.atMost === 1);
/** What the prompt makes only as the d20 lands. */
const onlyAuto = (e: Eff) => e.floorScore !== undefined || e.die === 'low';

/**
 * A reroll as the reader takes it: one made only as the d20 lands is so, and
 * one that could make the roll worse is not, paid with its use instead.
 */
function settled(e: Eff): Eff {
  if (onlyAuto(e)) return omit({ ...e, auto: true, free: true }, WAITS);
  if (e.auto === true && !autoable(e)) return omit(e, ['auto', 'free']);
  return e;
}

/** A reroll that does something else. A number set or a floor adds no bonus. */
function withReroll(e: Eff, v: string): Eff {
  const rest = omit(e, ['die', 'atMost', 'to', 'floorScore']);
  const base = v === 'to' || v === 'floor' ? omit(rest, ['bonus']) : rest;
  const next: Eff =
    v === 'one'
      ? { ...base, die: 'one', atMost: 1 }
      : v === 'low' || v === 'extra'
        ? { ...base, die: v }
        : v === 'to'
          ? { ...base, to: 10 }
          : v === 'floor'
            ? { ...base, floorScore: 'str' }
            : base;
  return settled(next);
}

function rerollLine(e: Eff): string {
  const on = rollWords(e);
  const what: Readonly<Record<string, string>> = {
    one:
      e.atMost === 1
        ? `Reroll a 1 on ${on}`
        : `Reroll a die showing ${String(e.atMost)} or less on ${on}`,
    extra: `Roll one d20 more on ${on}, keeping the best`,
    low: `Reroll the lower die of advantage on ${on}`,
    to: `The d20 counts as at least ${String(e.to)} on ${on}`,
    floor: `A total under your ${word(ABILITY, e.floorScore)} score counts as the score on ${on}`,
  };
  const bonus = e.bonus !== undefined ? `, adding ${bonusWords(e.bonus)}` : '';
  const failed = e.ifFailed === true ? ', after a failed roll' : '';
  return `${what[rerollOf(e)] ?? `Reroll the d20 on ${on}`}${bonus}${failed}${priceLine(e)}${whenLine(e)}`;
}

/**
 * A roll card's own controls: which rolls, narrowed to an ability where that
 * kind takes one, and for an advantage, when it holds if the app cannot see it
 * (the roll prompt then offers it to claim).
 */
function RollFields({
  effect,
  title,
  kinds = ROLL_KINDS,
  onChange,
}: {
  effect: Eff;
  title: string;
  /** The kinds its On box offers; another a file gives shows as written. */
  kinds?: typeof ROLL_KINDS;
  onChange: (next: Eff) => void;
}) {
  const on = isRecord(effect.on) ? effect.on : {};
  const found = rollKindOf(on);
  const kind = kinds.some(([v]) => v === found) ? found : undefined;
  const abilities = Array.isArray(on.abilities) ? on.abilities.map(String) : [];
  const several = abilities.map((a) => word(ABILITY, a)).join(' or ');
  const setKind = (k: string) => {
    const base = ROLL_KINDS.find(([v]) => v === k)?.[1];
    if (base === undefined) return;
    const kept = TAKES_ABILITY.has(k) && abilities.length > 0 ? { abilities } : {};
    const { when: _, ...rest } = effect;
    onChange({ ...(claims(base) ? effect : rest), on: { ...base, ...kept } });
  };
  const setAbility = (a: string) => {
    const { abilities: _, ...rest } = on;
    onChange({ ...effect, on: a === '' ? rest : { ...rest, abilities: [a] } });
  };
  return (
    <>
      <Field label="On">
        <Select
          aria-label={`${title}: On`}
          value={kind ?? ''}
          onChange={(e) => setKind(e.target.value)}
        >
          {kind === undefined && <option value="">{rollWords(effect)}, as written</option>}
          {kinds.map(([v, f]) => (
            <option key={v} value={v}>
              {rollsWords(f)}
            </option>
          ))}
        </Select>
      </Field>
      {kind !== undefined && TAKES_ABILITY.has(kind) && (
        <Field label="Ability">
          <Select
            aria-label={`${title}: Ability`}
            value={abilities.length > 1 ? 'several' : (abilities[0] ?? '')}
            onChange={(e) => {
              if (e.target.value !== 'several') setAbility(e.target.value);
            }}
          >
            <option value="">Any ability</option>
            {abilities.length > 1 && <option value="several">{several}</option>}
            {ABILITY.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}

/**
 * Whether an advantage on this kind of roll can wait for the player to claim
 * it: the roll prompt offers it, but a concentration save rolls at once, with
 * no prompt to offer it in.
 */
const claims = (on: unknown) => !(isRecord(on) && on.save === 'concentration');

/** An advantage's `when`: it holds only then, and the roll prompt offers it to claim. */
function ClaimField({
  effect,
  title,
  placeholder = 'Only against being Frightened',
  onChange,
}: {
  effect: Eff;
  title: string;
  placeholder?: string;
  onChange: (next: Eff) => void;
}) {
  if (effect.mode === 'dis' || !claims(effect.on)) return null;
  return (
    <div className="col-span-2">
      <Field label="Only when">
        <input
          aria-label={`${title}: Only when`}
          value={typeof effect.when === 'string' ? effect.when : ''}
          placeholder={placeholder}
          onChange={(e) => {
            const { when: _, ...rest } = effect;
            onChange(e.target.value.trim() === '' ? rest : { ...rest, when: e.target.value });
          }}
          className={fieldClass}
        />
      </Field>
    </div>
  );
}

/**
 * A box of choices on a card, named "Card: Label" for a screen reader. A value
 * a file may give that is none of the choices needs one of its own (`offering`).
 */
function Box({
  title,
  label,
  value,
  options,
  onPick,
}: {
  title: string;
  label: string;
  value: string;
  options: Options;
  onPick: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <Select
        aria-label={`${title}: ${label}`}
        value={value}
        onChange={(e) => onPick(e.target.value)}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const BONUS: FieldSpec = { key: 'bonus', label: 'Bonus', type: 'amount' };

/** A bonus: a whole number or a formula. A level table a file gives is kept until one is typed. */
function BonusField({
  effect,
  title,
  label,
  optional = false,
  onChange,
}: {
  effect: Eff;
  title: string;
  label: string;
  /** Emptied, it takes the bonus away. */
  optional?: boolean;
  onChange: (next: Eff) => void;
}) {
  return (
    <Field label={label}>
      <input
        aria-label={`${title}: ${label}`}
        value={shown(effect, BONUS)}
        placeholder={isByLevel(effect.bonus) ? BY_LEVEL : undefined}
        onChange={(e) => {
          const t = e.target.value;
          onChange(
            optional && t.trim() === ''
              ? omit(effect, ['bonus'])
              : { ...effect, bonus: stored(BONUS, t) },
          );
        }}
        className={fieldClass}
      />
    </Field>
  );
}

const ADDS: Options = [
  ['dice', 'A die'],
  ['bonus', 'A bonus'],
  ['advantage', 'Advantage'],
];
const TIMES: Options = [
  ['before', 'Before the roll'],
  ['after', 'After the roll'],
  ['failed', 'After a failed roll'],
];
const STILL_FAILS: Options = [
  ['', 'Its price is spent'],
  ['back', 'Its price comes back'],
];
const OFFERED: Options = [
  ['', 'After any roll'],
  ['failed', 'After a failed roll'],
];
const AT_MOST: Options = Array.from({ length: 19 }, (_, i) => [String(i + 1), String(i + 1)]);
const AT_LEAST: Options = Array.from({ length: 19 }, (_, i) => [String(i + 2), String(i + 2)]);

/** A "Paid with" box: a price a file gives that its choices lack shows as written. */
function paidWithBox(e: Eff, options: Options): { value: string; options: Options } {
  const value = paidWithOf(e);
  return { value, options: offering(options, value, word([...PAID_WITH, ...FREE_WITH], value)) };
}

/**
 * A paid extra's own controls: what it adds (a die or a bonus, or advantage,
 * which is claimed before the d20), when the prompt offers it, whether the use
 * comes back on a roll that still fails, and what pays for it. The paying
 * pool's own die (`poolDie`) needs a die on the pool, which no card sets, so
 * it is kept as written.
 */
function PaidFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const adds = addsOf(effect);
  const time = timingOf(effect);
  const initiative = onInitiative(effect);
  // Inspiration has no die of its own to add.
  const pays = adds === 'poolDie' ? PAID_WITH.filter(([v]) => v !== 'inspiration') : PAID_WITH;
  const paid = paidWithBox(effect, pays);
  return (
    <>
      <Box
        title={title}
        label="Adds"
        value={adds}
        options={offering(ADDS, adds, "The paying pool's die, as written")}
        onPick={(v) => onChange(withAdds(effect, v))}
      />
      {adds === 'dice' && (
        <Field label="Dice">
          <input
            aria-label={`${title}: Dice`}
            value={typeof effect.dice === 'string' ? effect.dice : ''}
            onChange={(e) => onChange({ ...effect, dice: e.target.value })}
            className={fieldClass}
          />
        </Field>
      )}
      {adds === 'bonus' && (
        <BonusField effect={effect} title={title} label="Bonus" onChange={onChange} />
      )}
      {adds !== 'advantage' && (
        <Box
          title={title}
          label="Offered"
          value={time}
          options={offering(
            TIMES.filter(
              ([v]) => !(v === 'before' && adds === 'bonus') && !(v === 'failed' && initiative),
            ),
            time,
            FAILED_ON_INITIATIVE,
          )}
          onPick={(v) => onChange(withTiming(effect, v))}
        />
      )}
      {time === 'failed' && (
        <Box
          title={title}
          label="If it still fails"
          value={effect.spentOnSuccess === true ? 'back' : ''}
          options={STILL_FAILS}
          onPick={(v) =>
            onChange(
              v === 'back' ? { ...effect, spentOnSuccess: true } : omit(effect, ['spentOnSuccess']),
            )
          }
        />
      )}
      <Box
        title={title}
        label="Paid with"
        {...paid}
        onPick={(v) => onChange(withPaidWith(effect, v))}
      />
    </>
  );
}

/**
 * A reroll's own controls: what it does (a reroll, one d20 more, a number set
 * or a floor), its number or score, what pays for it, whether it waits on a
 * failed roll, and a bonus on the new roll. One made as the d20 lands costs
 * nothing and waits on nothing; the lower die and a floor are made only so.
 */
function RerollFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const does = rerollOf(effect);
  const pays = [...PAID_WITH, ...FREE_WITH.filter(([v]) => v !== 'auto' || autoable(effect))];
  const number = (v: unknown, options: Options) => {
    const value = held(v, isNumber);
    return { value, options: offering(options, value, value) };
  };
  return (
    <>
      <Box
        title={title}
        label="Does"
        value={does}
        options={REROLLS}
        onPick={(v) => onChange(withReroll(effect, v))}
      />
      {does === 'one' && (
        <Box
          title={title}
          label="Showing at most"
          {...number(effect.atMost, AT_MOST)}
          onPick={(v) => onChange(settled({ ...effect, atMost: Number(v) }))}
        />
      )}
      {does === 'to' && (
        <Box
          title={title}
          label="At least"
          {...number(effect.to, AT_LEAST)}
          onPick={(v) => onChange({ ...effect, to: Number(v) })}
        />
      )}
      {does === 'floor' && (
        <Box
          title={title}
          label="Score"
          value={String(effect.floorScore)}
          options={offering(ABILITY, String(effect.floorScore), String(effect.floorScore))}
          onPick={(v) => onChange({ ...effect, floorScore: v })}
        />
      )}
      {!onlyAuto(effect) && (
        <Box
          title={title}
          label="Paid with"
          {...paidWithBox(effect, pays)}
          onPick={(v) => onChange(withPaidWith(effect, v))}
        />
      )}
      {effect.auto !== true && (
        <Box
          title={title}
          label="Offered"
          value={effect.ifFailed === true ? 'failed' : ''}
          options={
            onInitiative(effect)
              ? offering(
                  OFFERED.filter(([v]) => v !== 'failed'),
                  effect.ifFailed === true ? 'failed' : '',
                  FAILED_ON_INITIATIVE,
                )
              : OFFERED
          }
          onPick={(v) =>
            onChange(v === 'failed' ? { ...effect, ifFailed: true } : omit(effect, ['ifFailed']))
          }
        />
      )}
      {does !== 'to' && does !== 'floor' && (
        <BonusField
          effect={effect}
          title={title}
          label="Adds to the new roll"
          optional
          onChange={onChange}
        />
      )}
    </>
  );
}

/**
 * A saving throw bonus's saves: every one while none is picked, else those
 * picked, in the order the sheet lists them. One a file names that is no
 * ability is kept after them, for the card's problem line to say.
 */
function SaveFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const held = Array.isArray(effect.abilities) ? effect.abilities.map(String) : [];
  const toggle = (a: string) => {
    const on = (v: string) => (v === a ? !held.includes(v) : held.includes(v));
    const known = new Set(ABILITY.map(([v]) => v));
    const next = [...ABILITY.map(([v]) => v).filter(on), ...held.filter((v) => !known.has(v))];
    onChange(next.length === 0 ? omit(effect, ['abilities']) : { ...effect, abilities: next });
  };
  return (
    <fieldset className="col-span-2 flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-label text-ink-muted">Only these saves</legend>
      <div className="grid grid-cols-3 gap-x-2">
        {ABILITY.map(([v, text]) => (
          <label key={v} className="flex min-h-tap items-center gap-2 text-body">
            <input
              type="checkbox"
              className="size-4.5 accent-ink"
              aria-label={`${title}: ${text}`}
              checked={held.includes(v)}
              onChange={() => toggle(v)}
            />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A paid extra's or a reroll's On box: putting it on initiative takes away a failed roll. */
const paidOn = (p: { effect: Eff; title: string; onChange: (next: Eff) => void }) => (
  <RollFields
    effect={p.effect}
    title={p.title}
    kinds={PAID_ROLL_KINDS}
    // On initiative these boxes show On alone, so a change here that lands
    // on initiative is the author putting the card there.
    onChange={(next) => p.onChange(onInitiative(next) ? noFailure(next) : next)}
  />
);

/** A paid extra's or a reroll's Only when. One made as the d20 lands waits on nothing, so it holds always. */
const paidClaim = (p: { effect: Eff; title: string; onChange: (next: Eff) => void }) =>
  paidWithOf(p.effect) !== 'auto' && (
    <ClaimField
      effect={p.effect}
      title={p.title}
      placeholder="Only on your own turn"
      onChange={p.onChange}
    />
  );

export const cards: readonly KindSpec[] = [
  {
    kinds: ['saveBonus'],
    add: 'Saving throws',
    make: () => ({ kind: 'saveBonus', amount: 1 }),
    fields: [amountField],
    line: (e) =>
      Array.isArray(e.abilities) && e.abilities.length > 0
        ? `${amount(e.amount)} to ${listed(e.abilities.map((a) => word(ABILITY, a)))} saving throws`
        : `${amount(e.amount)} to every saving throw`,
    boxes: (p) => <SaveFields effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['rollAdvantage'],
    add: 'Advantage',
    make: () => ({ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'] } }),
    fields: [
      {
        key: 'mode',
        label: 'Kind',
        type: 'pick',
        options: [
          ['adv', 'Advantage'],
          ['dis', 'Disadvantage'],
        ],
      },
    ],
    line: (e) =>
      `${e.mode === 'dis' ? 'Disadvantage' : 'Advantage'} on ${rollWords(e)}${
        typeof e.when === 'string' && e.when.trim() !== '' ? `. ${e.when.trim()}` : ''
      }`,
    // The roll prompt offers only advantage to claim, so a disadvantage holds always.
    set: (e, key, v) =>
      key === 'mode' && v === 'dis' ? { next: { ...omit(e, ['when']), mode: v } } : undefined,
    boxes: (p) => <RollFields effect={p.effect} title={p.title} onChange={p.onChange} />,
    after: (p) => <ClaimField effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['rollDie'],
    add: 'Added die',
    make: () => ({ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }),
    fields: [{ key: 'dice', label: 'Dice', type: 'dice' }],
    line: (e) => `+${String(e.dice)} to ${rollWords(e)}`,
    boxes: (p) => <RollFields effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['rollPaid'],
    add: 'Paid extra',
    make: () => ({ kind: 'rollPaid', on: { rolls: ['check'] }, dice: '1d4', ifFailed: true }),
    fields: [],
    line: paidLine,
    boxes: (p) => (
      <>
        {paidOn(p)}
        <PaidFields effect={p.effect} title={p.title} onChange={p.onChange} />
      </>
    ),
    after: paidClaim,
    notInPlay: true,
  },
  {
    kinds: ['rollReroll'],
    add: 'Reroll',
    make: () => ({ kind: 'rollReroll', on: { rolls: ['save'] }, ifFailed: true }),
    fields: [],
    line: rerollLine,
    boxes: (p) => (
      <>
        {paidOn(p)}
        <RerollFields effect={p.effect} title={p.title} onChange={p.onChange} />
      </>
    ),
    after: paidClaim,
    notInPlay: true,
  },
];
