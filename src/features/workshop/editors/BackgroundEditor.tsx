/**
 * Backgrounds: the skills, tools and languages they give (by name, and a
 * choice of more), the three ability scores a 2024 background raises, the
 * origin feat, the spells it gives, what it does on the sheet, and their text.
 * The sheet reads the fields as what a background inherits (background.ts):
 * its own effects add to them, and turning off what the original does turns
 * them off too.
 */
import { useState } from 'react';
import { isRecord } from '@/engine/castGuidance';
import { isLanguageOrToolMix } from '@/engine/effects/readers';
import { SKILLS } from '@/engine/types';
import { fieldClass } from '@/ui/TextField';
import { HeldCount } from '../classFields';
import { EntryEffects } from '../EffectCards';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import { ABILITY_WORDS, ChipPicks, Field, Kept, Section, Select, TextBlocks } from '../fields';
import { OnSheet, SpellsGiven } from '../originFields';
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
  placeholder = 'None',
}: {
  label: string;
  value: readonly string[];
  onChange: (names: string[]) => void;
  readOnly: boolean;
  placeholder?: string;
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
        placeholder={placeholder}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(parse(e.target.value));
        }}
        className={fieldClass}
      />
    </Field>
  );
}

type Options = ReadonlyArray<readonly [string, string]>;

/** A proficiency list's choice: how many, and from what (nothing named: any). */
export interface Choice {
  count: number;
  from: string[];
}

/** A proficiency list as the names it gives and one choice of more. */
export interface Granted {
  names: string[];
  choice?: Choice;
}

/** The tool kinds the data keys as `any…`, in the words the sheet's tool list also reads. */
export const TOOL_KINDS: Options = [
  ['anyGamingSet', 'gaming set'],
  ['anyArtisansTool', "artisan's tools"],
  ['anyMusicalInstrument', 'musical instrument'],
];

const kindWord = (kinds: Options, key: string) =>
  kinds.find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1] ?? key;

/**
 * A `*Proficiencies` list (`[{ insight: true, choose: { from, count } }]`) as
 * names and one choice: from a list (`choose`), of any (`anyKey`: any skill,
 * any standard language), or of a kind (`kinds`: a gaming set). Undefined for
 * more: alternatives, or two choices.
 */
export function grantedOf(raw: unknown, anyKey: string, kinds: Options = []): Granted | undefined {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0))
    return { names: [] };
  if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) return undefined;
  const names: string[] = [];
  const choices: Choice[] = [];
  for (const [k, v] of Object.entries(raw[0])) {
    if (v === true) names.push(k);
    else if (k === 'choose') {
      if (
        !isRecord(v) ||
        !Array.isArray(v.from) ||
        !v.from.every((x) => typeof x === 'string') ||
        (v.count !== undefined && typeof v.count !== 'number') ||
        Object.keys(v).some((x) => x !== 'from' && x !== 'count')
      )
        return undefined;
      choices.push({
        count: typeof v.count === 'number' ? v.count : 1,
        from: v.from.map((x: string) => kindWord(kinds, x)),
      });
    } else if (k === anyKey && typeof v === 'number') choices.push({ count: v, from: [] });
    else if (typeof v === 'number' && kinds.some(([kind]) => kind === k))
      choices.push({ count: v, from: [kindWord(kinds, k)] });
    else return undefined;
  }
  return choices.length > 1 ? undefined : { names, choice: choices[0] };
}

/** The kind `word` names, said with or without "a" or "any", in any letters. */
const kindOf = (kinds: Options, word: string) => {
  const w = word
    .trim()
    .toLowerCase()
    .replace(/^(an?|any)\s+/, '');
  return kinds.find(([, k]) => k === w);
};

/** The list for `g`: a choice of any is `anyKey`, of one kind its key, else `choose`. */
export function grantedWith(g: Granted, anyKey: string, kinds: Options = []): unknown {
  const out: Json = Object.fromEntries(g.names.map((n) => [n, true]));
  const c = g.choice;
  if (c !== undefined && c.count > 0) {
    const from = c.from.map((f) => kindOf(kinds, f)?.[1] ?? f);
    const kind = from.length === 1 ? kindOf(kinds, from[0] ?? '') : undefined;
    if (from.length === 0) out[anyKey] = c.count;
    else if (kind !== undefined) out[kind[0]] = c.count;
    else out.choose = { from, ...(c.count !== 1 ? { count: c.count } : {}) };
  }
  return Object.keys(out).length > 0 ? [out] : undefined;
}

/**
 * One kind of proficiency a background gives: by name (chips, or a box of
 * names), and how many more of the player's choice, from a list or of any.
 */
