import { Chip } from './Chip';

/**
 * Chips that narrow a list to one part of it (DS-001, the One Workshop
 * canvas): each says what it keeps and how many, and the pressed one is the
 * ink pill, as every chip's selection is. A labelled group of toggle buttons,
 * one pressed at a time. They wrap to another row rather than scroll, so with
 * large text every one stays in sight.
 */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** The group's accessible name ("Show"). */
  label: string;
  /** What each keeps ("Spells"), and how many it would show. */
  options: ReadonlyArray<{ value: T; label: string; count: number }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs
    <div role="group" aria-label={label} className="-mx-1.5 flex flex-wrap">
      {options.map((option) => (
        <Chip
          key={option.value}
          tone="outline"
          // Said as a pair; the gap between the two draws no space to be read.
          aria-label={`${option.label}, ${option.count}`}
          pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          <span className="font-normal">{option.count}</span>
        </Chip>
      ))}
    </div>
  );
}
