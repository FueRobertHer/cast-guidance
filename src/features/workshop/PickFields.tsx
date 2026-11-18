/**
 * The Pick card's own controls (rule pack port 4g): what it asks for, how
 * many, from what, in place of what is held, the prompt's words, and what
 * each pick gives, as the effect cards build it. A named option's pick lists
 * its options, each with what it gives. The reader (`readPick`) is the one
 * the sheet uses, so the card's problem lines say what would not count.
 *
 * What no box edits is kept as written and said so: counts by level or by
 * the class table, what the picks give together (`givesAll`), what is given
 * beside a pick in place of one held (`always`), the weapon properties a pick
 * leaves out, asking once the build is in, and a Weapon Mastery pick, which
 * is a class's.
 */
import { X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { isRecord, type StoredEffect } from '@/engine/castGuidance';
import { sampleFills } from '@/engine/effects/mechanics';
import { DAMAGE_TYPES, PICK_ASKS, type PickAsk, type PickFill } from '@/engine/effects/picks';
import { SKILLS } from '@/engine/types';
import { orList, weaponKinds } from '@/features/homebrew/pickWords';
import { Chip } from '@/ui/Chip';
import { fieldClass } from '@/ui/TextField';
import { ABILITY_WORDS, ChipPicks, Field, Kept, Select } from './fields';

type Eff = StoredEffect;
type Options = ReadonlyArray<readonly [string, string]>;

/** What a pick may ask for, as its "Asks for" box offers it. */
const ASKS: Options = [
  ['skill', 'A skill'],
  ['tool', 'A tool'],
  ['weapon', 'A weapon'],
  ['save', 'A save'],
  ['damage', 'A damage type'],
  ['spell', 'A spell'],
  ['option', 'An option'],
];

/** What each pick of an ask gives, as a new pick (or one turned to the ask) starts. */
const GIVES: Readonly<Partial<Record<string, readonly Eff[]>>> = {
  skill: [{ kind: 'skillProf', skill: '{pick}', level: 1 }],
  tool: [{ kind: 'toolProf', name: '{pick}' }],
  weapon: [{ kind: 'weaponProf', name: '{pick}' }],
  save: [{ kind: 'saveProf', ability: '{pick}' }],
  damage: [{ kind: 'resist', damageType: '{pick}' }],
  spell: [{ kind: 'grantSpell', spell: '{pick}' }],
};

/** What an ask needs beside its gives, as a pick turned to it starts. */
const STARTS: Readonly<Partial<Record<string, Eff>>> = {
  weapon: { kind: 'pick', weapons: { filter: 'type=martial weapon' } },
  spell: { kind: 'pick', spells: { levels: [0] } },
  option: {
    kind: 'pick',
    options: [
      { id: 'option-1', label: 'Option 1' },
      { id: 'option-2', label: 'Option 2' },
    ],
  },
};

/** Fields only some asks read (`PICK_ONLY`), which a pick turned to another ask leaves. */
const ASK_ONLY = [
  'from',
  'classSkills',
  'orLanguage',
  'options',
  'melee',
  'proficient',
  'weapons',
  'spells',
  'inPlaceOf',
  'always',
];

/** A new Pick card: a skill, its proficiency given. Its id is set as it is added. */
export const NEW_PICK: Eff = { kind: 'pick', id: 'choice', ask: 'skill', gives: GIVES.skill };

/** The asks whose answers a pick can take "in place of" what is held (`IN_PLACE_ASKS`). */
const IN_PLACE = new Set(['skill', 'tool', 'save']);

/** The prompt words the sheet shows for a pick that names none (`defaultLabel`). */
const PROMPTS: Readonly<Record<string, string>> = {
  skill: 'Skill proficiency',
  tool: 'Tool proficiency',
  weapon: 'Weapon proficiency',
  save: 'Saving throw',
  damage: 'Damage type',
  spell: 'Spell',
  option: 'Option',
};

const omit = (e: Eff, keys: readonly string[]): Eff =>
  Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))) as Eff;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A pick turned to another ask: what only the old ask reads is left, and what
 * it gives turns too while it is still what the old ask started with.
 */