function GrantChoice({
  raw,
  onChange,
  readOnly,
  anyKey,
  kinds,
  options,
  labels,
  sheet,
}: {
  raw: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
  anyKey: string;
  kinds?: Options;
  /** Chips for the names, where the kind has a set list (skills); a box of names otherwise. */
  options?: Options;
  labels: { names: string; count: string; from: string; any: string };
  sheet: string;
}) {
  const g = grantedOf(raw, anyKey, kinds);
  if (g === undefined) return <Kept label={labels.names}>a choice, kept as it is.</Kept>;
  const set = (patch: Partial<Granted>) => onChange(grantedWith({ ...g, ...patch }, anyKey, kinds));
  const count = g.choice?.count ?? 0;
  const from = g.choice?.from ?? [];
  // A name the list has no chip for (homebrew's own skill) gets one, so it can
  // be seen and taken off; one in other letters ("Arcana") is the list's chip.
  const chips = (value: readonly string[]): Options => {
    if (options === undefined) return [];
    const is = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    return [
      ...options.map(([o, label]) => [value.find((v) => is(v, o)) ?? o, label] as const),
      ...[...new Set(value)]
        .filter((v) => !options.some(([o]) => is(o, v)))
        .map((v) => [v, v] as const),
    ];
  };
  return (
    <div className="flex flex-col gap-3">
      {options !== undefined ? (
        <ChipPicks
          label={labels.names}
          options={chips(g.names)}
          value={g.names}
          disabled={readOnly}
          onChange={(names) => set({ names })}
        />
      ) : (
        <NamesField
          label={labels.names}
          value={g.names}
          readOnly={readOnly}
          onChange={(names) => set({ names })}
        />
      )}
      <HeldCount
        label={labels.count}
        value={count === 0 ? undefined : count}
        disabled={readOnly}
        onChange={(n) => set({ choice: n === undefined ? undefined : { count: n, from } })}
      />
      {count > 0 &&
        (options !== undefined ? (
          <ChipPicks
            label={labels.from}
            options={chips(from)}
            value={from}
            disabled={readOnly}
            onChange={(next) => set({ choice: { count, from: next } })}
          />
        ) : (
          <NamesField
            label={labels.from}
            value={from}
            placeholder={labels.any}
            readOnly={readOnly}
            onChange={(next) => set({ choice: { count, from: next } })}
          />
        ))}
      {count > 0 && from.length === 0 && (
        <p className="text-caption text-ink-muted">With none named, {labels.any.toLowerCase()}.</p>
      )}
      <OnSheet>{sheet}</OnSheet>
    </div>
  );
}

function BackgroundBody({ draft, change, original, registry, readOnly }: EditorProps) {
  // Custom Background's languages and tools in any mix stand in for its languages.
  const mixed = isLanguageOrToolMix(draft.skillToolLanguageProficiencies);
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
        <GrantChoice
          raw={draft.skillProficiencies}
          onChange={(skillProficiencies) => change({ skillProficiencies })}
          readOnly={readOnly}
          anyKey="any"
          options={SKILL_KEYS}
          labels={{
            names: 'Skill proficiencies',
            count: 'Skills of your choice',
            from: 'Skills chosen from',
            any: 'Any skill',
          }}
          sheet="the Skills list, those of your choice a pick on the Build tab."
        />
        <GrantChoice
          raw={draft.toolProficiencies}
          onChange={(toolProficiencies) => change({ toolProficiencies })}
          readOnly={readOnly}
          anyKey="any"
          kinds={TOOL_KINDS}
          labels={{
            names: 'Tool proficiencies',
            count: 'Tools of your choice',
            from: 'Tools chosen from',
            any: 'Any tool',
          }}
          sheet="the Proficiencies list, those of your choice a pick on the Build tab. A gaming set, artisan's tools or a musical instrument is any of that kind."
        />
        {mixed ? (
          <Kept label="Languages">languages or tools of your choice, kept as they are.</Kept>
        ) : (
          <GrantChoice
            raw={draft.languageProficiencies}
            onChange={(languageProficiencies) => change({ languageProficiencies })}
            readOnly={readOnly}
            anyKey="anyStandard"
            labels={{
              names: 'Languages by name',
              count: 'Languages of your choice',
              from: 'Languages chosen from',
              any: 'Any standard language',
            }}
            sheet="the Languages list, those of your choice a pick on the Build tab."
          />
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
      {original !== undefined && (
        <p className="text-caption text-ink-muted">
          Turning off what {String(original.name)} does below turns off what the fields above give
          too.
        </p>
      )}
      <EntryEffects draft={draft} change={change} original={original} readOnly={readOnly} />
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
    if (picks !== undefined && picks.length !== 0 && picks.length !== 3)
      return 'Pick three ability scores, or none.';
    // A choice of more than it names cannot be made on the Build tab; a kind
    // in the sheet's own words (gaming set, in any letters) names many.
    for (const [raw, anyKey, kinds, what] of [
      [draft.skillProficiencies, 'any', [], 'skills'],
      [draft.toolProficiencies, 'any', TOOL_KINDS, 'tools'],
      [draft.languageProficiencies, 'anyStandard', [], 'languages'],
    ] as const) {
      const c = grantedOf(raw, anyKey, kinds)?.choice;
      if (
        c !== undefined &&
        c.from.length > 0 &&
        c.count > c.from.length &&
        !c.from.some((f) => kinds.some(([, k]) => k === f.trim().toLowerCase()))
      )
        return `The ${what} of your choice are ${c.count}, from a list of ${c.from.length}. Name more, or choose fewer.`;
    }
    return undefined;
  },
};
