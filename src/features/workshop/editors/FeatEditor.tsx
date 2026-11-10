/**
 * Feats: what kind of feat it is, what it needs, the ability score it raises,
 * its text and benefits, and what it does on the sheet.
 */
import { isRecord } from '@/engine/castGuidance';
import { EntryEffects } from '../EffectCards';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import {
  ABILITY_WORDS,
  ChipPicks,
  Field,
  Kept,
  PrerequisiteField,
  Section,
  Select,
  TextBlocks,
} from '../fields';
import { PartList } from '../PartList';

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

function FeatBody({ draft, change, original, readOnly }: EditorProps) {
  const category = typeof draft.category === 'string' ? draft.category : '';
  const ability = abilityPicks(draft.ability);
  const options = CATEGORIES.some(([v]) => v === category)
    ? CATEGORIES
    : [...CATEGORIES, [category, category] as const];
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
        <PrerequisiteField
          value={draft.prerequisite}
          readOnly={readOnly}
          onChange={(prerequisite) => change({ prerequisite })}
        />
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