export function withAsk(e: Eff, ask: string): Eff {
  const rest = omit(e, [...ASK_ONLY, 'ask']);
  const started = e.gives === undefined || same(e.gives, GIVES[String(e.ask)]);
  const base = started ? omit(rest, ['gives']) : rest;
  const gives = started && GIVES[ask] !== undefined ? { gives: GIVES[ask] } : {};
  return { ...base, ask, ...STARTS[ask], ...gives, kind: 'pick' };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** A stored list set from a box: an empty one is left out, so the pick reads as any. */
const withList = (e: Eff, key: string, v: readonly string[]): Eff =>
  v.length === 0 ? omit(e, [key]) : { ...e, [key]: [...v] };

/** Names as a box holds them, "Insight, Persuasion", as a list. */
const nameList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** The answers a pick's gives are checked with, as its reader checks them (`readPick`). */
export function fillsOf(e: Eff): PickFill[] {
  const ask = String(e.ask);
  const options = Array.isArray(e.options) ? e.options.filter(isRecord) : [];
  const asked: PickFill[] =
    ask === 'option'
      ? options.map((o) => ({ pick: String(o.id) }))
      : (PICK_ASKS as readonly string[]).includes(ask)
        ? sampleFills(ask as PickAsk)
        : [];
  return [...asked, ...strings(e.inPlaceOf).map((pick) => ({ pick }))];
}

/** A pick id the reader takes from a player's file. */
const PICK_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** What a list of what a pick gives is, for the effect cards that build it. */
export interface GivesProps {
  effects: unknown;
  /** Words before each of its cards' box names: "Each pick gives: ". */
  prefix: string;
  /** Its add button's name: "Add to what each pick gives". */
  addLabel: string;
  fills: readonly PickFill[];
  /** What a pick answers, offered as "The pick" in the boxes it fits. */
  picked?: string;
  onChange: (next: Eff[]) => void;
}

/** A list of names typed with commas, kept as typed while it says the same list. */
function NameList({
  label,
  aria,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  aria: string;
  value: readonly string[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  // The words as typed, so a comma can start the next name. Cards are their
  // place in the list, so this one can be handed another card's names (the one
  // above it removed): then those are shown, not what was typed.
  const [held, setTyped] = useState(value.join(', '));
  const typed = same(nameList(held), value) ? held : value.join(', ');
  return (
    <Field label={label}>
      <input
        aria-label={aria}
        value={typed}
        placeholder={placeholder}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(nameList(e.target.value));
        }}
        className={fieldClass}
      />
    </Field>
  );
}

function Check({
  label,
  aria,
  checked,
  onChange,
}: {
  label: string;
  aria: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex min-h-tap items-center gap-2.5 text-body">
      <input
        type="checkbox"
        aria-label={aria}
        className="size-4.5 accent-ink"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

const SKILL_NAMES: Options = SKILLS.map((s) => [s.name, s.name] as const);
const DAMAGES: Options = DAMAGE_TYPES.map((t) => [t, t] as const);
const WEAPON_KINDS: Options = [
  ['simple', 'Simple'],
  ['martial', 'Martial'],
  ['melee', 'Melee'],
  ['ranged', 'Ranged'],
];
const LEVELS: Options = [
  ['0', 'Cantrip'],
  ...Array.from({ length: 9 }, (_, i) => [String(i + 1), String(i + 1)] as const),
];

/** Skill names as the chips hold them: a skill's own spelling, whatever case a file gives. */
const skillNames = (v: unknown) =>
  strings(v).map((s) => SKILLS.find((k) => k.name.toLowerCase() === s.toLowerCase())?.name ?? s);

/** How many a pick asks, as its box shows it, and what the box says for a table. */
function countBox(e: Eff): { value: string; placeholder: string } {
  const c = e.count;
  if (typeof c === 'number') return { value: String(c), placeholder: '1' };
  if (isRecord(c) && isRecord(c.byLevel)) return { value: '', placeholder: 'By level, as written' };
  if (isRecord(c) && typeof c.tableColumn === 'string') {
    return { value: '', placeholder: 'By the class table, as written' };
  }
  return { value: '', placeholder: '1' };
}

/** What it picks from, by what it asks. */
function FromFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const from = strings(effect.from);
  switch (effect.ask) {
    case 'skill':
      return (
        <>
          <ChipPicks
            label="From (none picked: any skill)"
            options={SKILL_NAMES}
            value={skillNames(effect.from)}
            onChange={(v) => onChange(withList(effect, 'from', v))}
          />
          <Check
            label="Or a skill on the class's list"
            aria={`${title}: Or a skill on the class's list`}
            checked={effect.classSkills === true}
            onChange={(on) =>
              onChange(on ? { ...effect, classSkills: true } : omit(effect, ['classSkills']))
            }
          />
          <Check
            label="Or a language"
            aria={`${title}: Or a language`}
            checked={effect.orLanguage === true}
            onChange={(on) =>
              onChange(on ? { ...effect, orLanguage: true } : omit(effect, ['orLanguage']))
            }
          />
        </>
      );
    case 'tool':
      return (
        <NameList
          label="From"
          aria={`${title}: From`}
          value={from}
          placeholder="Any tool"
          onChange={(v) => onChange(withList(effect, 'from', v))}
        />
      );
    case 'save':
      return (
        <ChipPicks
          label="From (none picked: any saving throw)"
          options={ABILITY_WORDS}
          value={from}
          onChange={(v) => onChange(withList(effect, 'from', v))}
        />
      );
    case 'damage':
      return (
        <ChipPicks
          label="From (none picked: any damage type)"
          options={DAMAGES}
          value={from}
          onChange={(v) => onChange(withList(effect, 'from', v))}
        />
      );
    case 'weapon':
      return <WeaponFields effect={effect} title={title} onChange={onChange} />;
    case 'spell':
      return <SpellFields effect={effect} title={title} onChange={onChange} />;
    default:
      return null;
  }
}

/** A weapon pick's weapons: of kinds (`weapons`), or named (`from`). */
function WeaponFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const weapons = isRecord(effect.weapons) ? effect.weapons : undefined;
  const named = weapons === undefined && effect.from !== undefined;
  const without = weapons === undefined ? [] : strings(weapons.without);
  return (
    <>
      <div className="grid grid-cols-2 items-end gap-2">
        <Field label="Weapons">
          <Select
            aria-label={`${title}: Weapons`}
            value={named ? 'named' : 'kinds'}
            onChange={(e) =>
              onChange(
                e.target.value === 'named'
                  ? { ...omit(effect, ['weapons']), from: ['longsword'] }
                  : { ...omit(effect, ['from']), weapons: { filter: 'type=martial weapon' } },
              )
            }
          >
            <option value="kinds">Of a kind</option>
            <option value="named">Named</option>
          </Select>
        </Field>
      </div>
      {named ? (
        <NameList
          label="From"
          aria={`${title}: From`}
          value={strings(effect.from)}
          placeholder="longsword, rapier"
          onChange={(v) => onChange(withList(effect, 'from', v))}
        />
      ) : (
        <ChipPicks
          label="Of the kinds"
          options={WEAPON_KINDS}
          value={weaponKinds(weapons?.filter)}
          onChange={(v) => {
            // A filter names one kind at least: the last one stays.
            if (v.length === 0) return;
            const filter = `type=${v.map((k) => `${k} weapon`).join(';')}`;
            onChange({ ...effect, weapons: { ...weapons, filter } });
          }}
        />
      )}
      {without.length > 0 && <Kept label="Leaves out">{orList(without)}, as written</Kept>}
    </>
  );
}

/** A spell pick's spells: of these levels, from these classes' lists. */
function SpellFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const spells = isRecord(effect.spells) ? effect.spells : {};
  const levels = Array.isArray(spells.levels) ? spells.levels.map(String) : [];
  const classes = strings(spells.classes);
  const set = (next: Record<string, unknown>) => {
    const { classes: listed, ...rest } = { ...spells, ...next };
    onChange({
      ...effect,
      spells: Array.isArray(listed) && listed.length > 0 ? { ...rest, classes: listed } : rest,
    });
  };
  return (
    <>
      <ChipPicks
        label="Of the levels"
        options={LEVELS}
        value={levels}
        onChange={(v) => {
          // A spell pick asks for one level at least: the last one stays.
          if (v.length === 0) return;
          set({ levels: v.map(Number).sort((a, b) => a - b) });
        }}
      />
      <NameList
        label="From the lists of"
        aria={`${title}: From the lists of`}
        value={classes}
        placeholder="Any class"
        onChange={(v) => set({ classes: v })}
      />
    </>
  );
}

