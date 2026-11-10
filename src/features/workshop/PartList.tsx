/**
 * An entry's named parts (a species' traits, a feat's benefits) as rows
 * (the Subclass board's A). On a copy each of the original's parts says
 * whether it is Kept, Changed or Removed, with Keep, Change and Remove to
 * pick; a part the player adds is New. A renamed part remembers the one it
 * was (`castGuidance.basedOn`), so it is still saved as that part changed,
 * and the sheet still finds what the original part did.
 */
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { isRecord, own } from '@/engine/castGuidance';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import { partName, same } from './copyWriter';
import { EffectCards, guidanceWith } from './EffectCards';
import { Field, TextBlocks } from './fields';

type Json = Record<string, unknown>;
type Mode = 'keep' | 'change' | 'remove';

/** The original part a block stands for: the one it renames, else its own name. */
export function originOf(block: unknown): string | undefined {
  const name = partName(block);
  if (name === undefined || !isRecord(block)) return name;
  const g = own(block, 'castGuidance');
  const based = isRecord(g) ? own(g, 'basedOn') : undefined;
  return typeof based === 'string' ? (based.split('|')[0] ?? name) : name;
}

/** A part renamed: it points at the part it was, until it is named that again. */
export function renamed(block: Json, name: string, origin: string, source: string): Json {
  const g = isRecord(block.castGuidance) ? { ...block.castGuidance } : undefined;
  if (name === origin) {
    if (g === undefined) return { ...block, name };
    delete g.basedOn;
    const { castGuidance: _, ...rest } = block;
    return Object.keys(g).some((k) => k !== 'v')
      ? { ...rest, name, castGuidance: g }
      : { ...rest, name };
  }
  return { ...block, name, castGuidance: { v: 1, ...g, basedOn: `${origin}|${source}` } };
}

/**
 * `list` with `part` put back where the original had it: before the first
 * later original part, and before any part the player added, so a restored
 * part is not saved as a change of order.
 */
export function restore(list: unknown[], part: unknown, names: readonly string[]): unknown[] {
  const at = names.indexOf(partName(part) ?? '');
  const i = list.findIndex((b) => {
    const o = originOf(b);
    if (o === undefined) return false;
    const j = names.indexOf(o);
    return j < 0 || j > at;
  });
  return i < 0 ? [...list, part] : [...list.slice(0, i), part, ...list.slice(i)];
}

interface Row {
  key: string;
  /** The part in the draft; undefined when removed. */
  now?: Json;
  /** The original's part; undefined when new. */
  was?: Json;
  index: number;
}

