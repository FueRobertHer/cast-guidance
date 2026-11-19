/**
 * Feats: what kind of feat it is, the ability score it raises, what it needs,
 * the proficiencies, senses and spells it gives, its text and benefits, and
 * what it does on the sheet.
 */
import { isRecord } from '@/engine/castGuidance';
import { EntryEffects } from '../EffectCards';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import {
  ABILITY_WORDS,
  ChipPicks,
  Field,
  Kept,
  NumberField,
  Section,
  Select,
  TextBlocks,
} from '../fields';
import {
  ARMOR_WORDS,
  GrantField,
  LANGUAGE_WORDS,
  OnSheet,
  Prerequisites,
  SKILL_WORDS,
  SpellsGiven,
} from '../originFields';
import { PartList } from '../PartList';

const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const;

/** A feat's senses (`[{ darkvision: 60 }]`) as feet, when that is all the list says. */
export function sensesShape(senses: unknown): Json | undefined {
  if (senses === undefined) return {};
  if (!Array.isArray(senses) || senses.length !== 1 || !isRecord(senses[0])) return undefined;
  return Object.values(senses[0]).every((v) => typeof v === 'number') ? senses[0] : undefined;
}

function Senses({ draft, change, readOnly }: EditorProps) {
  const shape = sensesShape(draft.senses);
  if (shape === undefined) return <Kept label="Senses">more than one list, kept as it is.</Kept>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {SENSES.map((sense) => (
        <NumberField
          key={sense}
          label={`${sense[0]?.toUpperCase()}${sense.slice(1)} in feet`}
          value={typeof shape[sense] === 'number' ? (shape[sense] as number) : undefined}
          placeholder="None"
          disabled={readOnly}
          onChange={(feet) => {
            const next: Json = { ...shape, [sense]: feet };
            if (feet === undefined || feet === 0) delete next[sense];
            change({ senses: Object.keys(next).length > 0 ? [next] : undefined });
          }}
        />
      ))}
    </div>
  );
}

const CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  ['', 'No category'],
  ['O', 'Origin'],
  ['G', 'General'],
  ['FS', 'Fighting style'],
  ['EB', 'Epic boon'],
];

const ABILITY_KEYS = new Set(ABILITY_WORDS.map(([k]) => k));

/**
 * A feat's ability increase as the abilities it may raise by 1, when it is
 * that simple: one fixed ability, or one to choose from a list. `extra` is
 * what else the block says (a maximum), kept when the picks change.
 */
export function abilityPicks(ability: unknown): { picks: string[]; extra: Json } | undefined {
  if (ability === undefined || ability === null) return { picks: [], extra: {} };
  if (!Array.isArray(ability) || ability.length !== 1 || !isRecord(ability[0])) return undefined;
  const { choose, ...rest } = ability[0];
  if (choose !== undefined) {
    if (!isRecord(choose) || !Array.isArray(choose.from)) return undefined;
    if (Object.keys(choose).some((k) => k !== 'from' && !(k === 'amount' && choose[k] === 1)))
      return undefined;
    const others = Object.keys(rest).filter((k) => k !== 'max');
    return others.length === 0 ? { picks: choose.from.map(String), extra: rest } : undefined;
  }
  const fixed = Object.entries(rest).filter(([k]) => ABILITY_KEYS.has(k));
  if (fixed.length !== 1 || fixed[0]?.[1] !== 1) return undefined;
  const extra: Json = {};
  for (const [k, v] of Object.entries(rest)) if (!ABILITY_KEYS.has(k)) extra[k] = v;
  return Object.keys(extra).every((k) => k === 'max') ? { picks: [fixed[0][0]], extra } : undefined;
}

/** The ability block for `picks`: none, one fixed, or one to choose. */
export function abilityFor(picks: readonly string[], extra: Json): unknown {
  if (picks.length === 0) return undefined;
  const ordered = ABILITY_WORDS.map(([k]) => k).filter((k) => picks.includes(k));
  if (ordered.length === 1) return [{ [ordered[0] as string]: 1, ...extra }];
  return [{ choose: { from: ordered }, ...extra }];
}

