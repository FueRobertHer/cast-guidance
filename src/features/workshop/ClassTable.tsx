/**
 * A class as the books print it: a row per level, with its proficiency bonus,
 * its features and a column for each number that grows with level (the Class
 * board's A). A row opens in place on a tap: the numbers at that level to set,
 * what the book's own table says there, and the level's features to keep,
 * change or add to. On a narrow phone the feature names are cut short until a
 * row is opened.
 *
 * The table holds no class state: the class editor says what each column
 * holds and gets each change, and renders a level's features itself.
 */
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { NumberField } from './fields';

/** One number column: a pool, a spell count, the top slot. */
export interface TableColumn {
  key: string;
  label: string;
  /** What each of the twenty rows shows. */
  values: readonly string[];
  /** The numbers to edit, where the column can be set; without `set` it is worked out. */
  numbers?: readonly number[];
  /** Sets the number at a level, and the levels after it that had the same one. */
  set?: (level: number, value: number) => void;
}

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const bonusAt = (level: number) => 2 + Math.floor((level - 1) / 4);

/** A number cell: narrower once there are several. */
const cellClass = (n: number) => `${n > 3 ? 'w-11' : 'w-12'} shrink-0 text-center tabular-nums`;

/**
 * Past two number columns a phone has no room for the names beside them: they
 * go on a line of their own under the numbers.
 */
const INLINE = 2;

export function ClassTable({
  name,
  columns,
  book,
  namesAt,
  subAt,
  readOnly,
  children,
}: {
  /** The class's name, for the list's label. */
  name: string;
  columns: readonly TableColumn[];
  /** What the book's own table says at a level, beside what the editor sets. */
  book?: (level: number) => ReadonlyArray<readonly [string, string]>;
  /** The features a level has, as its row shows them. */
  namesAt: (level: number) => readonly string[];
  /** Whether a level is one with a subclass feature. */
  subAt: (level: number) => boolean;
  readOnly: boolean;
  /** A level's features, shown while its row is open. */
  children: (level: number) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(1);
  const id = useId();
  const cell = cellClass(columns.length);
  const stacked = columns.length > INLINE;
  return (
    <div className="flex flex-col overflow-hidden rounded-card bg-surface ring-1 ring-line ring-inset">
      <div
        aria-hidden
        className="flex items-center gap-2 border-line border-b px-3 py-2 font-semibold text-caption text-ink-muted"
      >
        <span className="w-6 shrink-0">Lv</span>
        <span className="w-8 shrink-0">PB</span>
        <span className="min-w-0 flex-1">{stacked ? '' : 'Features'}</span>
        {columns.map((c) => (
          <span key={c.key} className={`${cell} truncate`}>
            {c.label}
          </span>
        ))}
        <span className="w-4 shrink-0" />
      </div>
      <ul aria-label={`${name} by level`}>
        {LEVELS.map((level) => {
          const names = namesAt(level);
          const isOpen = open === level;
          const panel = `${id}-${level}`;
          const lines = book?.(level) ?? [];
          // Read out as one line ("Level 2, proficiency bonus +2, features: ...").
          const said = [
            `Level ${level}`,
            `proficiency bonus +${bonusAt(level)}`,
            `features: ${names.length > 0 ? names.join(', ') : 'none'}`,
            ...(subAt(level) ? ['a subclass level'] : []),
            ...columns.map((c) => `${c.label} ${c.values[level - 1] ?? ''}`),
          ].join(', ');
          const features = (
            <span
              className={`min-w-0 flex-1 break-words ${isOpen ? '' : 'truncate'} ${subAt(level) ? 'text-guide' : ''}`}
            >
              {names.length > 0 ? names.join(', ') : '-'}
            </span>
          );
          return (
            <li key={level} className="border-line border-b last:border-b-0">
              <button
                type="button"
                aria-label={said}
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => setOpen(isOpen ? null : level)}
                className="flex min-h-12 w-full flex-col justify-center gap-0.5 px-3 py-2 text-left text-body hover:bg-surface-hover"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="w-6 shrink-0 text-body-strong tabular-nums">{level}</span>
                  <span className="w-8 shrink-0 text-ink-muted tabular-nums">
                    +{bonusAt(level)}
                  </span>
                  {stacked ? <span className="flex-1" /> : features}
                  {columns.map((c) => (
                    <span key={c.key} className={cell}>
                      {c.values[level - 1] ?? ''}
                    </span>
                  ))}
                  <ChevronDown
                    size={16}
                    aria-hidden
                    className={`shrink-0 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </span>
                {stacked && <span className="flex w-full pl-16">{features}</span>}
              </button>
              {isOpen && (
                <div
                  id={panel}
                  className="flex flex-col gap-3 border-line border-t bg-bg px-3 pt-3 pb-3"
                >
                  {!readOnly && columns.some((c) => c.set !== undefined) && (
                    <div className="grid grid-cols-2 gap-2">
                      {columns.map((c) =>
                        c.set === undefined ? null : (
                          <NumberField
                            key={c.key}
                            label={`${c.label} at level ${level}`}
                            value={c.numbers?.[level - 1]}
                            onChange={(v) => c.set?.(level, v ?? 0)}
                          />
                        ),
                      )}
                      <p className="col-span-2 text-caption text-ink-muted">
                        The levels after it with the same number change with it.
                      </p>
                    </div>
                  )}
                  {lines.length > 0 && (
                    <p className="text-caption text-ink-muted">
                      The book's table at level {level}:{' '}
                      {lines.map(([label, value]) => `${label} ${value}`).join(', ')}
                    </p>
                  )}
                  {children(level)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