function PartEditor({
  part,
  noun,
  onChange,
  readOnly,
  withEffects,
  inherits,
  rename,
}: {
  part: Json;
  noun: string;
  onChange: (next: Json) => void;
  readOnly: boolean;
  withEffects: boolean;
  inherits?: string;
  rename: (name: string) => void;
}) {
  const g = isRecord(part.castGuidance) ? part.castGuidance : {};
  const setGuidance = (patch: Json) => {
    const next = guidanceWith(part.castGuidance, patch);
    const { castGuidance: _, ...rest } = part;
    onChange(next !== undefined ? { ...rest, castGuidance: next } : rest);
  };
  return (
    <div className="flex flex-col gap-3 pt-1">
      <Field label={`${noun[0]?.toUpperCase()}${noun.slice(1)} name`}>
        <input
          value={String(part.name ?? '')}
          disabled={readOnly}
          onChange={(e) => rename(e.target.value)}
          className={fieldClass}
        />
      </Field>
      <TextBlocks
        entries={part.entries}
        readOnly={readOnly}
        onChange={(entries) => onChange({ ...part, entries })}
      />
      {withEffects && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted">What it does on the sheet</span>
          <EffectCards
            effects={g.effects}
            readOnly={readOnly}
            inherits={inherits}
            replace={g.replace === true}
            onReplace={(replace) => setGuidance({ replace: replace ? true : undefined })}
            onChange={(effects) =>
              setGuidance({ effects: effects.length > 0 ? effects : undefined })
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * The parts list. `entries` is the draft's, `original` the copied entry's;
 * `source` is the book the original is printed in, which a renamed part's
 * `basedOn` names.
 */
export function PartList({
  title,
  noun,
  entries,
  original,
  source,
  onChange,
  readOnly,
  withEffects = false,
}: {
  title: string;
  noun: string;
  entries: unknown;
  original?: unknown;
  source?: string;
  onChange: (entries: unknown[]) => void;
  readOnly: boolean;
  withEffects?: boolean;
}) {
  const list = Array.isArray(entries) ? entries : [];
  const was = Array.isArray(original) ? original.filter((b) => partName(b) !== undefined) : [];
  const names = was.map((b) => partName(b) as string);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string, on: boolean) =>
    setOpen((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const rows: Row[] = [];
  list.forEach((b, index) => {
    const origin = originOf(b);
    if (origin === undefined || !isRecord(b)) return;
    const before = names.includes(origin) ? (was[names.indexOf(origin)] as Json) : undefined;
    // Two parts claiming one original (a book that repeats a name) are told apart by place.
    const key =
      before !== undefined && !rows.some((r) => r.key === `was:${origin}`)
        ? `was:${origin}`
        : `new:${index}`;
    rows.push({ key, now: b, was: key.startsWith('was:') ? before : undefined, index });
  });
  // A removed part stays listed where it was, so it can be put back.
  names.forEach((n, i) => {
    if (rows.some((r) => r.was !== undefined && partName(r.was) === n)) return;
    const after = rows.findIndex(
      (r) => r.was !== undefined && names.indexOf(partName(r.was) ?? '') > i,
    );
    const row: Row = { key: `was:${n}`, was: was[i] as Json, index: -1 };
    if (after < 0) {
      const firstNew = rows.findIndex((r) => r.was === undefined);
      rows.splice(firstNew < 0 ? rows.length : firstNew, 0, row);
    } else rows.splice(after, 0, row);
  });

  const replaceAt = (index: number, next: Json) =>
    onChange(list.map((b, i) => (i === index ? next : b)));

  const setMode = async (row: Row, mode: Mode) => {
    const name = partName(row.was) ?? '';
    if (mode === 'remove') {
      if (row.now !== undefined) onChange(list.filter((_, i) => i !== row.index));
      toggle(row.key, false);
      return;
    }
    if (row.now === undefined && row.was !== undefined) {
      onChange(restore(list, structuredClone(row.was), names));
      toggle(row.key, mode === 'change');
      return;
    }
    if (mode === 'keep' && row.now !== undefined && !same(row.now, row.was)) {
      const ok = await askConfirm({
        title: `Go back to the original ${name}?`,
        detail: 'Your changes to it are lost.',
        confirmLabel: 'Go back',
      });
      if (!ok) return;
      replaceAt(row.index, structuredClone(row.was as Json));
    }
    toggle(row.key, mode === 'change');
  };

  const add = () => {
    const taken = new Set(list.map(partName));
    let n = 1;
    let name = `New ${noun}`;
    while (taken.has(name)) name = `New ${noun} ${++n}`;
    onChange([...list, { type: 'entries', name, entries: [] }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.length > 0 && (
        <ul aria-label={title} className={listClass}>
          {rows.map((row) => {
            const label = partName(row.now ?? row.was) ?? '';
            const status =
              row.was === undefined
                ? 'New'
                : row.now === undefined
                  ? 'Removed'
                  : same(row.now, row.was)
                    ? 'Kept'
                    : 'Changed';
            const mode: Mode =
              status === 'Removed'
                ? 'remove'
                : status === 'Changed' || open.has(row.key)
                  ? 'change'
                  : 'keep';
            const editing = row.now !== undefined && (row.was === undefined || mode === 'change');
            return (
              <li key={row.key} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex min-h-tap flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={`min-w-0 flex-1 text-body-strong ${status === 'Removed' ? 'text-ink-faint line-through' : ''}`}
                  >
                    {label || `Unnamed ${noun}`}
                  </span>
                  <Badge
                    tone={status === 'New' ? 'guide' : status === 'Kept' ? 'neutral' : 'outline'}
                  >
                    {status}
                  </Badge>
                  {row.was === undefined && !readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${label || `unnamed ${noun}`}`}
                      onClick={() => onChange(list.filter((_, i) => i !== row.index))}
                      className="tap -my-2 -mr-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  )}
                </div>
                {row.was !== undefined && !readOnly && (
                  <SegmentedControl<Mode>
                    label={`${label}: keep, change or remove`}
                    block
                    value={mode}
                    onChange={(m) => void setMode(row, m)}
                    options={[
                      { value: 'keep', label: 'Keep' },
                      { value: 'change', label: 'Change' },
                      { value: 'remove', label: 'Remove' },
                    ]}
                  />
                )}
                {editing && row.now !== undefined && (
                  <PartEditor
                    part={row.now}
                    noun={noun}
                    readOnly={readOnly}
                    withEffects={withEffects}
                    inherits={row.was !== undefined ? (partName(row.was) ?? label) : undefined}
                    onChange={(next) => replaceAt(row.index, next)}
                    rename={(name) => {
                      const now = row.now as Json;
                      replaceAt(
                        row.index,
                        row.was !== undefined && source !== undefined
                          ? renamed(now, name, partName(row.was) ?? name, source)
                          : { ...now, name },
                      );
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <Button variant="outline" size="sm" className="self-start" onClick={add}>
          <Plus size={16} aria-hidden />
          Add a {noun}
        </Button>
      )}
    </div>
  );
}
