/**
 * Picks one of two to four modes for what sits right below it (DS-001): the
 * ability score method, the HP sheet's Damage, Heal and Temp HP, the dice
 * tray's tabs. Not for moving between screens (that is a tab bar), and not
 * for more than four options (those are option cards).
 *
 * Each segment is a button with `aria-pressed` in a labelled group. The
 * pressed one is an `ink` pill on the `surface-raised` track: selection is
 * ink, never a hue, and the pill's shape says it without colour. The track
 * is 44px tall; each segment 38px inside it. A `block` one wraps a segment to
 * a second row where large text will not fit them all on one, rather than run
 * out of its container.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  block = false,
}: {
  /** The group's accessible name ("Score method"). */
  label: string;
  /**
   * One or two words each. `name`, when the label is a short form ("Dis"),
   * is the whole word a screen reader says; it must contain the label.
   */
  options: ReadonlyArray<{ value: T; label: string; name?: string }>;
  value: T;
  onChange: (value: T) => void;
  /** Stretch to the container's width, the segments sharing it equally. */
  block?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs
    <div
      role="group"
      aria-label={label}
      className={`${block ? 'flex flex-wrap' : 'inline-flex'} gap-0.5 rounded-control bg-surface-raised p-0.75`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.name}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-9.5 rounded-lg px-3 text-label text-ink-muted transition-colors duration-120 not-aria-pressed:hover:text-ink aria-pressed:bg-ink aria-pressed:text-bg ${block ? 'flex-1' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
