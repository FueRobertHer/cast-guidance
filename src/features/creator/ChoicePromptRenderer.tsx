import { useState } from 'react';
import type { ChoicePrompt } from '@/engine/types';

export interface ChoicePromptRendererProps {
  prompt: ChoicePrompt;
  value: string[] | string | number | undefined;
  onChange: (value: string[] | string) => void;
}

/**
 * Generic renderer for engine ChoicePrompts — the wizard AND level-up flow
 * are both just lists of these. Never hardcodes rules content.
 */
export function ChoicePromptRenderer({ prompt, value, onChange }: ChoicePromptRendererProps) {
  const selected = Array.isArray(value)
    ? value.map(String)
    : value !== undefined
      ? [String(value)]
      : [];
  const [filter, setFilter] = useState('');
  const searchable = prompt.options.length > 12;

  const toggle = (id: string) => {
    if (prompt.count === 1) {
      onChange(prompt.kind === 'asiOrFeat' ? id : [id]);
      return;
    }
    // Weighted ability picks are distinct, order-sensitive slots.
    if (prompt.kind === 'abilityWeighted') {
      const next = [...selected];
      const existing = next.indexOf(id);
      if (existing >= 0) next.splice(existing, 1);
      else if (next.length < prompt.count) next.push(id);
      onChange(next);
      return;
    }
    const next = selected.includes(id)
      ? selected.filter((s) => s !== id)
      : selected.length < prompt.count
        ? [...selected, id]
        : selected;
    onChange(next);
  };

  // ASI-style ability picks allow stacking on one ability (+2), so they use
  // steppers rather than toggles.
  const addOne = (id: string) => {
    if (selected.length < prompt.count) onChange([...selected, id]);
  };
  const removeOne = (id: string) => {
    const i = selected.indexOf(id);
    if (i < 0) return;
    const next = [...selected];
    next.splice(i, 1);
    onChange(next);
  };

  const options = searchable
    ? prompt.options.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()))
    : prompt.options;
  // Options with descriptions (feats) render as a readable list, not chips.
  const detailed = prompt.options.some((o) => o.description !== undefined && o.description !== '');
  const stepper = prompt.kind === 'ability' && prompt.count > 1;

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg bg-surface p-3">
      <legend className="sr-only">{prompt.label}</legend>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{prompt.label}</span>
        <span className="shrink-0 text-xs text-ink-muted">
          {prompt.origin.label} · pick {prompt.count}
        </span>
      </div>
      {searchable && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="rounded bg-surface-2 px-2 py-1.5 text-sm outline-none placeholder:text-ink-muted"
        />
      )}
      {stepper ? (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {options.map((o) => {
            const times = selected.filter((s) => s === o.id).length;
            return (
              <div
                key={o.id}
                className={`flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 ${
                  times > 0 ? 'border-accent bg-accent-deep/40' : 'border-surface-2 bg-surface-2/40'
                }`}
              >
                <button
                  type="button"
                  aria-label={`Decrease ${o.label}`}
                  onClick={() => removeOne(o.id)}
                  disabled={times === 0}
                  className="h-6 w-6 shrink-0 rounded-full bg-surface text-sm disabled:opacity-30"
                >
                  −
                </button>
                <span className="text-sm font-semibold">
                  {o.label}
                  {times > 0 && <span className="ml-1 text-emerald-300">+{times}</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${o.label}`}
                  onClick={() => addOne(o.id)}
                  disabled={selected.length >= prompt.count}
                  className="h-6 w-6 shrink-0 rounded-full bg-surface text-sm disabled:opacity-30"
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      ) : detailed ? (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {options.map((o) => {
            const active = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled !== undefined}
                title={o.disabled?.reason}
                onClick={() => toggle(o.id)}
                className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent-deep/40'
                    : 'border-surface-2 bg-surface-2/40 hover:bg-surface-2'
                } ${o.disabled !== undefined ? 'opacity-40' : ''}`}
              >
                <span className="text-sm font-semibold">{o.label}</span>
                {o.description !== undefined && o.description !== '' && (
                  <span className="text-xs text-ink-muted">{o.description}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`flex flex-wrap gap-1.5 ${searchable ? 'max-h-48 overflow-y-auto' : ''}`}>
          {options.map((o) => {
            const times = selected.filter((s) => s === o.id).length;
            const active = times > 0;
            return (
              <button
                key={o.id}
                type="button"
                disabled={o.disabled !== undefined}
                title={o.disabled?.reason}
                onClick={() => toggle(o.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'border-accent bg-accent-deep/60 font-semibold'
                    : 'border-surface-2 bg-surface-2/50 text-ink-muted hover:text-ink'
                } ${o.disabled !== undefined ? 'opacity-40' : ''}`}
              >
                {o.label}
                {times > 1 && <span className="ml-1 text-xs">×{times}</span>}
              </button>
            );
          })}
        </div>
      )}
      {selected.length < prompt.count && (
        <p className="text-xs text-amber-300">{prompt.count - selected.length} more to pick</p>
      )}
    </fieldset>
  );
}
