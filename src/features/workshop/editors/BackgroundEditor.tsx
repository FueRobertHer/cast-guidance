/**
 * Backgrounds: the skills, tools and languages they give, the three ability
 * scores a 2024 background raises, the origin feat, and their text. What a
 * background does on the sheet comes from these fields; the sheet does not
 * read effect cards on a background yet, so this editor has none.
 */
import { useState } from 'react';
import { isRecord } from '@/engine/castGuidance';
import { isLanguageOrToolMix } from '@/engine/effects/readers';
import { SKILLS } from '@/engine/types';
import { fieldClass } from '@/ui/TextField';
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
import { PartList } from '../PartList';

const SKILL_KEYS: ReadonlyArray<readonly [string, string]> = SKILLS.map(
  (s) => [s.name.toLowerCase(), s.name] as const,
);

/** The keys of a `[{ key: true, ... }]` list, when it is one; undefined otherwise. */
export function trueKeys(v: unknown, allowed?: ReadonlySet<string>): string[] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length !== 1 || !isRecord(v[0])) return undefined;
  const entries = Object.entries(v[0]);
  if (!entries.every(([k, x]) => x === true && (allowed === undefined || allowed.has(k))))
    return undefined;
  return entries.map(([k]) => k);
}

/** `[{ key: true, ... }]` for `keys`, or nothing for none. */
export const trueList = (keys: readonly string[]): unknown =>
  keys.length === 0 ? undefined : [Object.fromEntries(keys.map((k) => [k, true]))];

/**
 * The three abilities a 2024 background raises (+2 and +1, or +1 to each), when
 * its block says only that.
 */
export function backgroundAbilities(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const froms = v.map((b) => {
    const w = isRecord(b) && isRecord(b.choose) ? b.choose.weighted : undefined;
    return isRecord(w) && Array.isArray(w.from)
      ? { from: w.from.map(String), w: w.weights }
      : undefined;
  });
  const [a, b] = froms;
  if (a === undefined || b === undefined) return undefined;
  if (JSON.stringify(a.w) !== '[2,1]' || JSON.stringify(b.w) !== '[1,1,1]') return undefined;
  return JSON.stringify(a.from) === JSON.stringify(b.from) ? a.from : undefined;
}

export function backgroundAbilityBlock(picks: readonly string[]): unknown {
  if (picks.length === 0) return undefined;
  const from = ABILITY_WORDS.map(([k]) => k).filter((k) => picks.includes(k));
  return [
    { choose: { weighted: { from, weights: [2, 1] } } },
    { choose: { weighted: { from, weights: [1, 1, 1] } } },
  ];
}

const title = (s: string) => s.trim().replaceAll(/\b\w/g, (c) => c.toUpperCase());

/** A feat key the list does not hold, as words: `magic initiate; cleric|xphb` is "Magic Initiate, Cleric (XPHB)". */
export function featLabel(key: string): string {
  const [name = '', source] = key.split('|');
  const [base = '', variant] = name.split(';');
  const words = variant === undefined ? title(base) : `${title(base)}, ${title(variant)}`;
  return source === undefined ? words : `${words} (${source.toUpperCase()})`;
}

/** Names separated by commas, as typed; kept as typed while it still says the same. */
function NamesField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: readonly string[];
  onChange: (names: string[]) => void;
  readOnly: boolean;
}) {
  const [typed, setTyped] = useState(() => value.join(', '));
  const parse = (t: string) =>
    t
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x !== '');
  const text = JSON.stringify(parse(typed)) === JSON.stringify(value) ? typed : value.join(', ');
  return (
    <Field label={label}>
      <input
        value={text}
        disabled={readOnly}
        placeholder="None"
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(parse(e.target.value));
        }}
        className={fieldClass}
      />
    </Field>
  );
}

