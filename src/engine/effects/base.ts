import type {
  CharacterDoc,
  ChoicePrompt,
  DataEntity,
  EffectInput,
  EngineContext,
  FeatureCard,
} from '../types';

/** Shared mutable state threaded through all collectors. */
export class Collector {
  readonly doc: CharacterDoc;
  readonly ctx: EngineContext;
  readonly effects: EffectInput[] = [];
  readonly pending: ChoicePrompt[] = [];
  readonly features: FeatureCard[] = [];
  readonly warnings: string[] = [];

  constructor(doc: CharacterDoc, ctx: EngineContext) {
    this.doc = doc;
    this.ctx = ctx;
  }

  add(e: EffectInput): void {
    this.effects.push(e);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  /**
   * Resolve a choice from doc.choices or surface the prompt. When resolved,
   * `apply` receives the selected option ids (repeats allowed for weighted
   * ability picks).
   */
  choice(prompt: ChoicePrompt, apply: (selected: string[]) => void): void {
    const stored = this.doc.choices[prompt.id];
    if (stored === undefined) {
      this.pending.push(prompt);
      return;
    }
    const selected = Array.isArray(stored) ? stored.map(String) : [String(stored)];
    apply(selected);
  }
}

export function asEntityArray(v: unknown): DataEntity[] {
  if (!Array.isArray(v)) return [];
  return v.filter((e): e is DataEntity => typeof e === 'object' && e !== null);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