function FeatBody(props: EditorProps) {
  const { draft, change, original, readOnly, registry } = props;
  const category = typeof draft.category === 'string' ? draft.category : '';
  const ability = abilityPicks(draft.ability);
  const options = CATEGORIES.some(([v]) => v === category)
    ? CATEGORIES
    : [...CATEGORIES, [category, category] as const];
  const grant = (field: string) => ({
    raw: draft[field],
    readOnly,
    onChange: (next: unknown) => change({ [field]: next }),
  });
  return (
    <>
      <Section title="About it">
        <Field label="Kind of feat">
          <Select
            value={category}
            disabled={readOnly}
            onChange={(e) =>
              change({ category: e.target.value === '' ? undefined : e.target.value })
            }
          >
            {options.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex min-h-tap items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            disabled={readOnly}
            checked={draft.repeatable === true}
            onChange={(e) => change({ repeatable: e.target.checked ? true : undefined })}
          />
          Can be taken more than once
        </label>
        {ability !== undefined ? (
          <ChipPicks
            label="Raises one ability score by 1"
            options={ABILITY_WORDS}
            value={ability.picks}
            disabled={readOnly}
            onChange={(picks) => change({ ability: abilityFor(picks, ability.extra) })}
          />
        ) : (
          <Kept label="Ability scores">more than one increase, kept as it is.</Kept>
        )}
      </Section>
      <Section title="What it needs">
        <Prerequisites
          value={draft.prerequisite}
          readOnly={readOnly}
          onChange={(prerequisite) => change({ prerequisite })}
        />
        <OnSheet>the feat lists say what it needs, and warn one who may not have it.</OnSheet>
      </Section>
      <Section title="Proficiencies">
        <GrantField
          {...grant('skillProficiencies')}
          label="Skills"
          options={SKILL_WORDS}
          anyKey="any"
          anyLabel="Skills of their choice"
        />
        <GrantField
          {...grant('expertise')}
          label="Expertise"
          options={SKILL_WORDS}
          anyKey="anyProficientSkill"
          anyLabel="Expertise in skills of their choice"
        />
        <GrantField
          {...grant('toolProficiencies')}
          label="Tools"
          placeholder="Thieves' tools, smith's tools"
          anyKey="any"
          anyLabel="Tools of their choice"
        />
        <GrantField
          {...grant('languageProficiencies')}
          label="Languages"
          options={LANGUAGE_WORDS}
          anyKey="anyStandard"
          anyLabel="Languages of their choice"
        />
        <GrantField {...grant('weaponProficiencies')} label="Weapons" placeholder="Martial" />
        <GrantField {...grant('armorProficiencies')} label="Armor" options={ARMOR_WORDS} />
        <OnSheet>
          proficiencies and languages, on the Stats tab; a choice is asked when taken.
        </OnSheet>
      </Section>
      <Section title="Senses">
        <Senses {...props} />
        <OnSheet>senses, on the Stats tab.</OnSheet>
      </Section>
      <Section title="Spells">
        <SpellsGiven
          raw={draft.additionalSpells}
          registry={registry}
          draft={draft}
          readOnly={readOnly}
          onChange={(additionalSpells) => change({ additionalSpells })}
        />
        <OnSheet>the Spells tab, each from the character level it names.</OnSheet>
      </Section>
      <Section title="Text">
        <TextBlocks
          label="Paragraphs"
          entries={draft.entries}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <Section title="Benefits">
        <PartList
          title="Benefits"
          noun="benefit"
          entries={draft.entries}
          original={original?.entries}
          source={original !== undefined ? String(original.source) : undefined}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
      <EntryEffects draft={draft} change={change} original={original} readOnly={readOnly} />
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'feat',
  blank: () => ({ category: 'G', entries: [] }),
  Body: FeatBody,
};