function BackgroundBody({ draft, change, original, registry, readOnly }: EditorProps) {
  const skills = trueKeys(draft.skillProficiencies, new Set(SKILL_KEYS.map(([k]) => k)));
  const tools = trueKeys(draft.toolProficiencies);
  const langs = draft.languageProficiencies;
  // Custom Background's languages and tools in any mix stand in for its languages.
  const mixed = isLanguageOrToolMix(draft.skillToolLanguageProficiencies);
  const anyLangs = mixed
    ? undefined
    : langs === undefined || langs === null
      ? 0
      : Array.isArray(langs) &&
          langs.length === 1 &&
          isRecord(langs[0]) &&
          Object.keys(langs[0]).length === 1 &&
          typeof langs[0].anyStandard === 'number'
        ? langs[0].anyStandard
        : undefined;
  const abilities = backgroundAbilities(draft.ability);
  const feat = trueKeys(draft.feats);
  const featKey = feat?.[0] ?? '';
  const origins = registry
    .byType('feat')
    .filter((f) => f.category === 'O')
    .map(
      (f) =>
        [
          `${String(f.name)}|${String(f.source)}`.toLowerCase(),
          `${String(f.name)} (${String(f.source)})`,
        ] as const,
    )
    .sort((a, b) => a[1].localeCompare(b[1]));
  const featOptions =
    featKey === '' || origins.some(([k]) => k === featKey)
      ? origins
      : [[featKey, featLabel(featKey)] as const, ...origins];

  return (
    <>
      <Section title="What it gives">
        {skills !== undefined ? (
          <ChipPicks
            label="Skill proficiencies"
            options={SKILL_KEYS}
            value={skills}
            disabled={readOnly}
            onChange={(keys) => change({ skillProficiencies: trueList(keys) })}
          />
        ) : (
          <Kept label="Skill proficiencies">a choice, kept as it is.</Kept>
        )}
        {tools !== undefined ? (
          <NamesField
            label="Tool proficiencies"
            value={tools}
            readOnly={readOnly}
            onChange={(keys) => change({ toolProficiencies: trueList(keys) })}
          />
        ) : (
          <Kept label="Tool proficiencies">a choice, kept as it is.</Kept>
        )}
        {anyLangs !== undefined ? (
          <NumberField
            label="Languages of your choice"
            value={anyLangs === 0 ? undefined : anyLangs}
            placeholder="None"
            disabled={readOnly}
            onChange={(n) =>
              change({
                languageProficiencies:
                  n === undefined || n === 0 ? undefined : [{ anyStandard: n }],
              })
            }
          />
        ) : mixed ? (
          <Kept label="Languages">languages or tools of your choice, kept as they are.</Kept>
        ) : (
          <Kept label="Languages">named languages, kept as they are.</Kept>
        )}
        {abilities !== undefined ? (
          <ChipPicks
            label="Ability scores it raises (pick three)"
            options={ABILITY_WORDS}
            value={abilities}
            disabled={readOnly}
            onChange={(picks) => change({ ability: backgroundAbilityBlock(picks) })}
          />
        ) : (
          <Kept label="Ability scores">kept as they are.</Kept>
        )}
        {feat !== undefined && feat.length <= 1 ? (
          <Field label="Origin feat">
            <Select
              value={featKey}
              disabled={readOnly}
              onChange={(e) =>
                change({ feats: trueList(e.target.value === '' ? [] : [e.target.value]) })
              }
            >
              <option value="">None</option>
              {featOptions.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Kept label="Feats">a choice, kept as it is.</Kept>
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
      <Section title="Features">
        <PartList
          title="Features"
          noun="feature"
          entries={draft.entries}
          original={original?.entries}
          source={original !== undefined ? String(original.source) : undefined}
          readOnly={readOnly}
          onChange={(entries) => change({ entries })}
        />
      </Section>
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'background',
  blank: () => ({ entries: [] }),
  Body: BackgroundBody,
  check: (draft: Json) => {
    const picks = backgroundAbilities(draft.ability);
    return picks !== undefined && picks.length !== 0 && picks.length !== 3
      ? 'Pick three ability scores, or none.'
      : undefined;
  },
};
