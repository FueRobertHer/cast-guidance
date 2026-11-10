/**
 * The controls every Workshop editor builds from: a labelled field, a
 * dropdown, a number, a set of toggle chips, and an entry's own text. They
 * follow the design system's fields (DS-001) and stay out of `editors/`, which
 * holds editors alone.
 */
import { ChevronDown } from 'lucide-react';
import { type ReactNode, type SelectHTMLAttributes, useId, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { plainEntryText } from '@/data5e/entries/plainText';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { editionOf } from '@/data5e/rulesVersion';
import { isRecord } from '@/engine/castGuidance';
import { entriesToText, textToEntries } from '@/lib/entriesText';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { fieldClass } from '@/ui/TextField';
import { partName, same } from './copyWriter';

/**
 * One printing of each name, for a list to pick from: the one in the entry's
 * own rules edition where the data has it (a 2014 spell's Wizard is the PHB
 * one), else the first. Sorted by name.
 */
export function onePerName(
  entities: readonly Entity[],
  entry: Entity,
): Array<{ name: string; source: string }> {
  const want = editionOf(entry);
  const byName = new Map<string, { name: string; source: string; fits: boolean }>();
  for (const e of entities) {
    if (typeof e.name !== 'string' || typeof e.source !== 'string') continue;
    const key = e.name.toLowerCase();
    const fits = editionOf(e) === want;
    const had = byName.get(key);
    if (had === undefined || (fits && !had.fits))
      byName.set(key, { name: e.name, source: e.source, fits });
  }
  return [...byName.values()]
    .map(({ name, source }) => ({ name, source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The six abilities, by the key the data uses. */
export const ABILITY_WORDS: ReadonlyArray<readonly [string, string]> = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-overline text-ink-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always one form control
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-label text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

/** A dropdown in the design's field, with its own chevron. */
export function Select(props: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <div className="relative">
      <select {...props} className={`${fieldClass} appearance-none pr-9`} />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
      />
    </div>
  );
}

/** A whole number, or nothing when the box is empty. */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isNaN(n) ? undefined : Math.max(0, Math.min(999, n)));
        }}
        className={fieldClass}
      />
    </Field>
  );
}

/** Several of a short list, each a toggle chip: skills, sizes, damage types. */
export function ChipPicks({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
  value: readonly string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-label text-ink-muted">
        {label}
      </span>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons */}
      <div role="group" aria-labelledby={id} className="-mx-1.5 flex flex-wrap">
        {options.map(([v, text]) => {
          const on = value.includes(v);
          return (
            <Chip
              key={v}
              tone="outline"
              pressed={on}
              disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
            >
              {text}
            </Chip>
          );
        })}
      </div>
    </div>
  );
}

/** A line saying a field holds more than the editor can show, and is kept as it is. */
export function Kept({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="rounded-control bg-surface-raised px-3 py-2 text-caption text-ink-muted">
      <span className="font-semibold text-ink">{label}: </span>
      {children}
    </p>
  );
}

/** The blocks of `entries` that are not named parts: the entry's own text. */
export function textBlocks(entries: unknown): unknown[] {
  return Array.isArray(entries) ? entries.filter((b) => partName(b) === undefined) : [];
}

/**
 * `entries` with its text replaced and its named parts as they were. Blocks
 * stay where they stood while their number holds, so a copy that rewords a
 * paragraph is still saved as that one change.
 */
export function withText(entries: unknown, text: unknown[]): unknown[] {
  const list = Array.isArray(entries) ? entries : [];
  const old = textBlocks(list);
  if (old.length === text.length) {
    let i = 0;
    return list.map((b) => (partName(b) === undefined ? text[i++] : b));
  }
  return [...text, ...list.filter((b) => partName(b) !== undefined)];
}

/**
 * An entry's own text. Plain paragraphs and simple lists are edited as text;
 * anything else (a table, a list of named items, a reference tag the book
 * links) is shown as the book prints it, with a way to write your own in its
 * place, starting from the words it reads as.
 */
