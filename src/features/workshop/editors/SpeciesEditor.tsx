/**
 * Species: size, speeds, senses, ability scores, defenses, proficiencies,
 * languages, spells, and their traits, each trait with what it does on the
 * sheet (the sheet reads a trait's own effects, and a renamed trait still
 * finds what the original did).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { subraceBelongsTo } from '@/data5e/subraceOptions';
import { isRecord } from '@/engine/castGuidance';
import { listClass } from '@/ui/surfaces';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import { ABILITY_WORDS, ChipPicks, Kept, NumberField, Section, TextBlocks } from '../fields';
import {
  ARMOR_WORDS,
  absent,
  GrantField,
  HeldNumber,
  LANGUAGE_WORDS,
  OnSheet,
  SKILL_WORDS,
  SpellsGiven,
} from '../originFields';
import { PartList } from '../PartList';
import { editPath } from '../yours';

/** The data's sizes, Varies (the player's choice) last: it stands alone. */
const SIZES: ReadonlyArray<readonly [string, string]> = [
  ['T', 'Tiny'],
  ['S', 'Small'],
  ['M', 'Medium'],
  ['L', 'Large'],
  ['H', 'Huge'],
  ['G', 'Gargantuan'],
  ['V', 'Varies'],
];
const OFFERED = new Set(SIZES.map(([k]) => k));

const words = (list: readonly string[]): ReadonlyArray<readonly [string, string]> =>
  list.map((t) => [t, t[0]?.toUpperCase() + t.slice(1)] as const);