/** A named option's pick: each option's name, and what it gives. */
function OptionRows({
  effect,
  title,
  onChange,
  gives,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
  gives: (p: GivesProps) => ReactNode;
}) {
  const options = Array.isArray(effect.options) ? effect.options : [];
  const setAt = (i: number, next: unknown) =>
    onChange({ ...effect, options: options.map((o, j) => (j === i ? next : o)) });
  const add = () => {
    const ids = new Set(options.map((o) => (isRecord(o) ? String(o.id).toLowerCase() : '')));
    let n = options.length + 1;
    while (ids.has(`option-${n}`)) n += 1;
    onChange({ ...effect, options: [...options, { id: `option-${n}`, label: `Option ${n}` }] });
  };
  return (
    <div className="flex flex-col gap-2">
      {options.map((o, i) => {
        const option = isRecord(o) ? o : {};
        const label = typeof option.label === 'string' ? option.label : '';
        const n = i + 1;
        return (
          <div
            // Options have their ids, which a file may repeat; a row is its place in the list.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            className="flex flex-col gap-2 rounded-control bg-surface-raised py-2 pr-1 pl-3"
          >
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={`Option ${n}`}>
                  <input
                    aria-label={`${title}: Option ${n}`}
                    value={label}
                    placeholder="Its name"
                    onChange={(e) => setAt(i, { ...option, label: e.target.value })}
                    className={fieldClass}
                  />
                </Field>
              </div>
              {options.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove option ${label || n}`}
                  onClick={() =>
                    onChange({ ...effect, options: options.filter((_, j) => j !== i) })
                  }
                  className="tap rounded-full text-ink-muted hover:bg-surface hover:text-ink"
                >
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
            {gives({
              effects: option.gives,
              prefix: `Option ${n} gives: `,
              addLabel: `Add to what option ${n} gives`,
              fills: [{ pick: String(option.id) }],
              onChange: (list) =>
                setAt(
                  i,
                  list.length === 0 ? omit(option as Eff, ['gives']) : { ...option, gives: list },
                ),
            })}
          </div>
        );
      })}
      {options.length < 20 && (
        <div className="-mx-1.5 flex flex-wrap">
          <Chip tone="outline" className="px-2.5" onClick={add}>
            Add an option
          </Chip>
        </div>
      )}
    </div>
  );
}

/** What the card says of a pick's id, when the reader would not take it. */
export const idProblem = (p: string) =>
  p.startsWith('"id"') || p.includes('give each pick its own "id"');

export function PickFields({
  effect,
  title,
  problems,
  onChange,
  gives,
}: {
  effect: Eff;
  title: string;
  /** The card's problem lines: an id one shows the Id box, to fix it. */
  problems: readonly string[];
  onChange: (next: Eff) => void;
  gives: (p: GivesProps) => ReactNode;
}) {
  const ask = String(effect.ask);
  if (ask === 'weaponMastery') {
    return (
      <Kept label="Weapon Mastery">a class's, asked as its class table says: kept as written</Kept>
    );
  }
  const known = ASKS.some(([a]) => a === ask);
  const asks: Options = known ? ASKS : [...ASKS, [ask, `${ask}, as written`]];
  const count = countBox(effect);
  const id = typeof effect.id === 'string' ? effect.id : '';
  const showId = !PICK_ID.test(id) || problems.some(idProblem);
  const inPlace = strings(effect.inPlaceOf);
  const always = Array.isArray(effect.always) ? effect.always.length : 0;
  const givesAll = Array.isArray(effect.givesAll) ? effect.givesAll.length : 0;
  const eachGives = ask !== 'option' || effect.gives !== undefined;
  return (
    <div className="flex flex-col gap-2 pr-2">
      <div className="grid grid-cols-2 items-end gap-2">
        <Field label="Asks for">
          <Select
            aria-label={`${title}: Asks for`}
            value={ask}
            onChange={(e) => onChange(withAsk(effect, e.target.value))}
          >
            {asks.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="How many">
          <input
            aria-label={`${title}: How many`}
            inputMode="numeric"
            value={count.value}
            placeholder={count.placeholder}
            onChange={(e) => {
              const t = e.target.value.trim();
              if (t === '') onChange(omit(effect, ['count']));
              else if (/^\d{1,2}$/.test(t)) onChange({ ...effect, count: Number(t) });
            }}
            className={fieldClass}
          />
        </Field>
        <Field label="Prompt words">
          <input
            aria-label={`${title}: Prompt words`}
            value={typeof effect.label === 'string' ? effect.label : ''}
            placeholder={PROMPTS[ask] ?? 'Choose'}
            onChange={(e) =>
              onChange(
                e.target.value === ''
                  ? omit(effect, ['label'])
                  : { ...effect, label: e.target.value },
              )
            }
            className={fieldClass}
          />
        </Field>
        {showId && (
          <Field label="Id">
            <input
              aria-label={`${title}: Id`}
              value={id}
              placeholder="favoured-tool"
              onChange={(e) => onChange({ ...effect, id: e.target.value })}
              className={fieldClass}
            />
          </Field>
        )}
      </div>
      <FromFields effect={effect} title={title} onChange={onChange} />
      {IN_PLACE.has(ask) &&
        (ask === 'save' ? (
          <ChipPicks
            label="In place of, if held already"
            options={ABILITY_WORDS}
            value={inPlace}
            onChange={(v) => onChange(withList(effect, 'inPlaceOf', v))}
          />
        ) : (
          <NameList
            label="In place of, if held already"
            aria={`${title}: In place of, if held already`}
            value={inPlace}
            placeholder={ask === 'skill' ? 'Persuasion' : "Thieves' Tools"}
            onChange={(v) => onChange(withList(effect, 'inPlaceOf', v))}
          />
        ))}
      {always > 0 && (
        <Kept label="Also given">
          {always === 1 ? '1 effect' : `${always} effects`} beside it, as written
        </Kept>
      )}
      {givesAll > 0 && (
        <Kept label="The picks give together">
          {givesAll === 1 ? '1 effect' : `${givesAll} effects`}, as written
        </Kept>
      )}
      {effect.afterBuild === true && <Kept label="Asked">once the build is in, as written</Kept>}
      {ask === 'option' && (
        <OptionRows effect={effect} title={title} onChange={onChange} gives={gives} />
      )}
      {eachGives && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted">Each pick gives</span>
          {gives({
            effects: effect.gives,
            prefix: 'Each pick gives: ',
            addLabel: 'Add to what each pick gives',
            fills: fillsOf(effect),
            picked: ask,
            onChange: (list) =>
              onChange(list.length === 0 ? omit(effect, ['gives']) : { ...effect, gives: list }),
          })}
          {(ask === 'tool' || ask === 'weapon' || ask === 'spell') && (
            <span className="text-caption text-ink-muted">
              In a name, {'{pick}'} stands for the one picked.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
