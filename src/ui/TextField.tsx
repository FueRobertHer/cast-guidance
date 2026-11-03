import { CircleAlert, Search } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, useId } from 'react';

/**
 * Typed input (DS-001): names, searches, dice expressions.
 *
 * `surface-raised` with no resting border, 48px tall, the text at `input`
 * size (16px, so iOS Safari never zooms in on focus). Hover shows a
 * `line-strong` edge, focus the app's focus ring, and an invalid field a
 * `danger` edge. The label sits above in `label` style; help or an error goes
 * below, the error in `danger` with an icon, so it is not told by colour
 * alone. Placeholders start "For example," and never stand in for a label.
 *
 * `fieldClass` is the same field for a `select` or `textarea`.
 */
export const fieldClass =
  'h-12 w-full rounded-control bg-surface-raised px-4 text-input text-ink ring-inset transition-shadow duration-120 placeholder:text-ink-faint hover:ring-1 hover:ring-line-strong aria-invalid:ring-1 aria-invalid:ring-danger unavailable:cursor-default unavailable:text-ink-faint unavailable:ring-0';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  /** A line under the field about what to type. */
  help?: ReactNode;
  /** What is wrong with the value; marks the field invalid while set. */
  error?: ReactNode;
  /** A search box: a leading Search icon. */
  search?: boolean;
  id?: string;
}

export function TextField({
  label,
  help,
  error,
  search = false,
  id,
  className,
  ...input
}: TextFieldProps) {
  const ownId = useId();
  const fieldId = id ?? ownId;
  const noteId = `${fieldId}-note`;
  const note = error ?? help;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-label text-ink-muted">
        {label}
      </label>
      <div className="relative">
        {search && (
          <Search
            size={20}
            aria-hidden="true"
            className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
          />
        )}
        <input
          id={fieldId}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={note !== undefined ? noteId : undefined}
          className={`${fieldClass}${search ? ' pl-10.5' : ''}${className ? ` ${className}` : ''}`}
          {...input}
        />
      </div>
      {error !== undefined ? (
        <p id={noteId} className="flex items-center gap-1.5 text-caption text-danger">
          <CircleAlert size={14} aria-hidden="true" className="shrink-0" />
          {error}
        </p>
      ) : (
        help !== undefined && (
          <p id={noteId} className="text-caption text-ink-muted">
            {help}
          </p>
        )
      )}
    </div>
  );
}