const DAMAGE = words([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);
const CONDITIONS = words([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

/** A walking speed, from a number or a speed block; the block keeps its other speeds. */
export function walkSpeed(speed: unknown): number | undefined {
  if (typeof speed === 'number') return speed;
  return isRecord(speed) && typeof speed.walk === 'number' ? speed.walk : undefined;
}

export function withWalkSpeed(speed: unknown, walk: number | undefined): unknown {
  if (isRecord(speed)) {
    const { walk: _, ...rest } = speed;
    return walk === undefined
      ? Object.keys(rest).length > 0
        ? rest
        : undefined
      : { ...speed, walk };
  }
  return walk;
}

/**
 * `speed` with another way to move set or taken out. A block left with its
 * walking speed alone goes back to a number, unless `block` (the original's
 * is one), so adding a speed and taking it out again changes nothing.
 */
export function withSpeed(
  speed: unknown,
  mode: string,
  feet: number | undefined,
  block: boolean,
): unknown {
  const next: Json = isRecord(speed)
    ? { ...speed }
    : typeof speed === 'number'
      ? { walk: speed }
      : {};
  if (feet === undefined) delete next[mode];
  else next[mode] = feet;
  const keys = Object.keys(next);
  if (keys.length === 0) return undefined;
  return !block && keys.join() === 'walk' ? next.walk : next;
}

/**
 * A species' ability scores as fixed amounts and, maybe, a number of
 * abilities of the player's choice, when it is that simple: one block, each
 * amount up from 0. Undefined for more (alternatives, a weighted choice).
 */
export function abilityShape(
  ability: unknown,
): { fixed: Json; choose?: { count?: number; amount?: number; from?: unknown } } | undefined {
  if (absent(ability)) return { fixed: {} };
  if (!Array.isArray(ability) || ability.length !== 1 || !isRecord(ability[0])) return undefined;
  const { choose, ...fixed } = ability[0];
  const whole = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) > 0);
  const plain =
    Object.entries(fixed).every(([k, v]) => ABILITY_WORDS.some(([a]) => a === k) && whole(v)) &&
    (choose === undefined ||
      (isRecord(choose) &&
        Object.keys(choose).every((k) => k === 'from' || k === 'count' || k === 'amount') &&
        whole(choose.count) &&
        whole(choose.amount)));
  return plain ? { fixed, choose: isRecord(choose) ? choose : undefined } : undefined;
}

function AbilityScores({ draft, change, readOnly }: EditorProps) {
  const shape = abilityShape(draft.ability);
  if (shape === undefined) return <Kept label="Ability scores">a choice, kept as it is.</Kept>;
  const block = Array.isArray(draft.ability) && isRecord(draft.ability[0]) ? draft.ability[0] : {};
  const put = (key: string, v: unknown) => {
    const next: Json = { ...block, [key]: v };
    if (v === undefined) delete next[key];
    change({ ability: Object.keys(next).length > 0 ? [next] : undefined });
  };
  const choose = shape.choose ?? {};
  // A choice that names no count is a choice of one, as the sheet asks it.
  const count = choose.count ?? (shape.choose !== undefined ? 1 : undefined);
  const from = Array.isArray(choose.from) ? (choose.from as unknown[]) : undefined;
  const pick = (k: 'count' | 'amount', n: number | undefined) => {
    if (k === 'count' && n === undefined) return put('choose', undefined);
    const next: Json = { ...choose, [k]: n };
    if (n === undefined) delete next[k];
    put('choose', next);
  };
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {ABILITY_WORDS.map(([k, label]) => (
          <NumberField
            key={k}
            label={`${label} +`}
            value={typeof shape.fixed[k] === 'number' ? (shape.fixed[k] as number) : undefined}
            placeholder="0"
            disabled={readOnly}
            onChange={(n) => put(k, n === 0 ? undefined : n)}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Abilities of their choice"
          value={count}
          placeholder="None"
          disabled={readOnly}
          onChange={(n) => pick('count', n === 0 ? undefined : n)}
        />
        {count !== undefined && (
          <HeldNumber
            label="Each raised by"
            value={choose.amount ?? 1}
            min={1}
            disabled={readOnly}
            onChange={(n) => pick('amount', n <= 1 ? undefined : n)}
          />
        )}
      </div>
      {from !== undefined && (
        <Kept label="Abilities of their choice">
          {`from ${from.map((a) => String(a).toUpperCase()).join(', ')} only, kept as it is.`}
        </Kept>
      )}
    </>
  );
}

/** A damage or condition list of plain names as chips; one holding a choice is kept. */
function DefensePicks({
  label,
  field,
  options,
  draft,
  change,
  readOnly,
}: EditorProps & {
  label: string;
  field: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  const v = draft[field];
  const picks =
    v === undefined || v === null
      ? []
      : Array.isArray(v) && v.every((r) => typeof r === 'string')
        ? (v as string[])
        : undefined;
  if (picks === undefined) return <Kept label={label}>a choice, kept as it is.</Kept>;
  // A name the chips do not offer stays, after them.
  const others = picks.filter((p) => !options.some(([k]) => k === p));
  return (
    <div className="flex flex-col gap-2">
      <ChipPicks
        label={label}
        options={options}
        value={picks}
        disabled={readOnly}
        onChange={(next) => {
          const all = [...next.filter((p) => !others.includes(p)), ...others];
          change({ [field]: all.length === 0 ? undefined : all });
        }}
      />
      {others.length > 0 && (
        <Kept label={label}>{`also ${others.join(', ')}, kept as it is.`}</Kept>
      )}
    </div>
  );
}

/**
 * Speeds and senses as feet; one written with a condition is kept as it is.
 * A subrace's (`sub`) that it leaves empty are its species'.
 */
function Movement({ draft, change, original, readOnly, sub }: EditorProps & { sub: boolean }) {
  const speed = isRecord(draft.speed) ? draft.speed : {};
  const block = isRecord(original?.speed);
  // A subrace's speed takes the place of its species' speeds, all of them.
  const theirs = sub && absent(draft.speed);
  return (
    <div className="grid grid-cols-2 gap-2">
      <NumberField
        label="Speed in feet"
        value={walkSpeed(draft.speed)}
        placeholder={theirs ? 'As the species' : undefined}
        disabled={readOnly}
        onChange={(walk) => change({ speed: withWalkSpeed(draft.speed, walk) })}
      />
      {(['fly', 'swim', 'climb'] as const).map((mode) => {
        const v = speed[mode];
        const label = `${mode[0]?.toUpperCase()}${mode.slice(1)} speed`;
        return v === undefined || v === true || typeof v === 'number' ? (
          <NumberField
            key={mode}
            label={label}
            value={typeof v === 'number' ? v : undefined}
            // `true` is as fast as the character walks, until a number is typed.
            placeholder={v === true ? 'As walking' : theirs ? 'As the species' : 'None'}
            disabled={readOnly}
            onChange={(feet) =>
              change({
                speed: withSpeed(draft.speed, mode, feet === 0 ? undefined : feet, block),
              })
            }
          />
        ) : (
          <Kept key={mode} label={label}>
            a speed with a condition, kept as it is.
          </Kept>
        );
      })}
      {(['darkvision', 'blindsight'] as const).map((sense) => (
        <NumberField
          key={sense}
          label={`${sense[0]?.toUpperCase()}${sense.slice(1)} in feet`}
          value={typeof draft[sense] === 'number' ? (draft[sense] as number) : undefined}
          placeholder={sub ? 'As the species' : 'None'}
          disabled={readOnly}
          onChange={(d) => change({ [sense]: d === 0 ? undefined : d })}
        />
      ))}
    </div>
  );
}

/** What a sheet makes of a field: the species' own, or a subrace's beside its species'. */
const ON_SHEET = {
  movement: [
    'speeds and senses, on the Stats tab.',
    "speeds and senses, on the Stats tab, in place of the species' own.",
  ],
  ability: [
    'the ability scores, a choice asked when the character is built.',
    "the ability scores, added to the species', a choice asked when built.",
  ],
  defenses: [
    'defenses, on the Stats tab.',
    "defenses, on the Stats tab, in place of the species' own.",
  ],
  proficiencies: [
    'proficiencies and languages, on the Stats tab; a choice is asked when built.',
    "the Stats tab, skills and languages beside the species' own, tools, weapons and armor in their place.",
  ],
  spells: [
    'the Spells tab, each from the character level it names.',
    "the Spells tab, each from the character level it names, in place of the species' spells.",
  ],
} as const;

/**
 * Everything a species gives but its size, shared with its subraces (`sub`),
 * whose fields a sheet reads over their species' own. `about` opens the first
 * section (the sizes, or the species a subrace belongs to); `after` ends it.
 */
export function OriginParts(
  props: EditorProps & { sub: boolean; about: ReactNode; after?: ReactNode },
) {
  const { draft, change, original, readOnly, registry, sub, about, after } = props;
  const said = (k: keyof typeof ON_SHEET) => ON_SHEET[k][sub ? 1 : 0];
  const grant = (field: string) => ({
    raw: draft[field],
    readOnly,
    onChange: (next: unknown) => change({ [field]: next }),
  });
  return (
    <>
      <Section title="About them">
        {about}
        <Movement {...props} />
        <OnSheet>{said('movement')}</OnSheet>
      </Section>
      <Section title="Ability scores">
        <AbilityScores {...props} />
        <OnSheet>{said('ability')}</OnSheet>
      </Section>
      <Section title="Defenses">
        <DefensePicks {...props} label="Resistances" field="resist" options={DAMAGE} />
        <DefensePicks {...props} label="Immunities" field="immune" options={DAMAGE} />
        <DefensePicks {...props} label="Vulnerabilities" field="vulnerable" options={DAMAGE} />
        <DefensePicks
          {...props}
          label="Conditions they cannot have"
          field="conditionImmune"
          options={CONDITIONS}
        />
        <OnSheet>{said('defenses')}</OnSheet>
      </Section>
      <Section title="Proficiencies and languages">
        <GrantField
          {...grant('skillProficiencies')}
          label="Skills"
          options={SKILL_WORDS}
          anyKey="any"
          anyLabel="Skills of their choice"
        />
        <GrantField
          {...grant('languageProficiencies')}
          label="Languages"
          options={LANGUAGE_WORDS}
          anyKey="anyStandard"
          anyLabel="Languages of their choice"
        />
        <GrantField
          {...grant('toolProficiencies')}
          label="Tools"
          placeholder="Thieves' tools, smith's tools"
          anyKey="any"
          anyLabel="Tools of their choice"
        />
        <GrantField
          {...grant('weaponProficiencies')}
          label="Weapons"
          placeholder="Longsword|XPHB"
        />
        <GrantField {...grant('armorProficiencies')} label="Armor" options={ARMOR_WORDS} />
        <OnSheet>{said('proficiencies')}</OnSheet>
      </Section>
      <Section title="Spells">
        <SpellsGiven
          raw={draft.additionalSpells}
          registry={registry}
          draft={draft}
          readOnly={readOnly}
          onChange={(additionalSpells) => change({ additionalSpells })}
        />
        <OnSheet>{said('spells')}</OnSheet>
      </Section>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Section title="Traits">
        <PartList
          title="Traits"
          noun="trait"
          entries={draft.entries}
          original={original?.entries}
          source={original !== undefined ? String(original.source) : undefined}
          readOnly={readOnly}
          withEffects
          onChange={(entries) => change({ entries })}
        />
      </Section>
      {after}
    </>
  );
}

/**
 * The species' own subraces, each found by the species it names, and Add a
 * subrace, which opens a new one already naming it. Only for a species saved
 * under the name it has: a subrace finds its species by that name and book.
 * A copy not saved yet still has its original's book, so it is not one: its
 * subraces would be the original's, which the Workshop cannot open as theirs.
 */
function Subraces({ draft, original, registry }: EditorProps) {
  const name = typeof draft.name === 'string' ? draft.name : '';
  const source = typeof draft.source === 'string' ? draft.source : '';
  const unsavedCopy = original !== undefined && source === String(original.source);
  if (name === '' || unsavedCopy || registry.get('race', name, source) === undefined) {
    return <p className="text-caption text-ink-muted">Save the species to add a subrace to it.</p>;
  }
  const own = registry
    .byType('subrace')
    .filter((s) => typeof s.name === 'string' && subraceBelongsTo(s, { name, source }));
  return (
    <div className="flex flex-col gap-2">
      {own.length > 0 && (
        <ul aria-label="Subraces" className={listClass}>
          {own.map((s) => (
            <li key={`${String(s.name)}|${String(s.source)}`} className="px-4 py-3">
              <Link
                to={editPath('subrace', String(s.name), String(s.source))}
                className="text-body-strong underline-offset-2 hover:underline"
              >
                {String(s.name)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/workshop/new/subrace"
        state={{ seed: { raceName: name, raceSource: source } }}
        className="tap self-start text-body-strong underline underline-offset-2"
      >
        Add a subrace
      </Link>
      <OnSheet>a character of this species picks one of these when built.</OnSheet>
    </div>
  );
}

function SpeciesBody(props: EditorProps) {
  const { draft, change, readOnly } = props;
  const sizes = Array.isArray(draft.size) ? draft.size.map(String) : [];
  // Tapping a chip changes only the sizes the chips offer; the rest stay.
  const unoffered = sizes.filter((k) => !OFFERED.has(k));
  const about = (
    <>
      <ChipPicks
        label="Size"
        options={SIZES}
        value={sizes}
        disabled={readOnly}
        onChange={(v) => {
          // Varies is the player's pick of a size, so it goes with no other.
          const added = v.find((k) => !sizes.includes(k));
          const picked = added === 'V' ? ['V'] : v.filter((k) => k !== 'V' || added === undefined);
          const next = [...SIZES.map(([k]) => k).filter((k) => picked.includes(k)), ...unoffered];
          change({ size: next.length === 0 ? undefined : next });
        }}
      />
      {unoffered.length > 0 && (
        <Kept label="Size">
          also {unoffered.join(', ')}, kept as {unoffered.length === 1 ? 'it is' : 'they are'}.
        </Kept>
      )}
      <OnSheet>the Library lists the size.</OnSheet>
    </>
  );
  const after = (
    <Section title="Subraces">
      <Subraces {...props} />
    </Section>
  );
  return <OriginParts {...props} sub={false} about={about} after={after} />;
}

export const editor: EditorSpec = {
  noun: 'species',
  blank: () => ({ size: ['M'], speed: 30, entries: [] }),
  Body: SpeciesBody,
};
