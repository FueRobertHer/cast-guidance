import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { ChoiceOption, ChoicePrompt } from '@/engine/types';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { cardClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';

export interface ChoicePromptRendererProps {
  prompt: ChoicePrompt;
  value: string[] | string | number | undefined;
  /** Called only when the reader presses Confirm, never on an individual tap. */
  onChange: (value: string[] | string) => void;
  /** When provided, renders a Cancel button (used when re-opening a made pick). */
  onCancel?: () => void;
  /**
   * Optional ⓘ affordance per option (e.g. a feat's full description). The
   * caller owns the registry lookup and returns a rendered node so this stays
   * rules-content-free. Returns undefined for options with no info.
   */
  renderOptionInfo?: (option: ChoiceOption) => ReactNode;
}

/** Joins draft ids into a comparison key. Not a space: option ids contain them. */
const KEY_SEP = '\u0000';

/**
 * The +/− cells: two across, three from `sm`, but never a cell narrower than
 * its two 44px buttons (5.5rem), so with large text the grid drops to one
 * column instead of the buttons running out of the card (A11Y-003).
 */
const STEPPERS =
  'grid grid-cols-[repeat(auto-fit,minmax(max(5.5rem,(100%_-_0.375rem)/2),1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(max(5.5rem,(100%_-_0.75rem)/3),1fr))]';

/**
 * Reduce a stored choice to the prompt's own option ids: case-corrected,
 * de-duplicated unless the prompt allows repeats, and capped at `count`.
 */
function canonicalize(
  prompt: ChoicePrompt,
  value: string[] | string | number | undefined,
): string[] {
  const raw = Array.isArray(value) ? value.map(String) : value !== undefined ? [String(value)] : [];
  const optionIds = new Map(prompt.options.map((o) => [o.id.toLowerCase(), o.id]));
  return raw
    .flatMap((id) => {
      const canonical = optionIds.get(id.toLowerCase());
      return canonical !== undefined ? [canonical] : [];
    })
    .filter((id, index, all) => prompt.allowRepeat === true || all.indexOf(id) === index)
    .slice(0, prompt.count);
}

/**
 * Generic renderer for engine ChoicePrompts — the wizard AND level-up flow
 * are both just lists of these. Never hardcodes rules content.
 *
 * Taps build a local draft; nothing reaches the character until Confirm. That
 * makes a mis-tap free to undo, and it lets a pick already made be re-opened
 * with its options still selected so one can be swapped out without losing the
 * rest.
 */
export function ChoicePromptRenderer({
  prompt,
  value,
  onChange,
  onCancel,
  renderOptionInfo,
}: ChoicePromptRendererProps) {
  const committed = canonicalize(prompt, value);
  const committedKey = committed.join(KEY_SEP);
  const [selected, setSelected] = useState(committed);
  // Re-seed the draft if the stored value changes underneath this instance
  // (React's "adjust state during render" pattern, cheaper than an effect).
  const [seededFrom, setSeededFrom] = useState(committedKey);
  if (seededFrom !== committedKey) {
    setSeededFrom(committedKey);
    setSelected(committed);
  }
  const [filter, setFilter] = useState('');
  const searchable = prompt.options.length > 12;

  // A prompt can ask for more than it can supply: every other language already
  // known, or expertise offered before the skills it draws on are confirmed.
  // Gating Confirm on `count` would dead-end those with no way out, so gate on
  // what is actually reachable instead.
  const selectable = prompt.options.filter((o) => o.disabled === undefined).length;
  const attainable =
    prompt.allowRepeat === true && selectable > 0
      ? prompt.count
      : Math.min(prompt.count, selectable);
  const short = attainable - selected.length;
  const canConfirm = attainable > 0 && short <= 0;
  const dirty = selected.join(KEY_SEP) !== committedKey;
  const statusId = `${prompt.id}-status`;

  const status =
    attainable === 0
      ? { text: 'Nothing here is still available to pick.', urgent: true }
      : short > 0
        ? { text: `${short} more to pick`, urgent: true }
        : attainable < prompt.count
          ? { text: `Only ${attainable} of ${prompt.count} still available.`, urgent: true }
          : dirty
            ? { text: 'Not saved yet. Confirm to apply.', urgent: false }
            : { text: '', urgent: false };
  const confirm = () => {
    if (!canConfirm) return;
    // asiOrFeat is stored as a bare string; every other kind stores a list.
    onChange(prompt.kind === 'asiOrFeat' && prompt.count === 1 ? (selected[0] ?? '') : selected);
  };

  const toggle = (id: string) => {
    if (prompt.count === 1) {
      setSelected([id]);
      return;
    }
    // Weighted ability picks are distinct, order-sensitive slots.
    if (prompt.kind === 'abilityWeighted') {
      const next = [...selected];
      const existing = next.indexOf(id);
      if (existing >= 0) next.splice(existing, 1);
      else if (next.length < prompt.count) next.push(id);
      setSelected(next);
      return;
    }
    setSelected(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : selected.length < prompt.count
          ? [...selected, id]
          : selected,
    );
  };

  // ASI-style ability picks can explicitly allow stacking on one ability (+2),
  // so only those prompts use steppers. Race/background boosts stay distinct.
  const addOne = (id: string) => {
    if (selected.length < prompt.count) setSelected([...selected, id]);
  };
  const removeOne = (id: string) => {
    const i = selected.indexOf(id);
    if (i < 0) return;
    const next = [...selected];
    next.splice(i, 1);
    setSelected(next);
  };

  const options = searchable
    ? prompt.options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()))
    : prompt.options;
  // Options with descriptions (feats) render as a readable list, not chips.
  const detailed = prompt.options.some((o) => o.description !== undefined && o.description !== '');
  const stepper = prompt.allowRepeat === true && prompt.count > 1;

  return (
    // `min-w-0`: a fieldset is otherwise at least as wide as its content's
    // longest line, so one wide row pushes the whole card past the screen.
    <fieldset className={`${cardClass} flex min-w-0 flex-col gap-3`}>
      <legend className="sr-only">{prompt.label}</legend>
      {/* The label keeps at least 6rem and its longest word beside the
          origin, which otherwise wraps under it, still at the right (large
          text). `max-w-full` caps that word at the row, where it breaks. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="max-w-full grow basis-24 text-body-strong wrap-break-word">
          {prompt.label}
        </span>
        <span className="ml-auto text-caption text-ink-muted">
          {prompt.origin.label} · pick {prompt.count}
        </span>
      </div>
      {searchable && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={`Filter ${prompt.label}`}
          placeholder="Filter…"
          className={fieldClass}
        />
      )}
      {stepper ? (
        <div className={STEPPERS}>
          {options.map((o) => {
            const times = selected.filter((s) => s === o.id).length;
            // Two 44px buttons either side of "STR+2" need about 9rem. A cell
            // narrower than that (two columns inside a Build card at 320px)
            // puts the name on its own line above them, so the buttons never
            // overlap the next cell (A11Y-002). DOM order stays −, name, +.
            return (
              // Picked at least once: the 2px `ink` edge of a selection (DS-001).
              <div
                key={o.id}
                className={`@container rounded-control bg-surface-raised ring-inset ${
                  times > 0 ? 'ring-2 ring-ink' : ''
                }`}
              >
                <div className="flex flex-wrap items-center justify-between @min-[9rem]:flex-nowrap">
                  <button
                    type="button"
                    aria-label={`Decrease ${o.label}`}
                    onClick={() => removeOne(o.id)}
                    disabled={times === 0}
                    className="tap shrink-0 rounded-control text-sm unavailable:text-ink-faint"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-surface">
                      −
                    </span>
                  </button>
                  <span className="order-first basis-full pt-1.5 text-center text-label @min-[9rem]:order-none @min-[9rem]:basis-auto @min-[9rem]:pt-0">
                    {o.label}
                    {times > 0 && <span className="ml-1 text-heal tabular-nums">+{times}</span>}
                  </span>
                  <button
                    type="button"
                    aria-label={`Increase ${o.label}`}
                    onClick={() => addOne(o.id)}
                    disabled={selected.length >= prompt.count}
                    className="tap shrink-0 rounded-control text-sm unavailable:text-ink-faint"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-surface">
                      +
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : detailed ? (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {options.map((o) => {
            const active = selected.includes(o.id);
            const info = renderOptionInfo?.(o);
            return (
              // An option card on the card's raised step; picked, the 2px
              // `ink` edge of a selection (DS-001).
              <div
                key={o.id}
                className={`flex items-start rounded-control bg-surface-raised ring-inset transition-colors duration-120 ${
                  active ? 'ring-2 ring-ink' : 'hover:bg-surface-hover'
                } ${o.disabled !== undefined ? 'opacity-40' : ''}`}
              >
                <button
                  type="button"
                  disabled={o.disabled !== undefined}
                  title={o.disabled?.reason}
                  aria-pressed={active}
                  onClick={() => toggle(o.id)}
                  className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 text-left"
                >
                  <span className="text-body-strong">{o.label}</span>
                  {o.description !== undefined && o.description !== '' && (
                    <span className="text-caption text-ink-muted">{o.description}</span>
                  )}
                  {o.advisory !== undefined && (
                    // Selectable, not disabled — a color-independent (icon + word)
                    // "guidance, not gatekeeping" cue, in the guide's gold.
                    <span className="text-caption font-semibold text-guide">⚠ {o.advisory}</span>
                  )}
                </button>
                {/* p-2.5 matches the info button's -m-2.5, so its 44px target
                    stays inside the row instead of poking out of the scroller. */}
                {info != null && <div className="shrink-0 p-2.5">{info}</div>}
              </div>
            );
          })}
        </div>
      ) : (
        // Chips with a 44px tap from their transparent border, so the row
        // pulls in by that border to line up with the text. Picked is the
        // filled `ink` pill.
        <div className={`-mx-1.5 flex flex-wrap ${searchable ? 'max-h-48 overflow-y-auto' : ''}`}>
          {options.map((o) => {
            const times = selected.filter((s) => s === o.id).length;
            const active = times > 0;
            return (
              <Chip
                key={o.id}
                tone="outline"
                pressed={active}
                disabled={o.disabled !== undefined}
                title={o.disabled?.reason}
                onClick={() => toggle(o.id)}
                className={o.disabled !== undefined ? 'opacity-40' : undefined}
              >
                {o.label}
                {times > 1 && <span className="tabular-nums">×{times}</span>}
              </Chip>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* aria-live so a screen reader hears staging progress; until Confirm
            this line is the only signal that anything happened. Stays mounted
            even when empty: a live region has to exist before it changes to be
            announced, and it doubles as the spacer that keeps the buttons right. */}
        <p
          id={statusId}
          aria-live="polite"
          className={`text-caption ${status.urgent ? 'text-guide' : 'text-ink-muted'}`}
        >
          {status.text}
        </p>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {onCancel !== undefined && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X size={16} aria-hidden /> Cancel
            </Button>
          )}
          {/* The card's own action, so an outline (DS-001): the step's one
              primary action is the wizard's Next. */}
          <Button
            variant="outline"
            size="sm"
            onClick={confirm}
            disabled={!canConfirm}
            aria-label={`Confirm ${prompt.label}`}
            aria-describedby={status.text === '' ? undefined : statusId}
          >
            <Check size={16} aria-hidden /> Confirm
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
