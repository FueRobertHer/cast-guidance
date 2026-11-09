/**
 * Describe an effect (the buffs canvas, Catalog board): a name, what it does
 * in parts of the kinds the sheet counts, when it ends, and whether to keep
 * it for the search next time. It loads with the search, in its chunk.
 */
import { ArrowLeft, Minus, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { countsAs } from '@/engine/activeEffects';
import type { ActiveEffect, KeptEffect } from '@/engine/types';
import { randomId } from '@/lib/randomId';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { touchScreen } from '@/ui/sheet';
import { fieldClass } from '@/ui/TextField';
import {
  BLOCKED_CONDITIONS,
  D20_ROLLS,
  DAMAGE_TYPES,
  DIE_ROLLS,
  DIE_SIDES,
  DRAFT_KINDS,
  type Draft,
  type DraftEnds,
  type DraftPart,
  describedEffect,
  keptFrom,
  kindTitle,
  NUMBER_TARGETS,
  narrows,
  newDraft,
  notReady,
  tempLine,
} from './describedEffect';
import { Line, toneOf } from './effectLines';
import { lastsLine, partLine } from './effectsInPlay';

const ENDS: ReadonlyArray<{ value: DraftEnds; label: string }> = [
  { value: 'you', label: 'When you end it' },
  { value: 'concentration', label: 'Concentration' },
  { value: 'short', label: 'A short rest' },
  { value: 'long', label: 'A long rest' },
];

const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/** Adds a value to a list, or takes it out when it is there. */
const flip = <T,>(list: readonly T[], v: T): T[] =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export interface EffectBuilderProps {
  /** What the search held, as the name it starts with. */
  name: string;
  /** The character's name, or "you". */
  who: string;
  effects: readonly ActiveEffect[];
  onBack: () => void;
  /** Put it on the character, with its temporary hit points and, when kept, what to keep. */
  onAdd: (effect: ActiveEffect, tempHp?: number, kept?: KeptEffect) => void;
}

export function EffectBuilder({ name, who, effects, onBack, onAdd }: EffectBuilderProps) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<Draft>(() => newDraft(name));
  // Each part's own key, so one removed takes its controls with it and the
  // rest keep theirs (and say nothing as they move up).
  const [keys, setKeys] = useState<number[]>([]);
  const nextKey = useRef(0);
  // Where focus goes once the parts change: into a part added, or, after one
  // is removed, to the part now in its place or else to the kinds to add.
  const refocus = useRef<{ part: number; into: boolean } | null>(null);
  const partsBox = useRef<HTMLDivElement>(null);
  const kinds = useRef<HTMLDivElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const to = refocus.current;
    if (to === null) return;
    refocus.current = null;
    const group = partsBox.current?.querySelectorAll<HTMLElement>('[data-part]')[to.part];
    if (group === undefined) {
      kinds.current?.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    // On a touch screen the part itself, so no keyboard rises over the sheet unasked.
    const first =
      to.into && !touchScreen()
        ? group.querySelector<HTMLElement>('button:not([data-remove]), input')
        : null;
    (first ?? group).focus();
  });

  const setPart = (i: number, next: DraftPart) =>
    setDraft((d) => ({ ...d, parts: d.parts.map((p, j) => (j === i ? next : p)) }));
  const removePart = (i: number) => {
    const left = draft.parts.length - 1;
    refocus.current = { part: Math.min(i, left - 1), into: false };
    setDraft((d) => ({ ...d, parts: d.parts.filter((_, j) => j !== i) }));
    setKeys((k) => k.filter((_, j) => j !== i));
  };
  const addPart = (make: () => DraftPart) => {
    refocus.current = { part: draft.parts.length, into: true };
    setDraft((d) => ({ ...d, parts: [...d.parts, make()] }));
    setKeys((k) => [...k, nextKey.current++]);
  };

  const { effect, tempHp } = describedEffect(draft, '');
  const why = notReady(draft);
  const groups = countsAs(effect);
  const twin =
    effect.name === ''
      ? undefined
      : effects.find((e) => e.off !== true && [...countsAs(e)].some((g) => groups.has(g)));
  // Two parts of one kind are told apart by their place among that kind.
  const titleOf = (i: number) => {
    const kind = draft.parts[i]?.kind;
    if (kind === undefined) return '';
    const same = draft.parts.filter((p) => p.kind === kind).length;
    const nth = draft.parts.slice(0, i).filter((p) => p.kind === kind).length + 1;
    return same > 1 ? `${kindTitle(kind)}, ${nth}` : kindTitle(kind);
  };

  const add = () => {
    if (why !== undefined) return;
    const id = randomId();
    const landed = describedEffect(draft, id);
    onAdd(landed.effect, landed.tempHp, draft.keep ? keptFrom(draft, randomId()) : undefined);
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="-my-1.5 -ml-2 flex min-h-tap items-center gap-1.5 self-start px-2 font-semibold text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        All effects
      </button>
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-semibold text-body text-ink outline-none">
          Describe an effect
        </h3>
        <p className="text-caption text-ink-muted">
          For homebrew, a book the app does not have, or a ruling at your table.
        </p>
      </div>

      <div>
        <label
          htmlFor={`${ids}-name`}
          className="mb-1 block font-semibold text-caption text-ink-muted"
        >
          Name
        </label>
        <input
          id={`${ids}-name`}
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="What your table calls it"
          autoComplete="off"
          className={fieldClass}
        />
      </div>

      <div ref={partsBox} className="flex flex-col gap-2">
        <h4 className="font-semibold text-caption text-ink-muted">What it does</h4>
        {draft.parts.map((p, i) => (
          <PartEditor
            key={keys[i] ?? `at-${i}`}
            id={`${ids}-p${keys[i] ?? i}`}
            title={titleOf(i)}
            part={p}
            onChange={(next) => setPart(i, next)}
            onRemove={() => removePart(i)}
          />
        ))}
        {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
        <div
          ref={kinds}
          role="group"
          aria-label="Add what it does"
          className="-mx-1.5 flex flex-wrap"
        >
          {DRAFT_KINDS.map((k) => (
            <Chip key={k.kind} onClick={() => addPart(k.make)}>
              <Plus size={16} aria-hidden="true" className="shrink-0" />
              {k.title}
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <h4 id={`${ids}-ends`} className="mb-1 font-semibold text-caption text-ink-muted">
          When it ends
        </h4>
        {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
        <div role="group" aria-labelledby={`${ids}-ends`} className="-mx-1.5 flex flex-wrap">
          {ENDS.map((e) => (
            <Chip
              key={e.value}
              pressed={draft.ends === e.value}
              onClick={() => setDraft((d) => ({ ...d, ends: e.value }))}
            >
              {e.label}
            </Chip>
          ))}
        </div>
      </div>

      <label className="-mx-2 flex min-h-tap items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-raised">
        <input
          type="checkbox"
          checked={draft.keep}
          onChange={(e) => setDraft((d) => ({ ...d, keep: e.target.checked }))}
          className="size-5 shrink-0 accent-ink"
        />
        <span className="text-body text-ink">
          Keep it in {possessive(who)} search for next time
        </span>
      </label>

      <div>
        <h4 className="mb-1 font-semibold text-caption text-ink-muted">On {who} it will</h4>
        <ul className="flex flex-col gap-1">
          {effect.parts.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts have no id, and their order is the description's own
            <Line key={i} tone={toneOf(p)}>
              {partLine(p)}
            </Line>
          ))}
          {tempHp !== undefined && <Line tone="help">{tempLine(tempHp)}</Line>}
          {effect.parts.length === 0 && tempHp === undefined && (
            <Line tone="info">Nothing yet: add what it does above</Line>
          )}
          <Line tone="info">{lastsLine(effect) ?? 'Lasts until you end it.'}</Line>
          {twin !== undefined && (
            <Line tone="warn">{`${twin.name} is already on ${who}: effects of one name count once`}</Line>
          )}
        </ul>
      </div>

      <Button variant="brand" block disabled={why !== undefined} onClick={add}>
        {why ?? (twin !== undefined ? `Add another to ${who}` : `Add to ${who}`)}
      </Button>
    </div>
  );
}

const possessive = (who: string) => (who === 'you' ? 'your' : `${who}’s`);

/** One part of the description: its kind's controls, "Only when", and Remove. */
function PartEditor({
  id,
  title,
  part,
  onChange,
  onRemove,
}: {
  id: string;
  title: string;
  part: DraftPart;
  onChange: (next: DraftPart) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset
      data-part
      tabIndex={-1}
      aria-labelledby={`${id}-t`}
      className="flex min-w-0 flex-col gap-2 rounded-control border border-line p-3 outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-t`} className="font-semibold text-body text-ink">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          data-remove
          aria-label={`Remove ${title}`}
          className="-my-2 -mr-2"
          onClick={onRemove}
        >
          <X size={18} aria-hidden="true" />
        </Button>
      </div>
      <PartRows id={id} part={part} onChange={onChange} />
      {narrows(part.kind) && (
        <div>
          <label
            htmlFor={`${id}-only`}
            className="mb-1 block font-semibold text-caption text-ink-muted"
          >
            Only when
          </label>
          <input
            id={`${id}-only`}
            value={('only' in part ? part.only : undefined) ?? ''}
            onChange={(e) => onChange({ ...part, only: e.target.value } as DraftPart)}
            placeholder="Always, or: against undead"
            autoComplete="off"
            aria-describedby={`${id}-only-hint`}
            className={fieldClass}
          />
          <p id={`${id}-only-hint`} className="mt-1 text-caption text-ink-muted">
            A moment the app cannot see changes no number: it shows as a line instead.
          </p>
        </div>
      )}
    </fieldset>
  );
}

function PartRows({
  id,
  part: p,
  onChange,
}: {
  id: string;
  part: DraftPart;
  onChange: (next: DraftPart) => void;
}) {
  switch (p.kind) {
    case 'num': {
      const speedOnly = p.targets.length === 1 && p.targets[0] === 'Speed';
      return (
        <>
          <Many
            id={`${id}-which`}
            label="Which numbers"
            options={NUMBER_TARGETS}
            on={p.targets}
            onTap={(v) => onChange({ ...p, targets: flip(p.targets, v) })}
          />
          <Stepper
            id={`${id}-n`}
            label="Amount"
            what="the amount"
            shown={speedOnly ? `${signed(p.n * 5)} ft` : signed(p.n)}
            value={p.n}
            min={1}
            max={10}
            onSet={(n) => onChange({ ...p, n })}
          />
          {p.targets.includes('Speed') && !speedOnly && (
            <p className="text-caption text-ink-muted">Speed rises by 5 ft for each.</p>
          )}
        </>
      );
    }
    case 'die': {
      const rolls = p.when === 'wait' ? D20_ROLLS : DIE_ROLLS;
      return (
        <>
          <Stepper
            id={`${id}-count`}
            label="How many dice"
            what="the number of dice"
            shown={String(p.count)}
            value={p.count}
            min={1}
            max={6}
            onSet={(count) => onChange({ ...p, count })}
          />
          <One
            id={`${id}-d`}
            label="Which die"
            options={DIE_SIDES.map((d) => ({ value: String(d), label: `d${d}` }))}
            value={String(p.d)}
            onPick={(v) => onChange({ ...p, d: Number(v) })}
          />
          <Many
            id={`${id}-on`}
            label="Added to"
            options={rolls}
            on={p.on}
            onTap={(v) => onChange({ ...p, on: flip(p.on, v) })}
          />
          <div>
            <h5 className="mb-1 font-semibold text-caption text-ink-muted">When</h5>
            <SegmentedControl
              label="When"
              options={[
                { value: 'in', label: 'Rolls in' },
                { value: 'wait', label: 'Waits for you' },
              ]}
              value={p.when}
              // Damage rolls in with the hit, so a die that waits is never on it.
              onChange={(when) =>
                onChange({
                  ...p,
                  when,
                  on: when === 'wait' ? p.on.filter((r) => r !== 'Damage') : p.on,
                })
              }
              block
            />
            <p className="mt-1 text-caption text-ink-muted">
              {p.when === 'wait'
                ? 'Offered on the roll, once: the effect ends when it is used.'
                : 'Added to every roll it is on.'}
            </p>
          </div>
        </>
      );
    }
    case 'adv':
      return (
        <Many
          id={`${id}-on`}
          label="On"
          options={D20_ROLLS}
          on={p.on}
          onTap={(v) => onChange({ ...p, on: flip(p.on, v) })}
        />
      );
    case 'reroll':
      return (
        <>
          <Many
            id={`${id}-on`}
            label="After"
            options={D20_ROLLS}
            on={p.on}
            onTap={(v) => onChange({ ...p, on: flip(p.on, v) })}
          />
          <Stepper
            id={`${id}-n`}
            label="Uses"
            what="the uses"
            shown={`${p.n} ${p.n === 1 ? 'use' : 'uses'}`}
            value={p.n}
            min={1}
            max={5}
            onSet={(n) => onChange({ ...p, n })}
          />
        </>
      );
    case 'cut':
      return (
        <>
          <div>
            <h5 className="mb-1 font-semibold text-caption text-ink-muted">How much</h5>
            <SegmentedControl
              label="How much"
              options={[
                { value: 'resist', label: 'Resistance' },
                { value: 'immune', label: 'Immunity' },
              ]}
              value={p.mode}
              onChange={(mode) => onChange({ ...p, mode })}
              block
            />
          </div>
          <Many
            id={`${id}-types`}
            label="Damage types"
            options={DAMAGE_TYPES}
            on={p.types}
            onTap={(v) => onChange({ ...p, types: flip(p.types, v) })}
          />
        </>
      );
    case 'cond':
      return (
        <Many
          id={`${id}-on`}
          label="Conditions"
          options={BLOCKED_CONDITIONS}
          on={p.on}
          onTap={(v) => onChange({ ...p, on: flip(p.on, v) })}
        />
      );
    case 'hp':
      return (
        <>
          <div>
            <h5 className="mb-1 font-semibold text-caption text-ink-muted">Which</h5>
            <SegmentedControl
              label="Which"
              options={[
                { value: 'temp', label: 'Temp HP' },
                { value: 'max', label: 'Raise the maximum' },
              ]}
              value={p.mode}
              onChange={(mode) => onChange({ ...p, mode })}
              block
            />
          </div>
          <Stepper
            id={`${id}-n`}
            label="Amount"
            what="the amount"
            shown={String(p.n)}
            value={p.n}
            min={1}
            max={50}
            onSet={(n) => onChange({ ...p, n })}
          />
        </>
      );
    case 'move':
      return (
        <>
          <One
            id={`${id}-how`}
            label="How"
            options={[
              { value: 'faster', label: 'Faster' },
              { value: 'fly', label: 'Fly' },
              { value: 'climb', label: 'Climb' },
              { value: 'swim', label: 'Swim' },
            ]}
            value={p.mode}
            onPick={(mode) => onChange({ ...p, mode: mode as typeof p.mode })}
          />
          {p.mode === 'faster' || p.mode === 'fly' ? (
            <Stepper
              id={`${id}-feet`}
              label="Feet"
              what="the feet"
              shown={`${p.mode === 'faster' ? '+' : ''}${p.feet} ft`}
              value={p.feet}
              min={5}
              max={120}
              by={5}
              onSet={(feet) => onChange({ ...p, feet })}
            />
          ) : (
            <p className="text-caption text-ink-muted">At your walking speed.</p>
          )}
        </>
      );
    case 'turn':
      return (
        <div>
          <h5 className="mb-1 font-semibold text-caption text-ink-muted">One more</h5>
          <SegmentedControl
            label="One more"
            options={[
              { value: 'action', label: 'Action' },
              { value: 'bonus', label: 'Bonus action' },
              { value: 'reaction', label: 'Reaction' },
            ]}
            value={p.what}
            onChange={(what) => onChange({ ...p, what })}
            block
          />
        </div>
      );
    case 'act':
      return (
        <>
          <Text
            id={`${id}-name`}
            label="Its name"
            hint="Like Ember lash"
            value={p.name}
            onSet={(name) => onChange({ ...p, name })}
          />
          <Text
            id={`${id}-dice`}
            label="Its damage, if it rolls any"
            hint="Like 2d6 fire"
            value={p.dice}
            onSet={(dice) => onChange({ ...p, dice })}
          />
        </>
      );
    case 'cost':
      return (
        <Text
          id={`${id}-text`}
          label="What it costs"
          hint="Like: speed 0, or no spells"
          value={p.text}
          onSet={(text) => onChange({ ...p, text })}
        />
      );
    case 'note':
      return (
        <Text
          id={`${id}-text`}
          label="The note"
          hint="What the DM says it does"
          value={p.text}
          onSet={(text) => onChange({ ...p, text })}
        />
      );
  }
}

function Many<T extends string>({
  id,
  label,
  options,
  on,
  onTap,
}: {
  id: string;
  label: string;
  options: readonly T[];
  on: readonly string[];
  onTap: (v: T) => void;
}) {
  return (
    <div>
      <h5 id={id} className="mb-1 font-semibold text-caption text-ink-muted">
        {label}
      </h5>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
      <div role="group" aria-labelledby={id} className="-mx-1.5 flex flex-wrap">
        {options.map((o) => (
          <Chip key={o} pressed={on.includes(o)} onClick={() => onTap(o)}>
            {o}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function One({
  id,
  label,
  options,
  value,
  onPick,
}: {
  id: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div>
      <h5 id={id} className="mb-1 font-semibold text-caption text-ink-muted">
        {label}
      </h5>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
      <div role="group" aria-labelledby={id} className="-mx-1.5 flex flex-wrap">
        {options.map((o) => (
          <Chip key={o.value} pressed={value === o.value} onClick={() => onPick(o.value)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Lower and Raise around the value, which is said as it changes. */
function Stepper({
  id,
  label,
  what,
  shown,
  value,
  min,
  max,
  by = 1,
  onSet,
}: {
  id: string;
  label: string;
  what: string;
  shown: string;
  value: number;
  min: number;
  max: number;
  by?: number;
  onSet: (n: number) => void;
}) {
  return (
    <div>
      <h5 id={id} className="mb-1 font-semibold text-caption text-ink-muted">
        {label}
      </h5>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
      <div role="group" aria-labelledby={id} className="flex items-center gap-2">
        {/* aria-disabled, not disabled: the press that reaches the end would
            otherwise disable the button it was made on, and focus would drop
            out of the sheet (as ExhaustionStepper says). */}
        <Button
          variant="outline"
          size="icon"
          aria-label={`Lower ${what}`}
          aria-disabled={value <= min}
          onClick={() => value > min && onSet(Math.max(min, value - by))}
        >
          <Minus size={18} aria-hidden="true" />
        </Button>
        <span aria-live="polite" className="min-w-16 text-center font-semibold tabular-nums">
          {shown}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Raise ${what}`}
          aria-disabled={value >= max}
          onClick={() => value < max && onSet(Math.min(max, value + by))}
        >
          <Plus size={18} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function Text({
  id,
  label,
  hint,
  value,
  onSet,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onSet: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-semibold text-caption text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onSet(e.target.value)}
        placeholder={hint}
        autoComplete="off"
        className={fieldClass}
      />
    </div>
  );
}
