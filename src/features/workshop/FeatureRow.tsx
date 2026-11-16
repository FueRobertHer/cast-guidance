/**
 * One feature as a row (the Subclass board's A): its name, a badge saying
 * whether it is Kept, Changed, Removed, New or Waiting, Keep, Change and
 * Remove for a feature the original has, and its editor in place (name, text,
 * what it does on the sheet) while it is changed or new.
 *
 * Used for a subclass's features, an entry's named parts (`PartList`: a
 * species' traits, a feat's benefits) and a class's features. The row
 * holds no entry state: its owner says what it is and gets each change.
 */
import { ChevronDown, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { isRecord, type StoredEffect } from '@/engine/castGuidance';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { fieldClass } from '@/ui/TextField';
import { EffectCards, guidanceWith } from './EffectCards';
import { Field, TextBlocks } from './fields';

type Json = Record<string, unknown>;

export type FeatureStatus = 'kept' | 'changed' | 'removed' | 'new' | 'waiting';
export type FeatureMode = 'keep' | 'change' | 'remove';

const BADGE: Readonly<Record<FeatureStatus, readonly [string, BadgeTone]>> = {
  kept: ['Kept', 'neutral'],
  changed: ['Changed', 'outline'],
  removed: ['Removed', 'neutral'],
  new: ['New', 'outline'],
  waiting: ['Waiting', 'guide'],
};

const cap = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`;

/** A feature's own fields: its name, its text and, when the engine reads them, its effects. */
export function FeatureEditor({
  value,
  noun,
  onChange,
  onRename,
  readOnly,
  withEffects,
  inherits,
  resources,
  children,
}: {
  value: Json;
  noun: string;
  onChange: (next: Json) => void;
  onRename: (name: string) => void;
  readOnly: boolean;
  withEffects: boolean;
  /** The original feature's name, whose mechanics a changed one keeps unless told not to. */
  inherits?: string;
  /** Uses kept on the feature's class that its actions can spend (a class's pools). */
  resources?: readonly StoredEffect[];
  /** Fields of its own kind, after the name (a new feature's level). */
  children?: ReactNode;
}) {
  const g = isRecord(value.castGuidance) ? value.castGuidance : {};
  const setGuidance = (patch: Json) => {
    const next = guidanceWith(value.castGuidance, patch);
    const { castGuidance: _, ...rest } = value;
    onChange(next !== undefined ? { ...rest, castGuidance: next } : rest);
  };
  return (
    <div className="flex flex-col gap-3 pt-1">
      <Field label={`${cap(noun)} name`}>
        <input
          value={String(value.name ?? '')}
          disabled={readOnly}
          onChange={(e) => onRename(e.target.value)}
          className={fieldClass}
        />
      </Field>
      {children}
      <TextBlocks
        entries={value.entries}
        readOnly={readOnly}
        onChange={(entries) => onChange({ ...value, entries })}
      />
      {withEffects && (
        <div className="flex flex-col gap-1.5">
          <span className="text-label text-ink-muted">What it does on the sheet</span>
          <EffectCards
            effects={g.effects}
            readOnly={readOnly}
            inherits={inherits}
            resources={resources}
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

export interface FeatureRowProps {
  /** What it is called now (a removed one, what it was called). */
  name: string;
  /** What one is called: "feature", "trait", "benefit". */
  noun: string;
  status: FeatureStatus;
  /** A line under the name ("Shows when Oath of Devotion is loaded"). */
  meta?: string;
  /** The feature as it stands, while it is not removed or waiting. */
  value?: Json;
  /** Its editor is open: it is changed, new, or Change was picked. */
  editing: boolean;
  readOnly: boolean;
  /** Keep, Change and Remove, for a feature the original has. */
  onMode?: (mode: FeatureMode) => void;
  onChange: (next: Json) => void;
  onRename: (name: string) => void;
  /** Takes out a feature the player added. */
  onDelete?: () => void;
  withEffects?: boolean;
  inherits?: string;
  /** Uses kept on the feature's class that its actions can spend (a class's pools). */
  resources?: readonly StoredEffect[];
  /**
   * The row folds to its name and badge, opening on a tap (a subclass's many
   * features); otherwise its controls always show (an entry's few parts).
   */
  foldable?: boolean;
  /** Fields of its own kind in the editor, after the name. */
  children?: ReactNode;
}

export function FeatureRow({
  name,
  noun,
  status,
  meta,
  value,
  editing,
  readOnly,
  onMode,
  onChange,
  onRename,
  onDelete,
  withEffects = false,
  inherits,
  resources,
  foldable = false,
  children,
}: FeatureRowProps) {
  const [open, setOpen] = useState(status === 'new');
  const shown = !foldable || open;
  const label = name || `Unnamed ${noun}`;
  const [word, tone] = BADGE[status];
  const mode: FeatureMode = status === 'removed' ? 'remove' : editing ? 'change' : 'keep';
  const title = (
    <span className="flex min-w-0 flex-1 flex-col">
      <span
        className={`text-body-strong break-words ${status === 'removed' ? 'text-ink-faint line-through' : ''}`}
      >
        {label}
      </span>
      {meta !== undefined && <span className="text-caption text-ink-muted">{meta}</span>}
    </span>
  );
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-tap flex-wrap items-center gap-x-2 gap-y-1">
        {foldable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="-my-1 flex min-h-tap min-w-0 flex-1 items-center gap-2 text-left"
          >
            {title}
            <ChevronDown
              size={18}
              aria-hidden
              className={`shrink-0 text-ink-muted ${open ? 'rotate-180' : ''}`}
            />
          </button>
        ) : (
          title
        )}
        <Badge tone={tone}>{word}</Badge>
        {onDelete !== undefined && !readOnly && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={onDelete}
            className="tap -my-2 -mr-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      {shown && onMode !== undefined && !readOnly && (
        <SegmentedControl<FeatureMode>
          label={`${label}: keep, change or remove`}
          block
          value={mode}
          onChange={onMode}
          options={[
            { value: 'keep', label: 'Keep' },
            { value: 'change', label: 'Change' },
            { value: 'remove', label: 'Remove' },
          ]}
        />
      )}
      {shown && editing && value !== undefined && (
        <FeatureEditor
          value={value}
          noun={noun}
          readOnly={readOnly}
          withEffects={withEffects}
          inherits={inherits}
          resources={resources}
          onChange={onChange}
          onRename={onRename}
        >
          {children}
        </FeatureEditor>
      )}
    </li>
  );
}
