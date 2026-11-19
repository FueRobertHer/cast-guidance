/**
 * A tick for each ability, for a card whose field is a list of abilities (an
 * AC worked out from them, half proficiency on their checks). Ticked ones are
 * stored in the order the sheet lists them; one a file names that is no
 * ability is kept after them, for the card's problem line to say. With none
 * ticked the field goes, so the effect reads as it does without it.
 */
import type { Eff } from './types';
import { ABILITY, omit } from './words';

export function AbilityTicks({
  effect,
  field,
  legend,
  title,
  onChange,
}: {
  effect: Eff;
  /** The effect's field that holds the list. */
  field: string;
  legend: string;
  /** The card's title, which each tick's name starts with. */
  title: string;
  onChange: (next: Eff) => void;
}) {
  const held = Array.isArray(effect[field]) ? (effect[field] as unknown[]).map(String) : [];
  const toggle = (a: string) => {
    const on = (v: string) => (v === a ? !held.includes(v) : held.includes(v));
    const known = new Set(ABILITY.map(([v]) => v));
    const next = [...ABILITY.map(([v]) => v).filter(on), ...held.filter((v) => !known.has(v))];
    onChange(next.length === 0 ? omit(effect, [field]) : { ...effect, [field]: next });
  };
  return (
    <fieldset className="col-span-2 flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-label text-ink-muted">{legend}</legend>
      {/* Two to a row on a phone, where "Constitution" would run past a third column. */}
      <div className="@container">
        <div className="grid grid-cols-2 gap-x-2 @min-[24rem]:grid-cols-3">
          {ABILITY.map(([v, text]) => (
            <label key={v} className="flex min-h-tap items-center gap-2 text-body">
              <input
                type="checkbox"
                className="size-4.5 accent-ink"
                aria-label={`${title}: ${text}`}
                checked={held.includes(v)}
                onChange={() => toggle(v)}
              />
              {text}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
