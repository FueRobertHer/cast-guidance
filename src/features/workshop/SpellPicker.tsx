/**
 * A box to name one spell: typed, with the spells of the player's data that
 * match listed under it, each with the book it is printed in, so two
 * printings of one name are two rows told apart by their books. The ARIA
 * combobox pattern: arrows move through the rows, Enter or a tap picks one,
 * Escape closes the list alone. Typing without picking is the site's own to
 * read, as it was before the list (a name found, or the words kept as typed).
 */
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { sourceName } from '@/data5e/sourceNames';
import { SourceBadge } from '@/ui/SourceBadge';
import { fieldClass } from '@/ui/TextField';
import type { SpellOption } from './cards/kit/types';

/** The most rows the list draws: a few letters more find the rest. */
export const SHOWN_AT_MOST = 30;

/**
 * The spells whose names hold `query`, ignoring case: those that start with
 * it first, each group in the order given. At most `cap`, and how many more.
 */
export function spellMatches(
  options: readonly SpellOption[],
  query: string,
  cap = SHOWN_AT_MOST,
): { shown: SpellOption[]; more: number } {
  const q = query.trim().toLowerCase();
  const starts: SpellOption[] = [];
  const within: SpellOption[] = [];
  for (const o of options) {
    const name = o.name.toLowerCase();
    if (name.startsWith(q)) starts.push(o);
    else if (name.includes(q)) within.push(o);
  }
  const all = [...starts, ...within];
  return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap) };
}

/**
 * The printing a stored ref names among `options` (`name|source`, any case,
 * a `#` part left aside), or undefined for words that name none.
 */
export function printingOf(ref: string, options: readonly SpellOption[]): SpellOption | undefined {
  const [name, source] = (ref.split('#')[0] ?? '').toLowerCase().split('|');
  if (source === undefined || source === '') return undefined;
  return options.find((o) => o.name.toLowerCase() === name && o.source.toLowerCase() === source);
}

export function SpellPicker({
  label,
  ariaLabel,
  value,
  options,
  picked,
  placeholder,
  disabled,
  onType,
  onPick,
}: {
  /** The words over the box. */
  label: string;
  /** The box's own name, where it differs from the words over it. */
  ariaLabel?: string;
  /** What the box shows. */
  value: string;
  options: readonly SpellOption[];
  /** The printing the stored value names, shown by its book beside the name. */
  picked?: SpellOption;
  placeholder?: string;
  disabled?: boolean;
  /** Words typed: the site reads them as it always has. */
  onType: (text: string) => void;
  /** A row picked: that printing, never the words of its name. */
  onPick: (spell: SpellOption) => void;
}) {
  const id = useId();
  const inputId = `${id}-input`;
  const listId = `${id}-list`;
  const bookId = `${id}-book`;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The rows are drawn only while the list is open: a page holds many of these.
  const { shown, more } = open ? spellMatches(options, value) : { shown: [], more: 0 };
  const expanded = open && shown.length > 0;
  const optionId = (i: number) => `${id}-option-${i}`;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const pick = (o: SpellOption) => {
    close();
    onPick(o);
  };

  // A sheet or dialog listens for Escape on the document before the box hears
  // it, so the list takes it first, and only while it is open.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== input.current) return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [expanded]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // A box that cannot be changed lists nothing, whatever reaches it.
    if (disabled === true) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      if (!open) {
        const n = spellMatches(options, value).shown.length;
        setOpen(true);
        setActive(n === 0 ? -1 : down ? 0 : n - 1);
        return;
      }
      if (shown.length === 0) return;
      setActive((a) => (down ? (a + 1) % shown.length : a <= 0 ? shown.length - 1 : a - 1));
    } else if (e.key === 'Enter' && expanded && active >= 0) {
      const o = shown[active];
      if (o === undefined) return;
      e.preventDefault();
      pick(o);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <input
          ref={input}
          id={inputId}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-describedby={picked !== undefined ? bookId : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            onType(e.target.value);
            setOpen(e.target.value.trim() !== '');
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
          className={`${fieldClass}${picked !== undefined ? ' pr-20' : ''}`}
        />
        {picked !== undefined && (
          <span
            id={bookId}
            className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
          >
            <SourceBadge source={picked.source} />
          </span>
        )}
        {/* The list is beside the label, never in it, so it is no part of the box's name. */}
        <div
          hidden={!expanded}
          className="absolute top-full left-0 z-30 mt-1 w-full min-w-[min(15rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-control bg-surface shadow-overlay ring ring-line ring-inset"
        >
          <div
            id={listId}
            role="listbox"
            aria-label="Spells found"
            className="max-h-72 overflow-y-auto py-1"
            // A tap on a row would blur the box first and close the list under it.
            onMouseDown={(e) => e.preventDefault()}
          >
            {shown.map((o, i) => (
              // The box keeps focus and its keys move through the rows
              // (`aria-activedescendant`), so a row takes none itself.
              // biome-ignore lint/a11y/useFocusableInteractive: see above
              // biome-ignore lint/a11y/useKeyWithClickEvents: see above
              <div
                key={`${o.name}|${o.source}`}
                id={optionId(i)}
                role="option"
                // Its name and book as one says them, not run together ("FireballPHB").
                aria-label={`${o.name}, ${sourceName(o.source)}`}
                aria-selected={i === active}
                onClick={() => pick(o)}
                onMouseMove={() => setActive(i)}
                className={`flex min-h-tap cursor-pointer items-center justify-between gap-2 px-4 py-2 text-body text-ink ${
                  i === active ? 'bg-surface-hover' : ''
                }`}
              >
                <span className="min-w-0 truncate">{o.name}</span>
                <SourceBadge source={o.source} />
              </div>
            ))}
          </div>
          {more > 0 && (
            <p className="border-line border-t px-4 py-2 text-caption text-ink-muted">
              {more === 1 ? '1 more spell matches' : `${more} more spells match`}. Type more of the
              name to find {more === 1 ? 'it' : 'them'}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