export function TextBlocks({
  entries,
  onChange,
  readOnly,
  label = 'Text',
}: {
  entries: unknown;
  onChange: (entries: unknown[]) => void;
  readOnly: boolean;
  label?: string;
}) {
  const blocks = textBlocks(entries);
  const plain =
    same(textToEntries(entriesToText(blocks)), blocks) && !entriesToText(blocks).includes('{@');
  // Held as typed: turning text into blocks drops a trailing blank line, which
  // would eat the one a new paragraph starts with.
  const [typed, setText] = useState(() => (plain ? entriesToText(blocks) : ''));
  const [own, setOwn] = useState(plain);
  // Text set from outside (Keep putting a part back) replaces what was typed.
  const text = same(textToEntries(typed), blocks) ? typed : entriesToText(blocks);
  if (!own) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-label text-ink-muted">{label}</span>
        <div className="rounded-control bg-surface-raised p-3">
          <EntriesView entries={blocks} />
        </div>
        {!readOnly && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              const words = plainEntryText(entriesToText(blocks));
              setText(words);
              setOwn(true);
              onChange(withText(entries, textToEntries(words)));
            }}
          >
            Write your own text
          </Button>
        )}
      </div>
    );
  }
  return (
    <Field label={label}>
      <textarea
        value={text}
        disabled={readOnly}
        rows={5}
        placeholder={'Blank line for a new paragraph.\nLines starting "- " make a list.'}
        onChange={(e) => {
          setText(e.target.value);
          onChange(withText(entries, textToEntries(e.target.value)));
        }}
        className={`${fieldClass} min-h-32 py-3`}
      />
    </Field>
  );
}

/** What a prerequisite asks for besides a level, in words. */
const NEEDS: Readonly<Record<string, string>> = {
  ability: 'an ability score',
  spell: 'a spell',
  spellcasting: 'spellcasting',
  spellcasting2020: 'spellcasting',
  spellcastingFeature: 'spellcasting',
  spellcastingPrepared: 'spellcasting',
  pact: 'a pact',
  patron: 'a patron',
  feature: 'a feature',
  feat: 'a feat',
  item: 'an item',
  optionalfeature: 'another option',
  proficiency: 'a proficiency',
  race: 'a species',
  background: 'a background',
  campaign: 'a campaign',
  other: 'something else',
  otherSummary: 'something else',
};

const levelIn = (alt: unknown): number | undefined => {
  if (!isRecord(alt)) return undefined;
  const l = alt.level;
  if (typeof l === 'number') return l;
  return isRecord(l) && typeof l.level === 'number' ? l.level : undefined;
};

/**
 * The level a prerequisite asks for, when it can be edited as one number:
 * none, or the same level in every alternative. `others` is the rest of what
 * it asks for, kept as the book has it.
 */
export function prerequisiteLevel(pre: unknown): {
  editable: boolean;
  level?: number;
  others: string[];
} {
  if (pre === undefined || pre === null) return { editable: true, others: [] };
  if (!Array.isArray(pre) || !pre.every(isRecord)) return { editable: false, others: [] };
  const levels = new Set(pre.map(levelIn));
  const others = [
    ...new Set(
      pre.flatMap((alt) =>
        Object.keys(alt)
          .filter((k) => k !== 'level' && k !== 'note')
          .map((k) => NEEDS[k] ?? k),
      ),
    ),
  ];
  const level = [...levels][0];
  const editable =
    levels.size === 1 && (level !== undefined || pre.every((alt) => !('level' in (alt as object))));
  return { editable, level, others };
}

/** `pre` asking for `level`, or for no level when undefined. */
export function withPrerequisiteLevel(pre: unknown, level: number | undefined): unknown {
  const list: Array<Record<string, unknown>> =
    Array.isArray(pre) && pre.length > 0 ? pre.filter(isRecord) : [{}];
  const next = list
    .map((alt) => {
      const { level: was, ...rest } = alt;
      if (level === undefined) return rest;
      return { ...rest, level: isRecord(was) ? { ...was, level } : level };
    })
    .filter((alt) => Object.keys(alt).length > 0);
  return next.length > 0 ? next : undefined;
}

/** A prerequisite's level as a number box, the rest of it kept as it is. */
export function PrerequisiteField({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
}) {
  const { editable, level, others } = prerequisiteLevel(value);
  return (
    <div className="flex flex-col gap-2">
      {editable && (
        <NumberField
          label="Character level needed"
          value={level}
          placeholder="Any"
          disabled={readOnly}
          onChange={(l) => onChange(withPrerequisiteLevel(value, l === 0 ? undefined : l))}
        />
      )}
      {(!editable || others.length > 0) && (
        <Kept label="Also needs">
          {others.length > 0 ? others.join(', ') : 'more than one level'}, kept as it is.
        </Kept>
      )}
    </div>
  );
}
