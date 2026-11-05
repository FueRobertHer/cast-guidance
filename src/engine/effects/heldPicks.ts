/**
 * A pick that must differ from what the character already holds: a second
 * Elemental Adept's damage type, a fighting style from a feat beside the class's.
 */
import type { ChoicePrompt, EffectOrigin } from '../types';
import type { Collector } from './base';
import { originName } from './skillSources';

/**
 * Disable each option of a `distinct` prompt that another prompt of its kind has
 * picked, and warn when both already hold it. Runs once everything is collected,
 * because the other pick can come later (a class's own style is read after the
 * feat taken at its ASI), and from live prompts alone, so a saved pick whose
 * origin has gone blocks nothing. A prompt's own picks stay enabled, or a
 * multi-pick could not be deselected, and a class's own prompt stays open, which
 * is how the same pick can come to be held twice.
 */
export function markHeldPicks(col: Collector): void {
  const stored = (prompt: ChoicePrompt) => {
    const value = col.doc.choices[prompt.id];
    const list = Array.isArray(value) ? value : value !== undefined ? [value] : [];
    return list.map((id) => String(id).toLowerCase());
  };
  const live = [...col.pending, ...col.resolved.map((r) => r.prompt)];
  const marked = (prompt: ChoicePrompt): ChoicePrompt => {
    if (prompt.distinct !== true) return prompt;
    const own = new Set(stored(prompt));
    const heldBy = new Map<string, EffectOrigin>();
    for (const other of live) {
      if (other.id === prompt.id || other.kind !== prompt.kind) continue;
      for (const id of stored(other)) {
        if (!heldBy.has(id)) heldBy.set(id, other.origin);
      }
    }
    if (heldBy.size === 0) return prompt;
    return {
      ...prompt,
      options: prompt.options.map((o) => {
        const id = o.id.toLowerCase();
        const from = heldBy.get(id);
        if (from === undefined) return o;
        if (own.has(id)) {
          const warning = `${prompt.origin.label}: you already have ${o.label} from ${originName(from)}; choose another.`;
          // Two copies of a feat holding one pick would each say the same thing.
          if (!col.warnings.includes(warning)) col.warn(warning);
          return o;
        }
        return o.disabled !== undefined
          ? o
          : { ...o, disabled: { reason: `You already have this from ${originName(from)}.` } };
      }),
    };
  };
  col.pending.forEach((p, i) => {
    col.pending[i] = marked(p);
  });
  col.resolved.forEach((r, i) => {
    const prompt = marked(r.prompt);
    if (prompt !== r.prompt) col.resolved[i] = { ...r, prompt };
  });
}
